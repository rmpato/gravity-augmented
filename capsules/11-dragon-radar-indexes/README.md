# Capsule 11 · Dragon Radar — Indexes & Query Plans

> *Before Bulma built the radar, finding one Dragon Ball meant searching an
> entire planet. After it, you point at a screen and fly straight there. The
> balls didn't move. The search did.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 7 | 70 min | Capsule 10 | Local |

---

## Why this capsule exists

An index is the highest leverage tool you have. A query that takes 4 seconds
and one that takes 3 milliseconds are frequently *the same query* against *the
same data* — the difference is one line of DDL.

More importantly: this is where you learn to stop guessing. `EXPLAIN ANALYZE`
tells you exactly what the database did and why. Engineers who read query plans
fix performance problems in minutes; engineers who don't add caches and hope.

---

## The concept

### What a B-tree index actually is

A sorted, balanced tree of key → row-location pointers.

```
  No index:          Seq Scan — read all 10,000,000 rows, discard 9,999,999
  B-tree index:      3-4 page reads to find the row. O(log n).

  10M rows: seq scan ≈ 10,000,000 reads
            index    ≈ 4 reads
```

Consequences that follow directly from "it's sorted":

- **Equality and range both work** (`=`, `<`, `>`, `BETWEEN`) — the tree is
  ordered.
- **`ORDER BY` can be free** if it matches the index order. The rows come out
  sorted already; no sort step at all.
- **Prefix matching works** (`LIKE 'goku%'`), suffix matching does not
  (`LIKE '%goku'`) — sorting by the start of a string tells you nothing about
  its end.
- **Writes get slower.** Every `INSERT`/`UPDATE`/`DELETE` must maintain every
  index on the table. Indexes are not free; they're a read/write trade.

### Composite index column order is everything

For `INDEX (a, b, c)`, think of it as sorted by `a`, then `b` within equal `a`,
then `c`. The index can serve a query only via a **left prefix**:

| Query | Uses the index? |
|---|---|
| `WHERE a = 1` | ✅ |
| `WHERE a = 1 AND b = 2` | ✅ |
| `WHERE a = 1 AND b = 2 AND c = 3` | ✅ fully |
| `WHERE b = 2` | ❌ — skips the leading column |
| `WHERE a = 1 AND c = 3` | ⚠️ uses `a` only, filters `c` |
| `WHERE a > 1 AND b = 2` | ⚠️ range on `a` stops `b` being useful |

**The rule that gets this right nearly every time:**

> **Equality columns first, then the range/sort column last.**

`WHERE fighter_id = ? ORDER BY recorded_at DESC` wants
`(fighter_id, recorded_at DESC)` — equality on `fighter_id`, ordering on
`recorded_at`. Reverse them and the database has to sort.

### Selectivity decides whether an index is used at all

An index on a column with two distinct values (`is_active`) over a million rows
is nearly useless — matching 500,000 rows via an index means 500,000 random
page reads, which is *slower* than reading the table sequentially. The planner
knows this and will correctly ignore your index.

**Rough rule:** if a query returns more than ~5–10% of a table, a sequential
scan is usually the right plan. **A "seq scan" in a plan is not automatically a
bug.**

Low-cardinality columns become useful as the *trailing* part of a composite
index, or via a **partial index**:

```sql
CREATE INDEX idx_active_fighters ON fighters (name) WHERE is_active;
```

Smaller, cheaper to maintain, and only used where it helps.

### Covering indexes and index-only scans

If an index contains every column the query needs, Postgres never touches the
table at all — an **index-only scan**.

```sql
CREATE INDEX idx_readings_cover ON readings (fighter_id, recorded_at DESC) INCLUDE (power);
```

`INCLUDE` adds `power` to the leaf pages without making it part of the sort key.
The query reads only the index. This can be a 5–10× win on a hot path.

(Caveat: Postgres needs the visibility map to be current for index-only scans,
so a table that hasn't been vacuumed recently may still visit the heap.)

### Pagination: OFFSET is a trap

```sql
SELECT * FROM readings ORDER BY id LIMIT 20 OFFSET 100000;
```

To skip 100,000 rows the database must **produce and discard** 100,000 rows.
Page 1 is instant; page 5,000 takes seconds. Worse, if rows are inserted while
a user pages, they see duplicates and skips.

**Keyset (cursor) pagination** fixes both:

```sql
SELECT * FROM readings
WHERE (recorded_at, id) < ($1, $2)     -- the last row of the previous page
ORDER BY recorded_at DESC, id DESC
LIMIT 20;
```

Constant time at any depth, and stable under concurrent writes. The trade-off is
that you can't jump to "page 500" — which is fine, because nobody does.

> Note the tuple comparison `(recorded_at, id) < ($1, $2)`. Including a unique
> tiebreaker is what makes it correct when timestamps collide.

### Reading `EXPLAIN ANALYZE`

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

- **`EXPLAIN`** = the planner's estimate. **`EXPLAIN ANALYZE`** = actually runs
  it and reports reality. Always use ANALYZE (careful: it really does execute
  writes, so wrap those in a transaction you roll back).
- **`BUFFERS`** shows how many pages came from cache vs disk — often the real
  story.

Node types, worst to best for a single-row lookup:

| Node | Means |
|---|---|
| `Seq Scan` | reading the whole table. Fine for small tables or big result sets |
| `Bitmap Heap Scan` | index found many rows; fetching them in page order |
| `Index Scan` | walking the index, fetching rows |
| `Index Only Scan` | never touched the table. Best |

Joins:

| Node | Good when |
|---|---|
| `Nested Loop` | one side is tiny; the other has an index on the join key |
| `Hash Join` | both sides are large; builds a hash of the smaller |
| `Merge Join` | both inputs are already sorted on the join key |

**The single most important thing to check:** `rows=X` (estimated) versus
`actual rows=Y`. If the planner thinks 10 and reality is 100,000, it chose a bad
plan *based on bad statistics* — and the fix is `ANALYZE`, not a new index.

---

## Lab

Bring the stack up and load enough data that the difference is visible.

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d
```

### Step 1 — a table big enough to be honest

```bash
docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
-- 2000 fighters
INSERT INTO fighters (name, race)
SELECT 'f_' || g, (ARRAY['saiyan','human','namekian','android'])[1 + g % 4]
FROM generate_series(1, 2000) g
ON CONFLICT DO NOTHING;

-- 2 million readings
INSERT INTO readings (fighter_id, power, recorded_at)
SELECT (random() * 1999 + 1)::bigint,
       (random() * 10000000)::bigint,
       now() - (random() * interval '365 days')
FROM generate_series(1, 2000000);

ANALYZE;
SELECT count(*) FROM readings;
SQL
```

Open a psql session and keep it open:

```bash
docker compose exec postgres psql -U scouter -d scouter
```

```sql
\timing on
```

### Step 2 — life without an index

```sql
DROP INDEX IF EXISTS idx_readings_fighter_time;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM readings WHERE fighter_id = 42 ORDER BY recorded_at DESC LIMIT 10;
```

Look for:
- `Parallel Seq Scan on readings` under a `Gather Merge` — Postgres splits the
  scan across worker processes, and between them they read all 2 million rows
  (`Rows Removed by Filter` is per worker, so it shows about a third of that)
- a `Sort` node with a real cost
- `Buffers: shared hit=…` — about 14,700 pages, the whole table (`hit` means
  they were already in memory; right after a restart you'll see `read=` instead)
- `Execution Time:` — tens of milliseconds; about 30 ms on a recent laptop

Write it down.

### Step 3 — the index, and the right column order

```sql
CREATE INDEX idx_readings_fighter_time ON readings (fighter_id, recorded_at DESC);
ANALYZE readings;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM readings WHERE fighter_id = 42 ORDER BY recorded_at DESC LIMIT 10;
```

Now you should see `Index Scan using idx_readings_fighter_time`, **no Sort node
at all**, a handful of buffers, and sub-millisecond execution.

The gap widens as the table grows — a sequential scan is O(n) while the index
lookup is not, so on a small table it might be 10×, and here it is far more.
Measured on these 2 million rows: 29 ms → 0.040 ms, roughly **700×**. From one
line of DDL.

**Now prove that column order matters.** Build the reversed index and force its use:

```sql
CREATE INDEX idx_wrong_order ON readings (recorded_at DESC, fighter_id);

-- ask the planner to compare, by disabling the good one temporarily
BEGIN;
DROP INDEX idx_readings_fighter_time;
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM readings WHERE fighter_id = 42 ORDER BY recorded_at DESC LIMIT 10;
ROLLBACK;
```

With `(recorded_at, fighter_id)` the database walks the index in *time* order
and checks `fighter_id = 42` at every entry, touching far more of the index than
it returns.

**Read the `Buffers` line, not the row counts.** On Postgres 16 both plans say
`Index Scan` and both say `Index Cond: (fighter_id = 42)` — there is no
`Rows Removed by Filter` to point at, because the check happens inside the index
rather than against the heap. The work still happened; it just isn't reported as
a filter. Measured on 2 million rows (second run of each, so everything is a
cache hit):

| Index | Estimated cost | Buffers | Time |
|---|---|---|---|
| `(fighter_id, recorded_at DESC)` — right | 39 | **13** | 0.040 ms |
| `(recorded_at DESC, fighter_id)` — wrong | 499 | **83** | 0.148 ms |
| no usable index | 26132 | **14,780** | 29 ms |

Over 6× the buffers for the same ten rows. Your exact numbers will differ — the
data is random — but the shape won't. This is the general lesson: when
two plans look structurally identical, `BUFFERS` is what tells them apart —
which is why `EXPLAIN (ANALYZE, BUFFERS)` should be your default, not
`EXPLAIN ANALYZE`.

```sql
DROP INDEX idx_wrong_order;
```

### Step 4 — when the planner correctly ignores your index

```sql
CREATE INDEX idx_readings_power ON readings (power);
ANALYZE readings;

-- highly selective: uses the index
EXPLAIN ANALYZE SELECT count(*) FROM readings WHERE power > 9999000;

-- not selective: ignores it, and is right to
EXPLAIN ANALYZE SELECT count(*) FROM readings WHERE power > 1000;
```

The second matches **99.99%** of the table: `power` is spread evenly from 0 to
10,000,000, so only about one row in 10,000 is 1000 or below. Reading the whole
table front to back is cheaper than walking 2 million index entries and then
going back to the table for each one. **The planner is not being stupid — you
are seeing selectivity in action.**

Prove it to yourself:

```sql
SET enable_seqscan = off;     -- session only, a diagnostic tool, never production
EXPLAIN ANALYZE SELECT count(*) FROM readings WHERE power > 1000;
SET enable_seqscan = on;
```

Forcing the index makes it *slower*. Note both numbers. Which plan you get
depends on whether autovacuum has visited the table since the bulk load. If it
has, Postgres can answer `count(*)` from the index alone (`Index Only Scan`,
`Heap Fetches: 0`) and the loss is small — 76 ms against 68 ms for the seq scan,
measured. If it hasn't, you get a `Bitmap Heap Scan` that visits the table
anyway — 180 ms against 72 ms. Either way, not faster.

```sql
DROP INDEX idx_readings_power;
```

### Step 5 — an index-only scan

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT recorded_at, power FROM readings WHERE fighter_id = 42
ORDER BY recorded_at DESC LIMIT 10;
-- Index Scan + heap fetches

CREATE INDEX idx_readings_cover ON readings (fighter_id, recorded_at DESC) INCLUDE (power);
ANALYZE readings;

EXPLAIN (ANALYZE, BUFFERS)
SELECT recorded_at, power FROM readings WHERE fighter_id = 42
ORDER BY recorded_at DESC LIMIT 10;
-- Index Only Scan, Heap Fetches: 0
```

Compare the `Buffers:` lines. The covering index removed the table access
entirely.

### Step 6 — OFFSET vs keyset, at depth

```sql
\timing on

-- page 1: fast
SELECT id, recorded_at FROM readings ORDER BY recorded_at DESC, id DESC LIMIT 20 OFFSET 0;

-- page 25,000: painful
SELECT id, recorded_at FROM readings ORDER BY recorded_at DESC, id DESC LIMIT 20 OFFSET 500000;
```

Now the keyset version. Take the last row from a page and use it as the cursor:

```sql
CREATE INDEX idx_readings_keyset ON readings (recorded_at DESC, id DESC);
ANALYZE readings;

SELECT id, recorded_at FROM readings
WHERE (recorded_at, id) < ('2026-01-15 00:00:00+00', 999999999)
ORDER BY recorded_at DESC, id DESC
LIMIT 20;
```

**Constant time at any depth.** Run it with a cursor from "page 1" and from
"page 25,000" — the timings are identical. That's the whole point.

### Step 7 — find the slow queries automatically

```bash
docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
```

(Full setup needs `shared_preload_libraries`, so it may not activate in this
container — the point is knowing the tool exists.)

The query you will actually use in production:

```sql
SELECT
    round(total_exec_time::numeric, 1) AS total_ms,
    calls,
    round(mean_exec_time::numeric, 2)  AS mean_ms,
    left(query, 90)                    AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

**Order by `total_exec_time`, not `mean_exec_time`.** A 5 ms query called
500,000 times costs far more than a 2-second query called twice — and it's the
one worth fixing.

Also learn the "unused index" query, because unused indexes cost writes forever:

```sql
SELECT schemaname, relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan < 50
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Step 8 — measure the write cost

```sql
DROP INDEX IF EXISTS idx_readings_cover;
DROP INDEX IF EXISTS idx_readings_keyset;

\timing on
INSERT INTO readings (fighter_id, power, recorded_at)
SELECT (random()*1999+1)::bigint, (random()*1000000)::bigint, now()
FROM generate_series(1, 100000);
-- note the time

CREATE INDEX idx_readings_cover  ON readings (fighter_id, recorded_at DESC) INCLUDE (power);
CREATE INDEX idx_readings_keyset ON readings (recorded_at DESC, id DESC);
CREATE INDEX idx_readings_power  ON readings (power);

INSERT INTO readings (fighter_id, power, recorded_at)
SELECT (random()*1999+1)::bigint, (random()*1000000)::bigint, now()
FROM generate_series(1, 100000);
-- note the time again
```

Measurably slower. **That's the read/write trade, in your own numbers.** Every
index you add taxes every write forever.

```sql
\q
```

```bash
docker compose down
```

---

## In GCP

- **Cloud SQL Query Insights** is `pg_stat_statements` with a UI, plus per-query
  plans and a load-by-query breakdown. Free, on by default, and the first place
  to look when Postgres is slow.
- **`CREATE INDEX CONCURRENTLY`** — in production, always. A plain
  `CREATE INDEX` takes an `ACCESS EXCLUSIVE`-adjacent lock that blocks writes
  for the duration; on a large table that's an outage. `CONCURRENTLY` is slower
  and can't run inside a transaction, and it can leave an `INVALID` index if it
  fails (drop and retry) — accept all of that.
- **Autovacuum keeps statistics fresh.** If plans go bad after a bulk load, run
  `ANALYZE` manually; the planner is only as good as its statistics.
- **Bigtable / Firestore have no query planner.** You design the key and the
  access pattern *is* the schema. That's Capsule 12's subject, and it's why
  people underestimate how much a relational planner does for them.

---

## Bring it to work

- **`EXPLAIN ANALYZE` before adding an index.** Then again after. Numbers, not
  hope.
- **Equality columns first, range/sort column last.**
- **Check estimated vs actual rows.** A big gap means stale statistics, and no
  index will fix that.
- **Keyset pagination for anything deep or infinite-scrolling.**
- **Order `pg_stat_statements` by total time**, not mean.
- **Audit unused indexes quarterly.** They cost every write and buy nothing.
- **`CREATE INDEX CONCURRENTLY` in production. Always.**
- **A Seq Scan is not automatically a bug.** On a small table or a broad query
  it's the correct plan.

---

## Battle drill

<details>
<summary><b>1.</b> You have <code>INDEX (tenant_id, created_at)</code>. Which of these use it, and how?</summary>

```sql
a) WHERE tenant_id = 5
b) WHERE tenant_id = 5 AND created_at > now() - interval '1 day'
c) WHERE created_at > now() - interval '1 day'
d) WHERE tenant_id = 5 ORDER BY created_at DESC
```

- **(a)** Yes — leading column, index scan.
- **(b)** Yes, fully — equality then range is the ideal shape.
- **(c)** No. It skips the leading column, so the left prefix is unusable. Seq
  scan (or a much more expensive bitmap scan on some other index).
- **(d)** Yes, and this is the best case: the index provides both the filter and
  the ordering, so **no Sort node** appears at all.

For (c) you'd need a separate index on `(created_at)`, and you should ask
whether that query should exist — a cross-tenant scan is usually a design smell.
</details>

<details>
<summary><b>2.</b> A query got slow overnight. No code changed, no data volume change. What happened?</summary>

Most likely **stale statistics** causing a plan flip. A bulk load or a big
delete changed the data distribution; the planner's estimates no longer match
reality, so it switched from a nested loop to a hash join (or vice versa) and
picked badly.

Diagnose: `EXPLAIN ANALYZE` and compare `rows=` to `actual rows=`. A 100×
discrepancy is the signature.

Fix: `ANALYZE table`. If it recurs, raise `default_statistics_target` for the
skewed column, or add extended statistics (`CREATE STATISTICS`) for correlated
columns.

Other candidates: an index got bloated or was dropped; autovacuum fell behind;
a parameter-sniffing issue with a prepared statement; or someone changed
`work_mem` and a sort now spills to disk.
</details>

<details>
<summary><b>3.</b> When would you deliberately NOT add an index that would speed up a query?</summary>

- **The table is write-heavy** and the query is rare. You'd tax millions of
  writes to speed up a report someone runs twice a week.
- **Low selectivity** — the planner would ignore it anyway.
- **A prefix of an existing composite index already covers it.**
  `(a, b)` already serves `WHERE a = ?`; a separate index on `(a)` is pure cost.
- **Index size vs available RAM.** An index that doesn't fit in memory can be
  slower than a sequential scan of a table that does.
- **The query should be fixed instead** — an N+1, a missing `LIMIT`, or a
  `SELECT *` pulling a 2 MB JSONB column it never uses.
</details>

<details>
<summary><b>4.</b> Explain to a product manager why "go to page 500" got removed.</summary>

`OFFSET 10000` makes the database generate and throw away 10,000 rows before
returning 20. Deep pages get linearly slower, so page 500 might take 4 seconds
while page 1 takes 4 milliseconds — and those slow queries hold connections that
everyone else is waiting for.

There's a correctness problem too: with rows being inserted while someone pages,
offsets shift, so users see duplicates and miss items.

The replacement — "load more" / infinite scroll with a cursor — is constant time
at any depth and stable under writes. And the data backs it up: almost nobody
goes past page 3; the people who do are usually looking for something specific
and are better served by search or a filter.
</details>

<details>
<summary><b>5.</b> `EXPLAIN` says 12 ms but production says 800 ms. Where's the difference?</summary>

- **Cold cache.** `EXPLAIN ANALYZE` on a warm buffer pool reads from RAM;
  production may read from disk. `BUFFERS` shows `shared hit` vs `shared read` —
  that's the tell.
- **Network round trips.** 12 ms of database time plus 50 round trips of client
  latency (Capsule 10's N+1).
- **Concurrency.** Under load there's lock contention, CPU queueing and the
  latency knee (Capsule 09) — none of which appear in a single quiet EXPLAIN.
- **Different parameters.** You explained `tenant_id = 5` (100 rows); production
  runs `tenant_id = 1` (5 million rows).
- **Connection pool wait time**, which is in the request but not in the query.
- **Result set size.** 12 ms to compute, 800 ms to serialise and transfer 40 MB.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Index created but unused | Check selectivity, column order, and whether a function/cast on the column disables it (`WHERE lower(name) = …` needs an index on `lower(name)`). |
| `EXPLAIN ANALYZE` on an INSERT modified data | It really executes. Wrap in `BEGIN; … ROLLBACK;`. |
| Timings vary wildly between runs | Buffer cache. Run each query twice and use the second, or read `BUFFERS`. |
| `CREATE INDEX` hangs | It's waiting on a lock. `SELECT * FROM pg_locks` — and use `CONCURRENTLY`. |
| Plan ignores an obviously good index | Run `ANALYZE`. Then check estimated vs actual rows. |
| `pg_stat_statements` is empty | Needs `shared_preload_libraries = 'pg_stat_statements'` and a restart. Cloud SQL enables it via a flag. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(db): composite and covering indexes, keyset pagination

Capsule 11. (fighter_id, recorded_at DESC) took the hot lookup from ~30ms
seq scan to sub-ms index scan with no sort. Measured the reversed column
order and the write cost of extra indexes. Replaced OFFSET with keyset."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 11
```

**Next:** [Capsule 12 · Seven Dragon Balls — Sharding & Partitioning](../12-seven-dragon-balls-sharding/README.md)
