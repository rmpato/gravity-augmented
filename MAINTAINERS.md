# Maintaining Gravity Augmented

**This file is for the two of us, not for learners.** Nothing here is part of
the course. If you arrived to learn GCP and system design, you want
[`README.md`](README.md) — close this one.

---

## How we work

As of **2026-08-06**, `main` is what a real learner is reading. That changes the
rules:

- **No direct pushes to `main`.** Every change goes through a PR, reviewed
  before merge.
- **`main` is always shippable.** Someone is mid-course against it. A broken
  capsule on `main` is a person stuck at 11pm.
- **Fixes to a capsule someone is actively on get priority** over new content.

### Branch naming

| Prefix | For |
|---|---|
| `capsule/` | new or substantially rewritten capsules |
| `fix/` | corrections to existing capsule content |
| `docs/` | README, docs/, this file |
| `web/` | the reader (`web/`, `bin/serve`) |
| `tooling/` | `bin/scouter`, `bin/doctor` |

### The bar for merging a capsule change

1. Every Go snippet compiles (`go build`, `go vet`, `go test`).
2. Every embedded calculation was **executed** and its documented output matches.
3. Any lab that can be run locally **was** run, not just written.
4. The Spanish mirror is updated, with code blocks byte-identical to English.
5. Internal links resolve, and no prose leaked into a code block.

Point 3 is the one that keeps finding real bugs. See
[`docs/maintainers/build-log.md`](docs/maintainers/build-log.md) — most entries
in it were invisible to reading and only appeared on execution.

Points 4 and 5, plus every registry and surface a capsule has to appear in, are
machine-checkable:

```bash
python3 scripts/maintainers/validate.py
```

It exits non-zero, so it can gate a PR. Points 1-3 are on you.

### Runbooks

Step-by-step procedures live in
[`docs/maintainers/runbooks.md`](docs/maintainers/runbooks.md):

| # | Runbook |
|---|---|
| 1 | Add a bonus capsule — the common case, a MINOR |
| 2 | Add a main-arc capsule — rare, and it has to rebalance to 9000 |
| 3 | Fix a capsule someone is mid-course on — the urgent path |
| 4 | Cut a release |
| 5 | Renumber or remove a capsule — MAJOR, and the one that reaches into a learner's machine |
| 6 | Update the reference repo, including rewriting its tags |

Plus a table of **what a capsule touches** — every file, what breaks if it is
wrong, and whether anything catches it.

---

## Versioning

Semver on a course needs a definition, or the numbers are decoration. Ours:

| Bump | Means | Because |
|---|---|---|
| **MAJOR** | capsules renumbered, removed, or IDs changed | breaks `.scouter/progress`, breaks every saved link and every `scouter done NN` in a learner's shell history |
| **MINOR** | new capsules, new bonus capsules, new tooling | additive; nobody's progress moves |
| **PATCH** | corrections, clarifications, translation fixes | the thing you were reading got more correct |

**The compatibility surface is capsule IDs**, not prose. Rewriting a capsule's
entire explanation is a PATCH if the ID and number stay put. Renumbering one
capsule is a MAJOR, because someone's `.scouter/progress` now says they finished
a different lesson than they did.

`v1.0.0` = the state first handed to a real learner.

### The reference repo

`gravity-chamber-reference` versions independently and uses `capsule-NN` tags
for per-capsule state. A `vX.Y.Z` tag there means "the state that pairs with
course vX.Y.Z" — the two namespaces don't collide.

---

## Capsule backlog

Ideas for future capsules, with enough context to argue about later. Add
entries; don't delete them — a **Declined** entry with a reason is worth more
than a gap where someone re-proposes the same thing in six months.

**Status:** `proposed` → `accepted` → `in progress` → `shipped`, or `declined` /
`deferred`.

**Ids here are not reservations.** A shipped capsule always takes the next free
id, and the proposals below shift up. **Shifted 2026-08-08**: B11 went to
*Turtle School — Go Basics & the Daily Toolchain*, so the five entries that
were B11–B15 are now B12–B16. Shipped ids never move (they live in a learner's
`.scouter/progress`); backlog ids are just labels until something is written.

**Tier 1** = would genuinely improve the course. **Tier 2** = real, but narrower
or harder to make hands-on.

---

### B12 · The Price of Power — cloud cost engineering
**Status:** proposed · **Tier:** 1 · **Raised:** 2026-08-06 · **Decision:** —

**Pitch.** Teach the skill that Capsule 26 makes you use once and never explains.

**Why.** The capstone's cost model is the section that makes a design feel real,
and CDN egress was its single biggest line ($640/mo of $2,238). But no capsule
teaches how to build one. It's also the most career-portable thing on this list:
being able to say *"that design costs 4× more, here's the arithmetic"* changes
how much you get listened to.

**Would cover.** Egress pricing and why it surprises everyone; cross-zone
traffic; committed use vs sustained use discounts; right-sizing from the
Capsule 09 RPS-per-vCPU numbers; labels for cost attribution; budget alerts;
the cost of a bad architecture choice expressed in dollars, not adjectives.

**Pairs with.** 26 (capstone cost model), 09 (capacity numbers), 16 (egress).

**Open questions.** Prices drift — how do we keep it from rotting? Possibly
teach the *method* and treat every number as illustrative, the way B6 does with
estimation.

---

### B13 · Saibamen — testing strategy
**Status:** proposed · **Tier:** 1 · **Raised:** 2026-08-06 · **Decision:** —

**Pitch.** Saibamen are grown to test fighters before the real one arrives.

**Why.** The thinnest genuine gap. The course preaches good practice, puts
`-race` in the Makefile from Capsule 00, writes a contract test in 22 and k6
scenarios in 09 — but never teaches *what to test where*. Only 2 of 38 capsules
mention integration testing at all.

**Would cover.** The pyramid and when it lies; fakes vs mocks vs stubs (the
`Store` interface from Capsule 06 is a perfect vehicle); testcontainers for
real-Postgres integration tests; why a flaky test is worse than no test; testing
the things this course actually builds — a cache decorator, an idempotent
consumer, a circuit breaker, a rate limiter.

**Pairs with.** 06 (the interface seam), 22 (contract tests), 19 (idempotency).

**Open questions.** Testcontainers adds a dependency. Is plain `docker compose`
plus a build tag enough, and more in keeping with the course's no-install bias?

---

### B14 · Porunga or Shenron — choosing a datastore
**Status:** proposed · **Tier:** 1 · **Raised:** 2026-08-06 · **Decision:** —

**Pitch.** Earth's dragon balls grant one wish; Namek's grant three, but you
have to speak Namekian. Different systems, different constraints, and choosing
wrong is expensive.

**Why.** The course teaches Postgres deeply and correctly, but never *why*
Postgres — the decision is entirely implicit. "Which database?" is the most
common intermediate GCP question there is, in interviews and in real work.

**Would cover.** Access patterns before technology; Cloud SQL vs Spanner vs
Firestore vs Bigtable vs BigQuery and the one question that separates each pair;
when "just use Postgres" is right (usually) and when it genuinely isn't;
the cost of being wrong, and how reversible each choice is.

**Pairs with.** 04 (GCP mental model), 10–13, 26.

**Open questions.** Hard to make hands-on without spending money. Might be a
concept capsule with a decision-tree exercise, closer to B6 than to B4.

---

### B15 · Sacred Water — CI/CD and promotion
**Status:** proposed · **Tier:** 1 · **Raised:** 2026-08-06 · **Decision:** —

**Pitch.** Korin makes you earn the water before you're allowed to ascend.

**Why.** A structural hole: Capsule 02 leaves you with an image, Capsule 24
assumes you're already doing canary deploys, and nothing connects them. How does
the artifact get built, tested, and promoted between environments?

**Would cover.** Build once, promote the same artifact (never rebuild per
environment); Artifact Registry; gating on the k6 thresholds Capsule 09 already
wrote; the `go mod verify` and `govulncheck` gates from B9; environment
promotion without rebuilding; why "it passed CI" and "it works in prod" differ.

**Pairs with.** 02, 09 (thresholds), 24 (deploy strategies), B9 (supply chain).

**Open questions.** GitHub Actions or Cloud Build? Actions is what the learner
will actually have; Cloud Build is the GCP-native answer. Possibly both, with
Actions as the worked example.

---

### B16 · Sensing Ki — profiling
**Status:** proposed · **Tier:** 1 · **Raised:** 2026-08-06 · **Decision:** —

**Pitch.** Capsule 25 is the Scouter Mk II — a device that tells you *that*
something is heavy. Profiling is sensing ki directly, without the device.

**Why.** Natural completion of 25. Observability tells you a request is slow;
profiling tells you which line. The frame is already established by the course's
own naming, which is rare and worth using.

**Would cover.** `net/http/pprof` behind an auth boundary; CPU and heap profiles;
reading a flame graph; finding the goroutine leak B5 warns about; `-benchmem`
and allocation reduction; Cloud Profiler for continuous profiling in production.

**Pairs with.** 25 (observability), B5 (goroutine leaks), 05 (CPU-bound work —
`/train` is a ready-made profiling target).

**Open questions.** None significant. This is the most straightforward of the
five to write and verify.

---

## Tier 2 — real, but narrower

| Idea | Why it's interesting | Why it's not tier 1 |
|---|---|---|
| **Multi-tenancy** | isolation, noisy neighbours, per-tenant quotas. Only 2 capsules mention it | matters enormously for B2B SaaS, not at all otherwise |
| **GCP networking** | VPC, subnets, firewall rules, Cloud NAT, Private Service Connect. Genuinely part of "intermediate GCP" | dry, and hard to make hands-on locally |
| **DR and backups** | RTO/RPO, and restore *drills* — the untested backup is the classic failure | Capsule 13 covers failover; this is planning discipline. Pairs with B8 |
| **gRPC and schema evolution** | B1 is REST-only; protobuf, versioning, backward compatibility | only worth it if the audience is heading somewhere polyglot |
| **IaC at scale** | Terraform modules, state, drift, plan review in CI | Capsule 03 is a deliberate intro; this is a big jump for a bonus |

---

## Declined

Kept with reasons, so they don't get re-proposed.

### Kubernetes / GKE
**Declined 2026-08-06.** Cloud Run is the right default for this course, and GKE
is its own multi-week subject. A half-capsule would be worse than nothing —
enough to make someone think they understand it. The useful fragment is *when
you actually need GKE* (rarer than people assume), which belongs as a page
inside Capsule 04, not a capsule.

### Frontend, ML, data engineering
**Declined 2026-08-06.** The course has one spine: a single service, grown until
it's a system. Every bonus capsule that works removes a specific blocker on that
spine (B4 SQL, B5 concurrency, B10 Go) or teaches a skill the spine assumes
(B6 estimation, B8 incident response). Anything that does neither dilutes it.

---

## Known gaps and debt

| Item | State |
|---|---|
| **The teaching is untested by a fresh reader** | Unresolvable by us. This is what the first learner is for. Every bug found so far was findable by execution; the ones that make people quit — an unstated assumption, a step that loses you — are invisible from the inside |
| **B3 and B5 never run as live labs** | Defensible: both are pure Go with no infrastructure, so their test suites *are* the lab |
| **Capsules 04 and 26 never run** | By design — no local stack; they're design capsules |
| **`scouter` progress wrote itself once** | Investigated, not reproduced. Every write path was traced and GETs proven pure. `bin/serve` now logs every write to the console, so a recurrence leaves a record. See build log |
| **Reference tags were stale, now rebuilt** | Fixed 2026-08-06 by history rewrite. Every tag from `capsule-01` on builds and tests clean |

---

## Conventions for this file

- **Add, don't delete.** A declined idea with a reason is institutional memory.
- **Date every status change**, so we can tell a stale opinion from a current one.
- **One heading per idea**, so a PR can touch exactly one entry.
- **Say what would go in it**, not just the title. An idea nobody can evaluate
  six months later is a title, not a proposal.
