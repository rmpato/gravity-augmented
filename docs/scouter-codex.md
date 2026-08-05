# The Scouter Codex

Every codename in this repo maps to something real. If a name ever gets in the
way, look it up here — the real term is always the one you use at work.

## Structure

| Codename | Real thing |
|---|---|
| **Capsule** | A lesson. Self-contained, 30–60 min. Hoi-Poi Capsules hold an entire house in your pocket; each capsule here holds one whole concept. |
| **Saga** | A group of 4–5 capsules that share a theme. |
| **Power level** | Progress score. 375 per capsule, 9000 total. |
| **Scouter** | The progress CLI — and, from Capsule 23, your real observability stack. Both read power levels. |
| **Gravity Chamber** | *Your* repo. Where you actually build. The training load goes up each capsule. |
| **Senzu** | The troubleshooting section of a capsule. It gets you back up when a lab breaks. |
| **Battle drill** | Interview-style questions at the end of a capsule. |

## Scaling & compute

| Codename | Real thing |
|---|---|
| **Kaio-ken ×N** | Vertical scaling. More power from the same body, at increasing cost and risk of self-inflicted damage. |
| **Multi-Form technique** | Horizontal scaling. Tien splits into four; each copy has a *fraction* of the original power — which is exactly the trade-off. |
| **Saiyan pod / attack ball** | A container. Standard-sized, disposable, carries one fighter anywhere. |
| **Capsule #9** | A container image — the thing you throw on the ground to get a running instance. |
| **Korin's Tower** | A load balancer. Everything climbs through it before reaching the top. |
| **King Yemma's Desk** | An API gateway / reverse proxy. Every soul passes one desk: identity checked, judged against policy, routed to the correct destination. Nothing reaches the back end without going through it. |
| **Snake Way** | The slow path. A million kilometres of latency between the gateway and where you actually wanted to be. |
| **Hyperbolic Time Chamber** | Load testing. A year of traffic compressed into a day, in an environment you can leave. |
| **Nimbus** | Ephemeral compute. Appears instantly, carries you, disappears. Scale-to-zero. |

## Data

| Codename | Real thing |
|---|---|
| **The Grand Elder's Archive** | The primary relational database. One old Namekian holding all the records. |
| **Dragon Radar** | An index. Without it you search the whole planet; with it you go straight to the ball. |
| **The Seven Dragon Balls** | Sharding. One dataset deliberately split into pieces across the world, useless individually, complete together. |
| **Namekian Fusion** | Replication and consistency. Two entities, one truth — and the hard question of who wins on conflict. |
| **Porunga vs Shenron** | Two databases with different guarantees for the same job (three wishes vs one, different constraints). Pick per workload. |
| **Guru unlocking potential** | Capacity that already existed but wasn't reachable until something was tuned. |

## Latency

| Codename | Real thing |
|---|---|
| **Senzu Bean** | A cache. Instant recovery, in limited supply, and dangerous to depend on. |
| **Ginyu Force tactics** | Cache failure modes — stampedes, thundering herds, and the pose-striking delay that ruins your latency budget. |
| **Instant Transmission** | CDN / edge caching. Zero-distance delivery — but only to a place you've already been (a warm POP). |
| **Ki suppression** | Rate limiting and throttling. Deliberately emitting less than you can. |
| **Ki sensing** | Health checks and service discovery without a central registry. |

## Async

| Codename | Real thing |
|---|---|
| **King Kai's telepathy** | Pub/Sub. One sender, many minds, no direct connection between them. |
| **Cell's absorption** | Consumption semantics — at-least-once delivery, duplicates, and why idempotency matters. |
| **Spirit Bomb** | Fan-in aggregation. Thousands of tiny contributions batched into one result. |
| **Trunks' time machine** | Event sourcing and replay. The log is the truth; replaying it creates a new timeline. |
| **Dead zone** | A dead-letter queue. Where messages that can't be handled go to be dealt with later. |

## Services & operations

| Codename | Real thing |
|---|---|
| **Fusion Dance** | Service composition. Get the steps slightly wrong and you produce something worse than either half — the distributed monolith. |
| **Potara vs Fusion Dance** | Permanent coupling (a shared library / shared DB) vs a time-boxed, reversible integration (an API). |
| **The Great Saiyaman** | A Backend for Frontend. Gohan is the same fighter, but he puts on a completely different presentation for the audience in Satan City than the one he uses at the Cell Games. Same domain underneath, one façade per audience. |
| **Ginyu's Body Change** | Blue/green and canary deploys. Same soul, different body, traffic switched over. |
| **Scouter Mk. II** | Observability: metrics, logs, traces, SLOs. Scouters explode when they read something too big — a lesson about cardinality. |
| **Dende** | Health checks and self-healing. |
| **Kami's Lookout** | The control plane. Above the system, watching it, not serving traffic. |
| **Tournament of Power** | The capstone. Everything you have, under a time limit, judged. |

## Real-world → codename (reverse lookup)

autoscaling → Kaio-ken / Multi-Form · CDN → Instant Transmission ·
cache → Senzu · circuit breaker → Ki suppression · DLQ → Dead Zone ·
idempotency → Cell's absorption · index → Dragon Radar · load balancer → Korin's Tower ·
load test → Hyperbolic Time Chamber · observability → Scouter Mk. II ·
Pub/Sub → King Kai · replication → Namekian Fusion · sharding → Dragon Balls ·
service boundary → Fusion Dance · traffic split → Body Change ·
API gateway / reverse proxy → King Yemma's Desk · BFF → The Great Saiyaman
