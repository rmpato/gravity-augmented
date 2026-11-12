# Capsule 23 · The Great Saiyaman — Backend for Frontend

> *Gohan is the same fighter at the Cell Games and in Satan City. But in Satan
> City he puts on a helmet, a cape and a ridiculous pose routine, because that
> audience needs a completely different presentation. Same power underneath, one
> façade per audience. He does not ask the citizens of Satan City to understand
> Saiyan biology.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 8 | 85 min | Capsules 08, 22 | Local |

---

## Why this capsule exists

You now have several services. A mobile app needs data from three of them to
render one screen. It has three options, and two of them are bad:

1. **Call all three itself** — three round trips on a 4G connection, the client
   knows your entire topology, and every backend refactor breaks the app.
2. **Make one service aggregate for it** — that service now serves two masters
   and slowly becomes a monolith again.
3. **A BFF** — a thin service that exists *for that client*, owned by the team
   that owns that client.

The BFF is one of the few patterns that is almost always right once you have
more than one kind of client, and it's frequently missing from system design
answers where it belongs.

---

## The concept

### The problem it solves

```
  WITHOUT A BFF                        WITH A BFF

  📱 ──┬──► readings                   📱 ──► mobile-bff ──┬──► readings
       ├──► ranking                                        ├──► ranking
       └──► profiles                                       └──► profiles
                                       🖥 ──► web-bff ─────┬──► readings
  3 round trips over mobile network                        ├──► ranking
  client knows the topology                                └──► profiles
  over-fetching (it needs 4 fields
    of a 60-field response)            1 round trip, exactly the fields needed
```

**Three distinct wins:**

- **Latency.** One request instead of N. Over a mobile network at 100 ms RTT,
  collapsing 4 sequential calls saves ~300 ms — more than any backend
  optimisation you're going to make.
- **Payload shape.** Return exactly what the screen renders. A mobile list
  needs `name`, `power`, `rank`; the full objects might be 40× larger.
- **Decoupling.** Backend services can refactor freely; the BFF absorbs the
  change. The client contract is stable.

### One BFF per *client type*, not per client

```
  ✅ web-bff, mobile-bff, partner-api-bff, tv-bff
  ❌ ios-bff, android-bff, ipad-bff      (same needs → one BFF)
  ❌ one-bff-for-everything              (that's just a gateway again)
```

The signal for a new BFF is a **genuinely different consumption pattern**, not a
different platform. iOS and Android usually render the same screens; a
smart-TV app and a partner integration don't.

**Ownership is the point.** A BFF is owned by the *frontend* team, in their
repo, deployed on their cadence. If a backend team owns it, you've just built a
gateway with extra steps, and every screen change becomes a cross-team ticket —
the exact problem the pattern exists to remove.

### BFF vs API gateway

They coexist, and confusing them is the most common mistake:

| | Gateway (Capsule 08) | BFF (this one) |
|---|---|---|
| Scope | all traffic | one client type |
| Concerns | authn, rate limiting, TLS, routing | aggregation, shaping, client logic |
| Owned by | platform team | the frontend team |
| Logic | none — it inspects and rejects | yes — it composes and transforms |
| Count | one | one per client type |

Typical stack: `client → gateway (auth, quotas) → BFF (shape) → services`.

### Where it goes wrong

- **The BFF grows business logic.** Rule: a BFF **orchestrates and transforms**;
  it never owns domain rules or data. If it validates a business invariant, that
  invariant now lives in two places.
- **It becomes a shared monolith** because "web and mobile are similar enough".
  They diverge; the BFF accumulates flags; nobody dares change it.
- **It becomes another network hop with no value** — if it only proxies, delete
  it.
- **Fan-out amplification** — one client request becoming 12 backend calls. You
  moved the chattiness, you didn't remove it.
- **It's a new SPOF for that client.** It needs the same timeouts, breakers and
  degradation as anything else (Capsule 17).

### GraphQL as an alternative

GraphQL lets clients ask for exactly the fields they want, which is the same
problem the BFF solves — one schema instead of N BFFs.

**For:** no BFF per client; clients evolve without backend changes;
introspection and tooling are genuinely good.

**Against:** complexity (a resolver layer, an N+1 problem that needs DataLoader,
query-depth and complexity limits to prevent abuse); caching is much harder
because every query is a POST with a unique body (goodbye Capsule 16); and
authorization must be enforced per field, which is easy to get subtly wrong.

**Rule of thumb:** a few clients with stable, known needs → BFFs. Many clients
with unpredictable needs, or a public API where consumers you don't control need
flexibility → GraphQL. And GraphQL doesn't remove the need to aggregate — it
just moves it into resolvers.

### Parallel fan-out with partial failure

The critical implementation detail. A BFF calling four services **sequentially**
is slower than the client doing it. Call them in parallel, and decide per
dependency whether its failure is fatal:

```
  sequential:  120ms + 80ms + 200ms + 50ms  = 450ms
  parallel:    max(120, 80, 200, 50)        = 200ms
```

And **degrade rather than fail**: if the "recommendations" service is down, the
screen renders without recommendations. If the "profile" service is down, there
is no screen. Encode that difference explicitly.

---

## Lab

### Step 1 — the aggregation contract

The mobile "fighter detail" screen needs: name, current power, rank, recent
history, whether the user follows them. That's three services today.

**`internal/bff/mobile.go`**

```go
// Package bff assembles per-client views. It orchestrates and transforms.
// It owns no data and no business rules — if you find yourself validating a
// domain invariant here, it belongs in the owning service.
package bff

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// FighterScreen is shaped for ONE SCREEN, not for a domain model.
// Field names match what the mobile view renders; nothing is included that
// the screen does not draw.
type FighterScreen struct {
	Name      string        `json:"name"`
	Power     int64         `json:"power"`
	PowerText string        `json:"power_text"`  // "9,001" — formatted server-side
	Rank      int           `json:"rank"`
	RankLabel string        `json:"rank_label"`  // "#3 of 2,041"
	Sparkline []int64       `json:"sparkline"`   // 12 points, not 5000 readings
	Following bool          `json:"following"`
	Degraded  []string      `json:"degraded,omitempty"` // what we couldn't load
}

type Client struct {
	http *http.Client
	log  *slog.Logger

	ReadingsURL string
	RankingURL  string
	SocialURL   string
}

func New(log *slog.Logger, readings, ranking, social string) *Client {
	return &Client{
		// One shared client with a bounded pool. Never http.DefaultClient:
		// it has NO timeout (Capsule 17).
		http: &http.Client{
			Timeout: 2 * time.Second,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 32,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		log:         log,
		ReadingsURL: readings,
		RankingURL:  ranking,
		SocialURL:   social,
	}
}
```

### Step 2 — parallel fan-out with per-dependency criticality

**`internal/bff/mobile.go`** — *continues the same file.* (The import block above
already lists `context`, `encoding/json`, `fmt` and `sync`; they get used here.)

```go
// dependency describes one upstream call and whether it is essential.
type dependency struct {
	name     string
	critical bool // if true, its failure fails the whole screen
	call     func(context.Context) error
}

func (c *Client) FighterScreen(ctx context.Context, fighter, userID string) (*FighterScreen, error) {
	// The BFF's own budget. Every upstream call inherits from this, so a
	// slow dependency can never exceed what the client is willing to wait.
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	var (
		mu     sync.Mutex
		screen FighterScreen
		fatal  error
	)
	screen.Name = fighter

	deps := []dependency{
		{
			name: "readings", critical: true, // no readings, no screen
			call: func(ctx context.Context) error {
				var out struct {
					Power   int64   `json:"power"`
					History []int64 `json:"history"`
				}
				if err := c.getJSON(ctx, c.ReadingsURL+"/fighters/"+fighter, &out); err != nil {
					return err
				}
				mu.Lock()
				screen.Power = out.Power
				screen.PowerText = humanise(out.Power)
				screen.Sparkline = downsample(out.History, 12)
				mu.Unlock()
				return nil
			},
		},
		{
			name: "ranking", critical: false, // the screen works without a rank
			call: func(ctx context.Context) error {
				var out struct {
					Rank  int `json:"rank"`
					Total int `json:"total"`
				}
				if err := c.getJSON(ctx, c.RankingURL+"/rank/"+fighter, &out); err != nil {
					return err
				}
				mu.Lock()
				screen.Rank = out.Rank
				screen.RankLabel = fmt.Sprintf("#%d of %s", out.Rank, humanise(int64(out.Total)))
				mu.Unlock()
				return nil
			},
		},
		{
			name: "social", critical: false, // default to "not following"
			call: func(ctx context.Context) error {
				var out struct {
					Following bool `json:"following"`
				}
				url := c.SocialURL + "/follows?user=" + userID + "&fighter=" + fighter
				if err := c.getJSON(ctx, url, &out); err != nil {
					return err
				}
				mu.Lock()
				screen.Following = out.Following
				mu.Unlock()
				return nil
			},
		},
	}

	// PARALLEL. Sequential would make the BFF slower than the client doing
	// the calls itself, which defeats the entire purpose.
	var wg sync.WaitGroup
	for _, d := range deps {
		wg.Add(1)
		go func(d dependency) {
			defer wg.Done()
			if err := d.call(ctx); err != nil {
				c.log.Warn("bff dependency failed",
					"dep", d.name, "critical", d.critical, "err", err)
				mu.Lock()
				if d.critical {
					fatal = fmt.Errorf("%s: %w", d.name, err)
				} else {
					// Degrade: record it, render the screen anyway.
					screen.Degraded = append(screen.Degraded, d.name)
				}
				mu.Unlock()
			}
		}(d)
	}
	wg.Wait()

	if fatal != nil {
		return nil, fatal
	}
	return &screen, nil
}

func (c *Client) getJSON(ctx context.Context, url string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	// Propagate the correlation id so the whole fan-out is one trace.
	if id, ok := ctx.Value(requestIDKey{}).(string); ok {
		req.Header.Set("X-Request-Id", id)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upstream %s returned %d", url, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(dst)
}

type requestIDKey struct{}
```

The presentation helpers — note that they live here, in the BFF, because they
are *presentation*:

**`internal/bff/mobile.go`** — *still the same file.*

```go
func humanise(n int64) string {
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		return s
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	return string(out)
}

// downsample reduces a long history to n points for a sparkline.
// Doing this server-side means the mobile client downloads 12 numbers
// instead of 5,000 — the payload win that justifies the BFF.
func downsample(xs []int64, n int) []int64 {
	if len(xs) <= n {
		return xs
	}
	out := make([]int64, 0, n)
	step := float64(len(xs)) / float64(n)
	for i := 0; i < n; i++ {
		out = append(out, xs[int(float64(i)*step)])
	}
	return out
}
```

### Step 3 — the BFF binary

**`cmd/mobile-bff/main.go`**

```go
package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/<your-username>/gravity-chamber/internal/bff"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	client := bff.New(log,
		env("READINGS_URL", "http://localhost:8080"),
		env("RANKING_URL", "http://localhost:8081"),
		env("SOCIAL_URL", "http://localhost:8082"),
	)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("GET /screens/fighter/{name}", func(w http.ResponseWriter, r *http.Request) {
		user := r.Header.Get("X-User-Id") // set by the gateway (Capsule 08)
		screen, err := client.FighterScreen(r.Context(), r.PathValue("name"), user)
		if err != nil {
			log.Error("screen failed", "fighter", r.PathValue("name"), "err", err)
			http.Error(w, `{"error":"unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		// Screens are per-user, so this must never be cached by a shared
		// cache (Capsule 16). Getting this wrong leaks one user's data
		// to another.
		w.Header().Set("Cache-Control", "private, max-age=5")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(screen)
	})

	srv := &http.Server{
		Addr:              ":9000",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Info("mobile bff online", "port", 9000)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("bff failed", "err", err)
		os.Exit(1)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
```

> ### ⏸ Natural stopping point
>
> Everything above stands on its own — commit it and come back. The steps below
> build on it but don't destabilise anything if you stop here. Two 45-minute
> sittings beat one 90-minute slog you don't finish.

### Step 4 — measure the win

```bash
# start scouter (:8080) and ranker (:8081), then the BFF
go run ./cmd/mobile-bff
```

**Client-side aggregation** (three sequential calls, as a mobile app would):

```bash
time (
  curl -s localhost:8080/fighters/goku > /dev/null
  curl -s localhost:8081/rank/goku     > /dev/null
  curl -s localhost:8082/follows       > /dev/null
)
```

**BFF aggregation:**

```bash
time curl -s localhost:9000/screens/fighter/goku | jq
```

Expect `"degraded": ["social"]` in that output, even with everything you built
running. The course never builds a social service, so nothing listens on
`:8082` (the third `curl` above fails just as fast), and the BFF treats that
exactly like an outage. That's the degradation path working before Step 5 asks
for it.

On localhost the difference is small. Add realistic network latency to see the
real effect:

```bash
# simulate 100ms RTT per call by sleeping in each upstream handler,
# or just do the arithmetic:
python3 - <<'PY'
rtt = 0.100          # mobile network round trip
work = [0.020, 0.015, 0.010]
print(f"client-side, sequential: {sum(w + rtt for w in work)*1000:.0f} ms")
print(f"BFF (client pays 1 RTT, fan-out is parallel on a fast network):"
      f" {(rtt + max(work) + 0.002)*1000:.0f} ms")
PY
```

```
client-side, sequential: 345 ms
BFF (client pays 1 RTT, fan-out is parallel on a fast network): 122 ms
```

**~3× faster, and the client got a smaller payload.** That's the pattern's whole
value proposition, and it comes from geography rather than cleverness: the BFF
sits next to the services, so its fan-out is cheap.

### Step 5 — prove graceful degradation

```bash
# kill the ranking service
curl -s localhost:9000/screens/fighter/goku | jq
```

```json
{
  "name": "goku",
  "power": 9001,
  "power_text": "9,001",
  "rank": 0,
  "sparkline": [8200, 8400, ...],
  "following": false,
  "degraded": ["ranking", "social"]
}
```

**The screen still renders.** Killing ranking added `"ranking"` to the list;
`"social"` was already there from Step 4, because there is no social service.
The two may come out in either order: each failing goroutine appends when it
finishes. The rank is missing and the client knows exactly what's missing, so
it can hide that widget rather than showing a wrong value.

Now kill the *readings* service:

```bash
curl -si localhost:9000/screens/fighter/goku | head -1
# HTTP/1.1 503 Service Unavailable
```

Correct: without readings there is no screen. **The `critical` flag encoded a
product decision in code**, which is exactly where that decision belongs — and
it's the part most implementations skip.

### Step 6 — a compare-the-alternative exercise

Write in `NOTES.md`, honestly, for the Scouter:

| Approach | Round trips (mobile) | Payload | Client knows topology | Extra service |
|---|---|---|---|---|
| Client-side aggregation | 3 | large | yes | no |
| BFF | 1 | small, exact | no | yes |
| GraphQL | 1 | client-chosen | no | yes + resolvers |
| One fat service endpoint | 1 | large | no | no, but it re-monolithises |

Then answer: *for this system, with one web client and one mobile client, which
would you choose and why?*

There's a defensible case for the fourth option at this size — and knowing when
the simple thing is right is the point of the exercise.

---

## In GCP

- **A BFF is just another Cloud Run service.** Deploy it in the same region as
  the services it calls — cross-region fan-out destroys the latency benefit
  you're building it for.
- **Keep backends internal.** `--ingress=internal` + `--no-allow-unauthenticated`
  on readings/ranking/social; only the BFF (and the gateway) can reach them.
  Then the BFF's service account gets `roles/run.invoker` on each.
- **Service-to-service auth**: fetch an OIDC identity token from the metadata
  server, audience = the target service URL, and attach it as a bearer token.
  Google's `idtoken` package does this in a few lines
  ([B7](../bonus/B7-kamis-ledger-iam-service-accounts/README.md)).
- **`--concurrency`** matters here: a BFF is I/O-bound (it mostly waits on other
  services), so a *high* concurrency (100–250) is efficient — the opposite of a
  CPU-bound service.
- **Cloud Trace** is what makes a BFF debuggable: one trace shows the fan-out as
  parallel spans and immediately reveals which upstream is the slow one
  (Capsule 25).
- **Apigee/API Gateway in front, BFF behind.** The gateway does auth and quotas;
  the BFF does shaping. Don't put shaping logic in the gateway.

---

## Bring it to work

- **One BFF per client type, owned by that client's team.** Ownership is the
  pattern, not the code.
- **A BFF orchestrates and transforms. It never owns domain rules or data.**
- **Always fan out in parallel**, with a total budget inherited from the request.
- **Mark each dependency critical or optional**, and degrade rather than fail.
  Tell the client what's missing.
- **Shape for the screen**, including formatting and downsampling — that's the
  payload win.
- **`Cache-Control: private`** on anything per-user. Always.
- **Propagate the correlation id** on every upstream call.
- **If the BFF only proxies, delete it.** A hop with no value is a hop with only
  cost.

---

## Battle drill

<details>
<summary><b>1.</b> Your BFF makes 12 backend calls per screen. Is that a problem?</summary>

Probably, but ask what kind of 12.

**Fine:** 12 parallel calls, all fast, total latency ≈ the slowest. You've saved
the client 11 round trips.

**Not fine:** any of them *sequential* because one's output feeds another's
input — 12 sequential calls is 12× the latency and you've just moved the
chattiness one hop closer to the services.

Also worrying at 12: tail amplification (Capsule 12) — waiting on 12 things
means you sample the tail 12 times, so your p99 is built from their p95s; and it
suggests a boundary problem (why does one screen need 12 services?).

Fixes: parallelise everything that isn't genuinely dependent; batch (one call
with 10 ids beats 10 calls); cache the stable parts; mark most of them optional
so one slow service doesn't hold the screen; and reconsider whether some of
those services should be one service.
</details>

<details>
<summary><b>2.</b> Web and mobile teams both want a field added. Where does it go?</summary>

Depends on what the field is.

**Existing data, new shape** — each BFF adds it independently, from data the
services already expose. No backend change, no coordination, both teams ship
today. **This is the pattern working exactly as intended.**

**New data the services don't have** — the owning service adds it, then each BFF
exposes it. Two steps, but the domain change happens once in the right place.

**Purely presentational** (a formatted string, a computed label) — the BFF, every
time. That's what it's for.

The anti-pattern is putting it in a *shared* BFF "since both need it". Today
they need the same thing; in three months web needs it paginated and mobile
needs it truncated, and now you have flags. Duplication between BFFs is
acceptable and often correct — they serve different masters.
</details>

<details>
<summary><b>3.</b> GraphQL instead of three BFFs — argue both sides.</summary>

**For GraphQL:** one schema instead of three services to maintain; clients evolve
their queries without any backend deploy; strong typing and introspection;
excellent tooling; genuinely better when you have many clients or clients you
don't control.

**Against:** you still need resolvers that aggregate — the work didn't vanish, it
moved. The N+1 problem is severe and needs DataLoader batching. HTTP caching is
largely lost (POST with a unique body defeats Capsule 16 entirely), so you need
persisted queries or a specialised cache. Malicious or careless deep queries can
DoS you, so you need depth and complexity limits. Authorization must be enforced
per field, and getting it wrong exposes data.

**Decide on client count and predictability.** Two or three known clients with
stable needs → BFFs, less machinery, easier caching. Many clients or unknown
consumers → GraphQL earns its complexity.

And note they compose: a BFF can talk GraphQL to clients and REST to services.
</details>

<details>
<summary><b>4.</b> Should the BFF cache?</summary>

Yes, but carefully, and the distinction is what matters.

**Cache upstream responses** (shared, non-personalised): the leaderboard, a
fighter's public stats. Short TTL, in Redis, shared across BFF instances. This
is the high-value cache and it's safe.

**Cache assembled screens** (per-user): possible, but the key must include the
user id, the TTL must be short, and the response must be `Cache-Control:
private`. Get it wrong and you serve one user's screen to another — a breach,
not a bug (Capsule 16).

**Don't cache** anything that must be immediately consistent with a user's own
action — the read-your-writes problem (Capsule 13) is very visible here, because
the user just tapped the thing.

The best BFF caching is usually **partial**: cache the stable components, fetch
the volatile ones live, assemble each time. That keeps the hit ratio high where
it's safe and freshness where it matters.
</details>

<details>
<summary><b>5.</b> The mobile team wants to own the BFF but has no backend experience. What do you do?</summary>

Support the ownership; don't take it away. The ownership *is* the pattern — a
BFF owned by a backend team is a gateway with extra latency, and every screen
change becomes a cross-team ticket.

What makes it work in practice:
- **A paved road**: a template repo with logging, tracing, health checks,
  timeouts, breakers, CI and deploy already wired. They write handlers, not
  infrastructure.
- **Let them use their language.** A TypeScript BFF owned by a TS frontend team
  beats a Go BFF nobody on that team can debug at 2am.
- **Pairing for the first month**, then advisory.
- **Clear boundaries**: they own shaping and orchestration. Domain rules,
  persistence and business invariants stay in the services. Enforce it in code
  review.
- **Shared on-call initially**, moving to theirs as they build confidence — and
  be honest that this is part of the deal.

The teams that fail at BFFs are usually the ones where ownership was nominal.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| BFF slower than the client doing it | Sequential fan-out. Use goroutines and a `WaitGroup`. |
| Data race on the screen struct | Concurrent goroutines writing shared state — that's what the mutex is for. `go test -race`. |
| One slow upstream holds the whole screen | Set a per-call timeout *and* an overall budget; mark non-essential deps optional. |
| Screen served to the wrong user | `Cache-Control: private` missing, or the cache key lacks the user id. Incident, not a bug. |
| `context deadline exceeded` on every call | The BFF's budget is shorter than the upstream's typical latency. Measure first, then set it. |
| Connection pool exhausted under load | Default `MaxIdleConnsPerHost` is 2. Raise it — a BFF is fan-out-heavy by design. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(bff): mobile backend-for-frontend with parallel fan-out

Capsule 23. One screen-shaped endpoint replaces three client round trips.
Fan-out is parallel with an inherited deadline; each dependency is marked
critical or optional so a ranking outage degrades the screen instead of
breaking it. Formatting and downsampling done server-side."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 23
```

**Next:** [Capsule 24 · Ginyu's Body Change — Safe Deployments](../24-body-change-deployments/README.md)
