# Capsule 14 · Senzu Bean — Caching Fundamentals

> *One bean, full recovery, instantly. Korin grows maybe one every few months,
> so they are always scarce, and every fight where someone has a Senzu is a
> fight about whether they can reach it in time. Nobody ever wins by having a
> Senzu — they win by not needing one.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 7 | 75 min | Capsules 10–13 | Local + concept |

---

## Why this capsule exists

Caching is the highest-leverage latency tool that exists — and the fastest way
to introduce bugs you can't reproduce.

The cache is a *second copy of the truth*. Every cache is therefore a
consistency problem you have chosen to accept, and the engineering is entirely
about choosing where staleness is harmless and where it is not.

There's also a number most people get wrong, and you'll measure it here: **hit
ratio is not load reduction.** A 90% hit ratio can leave your database at 100%
load.

---

## The concept

### The strategies

**Cache-aside (lazy loading)** — the default, and what you'll implement:

```
  read:   check cache → hit? return
                      → miss? read DB, write cache, return
  write:  write DB, then INVALIDATE the cache key
```

*For:* only cached data is ever requested; a cache failure degrades to slow, not
broken. *Against:* every miss pays DB latency; there's a race window on write.

**Write-through** — write to cache and DB together, synchronously.
*For:* cache is never stale. *Against:* slower writes, and you cache data that
may never be read.

**Write-behind (write-back)** — write to cache, flush to DB asynchronously.
*For:* very fast writes, absorbs bursts. *Against:* **data loss if the cache
dies before flushing.** Only for data you can afford to lose (view counts,
"last seen" timestamps).

**Read-through** — the cache library itself loads on miss. Cleaner code, less
control, and it hides where your latency goes.

> **Invalidate, don't update.** On write, delete the key rather than writing the
> new value. Two concurrent writers updating a cache can interleave and leave
> the *older* value cached permanently. Deletion is idempotent and always safe.

### Hit ratio vs load reduction — do the arithmetic

```
  10,000 req/s, 90% hit ratio  →  1,000 req/s still reach the database
```

If the database could only handle 800 req/s, you're still down. And worse: cache
misses are not a random sample. The cached items are the *popular* ones — cheap,
well-indexed, repeatedly requested. The misses are the long tail: rare, complex,
expensive queries.

**So a 90% hit ratio can easily leave 60% of the database's actual load intact.**
Measure database load reduction, not hit ratio, and be suspicious of anyone who
quotes only the latter.

### TTL is a correctness decision

TTL is "how stale may this be?" — a product question wearing an ops costume.

| Data | Reasonable TTL |
|---|---|
| User's own profile | seconds, or invalidate on write |
| Public leaderboard | 10–60 s |
| Product catalogue | minutes |
| Currency rates | as long as the business allows |
| Static asset with a hash in its name | forever (immutable) |

**Always add jitter.** A thousand keys created together expire together and
produce a synchronised stampede at exactly the same second (Capsule 15).
`ttl = base + rand(0, base*0.1)`.

### Eviction policies

When memory fills, something must go:

- **LRU** — evict least recently used. Good default.
- **LFU** — least frequently used. Better when popularity is stable; resists a
  scan wiping your working set.
- **TTL-only** — evict only on expiry. Risks OOM.
- **`allkeys-lru`** vs **`volatile-lru`** in Redis: evict from all keys, or only
  keys that have a TTL. **Getting this wrong is a classic outage**: with
  `noeviction` (the default!) Redis starts returning errors on write when full,
  instead of making room.

### Cache layers, fastest to slowest

```
  1. In-process (a Go map)     ~50ns   per-instance, inconsistent across replicas
  2. Distributed (Redis)       ~1ms    shared, consistent, a network hop
  3. CDN edge (Capsule 16)     ~10ms   geographic, HTTP only
  4. Database buffer pool      ~0.1ms  free, already happening
```

Don't forget #4. Postgres already caches hot pages in RAM. If your working set
fits in `shared_buffers`, "add Redis" may buy you far less than you assume —
measure before you add infrastructure.

**In-process caches are a Capsule 06 trap:** each replica has its own, so
invalidation doesn't propagate and users see different answers depending on
routing. Use them only for genuinely immutable data (config loaded at startup,
compiled templates).

### What not to cache

- Data that must be exactly right, right now (account balance during a
  transfer).
- Anything per-user in a shared key (**the classic catastrophic bug**: caching a
  personalised page under a URL key and serving user A's data to user B).
- Cheap queries. A cache adds a network hop; a 0.2 ms indexed lookup does not
  need one.
- Data with a hit ratio near zero — you're paying the write cost for nothing.

---

## Lab

### Step 1 — Redis in the stack

Add to **`deploy/docker-compose.yml`**:

```yaml
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: >
      redis-server
      --maxmemory 128mb
      --maxmemory-policy allkeys-lru
      --save ""
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      retries: 10
```

- `--maxmemory-policy allkeys-lru` — evict rather than error. The default is
  `noeviction`, which turns a full cache into write failures.
- `--save ""` — no disk persistence. **This is a cache.** If you need it to
  survive a restart, it isn't a cache, it's a database, and you should think
  much harder about it.

```bash
brew install redis    # for redis-cli
cd deploy && docker compose up -d redis
redis-cli ping        # PONG
```

### Step 2 — a cache-aside decorator

The `Store` interface from Capsule 06 lets you wrap, not rewrite.

```bash
go get github.com/redis/go-redis/v9
```

**`internal/scouter/cached.go`**

```go
package scouter

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// CachedStore wraps any Store with cache-aside caching in Redis.
// It is a decorator: the wrapped Store has no idea a cache exists.
type CachedStore struct {
	inner Store
	rdb   *redis.Client
	log   *slog.Logger
	ttl   time.Duration

	hits, misses, errs atomic.Uint64
}

var _ Store = (*CachedStore)(nil)

func NewCachedStore(inner Store, addr string, ttl time.Duration, log *slog.Logger) *CachedStore {
	return &CachedStore{
		inner: inner,
		rdb: redis.NewClient(&redis.Options{
			Addr:         addr,
			DialTimeout:  1 * time.Second,
			ReadTimeout:  200 * time.Millisecond, // a slow cache must not become
			WriteTimeout: 200 * time.Millisecond, // slower than the database
			PoolSize:     20,
		}),
		log: log,
		ttl: ttl,
	}
}

func (c *CachedStore) Close() error { return c.rdb.Close() }

// jitter spreads expiries so keys created together don't expire together.
func (c *CachedStore) jittered() time.Duration {
	return c.ttl + time.Duration(rand.Int63n(int64(c.ttl/10)))
}

func fighterKey(name string) string { return "scouter:fighter:" + name }
func boardKey(n int) string         { return "scouter:board:" + strconv.Itoa(n) }

func (c *CachedStore) Latest(fighter string) (Reading, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	key := fighterKey(fighter)

	raw, err := c.rdb.Get(ctx, key).Bytes()
	switch {
	case err == nil:
		var r Reading
		if json.Unmarshal(raw, &r) == nil {
			c.hits.Add(1)
			return r, true
		}
		// corrupt entry — treat as a miss and overwrite below
	case errors.Is(err, redis.Nil):
		c.misses.Add(1)
	default:
		// CACHE FAILURE MUST NOT BE REQUEST FAILURE. Log it, fall through
		// to the database, keep serving.
		c.errs.Add(1)
		c.log.Warn("cache read failed", "key", key, "err", err)
	}

	r, ok := c.inner.Latest(fighter)
	if !ok {
		return Reading{}, false
	}
	if b, err := json.Marshal(r); err == nil {
		if err := c.rdb.Set(ctx, key, b, c.jittered()).Err(); err != nil {
			c.log.Warn("cache write failed", "key", key, "err", err)
		}
	}
	return r, true
}

func (c *CachedStore) Leaderboard(n int) []Reading {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	key := boardKey(n)

	if raw, err := c.rdb.Get(ctx, key).Bytes(); err == nil {
		var out []Reading
		if json.Unmarshal(raw, &out) == nil {
			c.hits.Add(1)
			return out
		}
	} else if !errors.Is(err, redis.Nil) {
		c.errs.Add(1)
		c.log.Warn("cache read failed", "key", key, "err", err)
	} else {
		c.misses.Add(1)
	}

	out := c.inner.Leaderboard(n)
	if b, err := json.Marshal(out); err == nil {
		_ = c.rdb.Set(ctx, key, b, c.jittered()).Err()
	}
	return out
}

func (c *CachedStore) Record(r Reading) {
	c.inner.Record(r) // database first: it is the source of truth

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	// INVALIDATE, don't update. Two concurrent writers updating the cache can
	// interleave and leave the older value in place forever. Deletion can't.
	if err := c.rdb.Del(ctx, fighterKey(r.Fighter)).Err(); err != nil {
		c.log.Warn("invalidate failed", "fighter", r.Fighter, "err", err)
	}

	// The leaderboard is derived from all fighters, so any write invalidates
	// every variant. Scanning keys is fine at this scale; at real scale you
	// would keep the ranking in a Redis sorted set instead (see below).
	iter := c.rdb.Scan(ctx, 0, "scouter:board:*", 100).Iterator()
	for iter.Next(ctx) {
		_ = c.rdb.Del(ctx, iter.Val()).Err()
	}
}

// Stats reports hit ratio. Export these as metrics in Capsule 25.
func (c *CachedStore) Stats() (hits, misses, errs uint64, ratio float64) {
	h, m, e := c.hits.Load(), c.misses.Load(), c.errs.Load()
	if h+m > 0 {
		ratio = float64(h) / float64(h+m)
	}
	return h, m, e, ratio
}
```

Wire it in `main.go`:

```go
	if addr := os.Getenv("REDIS_ADDR"); addr != "" {
		cached := scouter.NewCachedStore(store, addr, 30*time.Second, log)
		defer cached.Close()
		store = cached
		log.Info("cache enabled", "addr", addr, "ttl", "30s")
	}
```

Expose the stats so you can see them:

```go
	mux.HandleFunc("GET /cache-stats", func(w http.ResponseWriter, r *http.Request) {
		type statser interface {
			Stats() (uint64, uint64, uint64, float64)
		}
		s2, ok := s.store.(statser)
		if !ok {
			writeErr(w, http.StatusNotFound, "cache not enabled")
			return
		}
		h, m, e, ratio := s2.Stats()
		writeJSON(w, http.StatusOK, map[string]any{
			"hits": h, "misses": m, "errors": e, "hit_ratio": ratio,
		})
	})
```

### Step 3 — measure the difference honestly

```bash
docker compose up -d postgres redis

# baseline: no cache
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" make run
k6 run scripts/load/stress.js 2>&1 | grep -E 'http_req_duration|http_reqs'
```

Record p50/p95/p99 and RPS. Then:

```bash
REDIS_ADDR=localhost:6379 \
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" make run

k6 run scripts/load/stress.js 2>&1 | grep -E 'http_req_duration|http_reqs'
curl -s localhost:8080/cache-stats | jq
```

| | no cache | cache | change |
|---|---|---|---|
| p50 | | | |
| p95 | | | |
| p99 | | | |
| RPS | | | |
| hit ratio | — | | |

### Step 4 — the load-reduction measurement that actually matters

Hit ratio is vanity. Database load is the number.

```bash
docker compose exec -T postgres psql -U scouter -d scouter \
  -c "SELECT pg_stat_statements_reset();" 2>/dev/null || true

docker compose exec -T postgres psql -U scouter -d scouter -tAc \
  "SELECT sum(calls) FROM pg_stat_statements;" 2>/dev/null

# or, simpler and always available:
docker compose exec -T postgres psql -U scouter -d scouter -tAc \
  "SELECT xact_commit + xact_rollback FROM pg_stat_database WHERE datname='scouter';"
```

Take that counter before and after each k6 run. Compute:

```
  load reduction = 1 - (transactions_with_cache / transactions_without_cache)
```

Compare it to your hit ratio. **They will not match**, and understanding why is
the point of this step: the 10% that miss are the expensive queries.

### Step 5 — kill Redis mid-flight

```bash
k6 run --vus 20 --duration 40s scripts/load/stress.js &
sleep 10
docker compose stop redis
```

Watch the service. It should:
- keep returning 200s
- get slower (every request now hits Postgres)
- log `cache read failed` warnings

```bash
sleep 10
docker compose start redis
wait
```

**Degraded, not broken.** That's the property to design for, and it comes
entirely from three decisions in the code: short cache timeouts, falling through
on error, and never treating a cache miss as a request failure.

Now break it deliberately — change the error branch to return an error to the
client, re-run, and watch your availability collapse the moment Redis hiccups.
Then change it back.

### Step 6 — the right data structure for a leaderboard

Scanning keys to invalidate a leaderboard is fine at this size and wrong at
scale. Redis has a purpose-built structure:

```bash
redis-cli
> ZADD scouter:live 9001 goku 8500 vegeta 530000 frieza 1400000 broly
> ZREVRANGE scouter:live 0 4 WITHSCORES     # top 5, O(log n + m)
> ZINCRBY scouter:live 500 goku             # atomic increment
> ZREVRANK scouter:live goku                # "what rank am I?" — O(log n)
> ZCARD scouter:live
```

A **sorted set** maintains the ranking incrementally on every write. No
invalidation, no recomputation, no scanning — and `ZREVRANK` answers "what's my
rank?" which is genuinely expensive in SQL.

**This is the real lesson of the capsule:** the best cache is often not a cached
copy of a query result, but a *different data structure that maintains the
answer as writes happen.* Try implementing `Leaderboard` with `ZREVRANGE` and
compare.

```bash
docker compose down
```

---

## In GCP

> **Concept only.** Memorystore has no free tier: roughly **$25–35/month**
> minimum for the smallest Redis instance. Docker Redis for the labs.

**Memorystore for Redis** — managed Redis. Basic tier (single node, data lost on
failure) and Standard tier (replica + automatic failover). It's VPC-internal
only, so Cloud Run needs a **Serverless VPC Access connector** to reach it, which
is its own small cost and a common surprise.

**Memorystore for Memcached** — simpler, multi-threaded, no persistence, no data
structures. Choose Redis unless you specifically want Memcached's simplicity.

Other GCP caching layers, so you know the whole ladder:

- **Cloud CDN** — HTTP responses at the edge (Capsule 16).
- **Cloud Storage + CDN** — static assets.
- **BigQuery** caches identical query results for 24 h, free.
- **Cloud SQL's buffer pool** — free, already running, often overlooked.

Cost note: Memorystore is billed per GB-hour whether you use it or not. A cache
you don't need is pure loss — which is another reason to measure database load
reduction before adding one.

---

## Bring it to work

- **Cache-aside is the default.** Invalidate on write, never update.
- **A cache failure must degrade, not fail.** Short timeouts, fall through,
  log it, keep serving.
- **Measure database load reduction, not hit ratio.**
- **Always jitter TTLs.**
- **Set an eviction policy explicitly.** `noeviction` is the default and it will
  turn a full cache into an outage.
- **Never cache personalised data under a shared key.** Put the user identity in
  the key or don't cache it.
- **Namespace and version your keys** (`svc:v2:entity:id`) so a schema change
  is a prefix bump instead of a migration.
- **Consider the data structure, not just the copy.** Sorted sets, HLLs and
  bitmaps often beat caching a query result.

---

## Battle drill

<details>
<summary><b>1.</b> 95% hit ratio, and the database is still at 100% CPU. Explain.</summary>

Hit ratio counts *requests*, not *cost*. The 5% that miss are the expensive
tail: unindexed queries, large scans, rare-but-heavy reports. The cached 95% were
the cheap ones that were never the problem.

Also possible: the total request rate grew, so 5% of a much bigger number is
still a lot; or writes (which are never cached) are the actual load; or your
invalidation is so aggressive that popular keys are constantly recomputed.

Diagnose with `pg_stat_statements` ordered by `total_exec_time` — that shows what
the database is *actually* spending time on, which is usually not what you
cached.
</details>

<details>
<summary><b>2.</b> Why invalidate rather than update the cache on write?</summary>

Concurrent writers can interleave:

```
  W1 writes DB (value=10)
  W2 writes DB (value=20)
  W2 updates cache (20)
  W1 updates cache (10)   ← the older value wins, permanently
```

The cache now holds 10 while the database holds 20, and nothing will ever fix it
until the TTL expires. With deletion, the worst outcome is an extra miss, and the
next read repopulates from the source of truth.

There's still a smaller race with cache-aside (a reader can populate a stale
value between a writer's DB write and its delete). Mitigations: delete *after*
the DB write (as the code does), use short TTLs as a backstop, or use versioned
keys so a stale write can never overwrite a newer one.
</details>

<details>
<summary><b>3.</b> When is an in-process cache the right choice?</summary>

When the data is **immutable or effectively immutable**: configuration loaded at
startup, compiled templates or regexes, feature-flag defaults, reference data
that changes on deploy.

It's the right choice there because it's 20,000× faster than a network hop and
has no failure mode.

It's the wrong choice for anything user-visible and mutable, because each replica
has its own copy, invalidation doesn't propagate, and users get different answers
depending on which instance served them — exactly the Capsule 06 bug, reintroduced.

The middle ground that real systems use: a small in-process cache with a very
short TTL (1–5 s) in front of Redis, to absorb hot-key traffic. Bounded staleness
you've explicitly accepted.
</details>

<details>
<summary><b>4.</b> Design a cache for a per-user feed.</summary>

The key must include the user: `feed:v1:user:{id}:page:{cursor}`. Never a shared
key — that's the bug where user A sees user B's data, and it is a serious
incident, not a performance issue.

TTL short (30–60 s) since feeds change; invalidate on the user's own actions so
read-your-writes holds (Capsule 13's problem in a new costume).

Watch memory: one entry per user per page means millions of keys. Cache only the
first page (the overwhelming majority of reads), store *ids* rather than
hydrated objects, and cache the objects separately so they're shared across
feeds.

At real scale you'd precompute feeds on write (fan-out-on-write) into a Redis
list per user — turning a read-time join into a write-time push, which is
Capsule 20.
</details>

<details>
<summary><b>5.</b> Redis is down. What should your service do?</summary>

**Serve from the database, slower.** Cache errors must be caught, logged and
fallen through. A cache is an optimisation; a service that fails when its
optimisation fails has made the optimisation a dependency.

Requirements to make that real:
- **Short timeouts** (100–500 ms). A hung Redis must not become slower than the
  database it's meant to accelerate.
- **A circuit breaker** (Capsule 17) so you stop calling a dead cache and paying
  the timeout on every request.
- **Capacity headroom** — can the database survive 100% of traffic? If not, the
  cache is load-bearing, and you need Redis HA plus a plan (load shedding,
  degraded responses) for when it goes anyway.
- **An alert on hit ratio collapse**, not just on Redis being unreachable — a
  cache that's up but evicting everything is the sneakier failure.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `dial tcp: connection refused` | Redis isn't up, or you used the container name from the host. `localhost:6379` from the host, `redis:6379` from a container. |
| `OOM command not allowed when used memory > maxmemory` | `maxmemory-policy` is `noeviction`. Set `allkeys-lru`. |
| Hit ratio near zero | Keys differ per request (a timestamp or random value in the key), or TTL is shorter than the request interval. Print the keys. |
| Stale data after a write | Invalidation isn't running, or it deletes a differently-constructed key. Use one shared key-builder function. |
| Cache slower than the database | Serialisation cost on large values, or a network hop for a query that took 0.2 ms. Not everything deserves a cache. |
| Memory keeps growing | Keys without TTLs. `redis-cli --scan | head` then `TTL <key>` — anything returning `-1` is immortal. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(cache): cache-aside decorator over Store with redis

Capsule 14. Jittered TTLs, invalidate-not-update on write, short timeouts and
fall-through so a cache outage degrades rather than fails. Measured database
load reduction separately from hit ratio — they differ substantially."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 14
```

**Next:** [Capsule 15 · Ginyu Force Tactics — When Caches Betray You](../15-ginyu-force-cache-failures/README.md)
