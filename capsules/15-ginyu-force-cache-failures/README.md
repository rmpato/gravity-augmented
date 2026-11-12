# Capsule 15 · Ginyu Force Tactics — When Caches Betray You

> *The Ginyu Force are individually strong and collectively ridiculous. They
> insist on posing in formation before every fight, they attack one at a time,
> and they lose because of their own coordination. A cache stampede is exactly
> this: a thousand perfectly reasonable requests, arriving in perfect
> synchronisation, destroying the thing they were meant to protect.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 8 | 80 min | Capsule 14 | Local |

---

## Why this capsule exists

Capsule 14 gave you a cache. This one covers everything that goes wrong with it
— and these failures share a property that makes them dangerous: **they only
appear under load.** Your cache works perfectly in dev, in staging, and in
production right up until the moment it matters most.

Every failure here has a name, a mechanism, and a specific fix. Knowing them by
name is most of the battle, because the symptom ("the database fell over at
exactly 14:00:00") is otherwise baffling.

---

## The concept

### Cache stampede / thundering herd

A popular key expires. 1,000 concurrent requests miss simultaneously. All 1,000
query the database for the same row. The database, which was serving 10 QPS,
suddenly gets 1,000 — and these are the *expensive* uncached queries.

```
  t=0.000   key expires
  t=0.001   1000 requests miss
  t=0.002   1000 identical queries hit the database
  t=0.500   database saturated, everything slows
  t=2.000   requests time out, clients retry, 2000 queries arrive
  t=5.000   outage
```

**Three fixes, and you want more than one:**

1. **Request coalescing (singleflight).** Only the *first* miss for a key does
   the work; concurrent callers wait for and share its result. One query instead
   of a thousand. This is the highest-value 20 lines of code in the capsule.
2. **Probabilistic early expiry (XFetch).** Before the TTL ends, each request
   has a small, increasing chance of refreshing the key early. Refreshes get
   spread over time instead of landing on one instant.
3. **Stale-while-revalidate.** Serve the stale value immediately and refresh in
   the background. Latency stays flat; the cost is bounded staleness.

### Cache penetration

Requests for keys that **don't exist anywhere**. Every one misses the cache,
queries the database, finds nothing, caches nothing — so the next identical
request does it all again.

Innocently: a deleted resource still linked from somewhere. Maliciously: an
attacker requesting random ids to bypass your cache entirely and hammer the
database directly.

**Fixes:** cache the negative result too (with a short TTL, e.g. 30 s); or a
**Bloom filter** of existing keys in front of the cache — a probabilistic set
that answers "definitely not present" in constant time and a few MB.

### Hot keys

One key gets a disproportionate share of traffic — a celebrity, a front-page
item, a live event. That key lives on **one** Redis node, so no amount of
cluster scaling helps; that single node saturates.

**Fixes:** a small in-process cache (1–5 s TTL) in front of Redis, so most hot
requests never leave the process; or **key splitting** — write to
`key:goku:0..9` and read a random one, spreading the same value across nodes.

### Cache avalanche

Everything expires at once — a mass restart, a flush, a deploy that cleared the
cache, or a thousand keys created together with identical TTLs.

**Fixes:** TTL jitter (Capsule 14); warm the cache before taking traffic; stagger
deploys so you never flush everything simultaneously.

### Consistent hashing (for cache clusters)

With `hash(key) % N` across N cache nodes, losing one node remaps ~all keys —
your entire cache is invalidated at the worst possible moment (a node just
died).

**Consistent hashing** puts nodes and keys on a ring. Each key belongs to the
next node clockwise. Removing a node only reassigns *its* keys — `1/N` instead
of everything.

```
             node A
          ·         ·
      ·                 ·
   ·      k1   k2         ·  node B
   ·                      ·
      ·      k3        ·
          ·         ·
             node C

  node B dies → only k2 moves (to C). k1 and k3 are untouched.
```

**Virtual nodes** — each physical node occupies ~150 positions on the ring —
keep the distribution even and make removal spread its load across all survivors
rather than dumping it on one neighbour.

### Invalidation is the hard part

> "There are only two hard things in Computer Science: cache invalidation and
> naming things." — Phil Karlton

Strategies, weakest to strongest:

- **TTL only** — simple, always eventually correct, always sometimes stale.
- **Explicit invalidation on write** — correct if you find *every* write path.
  You won't; batch jobs, admin tools and migrations bypass your service.
- **Versioned keys** — bump a version number instead of deleting.
  `user:{id}:v{version}` — old entries become unreachable and expire naturally.
  No delete needed, no race.
- **Event-driven invalidation** — the database emits change events (CDC,
  Capsule 21) and a consumer invalidates. Catches every writer, including ones
  you don't control.
- **Write-through** — cache and store updated together, so they can't diverge.

---

## Lab

### Step 1 — build a stampede

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d postgres redis
cd ..
REDIS_ADDR=localhost:6379 \
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" make run
```

Add a deliberately expensive endpoint so the stampede is visible.
In `postgres.go`:

```go
// SlowLeaderboard simulates an expensive uncached query — the kind that is
// fine at 10 QPS and fatal at 1000.
func (s *PostgresStore) SlowLeaderboard(n int) []Reading {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _ = s.pool.Exec(ctx, "SELECT pg_sleep(0.3)")
	return s.Leaderboard(n)
}
```

Point `/leaderboard` at it temporarily, set the cache TTL to 5 seconds, and:

```bash
# 200 concurrent requests, timed to land right as the key expires
curl -s "localhost:8080/leaderboard" > /dev/null      # populate
sleep 5                                               # let it expire

time (for i in $(seq 1 200); do
        curl -s -o /dev/null localhost:8080/leaderboard &
      done; wait)
```

Watch the database while it happens:

```bash
docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT count(*), state FROM pg_stat_activity WHERE datname='scouter' GROUP BY state;"
```

Dozens of identical queries, all computing the same answer. **That's the
stampede.** Note the elapsed time.

### Step 2 — singleflight

```bash
go get golang.org/x/sync/singleflight
```

> Same caveat as Capsule 10: check `head -3 go.mod` afterwards and keep your
> Dockerfile's `FROM golang:` tag at or above the `go` directive.

**`internal/scouter/coalesced.go`**

```go
package scouter

import (
	"golang.org/x/sync/singleflight"
)

// Coalescer collapses concurrent identical cache misses into ONE call to the
// underlying loader. The other callers block briefly and share the result.
//
// This is the single highest-value pattern in cache engineering: it turns a
// 1000x database spike into a 1x one, in about twenty lines.
type Coalescer struct {
	group singleflight.Group
}

// Do runs fn for key, sharing the result with any concurrent callers.
func (c *Coalescer) Do(key string, fn func() (any, error)) (any, bool, error) {
	v, err, shared := c.group.Do(key, fn)
	return v, shared, err
}
```

Use it in `CachedStore`:

```go
type CachedStore struct {
	inner Store
	rdb   *redis.Client
	log   *slog.Logger
	ttl   time.Duration
	sf    singleflight.Group          // <-- add this

	hits, misses, errs, coalesced atomic.Uint64
}
```

```go
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
	}
	c.misses.Add(1)

	// MISS: only one goroutine per key does the work.
	v, err, shared := c.sf.Do(key, func() (any, error) {
		out := c.inner.Leaderboard(n)
		if b, err := json.Marshal(out); err == nil {
			bg, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			defer cancel()
			_ = c.rdb.Set(bg, key, b, c.jittered()).Err()
		}
		return out, nil
	})
	if shared {
		c.coalesced.Add(1) // this request rode along on someone else's work
	}
	if err != nil {
		return nil
	}
	return v.([]Reading)
}
```

Re-run Step 1:

```bash
curl -s localhost:8080/leaderboard > /dev/null
sleep 5
time (for i in $(seq 1 200); do curl -s -o /dev/null localhost:8080/leaderboard & done; wait)

docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname='scouter' AND state='active';"
```

**One query instead of two hundred.** Total elapsed time should drop
dramatically too, because 199 requests waited 300 ms instead of queueing behind
each other in the database.

> **Important limitation:** singleflight is *per process*. With 10 replicas
> you get 10 queries, not 1 — which is still a 20× improvement. For true global
> coalescing you need a distributed lock (`SET key val NX PX 5000`), where one
> instance wins the right to recompute and the others wait or serve stale.

### Step 3 — negative caching

```bash
for i in $(seq 1 100); do
  curl -s -o /dev/null "localhost:8080/fighters/nonexistent_$RANDOM"
done
```

Every one of those hits Postgres. Now cache the misses. In `CachedStore.Latest`:

```go
	r, ok := c.inner.Latest(fighter)
	if !ok {
		// NEGATIVE CACHE: remember that this doesn't exist, briefly.
		// Short TTL so a newly created fighter appears quickly.
		// Without this, an attacker requesting random ids bypasses the cache
		// entirely and queries your database directly, every time.
		_ = c.rdb.Set(ctx, key, "null", 30*time.Second).Err()
		return Reading{}, false
	}
```

And handle it on read:

```go
	raw, err := c.rdb.Get(ctx, key).Bytes()
	if err == nil {
		if string(raw) == "null" {
			c.hits.Add(1)
			return Reading{}, false      // cached negative
		}
		...
	}
```

Re-run the loop and watch database queries drop to near zero for repeats.

**The trade-off:** create a fighter that was recently requested-and-missing, and
it stays invisible for up to 30 seconds. That's why the negative TTL is short —
and why you invalidate the key on create.

### Step 4 — build a hot key, then absorb it

```bash
# 90% of traffic to one fighter
cat > /tmp/hot.js <<'EOF'
import http from 'k6/http';
export const options = { vus: 50, duration: '30s' };
export default function () {
  const f = Math.random() < 0.9 ? 'goku' : `f_${Math.floor(Math.random()*2000)}`;
  http.get(`http://localhost:8080/fighters/${f}`);
}
EOF
k6 run /tmp/hot.js
```

```bash
redis-cli --stat        # ops/sec — nearly all for one key
redis-cli OBJECT FREQ scouter:fighter:goku   # needs maxmemory-policy allkeys-lfu
```

Now add a tiny in-process front cache — the standard hot-key mitigation:

```go
// A 1-second in-process cache in front of Redis. Bounded staleness of ONE
// SECOND, in exchange for removing hot-key load from the network entirely.
// This is safe here precisely because the staleness window is tiny and
// explicit; it is the Capsule 06 trap only if you forget the TTL.
type localEntry struct {
	r       Reading
	ok      bool
	expires time.Time
}

type CachedStore struct {
	// …
	local   sync.Map // string -> localEntry
	localTTL time.Duration
}

func (c *CachedStore) Latest(fighter string) (Reading, bool) {
	if v, found := c.local.Load(fighter); found {
		e := v.(localEntry)
		if time.Now().Before(e.expires) {
			return e.r, e.ok
		}
	}
	r, ok := c.latestFromRedisOrDB(fighter)   // the previous body
	c.local.Store(fighter, localEntry{r: r, ok: ok, expires: time.Now().Add(c.localTTL)})
	return r, ok
}
```

Re-run the load test. Redis ops/sec for the hot key should collapse.

### Step 5 — consistent hashing, measured

```bash
go get github.com/cespare/xxhash/v2
```

**`internal/scouter/ring.go`**

```go
package scouter

import (
	"sort"
	"strconv"

	"github.com/cespare/xxhash/v2"
)

// Ring is a consistent hash ring with virtual nodes.
// Removing a node reassigns only that node's keys (~1/N), instead of the
// ~all-of-them you get with hash(key) % N.
type Ring struct {
	replicas int
	hashes   []uint64          // sorted positions on the ring
	owner    map[uint64]string // position -> node name
}

func NewRing(replicas int, nodes ...string) *Ring {
	r := &Ring{replicas: replicas, owner: make(map[uint64]string)}
	for _, n := range nodes {
		r.Add(n)
	}
	return r
}

func (r *Ring) Add(node string) {
	for i := 0; i < r.replicas; i++ {
		h := xxhash.Sum64String(node + "#" + strconv.Itoa(i))
		r.hashes = append(r.hashes, h)
		r.owner[h] = node
	}
	sort.Slice(r.hashes, func(i, j int) bool { return r.hashes[i] < r.hashes[j] })
}

func (r *Ring) Remove(node string) {
	kept := r.hashes[:0]
	for _, h := range r.hashes {
		if r.owner[h] == node {
			delete(r.owner, h)
			continue
		}
		kept = append(kept, h)
	}
	r.hashes = kept
}

// Get returns the node that owns key: the first ring position clockwise.
func (r *Ring) Get(key string) string {
	if len(r.hashes) == 0 {
		return ""
	}
	h := xxhash.Sum64String(key)
	i := sort.Search(len(r.hashes), func(i int) bool { return r.hashes[i] >= h })
	if i == len(r.hashes) {
		i = 0 // wrap around
	}
	return r.owner[r.hashes[i]]
}
```

**`internal/scouter/ring_test.go`** — prove the property rather than believing it:

```go
package scouter

import (
	"fmt"
	"testing"
)

func TestRingRemapsFewKeysOnNodeLoss(t *testing.T) {
	keys := make([]string, 100000)
	for i := range keys {
		keys[i] = fmt.Sprintf("fighter_%d", i)
	}

	ring := NewRing(150, "cache-a", "cache-b", "cache-c", "cache-d")
	before := make(map[string]string, len(keys))
	for _, k := range keys {
		before[k] = ring.Get(k)
	}

	ring.Remove("cache-c")

	moved := 0
	for _, k := range keys {
		if ring.Get(k) != before[k] {
			moved++
		}
	}
	pct := float64(moved) / float64(len(keys)) * 100
	t.Logf("consistent hashing: %.1f%% of keys moved when 1 of 4 nodes was removed", pct)

	// Losing 1 of 4 nodes should move ~25% — the keys that node owned.
	if pct > 35 {
		t.Errorf("moved %.1f%%, expected ~25%%", pct)
	}
}

func TestModuloRemapsAlmostEverything(t *testing.T) {
	// The comparison that makes the point.
	moved := 0
	const n = 100000
	for i := 0; i < n; i++ {
		h := xxhashString(fmt.Sprintf("fighter_%d", i))
		if h%4 != h%3 {
			moved++
		}
	}
	t.Logf("modulo hashing: %.1f%% of keys moved when going from 4 to 3 nodes",
		float64(moved)/n*100)
}
```

Add the tiny helper to `ring.go`:

```go
func xxhashString(s string) uint64 { return xxhash.Sum64String(s) }
```

```bash
go test ./internal/scouter/ -run 'Ring|Modulo' -v
```

You should see roughly **26% vs ~75%**. That gap — losing a quarter of your
cache versus losing three quarters of it, at the exact moment a node just died —
is why every distributed cache and every sharded datastore uses a ring.

```bash
cd deploy && docker compose down
```

---

## In GCP

- **Memorystore Redis Cluster** shards across nodes using consistent hashing
  internally — you get the property without implementing it, but you still need
  to understand hot keys, because a hot key still lives on one shard.
- **Cloud CDN** has the same stampede problem at the edge. Its
  `request coalescing` collapses concurrent misses for the same object into one
  origin fetch — the same singleflight idea, one layer up (Capsule 16).
- **Cloud Armor rate limiting** is your defence against deliberate cache
  penetration: an attacker probing random ids gets rate-limited before reaching
  your origin.
- **`stale-while-revalidate`** is a standard `Cache-Control` directive that
  Cloud CDN honours — the HTTP-level version of Step 2's pattern, and free.

---

## Bring it to work

- **Singleflight every expensive cache miss.** Twenty lines, enormous payoff.
- **Jitter every TTL.** No exceptions.
- **Negative-cache misses** with a short TTL — it's also a security control.
- **Know your hot keys**, and put a 1-second local cache in front of them.
- **Consistent hashing for any client-side sharding**, cache or otherwise.
- **Version your cache keys** so a schema change is a prefix bump, not an
  invalidation project.
- **Test cache behaviour under concurrency.** These bugs are invisible in a
  single-threaded test and only appear at the moment of peak load.
- **Serve stale rather than fail.** `stale-while-revalidate` is almost always the
  right answer for read-heavy public data.

---

## Battle drill

<details>
<summary><b>1.</b> Every day at 14:00 exactly, the database CPU spikes to 100% for 90 seconds. Why?</summary>

Synchronised expiry. Something populates a large set of cache keys at the same
moment each day — a batch job, a scheduled warm-up, a deploy — all with an
identical TTL. They expire together and the resulting stampede lands as one
spike.

Confirm by correlating the spike with the cache-miss rate and with whatever runs
at 14:00 minus the TTL.

Fixes, layered: **jitter** the TTLs so expiry spreads over minutes;
**singleflight** so concurrent misses for the same key collapse;
**stale-while-revalidate** so users never wait on a refresh; and refresh
proactively before expiry rather than reactively after.
</details>

<details>
<summary><b>2.</b> Singleflight works per process. You have 50 replicas. What now?</summary>

Singleflight reduces 50,000 concurrent misses to 50 — already a 1000× win, and
for most systems that is enough. Ship it first and measure.

If 50 is still too many (a genuinely expensive query, a fragile database):

- **Distributed lock**: `SET lock:{key} {id} NX PX 5000`. The winner recomputes;
  the losers either wait briefly and re-read, or serve stale. Must have a TTL, or
  a crashed holder blocks forever.
- **Stale-while-revalidate**: keep two TTLs — a soft one (refresh) and a hard one
  (expire). Past the soft TTL, one instance refreshes in the background while
  everyone else keeps getting the stale value instantly.
- **Proactive refresh**: a background job keeps hot keys warm so they never
  expire under traffic at all.

The last is the most robust for a small set of known-hot keys.
</details>

<details>
<summary><b>3.</b> What is cache penetration and why is it a security issue?</summary>

Requests for keys that exist nowhere. Each one misses the cache, queries the
database, finds nothing, and caches nothing — so the cache provides zero
protection and every request reaches the database.

It becomes a security issue because it's a **cheap amplification attack**: an
attacker requests `/users/{random}` at high rate, bypasses your entire caching
layer by construction, and turns a service designed for 100 database QPS into
one receiving 10,000.

Defences: negative caching with a short TTL; a **Bloom filter** of valid ids in
front of the cache (constant time, a few MB, and "definitely not present" is
exactly the answer you need); input validation rejecting impossible id formats
before any lookup; and rate limiting per client (Capsule 17).
</details>

<details>
<summary><b>4.</b> Compare TTL-only, explicit invalidation, and versioned keys.</summary>

**TTL-only** — dead simple, no coordination, always eventually correct, always
possibly stale up to the TTL. Correct choice when bounded staleness is
acceptable, which is more often than people think.

**Explicit invalidation** — fresh immediately, but only if you find every write
path. You won't: batch jobs, admin tools, migrations, another team's service and
manual SQL all bypass your invalidation code. It's also racy — a reader can
repopulate a stale value between the DB write and the delete.

**Versioned keys** (`user:{id}:v{n}`) — bump the version on write; old entries
become unreachable and expire on their own. No deletes, no race, and it works
across multiple caches and CDN layers simultaneously. The cost is storing the
version somewhere fast, and temporarily holding both generations in memory.

Real systems combine them: versioned keys with a TTL backstop, plus event-driven
invalidation (CDC, Capsule 21) to catch writers you don't control.
</details>

<details>
<summary><b>5.</b> Design caching for a live sports scoreboard: 1M concurrent viewers, scores update every ~30 s.</summary>

The shape of this problem is *one hot key, enormous read fan-out, tiny write
rate* — so almost everything should be solved at the edge, not in Redis.

- **CDN with a 5-second TTL and `stale-while-revalidate`.** 1M viewers become a
  handful of origin requests. This does 99.9% of the work.
- **In-process cache (1 s)** on each origin instance, so even CDN revalidations
  rarely reach Redis.
- **Redis** as the shared source for the rendered payload; updated by the
  ingestion path on score change, not recomputed on read.
- **Push, don't poll**, for the last mile: WebSocket/SSE fan-out means viewers
  aren't generating request load at all. (Then your scaling problem becomes
  connection count, which is a different and more pleasant problem.)
- **Singleflight + a distributed lock** on the origin so a CDN cache flush during
  a big moment doesn't stampede.
- **Precompute on write.** A score change is rare; recomputing the payload once
  per change and pushing it is far cheaper than computing it per read.

Staleness budget: 5 seconds is fine for a scoreboard and should be stated
explicitly — and shown in the UI.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Singleflight has no effect | You're calling `Do` with a key that varies per request, or after the cache write rather than around the load. The key must be the *cache key*. |
| `shared` is always false | Requests aren't actually concurrent, or each has a unique key. Fire them in parallel. |
| Negative cache hides new records | Expected — that's the TTL. Invalidate the key on create, and keep the negative TTL short. |
| Ring distribution is lumpy | Too few virtual nodes. 150 per physical node is the usual figure. |
| `OBJECT FREQ` errors | Requires `maxmemory-policy allkeys-lfu`. Use `OBJECT IDLETIME` under LRU. |
| Local cache serves stale forever | You stored the entry but never compared `expires`. Check the branch. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(cache): singleflight, negative caching, hot-key absorption

Capsule 15. Reproduced a 200-query stampede and collapsed it to 1 with
singleflight. Negative caching closes the penetration path. 1s in-process
cache absorbs hot keys. Consistent hash ring with a test proving ~25%
remap on node loss vs ~75% for modulo."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 15
```

**Next:** [Capsule 16 · Instant Transmission — CDN & The Edge](../16-instant-transmission-cdn/README.md)
