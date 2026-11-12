# Capsule 19 · Cell's Absorption — Delivery Semantics & Idempotency

> *Cell absorbs Android 17, and then tries to absorb him again. Nothing happens
> — he already has him. That is idempotency: the second application of the same
> operation changes nothing. Cell's whole design assumes he will encounter the
> same target more than once, and he is built so that it does not matter.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 8 | 80 min | Capsule 18 | Local |

---

## Why this capsule exists

Capsule 18 ended with the same message being processed three times. That wasn't
a bug in the emulator — **it is the guarantee you actually have**, and no
messaging system in the world gives you a better one for free.

This capsule is about designing for that reality. It's short on new
infrastructure and long on a way of thinking that, once you have it, makes an
entire category of production bug disappear.

---

## The concept

### The three delivery semantics

| Semantics | Means | Reality |
|---|---|---|
| **At-most-once** | 0 or 1 deliveries | fire-and-forget; you lose messages |
| **At-least-once** | 1 or more | ✅ what you get. Duplicates happen |
| **Exactly-once** | exactly 1 | does not exist end-to-end |

**Why exactly-once is impossible:** the consumer must (a) do the work and
(b) acknowledge. These cannot be one atomic operation across a network.

```
  process → crash → ack never sent → REDELIVERED   (duplicate)
  ack → crash → work never done                     (loss)
```

There is no ordering of those two steps that is safe. You must choose which
failure to have.

What systems call "exactly-once" is always one of:

- **Effectively-once**: at-least-once delivery + an **idempotent consumer**.
  This is what you build, and it's genuinely correct.
- **Transactional processing**: consume and produce inside one transaction on the
  *same* system (Kafka's exactly-once semantics). Correct within that system's
  boundary; the moment you write to a database outside it, you're back to
  at-least-once.
- Pub/Sub's exactly-once *subscriptions*: a real feature that removes duplicates
  within the ack deadline, at the cost of throughput. It narrows the window; it
  does not remove your need for idempotency.

> **The engineering answer:** stop trying to prevent duplicates. Make them
> harmless.

### Idempotency, four ways

**1. Naturally idempotent operations.** Best case — nothing to do.

```sql
UPDATE fighters SET power = 9001 WHERE id = 1;   -- idempotent (absolute)
UPDATE fighters SET power = power + 100 ...;     -- NOT (relative)
```

Prefer setting absolute values over relative increments wherever you can.

**2. Unique constraints.** Let the database enforce it.

```sql
CREATE TABLE readings (
    event_id UUID PRIMARY KEY,   -- second insert of the same event fails
    ...
);
INSERT ... ON CONFLICT (event_id) DO NOTHING;
```

Cheap, airtight, and it works across processes and restarts. Usually the right
answer.

**3. A processed-messages table.** When the work isn't a single insert.

```sql
CREATE TABLE processed_events (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The critical part: **the work and the marker must be in the same transaction.**
Otherwise you can do the work, crash before recording it, and repeat it.

**4. Idempotency keys** (the API version). The client generates a key; the server
stores key → response and replays the stored response on a repeat.

```http
POST /payments
Idempotency-Key: 3f2b1a...
```

This is exactly how Stripe's API works, and it's the right pattern for any
non-idempotent endpoint a client might retry.

### The dual-write problem

The bug at the end of Capsule 18:

```go
  store.Record(reading)          // ✅ committed
  publisher.Publish(event)       // ✗ process dies here
```

Database updated, event never sent. Downstream never learns. There is **no
ordering of two independent writes that is safe** — publish first and you may
announce something that never happened.

The fixes:

- **Transactional outbox** (Capsule 21) — write the event into an `outbox` table
  *in the same transaction*, and a separate process publishes from it. The
  correct answer.
- **CDC** — read the database's replication log and derive events from it
  (Capsule 21).
- **Accept it, with reconciliation** — log the failure and run a periodic job
  that finds and re-emits missed events. Pragmatic, and honest about the gap.

### Dead-letter queues

A message that fails deterministically will fail forever. After N attempts, move
it aside:

```
  subscription ──(5 failed attempts)──► dead-letter topic ──► a human, or a fixer job
```

Rules that make DLQs actually work:

- **Every production subscription has one.** No exceptions.
- **Alert on depth > 0.** A DLQ nobody looks at is a silent data-loss channel.
- **Keep enough context to replay**: the original message, the error, the attempt
  count, the timestamp.
- **Distinguish permanent from transient failures.** A malformed payload should
  go to the DLQ on attempt 1; a database timeout should be retried.

### Ordering and duplicates interact

Redelivery breaks ordering: message 5 fails and is redelivered *after* message 6
succeeded. If your consumer isn't order-independent, you now have corrupted
state.

The robust pattern is **version checking** — the same idea as optimistic
concurrency:

```sql
UPDATE fighter_ranks
   SET power = $2, version = $3
 WHERE fighter = $1 AND version < $3;   -- older events are silently ignored
```

This gives you idempotency *and* order-independence in one line, without needing
the transport to guarantee anything. It's the single most useful pattern in this
capsule.

---

## Lab

### Step 1 — see a duplicate cause real damage

Give the ranker a non-idempotent handler — a running total, which is the most
common shape of this bug:

```sql
-- deploy/sql/002_ranks.sql
CREATE TABLE fighter_ranks (
    fighter        TEXT PRIMARY KEY,
    total_power    BIGINT      NOT NULL DEFAULT 0,
    reading_count  INT         NOT NULL DEFAULT 0,
    last_version   BIGINT      NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`internal/events/ranker_naive.go`**

```go
package events

import "context"

// HandleNaive is NOT idempotent. Every delivery adds to the total, so a
// redelivery silently corrupts the data — and nothing errors, which is what
// makes this class of bug so hard to find.
func (r *Ranker) HandleNaive(ctx context.Context, e PowerRecorded) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO fighter_ranks (fighter, total_power, reading_count)
		VALUES ($1, $2, 1)
		ON CONFLICT (fighter) DO UPDATE
		SET total_power   = fighter_ranks.total_power + EXCLUDED.total_power,
		    reading_count = fighter_ranks.reading_count + 1,
		    updated_at    = now()`,
		e.Fighter, e.Power)
	return err
}
```

Publish the same event twice, deliberately:

```bash
export PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber

EVENT='{"event_id":"11111111-1111-1111-1111-111111111111","fighter":"goku","power":9001,"version":1}'
B64=$(printf '%s' "$EVENT" | base64)

for i in 1 2 3; do
  curl -s -XPOST \
    "http://localhost:8085/v1/projects/gravity-chamber/topics/power-readings:publish" \
    -H 'Content-Type: application/json' \
    -d "{\"messages\":[{\"data\":\"$B64\"}]}" > /dev/null
done
```

```bash
psql "postgres://scouter:kamehameha@localhost:5432/scouter" -c \
  "SELECT fighter, total_power, reading_count FROM fighter_ranks;"
```

```
 fighter | total_power | reading_count
---------+-------------+---------------
 goku    |       27003 |             3
```

**One event. Three deliveries. Triple-counted.** No error was raised, no alert
fired, and the data is now wrong in a way that a later reconciliation would have
to detect. Sit with that for a moment — this is the shape of most
duplicate-processing incidents.

### Step 2 — idempotency via a processed table

**`internal/events/ranker.go`**

```go
package events

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Ranker struct {
	pool *pgxpool.Pool
}

func NewRanker(pool *pgxpool.Pool) *Ranker { return &Ranker{pool: pool} }

// Handle is idempotent: applying the same event twice has the same effect as
// applying it once.
//
// The essential detail is that the dedup marker and the work commit in the
// SAME transaction. Insert the marker separately and you can do the work,
// crash, and repeat it — which is exactly the bug you were trying to fix.
func (r *Ranker) Handle(ctx context.Context, e PowerRecorded) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	// Claim the event. If it's already there, someone (or a past self)
	// handled it: stop, and ack.
	tag, err := tx.Exec(ctx,
		`INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`,
		e.EventID)
	if err != nil {
		return fmt.Errorf("claim: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil // duplicate — already applied. Not an error.
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO fighter_ranks (fighter, total_power, reading_count)
		VALUES ($1, $2, 1)
		ON CONFLICT (fighter) DO UPDATE
		SET total_power   = fighter_ranks.total_power + EXCLUDED.total_power,
		    reading_count = fighter_ranks.reading_count + 1,
		    updated_at    = now()`,
		e.Fighter, e.Power); err != nil {
		return fmt.Errorf("apply: %w", err)
	}

	return tx.Commit(ctx)
}
```

Add the table:

```sql
-- deploy/sql/003_processed_events.sql
CREATE TABLE processed_events (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- This table grows forever unless you prune it. The retention must exceed
-- the broker's message retention (Pub/Sub: 7 days) or you can un-dedupe a
-- message that gets redelivered from the backlog.
CREATE INDEX idx_processed_events_time ON processed_events (processed_at);
```

Reset and re-run the triple publish:

```bash
psql "postgres://scouter:kamehameha@localhost:5432/scouter" \
  -c "TRUNCATE fighter_ranks, processed_events;"
# publish the same event 3x again
psql "postgres://scouter:kamehameha@localhost:5432/scouter" \
  -c "SELECT fighter, total_power, reading_count FROM fighter_ranks;"
```

```
 fighter | total_power | reading_count
---------+-------------+---------------
 goku    |        9001 |             1
```

**Three deliveries, one application.** Effectively-once, built out of
at-least-once plus a unique constraint.

### Step 3 — the better pattern: version checks

The processed-events table works but grows forever. When your events carry a
monotonic version per entity, you get idempotency *and* order-independence for
free:

```go
// HandleVersioned is idempotent AND order-independent. An out-of-order or
// duplicate event simply doesn't match the WHERE clause and is ignored.
//
// This is strictly better than a processed-events table when you have a
// natural version: no extra table, no growth, no pruning, and redelivery
// after a newer event is handled correctly rather than corrupting state.
func (r *Ranker) HandleVersioned(ctx context.Context, e PowerRecorded) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO fighter_ranks (fighter, total_power, reading_count, last_version)
		VALUES ($1, $2, 1, $3)
		ON CONFLICT (fighter) DO UPDATE
		SET total_power   = EXCLUDED.total_power,
		    last_version  = EXCLUDED.last_version,
		    updated_at    = now()
		WHERE fighter_ranks.last_version < EXCLUDED.last_version`,
		e.Fighter, e.Power, e.RecordedAt.UnixNano())
	return err
}
```

Two things changed besides the `WHERE`, and both are deliberate. First,
`total_power` is now **set**, not added to: a version check only works for "set
to this state" updates (drill 5), because a running total can't ignore an old
event without losing it. So in this variant the column holds the fighter's
*latest* power (the name is left over from Step 1) and `reading_count` stays
at 1. If you need a real total, that's a delta, and deltas need Step 2's
processed-events table.

Second, the version is `recorded_at` in nanoseconds, **not** the `"version"`
field in the event JSON, which is Capsule 18's *schema* version. That matters
if you reuse Step 1's hand-written event to try this: it has no `recorded_at`,
so Go decodes the zero time, `UnixNano()` returns a huge negative number, and
against the row Step 2 left behind (`last_version = 0`) the update silently
matches nothing. Test with events from the real publisher, or add
`"recorded_at":"2026-01-01T00:00:00Z"` to the JSON.

Test it properly — this is a test worth having in a real codebase:

**`internal/events/ranker_test.go`**

```go
package events

import "testing"

func TestVersionOrdering(t *testing.T) {
	// Documents the intended semantics without needing a database.
	cases := []struct {
		name      string
		current   int64
		incoming  int64
		wantApply bool
	}{
		{"first event", 0, 100, true},
		{"newer event", 100, 200, true},
		{"duplicate", 200, 200, false},
		{"out of order (older)", 200, 150, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.current < c.incoming; got != c.wantApply {
				t.Errorf("apply = %v, want %v", got, c.wantApply)
			}
		})
	}
}
```

### Step 4 — a dead-letter queue

```bash
# a DLQ topic and a subscription to inspect it
curl -s -XPUT "http://localhost:8085/v1/projects/gravity-chamber/topics/power-readings-dlq"
curl -s -XPUT "http://localhost:8085/v1/projects/gravity-chamber/subscriptions/dlq-inspector" \
  -H 'Content-Type: application/json' \
  -d '{"topic":"projects/gravity-chamber/topics/power-readings-dlq"}'

# attach the DLQ to the main subscription
curl -s -X PATCH "http://localhost:8085/v1/projects/gravity-chamber/subscriptions/ranker" \
  -H 'Content-Type: application/json' \
  -d '{
    "subscription": {
      "name": "projects/gravity-chamber/subscriptions/ranker",
      "topic": "projects/gravity-chamber/topics/power-readings",
      "deadLetterPolicy": {
        "deadLetterTopic": "projects/gravity-chamber/topics/power-readings-dlq",
        "maxDeliveryAttempts": 5
      }
    },
    "updateMask": "deadLetterPolicy"
  }'
```

Now classify failures in the consumer — the distinction that makes a DLQ useful:

```go
// Two kinds of failure, two different responses.
type PermanentError struct{ Err error }

func (e PermanentError) Error() string { return "permanent: " + e.Err.Error() }
func (e PermanentError) Unwrap() error { return e.Err }

// in the Receive callback (dlq := client.Topic("power-readings-dlq"),
// created once, next to sub):
	if err := handle(ctx, e); err != nil {
		var perm PermanentError
		if errors.As(err, &perm) {
			// Retrying will NEVER help: malformed payload, unknown schema
			// version, a business rule that rejects it. Send it to the DLQ
			// now instead of burning 5 attempts.
			log.Error("permanent failure, dead-lettering",
				"event_id", e.EventID, "err", err)
			// Copy it aside FIRST, and wait for the broker to confirm.
			// Ack first and a failed publish loses the message for good.
			res := dlq.Publish(ctx, &pubsub.Message{
				Data:       m.Data,
				Attributes: map[string]string{"error": err.Error()},
			})
			if _, perr := res.Get(ctx); perr != nil {
				log.Error("dead-letter publish failed, nacking",
					"event_id", e.EventID, "err", perr)
				m.Nack() // redelivered; maxDeliveryAttempts is the backstop
				return
			}
			m.Ack() // the copy is safe; now let go of the original
			return
		}
		// Transient: database timeout, cache down, network blip. Retry.
		log.Warn("transient failure, nacking", "event_id", e.EventID,
			"attempt", deliveryAttempt(m), "err", err)
		m.Nack()
		return
	}
```

Poison a message and watch:

```bash
BAD=$(printf '%s' '{"event_id":"not-a-uuid","fighter":"","power":-5}' | base64)
curl -s -XPOST \
  "http://localhost:8085/v1/projects/gravity-chamber/topics/power-readings:publish" \
  -H 'Content-Type: application/json' -d "{\"messages\":[{\"data\":\"$BAD\"}]}"

# it fails, retries, and lands in the DLQ
curl -s -XPOST \
  "http://localhost:8085/v1/projects/gravity-chamber/subscriptions/dlq-inspector:pull" \
  -H 'Content-Type: application/json' -d '{"maxMessages":10}' | jq
```

### Step 5 — an idempotency key on the API

Same problem, HTTP flavour. A user double-clicks; a mobile client retries on a
flaky network.

```go
// Idempotent POST: the client supplies a key; we store key -> response and
// replay it on repeats. This is how Stripe's API works, and it is the right
// pattern for any non-idempotent endpoint a client might retry.
func (s *Server) handleRecord(w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get("Idempotency-Key")
	if key != "" {
		if cached, ok := s.idem.Get(key); ok {
			w.Header().Set("Idempotency-Replayed", "true")
			writeJSON(w, http.StatusCreated, cached)
			return
		}
	}

	// … decode, validate, store as before …

	if key != "" {
		s.idem.Put(key, rd, 24*time.Hour)
	}
	writeJSON(w, http.StatusCreated, rd)
}
```

```bash
KEY=$(uuidgen)
for i in 1 2 3; do
  curl -si -XPOST localhost:8080/readings \
    -H "Idempotency-Key: $KEY" \
    -d '{"fighter":"goku","power":9001}' | grep -E 'HTTP/|Idempotency-Replayed'
done
```

One record created; three identical responses.

> **Two subtleties for production:** the key must be stored *durably* (Redis or
> the database, not in-process, or a different replica won't see it — Capsule
> 06), and you must handle the **concurrent** case where two requests with the
> same key arrive simultaneously. Insert the key with a "in progress" state
> first, using a unique constraint, so the second request waits or gets a `409`.

---

## In GCP

- **Pub/Sub exactly-once subscriptions** (`--enable-exactly-once-delivery`)
  genuinely remove duplicates within the ack deadline. Lower throughput, and
  **it does not make your handler idempotent** — a crash after your database
  write but before the ack still redelivers. Use it as defence in depth, never
  as a substitute.
- **Dead-letter topics** need `roles/pubsub.publisher` on the DLQ topic and
  `roles/pubsub.subscriber` on the source subscription, both granted to the
  Pub/Sub service agent. Forgetting this is why DLQs silently don't work.
- **Retry policy**: `--min-retry-delay` / `--max-retry-delay` give exponential
  backoff between redeliveries — the same idea as Capsule 17, at the transport.
- **Cloud Tasks** has built-in dedup: a task name that already existed is
  rejected for ~1 hour. Useful, but that window is a real constraint.
- **BigQuery streaming inserts** accept an `insertId` for dedup within a few
  minutes. Again: narrows the window, doesn't close it.

---

## Bring it to work

- **Assume duplicates. Always.** Design the handler, not the transport.
- **Every event carries a stable, unique `event_id`** generated by the producer,
  not the broker.
- **Dedup marker and work commit in the same transaction.** This is the detail
  that makes or breaks the pattern.
- **Prefer a version check over a processed-events table** when you have a
  natural version — it handles out-of-order too, and it doesn't grow.
- **Prune `processed_events`**, with retention longer than the broker's.
- **A DLQ on every subscription, and an alert on depth > 0.**
- **Classify permanent vs transient failures.** Retrying a malformed payload
  five times helps nobody.
- **`Idempotency-Key` on every non-idempotent public endpoint.**

---

## Battle drill

<details>
<summary><b>1.</b> A vendor says their queue offers exactly-once delivery. What do you ask?</summary>

"Exactly-once *within what boundary*?"

If it means consume-and-produce inside their own system atomically (Kafka's
transactional EOS), that's real and useful — within that system. The moment your
consumer writes to Postgres, sends an email or calls an API, that external effect
is outside the transaction and you're back to at-least-once.

Then: "what happens if my consumer commits to my database and crashes before
acking?" There is no answer that avoids redelivery. That question ends the
conversation honestly.

The useful framing: exactly-once *delivery* is impossible; exactly-once
*processing* is achievable, and it's achieved by the consumer being idempotent,
not by the transport.
</details>

<details>
<summary><b>2.</b> Why must the dedup marker and the work be in one transaction?</summary>

Consider the alternatives:

**Marker first, work second** — insert the marker, crash, work never happens. The
message is now deduped as "processed" and will never be retried. **Silent data
loss**, and the worst outcome of the three.

**Work first, marker second** — do the work, crash, marker not written. Redelivery
repeats the work. Back to the original bug.

**Both in one transaction** — either both commit or neither does. On crash,
nothing happened and redelivery does it cleanly.

This is why the work must live in the same database as the marker. If the work is
an external API call, you cannot have this property, and you need a different
approach: make the external call idempotent with a key derived from the event id,
or use a saga with compensation.
</details>

<details>
<summary><b>3.</b> Design idempotency for "send a welcome email".</summary>

Email is external, so no transaction spans it. You need the *provider* to
deduplicate, or you need to accept a small risk.

- **Best:** use a provider that supports an idempotency key (most transactional
  email APIs do) derived deterministically from the event: `welcome:{user_id}`.
  The provider drops the repeat.
- **Otherwise:** a `sent_emails` table with `PRIMARY KEY (user_id, template)`.
  Insert *before* sending, in a transaction that also claims the work. If the
  send fails, decide deliberately whether to roll back (risking duplicate send)
  or keep the row (risking a never-sent email plus an alert).
- **Reduce the blast radius:** make the send fast so the crash window is tiny.
- **Accept the residual risk:** a duplicate welcome email is mildly embarrassing.
  A duplicate *invoice* is not — for those, pay for the stronger guarantee.

The general lesson: **when the effect is external, idempotency must be pushed to
the system that owns the effect.**
</details>

<details>
<summary><b>4.</b> Your DLQ has 50,000 messages. What now?</summary>

**Don't replay them yet.** First understand.

1. **Sample and classify** — pull 20, group by error. Usually 50,000 messages are
   two or three distinct causes.
2. **Was it a deploy?** Correlate the DLQ's growth with deploy times. A schema
   change that consumers couldn't parse is the classic cause.
3. **Assess the damage** — what didn't happen? Missing notifications are
   different from missing financial postings.
4. **Fix the consumer**, deploy, and verify against a few messages first.
5. **Replay in a controlled way** — a dedicated replay job, rate-limited so you
   don't overwhelm a recovering system, and **relying on the idempotency you
   built** so replaying something already processed is safe.
6. **Postmortem:** why did the alert not fire at message 1? A DLQ alarm that only
   fires at 50,000 is not an alarm.

Retention matters: if the DLQ's retention is 7 days and this is day 6, priorities
change.
</details>

<details>
<summary><b>5.</b> Compare a processed-events table with a version-check update.</summary>

**Processed-events table:** works for any event, including ones with no natural
ordering. Costs an extra table that grows forever and must be pruned; requires a
transaction spanning the marker and the work; doesn't help with out-of-order
delivery (an old event still applies, it just applies once).

**Version check:** no extra table, no growth, no pruning. Handles duplicates
*and* out-of-order delivery in one `WHERE` clause. Requires a monotonic version
per entity (a timestamp, a sequence number, a CDC log position) and only works
when the update is a "set to this state" rather than "apply this delta".

**Use version checks** for state-replication-shaped work — projections,
denormalised views, caches, search indexes. That covers most consumers.

**Use a processed-events table** for side effects and deltas: "increment a
counter", "charge a card", "send a notification".

Many systems use both: version checks for projections, processed-events for
effects.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Duplicates still applied | The marker insert isn't in the same transaction as the work, or `RowsAffected()` isn't being checked. |
| `processed_events` grows unbounded | Add a pruning job. Retention > broker retention (7 days for Pub/Sub). |
| DLQ stays empty despite failures | The Pub/Sub service agent lacks publish permission on the DLQ topic. In the emulator, DLQ support is partial — verify on real Pub/Sub. |
| Idempotency key works locally, fails in prod | You stored it in process memory. Multiple replicas (Capsule 06). Use Redis or the database. |
| Two concurrent requests with the same key both create | You checked-then-inserted without a unique constraint. Insert first, let the constraint arbitrate. |
| Version check never applies anything | `last_version` was initialised higher than incoming versions, or you're comparing different units (ns vs s). |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "fix(events): idempotent consumer, DLQ, and API idempotency keys

Capsule 19. Reproduced triple-counting from at-least-once delivery. Dedup
marker now commits in the same transaction as the work. Added a version-check
variant that is idempotent AND order-independent. Dead-letter policy with
permanent-vs-transient classification. Idempotency-Key on POST /readings."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 19
```

**Next:** [Capsule 20 · Spirit Bomb — Fan-in, Fan-out & Batch](../20-spirit-bomb-fan-in-out/README.md)
