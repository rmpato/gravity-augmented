# The Saga Map

27 capsules in the main arc, plus 10 optional. In order. Later ones deliberately
break earlier ones.

Legend — **Local**: runs entirely on your machine. **☁️**: has an optional,
free-tier-eligible section on real GCP. **Concept**: taught with real commands
and Terraform, but not run (it would cost money to leave up).

---

## Saga 0 · Kame House — Foundations
*Get a service running, containerized and reproducible, and understand what GCP
actually is before touching it.*

| # | Capsule | You learn | Mode |
|---|---|---|---|
| 00 | **Kame House** — Setup, Tools & Your Own Repo | Toolchain, `gravity-chamber` scaffold, commit conventions | Local |
| 01 | **Scouter** — Your First Service | Go HTTP service, 12-factor config, health checks, structured logs, graceful shutdown | Local |
| 02 | **Capsule #9** — Containers | Multi-stage Dockerfile, distroless, image size, lazydocker, layer caching | Local |
| 03 | **Bulma's Blueprints** — Reproducible Environments & IaC | docker compose, Makefile, Terraform fundamentals, state, `plan` vs `apply` | Local |
| 04 | **Kami's Lookout** — The GCP Mental Model | Projects/orgs/IAM, regions & zones, the compute spectrum, gcloud, billing safety | Local + ☁️ |

## Saga 1 · Saiyan Saga — Scaling & the Edge
*Make one machine faster, then stop and make many machines instead — then put
something sensible in front of them.*

| # | Capsule | You learn | Mode |
|---|---|---|---|
| 05 | **Kaio-ken** — Vertical Scaling and Its Price | CPU/memory limits, the cost curve, Amdahl's law, when bigger is genuinely right | Local |
| 06 | **Multi-Form** — Horizontal Scaling & Statelessness | Replicas, where state hides, sticky sessions, autoscaling signals, Cloud Run concurrency | Local + ☁️ |
| 07 | **Korin's Tower** — Load Balancing | L4 vs L7, algorithms, health checks, connection draining, anycast, GCLB anatomy | Local + Concept |
| 08 | **King Yemma's Desk** — Proxies, Gateways & the Edge | Forward vs reverse proxy, sidecars, API gateway responsibilities, TLS termination, auth at the edge, service mesh, Apigee/API Gateway/GCLB URL maps | Local + Concept |
| 09 | **Hyperbolic Time Chamber** — Load Testing & Capacity | k6, percentiles, Little's Law, closed vs open models, finding the knee | Local |

## Saga 2 · Namek Saga — Data
*Where the hard problems actually live.*

| # | Capsule | You learn | Mode |
|---|---|---|---|
| 10 | **The Grand Elder's Archive** — Relational Data | Postgres, schema design, transactions, isolation levels, connection pooling, N+1 | Local + Concept |
| 11 | **Dragon Radar** — Indexes & Query Plans | B-trees, composite index order, `EXPLAIN ANALYZE`, keyset pagination, covering indexes | Local |
| 12 | **Seven Dragon Balls** — Sharding & Partitioning | Vertical vs horizontal partitioning, hash vs range, hotspots, scatter-gather, resharding, Bigtable/Spanner key design | Local |
| 13 | **Namekian Fusion** — Replication & Consistency | Leader/follower, replication lag, read-your-writes, quorums, CAP/PACELC, Spanner & TrueTime | Local |

## Saga 3 · Frieza Saga — Latency
*Getting fast, and staying fast when things go wrong.*

| # | Capsule | You learn | Mode |
|---|---|---|---|
| 14 | **Senzu Bean** — Caching Fundamentals | Cache-aside vs write-through vs write-behind, TTLs, eviction, hit ratio vs load reduction, Redis/Memorystore | Local + Concept |
| 15 | **Ginyu Force Tactics** — When Caches Betray You | Stampede, thundering herd, singleflight, negative caching, invalidation, hot keys, consistent hashing | Local |
| 16 | **Instant Transmission** — CDN & The Edge | Cache-Control, ETag, immutable assets, cache keys, purging, Cloud CDN & Armor, latency budgets | Local + Concept |
| 17 | **Ki Suppression** — Rate Limiting, Timeouts & Backpressure | Token bucket, deadline propagation, jittered retries, circuit breakers, bulkheads, load shedding | Local |

## Saga 4 · Cell Saga — Async
*Stop making everything a synchronous request.*

| # | Capsule | You learn | Mode |
|---|---|---|---|
| 18 | **King Kai's Telepathy** — Pub/Sub | Topics, subscriptions, push vs pull, ack deadlines, the emulator, decoupling | Local + ☁️ |
| 19 | **Cell's Absorption** — Delivery Semantics & Idempotency | At-least-once, dedup strategies, ordering keys, DLQs, poison messages, backlog as a signal | Local |
| 20 | **Spirit Bomb** — Fan-in, Fan-out & Batch | Aggregation, windowing, batch vs stream, BigQuery, Dataflow, when *not* to stream | Local + ☁️ |
| 21 | **Trunks' Time Machine** — Event-Driven Architecture | Transactional outbox, CDC, event sourcing lite, replay, schema evolution, choreography vs orchestration | Local |

## Saga 5 · Buu Saga — Operating It
*Making it something a team can run.*

| # | Capsule | You learn | Mode |
|---|---|---|---|
| 22 | **Fusion Dance** — Splitting the Monolith | Service boundaries, DDD-lite, the distributed monolith, contracts, gRPC vs REST, the modular monolith default | Local |
| 23 | **The Great Saiyaman** — Backend for Frontend | BFF pattern, chatty clients, aggregation at the edge, per-audience APIs, GraphQL vs BFF, when a BFF becomes a monolith again | Local |
| 24 | **Ginyu's Body Change** — Safe Deployments | Blue/green, canary, Cloud Run revisions & traffic splitting, expand/migrate/contract, feature flags, rollback | Local + ☁️ |
| 25 | **Scouter Mk. II** — Observability & SLOs | RED/USE, OpenTelemetry traces, cardinality, SLIs/SLOs/error budgets, alerting on symptoms, Cloud Monitoring | Local + ☁️ |
| 26 | **Tournament of Power** — The Capstone | Full design under constraints, capacity + cost model, failure analysis, ADRs, defending it out loud | Local |

## Filler Arc · optional bonus
*The fundamentals the main arc leans on. Not required viewing — but the filler
episodes where somebody actually trains are worth it. 150 power each, and the
only way past 9000.*

| # | Capsule | You learn | Best before |
|---|---|---|---|
| B1 | **Kame House Rules** — REST API Design Essentials | Resources vs actions, method semantics, status codes people get wrong, RFC 9457 errors, pagination, versioning, idempotency keys | 01 |
| B2 | **Snake Way** — HTTP & Networking Essentials | Latency numbers, TCP slow start & the 14 KB rule, TLS 1.3, HTTP/1.1 vs 2 vs 3, connection pooling, DNS TTLs | 07 |
| B3 | **Fortuneteller Baba** — Identity, Auth & JWT | authn vs authz, sessions vs tokens, JWT's five checks, `alg:none` and algorithm confusion, OAuth2 vs OIDC, PKCE, RBAC/ABAC/ReBAC | 08 |
| B4 | **Ancient Namekian** — SQL Essentials | Joins and the LEFT JOIN/WHERE trap, NULL semantics, `NOT EXISTS`, window functions, CTEs, upserts, `SKIP LOCKED`, JSONB | 10 |
| B5 | **Afterimage Technique** — Concurrency in Go | Goroutines and leaks, channels, `context`, mutex vs channel, worker pools, `errgroup`, the race detector | 17 |
| B6 | **Reading Power Levels** — Back-of-the-Envelope Estimation | The numbers to memorise, the formulas, three worked examples, and how estimation prevents over-engineering | 26 |
| B7 | **Kami's Ledger** — GCP IAM, Service Accounts & Workload Identity | The IAM model, service accounts as principal *and* resource, attached SAs, Workload Identity Federation, impersonation, least privilege, audit logs | 04 |
| B8 | **Namek's Five Minutes** — Incident Response & Postmortems | Mitigate before diagnose, severity levels, incident command roles, the first five minutes, status updates with no ETA, blameless postmortems, contributing factors over root cause, sustainable on-call | 25 |
| B9 | **Babidi's Spell** — Security Beyond Auth | SQL injection and why escaping loses, allowlists for identifiers, SSRF and the cloud metadata service, blocking at dial to defeat DNS rebinding, secret hygiene and rotation, a non-loggable Secret type, govulncheck and reachability | 23 |
| B10 | **Instant Kamehameha** — Go for People Who Already Program | Implicit interfaces, errors as values, embedding vs inheritance, zero values, slices and their shared backing array, goroutines, `defer`, capitalisation-as-visibility, `go.mod` vs Maven — with a Java column you can ignore | 01 |

---

## What you'll have built by the end

Starting from a single Go binary with a map in memory, `gravity-chamber` grows into:

```
     browser / mobile / partner API
                  │
          ┌───────▼────────┐
          │   Cloud CDN    │  static + cacheable GETs            (C16)
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │ Load Balancer  │  L7, health checks, draining        (C07)
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │  API Gateway   │  TLS, authn, quotas, routing        (C08)
          └───┬────────┬───┘
              │        │
      ┌───────▼──┐  ┌──▼────────┐
      │ web BFF  │  │mobile BFF │  per-audience aggregation      (C23)
      └───────┬──┘  └──┬────────┘
              └────┬───┘
                   │  (internal, gRPC)
     ┌─────────────▼──────────────┐
     │  scouter-api  ×N           │  stateless, autoscaled       (C06)
     │  timeouts, limits, breaker │                              (C17)
     └──┬──────────┬───────────┬──┘
        │          │           │
  ┌─────▼───┐ ┌────▼─────┐ ┌───▼──────────┐
  │  Redis  │ │ Postgres │ │   Pub/Sub    │            (C14 / C10 / C18)
  │  cache  │ │ +replicas│ │   topics     │
  └─────────┘ │ sharded  │ └───┬──────────┘
              └──────────┘     │
                        ┌──────▼────────┐
                        │ ranker worker │                        (C20)
                        │ notifier      │                        (C22)
                        └───────────────┘
                               │
        ┌──────────────────────▼─────────────────┐
        │ traces · metrics · logs · SLOs         │                (C25)
        └────────────────────────────────────────┘
```

Every box arrives because a specific capsule proved you needed it — not because
a diagram said so. That's the point.
