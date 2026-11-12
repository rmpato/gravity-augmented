# Capsule 09 · Hyperbolic Time Chamber — Load Testing & Capacity

> *A year of training inside, a day outside. The gravity is ten times normal and
> the air is thin. Crucially: it is a room you can leave. You find your limits
> somewhere you can walk out of, not in the middle of a fight.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 6 | 70 min | Capsules 05–08 | Local |

---

## Why this capsule exists

Every capacity conversation you will ever have — "can we handle Black Friday?",
"do we need bigger instances?", "why did it fall over at 3pm?" — is answered
with numbers or it is answered with vibes.

This capsule is where you stop guessing. You'll generate real load, read
percentiles properly, find the exact point where your service falls off a cliff,
and learn why that cliff exists mathematically rather than mysteriously.

It's also the capsule that makes every *later* capsule measurable. From here on,
"the cache made it faster" is a number.

---

## The concept

### Averages lie. Percentiles don't.

```
  1000 requests: 990 take 10ms, 10 take 5000ms

  average  =  59ms      ← looks great, is a lie
  p50      =  10ms
  p95      =  10ms
  p99      =  10ms
  p99.9    = 5000ms     ← the truth
```

Worse: **users don't experience one request.** A page that makes 20 backend
calls hits p99 latency with probability `1 - 0.99²⁰ ≈ 18%`. Your "1% slow"
becomes "1 in 5 page loads is slow." Your heaviest users — the ones who matter
most — live permanently in your tail.

Report **p50, p95, p99** always, and p99.9 for anything user-facing. Never
average percentiles across instances or time buckets; that's mathematically
meaningless. (This is why real monitoring systems store histograms, not
pre-computed percentiles.)

### Little's Law

The one piece of queueing theory worth memorising:

```
        L = λ × W

   L = concurrent requests in the system
   λ = arrival rate (requests/sec)
   W = average time in the system (sec)
```

It's simple and it answers real questions:

- *"1000 RPS, 200 ms average latency — how many concurrent requests?"*
  `L = 1000 × 0.2 = 200`. So you need at least 200 concurrent slots. If your
  service handles 80 concurrent per instance, that's **3 instances minimum**.
- *"My connection pool is 20 and each query takes 50 ms. Max throughput?"*
  `λ = L/W = 20/0.05 = 400 QPS`. No amount of extra web replicas changes that
  number — the pool is the ceiling.

### The latency knee

Utilisation and latency are not linear. From queueing theory, for a simple
system, `wait time ∝ ρ / (1 - ρ)` where ρ is utilisation:

```
  latency
    │                                        ╱│  ← vertical asymptote at 100%
    │                                      ╱
    │                                   ╱
    │                              ╱
    │                    ╱────╱          ← THE KNEE (~70-80%)
    │  ────────────╱
    └──────────────────────────────────────────► utilisation
       10%   30%   50%   70%   80%  90%  95%
```

At 50% utilisation, queueing adds 1× the service time. At 90%, it adds **9×**.
At 99%, **99×**.

Two consequences that shape real architecture:

1. **Never plan to run at 90% utilisation.** Target 60–70% so you have room for
   a spike, and so latency stays flat rather than nonlinear.
2. **"It was fine yesterday at 65% and fell over today at 78%"** is not
   mysterious. It's the knee.

### Closed vs open load models

This is the thing most people get wrong, and it invalidates their results.

**Closed model** — N virtual users, each in a loop: request → wait for response
→ think → repeat. If the server slows down, the users *slow down too*, so the
offered load drops. This **hides overload**: the system looks like it degrades
gracefully because your load generator is politely backing off.

**Open model** — requests arrive at a fixed rate regardless of what the server
is doing. This is how real traffic works: the internet does not wait for you.
Under overload the queue grows without bound and you see the real cliff.

> Use a **closed** model to simulate a fixed set of clients (a batch job, a
> mobile app with limited concurrency). Use an **open** model to find your
> breaking point. In k6 that's `constant-arrival-rate`; in most other tools it's
> "RPS mode".
>
> The failure to distinguish these is called **coordinated omission**, and it's
> why so many published benchmarks are optimistic nonsense.

### Four kinds of test

| Test | Shape | Answers |
|---|---|---|
| **Smoke** | tiny load, 1 min | does it work at all? Run in CI |
| **Load** | expected peak, 10–30 min | do we meet SLOs at normal peak? |
| **Stress** | ramp until it breaks | where's the cliff, and how does it fail? |
| **Soak** | moderate load, hours | memory leaks, connection leaks, disk fill |

**Soak tests catch what nothing else does.** A leak of 1 MB per 1000 requests is
invisible in a 10-minute test and takes production down on day four.

### What to measure while you generate load

- **RED** (per service): **R**ate, **E**rrors, **D**uration
- **USE** (per resource): **U**tilisation, **S**aturation, **E**rrors

Utilisation is "how busy". **Saturation is "how much is waiting"** — queue depth,
run-queue length, throttled CPU time, pool wait time. Saturation is the metric
that predicts the knee; utilisation only tells you where you are on the curve.

---

## Lab

```bash
brew install k6
```

k6 is a load generator that scripts in JavaScript and reports proper
percentiles. Its `constant-arrival-rate` executor gives you a true open model,
which is why we're using it over `ab` or `wrk`.

> **Don't want another binary?** k6 runs fine from its own image, and every
> `k6 run …` in this capsule maps to:
>
> ```bash
> docker run --rm -i --network host -v "$PWD/scripts/load:/s:ro" \
>   grafana/k6 run -e BASE=http://localhost:8080 /s/smoke.js
> ```
>
> `--network host` is what lets the container reach your service on
> `localhost`. This whole capsule was verified that way.

### Step 1 — a smoke test

**`scripts/load/smoke.js`** in `gravity-chamber`:

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 1,
  duration: '20s',
  thresholds: {
    // Thresholds are pass/fail criteria. A failed threshold exits non-zero,
    // which is what makes this runnable in CI.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
  },
};

const BASE = __ENV.BASE || 'http://localhost:8080';

export default function () {
  const res = http.get(`${BASE}/leaderboard`);
  check(res, {
    'status 200': (r) => r.status === 200,
    'has body': (r) => r.body.length > 0,
  });
}
```

```bash
make run                       # scouter on :8080
k6 run scripts/load/smoke.js
```

Read the summary carefully — `http_req_duration` with `avg`, `min`, `med`,
`max`, `p(90)`, `p(95)`. Note how far `max` is from `p(95)`. That gap is the
tail, and it is where your worst user lives.

### Step 2 — find the knee (open model)

**`scripts/load/stress.js`**

```javascript
import http from 'k6/http';
import { Trend } from 'k6/metrics';

// OPEN model: requests arrive at a fixed rate whether or not the server keeps
// up. This is what real traffic does, and it is the only way to see the cliff.
export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 800,          // must be high enough not to become the bottleneck
      stages: [
        { target: 50,   duration: '30s' },
        { target: 100,  duration: '30s' },
        { target: 200,  duration: '30s' },
        { target: 400,  duration: '30s' },
        { target: 800,  duration: '30s' },
        { target: 1600, duration: '30s' },
      ],
    },
  },
};

const BASE = __ENV.BASE || 'http://localhost:8080';
const write = new Trend('write_latency', true);

export default function () {
  // A read-heavy mix with some writes — closer to real traffic than either alone.
  if (Math.random() < 0.1) {
    const r = http.post(`${BASE}/readings`,
      JSON.stringify({ fighter: `f${Math.floor(Math.random() * 1000)}`,
                       power: Math.floor(Math.random() * 100000) }),
      { headers: { 'Content-Type': 'application/json' } });
    write.add(r.timings.duration);
  } else {
    http.get(`${BASE}/leaderboard?limit=10`);
  }
}
```

Run it against the container so you can constrain resources:

```bash
make docker-build
docker run -d --rm -p 8080:8080 --name hbtc --cpus=0.25 --memory=512m scouter:latest

k6 run scripts/load/stress.js
```

> **Why `--cpus=0.25` and not 1.** An in-memory Go service on a modern laptop is
> far faster than this ramp. Measured on an 8-core M-series Mac, same script:
>
> | Service limit | p95 | peak VUs | dropped iterations |
> |---|---|---|---|
> | `--cpus=1` | **1.16 ms** | 3 | 0 |
> | `--cpus=0.25` | **68 ms** | 151 | 332 |
>
> At `--cpus=1` there is no knee to find — latency is flat all the way to 1600
> rps and k6 never needs more than 3 concurrent VUs. You would conclude the
> service is infinitely scalable, which is the exact error this capsule exists
> to prevent.
>
> Two runs of that second row gave p95 of 68 ms and 30 ms, with peak VUs of 151
> and 45. **Your exact numbers will differ and will not repeat — the shape is
> what's stable.** The gap between constrained and unconstrained (26–60×) is far
> larger than that run-to-run spread, which is what makes the knee a real finding
> rather than noise. Capsule 07 shows you the opposite case, where an effect
> smaller than the variance is not a finding at all.
>
> **If your machine is fast, turn the limit DOWN until you can see the cliff.**
> Choosing the constraint so the effect is visible is a legitimate part of load
> testing — you are not cheating, you are picking a scale where the dynamics
> are observable. Note the peak-VU and dropped-iteration columns: those move
> long before latency does, which makes them the earliest saturation signal you
> have.

In a second pane, watch it happen:

```bash
lazydocker      # Stats panel: CPU pinning at 100%, memory climbing
```

**Record the numbers in `NOTES.md`:**

| Target RPS | Achieved RPS | p50 | p95 | p99 | error % |
|---|---|---|---|---|---|
| 50 | | | | | |
| 100 | | | | | |
| 200 | | | | | |
| 400 | | | | | |
| 800 | | | | | |
| 1600 | | | | | |

Three things to look for, and they arrive in this order:

1. **Achieved RPS stops tracking target RPS.** That's saturation. The row where
   they diverge is your real capacity.
2. **p99 climbs far faster than p50.** The tail always goes first. By the time
   p50 moves, you're well past the knee.
3. **Errors appear.** Usually last, and usually as timeouts rather than 500s.

The point where (1) happens is the number you put in a capacity plan. Everything
past it is the cliff.

### Step 3 — prove Little's Law on your own data

Take a row from your table below the knee:

```
  L = λ × W

  λ = achieved RPS
  W = p50 latency in seconds
  L = concurrent requests in flight
```

Now compare `L` to `k6`'s reported `vus` at that moment. They should be close.
If they aren't, your load generator was the bottleneck (`maxVUs` too low), and
your whole test is invalid — that's the most common way load tests lie.

### Step 4 — closed vs open, side by side

Copy `stress.js` to `closed.js` and swap the executor — **and fix the `// OPEN
model:` comment at the top while you're there.** A comment that contradicts the
code below it is worse than no comment; this file now demonstrates the opposite
of what that line claims.

```javascript
    ramp: {
      executor: 'ramping-vus',      // CLOSED: N users, each waits for a response
      startVUs: 10,
      stages: [
        { target: 50,  duration: '30s' },
        { target: 200, duration: '30s' },
        { target: 800, duration: '30s' },
      ],
    },
```

```bash
k6 run scripts/load/closed.js
```

Compare with the open run. The closed model shows **higher latency but no error
cliff** — because as the server slows, the virtual users slow down with it and
stop offering load. It looks like graceful degradation. It isn't; it's your load
generator being polite in a way real users never are.

Write in `NOTES.md`: *"A closed-model test cannot find my breaking point."*

### Step 5 — vary the resources, watch the knee move

```bash
for cpus in 0.125 0.25 0.5; do
  docker rm -f hbtc 2>/dev/null
  docker run -d --rm -p 8080:8080 --name hbtc --cpus=$cpus --memory=512m scouter:latest
  sleep 2
  echo "=== cpus=$cpus ==="
  k6 run --quiet scripts/load/stress.js 2>&1 | grep -E 'http_reqs|http_req_duration|http_req_failed|dropped_iterations|vus_max'
done
```

Those are the Step 2 limit halved and doubled. Not `0.5 1 2`: at `--cpus=1`
the knee is already past the top of this ramp (see Step 2), so most of a sweep
up there would just look flat.

Compare `dropped_iterations` and `vus_max` across the runs, not `http_reqs`.
Every run is offered the same arrival schedule, so the request count barely
changes while the service keeps up. If the `dropped_iterations` line is missing,
nothing was dropped. Expect three different shapes:

- **`0.125`**: well past the knee. p95 is orders of magnitude worse than the
  others, a large share of iterations are dropped, and `vus_max` hits the 800
  ceiling.
- **`0.25`**: your Step 2 run, at or around the knee late in the ramp.
- **`0.5`**: flat. Low p95, next to nothing dropped, `vus_max` stays near its
  50 preallocated. The knee didn't disappear. It moved past 1600 rps, the top
  of the ramp. A flat run is a lower bound ("at least 1600 rps"), not a
  capacity number.

Doubling the CPU moved the knee further than this ramp can follow, and that is
the result. If all three look flat on your machine, halve all three values; if
all three collapse, double them. The same rule as Step 2 applies: pick the scale
where the knee lands inside the ramp.

You now have a **capacity model**: RPS per vCPU. Take it from a run whose knee
falls inside the ramp (the achieved RPS where it stopped tracking target, divided
by `--cpus`), never from a flat run, which only tells you the ceiling is higher
still. That single number lets you
answer "how many instances for 10,000 RPS?" without running another test — and
it's exactly what Capsule 26 asks you to produce.

### Step 6 — a threshold that gates CI

Add to the Makefile:

```makefile
## loadtest: smoke test with SLO thresholds (fails the build if breached)
loadtest:
	k6 run scripts/load/smoke.js
```

`k6` exits non-zero when a threshold fails, so this is a real quality gate. A
performance regression that would have shipped now fails a build instead.

```bash
docker rm -f hbtc
```

---

## In GCP

- **Cloud Monitoring** shows request latency, instance count and CPU for Cloud
  Run automatically. Latency there is a **distribution**, so you can chart p50/
  p95/p99 without instrumenting anything.
- **Cloud Trace** samples requests and shows where the time went — invaluable
  once there are multiple services (Capsule 25).
- **Cloud Run concurrency** is the per-instance concurrency from Capsule 06. Use
  your k6 numbers to set it: if one instance saturates around 60 in-flight
  requests, set `--concurrency=60`, not the default 80.
- **Load-testing someone else's infrastructure is an attack.** Google's terms
  permit testing *your own* resources; check the current policy before anything
  large, and never point a load generator at a third-party API.
- **Cost warning:** a stress test against Cloud Run with `--max-instances=100`
  will happily scale to 100 instances and bill you. Set `--max-instances` low
  before testing, and prefer testing locally.

---

## Bring it to work

- **Never report an average latency.** p50/p95/p99, always.
- **Open model to find limits.** If your load tool doesn't do arrival-rate mode,
  your breaking-point numbers are optimistic.
- **Plan for 60–70% utilisation.** The knee is real and it's steep.
- **Soak test before any big launch.** Leaks are invisible in short tests.
- **Put a threshold-gated smoke test in CI.** It's 20 seconds and it catches
  regressions when they're one commit old.
- **Test the mix, not one endpoint.** Real traffic is reads *and* writes, and
  write contention is usually what breaks first.
- **Record capacity as a ratio** (RPS per vCPU, RPS per instance). It's the only
  form that survives your traffic doubling.

---

## Battle drill

<details>
<summary><b>1.</b> Load test: average 45 ms, p99 3.2 s. The team says "average is fine, ship it." Respond.</summary>

1% of requests take 3.2 seconds. If a page makes 10 backend calls, ~10% of page
loads contain at least one 3-second call, so roughly 1 in 10 users has a bad
experience — not 1 in 100.

Second: latency correlates with user weight. The user with the most data hits
the slow path *every time*, so your best customers experience p99 as their p50.

Third: what's the p99.9? Under retries and timeouts a 3.2 s p99 usually hides a
15 s p99.9, which is where the timeouts and cascading failures live.

Investigate what makes those requests slow — it's almost always a specific cause
(a missing index, a cold cache, an N+1, a lock), not uniform slowness.
</details>

<details>
<summary><b>2.</b> Your load test shows 5,000 RPS. Production falls over at 800. What went wrong?</summary>

The usual suspects, in order of frequency:

- **Wrong workload mix** — you tested one cheap endpoint; production is 20
  endpoints and the expensive ones dominate.
- **No data** — an empty database with 100 rows has every index in memory.
  Production has 50 million rows and hits disk.
- **Cache warm in the test** — the same key requested repeatedly gives a 100%
  hit rate that production never sees.
- **Closed-model test** — coordinated omission hid the cliff.
- **Load generator was the bottleneck** — you measured your laptop, not the
  service.
- **Test environment ≠ production** — different instance sizes, no network hop,
  no TLS, no sidecars, no noisy neighbours.

The fix is a realistic mix, production-shaped data volume, realistic cache hit
rates, and open-model arrival.
</details>

<details>
<summary><b>3.</b> Latency is flat until 70% CPU, then explodes. Why isn't it linear?</summary>

Queueing. Once a resource is busy, new work waits, and waiting time scales as
`ρ/(1-ρ)`. At 50% utilisation the queue adds 1× the service time; at 90% it adds
9×; at 99%, 99×. The curve has a vertical asymptote at 100%.

That's why capacity planning targets 60–70%: it's not conservatism, it's the
shape of the function. It's also why "we added 10% more traffic and everything
broke" is a completely ordinary thing to happen when you were already at 85%.
</details>

<details>
<summary><b>4.</b> Explain coordinated omission in one paragraph.</summary>

A closed-model load generator sends the next request only after the previous one
returns. When the server stalls for 2 seconds, the generator *doesn't send* the
requests it would have sent during that window — so those requests are never
measured, and the stall is recorded as one slow request instead of the hundreds
of users who would actually have been queued behind it.

The result is systematically optimistic percentiles. The fix is an open model
(fixed arrival rate) or a generator that compensates by back-filling the
timestamps it should have used.
</details>

<details>
<summary><b>5.</b> Your connection pool is 20, queries average 50 ms. What's your max throughput, and how do you raise it?</summary>

Little's Law: `λ = L/W = 20 / 0.05 = 400 QPS`. Hard ceiling, regardless of how
many web replicas you add — they'll just queue for the pool.

To raise it: make queries faster (`W` down — an index at 5 ms gives 4,000 QPS,
a 10× win for zero infrastructure); or enlarge the pool (`L` up — but the
database has its own limit, and past it you make things *worse*); or remove the
queries entirely with a cache (Capsule 14); or add read replicas (Capsule 13).

Note the ordering: `W` is almost always the cheapest lever, and it's the one
people reach for last.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `dial: i/o timeout` at high rates | Local file-descriptor limit. `ulimit -n 10240` in the k6 shell. |
| Achieved RPS never reaches target | Either the service is saturated (the finding!) or `maxVUs` is too low (invalid test). Check `vus` vs `vus_max` in the output. |
| Latency looks identical at every rate | You're testing a cached/trivial endpoint, or Docker's port forwarding is the bottleneck. Use a realistic mix. |
| macOS ephemeral port exhaustion | `sysctl net.inet.ip.portrange.first` — or lower the rate. Laptops are not load-test rigs. |
| Results differ 2× between runs | Thermal throttling, background apps, Docker VM contention. Run three times, take the median, care about the shape not the absolute values. |
| k6 itself pegs your CPU | The generator is competing with the service for cores. On one laptop, treat absolute numbers as indicative only. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "test(load): k6 smoke and open-model stress scenarios

Capsule 09. Found the knee at N RPS at --cpus=0.25; recorded RPS-per-vCPU as a
capacity ratio. Confirmed a closed-model test cannot find the breaking point
(coordinated omission). Smoke test has SLO thresholds so CI can gate on it."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 09
```

**Next:** [Capsule 10 · The Grand Elder's Archive — Relational Data](../10-grand-elder-archive-relational/README.md)
