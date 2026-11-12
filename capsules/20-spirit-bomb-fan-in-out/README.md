# Capsule 20 · Spirit Bomb — Fan-in, Fan-out & Batch

> *Goku raises his hands and asks every living thing for a little energy. No
> single contribution matters. The aggregate destroys Kid Buu. It also takes a
> very long time to charge, which is the entire trade-off of batch processing.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 8 | 80 min | Capsules 18–19 | Local + ☁️ optional |

---

## Why this capsule exists

You have events flowing. Now you have to *aggregate* them — leaderboards, daily
totals, per-fighter statistics, analytics.

Doing that naively (recompute on every read) doesn't scale; doing it wrong
(recompute on every write) doesn't either. This capsule is about the three
shapes of aggregation work, and the single most important question in data
engineering: **do you compute at write time or at read time?**

---

## The concept

### Fan-out and fan-in

```
  FAN-OUT (one → many)              FAN-IN (many → one)

    event ─┬→ ranker                  worker ─┐
           ├→ notifier                worker ─┼→ aggregate → result
           ├→ indexer                 worker ─┘
           └→ analytics
    parallelism, decoupling          aggregation, summarisation
```

**Fan-out-on-write vs fan-out-on-read** is the classic timeline problem:

| | On write | On read |
|---|---|---|
| Post arrives | push into every follower's feed | store once |
| Reading a feed | it's already built — fast | gather from everyone you follow — slow |
| Cost | proportional to followers | proportional to reads |
| Celebrity with 50M followers | 50M writes for one post | fine |
| Inactive users | you built feeds nobody reads | free |

Real systems (Twitter's is the famously documented case) use **both**: fan-out
on write for normal users, fan-out on read for celebrities, merged at read time.
The lesson generalises — **the right answer is usually hybrid, chosen by the
shape of the distribution.**

### Batch vs stream

| | Batch | Stream |
|---|---|---|
| Processes | a bounded set (yesterday's data) | an unbounded flow |
| Latency | minutes to hours | seconds |
| Reprocessing | trivial — run it again | hard — needs replay |
| Correctness | easy; all the data is there | hard; data arrives late and out of order |
| Cost | low; runs on a schedule | higher; always on |

**Batch is underrated.** If the business needs a daily number, computing it once
a day is simpler, cheaper, easier to test and easier to fix than a streaming
pipeline maintaining it continuously.

> **Ask "what latency does this actually need?"** The answer is very often
> "by 9am tomorrow", and that's a cron job, not Dataflow.

### Windowing

Streams are infinite, so aggregation needs a window:

```
  TUMBLING (fixed, non-overlapping)     [0-5)[5-10)[10-15)
    "requests per 5 minutes"

  SLIDING (fixed, overlapping)          [0-10)[5-15)[10-20)
    "average over the last 10 min, updated every 5"

  SESSION (activity-gapped)             [user active][gap][user active]
    "one browsing session"
```

**Event time vs processing time** is where it gets hard. A mobile client offline
for an hour uploads events with old timestamps. Which window do they belong to?

- **Event time** — correct, but you must decide how long to wait for stragglers.
- **Processing time** — simple, and wrong at every boundary.

**Watermarks** are the answer: a moving estimate of "we've probably seen
everything up to time T". Past the watermark the window closes; anything later
is *late data*, handled by dropping it, or emitting a correction, or writing it
to a side output. Every serious stream processor (Dataflow/Beam, Flink) is built
around this.

### Batching for throughput

The single most effective consumer optimisation:

```
  1000 messages, one INSERT each:   1000 round trips  ≈ 2000 ms
  1000 messages, one batched INSERT:   1 round trip   ≈    15 ms
```

Batch on **size or time, whichever comes first** — `flush when 500 messages OR
200ms elapsed`. Size alone stalls at low traffic; time alone doesn't help under
load.

The trade-off is that a crash loses the un-flushed batch, so either the work must
be idempotent and replayable from unacked messages (Capsule 19) or the batch size
must be small enough that the loss is acceptable.

### OLTP vs OLAP — different systems on purpose

| | OLTP (Postgres) | OLAP (BigQuery) |
|---|---|---|
| Shape | many small reads/writes by key | few huge scans and aggregations |
| Storage | row-oriented | **column-oriented** |
| `SELECT sum(x) FROM t` over 1B rows | minutes, and it hurts everyone else | seconds |

Column storage is the reason: an aggregate over one column reads only that
column's data, and columnar data compresses far better because neighbouring
values are similar.

**Never run analytics on your production database.** A single unbounded
aggregation query will saturate I/O and degrade every user-facing request.
Replicate to a warehouse and query there.

---

## Lab

### Step 1 — batch inserts in the consumer

Rewrite the ranker to accumulate and flush.

**`internal/events/batcher.go`**

```go
package events

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Batcher accumulates items and flushes on SIZE or TIME, whichever comes
// first. Size alone stalls at low traffic; time alone doesn't help under load.
type Batcher[T any] struct {
	mu      sync.Mutex
	items   []T
	maxSize int
	maxWait time.Duration
	flush   func(context.Context, []T) error
	log     *slog.Logger

	timer *time.Timer
	done  chan struct{}
}

func NewBatcher[T any](maxSize int, maxWait time.Duration,
	flush func(context.Context, []T) error, log *slog.Logger) *Batcher[T] {
	b := &Batcher[T]{
		items:   make([]T, 0, maxSize),
		maxSize: maxSize,
		maxWait: maxWait,
		flush:   flush,
		log:     log,
		done:    make(chan struct{}),
	}
	go b.ticker()
	return b
}

func (b *Batcher[T]) Add(ctx context.Context, item T) error {
	b.mu.Lock()
	b.items = append(b.items, item)
	full := len(b.items) >= b.maxSize
	b.mu.Unlock()

	if full {
		return b.Flush(ctx)
	}
	return nil
}

func (b *Batcher[T]) Flush(ctx context.Context) error {
	b.mu.Lock()
	if len(b.items) == 0 {
		b.mu.Unlock()
		return nil
	}
	batch := b.items
	b.items = make([]T, 0, b.maxSize)
	b.mu.Unlock()

	start := time.Now()
	err := b.flush(ctx, batch)
	b.log.Info("batch flushed",
		"size", len(batch), "duration_ms", time.Since(start).Milliseconds(), "err", err)
	return err
}

func (b *Batcher[T]) ticker() {
	t := time.NewTicker(b.maxWait)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			_ = b.Flush(context.Background())
		case <-b.done:
			return
		}
	}
}

// Close flushes whatever is pending. Call it on SIGTERM (Capsule 01) or you
// silently lose the last partial batch on every deploy.
func (b *Batcher[T]) Close(ctx context.Context) error {
	close(b.done)
	return b.Flush(ctx)
}
```

The batched flush — one statement, many rows:

```go
func (r *Ranker) FlushBatch(ctx context.Context, events []PowerRecorded) error {
	if len(events) == 0 {
		return nil
	}

	rows := make([][]any, 0, len(events))
	for _, e := range events {
		rows = append(rows, []any{e.EventID, e.Fighter, e.Power, e.RecordedAt})
	}

	// pgx CopyFrom uses the Postgres COPY protocol: dramatically faster than
	// INSERT for bulk loads. The trade-off is that it cannot do ON CONFLICT,
	// so bulk-load into a temp table and merge if you need upsert semantics.
	_, err := r.pool.CopyFrom(ctx,
		pgx.Identifier{"reading_events"},
		[]string{"event_id", "fighter", "power", "recorded_at"},
		pgx.CopyFromRows(rows))
	return err
}
```

Nothing earlier in the course creates the table it copies into. Create it in
`psql` before you run the consumer, or every flush fails with
`relation "reading_events" does not exist`:

```sql
-- The append-only landing table FlushBatch copies into. No primary key on
-- purpose: COPY cannot skip conflicts, so one redelivered event would fail
-- the whole batch. Dedupe downstream, or merge through a temp table.
CREATE TABLE reading_events (
    event_id    UUID        NOT NULL,
    fighter     TEXT        NOT NULL,
    power       BIGINT      NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL
);
```

Measure it — this is the number that convinces people:

```bash
# publish 5000 events
for i in $(seq 1 5000); do
  EVENT="{\"event_id\":\"$(uuidgen)\",\"fighter\":\"f_$((RANDOM % 100))\",\"power\":$RANDOM}"
  printf '%s' "$EVENT" | base64
done | while read -r b64; do
  curl -s -XPOST "http://localhost:8085/v1/projects/gravity-chamber/topics/power-readings:publish" \
    -H 'Content-Type: application/json' -d "{\"messages\":[{\"data\":\"$b64\"}]}" >/dev/null
done
```

Compare consumer throughput with `maxSize=1` (per-message) versus `maxSize=500`.
Expect **10–50×**. It is the cheapest performance win in this entire repo.

### Step 2 — a tumbling window aggregator

```go
// WindowAggregator keeps per-minute totals in memory and emits closed windows.
//
// The lateness allowance is the whole design decision: too short and you drop
// legitimate late data, too long and results are stale. It is a correctness
// vs freshness dial, and it should be a product conversation.
type WindowAggregator struct {
	mu       sync.Mutex
	windows  map[int64]map[string]int64 // windowStart -> fighter -> total
	size     time.Duration
	lateness time.Duration
	emit     func(windowStart time.Time, totals map[string]int64)
}

func (w *WindowAggregator) Add(e PowerRecorded) {
	// EVENT time, not processing time. This is what makes replay correct.
	bucket := e.RecordedAt.Truncate(w.size).Unix()

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.windows[bucket] == nil {
		w.windows[bucket] = make(map[string]int64)
	}
	w.windows[bucket][e.Fighter] += e.Power
}

// CloseExpired emits windows whose watermark has passed.
func (w *WindowAggregator) CloseExpired(now time.Time) {
	cutoff := now.Add(-w.lateness).Truncate(w.size).Unix()

	w.mu.Lock()
	defer w.mu.Unlock()
	for start, totals := range w.windows {
		if start < cutoff {
			w.emit(time.Unix(start, 0), totals)
			delete(w.windows, start) // bound the memory. Always.
		}
	}
}
```

Now demonstrate late data:

```bash
# an event with a timestamp from 10 minutes ago
LATE="{\"event_id\":\"$(uuidgen)\",\"fighter\":\"goku\",\"power\":9001,\"recorded_at\":\"$(date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)\"}"
```

With a 2-minute lateness allowance, that window has already closed. Your options
are: drop it (and log it — silently dropping data is how you get numbers nobody
trusts), emit a correction, or send it to a side output for reprocessing.
**Pick one deliberately.**

### Step 3 — fan-out on write vs on read

The leaderboard, two ways.

**On read** (what you have): query, sort, aggregate. Cost per read.

**On write**: maintain a Redis sorted set as events arrive.

```go
// Fan-out on write: the ranking is maintained incrementally, so a read is
// a single O(log n + m) ZREVRANGE instead of a scan-and-sort.
func (r *Ranker) HandleFanoutOnWrite(ctx context.Context, e PowerRecorded) error {
	// ZADD with GT: only update if the new score is GREATER.
	// This makes it idempotent AND order-independent for a "highest power"
	// leaderboard — Capsule 19's version check, expressed as a Redis flag.
	return r.rdb.ZAddGT(ctx, "leaderboard:live", redis.Z{
		Score:  float64(e.Power),
		Member: e.Fighter,
	}).Err()
}
```

Benchmark both under read load:

```bash
k6 run --vus 100 --duration 30s scripts/load/leaderboard.js
```

| | p50 | p99 | DB queries/s |
|---|---|---|---|
| on read | | | |
| on write | | | |

The write path got slightly slower; the read path got dramatically faster.
**That is the trade you're making, and you should be able to state it in those
terms.**

### Step 4 — a scheduled batch job

The thing people reach for a stream processor to avoid, done in 40 lines.

**`cmd/dailyroll/main.go`**

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// dailyroll computes yesterday's per-fighter aggregates.
//
// This is a batch job on a schedule, and for a daily number that is almost
// always the right architecture: simple, cheap, trivially re-runnable, and
// easy to test. Reach for streaming when the latency requirement demands it,
// not because streaming sounds more modern.
func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	day := time.Now().UTC().AddDate(0, 0, -1).Truncate(24 * time.Hour)
	if v := os.Getenv("DAY"); v != "" { // re-runnable for a specific day
		if d, err := time.Parse("2006-01-02", v); err == nil {
			day = d
		}
	}

	start := time.Now()
	// IDEMPOTENT: re-running for the same day overwrites rather than
	// duplicating. A batch job you cannot safely re-run is a batch job you
	// will be afraid of at 3am.
	tag, err := pool.Exec(ctx, `
		INSERT INTO daily_fighter_stats
		    (day, fighter, reading_count, max_power, avg_power)
		SELECT $1::date, f.name, count(*), max(r.power), avg(r.power)::bigint
		FROM readings r
		JOIN fighters f ON f.id = r.fighter_id
		WHERE r.recorded_at >= $1 AND r.recorded_at < $1::date + interval '1 day'
		GROUP BY f.name
		ON CONFLICT (day, fighter) DO UPDATE
		SET reading_count = EXCLUDED.reading_count,
		    max_power     = EXCLUDED.max_power,
		    avg_power     = EXCLUDED.avg_power`,
		day)
	if err != nil {
		log.Error("rollup failed", "day", day, "err", err)
		os.Exit(1)
	}

	log.Info("rollup complete",
		"day", day.Format("2006-01-02"),
		"rows", tag.RowsAffected(),
		"duration_ms", time.Since(start).Milliseconds())
}
```

```sql
CREATE TABLE daily_fighter_stats (
    day           DATE   NOT NULL,
    fighter       TEXT   NOT NULL,
    reading_count INT    NOT NULL,
    max_power     BIGINT NOT NULL,
    avg_power     BIGINT NOT NULL,
    PRIMARY KEY (day, fighter)
);
```

```bash
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" \
  go run ./cmd/dailyroll

# run it again — same result, no duplicates. That's the property that matters.
```

Now compare the cost:

```sql
\timing on
-- on the fly, every time someone asks
SELECT f.name, count(*), max(r.power) FROM readings r
JOIN fighters f ON f.id = r.fighter_id
WHERE r.recorded_at >= CURRENT_DATE - 1 GROUP BY f.name;

-- precomputed
SELECT * FROM daily_fighter_stats WHERE day = CURRENT_DATE - 1;
```

---

## In GCP

> ### ☁️ Optional: BigQuery
> **Free tier: 1 TiB of queries and 10 GiB of storage per month.** This lab uses
> kilobytes.

```bash
gcloud services enable bigquery.googleapis.com
bq mk --dataset --location=US "${PROJECT_ID}:gravity"

bq mk --table \
  --time_partitioning_field=recorded_at \
  --time_partitioning_type=DAY \
  --clustering_fields=fighter \
  "${PROJECT_ID}:gravity.readings" \
  event_id:STRING,fighter:STRING,power:INT64,recorded_at:TIMESTAMP
```

**Partitioning and clustering are the entire cost model.** BigQuery bills by
bytes *scanned*:

```sql
-- scans everything. On a real table this is the query that costs $400.
SELECT fighter, sum(power) FROM gravity.readings GROUP BY fighter;

-- prunes to one partition. Same shape, a fraction of the bytes.
SELECT fighter, sum(power) FROM gravity.readings
WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-08-02'
GROUP BY fighter;
```

Always filter on the partition column. `SELECT *` is expensive in a columnar
store for the same reason — you read every column.

**Getting data in:**

- **Pub/Sub BigQuery subscription** — a subscription that writes straight to a
  table, no code at all. The best option when the event shape matches the table.
- **Storage Write API** — high throughput, exactly-once within BigQuery.
- **Batch load from Cloud Storage** — free, and the cheapest for large volumes.
- **Datastream** — managed CDC from Cloud SQL into BigQuery (Capsule 21).

**Dataflow** (managed Apache Beam) is the streaming answer: windowing,
watermarks, late data, autoscaling, and the *same* pipeline code runs in batch
or streaming mode. It's powerful and it is not cheap — a small streaming job
runs continuously and bills continuously. Reach for it when the latency
requirement genuinely demands it.

**Cloud Scheduler → Cloud Run job** is how you run `dailyroll` in production:

```bash
gcloud scheduler jobs create http daily-rollup \
  --schedule="0 2 * * *" --time-zone="UTC" \
  --uri="https://dailyroll-xyz.run.app/run" \
  --oidc-service-account-email="scheduler-sa@${PROJECT_ID}.iam.gserviceaccount.com"
```

**Teardown:** `bq rm -r -f "${PROJECT_ID}:gravity"`

---

## Bring it to work

- **Batch every high-volume consumer.** Size *or* time, and flush on shutdown.
- **Ask what latency the business actually needs** before building a stream.
  "By 9am" is a cron job.
- **Precompute what's read far more than it's written.** State the read:write
  ratio when you propose it.
- **Use event time, not processing time**, and decide your lateness allowance
  explicitly.
- **Never run analytics on the OLTP database.**
- **Partition and cluster warehouse tables**, and always filter on the partition
  column.
- **Make batch jobs idempotent and re-runnable for a specific day.** You will
  need to re-run them.
- **Bound every in-memory aggregation.** An unbounded map keyed on user id is an
  OOM with a delay.

---

## Battle drill

<details>
<summary><b>1.</b> Design a "top 10 fighters" leaderboard for 10M fighters and 100k reads/sec.</summary>

100k reads/sec against any database computing a top-10 is not viable, so the
ranking must be maintained, not computed.

- **Redis sorted set**, updated on write (`ZADD`). `ZREVRANGE 0 9` is
  O(log n + 10) and trivially cacheable.
- **Cache the rendered top-10** with a 1–5 s TTL. 100k reads/sec collapses to
  ~1 recomputation per second, and singleflight (Capsule 15) protects the
  recompute.
- **CDN it** if it's publicly readable — then it never reaches your service at
  all (Capsule 16).
- **Idempotent updates** with `ZADD GT` so replayed events don't corrupt it.
- **Rebuild path**: a batch job that recomputes the whole set from the source of
  truth, because a Redis-only ranking will drift eventually.

Note the shape: 100k reads/sec of the *same* answer is a caching problem, not a
database problem. The interesting question is the write path and how you rebuild
after divergence.
</details>

<details>
<summary><b>2.</b> Fan-out on write or on read for a social feed?</summary>

**Hybrid**, and be able to say why.

Fan-out on write for normal users: when they post, push the post id into each
follower's feed list. Reads are then a single range query. Cost is proportional
to follower count.

Fan-out on read for celebrities: a user with 50 million followers would generate
50 million writes per post. Instead, store the post once and merge it in at read
time for anyone who follows a celebrity.

Merge at read: `feed = precomputed_list ∪ celebrity_posts`, sorted.

Other real considerations: don't fan out to inactive users (build their feed on
demand when they return); fan out asynchronously so posting stays fast; and
store *ids* in feeds, hydrating content separately so an edit doesn't require
rewriting millions of rows.

The threshold between the two paths is a tuning parameter you set from your
follower-count distribution.
</details>

<details>
<summary><b>3.</b> Explain event time vs processing time with a concrete failure.</summary>

A mobile app is offline from 10:00 to 11:00 and buffers events. At 11:00 it
uploads them all.

**Processing time:** every event lands in the 11:00 window. Your dashboard shows
zero activity 10:00–11:00 and a huge spike at 11:00. The data is wrong in a way
that looks like a real event, so someone will investigate the "spike".

**Event time:** each event carries its true timestamp and goes into its correct
window. But those windows closed an hour ago — so what now?

That's what watermarks and lateness allowances are for: the window waits a
configured period past its end before finalising. Anything later is *late data*,
and you choose to drop it (and count it), emit a correction, or route it to a
side output for reprocessing.

The general rule: **event time for correctness, processing time only when you
genuinely don't care.** And always emit a metric for dropped late data — silent
loss is how you get numbers nobody trusts.
</details>

<details>
<summary><b>4.</b> When is batch better than streaming?</summary>

- **The latency requirement allows it.** Daily reports, billing runs, ML training
  sets, weekly emails.
- **Reprocessing matters.** Found a bug? Re-run yesterday's job. In streaming
  that's a replay project.
- **The computation needs all the data** — global percentiles, exact distinct
  counts, full-dataset joins.
- **Cost.** A batch job runs for 10 minutes a day; a streaming pipeline runs for
  1,440.
- **Simplicity.** No watermarks, no late data, no windowing semantics, no
  always-on infrastructure to operate.

Streaming wins when: the latency requirement is seconds, the value of the data
decays fast (fraud detection, alerting, live dashboards), or the volume is too
large to batch economically.

Many mature systems run both — the **lambda architecture**: streaming for a fast
approximate answer, batch for a nightly authoritative correction.
</details>

<details>
<summary><b>5.</b> Your batch job takes 6 hours and the window is 4. What do you do?</summary>

**Understand first.** Profile: is it CPU, I/O, a single slow stage, or data skew
where one partition holds most of the work?

Then, roughly in order of effort:
- **Incremental instead of full recompute** — process only what changed since the
  last run. Usually the biggest win and often overlooked.
- **Partition and parallelise** — split by day, tenant or hash and run the parts
  concurrently.
- **Fix the query** — this is a batch job hitting a database; Capsule 11 applies
  in full.
- **Move it to the right engine** — a 6-hour Postgres aggregation may be 3
  minutes in BigQuery, because it's a columnar scan problem.
- **Relax the requirement** — does it truly need to be daily, or would every 4
  hours on a rolling window serve the business better anyway?
- **Stream it** — if it must be continuous, incremental streaming aggregation is
  the structural answer. Biggest change, biggest cost.

And regardless: **make it resumable**, so a failure at hour 5 doesn't mean
starting over.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Batch never flushes at low traffic | No time-based trigger. That's what the ticker is for. |
| Last batch lost on shutdown | You didn't call `Close()` on SIGTERM. Wire it into the graceful shutdown from Capsule 01. |
| `CopyFrom` fails on duplicates | COPY can't do `ON CONFLICT`. Load into a temp table and `INSERT … SELECT … ON CONFLICT`. |
| Window memory grows forever | You never delete closed windows. `delete(w.windows, start)` after emitting. |
| Late events silently vanish | Expected, if that's your policy — but emit a metric. Silent drops destroy trust in the numbers. |
| BigQuery bill is enormous | Missing partition filter, or `SELECT *`. Check "bytes processed" before running anything large. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(events): batching, windowed aggregation, and a daily rollup

Capsule 20. Size-or-time batcher took consumer throughput up ~20x via
CopyFrom. Event-time tumbling windows with an explicit lateness allowance.
Compared fan-out-on-write (redis sorted set) with fan-out-on-read.
Idempotent, re-runnable daily rollup job."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 20
```

**Next:** [Capsule 21 · Trunks' Time Machine — Event-Driven Architecture](../21-time-machine-event-driven/README.md)
