# Capsule 07 · Korin's Tower — Load Balancing

> *Everyone who wants Senzu beans climbs the same tower. Korin sits at the top
> deciding who gets through, who's ready, and who needs to go back down. Nobody
> reaches the top by accident, and Korin knows exactly who's up there.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 6 | 70 min | Capsule 06 | Local + concept |

---

## Why this capsule exists

You have N replicas. Something has to decide which one gets each request — and
that something is doing far more than picking a number. A load balancer is
where health checking, connection draining, TLS termination, retries, timeouts
and traffic splitting all actually live.

Almost everything that makes a deploy invisible to users (Capsule 24) is
implemented at the load balancer. Get this layer right and a dying instance is a
non-event; get it wrong and every deploy is a burst of errors.

---

## The concept

### L4 vs L7

The single most important distinction, and it comes down to **what the balancer
is allowed to read**.

```
  L4 (transport)                      L7 (application)
  ─────────────────                   ─────────────────
  sees: IP + port                     sees: the full HTTP request
  routes: whole TCP connections       routes: individual requests
  fast, cheap, protocol-agnostic      smarter, costlier, HTTP/gRPC-aware

  cannot: route by path or header     can: /api → A, /static → B
  cannot: retry a failed request      can: retry idempotent requests
  cannot: terminate TLS meaningfully  can: terminate TLS, add headers,
  cannot: understand HTTP/2 streams         rate limit, compress, split traffic
```

The consequence people miss: **L4 balances connections, L7 balances requests.**
With HTTP/2 or gRPC, one long-lived connection carries thousands of requests. An
L4 balancer pins that whole connection to one backend — so a "balanced" gRPC
service can have one backend at 90% CPU and the rest idle. That's the classic
gRPC-behind-an-L4-LB imbalance, and the fix is an L7 balancer (or client-side
load balancing).

Use L4 for raw TCP, databases, non-HTTP protocols, and when you need extreme
throughput at minimal cost. Use L7 for basically all HTTP traffic.

### Algorithms, and when the default is wrong

| Algorithm | How | Use when |
|---|---|---|
| **Round robin** | next backend in order | requests are uniform. The default |
| **Least connections** | fewest in-flight | request durations vary a lot |
| **Least request / least loaded** | fewest outstanding requests, sometimes weighted | the best general-purpose L7 default |
| **Random two-choices** | pick 2 at random, take the less loaded | astonishingly good, no global state — what most modern meshes use |
| **Consistent hashing** | hash a key → backend | you need cache locality (Capsule 15) or session affinity |
| **Weighted** | proportional | canary deploys, mixed instance sizes (Capsule 24) |

**Round robin's failure mode:** it's blind to how long requests take. If 1 in 20
requests is a 5-second report and the rest are 10 ms, round robin cheerfully
sends new fast requests to the instance already stuck on a slow one. Least-request
or two-choices fixes that for free.

### Health checks are the load balancer's whole world

An LB only knows what its health checks tell it. Three parameters, and every one
is a trade-off:

- **interval** — how often to probe. Short = fast detection, more load.
- **timeout** — how long to wait. Must be shorter than the interval.
- **thresholds** — how many consecutive failures mark it unhealthy (and
  successes to mark it healthy again).

**Detection time ≈ interval × unhealthy-threshold.** With a 10 s interval and a
threshold of 3, a dead backend keeps receiving traffic for **30 seconds**. That's
your real recovery floor, and most people never do this multiplication.

**Probe readiness, not liveness.** From Capsule 01: `/readyz` is the one that
says "send me traffic". Point the LB at it.

**The correlated-failure trap:** if your readiness check pings the database and
the database blips, *every* backend fails readiness simultaneously and the LB
has zero healthy targets. Some LBs then fail open (send to all) and some fail
closed (503 everything) — know which yours does. A common mitigation is to have
readiness reflect *this instance's* ability to serve, degrading gracefully rather
than all-or-nothing.

### Connection draining

When you remove a backend — a deploy, a scale-down, a node drain — the LB must
stop sending *new* requests but let in-flight ones finish.

```
  t=0   backend marked for removal
  t=0   LB stops sending NEW requests to it
  t=0…D existing requests complete  (D = drain timeout)
  t=D   remaining connections forcibly closed
```

The full graceful sequence, end to end, which is now the fourth time this repo
has drawn it because it is the thing everyone gets wrong:

```
  1. LB: stop new traffic      ← readiness fails (Capsule 01)
  2. app: finish in-flight     ← http.Server.Shutdown (Capsule 01)
  3. app: exit                 ← exec-form ENTRYPOINT so SIGTERM arrives (Capsule 02)
  4. LB: forget the backend
```

Break any one of the four and deploys produce 502s.

### What else lives at the LB

- **TLS termination** — certificates in one place, plaintext (or re-encrypted)
  behind it.
- **HTTP/2 and HTTP/3** to clients, even if your backends speak HTTP/1.1.
- **Traffic splitting** — 5% to the new revision (Capsule 24).
- **Path/host routing** — `/api` → one service, `/` → another.
- **Retries, timeouts, outlier ejection** — sometimes; see Capsule 17 for why
  LB-level retries need a budget.

### Global load balancing and anycast

GCP's global external Application Load Balancer uses **anycast**: one IP address
announced from every Google edge location worldwide. A user in São Paulo and one
in Frankfurt hit the *same IP* and get routed to their nearest Google edge by
BGP, then over Google's private backbone to your backend.

Two consequences worth knowing: TLS terminates near the user (so the expensive
handshake round-trips are short), and cross-continent traffic then travels
Google's network rather than the public internet. It's a meaningful latency win
and it's the reason "one global IP" is possible at all.

---

## Lab

### Step 1 — round robin, the baseline

Build on Capsule 06's setup. Replace **`deploy/nginx.conf`**:

```nginx
events { worker_connections 1024; }

http {
  log_format upstreamlog '$remote_addr -> $upstream_addr '
                         'status=$status rt=$request_time urt=$upstream_response_time';
  access_log /dev/stdout upstreamlog;

  upstream scouters {
    # least_conn;                      # <- uncomment in Step 3
    server scouter:8080 max_fails=2 fail_timeout=10s;
    keepalive 32;                      # reuse upstream connections
  }

  server {
    listen 80;

    # Health of the LB itself, not the backends.
    location = /lb-health { return 200 "lb ok\n"; }

    location / {
      proxy_pass http://scouters;
      proxy_http_version 1.1;
      proxy_set_header Connection "";        # required for keepalive to work

      proxy_connect_timeout 2s;
      proxy_send_timeout    10s;
      proxy_read_timeout    10s;

      # Only retry on connection-level failures, and never on a request
      # that has already been sent to a non-idempotent endpoint.
      proxy_next_upstream error timeout http_502 http_503;
      proxy_next_upstream_tries 2;
      proxy_next_upstream_timeout 5s;

      add_header X-Upstream $upstream_addr always;
    }
  }
}
```

```bash
cd deploy
docker compose -f docker-compose.scale.yml up --build -d
```

Confirm round robin distributes evenly:

```bash
for i in $(seq 1 30); do
  curl -si localhost:8080/healthz | awk '/X-Upstream/{print $2}'
done | sort | uniq -c
```

Roughly 10/10/10.

### Step 2 — round robin's blind spot

Now mix slow and fast requests. `/train` from Capsule 05 is your slow endpoint.

```bash
# 6 slow requests in the background — these keep some backends busy
for i in $(seq 1 6); do
  curl -s -o /dev/null "localhost:8080/train?rounds=3000000" &
done

sleep 1

# now 20 fast ones, and measure how long each takes
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{time_total} %{http_code}\n" localhost:8080/healthz
done | sort -n | tail -5

wait
```

> Reuse the `ROUNDS` you calibrated in Capsule 05 and multiply by ~15 — the
> point here is a request that keeps a backend busy for a few seconds while
> the fast ones run, not a specific number. On ARM, 3,000,000 rounds is only
> ~300 ms: the slow requests finish during the `sleep 1`, before a single fast
> request is sent, and you measure nothing. If your "slow" requests come back in
> milliseconds, you went over the `rounds` cap and silently got the default
> (Capsule 05).

Note the five worst times — they are your round-robin baseline for Step 3. The
intuition says some of them should be terrible, because round robin keeps
handing fast requests to backends that are busy with a hash chain. Write down
what you actually got, not what the intuition predicts; whether it holds is
exactly what Step 3 tests.

### Step 3 — switch to least connections

Uncomment `least_conn;` in `nginx.conf`, then:

```bash
docker compose -f docker-compose.scale.yml restart lb
```

Re-run Step 2 exactly, and compare the tail (`tail -5`).

> **You will probably not see an improvement. That is the correct result, and
> it is the point of this step.**
>
> This lab was run repeatedly on 3 backends at `cpus: 0.5` with 30M-round
> chains. Measured maxima:
>
> | Setup | round-robin | least_conn |
> |---|---|---|
> | 6 slow requests | 85.6 ms | 88.5 ms |
> | 4 slow requests | 60.0 ms | 122.2 ms |
>
> Repeating an identical run changed the numbers by more than the gap between
> the two algorithms. **The noise floor is larger than the effect.**

Three reasons, and each is worth more than a rigged win would have been:

1. **Six slow requests over three backends is 2/2/2 — perfectly even.** That is
   round-robin's *best* case. It only loses when load lands unevenly, so a
   benchmark that divides evenly cannot show a difference by construction. Try
   4 or 5 slow requests instead and watch how much the numbers move around.
2. **`least_conn` balances connections, not work.** It has no idea one backend
   is burning CPU. With `keepalive 32` above, a connection is reused across
   requests, so the count it balances on drifts further from actual load.
3. **Go preempts CPU-bound goroutines.** A backend chewing through a hash chain
   still answers `/healthz` in ~2 ms, because the scheduler interleaves them.
   The intuition that a busy backend is a *blocked* backend comes from
   thread-per-request servers with a fixed pool. Go doesn't work that way.

So when does `least_conn` actually earn its place? When connections are
long-lived and genuinely uneven — WebSockets, streaming responses, gRPC
channels, or a backend that really does serialise work per connection. Reach
for it there, not as a default.

> **The real takeaway:** you just ran a benchmark, got no signal, and correctly
> concluded "no evidence of a difference" instead of squinting until you saw
> one. That instinct is worth more than any load-balancing algorithm. **Measure
> the noise before you trust the number** — if you don't know your run-to-run
> variance, you can't tell an improvement from luck. Capsule 09 makes this
> rigorous.

### Step 4 — health checks and detection time

Watch failover happen, and time it.

```bash
# continuous requests with visible status
while true; do
  curl -s -o /dev/null -w "%{http_code} " localhost:8080/healthz
  sleep 0.25
done &

# kill one backend
docker compose -f docker-compose.scale.yml ps -q scouter | head -1 | xargs docker kill
```

You'll see a run of `502`s before it settles. That run is your detection window
— with `max_fails=2 fail_timeout=10s`, nginx needs two failures before ejecting
the backend, and those two failures are real user errors.

Now shrink it:

```nginx
    server scouter:8080 max_fails=1 fail_timeout=5s;
```

```bash
docker compose -f docker-compose.scale.yml restart lb
```

Repeat. Fewer errors, faster detection — at the cost of being twitchier about
transient blips (a single slow response now ejects a healthy backend). **That
trade-off never goes away.** Aggressive detection removes healthy capacity during
noise; conservative detection sends users to dead backends.

```bash
kill %1
```

### Step 5 — draining, done right and done wrong

**Wrong** (what most people do by default):

```bash
docker compose -f docker-compose.scale.yml ps -q scouter | head -1 | xargs docker kill  # SIGKILL
```

Instant. Every in-flight request severed. This is what a `--force` deploy, an
OOM kill, or a node preemption looks like.

**Right:**

```bash
# start slow requests
for i in 1 2 3; do curl -s -o /dev/null -w "%{http_code}\n" "localhost:8080/train?rounds=3000000" & done

# graceful stop: SIGTERM, then wait
docker compose -f docker-compose.scale.yml ps -q scouter | head -1 | xargs -I{} docker stop -t 30 {}
wait
```

All three return `200`. Your Capsule 01 shutdown code drained them.

Now look at the honest gap: nginx here has no active health checking (that's an
nginx Plus feature), so it only learns a backend is gone by *failing a request*
against it. Your `DRAIN_DELAY` of 2 seconds is what covers that window — the
instance keeps serving while already reporting not-ready, giving the LB time to
notice.

**In real infrastructure** (GCLB, Envoy, Kubernetes) the LB polls readiness
actively, so failing `/readyz` proactively removes you before any request fails.
That's the whole reason readiness exists as a separate concept.

```bash
docker compose -f docker-compose.scale.yml down
```

---

## In GCP

> **Concept only.** A global external Application Load Balancer costs roughly
> **$18/month just to exist**, before any traffic. Do not create one for
> practice. Read the anatomy; you'll recognise every piece.

### The anatomy of a GCLB

GCP decomposes a load balancer into named resources, which is confusing until
you see it as a chain:

```
  Forwarding Rule      "IP 34.x.x.x port 443 goes here"
        │
  Target HTTPS Proxy   TLS termination + certificate
        │
  URL Map              /api/* → backend A,  /* → backend B     ← the L7 routing
        │
  Backend Service      algorithm, timeout, CDN on/off, Cloud Armor policy
        │              + a HEALTH CHECK
        │
  Backend (NEG / MIG)  the actual instances, pods, or Cloud Run services
```

In Terraform that's `google_compute_global_forwarding_rule` →
`google_compute_target_https_proxy` → `google_compute_url_map` →
`google_compute_backend_service` → `google_compute_health_check` +
`google_compute_region_network_endpoint_group`.

Every one of those names maps to a concept above. The **URL Map** is where L7
routing lives. The **Backend Service** is where the algorithm, timeouts, CDN and
WAF attach.

### The GCP load balancer menu

| Product | Layer | Scope | Use for |
|---|---|---|---|
| **Global external Application LB** | L7 | global, anycast | public HTTP(S). The default |
| **Regional external Application LB** | L7 | one region | when data must stay in-region |
| **Internal Application LB** | L7 | VPC-internal | service-to-service HTTP |
| **External passthrough Network LB** | L4 | regional | raw TCP/UDP, extreme throughput |
| **Internal passthrough Network LB** | L4 | VPC-internal | internal TCP |

Plus: **Cloud CDN** is a checkbox on the backend service (Capsule 16), and
**Cloud Armor** is a WAF/DDoS policy attached to it (Capsule 08).

### Cloud Run gets one for free

Deploy to Cloud Run and you already have: a Google-managed TLS certificate, an
HTTP/2-capable L7 front end, health checking, request-based routing across
instances, and traffic splitting. You'd add an explicit GCLB in front only when
you need a custom domain with your own certificate, Cloud Armor, Cloud CDN, or
routing across multiple backends under one hostname.

---

## Bring it to work

- **Point health checks at readiness, not liveness**, and do the arithmetic:
  `interval × threshold` is how long a dead backend keeps taking traffic.
- **Fail readiness before you stop accepting**, and make the drain delay at
  least one health-check interval.
- **Prefer least-request over round robin** for anything with variable request
  cost.
- **L4 in front of gRPC/HTTP-2 will imbalance you.** Use L7 or client-side LB.
- **Measure the tail.** Load-balancing decisions are invisible in the mean.
- **Know whether your LB fails open or closed** when zero backends are healthy.
- **LB-level retries need a budget.** Blind retries turn a partial failure into a
  full one (Capsule 17).

---

## Battle drill

<details>
<summary><b>1.</b> Every deploy produces a burst of 502s. Walk through the causes.</summary>

Check the four-step sequence in order:

1. **No pre-stop drain** — the instance stops accepting the instant it gets
   SIGTERM, but the LB still thinks it's healthy for one more health-check
   interval. Fix: fail readiness first, then sleep ≥ one interval, then shut down.
2. **SIGTERM not reaching the process** — shell-form ENTRYPOINT (Capsule 02), so
   the process is killed rather than drained.
3. **Shutdown timeout shorter than the longest request** — `Shutdown` gives up
   and closes connections mid-flight.
4. **New instances marked healthy before they're ready** — no readiness gate, so
   traffic arrives before pools/caches are warm.

The tell for #1 vs #2: with #1 you see clean shutdown logs and 502s anyway; with
#2 you see no shutdown logs at all.
</details>

<details>
<summary><b>2.</b> Your gRPC service has 10 replicas; one is at 90% CPU and the rest are idle. Why?</summary>

An L4 load balancer, or a client that opened one connection and kept it. gRPC
multiplexes many requests over a single long-lived HTTP/2 connection, and an L4
balancer routes *connections*, not requests — so once a client's connection
lands on a backend, every subsequent request goes there too.

Fixes: an **L7** balancer that understands HTTP/2 streams (GCLB internal
Application LB, Envoy, a service mesh); **client-side load balancing** with
periodic re-resolution; or forcing connection recycling with
`MAX_CONNECTION_AGE` on the server so clients redistribute over time.
</details>

<details>
<summary><b>3.</b> Should the load balancer retry failed requests?</summary>

Only under strict conditions, and it's more dangerous than it looks:

- **Only idempotent requests.** A retried `POST /payments` charges twice.
- **Only connection-level failures** (connect error, timeout before the request
  was sent) — not a 500, which the backend generated *after* doing work.
- **With a retry budget.** If 30% of backends are failing, blind retries add 30%
  more load to the survivors and cascade the failure. Envoy caps retries at a
  percentage of active requests for exactly this reason.
- **Never retry a 4xx.** It will fail identically forever.

Capsule 17 covers this in depth. The short version: retries are a load
multiplier applied at the worst possible moment.
</details>

<details>
<summary><b>4.</b> Health check interval 10s, unhealthy threshold 3, and the app takes 40s to start. What breaks?</summary>

Two separate problems:

**Detection**: a dead backend serves errors for up to 30 seconds (10 × 3) before
ejection. If your SLO is tight, that's most of your error budget in one event.

**Startup**: unless you have a `start_period` / `initialDelaySeconds` / startup
probe, the health checker begins probing immediately, gets 3 failures, and marks
a *perfectly healthy but still-booting* instance as dead — possibly killing and
restarting it forever in a crash loop where the app never gets to finish
starting.

That's what startup probes are for: a separate, more patient check that must
pass once before liveness/readiness probing begins.
</details>

<details>
<summary><b>5.</b> Your readiness check pings the database. The database blips for 20 seconds. What happens at the LB?</summary>

Every backend fails readiness at once, so the LB has **zero healthy backends**.
Behaviour then depends on the LB: some fail open (send to all backends anyway,
which is arguably better — the app can return a degraded response), some fail
closed (503 everything).

Worse, if it's a *liveness* check, the orchestrator restarts every instance
simultaneously — and now you have cold starts and a connection storm hitting a
database that was recovering.

Better design: readiness should reflect "can this instance do useful work",
which for many services is still *yes* during a database blip (cached reads,
health endpoints, non-DB paths). Reserve hard readiness failure for "this
instance specifically is broken."
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `X-Upstream` header missing | Needs `always` — `add_header X-Upstream $upstream_addr always;`. |
| All traffic to one backend | nginx resolved `scouter` once at startup. Restart the LB after scaling, or use a `resolver` with a variable in `proxy_pass`. |
| `upstream timed out` on `/train` | `proxy_read_timeout` is shorter than the request. Raise it or lower `rounds`. |
| `502` immediately on every request | Backends aren't up yet, or the port is wrong. `docker compose logs scouter`. |
| `least_conn` makes no visible difference | Expected at this scale — Step 3 explains why. Just rule out the trivial cause first: if the "slow" requests return in milliseconds, `rounds` went over the cap and fell back to the default (Capsule 05), so nothing was busy at all. |
| nginx won't start | Syntax. `docker compose exec lb nginx -t` prints the exact line. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(deploy): nginx load balancer with health checks and draining

Capsule 07. Compared round-robin vs least_conn under mixed request costs —
no difference above run-to-run noise at this scale. Measured failover detection time as
interval x threshold. Verified graceful drain returns 200s where SIGKILL
severs in-flight requests."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 07
```

**Next:** [Capsule 08 · King Yemma's Desk — Proxies, Gateways & the Edge](../08-king-yemmas-desk-gateways/README.md)
