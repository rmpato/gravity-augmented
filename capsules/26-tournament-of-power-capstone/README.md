# Capsule 26 · Tournament of Power — The Capstone

> *Everything, at once, with a time limit, in front of judges. No Senzu beans,
> no Dragon Balls, no second chances. The fighters who do well aren't the ones
> with the biggest single technique — they're the ones who can read the
> situation and pick the right move.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 10 | 2–3 hours (split it) | Everything · optional [B6 estimation](../bonus/B6-reading-power-levels-estimation/README.md) | Local |

---

## Why this capsule exists

You've learned twenty-six things. This is where they stop being twenty-six
things and become one skill: **looking at a problem and knowing which of them
applies.**

That skill is what a system design interview tests, and — more importantly —
it's what senior engineering *is*. Nobody is going to ask you to implement a
consistent hash ring. They're going to ask why the checkout page is slow, and
you'll need to know whether the answer is an index, a cache, a queue, or a
boundary that's in the wrong place.

There's no new material here. It's a design exercise, a cost model, a failure
analysis, and a rehearsal.

---

## The method

Use this structure every time. It's the same one interviewers score against, and
it's genuinely how good design conversations go.

### 1. Requirements (5 min) — never skip this

**Functional:** what must it do? Write 4–6 bullets. Explicitly list what you're
*not* building.

**Non-functional — the numbers that actually drive the design:**

| Question | Why it changes everything |
|---|---|
| How many users? DAU/MAU? | sets the scale of everything below |
| Read:write ratio? | 100:1 → caching and replicas. 1:1 → write path is the problem |
| Latency target, p99? | 50 ms vs 2 s are different architectures |
| Consistency requirement? | strong vs eventual is the biggest single fork |
| Availability target? | 99.9% vs 99.99% is single-region vs multi-region |
| Data retention? | 30 days vs forever changes the storage tier |
| Traffic shape? | steady vs 100× spike at 8pm changes autoscaling |

**Ask about consistency early.** It's the constraint that eliminates the most
options, and candidates who ask it late end up redesigning.

### 2. Estimate (5 min)

Back-of-the-envelope, out loud. See
[B6](../bonus/B6-reading-power-levels-estimation/README.md) for the numbers to
memorise.

```
  DAU × actions/day / 86,400          = average QPS
  average QPS × peak factor (3-10×)   = peak QPS
  QPS × payload size                  = bandwidth
  records/day × size × retention      = storage
  QPS × latency (Little's Law)        = concurrency → instance count
```

Round aggressively. `86,400 ≈ 100,000`. You're deciding between "one server" and
"a thousand servers", not between 40 and 45.

### 3. API and data model (10 min)

The endpoints, then the schema, then — **and this is the step people skip** —
the **access patterns**. The access patterns determine the indexes, which
determine the sharding key, which determines whether your design works at all.

### 4. High-level design (15 min)

Draw the boxes. Start with the **simplest thing that could work** — one service,
one database — and then add components *because you identified a bottleneck*,
narrating why.

> Starting with a diagram full of Kafka and sharded caches signals memorisation.
> Starting simple and evolving it under pressure signals engineering.

### 5. Deep dive (15 min)

The interviewer picks one area, or you pick the riskiest. Go deep: the actual
schema, the actual cache key, the actual failure mode.

### 6. Scale, fail, and cost (10 min)

- Where does it break at 10×? At 100×?
- What happens when each component dies?
- What does it cost per month, and per user?

Cost is the section almost nobody does, and it's the one that makes a design
credible to anyone who has to approve it.

---

## Part A — design the Scouter properly

You've built it. Now design it as if for a company, at a scale you haven't hit.

**The brief:**

> **PowerLevel.gg** — a platform where fighters record power readings, see
> global and per-race leaderboards, follow rivals and get notified when someone
> they follow sets a record.
>
> - 50 million registered users, 5 million DAU
> - Each active user records ~10 readings/day
> - Each active user views leaderboards ~30 times/day
> - Global, with users concentrated in NA (40%), EU (30%), APAC (30%)
> - Leaderboards may be up to 10 seconds stale
> - A user must **always** see their own reading immediately
> - Notifications within 1 minute
> - Readings retained forever; raw detail hot for 90 days
> - Traffic triples during scheduled tournaments

Write the answer in `docs/design/powerlevel-gg.md`. Do the estimation **before**
reading the worked solution below.

### Estimation worksheet

```bash
python3 - <<'PY'
DAU              = 5_000_000
WRITES_PER_USER  = 10
READS_PER_USER   = 30
PEAK_FACTOR      = 5          # tournaments
SEC_PER_DAY      = 86_400

w = DAU * WRITES_PER_USER / SEC_PER_DAY
r = DAU * READS_PER_USER  / SEC_PER_DAY
print(f"writes: {w:>10,.0f} QPS avg   {w*PEAK_FACTOR:>10,.0f} QPS peak")
print(f"reads:  {r:>10,.0f} QPS avg   {r*PEAK_FACTOR:>10,.0f} QPS peak")
print(f"read:write ratio = {r/w:.0f}:1")

ROW = 64                                   # bytes per reading
daily = DAU * WRITES_PER_USER * ROW
print(f"\nstorage: {daily/1e9:.1f} GB/day  {daily*365/1e12:.2f} TB/year")
print(f"         {daily*365*5/1e12:.1f} TB after 5 years")

# Little's Law -> instances
LAT = 0.020                                 # 20ms p50
concurrency = (r + w) * PEAK_FACTOR * LAT
print(f"\nconcurrent requests at peak: {concurrency:,.0f}")
print(f"at 80 concurrent/instance:   {concurrency/80:,.0f} instances")
PY
```

```
writes:        579 QPS avg        2,894 QPS peak
reads:       1,736 QPS avg        8,681 QPS peak
read:write ratio = 3:1

storage: 3.2 GB/day  1.17 TB/year
         5.8 TB after 5 years

concurrent requests at peak: 231
at 80 concurrent/instance:   3 instances
```

**Read those numbers before designing.** They are not what most people assume.

- **3,000 writes/sec peak** is comfortably within one well-tuned Postgres
  primary. **You do not need to shard.** Saying so out loud, with the number, is
  a strong signal.
- **9,000 reads/sec** is a caching problem, not a database problem.
- **1.2 TB/year** fits on one instance for years. Partition by month (Capsule 12)
  for retention, not for scale.
- **Three application instances** at peak. Run ten for redundancy and headroom,
  not because you need the capacity.

> The most common capstone failure is designing for a scale nobody asked for.
> The estimate is what protects you from that.

### The worked design

```
                            users (NA / EU / APAC)
                                     │
                      ┌──────────────▼──────────────┐
                      │  Cloud CDN + Cloud Armor    │  C16, C08
                      │  leaderboards: s-maxage=10  │
                      │  stale-while-revalidate=60  │
                      └──────────────┬──────────────┘
                                     │  (~85% of reads never get past here)
                      ┌──────────────▼──────────────┐
                      │  Global external L7 LB      │  C07
                      │  TLS, anycast, health checks│
                      └───────┬─────────────┬───────┘
                              │             │
                     ┌────────▼───┐   ┌─────▼──────┐
                     │  web BFF   │   │ mobile BFF │  C23
                     └────────┬───┘   └─────┬──────┘
                              └──────┬──────┘
                    ┌────────────────┼────────────────┐
           ┌────────▼──────┐ ┌───────▼──────┐ ┌───────▼──────┐
           │ readings-api  │ │ ranking-api  │ │ social-api   │  C22
           │ (writes)      │ │ (reads)      │ │ (follows)    │
           └───┬───────┬───┘ └───┬──────┬───┘ └──────┬───────┘
               │       │         │      │            │
     ┌─────────▼──┐ ┌──▼─────────▼──┐ ┌─▼────────────▼───┐
     │ Cloud SQL  │ │  Memorystore  │ │   Cloud SQL      │
     │ HA primary │ │  Redis        │ │   (social)       │
     │ + 2 read   │ │  · ZSET ranks │ └──────────────────┘
     │   replicas │ │  · cache      │
     │ partitioned│ └───────────────┘
     └─────┬──────┘         ▲
           │ outbox (C21)   │
     ┌─────▼──────────────┐ │
     │  relay → Pub/Sub   │ │
     └─────┬──────────────┘ │
           │                │
    ┌──────▼──────┐  ┌──────┴───────┐  ┌──────────────┐
    │ ranker      │  │ notifier     │  │ BigQuery     │  C20
    │ (updates    │  │ (fan-out to  │  │ (analytics,  │
    │  ZSET)      │  │  followers)  │  │  90d+ cold)  │
    └─────────────┘  └──────────────┘  └──────────────┘
```

**The reasoning, decision by decision — this is what you'd say out loud:**

| Decision | Why | Capsule |
|---|---|---|
| CDN in front of leaderboards | 10 s staleness is allowed, so ~85% of 9k reads/sec never reach us. Biggest single win, one header | 16 |
| Redis sorted set for ranks | `ZREVRANGE` is O(log n + m) and maintained on write. Recomputing a top-100 from 50M rows per read is not viable | 14, 20 |
| One Postgres primary, **not sharded** | 3k writes/sec fits comfortably. Sharding buys nothing and costs a quarter | 10, 12 |
| Monthly partitioning | For retention (`DROP` a partition) and index size, not for write scale | 12 |
| Read replicas for leaderboard queries | Reads dominate; staleness is acceptable there | 13 |
| **Read-your-writes pinning** on a user's own readings | The one hard consistency requirement in the brief | 13 |
| Transactional outbox | A recorded reading must never fail to notify. Dual-write is not acceptable here | 21 |
| Pub/Sub + idempotent consumers | Notification and ranking are async; duplicates are guaranteed | 18, 19 |
| Two BFFs | Mobile needs a small sparkline payload; web needs a full history | 23 |
| Separate `social` service | Follows have a different scale profile and a different team. **Not** split by layer | 22 |
| BigQuery for cold analytics | Never run aggregation on the OLTP store | 20 |

### Cost model

The section that makes it real:

```bash
python3 - <<'PY'
# Rough list prices, mid-2026, us-central1. One significant figure is the
# point — you are comparing designs, not writing an invoice.
items = [
  ("Cloud Run  (~10 instances avg, 1 vCPU / 512Mi)", 260),
  ("Cloud SQL HA  (4 vCPU / 16 GB, regional)",       580),
  ("Cloud SQL read replicas (2x)",                   440),
  ("Memorystore Redis Standard, 5 GB",               190),
  ("Global LB + Cloud Armor",                         45),
  ("Cloud CDN egress (~8 TB/mo)",                    640),
  ("Pub/Sub (~200 GB/mo)",                             8),
  ("BigQuery storage + queries",                      60),
  ("Cloud Logging (30 GB/mo over the free tier)",     15),
]
total = sum(v for _, v in items)
for name, v in items:
    print(f"{name:<48} ${v:>6,.0f}")
print(f"{'TOTAL':<48} ${total:>6,.0f} / month")
print(f"\nper DAU: ${total/5_000_000:.5f}/month  ${total*12/5_000_000:.4f}/year")
PY
```

```
Cloud Run  (~10 instances avg, 1 vCPU / 512Mi)   $   260
Cloud SQL HA  (4 vCPU / 16 GB, regional)         $   580
Cloud SQL read replicas (2x)                     $   440
Memorystore Redis Standard, 5 GB                 $   190
Global LB + Cloud Armor                          $    45
Cloud CDN egress (~8 TB/mo)                      $   640
Pub/Sub (~200 GB/mo)                             $     8
BigQuery storage + queries                       $    60
Cloud Logging (30 GB/mo over the free tier)      $    15
TOTAL                                            $ 2,238 / month

per DAU: $0.00045/month  $0.0054/year
```

Then answer the question a CFO would ask: **what's the biggest line, and what
would you do about it?**

(It's CDN egress. Options: better compression, smaller payloads from the BFF,
longer TTLs, or an egress commitment discount. Notice that three of those four
are *engineering* decisions, which is why cost belongs in a design review.)

### Failure analysis

For each component: what happens, what do users see, what do you do?

| Component fails | Impact | Mitigation | Capsule |
|---|---|---|---|
| One app instance | none | LB health checks eject it | 07 |
| All app instances in a zone | none | multi-zone, autoscaling | 06 |
| Redis | ranks recompute from Postgres; reads slow but work | circuit breaker + fall through | 14, 17 |
| Postgres primary | writes fail ~60 s | Cloud SQL HA failover; reads continue from replicas | 13 |
| Read replica | reads shift to primary | LB removes it; primary must have headroom | 13 |
| Pub/Sub | notifications delayed | events safe in the outbox; relay catches up | 21 |
| Ranker consumer | ranks go stale | backlog absorbs it; alert on oldest-unacked-age | 18 |
| CDN | **6.7×** load on origin (~1,300 → ~8,700 reads/sec) | **the honest risk** — origin must handle it, or shed load | 16, 17 |
| One region | 30–40% of users affected | accepted at 99.9%; multi-region would be needed for 99.99% | — |
| Bad deploy | limited to the canary % | traffic split + automated abort | 24 |

**Name the risk you're accepting.** "A CDN outage means 6.7× origin load, and we've
sized for 2×; we'd shed load and serve a degraded leaderboard" is a far better
answer than pretending the CDN never fails.

### Write it up

`docs/design/powerlevel-gg.md`, with these sections:

1. Requirements (functional, non-functional, explicit non-goals)
2. Estimation (with the arithmetic shown)
3. API + data model + access patterns
4. Architecture diagram
5. Key decisions, each with the alternative you rejected and why
6. Failure analysis
7. Cost model
8. What breaks at 10× and 100×, and what you'd change

---

## Part B — three more, timed

45 minutes each, out loud, whiteboard or paper. **The time limit is part of the
exercise** — it forces you to prioritise, which is the actual skill.

### B1 · A URL shortener

*"Design a URL shortener. 100M new URLs/day, 10B redirects/day."*

Watch for: the read:write ratio (100:1 — this is a caching and CDN problem);
key generation (counter+base62 vs hash vs pre-generated pool — and why a random
hash needs collision handling); why this is a **key-value** problem, not a
relational one; the 301-vs-302 trade-off (301 is cached by browsers forever, so
you lose analytics *and* the ability to change the target); custom aliases and
the race between two users claiming one.

### B2 · A rate limiter as a service

*"Design a distributed rate limiter used by 500 services."*

Watch for: algorithm choice and why (Capsule 17); where state lives (Redis vs
local vs hybrid); the accuracy-vs-latency trade-off (a synchronous Redis check
adds a round trip to every request); **what happens when the limiter is down**
(fail open or closed — and the answer differs for abuse protection vs billing);
hot keys; and the trick most people miss — *local* buckets refilled periodically
from a central authority, giving you approximate global limits at zero
per-request latency.

### B3 · A notification system

*"Design notifications: push, email, SMS. 100M users, 1B notifications/day."*

Watch for: fan-out on write vs read (Capsule 20); per-user preferences and quiet
hours; deduplication and rate limiting *per user* (nobody wants 400 pushes);
provider failure and fallback between channels; priority queues so a password
reset isn't stuck behind a marketing blast; the template/rendering pipeline;
and idempotency, because sending a notification twice is very visible.

---

## Part C — the rehearsal

The part people skip, and the part that actually matters in an interview.

1. **Pick one design. Explain it out loud for 20 minutes. Record yourself.**
2. Watch it back. You will notice: filler, jumping to solutions before
   requirements, and the places you're vague because you don't actually know.
3. **Answer these five, out loud:**
   - "Why not use Kafka here?"
   - "What if consistency had to be strong?"
   - "This costs $2,000/month. Halve it."
   - "It's 3am and p99 is 8 seconds. Walk me through the first ten minutes."
   - "What's the weakest part of this design?"

That last one is the most important. **A candidate who names their own design's
weakest point is far more convincing than one who defends everything.** Senior
engineers know where the bodies are buried in their own systems.

---

## The self-assessment

Score yourself honestly, 1–5. Anything under 3 gets a capsule re-read.

| | Capsule | Score |
|---|---|---|
| I can containerise a service and explain every Dockerfile line | 02 | |
| I can place any GCP service on the compute/data spectrum | 04 | |
| I can explain when vertical scaling is the right answer | 05 | |
| I can find where state hides in a service | 06 | |
| I can explain L4 vs L7 and why gRPC needs L7 | 07 | |
| I know what belongs in a gateway and what doesn't | 08 | |
| I can read a load test and find the knee | 09 | |
| I can diagnose pool exhaustion from symptoms | 10 | |
| I can read `EXPLAIN ANALYZE` and choose an index | 11 | |
| I can argue *against* sharding with numbers | 12 | |
| I can explain replication lag bugs and their four fixes | 13 | |
| I can design a cache that degrades instead of failing | 14 | |
| I can name and fix a stampede, penetration and a hot key | 15 | |
| I can write correct `Cache-Control` for any endpoint | 16 | |
| I can explain how one slow dependency takes down a service | 17 | |
| I can choose between Pub/Sub, Cloud Tasks and Kafka | 18 | |
| I can make any consumer idempotent | 19 | |
| I can choose batch vs stream from the latency requirement | 20 | |
| I can implement a transactional outbox and say why | 21 | |
| I can argue *against* microservices with the availability math | 22 | |
| I know when a BFF earns its hop | 23 | |
| I can do expand/migrate/contract without downtime | 24 | |
| I can define an SLO and an error budget policy | 25 | |
| I can estimate a system's scale and cost in 10 minutes | 26 | |

---

## What now

**The repo is finished. The training isn't.**

Concrete next moves, in order of value:

1. **Deploy `gravity-chamber` for real** and run it for a month. Set an SLO.
   Watch it break. Nothing in this repo teaches as much as owning something
   that's live.
2. **Write a postmortem** for something that broke — even a laptop-scale
   incident. The format is a skill.
3. **Pick one capsule and go three levels deeper.** Read the Postgres source for
   the query planner. Implement Raft. Read the Dynamo, Spanner and Bigtable
   papers.
4. **Teach one of these to a colleague.** You'll discover exactly which parts you
   only think you understand.
5. **Do the Filler Arc** if you haven't — it's how you get over 9000.

**The books worth the time:**
- *Designing Data-Intensive Applications*, Kleppmann — the best systems book
  there is. Every capsule in Saga 2 is a shallow version of one of its chapters.
- *Site Reliability Engineering* (Google, free online) — Capsule 25 in depth.
- *Release It!*, Nygard — Capsule 17 as a whole book.
- *Building Microservices*, Newman — Capsule 22 done properly.

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "docs(design): powerlevel.gg capstone design

Capsule 26. Full design with estimation, cost model and failure analysis.
Notable conclusion: at 3k writes/sec peak, sharding is unnecessary — the
estimate is what prevented over-engineering."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 26
./bin/scouter status
```

```
  POWER LEVEL  9000 / 9000
  ========================================  100%

  WHAT?! 9000?!
  The main arc is done. The Filler Arc takes you over.
```

**The Filler Arc:** [`capsules/bonus/`](../bonus/) — seven optional capsules, 150
each, and the only way past 9000.
