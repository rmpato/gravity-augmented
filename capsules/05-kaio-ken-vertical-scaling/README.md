# Capsule 05 · Kaio-ken — Vertical Scaling and Its Price

> *Kaio-ken multiplies Goku's power instantly. No new fighters, no coordination,
> no strategy — just more, right now. It also tears his body apart, and each
> multiplier costs more than the last. King Kai's warning is the whole lesson:
> it works, and it does not scale.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 5 | 70 min | Capsules 00–04 | Local |

---

## Why this capsule exists

When something is slow, the first instinct is to make the machine bigger. It's
often correct! It's always the *cheapest thing to try* in engineering hours, and
"just buy a bigger box" has saved more weekends than any distributed system ever
has.

But it has a ceiling, and a cost curve, and specific failure modes. This capsule
gets you to the point where you can say, with numbers, **"vertical scaling buys
us N months, here's what it costs, and here's the wall."** That sentence is the
difference between an engineer who guesses and one who plans.

---

## The concept

### What "vertical" actually controls

Under the hood these are cgroup limits — the same mechanism from Capsule 02.

| Resource | Limit looks like | You hit the wall as |
|---|---|---|
| **CPU** | `--cpus=2` (a quota per period) | requests queue, latency climbs, throughput plateaus |
| **Memory** | `--memory=512m` | the **OOM killer** kills the process. Instantly. No graceful shutdown. |
| **Disk I/O** | IOPS/throughput caps | mysterious latency that isn't CPU |
| **Network** | bandwidth caps per instance class | throughput plateau on large responses |

**CPU throttling and memory OOM are completely different failures.** CPU
pressure degrades you gradually — things get slower. Memory pressure kills you
instantly, mid-request, with no chance to drain. That asymmetry means memory
limits deserve much more headroom than CPU limits.

### The cost curve is superlinear

Cloud instance pricing is roughly linear in vCPU until it isn't:

```
  cost
   │                                        ╱  ← specialised/large SKUs:
   │                                    ╱      the price per vCPU rises
   │                          ╱─────╱
   │              ╱───────╱
   │      ╱───╱
   │  ╱╱
   └────────────────────────────────────────►  vCPUs
     2    4     8     16      32      64     128
```

And the *benefit* curve is sublinear, for two reasons:

**Amdahl's law** — if a fraction *s* of your work is inherently serial, the best
speedup you can ever get from *N* processors is `1 / (s + (1-s)/N)`. With 10%
serial work, infinite cores gives you **10×**. Not 100×. Not 1000×. Ten.

**Contention** — more threads on shared state means more lock contention, more
cache-line bouncing, more GC pressure. Past some point, adding cores makes a
badly-shaped program *slower*.

Superlinear cost meeting sublinear benefit is why vertical scaling always ends.

### The four hard limits

1. **The biggest machine exists.** GCP tops out around 224 vCPU / 12 TB
   (`m3-ultramem`). It's very expensive and you will hit it eventually.
2. **It's a single point of failure.** One enormous machine has one fate. This
   is the argument that usually wins, before cost does.
3. **Resizing usually needs a restart.** Vertical scaling is not elastic — you
   cannot follow a traffic spike with it in real time.
4. **Amdahl caps you** regardless of budget.

### When vertical scaling is genuinely the right answer

Don't over-learn the lesson. Reach for a bigger box when:

- **The workload is stateful and hard to distribute** — a primary database is
  the canonical case. Sharding a database (Capsule 12) is a project measured in
  quarters; doubling its RAM is an afternoon.
- **You're memory-bound on a working set that must be in one place.**
- **You're early.** Two engineers and 500 users do not need a distributed
  system. A big VM and a good night's sleep is the correct architecture.
- **The serial fraction is large** — some workloads simply don't parallelise,
  and a faster single core is the only lever.

**The general principle: scale vertically until it's uncomfortable, then scale
horizontally.** Premature distribution is the more expensive mistake — it costs
you complexity, latency, consistency problems, and debugging difficulty
*forever*, in exchange for capacity you didn't need yet.

### The container CPU trap (this one bites everybody)

A runtime that asks the OS "how many CPUs are there?" gets the **host's** count,
not the cgroup limit. Give a container `--cpus=1` on a 10-core machine and Go
will still set `GOMAXPROCS=10`, running ten OS threads that collectively get one
core's worth of quota.

The result: heavy context switching, GC assist storms, and **latency spikes with
CPU utilisation that looks fine**. It is one of the most common and most
confusing production issues in containerised Go.

The same class of bug exists in the JVM (fixed by
`-XX:+UseContainerSupport`, on by default in modern JDKs) and in Node's
`libuv` thread pool sizing.

You will reproduce it below.

> Go 1.25 made the runtime cgroup-aware, so `GOMAXPROCS` respects the CPU limit
> automatically. On earlier versions — including the 1.23 in these capsules —
> you set it yourself or use `go.uber.org/automaxprocs`. Know the mechanism
> either way; the equivalent trap in other runtimes is alive and well.

---

## Lab — find your own ceiling

In `~/repos/pato/gravity-chamber`.

### Step 1 — something that actually burns CPU

Add to **`internal/scouter/server.go`**, in `Routes()`:

```go
	mux.HandleFunc("GET /train", s.handleTrain)
```

and the handler, plus its import of `crypto/sha256` and `strconv`:

```go
// handleTrain burns CPU on purpose: a deliberately serial hash chain that
// no amount of parallelism inside one request can speed up.
//
// CALIBRATE `rounds` ON YOUR MACHINE — do not trust a number from a README.
// ARM chips (Apple Silicon, Graviton) have SHA-256 in hardware and run this
// loop roughly 5x faster than an x86 core without the extension. On an M-series
// Mac 1,000,000 rounds is ~100ms; on an older x86 laptop 200,000 might be.
func (s *Server) handleTrain(w http.ResponseWriter, r *http.Request) {
	rounds := 1_000_000
	if v := r.URL.Query().Get("rounds"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50_000_000 {
			rounds = n
		}
	}

	start := time.Now()
	sum := sha256.Sum256([]byte("kaio-ken"))
	for i := 0; i < rounds; i++ {
		sum = sha256.Sum256(sum[:]) // each round needs the previous one
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"rounds":      rounds,
		"digest":      hex.EncodeToString(sum[:8]),
		"duration_ms": time.Since(start).Milliseconds(),
		"gomaxprocs":  runtime.GOMAXPROCS(0),
		"num_cpu":     runtime.NumCPU(),
	})
}
```

Add the imports: `crypto/sha256`, `encoding/hex`, `runtime`.

Note what the response reports: **`gomaxprocs` and `num_cpu`**. Those two
numbers disagreeing is the trap.

### Step 2 — calibrate, then baseline

```bash
make docker-build
docker run -d --rm -p 8080:8080 --name kaioken scouter:latest

curl -s "localhost:8080/train?rounds=1000000" | jq
```

**Calibrate before you measure anything.** The whole capsule depends on one
request taking long enough to dominate HTTP overhead — aim for **~200 ms**. If
you skip this the ladder in Step 3 is mostly noise:

```bash
# Find the rounds value that lands near 200ms on YOUR machine.
for r in 250000 500000 1000000 2000000 4000000; do
  ms=$(curl -s "localhost:8080/train?rounds=$r" | jq .duration_ms)
  echo "rounds=$r  ${ms}ms"
done
```

Pick the closest to 200 and pin it for the rest of the capsule:

```bash
export ROUNDS=2000000     # <- YOUR number, not this one
```

> Apple Silicon and AWS Graviton implement SHA-256 in hardware, so they need
> roughly **5× the rounds** an x86 core without the extension does. This is a
> good habit in itself: a benchmark you didn't calibrate on the machine under
> test is measuring the machine, not the change.

Note `num_cpu` and `gomaxprocs`. Now measure throughput with a crude but honest
load loop:

```bash
# 40 requests, 8 at a time — no extra tooling needed
time (for i in $(seq 1 40); do
        curl -s -o /dev/null "localhost:8080/train?rounds=$ROUNDS" &
        [ $((i % 8)) -eq 0 ] && wait
      done; wait)
```

Write the elapsed time down. `docker stop kaioken`.

### Step 3 — the Kaio-ken ladder

Run the same load at each CPU limit and record the numbers:

```bash
for cpus in 0.25 0.5 1 2 4; do
  docker run -d --rm -p 8080:8080 --name kaioken --cpus=$cpus scouter:latest >/dev/null
  sleep 1
  echo "=== --cpus=$cpus ==="
  time (for i in $(seq 1 40); do
          curl -s -o /dev/null "localhost:8080/train?rounds=$ROUNDS" &
          [ $((i % 8)) -eq 0 ] && wait
        done; wait)
  docker stop kaioken >/dev/null
done
```

Put it in a table in `NOTES.md`:

| `--cpus` | elapsed | req/s | speedup vs 0.25 | *linear* would be |
|---|---|---|---|---|
| 0.25 | | | 1.0× | 1× |
| 0.5 | | | | 2× |
| 1 | | | | 4× |
| 2 | | | | 8× |
| 4 | | | | 16× |

**Look at the last two columns.** Somewhere in there the actual speedup stops
tracking the theoretical one. That gap is Amdahl plus contention plus your
laptop's real core count — and finding that knee is the single most useful
capacity skill in this entire repo.

While one is running, open `lazydocker` → **Stats** and watch the CPU graph pin
at exactly the limit. That flat ceiling is cgroup throttling, live.

### Step 4 — reproduce the GOMAXPROCS trap

```bash
docker run --rm --cpus=1 scouter:latest &   # (or just curl the running one)
curl -s "localhost:8080/train?rounds=100000" | jq '{gomaxprocs, num_cpu}'
```

You'll see something like `{"gomaxprocs": 10, "num_cpu": 10}` on a 10-core
machine **even though the container is limited to 1 CPU**. Ten runnable threads
fighting over one core's quota.

Now fix it and compare:

```bash
docker run -d --rm -p 8081:8081 --name fixed --cpus=1 \
  -e PORT=8081 -e GOMAXPROCS=1 scouter:latest

curl -s "localhost:8081/train?rounds=100000" | jq '{gomaxprocs, num_cpu, duration_ms}'
```

Run the concurrent load against both and compare tail latency, not just the
mean. The unconstrained-GOMAXPROCS one usually shows a worse p99 — that's the
context-switching cost, and it's exactly what makes this bug so hard to spot
from a dashboard showing healthy average CPU.

The production fix is one import in `main.go`:

```go
import _ "go.uber.org/automaxprocs"   // go get go.uber.org/automaxprocs
```

It reads the cgroup quota at startup and sets `GOMAXPROCS` accordingly. Add it —
it's a genuinely good habit for any containerised Go service on Go < 1.25.

### Step 5 — meet the OOM killer

CPU pressure is polite. Memory pressure is not.

Temporarily add a handler that allocates:

```go
	mux.HandleFunc("GET /bulk", func(w http.ResponseWriter, r *http.Request) {
		mb := 50
		if v := r.URL.Query().Get("mb"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 4096 {
				mb = n
			}
		}
		hold := make([][]byte, 0, mb)
		for i := 0; i < mb; i++ {
			b := make([]byte, 1<<20)
			for j := range b {
				b[j] = byte(i) // touch every page so it's really resident
			}
			hold = append(hold, b)
		}
		writeJSON(w, http.StatusOK, map[string]any{"allocated_mb": len(hold)})
	})
```

```bash
make docker-build
docker run -d --rm -p 8080:8080 --name oom --memory=256m scouter:latest

curl -s "localhost:8080/bulk?mb=100" | jq     # fine
curl -s "localhost:8080/bulk?mb=400" | jq     # ...

docker inspect oom --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

`curl` gets an empty reply. `OOMKilled: true`, exit code **137** (128 + SIGKILL).

**There were no shutdown logs.** The graceful shutdown you built in Capsule 01
never ran, because SIGKILL cannot be caught. Every in-flight request on that
instance died. Note the exit code 137 — recognising it instantly will save you
an hour some day.

Remove the `/bulk` handler when you're done. Keep `/train`; Capsule 09 uses it.

---

## In GCP

**Cloud Run** vertical limits: up to 8 vCPU and 32 GiB per instance (gen2).
Billing is `vCPU-seconds × price + GiB-seconds × price`, so doubling CPU roughly
doubles cost per unit time.

```bash
gcloud run deploy scouter --cpu=2 --memory=1Gi --region=us-central1
```

Two Cloud Run specifics worth knowing:

- **`--cpu-boost`** gives extra CPU during container startup only. It's a
  targeted fix for cold-start latency without paying for a bigger instance all
  the time.
- **CPU is throttled to near-zero between requests** unless you set
  `--no-cpu-throttling` (a.k.a. "CPU always allocated"). If you run background
  goroutines — a cache refresher, a batch flusher — they will mysteriously stall
  between requests. This surprises everyone once.

**Compute Engine** machine families, and what they're for:

| Family | Shape | Use |
|---|---|---|
| `e2` | cheap, shared-core options | dev, small services. Bursty and unpredictable |
| `n2` / `n2d` | balanced | the default |
| `c3` / `c2` | high clock, compute-optimised | CPU-bound work, game servers |
| `m3` | huge memory (up to 12 TB) | in-memory databases, big caches |

**Cloud SQL** is the place you'll actually do vertical scaling in anger: you
change the machine type and it restarts (a brief outage, or a failover if HA is
on). This is why capacity planning for a database matters more than for
stateless services — resizing has a cost you can't hide.

---

## Bring it to work

- **Always set both requests and limits.** Unlimited memory means one bad
  request evicts your neighbours; unlimited CPU means unpredictable performance.
- **Give memory more headroom than CPU.** CPU pressure degrades; memory pressure
  kills without warning.
- **Know your runtime's container-awareness story.** `automaxprocs` for Go
  < 1.25, `UseContainerSupport` for the JVM, `UV_THREADPOOL_SIZE` for Node.
- **Exit code 137 means OOMKilled.** Memorise it.
- **Measure the knee before you buy the bigger box.** "We tested 1, 2, 4 and 8
  vCPU; the gain from 4→8 was 12%" is a real capacity argument. "It feels slow"
  is not.
- **State the ceiling explicitly in design docs**: "this buys us to ~8k RPS,
  after which we need horizontal scaling and a shared cache."

---

## Battle drill

<details>
<summary><b>1.</b> Latency doubled. CPU utilisation reads 45%. What are you looking at?</summary>

Utilisation is an average and it hides everything interesting:

- **CPU throttling** — cgroup quota exhausted within each 100 ms period. The
  average looks fine; the process is stopped for part of every period. Check
  `container_cpu_cfs_throttled_seconds_total`, not utilisation.
- **The GOMAXPROCS trap** — too many threads for the available quota, so time
  goes to context switching.
- **You aren't CPU-bound at all** — lock contention, disk I/O, a slow
  dependency, or GC pauses. All show low CPU with high latency.
- **Queueing** — you're at the knee of the latency curve, where a small
  utilisation increase produces a large latency increase (Capsule 09).

The lesson: **utilisation is not saturation.** Saturation metrics (queue depth,
throttled time, run-queue length) are what tell you.
</details>

<details>
<summary><b>2.</b> A colleague says "we're at 80% CPU, let's double the instance size." What do you ask?</summary>

- p50 vs p99 latency — is anyone actually suffering, or is 80% just efficient?
- Is it throttling, or genuinely doing work?
- What's the *growth rate*? Doubling buys you one doubling; if traffic grows 20%
  a month, that's under four months.
- Is the service stateless? If yes, horizontal is probably cheaper and safer.
- What does profiling say? A single bad query or an N+1 (Capsule 10) is often
  worth 10× and costs nothing per month.
- What does the bigger instance cost per month vs. two of the current one?

Doubling the box is a legitimate answer — it's just rarely the *first* thing
worth checking.
</details>

<details>
<summary><b>3.</b> Why does vertical scaling remain the right answer for a primary database far longer than for a web tier?</summary>

The web tier is stateless: replicas are interchangeable and adding one is a
config change. A primary database holds state, so "adding one" means choosing
between sharding (application-level routing, cross-shard queries, resharding
projects — Capsule 12) or a distributed SQL system like Spanner (expensive,
different constraints).

Both are quarters of work. Doubling the instance is an afternoon and a restart.
So you buy time vertically, deliberately, while you build the horizontal answer —
and you make sure you start building it before the ceiling, not after.
</details>

<details>
<summary><b>4.</b> Your service has 10% inherently serial work. What's the maximum useful core count?</summary>

Amdahl: speedup = 1 / (0.1 + 0.9/N). At N=8 → 4.7×. At N=16 → 6.4×. At N=∞ →
**10×**.

So going 8→16 cores costs 2× and buys 1.36×. That is the moment vertical scaling
stops being economically sensible, and the number you put in the design doc.

The higher-leverage move is usually attacking the serial fraction itself — the
global lock, the sequential ID generator, the single-threaded serialisation
step.
</details>

<details>
<summary><b>5.</b> Why is memory pressure more dangerous than CPU pressure in a container?</summary>

CPU is *compressible*: exceed your quota and the kernel throttles you, so you go
slower but keep running and can shed load or scale out.

Memory is *incompressible*: there is no "run at 80% memory". Exceed the limit and
the kernel's OOM killer sends SIGKILL — uncatchable, no draining, no shutdown
hooks, every in-flight request lost, exit 137.

Practical consequences: set memory limits with real headroom, know your
allocation profile under peak load, bound request body sizes
(`http.MaxBytesReader` from Capsule 01), and paginate everything that could
return an unbounded result set.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `--cpus` seems to have no effect | Docker Desktop/OrbStack has its own VM-level CPU allocation. Check its settings; the container can't exceed the VM. |
| Timings are wildly inconsistent | Close other apps, disable turbo/thermal noise by running each test twice, and take the median. Laptops are terrible benchmark hosts — the *shape* of the curve is what matters, not absolute numbers. |
| Container exits with 137 | OOMKilled. Raise `--memory` or reduce allocation. |
| Container exits with 139 | SIGSEGV — a real crash, not a limit. |
| `gomaxprocs` still wrong after `automaxprocs` | The import must be blank (`_ "go.uber.org/automaxprocs"`) and in `main`'s package. Run `go mod tidy`. |
| `/train` returns instantly | `rounds` is capped at 5,000,000 and defaults to 200,000. Raise it if your machine is fast. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(scouter): cpu-bound /train endpoint and automaxprocs

Capsule 05. Measured the vertical scaling curve from 0.25 to 4 vCPU and
found the knee. Reproduced the GOMAXPROCS-vs-cgroup trap and fixed it.
Confirmed OOM kill is SIGKILL: no graceful shutdown, exit 137."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 05
```

**Next:** [Capsule 06 · Multi-Form — Horizontal Scaling & Statelessness](../06-multi-form-horizontal-scaling/README.md)
