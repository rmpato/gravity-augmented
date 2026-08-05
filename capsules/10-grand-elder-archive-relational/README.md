# Capsule 10 · The Grand Elder's Archive — Relational Data

> *Guru sits at the top of Namek and remembers everything: every Namekian, every
> Dragon Ball, every lineage. He is the single source of truth for an entire
> planet — and when he dies, the Dragon Balls turn to stone. Everything depends
> on him, and everyone knows it.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 7 | 85 min | Capsules 06, 09 · optional [B4 SQL essentials](../bonus/B4-ancient-namekian-sql/README.md) | Local + concept |

---

## Why this capsule exists

Capsule 06 proved the Scouter is stateful and therefore can't scale. This is the
fix — and it's also where the genuinely hard problems start.

Compute is easy: it's stateless, interchangeable and disposable. **Data is
where the difficulty lives**, because it has to be correct, durable, consistent
and available all at once, and those goals conflict. Every remaining capsule in
this repo is downstream of a decision made here.

You'll also meet the two failure modes that account for an enormous share of
real-world "the site is slow" incidents: **connection pool exhaustion** and
**N+1 queries**.

---

## The concept

### Why relational is the right default

You'll be told that SQL doesn't scale. What people mean is that *a single
primary* doesn't scale writes past a point — which is true, and is Capsules 12
and 13. Everything else about relational databases is a strong default:

- **Schemas** catch a whole class of bug at write time rather than at read time,
  six months later, in a different service.
- **Transactions with ACID guarantees** — the thing you will miss most if you
  give it up.
- **Joins** let you avoid duplicating data. Denormalising is an optimisation you
  should have to justify.
- **A declarative query planner** — you say what you want, it figures out how.
  You'll almost never beat it by hand (Capsule 11).
- **Forty years of operational knowledge.** Everyone knows how to back it up,
  restore it, monitor it and tune it.

Start here. Move off it when you have a measured reason, not a feeling.

### ACID, quickly

- **Atomicity** — all of a transaction or none of it.
- **Consistency** — constraints hold before and after.
- **Isolation** — concurrent transactions don't see each other's mess.
- **Durability** — committed means it survives a crash.

**Isolation levels** are the one you must actually understand, because they're a
correctness-vs-throughput dial:

| Level | Prevents | Still allows |
|---|---|---|
| Read Uncommitted | — | dirty reads (Postgres never actually does this) |
| **Read Committed** *(Postgres default)* | dirty reads | non-repeatable reads, phantoms |
| Repeatable Read | + non-repeatable reads | (in Postgres: serialization failures) |
| Serializable | everything | nothing — but transactions can be aborted and must be retried |

The default is Read Committed, and it means **the same query inside one
transaction can return different results** if someone else commits in between.
That surprises people. When you need "read the balance, then update it based on
what you read", you need either `SELECT … FOR UPDATE`, or Serializable plus a
retry loop, or an atomic single-statement update.

### Connection pooling — read this twice

A Postgres connection is a **separate OS process** on the server with several MB
of memory. `max_connections` defaults to 100. Connections are expensive to
create (TCP + TLS + auth ≈ 5–50 ms) and expensive to *have*.

```
  10 replicas × 20 connections each = 200 connections
  Postgres max_connections = 100
  → half your replicas cannot connect. Under load. Simultaneously.
```

And even when it fits, high connection counts hurt: past roughly `2 × cores +
effective_spindles`, Postgres spends its time context-switching rather than
querying. **Fewer connections often means more throughput.**

The rules:

- Pool size per replica should be **small** — often 5–10, not 100.
- `total connections = replicas × pool size` must stay well under
  `max_connections`.
- Cap `max-instances` (Capsule 06) precisely because of this arithmetic.
- Past a few hundred clients, put a **pooler** in front: PgBouncer in
  transaction mode multiplexes thousands of client connections onto tens of
  server ones. On GCP, the Cloud SQL Auth Proxy handles connectivity and AlloyDB
  has pooling built in.
- Always set `max_conn_lifetime` — it lets connections rotate so a failover or a
  DNS change doesn't leave you pinned to a dead host.

### The N+1 query

The single most common performance bug in application code:

```
  1 query:  SELECT * FROM fighters LIMIT 100
  then, in a loop, 100 queries: SELECT ... FROM readings WHERE fighter_id = ?

  = 101 round trips. At 2ms each that's 202ms of pure network latency,
    for data one JOIN would have returned in 3ms.
```

ORMs cause this by default via lazy loading, and it's invisible locally (0.1 ms
round trips) and catastrophic in production (2 ms round trips over a network).

Fixes: a `JOIN`; a single `WHERE id = ANY($1)` with all the ids; or a lateral
join / window function for "top N per group". The diagnostic is always the same:
**count your queries per request.**

### Schema design worth getting right

- **Every table gets a primary key.** Prefer `BIGINT GENERATED ALWAYS AS
  IDENTITY` for internal keys; use UUIDv7 if you need client-generated ids
  (UUIDv4 as a primary key destroys index locality and bloats B-trees).
- **`TIMESTAMPTZ`, never `TIMESTAMP`.** Storing local time without a zone is a
  bug you discover during a DST change.
- **`NOT NULL` by default.** Every nullable column is a branch in every piece of
  code that reads it.
- **Foreign keys with explicit `ON DELETE`.** Say what happens; don't let it be
  a surprise.
- **`NUMERIC` for money, never `FLOAT`.** `0.1 + 0.2 != 0.3`.
- **`CHECK` constraints for invariants.** The database is the last line of
  defence and it never has a bug in the application layer.

---

## Lab — give the Scouter a real database

### Step 1 — Postgres in compose

Add to **`deploy/docker-compose.yml`**:

```yaml
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: scouter
      POSTGRES_PASSWORD: kamehameha      # local only — see the note below
      POSTGRES_DB: scouter
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./sql:/docker-entrypoint-initdb.d:ro   # *.sql here runs on first boot
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scouter"]
      interval: 3s
      timeout: 2s
      retries: 10

volumes:
  pgdata:
```

And make the app wait for a *healthy* database, not just a started one:

```yaml
  scouter:
    # …existing config…
    environment:
      PORT: "8080"
      LOG_LEVEL: "${LOG_LEVEL:-info}"
      DATABASE_URL: "postgres://scouter:kamehameha@postgres:5432/scouter?sslmode=disable"
    depends_on:
      postgres:
        condition: service_healthy
```

> **The password is in the file.** That is fine *only* because this database
> exists on your laptop and holds fake data. In every other context the value
> comes from Secret Manager or your platform's secret store, and the compose
> file references `${POSTGRES_PASSWORD}` from an ignored `.env`. Say this out
> loud so the habit sticks.

### Step 2 — the schema

**`deploy/sql/001_init.sql`**

```sql
-- Fighters: the entities we measure.
CREATE TABLE fighters (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    race        TEXT        NOT NULL DEFAULT 'unknown',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Readings: one power-level measurement. This is the table that grows.
CREATE TABLE readings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fighter_id  BIGINT      NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
    power       BIGINT      NOT NULL CHECK (power >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The access pattern is "latest readings for a fighter", so the index is
-- (fighter_id, recorded_at DESC). Column ORDER matters — Capsule 11.
CREATE INDEX idx_readings_fighter_time ON readings (fighter_id, recorded_at DESC);

-- Seed data so the service does something on first run.
INSERT INTO fighters (name, race) VALUES
    ('goku', 'saiyan'), ('vegeta', 'saiyan'), ('piccolo', 'namekian'),
    ('krillin', 'human'), ('frieza', 'frost demon'), ('gohan', 'half-saiyan');
```

### Step 3 — the Postgres store

```bash
go get github.com/jackc/pgx/v5/pgxpool
```

> **Check `go.mod` after this.** pgx requires a recent Go, so `go get` may raise
> the `go` directive in your module — and if it lands above the `FROM golang:`
> tag in your Dockerfile, the build keeps working locally and fails only in
> Docker. `head -3 go.mod`, then match the Dockerfile (Capsule 02).

> **Why pgx and not `database/sql`:** pgx speaks the Postgres binary protocol
> natively, which is faster and gives you real Postgres types (arrays, JSONB,
> intervals) instead of string conversions. `database/sql` is the generic
> interface; pgx is the Postgres one. For a Postgres-only service, use pgx.

**`internal/scouter/postgres.go`**

```go
package scouter

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

var _ Store = (*PostgresStore)(nil) // the interface from Capsule 06 pays off

func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	// Pool sizing is a capacity decision, not a default to accept.
	// total connections = replicas x MaxConns, and it must stay well under
	// the server's max_connections (100 by default).
	cfg.MaxConns = 10
	cfg.MinConns = 2                        // keep a few warm; connecting costs ms
	cfg.MaxConnLifetime = 30 * time.Minute  // rotate so failover isn't sticky
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// Fail fast at startup rather than on the first request.
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() { s.pool.Close() }

// Ping backs the readiness probe. Liveness must NOT call this (Capsule 01).
func (s *PostgresStore) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *PostgresStore) Record(r Reading) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Upsert the fighter, then insert the reading, atomically.
	// ON CONFLICT makes this idempotent — the same pattern Capsule 19 needs.
	const q = `
		WITH f AS (
			INSERT INTO fighters (name) VALUES ($1)
			ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
			RETURNING id
		)
		INSERT INTO readings (fighter_id, power, recorded_at)
		SELECT f.id, $2, $3 FROM f`

	if _, err := s.pool.Exec(ctx, q, r.Fighter, r.Power, r.RecordedAt); err != nil {
		// Store's signature has no error return (Capsule 01's shape).
		// Capsule 17 fixes that; for now, at least don't swallow it silently.
		fmt.Printf(`{"level":"ERROR","msg":"record failed","err":%q}`+"\n", err)
	}
}

func (s *PostgresStore) Latest(fighter string) (Reading, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	const q = `
		SELECT f.name, r.power, r.recorded_at
		FROM readings r
		JOIN fighters f ON f.id = r.fighter_id
		WHERE f.name = $1
		ORDER BY r.recorded_at DESC
		LIMIT 1`

	var out Reading
	err := s.pool.QueryRow(ctx, q, fighter).Scan(&out.Fighter, &out.Power, &out.RecordedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Reading{}, false
	}
	if err != nil {
		return Reading{}, false
	}
	return out, true
}

// Leaderboard: the latest reading per fighter, top n by power.
// DISTINCT ON is a Postgres-specific "first row per group" — it pairs with
// ORDER BY and is dramatically faster than a self-join or a window function
// when an index covers the ordering.
func (s *PostgresStore) Leaderboard(n int) []Reading {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	const q = `
		SELECT name, power, recorded_at FROM (
			SELECT DISTINCT ON (r.fighter_id)
			       f.name, r.power, r.recorded_at
			FROM readings r
			JOIN fighters f ON f.id = r.fighter_id
			ORDER BY r.fighter_id, r.recorded_at DESC
		) latest
		ORDER BY power DESC
		LIMIT $1`

	rows, err := s.pool.Query(ctx, q, n)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]Reading, 0, n)
	for rows.Next() {
		var r Reading
		if err := rows.Scan(&r.Fighter, &r.Power, &r.RecordedAt); err != nil {
			return out
		}
		out = append(out, r)
	}
	return out
}
```

### Step 4 — wire it up

> **One thing to fix while you're here.** `DATABASE_URL` is now *required*, and
> `deploy/docker-compose.scale.yml` from Capsule 06 doesn't set it. Add it there
> too. If you don't, the next time you re-run the horizontal-scaling lab the
> replicas exit at boot and nginx dies with `host not found in upstream
> "scouter:8080"` — which sends you debugging nginx for a problem that is
> nothing to do with nginx.

**`internal/scouter/config.go`** — add the field and make it required:

```go
type Config struct {
	Port            string
	LogLevel        string
	DatabaseURL     string
	ShutdownTimeout time.Duration
	DrainDelay      time.Duration
}
```

```go
	c.DatabaseURL = os.Getenv("DATABASE_URL")
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
```

(Import `errors`.) **No default** — guessing a database URL is exactly the
"quiet wrong answer" from Capsule 01.

**`cmd/scouter/main.go`** — replace `MemStore`:

```go
	store, err := scouter.NewPostgresStore(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Error("database unavailable at startup", "err", err)
		os.Exit(1)
	}
	defer store.Close()

	srv := scouter.NewServer(store, log)
```

**Because of the `Store` interface from Capsule 06, no handler changed.** That's
the payoff, and it's worth noticing.

Make readiness actually check the database (`internal/scouter/server.go`):

```go
type Server struct {
	store Store
	log   *slog.Logger
	ready atomic.Bool
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	if !s.ready.Load() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "draining"})
		return
	}
	// Readiness checks dependencies. Liveness never does.
	if p, ok := s.store.(interface{ Ping(context.Context) error }); ok {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := p.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable,
				map[string]string{"status": "database unreachable"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
```

### Step 5 — run it and prove the Capsule 06 bug is gone

```bash
cd deploy
docker compose up --build -d
docker compose ps            # postgres healthy, scouter running
```

```bash
curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}' | jq
curl -s localhost:8080/fighters/goku | jq
curl -s localhost:8080/leaderboard | jq
```

Now scale out — the thing that broke in Capsule 06:

```bash
docker compose up -d --scale scouter=3
# (put the nginx lb from Capsule 07 in front, or just hit each container)
```

Every replica now sees every write. **The state moved out of the process.**

> ### ⏸ Natural stopping point
>
> Everything above stands on its own — commit it and come back. The steps below
> build on it but don't destabilise anything if you stop here. Two 45-minute
> sittings beat one 90-minute slog you don't finish.

### Step 6 — build an N+1 and then kill it

Add a deliberately naive endpoint to `postgres.go`:

```go
// LeaderboardNaive is the N+1 version. Do not ship this. It exists so you can
// see the difference in EXPLAIN and in the query count.
func (s *PostgresStore) LeaderboardNaive(n int) []Reading {
	ctx := context.Background()

	rows, _ := s.pool.Query(ctx, `SELECT id, name FROM fighters LIMIT $1`, n)
	type f struct {
		id   int64
		name string
	}
	var fs []f
	for rows.Next() {
		var x f
		_ = rows.Scan(&x.id, &x.name)
		fs = append(fs, x)
	}
	rows.Close()

	out := make([]Reading, 0, len(fs))
	for _, x := range fs { // <-- one query per fighter. This is the bug.
		var r Reading
		err := s.pool.QueryRow(ctx,
			`SELECT power, recorded_at FROM readings
			 WHERE fighter_id = $1 ORDER BY recorded_at DESC LIMIT 1`, x.id).
			Scan(&r.Power, &r.RecordedAt)
		if err == nil {
			r.Fighter = x.name
			out = append(out, r)
		}
	}
	return out
}
```

Load some data and compare:

```bash
# 20k readings across 500 fighters
docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
INSERT INTO fighters (name, race)
SELECT 'fighter_' || g, 'saiyan' FROM generate_series(1, 500) g
ON CONFLICT DO NOTHING;

INSERT INTO readings (fighter_id, power, recorded_at)
SELECT (random() * 499 + 1)::bigint,
       (random() * 1000000)::bigint,
       now() - (random() * interval '90 days')
FROM generate_series(1, 20000);

ANALYZE;
SQL
```

Turn on query logging and count:

```bash
docker compose exec -T postgres psql -U scouter -d scouter \
  -c "ALTER SYSTEM SET log_statement = 'all';" -c "SELECT pg_reload_conf();"

curl -s "localhost:8080/leaderboard?limit=50" >/dev/null
docker compose logs postgres --since 10s | grep -c "SELECT"   # ~1

# then wire /leaderboard-naive to LeaderboardNaive and hit it
docker compose logs postgres --since 10s | grep -c "SELECT"   # ~51
```

**51 round trips versus 1.** On your laptop the difference is ~20 ms. Over a
real network at 2 ms per round trip it's 100 ms of pure latency, per request,
for nothing.

Turn logging back off — it is *very* expensive:

```bash
docker compose exec -T postgres psql -U scouter -d scouter \
  -c "ALTER SYSTEM SET log_statement = 'none';" -c "SELECT pg_reload_conf();"
```

### Step 7 — exhaust the connection pool on purpose

```bash
# 10 max connections in the pool; fire far more concurrent slow requests
k6 run --vus 100 --duration 30s scripts/load/stress.js
```

Watch what happens:

```bash
docker compose exec -T postgres psql -U scouter -d scouter \
  -c "SELECT count(*), state FROM pg_stat_activity WHERE datname='scouter' GROUP BY state;"
```

You'll see connections pinned at your `MaxConns` and requests queueing *inside
the app* waiting for one. Latency climbs while Postgres itself looks bored.

**This is the signature of pool exhaustion**: high app latency, low database
CPU. Recognise it and you've saved yourself an afternoon. The fix is never
"make the pool huge" — it's faster queries, a pooler, or fewer replicas.

```bash
docker compose down
```

---

## In GCP

> **Concept only.** Cloud SQL has **no free tier**; the smallest instance is
> roughly **$8–10/month billed while it exists**, whether you use it or not.
> Everything above runs in Docker for exactly this reason.

**Cloud SQL for PostgreSQL** — managed Postgres. What you get:

- Automated backups + point-in-time recovery (test your restores, not your
  backups)
- **High availability**: a synchronous standby in another zone, automatic
  failover in ~60 s. Roughly doubles the cost. Non-negotiable for production.
- Read replicas (Capsule 13)
- Maintenance windows — patching *will* restart your instance; pick the window
- IAM database authentication, so no passwords at all

**Connecting to it**, in order of preference:

1. **Cloud SQL Auth Proxy** / the connectors library — handles TLS, IAM auth and
   rotation. This is the default.
2. **Private IP with a VPC connector** from Cloud Run — no public exposure.
3. **Public IP with authorised networks** — avoid.

**`max_connections`** on the smallest tiers is small (a `db-f1-micro` allows
~25). Do the arithmetic from Step 7 before you deploy, or add PgBouncer.

**When to reach past Cloud SQL:**

- **AlloyDB** — Postgres-compatible, much faster analytics, built-in pooling.
  More expensive.
- **Spanner** — only when you genuinely need horizontal write scaling with
  strong consistency and can pay for it (Capsule 13).
- **Firestore** — different model entirely; good for per-user documents and
  realtime sync, bad for anything needing joins or aggregate queries.

---

## Bring it to work

- **Small pools.** `replicas × pool_size < max_connections`, with margin. Write
  the arithmetic in the PR description.
- **Always `context.WithTimeout` on queries.** An unbounded query holds a
  connection forever and takes the pool down with it.
- **`TIMESTAMPTZ`, `NUMERIC` for money, `NOT NULL` by default.**
- **Count queries per request in code review.** N+1 is invisible locally and
  brutal in production.
- **Readiness pings the database; liveness never does.**
- **Fail startup if `DATABASE_URL` is missing.** Loud beats quiet.
- **The database is the last line of defence.** Put real constraints in the
  schema — application validation has bugs, and other writers exist.

---

## Battle drill

<details>
<summary><b>1.</b> App latency is 3 s. Database CPU is 8%. What is happening?</summary>

Almost certainly **connection pool exhaustion**. Requests are queueing inside
your app waiting for a connection; the database is idle because it isn't
receiving the work.

Confirm with pool metrics (pgx exposes `pool.Stat()`: `AcquireCount`,
`AcquireDuration`, `EmptyAcquireCount`) and with `pg_stat_activity` on the
server.

Causes, in order: a slow query holding connections; a missing timeout so
connections are never returned; a leaked connection (rows not closed); too many
replicas for the pool budget; or genuinely too small a pool.

Fixes: find the slow query first (Capsule 11), add timeouts, then consider a
pooler. Raising `MaxConns` is the *last* option and often makes it worse.
</details>

<details>
<summary><b>2.</b> Two requests read a balance of 100 and each subtract 30. What's stored, and how do you fix it?</summary>

Under Read Committed both read 100, both compute 70, both write 70. **You lost
an update** — the balance should be 40.

Three correct fixes:

1. **Atomic single statement**: `UPDATE accounts SET balance = balance - 30
   WHERE id = $1 AND balance >= 30`. Simplest and usually right.
2. **Pessimistic lock**: `SELECT … FOR UPDATE` inside a transaction; the second
   reader blocks until the first commits.
3. **Optimistic**: a `version` column, `UPDATE … WHERE version = $old`; if zero
   rows are affected, retry.

Serializable isolation also prevents it, but it aborts transactions under
contention so you still need a retry loop. Notice that "just use a transaction"
is *not* on the list — a transaction alone at Read Committed doesn't stop this.
</details>

<details>
<summary><b>3.</b> Why is a bigger connection pool often slower?</summary>

Each Postgres connection is a backend process with its own memory. Beyond
roughly `2 × cores`, adding connections adds context switching, lock contention
and cache pressure without adding parallelism — total throughput *falls* while
per-query latency rises.

The queue has to exist somewhere. It's better to queue in your application,
where you can see it, bound it, time it out and shed it, than inside the
database, where it degrades everything for everyone.

This is why PgBouncer in transaction mode is so effective: thousands of client
connections, a few dozen server connections, and the database runs at its
efficient point.
</details>

<details>
<summary><b>4.</b> When is it genuinely right to reach for a non-relational database?</summary>

Concrete triggers, not vibes:

- **Bigtable/Cassandra** — > 10 TB, single-key access patterns, no joins needed,
  and write throughput beyond one primary. Time series and IoT are the classic
  fits.
- **Firestore/DynamoDB** — per-user document access, realtime sync, offline
  clients, and access patterns you know completely in advance.
- **Elasticsearch** — full-text relevance ranking. (Postgres full-text is
  genuinely fine up to surprisingly large scale.)
- **Redis** — caching and ephemeral state, not durable truth (Capsule 14).
- **BigQuery** — analytics over billions of rows, alongside the transactional
  store rather than instead of it.

What you give up is joins, ad-hoc queries, multi-row transactions and forty
years of tooling. That's a real cost, so the trigger should be a measurement.
</details>

<details>
<summary><b>5.</b> Your ORM generates 200 queries for one page. Walk through fixing it.</summary>

**Measure**: turn on query logging or use an APM to get the exact count and the
statements. Never guess.

**Categorise**: the pattern is almost always one parent query plus N lazy-loaded
children, sometimes nested (N×M).

**Fix in order**:
1. Eager-load the association (`JOIN` / `preload` / `includes`).
2. Batch the ids: one `WHERE id = ANY($1)` instead of N queries.
3. For "top N per group", use `DISTINCT ON` or a window function.
4. If it's still hot, denormalise a counter or cache the result (Capsule 14).

**Prevent**: assert a query-count budget in an integration test. That converts
"someone will notice in production" into "the build fails". It's one of the
highest-value tests you can write.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `connection refused` on startup | Postgres isn't healthy yet. Use `depends_on: condition: service_healthy`. |
| `password authentication failed` | Credentials in `DATABASE_URL` don't match the compose env. |
| Schema didn't apply | `docker-entrypoint-initdb.d` only runs on an **empty** volume. `docker compose down -v` then up. |
| `sslmode` errors | Local Postgres has no TLS: `?sslmode=disable`. Never do this against a real database. |
| `too many clients already` | `replicas × MaxConns > max_connections`. Do the arithmetic. |
| `context deadline exceeded` | Query slower than your timeout — that's the timeout doing its job. Find the slow query (Capsule 11). |
| Data vanished after restart | No named volume, or you ran `down -v`. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(store): postgres-backed store replaces in-memory map

Capsule 10. Schema with constraints and a (fighter_id, recorded_at DESC)
index. pgx pool sized deliberately (10 conns/replica). Readiness now pings
the DB; liveness still does not. Reproduced N+1 (51 queries vs 1) and pool
exhaustion (high app latency, idle database)."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 10
```

**Next:** [Capsule 11 · Dragon Radar — Indexes & Query Plans](../11-dragon-radar-indexes/README.md)
