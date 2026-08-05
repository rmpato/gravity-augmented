# Capsule 06 · Multi-Form — Horizontal Scaling & Statelessness

> *Tien splits into four. Four fighters, four sets of fists — and each one holds
> only a quarter of his power. The technique is genuinely useful and it is also
> a lesson in what splitting costs you: coordination, and the fact that what one
> copy knows, the others don't.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 5 | 65 min | Capsule 05 | Local + ☁️ optional |

---

## Why this capsule exists

Capsule 05 found the ceiling. The way past it is more instances, not bigger
ones — and that works **only if any instance can serve any request**.

That property is called being **stateless**, and it sounds trivial until you go
looking for where state is actually hiding in your service. It's rarely where
people expect. This capsule makes you find it the hard way: you'll run three
replicas of the Scouter and watch it return three different answers to the same
question.

---

## The concept

### Stateless doesn't mean "no data"

It means **no request-scoped data lives in the instance's memory or disk between
requests.** Data absolutely exists — it lives in a database, a cache, or an
object store that every instance can reach.

The test: *can I kill any instance mid-traffic and lose nothing but the requests
it was serving?*

**Where state hides** — go looking for all six:

| Hiding place | Looks like | Fix |
|---|---|---|
| In-memory maps/counters | `var cache = map[string]X{}` | shared cache (Capsule 14) |
| In-memory sessions | login state in a local map | signed cookie, or shared session store |
| Local files | uploads written to `/tmp`, generated PDFs | object storage (Cloud Storage) |
| In-process schedulers | `time.Ticker` that runs a job | leader election, or an external scheduler |
| Local rate-limit counters | a token bucket per instance | shared counter, or accept N× the limit (Capsule 17) |
| Sticky-session assumptions | "the user always hits the same box" | don't. See below |

**Sticky sessions** (session affinity) route a user to the same instance every
time. It makes in-memory state *appear* to work, and it's a trap:

- Scaling out doesn't rebalance existing users, so new instances sit idle while
  old ones stay hot.
- Losing an instance loses those users' state entirely.
- Deploys become disruptive by definition.
- Load becomes uneven and unpredictable.

Use it only when you truly cannot avoid it (long-lived WebSocket connections are
the honest case), and know you've taken on debt.

### The scaling triangle: replicas × concurrency × capacity

Three numbers, and confusing them is the most common capacity mistake:

```
  total capacity  ≈  replicas  ×  per-replica concurrency
```

- **Concurrency** — how many requests one instance handles simultaneously. For
  a Go service doing I/O-bound work, high (hundreds). For CPU-bound work, close
  to the core count.
- **Replicas** — how many instances exist.

Setting concurrency too high means requests queue *inside* an instance, so
latency climbs while the autoscaler sees "plenty of capacity" and doesn't scale.
Setting it too low means you pay for instances that are mostly idle.

### What signal should trigger a scale-up?

| Signal | Good for | Careful |
|---|---|---|
| **CPU utilisation** | CPU-bound work | useless for I/O-bound services, which are slow at 20% CPU |
| **Request concurrency** | most HTTP services. Cloud Run's default | needs a sensible per-instance target |
| **Queue depth / backlog** | async consumers (Capsule 19) | the best signal there is for workers |
| **p95 latency** | user-facing SLOs | laggy — you scale *after* users hurt |

**Scale up fast, scale down slow.** Scaling up late costs you an outage; scaling
down late costs you a few cents. The asymmetry should be reflected in your
cooldowns.

### Cold starts and the min-instances trade-off

A new replica must: be scheduled → pull the image → start the process → warm up
(JIT, connection pools, caches) → pass readiness. That's tens of milliseconds
for your Go binary and several seconds for a heavy runtime.

During a spike, cold starts land exactly when you can least afford them. Levers:

- `min-instances > 0` — keep N warm. Costs money continuously.
- Small images, fast startup — the reason Capsule 02 mattered.
- Startup CPU boost (Cloud Run `--cpu-boost`).
- Pre-warm before known spikes (a sale, a launch).

### The thing horizontal scaling does *not* fix

Ten stateless replicas all talk to **one database**. You have moved the
bottleneck, not removed it — and you've made it worse, because ten replicas open
ten connection pools. That's Saga 2 and 3's entire subject matter.

---

## Lab — break the Scouter, then fix it

### Step 1 — three replicas behind one port

**`deploy/docker-compose.scale.yml`**

```yaml
name: gravity-chamber-scale

services:
  scouter:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    image: scouter:dev
    environment:
      PORT: "8080"
      LOG_LEVEL: "info"
    deploy:
      replicas: 3
    # No host port mapping: three containers cannot share port 8080.
    # nginx below is the single entry point.

  lb:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - scouter
```

**`deploy/nginx.conf`**

```nginx
events {}
http {
  # Docker's embedded DNS resolves "scouter" to all three container IPs.
  # nginx round-robins between them.
  upstream scouters { server scouter:8080; }

  server {
    listen 80;
    location / {
      proxy_pass http://scouters;
      proxy_set_header Host $host;
      # So you can see WHICH replica answered.
      add_header X-Upstream $upstream_addr always;
    }
  }
}
```

```bash
cd deploy
docker compose -f docker-compose.scale.yml up --build -d
docker compose -f docker-compose.scale.yml ps    # three scouter containers
```

### Step 2 — watch it lie to you

```bash
# write once
curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}' | jq

# read five times
for i in 1 2 3 4 5; do
  curl -si localhost:8080/fighters/goku | grep -E 'HTTP/|X-Upstream' | tr '\n' ' '
  echo
done
```

**Two out of three requests return 404.** The write landed on one replica; its
`MemStore` is private. The leaderboard is wrong on all three, and each one is
wrong differently.

This is not a bug in your code. It's the *defining* problem of horizontal
scaling, and every fix in Sagas 2 and 3 exists because of it.

```bash
for i in $(seq 1 12); do
  curl -s localhost:8080/leaderboard | jq -c 'length'
done
```

Different lengths, same instant. Sit with that for a second — this is what a
data consistency bug looks like from the outside, and how hard it is to
reproduce from a single curl.

### Step 3 — find every piece of state

Grep your own service:

```bash
cd ~/repos/pato/gravity-chamber
grep -rn "sync\.\|map\[\|os.Create\|ioutil.WriteFile\|time.Ticker" internal/ cmd/
```

Write the list in `NOTES.md` under "state I found". For each: *would this be
correct with three replicas?*

Right now the honest answer is `MemStore` — and that's it, which is why the fix
in Capsule 10 is contained. Services that grew organically for two years produce
a much longer list, and finding it is exactly this exercise.

### Step 4 — the cheap fix: make the boundary explicit

You can't add Postgres yet (Capsule 10). But you *can* do the thing that makes
that swap a one-line change: define an interface at the boundary.

**`internal/scouter/store.go`** — add above `MemStore`:

```go
// Store is the persistence boundary. MemStore implements it today and is
// wrong for more than one replica; Capsule 10 adds a Postgres implementation
// and nothing else in the service has to change.
type Store interface {
	Record(r Reading)
	Latest(fighter string) (Reading, bool)
	Leaderboard(n int) []Reading
}

// Compile-time proof that MemStore satisfies Store. If it ever stops
// matching, the build breaks here rather than at some call site.
var _ Store = (*MemStore)(nil)
```

Then change `Server` to depend on the interface, not the concrete type:

```go
type Server struct {
	store Store        // was: *MemStore
	log   *slog.Logger
	ready atomic.Bool
}

func NewServer(store Store, log *slog.Logger) *Server {   // was: *MemStore
	s := &Server{store: store, log: log}
	s.ready.Store(true)
	return s
}
```

Nothing else changes; `make test` still passes.

> **Why this matters beyond Go:** *depend on the interface you need, not the
> implementation you happen to have.* It's the reason Capsule 10 is a small
> capsule instead of a rewrite. Define the seam before you need it — but define
> it because you can *see* the second implementation coming, not speculatively.

### Step 5 — make the instance identifiable

When three replicas misbehave, you need to know which one. Add to `main.go`,
after the logger is created:

```go
	// Every log line now carries the instance identity. In a container the
	// hostname is the container ID; on Cloud Run, set INSTANCE_ID from the
	// metadata server or just let the hostname be the revision instance.
	host, _ := os.Hostname()
	log = log.With("instance", host)
```

Rebuild and watch:

```bash
docker compose -f docker-compose.scale.yml up --build -d
for i in $(seq 1 6); do curl -s localhost:8080/leaderboard >/dev/null; done
docker compose -f docker-compose.scale.yml logs scouter | grep http_request | tail -6
```

Every line now says which instance served it. In production this is the field
you filter on when exactly one replica is unhealthy — and there is always
exactly one.

### Step 6 — kill one mid-flight

```bash
# start a slow-ish stream of requests
while true; do curl -s -o /dev/null -w "%{http_code} " localhost:8080/healthz; sleep 0.2; done &

docker compose -f docker-compose.scale.yml ps -q scouter | head -1 | xargs docker kill
```

Watch the status codes. With three replicas you see a few failures as nginx
notices, then it recovers — **without** you doing anything. That resilience is
the second reason to run more than one instance, and honestly it's the better
one: capacity is a nice side effect of not having a single point of failure.

```bash
kill %1
docker compose -f docker-compose.scale.yml down
```

---

## In GCP

Cloud Run's model maps directly onto everything above:

```bash
gcloud run deploy scouter \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \        # requests handled simultaneously per instance
  --cpu=1 --memory=512Mi
```

- **`--concurrency`** is the per-instance concurrency from the triangle. Default
  80. For a CPU-bound service, lower it (10–20) so the autoscaler adds instances
  instead of queueing inside one. For I/O-bound, higher is fine and cheaper.
- **`--max-instances`** is a cost ceiling as much as a capacity one. Also a
  protection for downstream: 1,000 instances × 10 database connections is 10,000
  connections, and your database has a limit far below that. (Capsule 10.)
- **`--min-instances`** trades money for cold-start latency.
- Cloud Run autoscales primarily on **concurrency utilisation**, and secondarily
  on CPU.

**GKE**, for the vocabulary: a `Deployment` with `replicas: N`, a
`HorizontalPodAutoscaler` targeting CPU or a custom metric, a
`PodDisruptionBudget` so voluntary disruptions (node upgrades) can't take
everything down at once, and `topologySpreadConstraints` so your replicas don't
all land in one zone. Different nouns, identical ideas.

**Managed Instance Groups** on Compute Engine do the same for VMs, with
autohealing driven by a health check.

---

## Bring it to work

- **"Can I kill any instance right now?"** should be answerable *yes* at any
  moment. If not, name the state and where it should move to.
- **Never let a single instance hold user-visible state**, including in-memory
  caches whose staleness is user-visible.
- **Log the instance identity on every line.** Non-negotiable once N > 1.
- **Sticky sessions are debt.** Write it down as debt when you take it on.
- **Set `max-instances` deliberately** — it's the guard between a traffic spike
  and a database connection exhaustion incident.
- **Capacity = replicas × concurrency.** Know both numbers for your service. Most
  people know neither.

---

## Battle drill

<details>
<summary><b>1.</b> A service works with 1 replica, breaks intermittently at 3. Where do you look first?</summary>

Anything in-process: an in-memory cache or session store, a local file, a
`time.Ticker` background job now running three times, or a rate limiter counting
per-instance (so your "100 req/s limit" is now 300).

The diagnostic pattern is the smoking gun: **failures that correlate with which
instance served the request** and disappear when you scale back to one. If your
logs carry the instance ID (Step 5), this takes one query instead of a day.
</details>

<details>
<summary><b>2.</b> Why does high per-instance concurrency hide the need to scale?</summary>

The autoscaler measures concurrency *utilisation* against your configured
target. Set the target to 1000 and each instance accepts a thousand simultaneous
requests — but its CPU and connection pool can't serve them, so they queue
internally. Latency climbs steeply while the autoscaler sees utilisation well
under target and adds nothing.

You've moved the queue from the load balancer (where it's visible and shed-able)
into your process (where it's invisible and unbounded). Set concurrency to what
one instance can genuinely serve, and let scale-out do the rest.
</details>

<details>
<summary><b>3.</b> When is stickiness genuinely justified?</summary>

Long-lived stateful connections — WebSockets, SSE, gRPC streams — where the
connection *is* the state and moving it means reconnecting. Also some legacy
apps where externalising session state isn't feasible on the available timeline.

Even then: keep the state recoverable, so losing an instance is a reconnect and
not data loss. Design for "the client reconnects and resumes", not "the server
remembers".
</details>

<details>
<summary><b>4.</b> You scale from 5 to 50 replicas and the database falls over. What happened, and what do you do?</summary>

Each replica holds a connection pool. 50 × 20 = 1,000 connections; Postgres
defaults to `max_connections = 100` and each connection costs several MB of
server memory plus per-connection scheduling overhead. The database spends its
time context-switching instead of querying.

Fixes, in order: cap `max-instances`; shrink the per-instance pool (a small pool
per replica is usually right); put a **connection pooler** in front (PgBouncer,
or Cloud SQL Auth Proxy / AlloyDB's built-in pooling) so thousands of client
connections multiplex onto tens of server ones; and add read replicas or caching
to remove the load entirely.

This is Capsule 10's lab, and it's one of the most common real-world scaling
failures.
</details>

<details>
<summary><b>5.</b> How do you run a scheduled job in a horizontally-scaled service?</summary>

Not with an in-process ticker — you'd run it N times concurrently.

Options, roughly in order of preference: an **external scheduler** triggering an
endpoint (Cloud Scheduler → Cloud Run, or a Kubernetes `CronJob`); a **queue**
where the scheduler enqueues and any one worker picks it up; or **leader
election** via a distributed lock, where one instance holds the lock and does
the work.

Whichever you pick, make the job **idempotent** — schedulers retry, and
at-least-once is the only guarantee you get (Capsule 19).
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `port is already allocated` on scale | Replicas can't share a host port. Remove `ports:` from the scaled service; only the LB publishes one. |
| nginx: `host not found in upstream` | Compose creates the network before containers are healthy. `depends_on` helps; otherwise restart nginx. |
| New replicas get no traffic after `--scale` | nginx resolves `scouter` **once, at config load**, and expands every A record Docker returns at that moment. Replicas started later are invisible to it. `docker compose restart lb`. (Scaling *down* is handled: nginx ejects a dead upstream on connection failure.) In production this is why you point at a stable service VIP or use `resolver 127.0.0.11 valid=5s;` with a variable in `proxy_pass`, which forces re-resolution per request. |
| `deploy.replicas` ignored | That key is Swarm-era. Modern `docker compose up` honours it; if yours doesn't, use `docker compose up --scale scouter=3`. |
| Can't tell which replica answered | Check the `X-Upstream` header, or the `instance` field in the logs after Step 5. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "refactor(scouter): introduce Store interface; add instance identity

Capsule 06. Ran 3 replicas behind nginx and confirmed MemStore makes the
service stateful: writes are invisible to 2 of 3 replicas. Extracted a Store
interface so Capsule 10 can swap in Postgres without touching handlers.
Every log line now carries the instance hostname."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 06
```

**Next:** [Capsule 07 · Korin's Tower — Load Balancing](../07-korins-tower-load-balancing/README.md)
