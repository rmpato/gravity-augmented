# Capsule 21 · Trunks' Time Machine — Event-Driven Architecture

> *Trunks travels back to warn everyone about the Androids. It works — and it
> does not fix his own future, because changing the past creates a new timeline
> rather than editing the old one. That is an append-only log: you never mutate
> history, you append to it, and replaying it from a different point produces a
> different present.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 9 | 80 min | Capsules 18–20 | Local |

---

## Why this capsule exists

Capsule 18 left a hole:

```go
  store.Record(reading)      // ✅ committed
  publisher.Publish(event)   // ✗ process dies. Downstream never learns.
```

That's the **dual-write problem**, and it is unfixable by ordering, retries or
care. This capsule closes it properly, and in doing so introduces the idea that
makes large systems tractable: **the log of what happened is the source of
truth, and every other view is derived from it.**

---

## The concept

### The transactional outbox

You cannot atomically write to a database and a message broker. But you *can*
atomically write two rows to the same database.

```
  ┌─ ONE TRANSACTION ──────────────────────┐
  │  INSERT INTO readings (...)            │
  │  INSERT INTO outbox (event, payload)   │
  └────────────────────────────────────────┘
                    │
         a separate relay process
                    │
                    ▼
              publish to Pub/Sub  ──► mark the outbox row sent
```

Now the guarantee is clean: **if the business data committed, the event exists.**
The relay may publish a message twice (crash after publish, before marking), so
you get **at-least-once** — which Capsule 19 already made harmless.

This is the single most important pattern in this capsule and one of the most
useful in production systems generally.

### Change data capture (CDC)

Instead of your application writing events, read the database's own replication
log:

```
   Postgres WAL ──► Debezium / Datastream ──► Kafka / Pub/Sub ──► consumers
```

**For:** catches *every* writer, including migrations, admin tools and other
teams' services. No application changes at all. Never misses a write.

**Against:** the events are *row changes*, not domain events. Consumers become
coupled to your schema — rename a column and you break them. There's real
operational complexity, and it needs `wal_level = logical` plus replication
slots (which will fill your disk if a consumer stops).

**Outbox vs CDC:** outbox produces meaningful domain events at the cost of
application code; CDC produces schema-shaped events at the cost of coupling. A
common hybrid is **CDC on the outbox table** — you get well-designed events *and*
guaranteed capture, with no relay to operate.

### Event sourcing (and why you probably don't want all of it)

Full event sourcing stores *only* events; current state is a fold over them.

```
  events:  Created{power: 100} → Increased{by: 50} → Decreased{by: 20}
  state:   fold(events) = 130
```

**For:** a perfect audit trail, time travel ("what did this look like on
Tuesday?"), new read models built by replaying history, and debugging by replay.

**Against:** every read is a fold (so you need snapshots), schema evolution is
genuinely hard because you can never delete an old event shape, and the mental
overhead is real. Deleting data for GDPR is painful in an append-only store.

**"Event sourcing lite" is what most systems should do:** keep normal mutable
state as the source of truth, *and* append an immutable event log alongside it.
You get audit, replay and integration without making every read a fold.

### Choreography vs orchestration

```
  CHOREOGRAPHY                       ORCHESTRATION
  each service reacts to events      a coordinator tells services what to do

  Order ──► OrderPlaced             ┌──────────────┐
              ├─► Payment            │ Orchestrator │──► Payment
              ├─► Inventory          │              │──► Inventory
              └─► Shipping           │              │──► Shipping
                                     └──────────────┘

  + loose coupling                   + the flow is explicit and visible
  + easy to add reactors             + easy to see where it failed
  - nobody knows the whole flow      - the coordinator is a coupling point
  - hard to debug                    - it can grow into a monolith
```

**Use choreography** for simple notification-shaped fan-out ("something
happened; whoever cares, react"). **Use orchestration** for multi-step business
processes with compensation — checkout, onboarding, refunds. The rule of thumb:
if a human would draw it as a flowchart with error branches, orchestrate it.

### Sagas

A distributed transaction, made of local transactions plus compensations:

```
  reserve inventory  →  charge card  →  ship
        │                    │
        │              (card fails)
        │                    ▼
        └────────── release inventory (compensate)
```

Compensations are **not rollbacks** — they're new forward actions that undo the
effect. You can't un-send an email; you send an apology. You can't un-charge; you
refund. This distinction matters, because compensations can themselves fail and
must be retried, which means they must be idempotent (Capsule 19).

### Schema evolution

Events outlive the code that wrote them. Rules:

- **Only add optional fields.** Never remove, never rename, never change a
  field's type or meaning.
- **Version explicitly** — a `version` field in the payload (Capsule 18) or a
  versioned topic/type name.
- **Consumers ignore unknown fields.** Strict parsing that rejects extra fields
  makes every producer change a breaking change.
- **To change meaning, emit a new event type.** `PowerRecordedV2` alongside V1,
  and retire V1 when nothing consumes it.
- **Use a schema registry** for anything serious: Pub/Sub schemas, Confluent
  Schema Registry. It makes compatibility checks a build-time failure rather than
  a production one.

---

## Lab

### Step 1 — the outbox table

```sql
-- deploy/sql/004_outbox.sql
CREATE TABLE outbox (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id      UUID        NOT NULL UNIQUE,
    aggregate     TEXT        NOT NULL,        -- e.g. 'fighter'
    aggregate_id  TEXT        NOT NULL,        -- e.g. 'goku'
    event_type    TEXT        NOT NULL,        -- 'power.recorded'
    payload       JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,                 -- NULL = not yet sent
    attempts      INT         NOT NULL DEFAULT 0,
    last_error    TEXT
);

-- A PARTIAL index: only unpublished rows. Stays tiny even when the table
-- holds millions of published rows.
CREATE INDEX idx_outbox_unpublished ON outbox (created_at)
    WHERE published_at IS NULL;
```

### Step 2 — write both in one transaction

**`internal/scouter/outbox.go`**

```go
package scouter

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// RecordWithOutbox writes the reading AND its event in ONE transaction.
//
// This is the fix for the dual-write problem: there is no window in which the
// data is committed but the event is lost, because they commit together or
// not at all.
func (s *PostgresStore) RecordWithOutbox(ctx context.Context, r Reading) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var fighterID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO fighters (name) VALUES ($1)
		ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		RETURNING id`, r.Fighter).Scan(&fighterID); err != nil {
		return fmt.Errorf("upsert fighter: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO readings (fighter_id, power, recorded_at)
		VALUES ($1, $2, $3)`,
		fighterID, r.Power, r.RecordedAt); err != nil {
		return fmt.Errorf("insert reading: %w", err)
	}

	eventID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"event_id":    eventID,
		"fighter":     r.Fighter,
		"power":       r.Power,
		"recorded_at": r.RecordedAt,
		"version":     1,
	})
	if err != nil {
		return err
	}

	// Same transaction. This is the whole point.
	if _, err := tx.Exec(ctx, `
		INSERT INTO outbox (event_id, aggregate, aggregate_id, event_type, payload)
		VALUES ($1, 'fighter', $2, 'power.recorded', $3)`,
		eventID, r.Fighter, payload); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}

	return tx.Commit(ctx)
}
```

### Step 3 — the relay

**`cmd/relay/main.go`**

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cloud.google.com/go/pubsub"
	"github.com/jackc/pgx/v5/pgxpool"
)

// relay publishes unsent outbox rows and marks them published.
//
// It may publish the same event twice (crash after publish, before UPDATE),
// so this is at-least-once — which Capsule 19 already made harmless.
// Do not try to make it exactly-once. You cannot, and you do not need to.
func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	client, err := pubsub.NewClient(ctx, os.Getenv("PUBSUB_PROJECT_ID"))
	if err != nil {
		log.Error("pubsub", "err", err)
		os.Exit(1)
	}
	defer client.Close()

	topic := client.Topic(os.Getenv("TOPIC_ID"))
	topic.EnableMessageOrdering = true
	defer topic.Stop()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	log.Info("relay online")
	for {
		select {
		case <-ctx.Done():
			log.Info("relay offline")
			return
		case <-ticker.C:
			if n, err := drain(ctx, pool, topic, log); err != nil {
				log.Error("drain failed", "err", err)
			} else if n > 0 {
				log.Info("relayed", "count", n)
			}
		}
	}
}

func drain(ctx context.Context, pool *pgxpool.Pool, topic *pubsub.Topic, log *slog.Logger) (int, error) {
	// FOR UPDATE SKIP LOCKED lets several relay instances run concurrently
	// without processing the same rows. It is the standard "queue in
	// Postgres" primitive and worth remembering on its own.
	rows, err := pool.Query(ctx, `
		SELECT id, event_id, aggregate_id, event_type, payload
		FROM outbox
		WHERE published_at IS NULL
		ORDER BY id
		LIMIT 100
		FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return 0, err
	}

	type row struct {
		id        int64
		eventID   string
		aggID     string
		eventType string
		payload   []byte
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.eventID, &r.aggID, &r.eventType, &r.payload); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, r)
	}
	rows.Close()

	published := 0
	for _, r := range batch {
		res := topic.Publish(ctx, &pubsub.Message{
			Data: r.payload,
			Attributes: map[string]string{
				"event_type": r.eventType,
				"event_id":   r.eventID,
			},
			OrderingKey: r.aggID, // per-aggregate ordering
		})
		if _, err := res.Get(ctx); err != nil {
			// Leave published_at NULL: it will be retried next tick.
			_, _ = pool.Exec(ctx,
				`UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
				r.id, err.Error())
			log.Warn("publish failed, will retry", "outbox_id", r.id, "err", err)
			continue
		}
		if _, err := pool.Exec(ctx,
			`UPDATE outbox SET published_at = now() WHERE id = $1`, r.id); err != nil {
			// Published but not marked: it will publish again next tick.
			// That is a DUPLICATE, not a loss — and duplicates are handled.
			log.Warn("published but not marked", "outbox_id", r.id, "err", err)
		}
		published++
	}
	return published, nil
}
```

### Step 4 — prove it survives a crash

```bash
cd deploy && docker compose up -d postgres pubsub && cd ..
export PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber
./scripts/pubsub-setup.sh

# API writing through the outbox — relay NOT running
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" make run

for f in goku vegeta piccolo; do
  curl -s -XPOST localhost:8080/readings -d "{\"fighter\":\"$f\",\"power\":$((RANDOM*10))}" >/dev/null
done

psql "postgres://scouter:kamehameha@localhost:5432/scouter" -c \
  "SELECT id, event_type, aggregate_id, published_at FROM outbox ORDER BY id;"
```

Three rows, `published_at` NULL. **The events are safe in the database.** The
broker was never involved, and nothing was lost.

Now start the relay:

```bash
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" \
PUBSUB_PROJECT_ID=gravity-chamber TOPIC_ID=power-readings \
  go run ./cmd/relay
```

They publish, and `published_at` fills in. **This is the property you were
missing**: the broker being down, or the process dying, no longer loses events.

Prove the crash case:

```bash
# take the broker away entirely
docker compose stop pubsub

curl -s -XPOST localhost:8080/readings -d '{"fighter":"broly","power":1400000}' | jq
# ✅ 201. The API doesn't care.

psql "postgres://scouter:kamehameha@localhost:5432/scouter" -tAc \
  "SELECT count(*) FROM outbox WHERE published_at IS NULL;"
# 1 — waiting

docker compose start pubsub
# the relay catches up on its own
```

### Step 5 — CDC, with real logical replication

Postgres can stream logical changes without any application involvement.

```bash
docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
ALTER SYSTEM SET wal_level = 'logical';
SQL
docker compose restart postgres
sleep 5

docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
-- a publication says WHICH tables to stream
CREATE PUBLICATION scouter_changes FOR TABLE readings, fighters;

-- a slot is a durable cursor into the WAL
SELECT pg_create_logical_replication_slot('cdc_demo', 'pgoutput');
SQL
```

Generate changes and read them back as a change stream:

```bash
curl -s -XPOST localhost:8080/readings -d '{"fighter":"gohan","power":200000}' >/dev/null

docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT lsn, xid, left(data, 120) FROM pg_logical_slot_peek_changes(
       'cdc_demo', NULL, NULL, 'proto_version','1','publication_names','scouter_changes');"
```

You're reading the database's own change log — no application code involved.
This is exactly what Debezium and Datastream consume.

> ⚠️ **The operational trap, and it is a serious one:** a replication slot that
> nobody reads makes Postgres **retain WAL forever**. Your disk fills and the
> database stops. Always monitor slot lag, and drop unused slots:

```bash
docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT slot_name, active,
          pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
   FROM pg_replication_slots;"

docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT pg_drop_replication_slot('cdc_demo');"
```

### Step 6 — replay, which is the point of all this

Because the outbox is an append-only history, you can rebuild any derived view.

```bash
psql "postgres://scouter:kamehameha@localhost:5432/scouter" <<'SQL'
-- a new read model, built from scratch by replaying history
TRUNCATE fighter_ranks, processed_events;

-- reset the log so everything is unpublished again
UPDATE outbox SET published_at = NULL;
SQL
```

Restart the relay. Every event republishes, consumers rebuild `fighter_ranks`
from zero, and — **because the consumer is idempotent (Capsule 19)** — the result
is correct rather than doubled.

**That is the payoff.** A new read model, a bug fix in a projection, or a
migration to a different store is a *replay*, not a data-migration project.

Try it: change `Handle` to also compute `max_power`, truncate, replay. The new
field is populated for all of history.

```bash
cd deploy && docker compose down
```

---

## In GCP

- **Datastream** — managed CDC from Cloud SQL/MySQL/Oracle into BigQuery or Cloud
  Storage. Handles slots, snapshots and schema drift for you. This is the
  low-effort way to get an analytics copy without touching application code.
- **Eventarc** — routes events from 90+ GCP services (a GCS object created, a
  Cloud SQL audit log entry, a Pub/Sub message) to Cloud Run. Useful glue.
- **Workflows** — a managed orchestrator: YAML/JSON-defined steps with retries,
  error handling and state. The right tool for orchestrated sagas when you don't
  want to run a workflow engine.
- **Cloud Tasks** — for the "call this endpoint later, with retries" half of a
  saga.
- **Pub/Sub schemas** — Avro or Protocol Buffers attached to a topic, with
  compatibility enforcement at publish time. Turns a schema break into a publish
  error rather than a consumer outage:

```bash
gcloud pubsub schemas create power-recorded --type=AVRO --definition-file=schema.avsc
gcloud pubsub topics create power-readings \
  --schema=power-recorded --message-encoding=JSON
```

- **Spanner change streams** and **Firestore triggers** give you CDC natively if
  you're on those stores.

---

## Bring it to work

- **Transactional outbox for every event that must not be lost.** It's one table
  and one relay, and it removes an entire class of "downstream is missing data"
  incidents.
- **Accept at-least-once from the relay.** Idempotent consumers make it a
  non-issue; chasing exactly-once wastes months.
- **`FOR UPDATE SKIP LOCKED`** is how you run multiple relays (and how you build
  a queue in Postgres generally).
- **Partial index on unpublished rows**, and prune published ones.
- **Monitor replication slot lag.** An abandoned slot fills the disk and takes
  the database down.
- **Events are append-only and additive-only.** New optional fields, new event
  types, never breaking changes.
- **Choreography for notifications, orchestration for business processes.**
- **Design for replay from day one** — it's what turns "we need to backfill" from
  a project into an afternoon.

---

## Battle drill

<details>
<summary><b>1.</b> Why can't you just publish the event first, then write to the database?</summary>

Then you can publish an event about something that never happened. If the
database write fails, consumers have already reacted — sent the email, charged
the card, updated the index — for a state that doesn't exist. That's worse than a
missing event, because now your systems actively disagree.

Publishing after the commit has the opposite failure (data exists, nobody knows),
which is at least *consistent* and recoverable by reconciliation.

Neither ordering is safe, which is the point: **two independent writes cannot be
made atomic by ordering them.** The outbox works because it converts two writes
into one — both rows go into the same transaction, in the same database.
</details>

<details>
<summary><b>2.</b> Outbox or CDC?</summary>

**Outbox** when you want *domain* events — meaningful, well-shaped, stable
contracts (`PowerRecorded`, not `readings row inserted`). Consumers depend on
your event schema, which you control deliberately, so you can refactor tables
freely. Costs application code and a relay to run.

**CDC** when you can't change the application, when other writers exist that you
don't control (migrations, admin tools, another team), or when you want an
analytics copy with no code at all. Costs schema coupling — consumers now depend
on your column names — plus real operational care around replication slots.

**The hybrid worth knowing:** run **CDC on the outbox table**. You get
deliberately-designed domain events *and* guaranteed capture straight from the
WAL, with no relay process to operate. Debezium explicitly supports this pattern.
</details>

<details>
<summary><b>3.</b> Design checkout as a saga: reserve inventory, charge card, ship.</summary>

**Orchestrated**, not choreographed — this has error branches and a human would
draw it as a flowchart.

Forward path: `ReserveInventory` → `ChargeCard` → `CreateShipment`.

Compensations, applied in reverse: `ReleaseInventory`, `RefundCharge`. Note
these are *new actions*, not rollbacks — you cannot un-charge a card, you refund
it, and that shows up on the customer's statement.

The details that make it actually work:
- **Every step and every compensation is idempotent** (Capsule 19) — they will be
  retried.
- **Persist the saga state** so a crashed orchestrator resumes rather than
  restarting.
- **Timeouts per step**, with a decision about what a timeout means: is the
  payment maybe-succeeded? You need to query rather than assume.
- **Some steps can't be compensated.** A sent email, a shipped package. Order the
  saga so irreversible steps come *last*.
- **Surface partial states to the user** honestly ("payment received, shipping
  delayed") rather than pretending it's atomic.

On GCP, Workflows is a reasonable managed orchestrator for this.
</details>

<details>
<summary><b>4.</b> Should you use full event sourcing?</summary>

Usually no, and the honest reasons are worth stating.

**Yes when:** the audit trail is a hard requirement (finance, healthcare,
regulated domains); the business genuinely thinks in events (trading, ledgers,
booking); you need time travel as a feature; or you expect to build many
different read models from the same facts.

**No when:** your domain is CRUD-shaped; the team hasn't done it before (the
learning curve is steep and the mistakes are structural); you need ad-hoc queries
over current state (every read is a fold, so you need snapshots and projections);
or you have GDPR deletion requirements (deleting from an immutable log is genuinely
painful — the usual answer is crypto-shredding, which is its own project).

**The pragmatic middle**, and what this capsule builds: keep mutable state as the
source of truth *and* append an immutable event log. You get audit, integration
and replay, with none of the "every read is a fold" cost. Most teams that adopt
"event sourcing" successfully are actually doing this.
</details>

<details>
<summary><b>5.</b> How do you evolve an event schema with 12 consumers you don't control?</summary>

**You never break it.** Assume you cannot coordinate a simultaneous deploy,
because you can't.

- **Additive only** — new fields must be optional with sensible defaults.
- **Never remove, rename or re-type a field**, and never change a field's
  *meaning* while keeping its name. That last one is the sneakiest break.
- **New meaning → new event type.** Publish `PowerRecordedV2` alongside V1 for a
  deprecation window, then retire V1 once telemetry shows nothing consumes it.
  (Which means you need consumer telemetry.)
- **Consumers must ignore unknown fields.** Strict parsing turns every producer
  change into an outage.
- **Schema registry with compatibility checks** — Pub/Sub schemas or Confluent's
  registry — so an incompatible change fails at publish time, in CI, rather than
  in production.
- **Version in the payload** (Capsule 18) so consumers can branch when they must.
- **Announce and measure deprecations.** "V1 retires in 90 days" plus a dashboard
  of who's still using it.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Outbox rows never published | The relay isn't running, or `TOPIC_ID` is wrong. Check `attempts` and `last_error` — they're there for this. |
| Duplicate events after a relay restart | Expected: published-but-not-marked. Your idempotent consumer handles it. |
| Two relays process the same rows | You omitted `FOR UPDATE SKIP LOCKED`. |
| `wal_level` change has no effect | It needs a full restart, not `pg_reload_conf()`. |
| Disk filling up on the database | An inactive replication slot retaining WAL. Check `pg_replication_slots` and drop it. |
| Replay doubles the data | The consumer isn't idempotent. That's Capsule 19, and replay is exactly why it matters. |
| Outbox table enormous | Prune published rows: `DELETE FROM outbox WHERE published_at < now() - interval '7 days'`. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(events): transactional outbox and relay; CDC exploration

Capsule 21. Closes the dual-write gap from Capsule 18: business data and its
event now commit in one transaction, and a relay publishes with SKIP LOCKED
so it can run multiple instances. Verified events survive a broker outage.
Explored logical replication as CDC, including the slot-fills-the-disk trap.
Rebuilt a read model by replaying the outbox."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 21
```

**Next:** [Capsule 22 · Fusion Dance — Splitting the Monolith](../22-fusion-dance-microservices/README.md)
