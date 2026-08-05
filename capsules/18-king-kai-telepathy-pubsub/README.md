# Capsule 18 · King Kai's Telepathy — Pub/Sub

> *King Kai links minds across galaxies. He speaks once and everyone he has
> linked hears it. He does not know or care who is listening, nobody has to be
> in the same place, and adding another listener changes nothing for the
> speaker. That is publish/subscribe, and it is why the Z Fighters can
> coordinate a plan across two planets.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 7 | 85 min | Capsules 10, 17 | Local + ☁️ optional |

---

## Why this capsule exists

Every service you've built so far is synchronous: a request comes in, you do all
the work, you respond. That model has a hard limit — **the caller waits for
everything, and fails if anything fails.**

Consider recording a power reading. Today: write to the database, respond. Soon
it should also update a leaderboard, notify followers, run fraud checks, feed
analytics and update a search index. Synchronously, that's a 2-second request
that fails if the notification service is down.

Messaging decouples *what happened* from *what should happen because of it*.
It's the single biggest architectural shift in this repo.

---

## The concept

### Queue vs topic

```
  QUEUE (point-to-point)          TOPIC (publish/subscribe)

  producer → [queue] → consumer   publisher → [topic] ─┬→ sub A → consumer A
                                                       ├→ sub B → consumer B
  one message, ONE consumer                            └→ sub C → consumer C
  work distribution                 one message, EVERY subscription gets a copy
                                    event broadcast
```

**Google Cloud Pub/Sub is both**, and the distinction lives in the
*subscription*, which is the thing people get wrong:

- One subscription with many consumer instances → **competing consumers**, work
  is distributed (queue semantics).
- Many subscriptions on one topic → each gets its own copy (fan-out).

So "how many subscriptions?" is the design question. One per *consuming
concern*, not one per consumer instance.

### What decoupling actually buys

| | Synchronous | Asynchronous |
|---|---|---|
| Caller waits for | everything | just the publish |
| A consumer is down | request fails | messages wait |
| Adding a consumer | change the producer | add a subscription |
| Traffic spike | everything must scale now | the queue absorbs it |
| Debugging | one stack trace | distributed, harder |
| Consistency | immediate | eventual |

**The queue as a shock absorber** is often the biggest win: a 10× traffic burst
becomes a growing backlog that drains over the next few minutes, instead of an
outage.

### Push vs pull

| | Pull | Push |
|---|---|---|
| How | consumer requests messages | Pub/Sub POSTs to your HTTPS endpoint |
| Flow control | consumer decides its own rate | Pub/Sub adapts to your response times |
| Fits | workers, batch, high throughput, Cloud Run jobs | Cloud Run/Functions services, scale-to-zero |
| Backpressure | natural — pull less | Pub/Sub slows down on 429/5xx |

Push is elegant with Cloud Run: no consumer running until a message arrives, and
Pub/Sub handles the retries. Pull gives you finer control and generally higher
throughput.

**Streaming pull** (the default in the Go client) keeps an open gRPC stream and
delivers messages as they arrive — low latency, high throughput.

### Ack deadlines

When a consumer receives a message it has an **ack deadline** (default 10 s) to
confirm. If it doesn't ack in time, the message is **redelivered** — possibly to
a different consumer.

```
  receive ──► process ──► ack        ✅ done
  receive ──► process ──✗ (crash)    → redelivered after the deadline
  receive ──► process (too slow)     → REDELIVERED WHILE STILL PROCESSING
                                        ↑ you are now running it twice
```

That last case is the one that bites: work that takes longer than the ack
deadline gets processed repeatedly and never completes. Fixes: extend the
deadline (the Go client does this automatically while your handler runs), raise
the subscription's default, or — best — make the handler fast by doing the slow
part elsewhere.

**Nack explicitly** on failure instead of waiting for the deadline. Immediate
redelivery beats a 10-second stall.

### Ordering

Pub/Sub does **not** guarantee order by default, and this is the correct default
— global ordering requires a single point of serialisation, which caps
throughput.

**Ordering keys** give per-key ordering: messages with the same key are
delivered in publish order. All messages for `fighter:goku` stay ordered
relative to each other; different fighters are independent and still parallel.

The cost: ordering keys are pinned to a region, and a stuck message blocks
everything behind it *for that key*.

**Usually you shouldn't need ordering.** Design events so order doesn't matter —
include a version or timestamp and have consumers ignore stale ones. That's more
robust than requiring the transport to solve it.

### Backlog is the best autoscaling signal there is

For a request/response service, concurrency is the signal (Capsule 06). For a
consumer it's **`num_undelivered_messages`** — the backlog:

- Backlog growing → consumers can't keep up → scale up.
- Backlog empty → scale to zero.
- **Oldest unacked message age** → your real end-to-end lag, and the thing to
  alert on.

Backlog is a leading indicator; CPU is a lagging one. This is why queue-driven
autoscaling (KEDA on Kubernetes, Cloud Run's Pub/Sub triggers) works so well.

---

## Lab

### Step 1 — the Pub/Sub emulator

Google ships a local emulator. Free, offline, and the same API.

Add to **`deploy/docker-compose.yml`**:

```yaml
  pubsub:
    image: gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators
    command: >
      gcloud beta emulators pubsub start
        --project=gravity-chamber
        --host-port=0.0.0.0:8085
    ports: ["8085:8085"]
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8085 || exit 1"]
      interval: 3s
      retries: 20
```

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d pubsub
sleep 10
curl -s localhost:8085   # "Ok"
```

The client library switches to the emulator purely via an environment variable —
**no code changes**, which is the point:

```bash
export PUBSUB_EMULATOR_HOST=localhost:8085
export PUBSUB_PROJECT_ID=gravity-chamber
```

### Step 2 — publish

```bash
go get cloud.google.com/go/pubsub
```

**`internal/events/publisher.go`**

```go
// Package events is the messaging boundary. Nothing outside it should know
// which broker is in use.
package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"cloud.google.com/go/pubsub"
)

// PowerRecorded is an EVENT: a statement of fact about something that already
// happened, in the past tense. Not a command ("UpdateLeaderboard") — the
// publisher must not know or care who reacts to it.
type PowerRecorded struct {
	EventID    string    `json:"event_id"`   // for idempotency (Capsule 19)
	Fighter    string    `json:"fighter"`
	Power      int64     `json:"power"`
	RecordedAt time.Time `json:"recorded_at"`
	Version    int       `json:"version"`    // schema version, from day one
}

type Publisher struct {
	client *pubsub.Client
	topic  *pubsub.Topic
	log    *slog.Logger
}

func NewPublisher(ctx context.Context, projectID, topicID string, log *slog.Logger) (*Publisher, error) {
	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("pubsub client: %w", err)
	}

	topic := client.Topic(topicID)
	ok, err := topic.Exists(ctx)
	if err != nil {
		return nil, fmt.Errorf("topic exists: %w", err)
	}
	if !ok {
		if topic, err = client.CreateTopic(ctx, topicID); err != nil {
			return nil, fmt.Errorf("create topic: %w", err)
		}
	}

	// REQUIRED because we set an OrderingKey below. Without it, every single
	// Publish fails with "EnableMessageOrdering=false, but an OrderingKey was
	// set" — and since we deliberately log-and-continue on publish errors, the
	// API still returns 201 and you get NO events with no obvious cause.
	// This is a publisher-side client setting; creating the topic is not enough.
	topic.EnableMessageOrdering = true

	// Batching trades a little latency for a lot of throughput.
	topic.PublishSettings.DelayThreshold = 20 * time.Millisecond
	topic.PublishSettings.CountThreshold = 100

	return &Publisher{client: client, topic: topic, log: log}, nil
}

func (p *Publisher) Close() {
	p.topic.Stop() // flushes buffered messages — do not skip this
	_ = p.client.Close()
}

func (p *Publisher) PublishPowerRecorded(ctx context.Context, e PowerRecorded) error {
	body, err := json.Marshal(e)
	if err != nil {
		return err
	}

	res := p.topic.Publish(ctx, &pubsub.Message{
		Data: body,
		// Attributes are filterable by subscriptions WITHOUT decoding the
		// body — put routing metadata here, not in the payload.
		Attributes: map[string]string{
			"event_type": "power.recorded",
			"fighter":    e.Fighter,
			"version":    "1",
		},
		// Same key => same order. Different fighters stay parallel.
		OrderingKey: e.Fighter,
	})

	// Publish is async; Get blocks for the server ack. Doing this inline
	// makes the publish synchronous from the caller's point of view — which
	// is what you want when the caller must know the event was accepted.
	id, err := res.Get(ctx)
	if err != nil {
		return fmt.Errorf("publish: %w", err)
	}
	p.log.Debug("published", "message_id", id, "fighter", e.Fighter)
	return nil
}
```

Now give the server somewhere to put it. **Define the interface in
`internal/scouter`, not in `internal/events`** — that way the service package
never imports the pubsub client, and the seam stays testable with a two-line
fake:

**`internal/scouter/server.go`**

```go
// Publisher is OUR interface, declared where it is USED. internal/events
// satisfies it without ever being imported here.
type Publisher interface {
	PublishPowerRecorded(ctx context.Context, fighter string, power int64, at time.Time) error
}

type Server struct {
	// …
	pub Publisher
}

// SetPublisher is optional by design: the service is fully functional without
// events. Nothing about recording a reading should depend on a message broker
// being up.
func (s *Server) SetPublisher(p Publisher) { s.pub = p }
```

And wire it in `cmd/scouter/main.go`, the same optional-dependency shape as the
cache and the replicas:

```go
	if proj := os.Getenv("PUBSUB_PROJECT_ID"); proj != "" {
		pub, err := events.NewPublisher(context.Background(), proj,
			getenv("TOPIC_ID", "power-readings"), log)
		if err != nil {
			log.Error("pubsub unavailable", "err", err)
			os.Exit(1)
		}
		defer pub.Close()
		srv.SetPublisher(pub)
		log.Info("event publishing enabled", "project", proj)
	}
```

Now hook it into `Record`. **Note the ordering — database first, then publish:**

```go
// in the handler, after a successful store.Record(...)
	if s.pub != nil {
		ev := events.PowerRecorded{
			EventID:    uuid.NewString(),
			Fighter:    rd.Fighter,
			Power:      rd.Power,
			RecordedAt: rd.RecordedAt,
			Version:    1,
		}
		if err := s.pub.PublishPowerRecorded(r.Context(), ev); err != nil {
			// The write succeeded and the event did not. The data is correct
			// but downstream will never learn about it. This is the "dual
			// write problem" and Capsule 21 fixes it properly with an outbox.
			s.log.Error("event publish failed after commit", "err", err,
				"fighter", rd.Fighter)
		}
	}
```

Read that comment carefully — it's the seam that Capsule 21 exists to close.

### Step 3 — a consumer

**`cmd/ranker/main.go`** — a second binary. `cmd/` from Capsule 00 pays off.

```go
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"cloud.google.com/go/pubsub"
	"github.com/<your-username>/gravity-chamber/internal/events"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	projectID := os.Getenv("PUBSUB_PROJECT_ID")
	subID := os.Getenv("SUBSCRIPTION_ID")
	if projectID == "" || subID == "" {
		log.Error("PUBSUB_PROJECT_ID and SUBSCRIPTION_ID are required")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		log.Error("pubsub client", "err", err)
		os.Exit(1)
	}
	defer client.Close()

	sub := client.Subscription(subID)

	// Flow control bounds how much work is in flight. Without it, a large
	// backlog is pulled into memory all at once and you OOM — the async
	// equivalent of an unbounded queue (Capsule 17).
	sub.ReceiveSettings.MaxOutstandingMessages = 100
	sub.ReceiveSettings.MaxOutstandingBytes = 32 * 1024 * 1024
	sub.ReceiveSettings.NumGoroutines = 4

	var processed atomic.Uint64
	log.Info("ranker online", "subscription", subID)

	// Receive blocks until ctx is cancelled, running the callback
	// concurrently for each message.
	err = sub.Receive(ctx, func(ctx context.Context, m *pubsub.Message) {
		var e events.PowerRecorded
		if err := json.Unmarshal(m.Data, &e); err != nil {
			// A message we can NEVER parse must not be retried forever.
			// Ack it so it leaves the subscription, and log loudly.
			// Capsule 19 sends these to a dead-letter topic instead.
			log.Error("undecodable message, dropping",
				"id", m.ID, "err", err, "data", string(m.Data))
			m.Ack()
			return
		}

		if err := handle(ctx, e); err != nil {
			log.Warn("handler failed, nacking for redelivery",
				"event_id", e.EventID, "err", err)
			m.Nack() // explicit nack = immediate redelivery, not a 10s stall
			return
		}

		n := processed.Add(1)
		log.Info("ranked",
			"event_id", e.EventID,
			"fighter", e.Fighter,
			"power", e.Power,
			"delivery_attempt", deliveryAttempt(m),
			"publish_lag_ms", time.Since(m.PublishTime).Milliseconds(),
			"total", n,
		)
		m.Ack()
	})
	if err != nil {
		log.Error("receive stopped", "err", err)
		os.Exit(1)
	}
	log.Info("ranker offline", "processed", processed.Load())
}

func handle(ctx context.Context, e events.PowerRecorded) error {
	// Real work goes here: update a Redis sorted set, recompute a rank, etc.
	// It MUST be idempotent — this may be the second time you've seen this
	// exact event. That is Capsule 19.
	select {
	case <-time.After(50 * time.Millisecond):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func deliveryAttempt(m *pubsub.Message) int {
	if a := m.DeliveryAttempt; a != nil {
		return *a
	}
	return 1
}
```

### Step 4 — run the whole thing

```bash
# terminal 1: emulator already running via compose
export PUBSUB_EMULATOR_HOST=localhost:8085
export PUBSUB_PROJECT_ID=gravity-chamber

# create the subscription (idempotent helper — put it in scripts/)
cat > scripts/pubsub-setup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
: "${PUBSUB_EMULATOR_HOST:?set PUBSUB_EMULATOR_HOST}"
P="${PUBSUB_PROJECT_ID:-gravity-chamber}"
TOPIC="${1:-power-readings}"
SUB="${2:-ranker}"

curl -s -XPUT "http://$PUBSUB_EMULATOR_HOST/v1/projects/$P/topics/$TOPIC" >/dev/null
curl -s -XPUT "http://$PUBSUB_EMULATOR_HOST/v1/projects/$P/subscriptions/$SUB" \
  -H 'Content-Type: application/json' \
  -d "{\"topic\":\"projects/$P/topics/$TOPIC\",\"ackDeadlineSeconds\":10}" >/dev/null
echo "topic=$TOPIC sub=$SUB ready"
EOF
chmod +x scripts/pubsub-setup.sh
./scripts/pubsub-setup.sh
```

```bash
# terminal 2: the consumer
PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber \
  SUBSCRIPTION_ID=ranker go run ./cmd/ranker

# terminal 3: the producer
PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber \
  TOPIC_ID=power-readings \
  DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" \
  make run

# terminal 4
for f in goku vegeta piccolo krillin frieza; do
  curl -s -XPOST localhost:8080/readings -d "{\"fighter\":\"$f\",\"power\":$((RANDOM*10))}" >/dev/null
done
```

Terminal 2 shows the events arriving. **The API responded before the ranker did
any work.** That's the decoupling.

> ### ⏸ Natural stopping point
>
> Everything above stands on its own — commit it and come back. The steps below
> build on it but don't destabilise anything if you stop here. Two 45-minute
> sittings beat one 90-minute slog you don't finish.

### Step 5 — the properties that matter

**Consumer down → messages wait.**

```bash
# stop the ranker (Ctrl-C in terminal 2)
for i in $(seq 1 20); do
  curl -s -XPOST localhost:8080/readings -d '{"fighter":"cell","power":900000}' >/dev/null
done
# the API is completely unaffected — 20 fast 201s

# check the backlog
curl -s "http://localhost:8085/v1/projects/gravity-chamber/subscriptions/ranker" | jq

# restart the ranker: it drains the backlog
```

**Fan-out: add a consumer without touching the producer.**

```bash
./scripts/pubsub-setup.sh power-readings notifier

PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber \
  SUBSCRIPTION_ID=notifier go run ./cmd/ranker
```

Now publish again — **both** subscriptions receive every message.
The producer was not redeployed, restarted or informed. That is the property
that makes event-driven architecture worth its costs.

**Competing consumers: same subscription, more instances.**

```bash
# three instances on the SAME subscription
for i in 1 2 3; do
  PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber \
    SUBSCRIPTION_ID=ranker go run ./cmd/ranker &
done

for i in $(seq 1 60); do
  curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}' >/dev/null
done
```

The work is *distributed*, not duplicated. **Same topic, one subscription =
queue. Same topic, many subscriptions = fan-out.** That one sentence is the
mental model.

### Step 6 — blow through the ack deadline

Change `handle` to sleep 30 seconds (deadline is 10):

```go
	case <-time.After(30 * time.Second):
```

Publish one message and watch:

```
  ranked  delivery_attempt=1
  ranked  delivery_attempt=2      ← the SAME message, again
  ranked  delivery_attempt=3
```

**One publish, three deliveries, three executions.** If `handle` charged a credit
card, you charged it three times.

Now note that the Go client *does* extend the deadline automatically while your
callback runs — so to see this cleanly you may need to lower
`sub.ReceiveSettings.MaxExtension` to a few seconds. Do that, observe it, then
set it back.

Two lessons: **at-least-once delivery is the reality**, and **long work does not
belong in a message handler** — record the intent and let something else do it.

Capsule 19 is entirely about making this safe.

```bash
cd deploy && docker compose down
```

---

## In GCP

> ### ☁️ Optional: real Pub/Sub
> **Free tier: 10 GiB of message throughput per month.** This lab is a few
> kilobytes. Genuinely free — and worth doing once so the emulator doesn't hide
> anything from you.

```bash
gcloud services enable pubsub.googleapis.com

gcloud pubsub topics create power-readings
gcloud pubsub subscriptions create ranker \
  --topic=power-readings \
  --ack-deadline=30 \
  --message-retention-duration=7d \
  --expiration-period=never

# publish and pull by hand
gcloud pubsub topics publish power-readings \
  --message='{"event_id":"1","fighter":"goku","power":9001}' \
  --attribute=event_type=power.recorded

gcloud pubsub subscriptions pull ranker --auto-ack --limit=5
```

Your Go code needs **no changes** — just unset `PUBSUB_EMULATOR_HOST` and use
real credentials (`gcloud auth application-default login`).

**Filtering** — one topic, subscriptions that only see what they care about:

```bash
gcloud pubsub subscriptions create saiyans-only \
  --topic=power-readings \
  --message-filter='attributes.fighter = "goku" OR attributes.fighter = "vegeta"'
```

Filters run on **attributes only**, not the payload — which is why routing
metadata goes in attributes.

**Push to Cloud Run:**

```bash
gcloud pubsub subscriptions create ranker-push \
  --topic=power-readings \
  --push-endpoint="https://ranker-xyz.run.app/events" \
  --push-auth-service-account=ranker-sa@$PROJECT.iam.gserviceaccount.com
```

The service account makes Pub/Sub send a signed OIDC token, so your endpoint can
verify the request really came from Pub/Sub (Capsule B3). Combined with
`--no-allow-unauthenticated`, the endpoint isn't publicly callable at all.

**Teardown:**

```bash
gcloud pubsub subscriptions delete ranker saiyans-only ranker-push --quiet
gcloud pubsub topics delete power-readings --quiet
```

**Related products:** **Cloud Tasks** (targeted, per-task scheduling and rate
control — better for "call this endpoint later"), **Eventarc** (routes GCP
service events into Cloud Run), **Pub/Sub Lite** (cheaper, zonal, you manage
capacity).

---

## Bring it to work

- **Events are facts in the past tense.** `PowerRecorded`, not
  `UpdateLeaderboard`. Commands couple; facts don't.
- **Version every event schema from message one.** Retrofitting a version field
  onto a topic with live consumers is miserable.
- **Routing metadata goes in attributes**, so subscriptions can filter without
  decoding.
- **One subscription per consuming concern**, not per instance.
- **Set flow control.** Unbounded prefetch is an OOM waiting for a backlog.
- **Nack explicitly** on failure. Don't burn the ack deadline.
- **Alert on oldest-unacked-message age**, not just backlog size. It's your real
  end-to-end lag.
- **Keep handlers fast.** Long work belongs behind another queue or in a job.
- **The publish-after-commit gap is real.** Know it exists; Capsule 21 fixes it.

---

## Battle drill

<details>
<summary><b>1.</b> When should an operation be asynchronous rather than synchronous?</summary>

**Async when:** the caller doesn't need the result (send an email, update an
index, emit analytics); the work is slow or variable (video transcoding, report
generation); the work can fail and be retried without the user caring; you need
to absorb bursts; or multiple independent consumers care about the same event.

**Sync when:** the caller needs the result to continue; the user is watching and
expects immediate confirmation; it's a read; or it must be strongly consistent
with something else.

**The test:** *"if this step failed, should the user's request fail?"* If no,
it's a candidate for async.

**The cost you're accepting:** eventual consistency, harder debugging, duplicate
delivery, and ordering questions. Not free — just usually worth it.
</details>

<details>
<summary><b>2.</b> Your consumer processes 100 msg/s; the producer publishes 500 msg/s. What happens, and what do you do?</summary>

The backlog grows by 400/s — 1.4 million messages an hour. Pub/Sub retains them
(default 7 days), so nothing is lost, but end-to-end lag grows without bound and
your data is increasingly stale.

**Scale consumers**: add instances on the *same* subscription (competing
consumers). Autoscale on `num_undelivered_messages`, not CPU.

**Make the consumer faster**: batch database writes instead of one per message,
remove an N+1, or move genuinely slow work behind another queue.

**Check whether it's uneven**: with ordering keys, one hot key serialises and no
amount of scaling helps.

**Alert on `oldest_unacked_message_age`.** Backlog *size* is noisy; message *age*
is the SLO.

If the producer rate is permanent and consumers can't be scaled, the design is
wrong — either the work is too expensive per message, or it should be batched
(Capsule 20).
</details>

<details>
<summary><b>3.</b> Should you use ordering keys? Argue both ways.</summary>

**For:** some domains genuinely need it. Account balance changes, state machine
transitions, CDC streams — applying "set status = shipped" before "create order"
is meaningless.

**Against:** ordering serialises per key, so throughput per key is capped and a
stuck message blocks everything behind it. It also pins publishing to a region,
and it makes the system harder to reason about under failure.

**The better answer, most of the time:** make consumers order-independent.
Include a version or timestamp in the event and have the consumer ignore
anything older than what it has already applied (a "last-write-wins by version"
check). That's a few lines of code, works regardless of transport, and survives
replay and duplicate delivery too.

Use ordering keys when you can't design the ordering requirement away — and pick
the narrowest key possible so unrelated entities stay parallel.
</details>

<details>
<summary><b>4.</b> Pub/Sub vs Cloud Tasks vs Kafka — when each?</summary>

**Pub/Sub** — event broadcast with fan-out to unknown consumers. Serverless, no
capacity to manage, 7-day retention. The default on GCP.

**Cloud Tasks** — *targeted* work: "call this specific endpoint, at this time,
at this rate, with these retries." Per-task scheduling and dedup, per-queue rate
limiting. Better when you know exactly who should do the work and when. Great
for "send this email in 24 hours."

**Kafka (or Managed Service for Kafka)** — a durable, replayable **log** rather
than a queue. Consumers track their own offsets, so you can rewind and replay
weeks of history; ordering is per-partition; retention can be forever. Choose it
for event sourcing, stream processing, or when you need replay as a first-class
operation. Costs real operational effort.

Rule of thumb: **broadcast → Pub/Sub. Targeted job → Cloud Tasks. Replayable log
→ Kafka.**
</details>

<details>
<summary><b>5.</b> A message keeps failing and being redelivered forever. What's wrong and what do you do?</summary>

A **poison message**: something about it makes the handler fail deterministically
— malformed payload, a schema change the consumer doesn't understand, a
referenced row that was deleted, an unhandled edge case.

It's worse than one stuck message: it consumes throughput on every redelivery,
and with ordering keys it blocks every message behind it for that key.

**Fix:** a **dead-letter topic**. After N delivery attempts, Pub/Sub moves the
message to a separate topic where you can inspect, fix and replay it. This is
non-optional for any production subscription.

```bash
gcloud pubsub subscriptions update ranker \
  --dead-letter-topic=power-readings-dlq \
  --max-delivery-attempts=5
```

**Also:** alert on DLQ depth (anything > 0 is a signal); distinguish permanent
failures (ack and DLQ immediately) from transient ones (nack and retry); and
never silently ack a failure you didn't handle.

Capsule 19 builds this properly.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Client tries to reach real GCP | `PUBSUB_EMULATOR_HOST` isn't set in *that* terminal. It must be set for both publisher and consumer. |
| `topic does not exist` | Emulator state is in-memory: recreate topics after every restart. That's what `scripts/pubsub-setup.sh` is for. |
| Consumer receives nothing | The subscription was created *after* publishing. Subscriptions only get messages published after they exist. |
| Every message delivered twice | Ack deadline exceeded, or you `Ack()` on a path that also returns early. Log `DeliveryAttempt`. |
| Consumer OOMs on a big backlog | No flow control. Set `MaxOutstandingMessages`/`Bytes`. |
| `EnableMessageOrdering=false, but an OrderingKey was set` | `topic.EnableMessageOrdering = true` is required on the **publisher client**, not just when creating the topic. `NewPublisher` above sets it — if you typed the publisher yourself, this is the line you missed. |
| Messages lost on shutdown | You didn't call `topic.Stop()`. Buffered messages are dropped. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(events): publish PowerRecorded and add a ranker consumer

Capsule 18. Pub/Sub emulator in compose; same code path as real Pub/Sub via
PUBSUB_EMULATOR_HOST. Events are past-tense facts with a version field and
filterable attributes. Consumer has flow control and explicit nack. Verified
fan-out (2 subs) vs competing consumers (1 sub, 3 instances), and reproduced
duplicate delivery by exceeding the ack deadline."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 18
```

**Next:** [Capsule 19 · Cell's Absorption — Delivery Semantics & Idempotency](../19-cell-absorption-delivery-semantics/README.md)
