# Capsule 12 · Seven Dragon Balls — Sharding & Partitioning

> *One wish, split into seven pieces, scattered across a planet. Each ball is
> useless alone. You need all seven together, and finding them is the entire
> plot of the series. That is sharding: the data is split on purpose, and
> putting it back together is the expensive part.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 8 | 75 min | Capsules 10–11 | Local |

---

## Why this capsule exists

Eventually one database cannot hold your data or absorb your writes. Sharding
is the answer, and it is also one of the most expensive architectural decisions
you can make — it removes cross-shard transactions, complicates every query,
and turns adding capacity into a project.

So the goal here is *judgement*, not enthusiasm: know how it works, know what it
costs, and know the four cheaper things to try first.

---

## The concept

### Partitioning vs sharding

People use these interchangeably. They aren't the same.

```
  PARTITIONING — one database, one table split into pieces.
    Postgres knows about all of them. Transactions and joins still work.
    You get: smaller indexes, fast bulk delete (DROP a partition),
             partition pruning at query time.
    You do NOT get: more write throughput. It's still one server.

  SHARDING — many databases, each holding a subset of the data.
    Nothing knows about the others. YOUR CODE routes.
    You get: horizontal write scaling, capacity beyond one machine.
    You lose: cross-shard transactions, cross-shard joins, easy resharding,
              and a great deal of operational simplicity.
```

**Partitioning is cheap and often sufficient. Sharding is a project.** Reach for
partitioning long before sharding.

### Vertical vs horizontal splits

- **Vertical partitioning** — different *columns* or *tables* to different
  places. "Users in one DB, analytics events in another." Easy, effective, and
  usually the first thing you should do.
- **Horizontal partitioning (sharding)** — the *same* table's rows split by key.
  The hard one.

### Choosing a shard key

This is the whole decision. Once chosen it is very hard to change.

| Strategy | How | Good | Bad |
|---|---|---|---|
| **Hash** | `hash(key) % N` | even distribution, no hotspots | range queries hit every shard; resharding moves nearly everything |
| **Range** | `A–M`, `N–Z`, or by date | range queries touch one shard; easy to add a shard | hotspots — recent dates and popular prefixes concentrate load |
| **Directory** | a lookup table key → shard | total flexibility, easy rebalancing | the directory is now a bottleneck and a single point of failure |
| **Geo** | by region | data residency, low latency | uneven populations |

A good shard key has three properties:

1. **High cardinality** — many distinct values. (`country` is a bad key;
   `user_id` is a good one.)
2. **Even access distribution** — no single value gets a disproportionate share
   of traffic.
3. **It appears in most queries** — otherwise every query is a scatter-gather.

**The hotspot problem is the one that bites.** Shard by `created_at` and *all*
of today's writes go to one shard while the other nine idle. Shard a social app
by `user_id` and the celebrity account with 50 million followers melts its
shard. The distribution of *data* and the distribution of *traffic* are
different things, and you must plan for both.

### Scatter-gather

A query that doesn't include the shard key must ask every shard and merge:

```
   SELECT * FROM readings ORDER BY power DESC LIMIT 10

   shard 0 ──┐
   shard 1 ──┼──► ask all N, take top 10 from each,
   shard 2 ──┤     merge, re-sort, take global top 10
   shard 3 ──┘
```

Three costs people underestimate:

- **Latency is the slowest shard, not the average.** With 10 shards you're
  effectively sampling the p99 of your backend on every request — a phenomenon
  called *tail amplification*.
- **Aggregate correctness is subtle.** Global top-10 needs top-10 from each
  shard (fine). Global *median* or `COUNT(DISTINCT)` cannot be computed from
  per-shard results at all without approximation (HyperLogLog, t-digest).
- **`OFFSET` becomes nonsense.** Page 5 globally is not page 5 of any shard.

### Consistent hashing

Naive `hash(key) % N` means changing `N` remaps almost every key. Going from 4
shards to 5 moves ~80% of your data.

**Consistent hashing** places shards and keys on a ring; adding a shard moves
only `1/N` of the keys. With **virtual nodes** (each physical shard occupying
many ring positions) the distribution stays even.

You'll meet the same algorithm again in Capsule 15 for cache clusters, where
it's what stops a node failure from invalidating your entire cache.

### The four things to do before sharding

In order. Most teams never need step 5.

1. **Index properly** (Capsule 11). A missing index looks exactly like "we need
   to shard".
2. **Cache** (Capsules 14–15). Removes read load entirely.
3. **Read replicas** (Capsule 13). Reads scale out cheaply; only writes are
   genuinely hard.
4. **Vertical scale + partitioning.** A modern Postgres on a large instance
   handles tens of thousands of writes/sec. That's a lot of business.
5. *Then* shard — or move to a database that shards for you (Spanner, Bigtable,
   Vitess, Citus).

---

## Lab

### Part A — Postgres native partitioning (the one you'll actually use)

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d
docker compose exec postgres psql -U scouter -d scouter
```

```sql
-- Range-partition readings by month. Declarative partitioning: Postgres
-- routes inserts and prunes partitions at query time automatically.
CREATE TABLE readings_p (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    fighter_id  BIGINT      NOT NULL,
    power       BIGINT      NOT NULL CHECK (power >= 0),
    recorded_at TIMESTAMPTZ NOT NULL,
    -- the partition key MUST be part of the primary key
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE readings_2026_01 PARTITION OF readings_p
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE readings_2026_02 PARTITION OF readings_p
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE readings_2026_03 PARTITION OF readings_p
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- anything outside the declared ranges is rejected on insert
CREATE TABLE readings_default PARTITION OF readings_p DEFAULT;

-- Indexes created on the parent are created on every partition.
CREATE INDEX ON readings_p (fighter_id, recorded_at DESC);

INSERT INTO readings_p (fighter_id, power, recorded_at)
SELECT (random()*1999+1)::bigint,
       (random()*10000000)::bigint,
       '2026-01-01'::timestamptz + (random() * interval '89 days')
FROM generate_series(1, 500000);

ANALYZE readings_p;
```

**Watch pruning happen:**

```sql
\timing on

-- one month: only ONE partition is scanned
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM readings_p
WHERE recorded_at >= '2026-02-01' AND recorded_at < '2026-03-01';

-- no partition key in the predicate: ALL partitions scanned
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM readings_p WHERE power > 9000000;
```

In the first plan look for `Partitions removed: 3` (or that only one child
appears). In the second, every partition appears.

**That contrast is the entire lesson of sharding**, at zero operational cost:
*queries that include the key are cheap; queries that don't touch everything.*

**And the killer feature:**

```sql
-- Deleting a month of data: instant, no dead tuples, no vacuum debt.
\timing on
DROP TABLE readings_2026_01;

-- versus what it replaces:
-- DELETE FROM readings WHERE recorded_at < '2026-02-01';   -- minutes, then vacuum
```

For time-series retention this alone justifies partitioning.

### Part B — real sharding, in your application

Two independent databases, and Go code that routes.

**Append to** `deploy/docker-compose.yml` — this is a fragment, not the whole
file. Your `scouter`, `postgres` and `redis` services stay exactly as they are:

```yaml
  shard0:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: scouter, POSTGRES_PASSWORD: kamehameha, POSTGRES_DB: scouter }
    ports: ["5433:5432"]
    volumes: ["./sql:/docker-entrypoint-initdb.d:ro"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scouter"]
      interval: 3s
      retries: 10

  shard1:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: scouter, POSTGRES_PASSWORD: kamehameha, POSTGRES_DB: scouter }
    ports: ["5434:5432"]
    volumes: ["./sql:/docker-entrypoint-initdb.d:ro"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scouter"]
      interval: 3s
      retries: 10
```

**`internal/scouter/sharded.go`**

```go
package scouter

import (
	"context"
	"hash/fnv"
	"sort"
	"sync"
)

// ShardedStore routes by fighter name. Note what this class does NOT offer:
// cross-shard transactions, cross-shard joins, or a way to reshard without
// moving data. That is the deal you sign when you shard.
type ShardedStore struct {
	shards []*PostgresStore
}

var _ Store = (*ShardedStore)(nil)

func NewShardedStore(ctx context.Context, dsns []string) (*ShardedStore, error) {
	s := &ShardedStore{}
	for _, dsn := range dsns {
		p, err := NewPostgresStore(ctx, dsn)
		if err != nil {
			return nil, err
		}
		s.shards = append(s.shards, p)
	}
	return s, nil
}

func (s *ShardedStore) Close() {
	for _, p := range s.shards {
		p.Close()
	}
}

// shardFor is naive modulo hashing: changing len(shards) remaps almost every
// key. Capsule 15 replaces this with a consistent hash ring.
func (s *ShardedStore) shardFor(key string) *PostgresStore {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	return s.shards[int(h.Sum32())%len(s.shards)]
}

// Single-shard operations: cheap. The key is in the query.
func (s *ShardedStore) Record(r Reading) { s.shardFor(r.Fighter).Record(r) }

func (s *ShardedStore) Latest(fighter string) (Reading, bool) {
	return s.shardFor(fighter).Latest(fighter)
}

// Leaderboard is a SCATTER-GATHER: no shard key, so every shard is queried.
// Correctness note: to get a global top-n you must take the top-n from EACH
// shard. Taking top-n/len(shards) each would be wrong — one shard may hold
// all the strongest fighters.
func (s *ShardedStore) Leaderboard(n int) []Reading {
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		all []Reading
	)
	for _, sh := range s.shards {
		wg.Add(1)
		go func(p *PostgresStore) {
			defer wg.Done()
			part := p.Leaderboard(n) // full n from every shard
			mu.Lock()
			all = append(all, part...)
			mu.Unlock()
		}(sh)
	}
	wg.Wait() // total latency = the SLOWEST shard, not the average

	sort.Slice(all, func(i, j int) bool { return all[i].Power > all[j].Power })
	if len(all) > n {
		all = all[:n]
	}
	return all
}
```

Wire it up in `main.go`, keyed off an env var so you can switch back:

```go
	var store scouter.Store
	if dsns := os.Getenv("SHARD_URLS"); dsns != "" {
		sharded, err := scouter.NewShardedStore(context.Background(), strings.Split(dsns, ","))
		if err != nil {
			log.Error("shards unavailable", "err", err)
			os.Exit(1)
		}
		defer sharded.Close()
		store = sharded
		log.Info("sharded store", "shards", len(strings.Split(dsns, ",")))
	} else {
		pg, err := scouter.NewPostgresStore(context.Background(), cfg.DatabaseURL)
		if err != nil {
			log.Error("database unavailable", "err", err)
			os.Exit(1)
		}
		defer pg.Close()
		store = pg
	}
	srv := scouter.NewServer(store, log)
```

Run it:

```bash
docker compose up -d shard0 shard1

SHARD_URLS="postgres://scouter:kamehameha@localhost:5433/scouter?sslmode=disable,postgres://scouter:kamehameha@localhost:5434/scouter?sslmode=disable" \
  DATABASE_URL=unused make run
```

```bash
for f in goku vegeta piccolo krillin frieza gohan trunks bulma yamcha tien; do
  curl -s -XPOST localhost:8080/readings \
    -d "{\"fighter\":\"$f\",\"power\":$((RANDOM * 100))}" > /dev/null
done

# where did each land?
for port in 5433 5434; do
  echo "--- shard on :$port ---"
  PGPASSWORD=kamehameha psql -h localhost -p $port -U scouter -d scouter \
    -c "SELECT f.name FROM fighters f JOIN readings r ON r.fighter_id=f.id ORDER BY f.name;"
done
```

Roughly half in each. Then:

```bash
curl -s localhost:8080/leaderboard | jq   # scatter-gather across both
```

### Step 3 — build a hotspot on purpose

```bash
# 500 writes to the SAME fighter — one shard takes all of it
for i in $(seq 1 500); do
  curl -s -XPOST localhost:8080/readings \
    -d '{"fighter":"goku","power":9001}' > /dev/null
done

for port in 5433 5434; do
  echo -n "shard :$port readings = "
  PGPASSWORD=kamehameha psql -h localhost -p $port -U scouter -d scouter \
    -tAc "SELECT count(*) FROM readings;"
done
```

Wildly uneven. **`fighter` was a bad shard key for this workload** — the data
was evenly distributed but the *traffic* wasn't.

Write in `NOTES.md`: *"Even data distribution does not imply even load
distribution."*

The real-world fixes: shard on a composite key
(`fighter_id + time_bucket`), add a random salt to hot keys and merge on read,
or handle celebrities on a dedicated path.

### Step 4 — feel the resharding pain (thought experiment + math)

You have 2 shards. Add a third.

```
  hash("goku") % 2 = 1   →  hash("goku") % 3 = 0    MOVED
```

Compute how much moves:

```bash
python3 - <<'PY'
import hashlib
def h(k): return int(hashlib.md5(k.encode()).hexdigest(), 16)
keys = [f"fighter_{i}" for i in range(100000)]
moved = sum(1 for k in keys if h(k) % 2 != h(k) % 3)
print(f"modulo hashing: {moved/len(keys)*100:.1f}% of keys move when 2 -> 3")
PY
```

Roughly **two thirds of your data must move**, while the system stays online,
without losing writes, with dual-write and backfill and verification and a
cutover.

That is why the shard key and shard count are decisions you make once, carefully,
and why consistent hashing (Capsule 15) exists.

```bash
docker compose down
```

---

## In GCP

| Product | Sharding model | Reach for it when |
|---|---|---|
| **Cloud SQL** | none built in — you shard in the app, as above | you're not past one primary yet |
| **Spanner** | automatic, by primary key ranges; splits and rebalances itself | you need horizontal writes **and** strong consistency, and can pay |
| **Bigtable** | automatic, by row-key ranges | huge scale, single-key access, no joins |
| **Firestore** | automatic, by document | per-user documents, realtime |
| **AlloyDB** | one primary, many read pools | reads are the problem, not writes |

**Key design in Bigtable and Spanner is the whole game**, and the rule is the
opposite of what feels natural:

```
  BAD:   rowkey = timestamp                → all writes hit the newest range.
                                             "Hotspotting on monotonic keys."
  BAD:   rowkey = user_id                  → celebrity users concentrate load
  GOOD:  rowkey = reverse(timestamp)       → spreads writes
  GOOD:  rowkey = hash(user_id) + user_id + timestamp
  GOOD:  rowkey = user_id + reverse_timestamp   (per-user time series)
```

Spanner has the same trap. Never make a monotonically increasing value the
leading column of a Spanner primary key — use a UUID, a hash prefix, or a bit-
reversed sequence.

**Cost sanity check:** Spanner starts around **$65/month** for the smallest
production unit. It is a genuinely excellent database and it is almost never the
right answer for a startup. Say that out loud in a design review.

---

## Bring it to work

- **Exhaust indexes, caching, read replicas and vertical scaling first.** Write
  down which ones you tried and what they bought you.
- **Prefer native partitioning** — most "we need to shard" problems are actually
  "this table is too big to vacuum and delete from", which partitioning solves.
- **The shard key is a one-way door.** Spend real time on it and document the
  reasoning in an ADR.
- **Plan for hotspots**, not just for even data. Model your traffic
  distribution, not your row counts.
- **Assume you'll reshard.** Use consistent hashing or many more logical shards
  than physical ones (e.g. 1024 logical shards mapped onto 4 servers — moving
  logical shards is far easier than rehashing).
- **Know which queries are scatter-gather** and keep the list short. Every one
  of them is a tail-latency amplifier.

---

## Battle drill

<details>
<summary><b>1.</b> Shard a multi-tenant SaaS app. What's your key, and what breaks?</summary>

`tenant_id` is the natural key: nearly every query is tenant-scoped, so almost
everything is single-shard, and tenant isolation comes free.

What breaks:
- **Whale tenants.** One customer with 60% of the data melts their shard. Mitigate
  by giving large tenants a dedicated shard (the directory strategy), which is
  what most real SaaS platforms end up doing.
- **Cross-tenant analytics** become scatter-gather — push those to a warehouse
  (BigQuery) instead.
- **Tenant migration** between shards is a real project you should design for on
  day one, not day 900.

The usual production answer is a **directory/lookup** rather than pure hashing,
precisely because it lets you move an individual tenant.
</details>

<details>
<summary><b>2.</b> Why can't you just <code>COUNT(DISTINCT user_id)</code> across shards?</summary>

Because a user could appear on multiple shards, and per-shard distinct counts
can't be summed — the union's cardinality isn't the sum of the parts.

Options: pull all distinct ids to one place and count (expensive, sometimes
fine); use a **HyperLogLog** sketch per shard, which *is* mergeable and gives
~2% error in kilobytes; or maintain the count incrementally as writes happen.

This generalises: **sums, counts, min and max merge trivially. Medians,
percentiles and distinct counts do not.** For those you need mergeable sketches
(t-digest, HLL) — which is exactly what monitoring systems use for the same
reason.
</details>

<details>
<summary><b>3.</b> A user transfers money to another user, on different shards. How?</summary>

You can't use a single ACID transaction — that's the cost of sharding.

- **Two-phase commit (2PC)** — correct, but it blocks: if the coordinator dies
  mid-commit, participants hold locks indefinitely. Rarely worth it.
- **Saga** — a sequence of local transactions with compensating actions.
  `debit(A)` → `credit(B)`; if credit fails, `refund(A)`. Eventually consistent,
  and each step must be idempotent (Capsule 19).
- **Transactional outbox** (Capsule 21) — the mechanism that makes sagas
  reliable: write the local change and the outgoing event in one local
  transaction, publish asynchronously.
- **Co-locate related entities.** If transfers are common within a household or
  org, shard by that entity so the common case stays single-shard.
- **Use a database that does distributed transactions** — Spanner does this
  properly, and it's the strongest argument for paying for it.
</details>

<details>
<summary><b>4.</b> How do you reshard 4 → 8 with no downtime?</summary>

The standard playbook:

1. **Dual-write.** Write to both old and new topology; read from old. Deploy and
   let it soak.
2. **Backfill** historical data to the new shards, in batches, throttled.
3. **Verify** — compare row counts and checksums per key range; fix drift.
4. **Flip reads** to the new topology behind a feature flag, gradually (1%, 10%,
   100%).
5. **Stop dual-writing**, then drop the old data.

Every step is reversible until step 5, which is the point. Weeks of work.

The cheaper approach is to have designed for it: **many logical shards, few
physical ones.** With 1024 logical shards on 4 servers, going to 8 means moving
logical shards, not rehashing keys — hours, not weeks. Do this from the
beginning.
</details>

<details>
<summary><b>5.</b> Your service scatter-gathers to 20 shards. p50 is 8 ms, p99 is 400 ms. Why is p99 so bad?</summary>

**Tail amplification.** Every request waits for the slowest of 20 responses, so
you're sampling the tail 20 times. If each shard has a 1% chance of being slow,
the probability that *at least one* is slow is `1 - 0.99²⁰ ≈ 18%`. Your p99 is
built from your shards' p95s.

Mitigations: **hedged requests** (send a duplicate to a replica after p95
elapses, take the first answer — Google showed this cuts tail latency
dramatically for a few percent extra load); **per-shard timeouts with partial
results** if the query tolerates it; reduce the fan-out (better shard key, or
cache the aggregate); or precompute the aggregate asynchronously (Capsule 20).
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `no partition of relation found for row` | The value falls outside every declared range. Add a `DEFAULT` partition, and automate partition creation ahead of time. |
| Partition key not in primary key | Postgres requires the partition key to be part of every unique constraint. Include it. |
| Partition pruning doesn't happen | The predicate must reference the partition key directly — a function or a cast on it disables pruning. |
| Sharded writes all land on one shard | Your key has low cardinality, or you hashed the wrong field. Print the shard index while debugging. |
| Scatter-gather returns wrong top-N | You took `n/shards` per shard. Take the full `n` from each and merge. |
| One shard is 10× the size | Wrong shard key, or a whale tenant. Consider a directory strategy. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(store): sharded store and native range partitioning

Capsule 12. Range-partitioned readings by month; confirmed pruning and
instant retention via DROP partition. Added app-level hash sharding across
two databases with parallel scatter-gather. Built a hotspot on purpose:
even data distribution does not imply even load."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 12
```

**Next:** [Capsule 13 · Namekian Fusion — Replication & Consistency](../13-namekian-fusion-replication/README.md)
