# Capsule 22 · Fusion Dance — Splitting the Monolith

> *The Fusion Dance requires identical timing, identical posture and identical
> power levels. Get one finger wrong and you produce Gotenks-as-a-fat-idiot:
> weaker than either half, and stuck that way for thirty minutes. Goku and
> Vegeta are individually stronger than a botched fusion. That is a distributed
> monolith.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 9 | 85 min | Sagas 2–4 | Local |

---

## Why this capsule exists

"Should we use microservices?" is the most common architecture question and the
one most often answered by fashion.

The honest answer is that microservices solve an **organisational** problem
(many teams shipping independently) by accepting a large **technical** cost
(network failures, distributed transactions, operational overhead). If you don't
have the organisational problem, you've bought the cost for nothing.

This capsule is about drawing boundaries that are worth the price — and
recognising the failure mode where you get all the costs and none of the
benefits.

---

## The concept

### What microservices actually buy you

| Claim | Reality |
|---|---|
| "Independent deployment" | ✅ **The real benefit.** Teams ship without coordinating |
| "Independent scaling" | ✅ Genuine, but a modular monolith scales horizontally too |
| "Technology diversity" | ⚠️ Real, and usually a liability. Five languages means five toolchains |
| "Fault isolation" | ⚠️ Only with bulkheads and breakers (Capsule 17). Otherwise you have *more* failure modes |
| "Easier to understand" | ❌ Each service is smaller; the *system* is much harder |
| "Better performance" | ❌ You replaced function calls with network calls |

**The one that matters is independent deployment**, and it only matters when
multiple teams are contending on one deploy pipeline. With one team, you're
paying for a benefit you can't collect.

### The distributed monolith

The failure mode. Services that must be deployed together:

```
  🚩 Changing service A requires changing B and C in the same release
  🚩 Services share a database (or worse, share tables)
  🚩 A synchronous call chain 5 services deep
  🚩 Every request touches every service
  🚩 You can't test one service without running all of them
  🚩 A shared library that every service must upgrade in lockstep
```

You now have the network failures, the operational overhead, the distributed
debugging *and* the coupling. Strictly worse than the monolith you started with.

### Where to draw boundaries

**Domain-Driven Design, minus the ceremony.** A good boundary:

- **Owns its data.** No other service reads its tables. Ever. This is the
  single most important rule, and the one people break first.
- **Changes for one reason.** If two things always change together, they're one
  thing.
- **Matches a team.** Conway's Law is not advice; it's an observation. Your
  architecture will mirror your communication structure whether you like it or
  not, so choose boundaries that match how you're organised.
- **Has a clear contract** you'd be willing to publish externally.
- **Can fail alone.** If A being down means B is useless, they may be one
  service.

**Bad boundaries** to recognise immediately:

- **By technical layer** (`api-service`, `business-logic-service`,
  `data-service`). Every feature touches all three, so nothing deploys
  independently. This is the most common mistake.
- **By entity** (`user-service`, `order-service`, `product-service`) when the
  real workflows cut across them — you get chatty call graphs and distributed
  transactions everywhere.
- **Too small.** A service per endpoint means the network *is* your call stack.

### The modular monolith is the right default

```
  monolith/
    internal/
      readings/     ← package boundary, enforced by the compiler
      ranking/
      notification/
    cmd/server/main.go   ← one deployable
```

You get: clear boundaries, independent reasoning, no network calls, real
transactions, one deploy, one thing to debug, one thing to run.

**Extract a service only when a specific pressure justifies it:**

- A component needs to scale independently *by a large factor*
- A separate team needs an independent release cadence
- Different availability or compliance requirements
- A genuinely different technology need (GPU inference, a specific runtime)

> **Get the module boundaries right first.** A monolith with good internal
> boundaries can be split later in weeks. A monolith with bad boundaries can't
> be split at all — and neither can the microservices you'd have built from the
> same understanding.

### Synchronous or asynchronous between services?

| | Sync (REST/gRPC) | Async (events) |
|---|---|---|
| Caller needs the answer | ✅ | ❌ |
| Availability | multiplies: 3 × 99.9% ≈ 99.7% | isolated |
| Coupling | temporal — both must be up | only on the schema |
| Debugging | a trace | harder |

**The availability multiplication is the argument that wins.** A chain of five
99.9% services is 99.5% — from 43 minutes of downtime a month to 3.6 hours,
purely from the topology.

**Default to async** between services, and use sync only when the caller
genuinely needs the answer to proceed.

### REST vs gRPC internally

| | REST/JSON | gRPC |
|---|---|---|
| Contract | OpenAPI (optional, often stale) | `.proto`, generated, enforced |
| Payload | text, larger | binary, compact |
| Streaming | awkward (SSE/WS) | native, bidirectional |
| Browser | direct | needs grpc-web or a gateway |
| Debugging | `curl` | `grpcurl` |

**gRPC for internal service-to-service**, mainly because the generated client is
a compile-time contract — you cannot typo a field name. **REST for public
APIs**, because everything speaks it (see [B1](../bonus/B1-kame-house-rules-rest/README.md)).

---

## Lab

### Step 1 — draw the boundaries before writing any code

Your Scouter now does four distinguishable things:

| Capability | Data it owns | Changes when | Scale profile |
|---|---|---|---|
| **Readings** | `fighters`, `readings` | the recording API changes | write-heavy |
| **Ranking** | `fighter_ranks`, Redis sorted set | ranking rules change | read-heavy, 100× |
| **Notification** | `subscriptions`, `sent` | notification channels change | bursty |
| **Analytics** | `daily_fighter_stats` | reporting needs change | batch |

Write an ADR **before** touching code — this is the deliverable that matters
most in this capsule:

**`docs/adr/001-extract-ranking-service.md`**

```markdown
# ADR 001 — Extract ranking into its own service

## Status
Accepted · 2026-08-05

## Context
- /leaderboard is 90% of read traffic; /readings is 95% of write traffic.
- They scale by different factors: reads grew 10x last quarter, writes 1.4x.
- Ranking rules change weekly (product experiments); the recording API has
  not changed in three months.
- Ranking is already fed asynchronously via Pub/Sub (Capsule 18), so the
  coupling is already a schema, not a function call.

## Decision
Extract ranking as `cmd/ranker`, owning `fighter_ranks` and the Redis sorted
set. It consumes `power.recorded` and exposes a read-only HTTP API.
Scouter keeps `fighters` and `readings` and no longer serves /leaderboard.

## Consequences
+ Ranking scales independently (its own instance count and memory profile).
+ Ranking experiments deploy without touching the write path.
+ A ranking outage does not stop readings being recorded.
- Leaderboard data is now eventually consistent (~1s behind).
- One more service to deploy, monitor and page for.
- Cross-service debugging needs distributed tracing (Capsule 25).

## Alternatives considered
- **Keep it in the monolith** — simplest, and it's what we did for six months.
  Rejected because ranking deploys now block the write path weekly.
- **Extract notifications first** — lower value; it's already async and small.
- **Split by layer (api/logic/data)** — rejected: every feature would touch
  all three, so nothing would deploy independently.

## Reversal
If the operational cost outweighs the benefit, ranking folds back into the
monolith by importing internal/ranking and re-registering the route. The
package boundary is preserved specifically so this stays possible.
```

That last section is worth copying into your working life. **An ADR that names
how to undo the decision is far more useful than one that only justifies it.**

### Step 2 — enforce the boundary in the monolith first

Before extracting anything, make the boundary real in one process.

```
internal/
  scouter/        ← owns fighters, readings. Publishes events.
                    (the "readings" domain — keep the name you've used since
                     Capsule 01; renaming 21 capsules of imports buys nothing)
    store.go
    service.go
  ranking/        ← owns fighter_ranks. Consumes events.
    store.go
    service.go
  platform/       ← shared infrastructure, NO domain logic
    db.go
    events.go
```

The rule, and it must be enforced:

```go
// internal/ranking/service.go

// ✗ NEVER: reaching into another module's storage
// import "github.com/you/gravity-chamber/internal/readings"
// rows := readings.DB().Query("SELECT * FROM readings ...")

// ✅ Ranking consumes events and owns its own tables. It has no idea
// what readings' schema looks like, which is exactly why readings can
// change it freely.
func (s *Service) OnPowerRecorded(ctx context.Context, e events.PowerRecorded) error {
	return s.store.ApplyReading(ctx, e.Fighter, e.Power, e.RecordedAt)
}
```

Add a test that enforces it — this is worth more than any wiki page:

**`internal/architecture_test.go`**

```go
package internal_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestModuleBoundaries fails the build if one domain module imports another.
// Domain modules may import platform/ and events/, never each other.
//
// A boundary a linter enforces is worth ten a wiki describes.
func TestModuleBoundaries(t *testing.T) {
	domains := map[string]bool{"scouter": true, "ranking": true, "notification": true}

	checked := 0
	for domain := range domains {
		dir := filepath.Join(".", domain)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}
		checked++
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
				return err
			}
			f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			for _, imp := range f.Imports {
				p := strings.Trim(imp.Path.Value, `"`)
				for other := range domains {
					if other == domain {
						continue
					}
					if strings.Contains(p, "/internal/"+other) {
						t.Errorf("%s imports %s — domain modules must not depend on each other", path, other)
					}
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	// Without this the test passes VACUOUSLY when none of the directories
	// exist — a green check that proves nothing is worse than no check.
	if checked == 0 {
		t.Fatal("no domain modules found; this test was asserting nothing")
	}
}
```

```bash
go test ./internal/... -run TestModuleBoundaries -v
```

Try adding a forbidden import and watch the build fail. **That's a boundary.**

### Step 3 — extract, with a strangler fig

Never big-bang a split. Route traffic gradually.

```go
// cmd/scouter/main.go — the strangler fig pattern.
//
// The monolith keeps serving /leaderboard until the new service is proven,
// then proxies to it, then the route is deleted. At every point you can
// revert with an environment variable rather than a rollback.
	if url := os.Getenv("RANKING_SERVICE_URL"); url != "" {
		log.Info("delegating /leaderboard to the ranking service", "url", url)
		mux.Handle("GET /leaderboard", rankingProxy(url, log))
	} else {
		mux.HandleFunc("GET /leaderboard", s.handleLeaderboard)
	}
```

The proxy — note that it carries Capsule 17's lessons:

```go
func rankingProxy(target string, log *slog.Logger) http.Handler {
	client := &http.Client{Timeout: 2 * time.Second}
	breaker := scouter.NewBreaker(5, 10*time.Second)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body []byte
		err := breaker.Do(func() error {
			req, err := http.NewRequestWithContext(r.Context(), "GET",
				target+"/leaderboard?"+r.URL.RawQuery, nil)
			if err != nil {
				return err
			}
			// Propagate the correlation id. Without this, a cross-service
			// request is unfollowable (Capsule 25).
			req.Header.Set("X-Request-Id", r.Header.Get("X-Request-Id"))

			resp, err := client.Do(req)
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 500 {
				return fmt.Errorf("ranking returned %d", resp.StatusCode)
			}
			body, err = io.ReadAll(resp.Body)
			return err
		})
		if err != nil {
			// DEGRADE, don't fail: an empty leaderboard beats a 500.
			log.Warn("ranking unavailable, serving empty", "err", err)
			w.Header().Set("X-Degraded", "true")
			writeJSON(w, http.StatusOK, []any{})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
}
```

> ### ⏸ Natural stopping point
>
> Everything above stands on its own — commit it and come back. The steps below
> build on it but don't destabilise anything if you stop here. Two 45-minute
> sittings beat one 90-minute slog you don't finish.

### Step 4 — give the ranker an API

`cmd/ranker` currently only consumes. Add an HTTP server so it can serve reads:

```go
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /leaderboard", rankingHandler)

	go func() {
		srv := &http.Server{Addr: ":8081", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
		_ = srv.ListenAndServe()
	}()
```

Run both and watch the split work:

```bash
# terminal 1
DATABASE_URL="..." PUBSUB_PROJECT_ID=gravity-chamber SUBSCRIPTION_ID=ranker \
  go run ./cmd/ranker

# terminal 2 — monolith delegating
RANKING_SERVICE_URL=http://localhost:8081 DATABASE_URL="..." make run

# terminal 3
curl -s localhost:8080/leaderboard | jq
```

**Now break it, because that's the actual lesson:**

```bash
# kill the ranker (Ctrl-C in terminal 1)
curl -si localhost:8080/leaderboard | grep -E 'HTTP/|X-Degraded'
# HTTP/1.1 200 OK
# X-Degraded: true

curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}' | jq
# ✅ 201 — writes are completely unaffected
```

**Fault isolation, achieved on purpose.** Note that it came from the breaker and
the fallback, not from the split itself — splitting alone would have given you a
500.

### Step 5 — the availability arithmetic

```bash
python3 - <<'PY'
def uptime(n, per=0.999):
    a = per ** n
    print(f"{n} services in a SYNC chain, each {per*100}%:  {a*100:.3f}%  "
          f"= {(1-a)*365*24*60:.0f} min/year of downtime")
for n in (1, 3, 5, 10):
    uptime(n)
PY
```

```
1 services in a SYNC chain, each 99.9%:  99.900%  =  526 min/year of downtime
3 services in a SYNC chain, each 99.9%:  99.700%  = 1575 min/year of downtime
5 services in a SYNC chain, each 99.9%:  99.501%  = 2623 min/year of downtime
10 services in a SYNC chain, each 99.9%:  99.004%  = 5232 min/year of downtime
```

**Ten 99.9% services in a chain give you 99.0%** — ten times worse, purely from
topology. Nobody wrote a bug.

This is *the* argument for async communication between services, and for graceful
degradation when sync is unavoidable. Put this table in your ADR.

### Step 6 — a contract test

The thing that makes independent deployment safe:

```go
// internal/ranking/contract_test.go
//
// A CONTRACT TEST asserts the shape the ranking service promises to its
// consumers. Break the shape and this test fails in the ranking repo's CI —
// before the change reaches anyone who depends on it.
func TestLeaderboardContract(t *testing.T) {
	rec := httptest.NewRecorder()
	handler().ServeHTTP(rec, httptest.NewRequest("GET", "/leaderboard?limit=2", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("response is not a JSON array: %v", err)
	}
	if len(got) == 0 {
		t.Skip("no data")
	}
	// Consumers depend on these fields existing with these names.
	for _, field := range []string{"fighter", "power", "recorded_at"} {
		if _, ok := got[0][field]; !ok {
			t.Errorf("contract broken: field %q missing from the response", field)
		}
	}
}
```

For real cross-team work, formalise this with consumer-driven contracts (Pact) or
a shared `.proto` — but even this hand-rolled version catches the majority of
accidental breaks.

---

## In GCP

- **One Cloud Run service per microservice.** Each gets its own URL, scaling
  config, service account and revision history.
- **Service-to-service auth**: deploy internal services with
  `--no-allow-unauthenticated` and grant the caller's service account
  `roles/run.invoker`. The caller attaches an OIDC identity token. **No shared
  secrets, no API keys, and it's about ten lines** (see
  [B3](../bonus/B3-fortuneteller-baba-auth/README.md) and
  [B7](../bonus/B7-kamis-ledger-iam-service-accounts/README.md)).
- **`--ingress=internal`** makes a service reachable only from your VPC.
- **One database per service** is the ideal. In practice, one Cloud SQL instance
  with **one database (or at minimum one schema) per service, and separate
  users** is the pragmatic compromise: it preserves the "no cross-service table
  reads" rule at the permission level, which is where it actually holds.
- **Cloud Service Mesh** if you reach the scale where uniform mTLS and traffic
  policy justify it (Capsule 08).
- **Cloud Deploy** for coordinated multi-service rollouts.

---

## Bring it to work

- **Start with a modular monolith.** Extract on evidence, not on principle.
- **One rule above all others: a service owns its data.** Cross-service table
  access is the thing that makes a split unwindable.
- **Enforce boundaries with a test**, not a convention.
- **Prefer async between services.** Do the availability arithmetic out loud.
- **Every sync call needs a timeout, a breaker and a degraded fallback**
  (Capsule 17).
- **Write the ADR before the code**, and include how to reverse the decision.
- **Strangler fig, never big bang.** Route gradually behind a flag.
- **Contract tests in the provider's CI** — that's what makes independent
  deployment safe rather than merely possible.
- **If you can't deploy a service independently, it isn't one.**

---

## Battle drill

<details>
<summary><b>1.</b> A team of 5 with a 200k-line monolith wants to move to microservices. Advise them.</summary>

Ask what problem they're solving. If the answer is "deploys are scary" or "the
codebase is messy", microservices will make both worse — you'll have scary
distributed deploys and a messy codebase spread across repos.

Real triggers: multiple teams contending on one pipeline; one component needing
radically different scaling; a genuine compliance or technology boundary.

With 5 people, none of those usually apply. The advice: **modularise first.**
Draw domain boundaries inside the monolith, enforce them with tests, give each
module its own tables, communicate through events internally. That's most of the
benefit at a fraction of the cost — and it's the necessary prerequisite for
splitting later anyway.

Then extract **one** service where there's measurable pressure, live with the
operational reality for a quarter, and decide whether to continue with evidence.
</details>

<details>
<summary><b>2.</b> Two services need the same data. What are your options?</summary>

Ranked, best to worst:

1. **One owns it, the other asks** — a sync API call. Simple, but adds coupling
   and multiplies availability.
2. **One owns it, the other keeps a replica** built from events. Async,
   independent availability, eventually consistent. **Usually the right answer.**
3. **Reconsider the boundary.** If two services constantly need the same data,
   that data may belong to one service that owns both behaviours. The boundary
   is probably wrong.
4. **Shared read-only view** — a database view exposing a stable projection. A
   pragmatic transition state; it's still coupling.
5. **Shared tables, both writing** — ❌ never. Now neither can change the schema,
   there's no owner, and you have a distributed monolith with extra steps.

Whichever you pick, name the owner explicitly. Data with two owners has none.
</details>

<details>
<summary><b>3.</b> Explain the distributed monolith and how to detect one.</summary>

Services that must be deployed together — you've paid every cost of distribution
and collected none of the benefit.

**Detection signals, in rough order of how damning they are:**
- Releases are coordinated across services ("we ship A, B and C together")
- Services read each other's database tables
- A shared library that everything must upgrade in lockstep
- You cannot run one service's tests without booting the others
- A single user request traverses five services synchronously
- Every feature requires changing three repos

**Measure it:** count how many services change per feature. If it's consistently
more than one, your boundaries are wrong.

**Recovery:** identify the true domain boundaries (often fewer, bigger services);
break data coupling first — it's the hardest and everything else depends on it;
replace sync chains with events; and be genuinely willing to **merge services
back together**. Merging is a normal, healthy move, not an admission of failure.
</details>

<details>
<summary><b>4.</b> When is gRPC worth it over REST internally?</summary>

**Yes when:** you have several services and want compile-time-safe contracts —
the generated client makes a typo'd field a build error rather than a 3am
mystery. Also for high call volume (binary is meaningfully smaller and faster),
streaming, or polyglot services where a `.proto` is the shared source of truth.

**No when:** the consumer is a browser (needs grpc-web or a gateway); you have
two services and the tooling cost outweighs the benefit; your team has no
protobuf experience and there are more valuable things to learn this quarter; or
debuggability by `curl` is worth more to you than type safety.

The real argument for gRPC is the **contract**, not the performance. If you're
disciplined with OpenAPI and generate clients from it, you get most of the same
benefit. Most teams aren't, which is why gRPC wins in practice.
</details>

<details>
<summary><b>5.</b> How do you decide a service should be merged back in?</summary>

Signals it's not earning its keep:
- It's deployed together with another service every time anyway
- It has no independent scaling profile — the instance counts move in lockstep
- One team owns both
- Most of its endpoints are called by exactly one caller
- Its outages are always caused by, or always cause, its neighbour's
- Debugging routinely requires reading both services' logs at once

Merging is a normal engineering decision, and being willing to do it is a sign of
maturity rather than defeat. Amazon Prime Video's widely-discussed move from a
distributed serverless pipeline back to a monolith — with a 90% cost reduction —
is the well-documented case.

The move is straightforward *if* the module boundaries were preserved: import
the package, register the routes, delete the network hop. Which is exactly why
you keep the package boundary intact after extraction.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Boundary test passes but coupling exists | It only checks imports. Shared *database tables* are invisible to it — enforce those with separate DB users and permissions. |
| Proxy returns 502 | The ranking service isn't up, or the URL is wrong. Check the breaker state and the `X-Degraded` header. |
| Correlation ids lost across services | Every hop must forward `X-Request-Id`. One service that drops it breaks the chain from there on. |
| Two services deadlock calling each other | Circular sync dependency — a boundary error. Break it with an event. |
| Ranking data drifts from readings | Expected under eventual consistency. Add a periodic reconciliation job that replays from the outbox (Capsule 21). |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "refactor(arch): extract ranking behind a strangler-fig proxy

Capsule 22. ADR 001 records the decision and how to reverse it. Domain
modules enforced by an import test. /leaderboard delegates to the ranking
service behind a circuit breaker with a degraded fallback, so a ranking
outage returns an empty board rather than a 500. Contract test on the
ranking response shape."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 22
```

**Next:** [Capsule 23 · The Great Saiyaman — Backend for Frontend](../23-great-saiyaman-bff/README.md)
