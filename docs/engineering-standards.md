# Engineering standards

The practices threaded through every capsule, collected in one place. These are
not "tutorial hygiene" — they are the things that make the difference between
someone who can make it work and someone teams want on-call with them.

Each one names the capsule where you first meet it in anger.

---

## 1. Configuration comes from the environment

*(Capsule 01)*

No hostnames, ports, credentials or feature flags in code. The same binary must
run on your laptop, in CI, and in production with nothing changed but the
environment.

```go
port := getenv("PORT", "8080")            // sane default
dsn  := os.Getenv("DATABASE_URL")         // no default; fail loudly if absent
```

**Fail fast at startup** if required config is missing. A service that boots
happily and then 500s on the first request that touches the database has turned
a config error into an outage.

## 2. Every service exposes `/healthz` and `/readyz`

*(Capsule 01, enforced from 07)*

They are not the same check and conflating them causes real outages:

- **liveness (`/healthz`)** — "is this process wedged?" Answer from memory only.
  Never check the database here. If your DB blips and liveness fails, the
  orchestrator restarts every replica simultaneously and you have converted a
  degradation into an outage.
- **readiness (`/readyz`)** — "should this replica receive traffic *right now*?"
  This one *does* check dependencies. Failing readiness pulls you out of the
  load balancer pool without killing you, so you can recover.

## 3. Structured logs, one line per event, no PII

*(Capsule 01, deepened in 23)*

JSON lines, not prose. Machines read logs far more often than humans do.

```go
slog.Info("reading recorded", "fighter_id", id, "power", p, "trace_id", tid)
```

Rules: no `fmt.Println`. No secrets, tokens, emails or full request bodies. Log
*decisions and outcomes*, not "entered function X". Always carry a correlation
ID (Capsule 23).

## 4. Timeouts and deadlines on every network call

*(Capsule 16)*

Any call that can block must have a deadline, and that deadline must be
*inherited* from the caller. Go's `context.Context` exists exactly for this.

The default in most HTTP clients is **no timeout at all**. A dependency that
gets slow — not down, just slow — will exhaust your connection pool, then your
goroutines, then your memory. Slow is worse than down.

## 5. Retries need a budget, jitter, and idempotency

*(Capsules 16, 18)*

Retrying is how a small failure becomes a big one. Three rules:

- **Exponential backoff with full jitter.** Synchronised retries are a
  self-inflicted DDoS.
- **A retry budget** — cap total retries as a fraction of total requests.
- **Only retry idempotent operations**, or make them idempotent with an
  idempotency key.

Never retry a 4xx. It will fail identically forever.

## 6. Design for at-least-once

*(Capsule 18)*

Exactly-once delivery does not exist across a network. Every queue, webhook and
retry path will hand you a duplicate eventually. Make the *handler* idempotent —
a unique constraint, an upsert, or a processed-message table — and stop worrying
about it.

## 7. Migrations are expand → migrate → contract

*(Capsule 22)*

You cannot deploy code and schema at the same instant, so never write a
migration that requires it.

1. **Expand** — add the new column/table, nullable. Old code is unaffected.
2. **Migrate** — deploy code that writes both and reads new-with-fallback.
   Backfill.
3. **Contract** — once nothing reads the old shape, drop it. A separate deploy,
   often days later.

Every migration must be runnable while the old version is still serving.

## 8. Deploy ≠ release

*(Capsule 22)*

Shipping a binary and exposing it to users are separate events. Traffic splits
and feature flags let you make them separate in practice, which is what makes
rollback take seconds instead of a rebuild.

**Always know your rollback command before you deploy.**

## 9. Measure percentiles, never averages

*(Capsule 08)*

An average latency of 100 ms with a p99 of 4 s means 1 in 100 users has a
terrible time — and heavy users hit p99 constantly. Track **p50 / p95 / p99**
and, for anything user-facing, watch p99.9.

Corollary: an SLO is a number with a *window* and a *budget*. "99.9% of requests
under 300 ms over 28 days" is an SLO. "It should be fast" is a wish.

## 10. Instrument the four things that matter

*(Capsule 23)*

**RED** for request-driven services: **R**ate, **E**rrors, **D**uration.
**USE** for resources: **U**tilisation, **S**aturation, **E**rrors.

Watch cardinality — a metric label containing a user ID will quietly cost more
than your compute. (Scouters explode when they read something too big.)

## 11. Infrastructure is code, and state is precious

*(Capsule 03)*

Anything clicked in a console is invisible and unrepeatable. Terraform it,
commit it, review it. Keep state in a remote bucket with versioning on, never in
git. `terraform plan` in CI on every PR; a plan with unexpected destroys is a
blocked PR.

## 12. Secrets never touch git

*(Capsules 03, 09)*

`.env` in `.gitignore` from commit one. Secret Manager or the platform's secret
store in the cloud. If a secret does get committed, rotating it is the fix —
rewriting history is not, because it has already been cloned.

## 13. Small commits with a story

*(every capsule)*

Use conventional-commit prefixes; they make history greppable and changelogs
free:

```
feat(scouter): add power reading endpoint
fix(cache): prevent stampede with singleflight
perf(db): add composite index on (fighter_id, recorded_at)
refactor(api): extract handler from main
docs(capsule-11): note the resharding trade-off
chore(deps): bump go to 1.23
```

Each capsule should be at least one commit in `gravity-chamber`. The history is
your evidence that you understood this in a specific order.

## 14. Write down the decision, not just the code

*(Capsule 21, used in 24)*

For anything with a real trade-off, drop an ADR in `docs/adr/NNN-title.md`:

```markdown
# ADR 004 — Shard readings by fighter_id
## Status: accepted (2026-03-02)
## Context
Single Postgres write path saturates at ~4k writes/s; projected 12k.
## Decision
Hash-shard on fighter_id across 4 logical shards, routed in the app layer.
## Consequences
+ Writes scale linearly. + Per-fighter queries stay single-shard.
- Cross-fighter leaderboards need scatter-gather. - Resharding is a project.
## Alternatives considered
Range sharding (rejected: hotspots on recent IDs). Spanner (rejected: cost).
```

Six months later, this is the difference between a team that can change the
design and a team that is afraid of it.

## 15. Delete what you created

*(every ☁️ section)*

Teardown is part of the work, not an afterthought. In this repo it protects your
wallet. At work it protects your budget, your attack surface, and your
colleagues' ability to reason about what's running.

---

## The one-page version

> Config from env · fail fast · liveness ≠ readiness · structured logs ·
> deadlines everywhere · jittered retries on idempotent ops only ·
> assume duplicates · expand/migrate/contract · deploy ≠ release ·
> percentiles not averages · RED + USE · IaC with remote state ·
> no secrets in git · small commits · ADRs for trade-offs · always tear down.
