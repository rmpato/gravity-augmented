# Capsule B6 · Reading Power Levels — Back-of-the-Envelope Estimation

> *"It's over 9000" is a terrible engineering statement. It tells you the scale
> and nothing else. But it is the right instinct: Vegeta needed one number, fast,
> to decide whether to fight or run. That decision doesn't need three
> significant figures.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 65 min | none | Capsule 26 |

---

## Why this capsule exists

"How many servers do we need?" is a question that stops a lot of engineers cold,
and it shouldn't. The answer is arithmetic you can do on a napkin in five
minutes, and being able to do it changes what you build.

It's the difference between "we should shard" (a quarter of work, based on a
feeling) and "3,000 writes/sec fits on one Postgres primary, so we won't"
(a decision, based on a number).

It's also the part of a system design interview where candidates most visibly
separate.

---

## The rules

**1. Round aggressively.**

```
  86,400 seconds/day  →  100,000  (call it 10⁵)
  1 year              →  30M seconds ≈ 3 × 10⁷
  1 million           →  10⁶ ; 1 billion → 10⁹
```

Using 100,000 instead of 86,400 introduces a 16% error. You are deciding between
"one server" and "a hundred servers" — 16% is irrelevant, and the round number
lets you do it in your head.

**2. Powers of two for data.**

```
  2¹⁰ = 1 thousand   (KB)
  2²⁰ = 1 million    (MB)
  2³⁰ = 1 billion    (GB)
  2⁴⁰ = 1 trillion   (TB)
```

**3. State your assumptions out loud.** The number is worthless without them, and
in an interview the assumptions are what's actually being assessed.

**4. Sanity-check against something you know.** "That's 40 TB/day — more than
Twitter's entire firehose. I've made an error somewhere."

---

## The numbers to memorise

### Latency (from Capsule B2)

```
  L1 cache                    0.5 ns
  Main memory               100 ns
  SSD random read           150 µs
  Datacenter round trip     500 µs
  Disk seek (spinning)       10 ms
  US → EU round trip         150 ms
```

### Throughput, order of magnitude

| Component | Rough capacity |
|---|---|
| One modern CPU core | ~10⁹ simple ops/sec |
| Postgres, simple indexed reads | 10k–50k QPS |
| Postgres, writes (one primary) | 5k–20k/sec |
| Redis, single instance | 100k+ ops/sec |
| One Go/Java service instance | 1k–10k RPS (I/O-bound) |
| Nginx / reverse proxy | 50k+ RPS |
| Kafka broker | 100k+ msg/sec |
| 1 Gbps network | 125 MB/sec |
| 10 Gbps network | 1.25 GB/sec |
| NVMe SSD | 1–7 GB/sec, 100k+ IOPS |

**These are order-of-magnitude figures.** Their value is telling you whether
you're at 10% or 1000% of a component's capability.

### Sizes

```
  UUID                 16 bytes (36 as a string — this matters at scale)
  int64 / timestamp     8 bytes
  A typical DB row     100 bytes – 1 KB
  A tweet-sized text   ~300 bytes
  A small JSON API response  1–10 KB
  A web page (HTML)    50–100 KB
  A compressed image   200 KB – 2 MB
  1 min of 1080p video ~50 MB
```

---

## The formulas

```
  ── TRAFFIC ────────────────────────────────────────────────
  avg QPS   = DAU × actions_per_day / 100,000
  peak QPS  = avg QPS × peak_factor        (2–10×; 3× is a good default)
  bandwidth = QPS × avg_response_size

  ── STORAGE ────────────────────────────────────────────────
  daily     = writes_per_day × bytes_per_record
  total     = daily × retention_days × replication_factor
  + indexes (roughly +30–100% of table size)
  + overhead, WAL, backups (call it ×1.5 overall)

  ── COMPUTE (Little's Law) ─────────────────────────────────
  concurrency = QPS × latency_seconds
  instances   = concurrency / concurrency_per_instance
  → then double it for redundancy and headroom

  ── CACHE ──────────────────────────────────────────────────
  hot set   = daily_active_items × item_size
  (the 80/20 rule: 20% of items usually serve 80% of requests)

  ── COST, very rough ───────────────────────────────────────
  1 vCPU · 1 month           ≈ $25
  1 GB RAM · 1 month         ≈ $3
  1 GB SSD · 1 month         ≈ $0.20
  1 GB egress to internet    ≈ $0.10
  1 GB object storage/month  ≈ $0.02
```

**Egress is the line item that surprises people.** It's frequently the largest
single cost in a consumer-facing system, and it's invisible until the bill
arrives.

---

## Worked example 1 — Twitter-scale timelines

> *"Design Twitter. 300M MAU."*

```bash
python3 - <<'PY'
MAU          = 300_000_000
DAU          = MAU * 0.5              # assumption: 50% daily
TWEETS_USER  = 0.5                    # most users read, few write
READS_USER   = 50                     # timeline refreshes
SEC_PER_DAY  = 100_000                # rounded from 86,400

writes = DAU * TWEETS_USER / SEC_PER_DAY
reads  = DAU * READS_USER  / SEC_PER_DAY
print(f"writes  {writes:>10,.0f} QPS   peak {writes*3:>10,.0f}")
print(f"reads   {reads:>10,.0f} QPS   peak {reads*3:>10,.0f}")
print(f"ratio   {reads/writes:.0f}:1  <-- THE number that drives the design\n")

TWEET = 300                            # bytes
daily = DAU * TWEETS_USER * TWEET
print(f"storage {daily/1e9:>8.1f} GB/day  {daily*365/1e12:>6.1f} TB/year")
print(f"        {daily*365*10/1e12:>8.1f} TB over 10 years (before replication)\n")

# fan-out on write: the number that decides the architecture
FOLLOWERS = 200                        # median, NOT mean
print(f"fan-out writes: {writes*FOLLOWERS:>12,.0f}/sec at {FOLLOWERS} followers")
print(f"celebrity (50M followers): {50_000_000:,} writes for ONE tweet")
PY
```

```
writes         750 QPS   peak      2,250
reads       75,000 QPS   peak    225,000
ratio   100:1  <-- THE number that drives the design

storage     22.5 GB/day     8.2 TB/year
             82.1 TB over 10 years (before replication)

fan-out writes:      150,000/sec at 200 followers
celebrity (50M followers): 50,000,000 writes for ONE tweet
```

**What the numbers tell you, and this is the whole skill:**

- **100:1 read:write** → this is a *read* system. Caching and read replicas are
  the architecture; the write path is comparatively easy.
- **225k peak reads/sec** → cannot come from a database. It's a cache and CDN
  problem.
- **82 TB over 10 years** → too big for one machine; sharding is genuinely
  required (unlike the Capsule 26 example, where it wasn't).
- **150,000 fan-out writes/sec** for ordinary users is large but tractable.
- **50 million writes for one celebrity tweet** → **fan-out on write cannot work
  for celebrities.** This single number is why Twitter's real architecture is
  hybrid (Capsule 20), and stating it is the strongest thing you can say in that
  interview.

### Sanity check

22.5 GB/day of tweet *text* — text only, no media, no metadata, no indexes.
That's the right order of magnitude for the text firehose. **Plausible —
continue.** (Media would dwarf it, which is itself worth saying out loud.)

---

## Worked example 2 — a video platform

> *"Design YouTube. 2B users, 1B hours watched per day."*

```bash
python3 - <<'PY'
HOURS_DAY   = 1_000_000_000
BITRATE_MBPS = 3                        # 1080p average across devices
bits = HOURS_DAY * 3600 * BITRATE_MBPS * 1e6
bytes_ = bits / 8
print(f"egress: {bytes_/1e15:.0f} PB/day  =  {bits/86400/1e12:.0f} Tbps sustained\n")

UPLOAD_HOURS_MIN = 500
MB_PER_MIN       = 50                    # after transcoding, all renditions
daily_up = UPLOAD_HOURS_MIN * 60 * MB_PER_MIN * 60 * 24 / 1e6
print(f"uploads: {daily_up:.0f} TB/day  =  {daily_up*365/1000:.0f} PB/year\n")

egress_cost = bytes_/1e9 * 0.02 * 365    # $0.02/GB at CDN-scale contract rates
print(f"egress at $0.02/GB: ${egress_cost/1e9:.1f} BILLION/year")
print("-> this is why YouTube built its own CDN and peers directly with ISPs")
PY
```

```
egress: 1350 PB/day  =  125 Tbps sustained

uploads: 2160 TB/day  =  788 PB/year

egress at $0.02/GB: $9.9 BILLION/year
-> this is why YouTube built its own CDN and peers directly with ISPs
```

**Sanity check:** 1,350 PB/day is 1.35 exabytes. Public estimates of YouTube's
daily egress are in that range, and 125 Tbps is a plausible fraction of total
internet traffic. **Plausible — continue.**

**The estimate produced a strategic insight**, not just a number: at this scale
bandwidth economics dominate everything else, which is exactly why Google places
its own cache boxes (Google Global Cache) *inside* ISP datacenters and peers
directly. No amount of application-level thinking gets you to that conclusion —
only the arithmetic does.

---

## Worked example 3 — the one you'll actually be asked

> *"We have 50,000 daily active users and it's slow. What do we need?"*

```bash
python3 - <<'PY'
DAU = 50_000
ACTIONS = 100
qps = DAU * ACTIONS / 100_000
print(f"average: {qps:.0f} QPS,  peak (3x): {qps*3:.0f} QPS")

LAT = 0.050
conc = qps * 3 * LAT
print(f"concurrent requests at peak: {conc:.0f}")
print(f"instances at 50 concurrent each: {conc/50:.1f}  -> run 3 for redundancy")

print(f"\ndatabase: {qps*3:.0f} QPS is ~1-3% of one Postgres instance")
print("verdict: this is NOT a capacity problem.")
PY
```

```
average: 50 QPS,  peak (3x): 150 QPS
concurrent requests at peak: 8
instances at 50 concurrent each: 0.1  -> run 3 for redundancy
database: 150 QPS is ~1-3% of one Postgres instance
verdict: this is NOT a capacity problem.
```

**150 QPS is nothing.** If it's slow at 150 QPS, the problem is a missing index,
an N+1, a synchronous external call, or a lock — not capacity. Adding servers
would cost money and change nothing.

**This is the most valuable estimate in the capsule**, because it's the one you'll
do most often, and it consistently prevents the wrong work.

---

## Lab — five, timed

Five minutes each. Write the assumptions down first, then compute, then sanity
check.

1. **A URL shortener.** 100M new URLs/day, 10B redirects/day. Storage after 5
   years? Peak redirect QPS? Does the mapping fit in RAM?

2. **A chat app.** 50M DAU, 40 messages sent per user per day, average group size
   8. Messages written/sec? Messages *delivered*/sec? Storage per year?

3. **A photo service.** 10M DAU, 2 uploads/day, 5 MB each, 4 thumbnail sizes
   generated. Storage per year? Egress if each photo is viewed 20 times?

4. **A ride-hailing app.** 1M active drivers sending location every 4 seconds.
   Write QPS? Bandwidth? Does it belong in Postgres?

5. **Your own current work project.** Real numbers, real cost estimate. This is
   the one that will surprise you.

Worked answer for #1:

<details>
<summary>URL shortener</summary>

```
ASSUMPTIONS
  100M writes/day, 10B reads/day  → 100:1 read:write
  URL record: short code (7B) + long URL (~100B) + metadata (~50B) ≈ 200 B

TRAFFIC
  writes: 100M / 100k       = 1,000 QPS   → peak 3,000
  reads:  10B  / 100k     = 100,000 QPS   → peak 300,000

STORAGE
  100M × 200 B = 20 GB/day
  × 365 × 5    = 36 TB over 5 years
  + indexes (×1.5) ≈ 55 TB

KEY GENERATION
  base62, 7 characters = 62⁷ ≈ 3.5 × 10¹²
  at 100M/day that lasts 3.5×10¹² / 10⁸ = 35,000 days ≈ 96 years  ✅

CACHE
  Zipf: ~20% of URLs get ~80% of traffic, and recent URLs dominate.
  Hot set: say 20M URLs × 200 B = 4 GB   → fits in ONE Redis instance.
  That cache absorbs ~80% of 300,000 QPS.

CONCLUSIONS
  · 300k peak reads is a CACHE + CDN problem, not a database problem
  · A 301 redirect is cached by the browser forever — huge saving, but you
    lose analytics and the ability to change the target. Use 302 if either
    matters. This trade-off is the actual design question.
  · 3,000 writes/sec fits one primary; 55 TB does not. Shard on the short
    code (hash) — reads are always by exact key, so single-shard.
  · Key generation: a counter + base62 is simplest and collision-free.
    Random requires collision checks. Pre-generated pools avoid both.
```

**Note the shape of the reasoning:** every architectural conclusion is traceable
to a number.
</details>

---

## Bring it to work

- **Estimate before designing.** It's five minutes and it routinely prevents a
  quarter of unnecessary work.
- **State assumptions explicitly.** The number is only as good as they are.
- **Compute the read:write ratio first.** It determines more of the architecture
  than anything else.
- **Sanity-check against something known.** Absurd results usually mean a factor
  of 1,000 slipped in.
- **Do the cost estimate.** "This design costs $8k/month; the alternative costs
  $1.5k" is a decision-quality argument.
- **Re-estimate at 10× and 100×** — that tells you what breaks next and when.
- **Round to one significant figure** and say so. Precision here is false
  confidence.

---

## Battle drill

<details>
<summary><b>1.</b> Someone says "we need Kafka, we're doing 5,000 events/sec." Respond.</summary>

5,000/sec is roughly 400 million events a day. That's real, but it's well within
a single Postgres table's write capacity (5k–20k/sec), and comfortably within a
single Pub/Sub topic or a single Redis Stream.

So the question isn't throughput. Ask what property they actually need:

- **Replay** — reprocessing history from an arbitrary offset. This is the genuine
  Kafka argument.
- **Ordering guarantees** per partition.
- **Multiple independent consumers** at different positions in the stream.
- **Long retention** as a source of truth.

If the answer is "we need to move events from A to B", Pub/Sub or Cloud Tasks is
simpler, managed, and cheaper (Capsule 18). Kafka is a serious operational
commitment — brokers, ZooKeeper/KRaft, partition rebalancing, consumer group
management.

The estimate doesn't decide it, but it removes throughput from the conversation,
which is where the argument usually hides.
</details>

<details>
<summary><b>2.</b> Estimate the storage for 5 years of application logs.</summary>

```
  1,000 QPS × 100,000 sec/day       = 100M requests/day
  ~3 log lines per request           = 300M lines/day
  ~500 bytes per structured JSON line
    → 150 GB/day
    → 55 TB/year
    → 275 TB over 5 years
```

At ~$0.20/GB/month for hot storage that's **$55,000/month** by year 5, which is
absurd for logs nobody reads.

What you actually do:
- **Tiered retention** — 7 days hot and searchable, 30 days warm, then compressed
  archive in object storage at $0.02/GB.
- **Sample** — keep 100% of errors, 1% of successes.
- **Exclude health checks**, which are often 50–90% of lines and 0% of value.
- **Don't log request bodies.**
- **Aggregate into metrics** where you only ever wanted a count anyway.

That typically cuts it by 10–50×. This calculation is why log retention policies
exist, and doing it once is how you get one written.
</details>

<details>
<summary><b>3.</b> How do you estimate cache size?</summary>

Estimate the **hot set**, not the total dataset.

```
  hot_set = active_items × item_size × safety_factor
```

Getting `active_items` right is the skill. Access is usually Zipf-distributed —
roughly 20% of items serve 80% of requests, and *recency* dominates in
user-facing systems (today's content, this week's active users).

Example: 100M products total, but 500k viewed daily, average 2 KB serialised →
1 GB hot set. Add 50% for overhead and growth → 1.5 GB. Redis key overhead is
~50–100 bytes/key, which matters when values are small.

**Then validate the assumption:** run with a modest cache and measure the hit
ratio. If it's 95%, shrink it. If it's 40%, either the hot set is bigger than you
thought or the access pattern is more uniform than Zipf.

And remember Capsule 14: **hit ratio is not load reduction.** Size the cache from
the load you need to remove, not from a hit-ratio target.
</details>

<details>
<summary><b>4.</b> Why does the read:write ratio matter more than absolute numbers?</summary>

Because reads and writes scale by completely different mechanisms.

**Reads scale easily and cheaply**: cache them, add read replicas, put a CDN in
front. Each is a well-understood, additive change.

**Writes scale hard**: one primary accepts them, and going beyond it means
sharding (application routing, no cross-shard transactions, resharding projects)
or a distributed database with different guarantees and much higher cost.

So a 100:1 system with 100k QPS total is *easy* — 1,000 writes/sec on one
primary, 99,000 reads absorbed by cache and CDN.

A 1:1 system with 20k QPS total is *much harder* — 10,000 writes/sec is at the
edge of one primary and the caching layer barely helps.

Absolute QPS tells you how much traffic there is. **The ratio tells you which
problem you have**, and therefore which architecture. It's the first thing to
compute and the first thing to say.
</details>

<details>
<summary><b>5.</b> Your estimate says 3 servers. The team runs 40. What questions do you ask?</summary>

The gap is information, so find out what your model is missing rather than
assuming they're wrong.

- **Is the workload CPU-bound?** My concurrency estimate assumed I/O-bound. A
  CPU-bound service needs far more instances for the same QPS.
- **Redundancy and zones.** 3 for capacity becomes 6 for HA becomes 9 across
  three zones. That's the intended cost of availability.
- **Are they separate services?** 40 instances of 8 microservices is 5 each,
  which is completely different from 40 of one thing.
- **Traffic shape.** My 3× peak factor may be wrong — a 20× spike at 8pm changes
  everything.
- **`min-instances` for cold starts** (Capsule 06).
- **Is it right-sized at all?** Sometimes the honest answer is that nobody has
  ever measured, and 40 is what someone set in 2021.

Then measure: actual CPU and memory utilisation per instance. If they're at 5%,
there's a real cost saving. If they're at 70%, my model was missing something and
I should find out what.
</details>

---

## Log it

```bash
cd ~/repos/pato/gravity-augmented && ./bin/scouter done B6
```
