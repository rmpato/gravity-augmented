# Capsule 08 · King Yemma's Desk — Proxies, Gateways & the Edge

> *Every soul that dies passes one desk. King Yemma checks who you are, looks up
> what you did, and routes you: Heaven, Hell, or Snake Way to King Kai. He does
> not fight anyone. He does not judge the merits of your technique. He verifies,
> he decides, he routes — and nothing gets past him.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 6 | 85 min | Capsule 07 | Local + concept |

---

## Why this capsule exists

A load balancer answers "**which** instance?" A gateway answers "**should this
request exist at all, and what does it need to look like before my services see
it?**"

The distinction matters because there is a set of concerns that every service
would otherwise implement separately and inconsistently: authentication, rate
limiting, TLS, request IDs, CORS, API versioning, quotas. Doing that N times is
how you end up with one service that validates tokens correctly and four that
don't.

This capsule is also where a lot of interview questions live. "Where would you
put authentication?" and "API gateway or service mesh?" are standard, and the
good answer requires knowing what each layer is actually for.

---

## The concept

### Forward proxy vs reverse proxy

Same machinery, opposite direction, completely different purpose.

```
  FORWARD PROXY — acts for the CLIENT. The server doesn't know the real client.

    [your laptops] ──► [corporate proxy] ──► the internet
      purposes: egress control, content filtering, caching, hiding client IPs
      GCP: Cloud NAT, Secure Web Proxy

  REVERSE PROXY — acts for the SERVER. The client doesn't know the real backend.

    the internet ──► [reverse proxy] ──► [your services]
      purposes: TLS termination, routing, caching, hiding topology, shielding
      GCP: GCLB, Cloud Run's front end, nginx, Envoy
```

Everything else in this capsule is a reverse proxy with more opinions.

### The layer cake

These get conflated constantly. They're distinct jobs, and a single product
often does several:

| Layer | Question it answers | Typical implementation |
|---|---|---|
| **Load balancer** | which healthy instance? | GCLB, nginx upstream |
| **Reverse proxy** | how do I forward and reshape this? | nginx, Envoy, Caddy |
| **API gateway** | is this caller allowed, within quota, and where does this API live? | Apigee, GCP API Gateway, Kong |
| **Service mesh** | how do services talk to *each other* safely? | Istio, Linkerd, Cloud Service Mesh |
| **BFF** | what shape does *this client* need? | your own service (Capsule 23) |

**North–south vs east–west** is the vocabulary that makes this click:

- **North–south** = traffic entering and leaving your system. Gateway territory.
- **East–west** = service-to-service traffic inside it. Mesh territory.

### What an API gateway actually does

Concerns that are genuinely cross-cutting, so centralising them is right:

- **TLS termination** and certificate management
- **Authentication** — verify the JWT / API key / mTLS cert *once*, reject early
- **Rate limiting and quotas** — per API key, per tenant, per plan
- **Routing** — path, host, header, or API-version based
- **Request/response transformation** — protocol translation (REST↔gRPC), header
  injection/stripping
- **Observability** — one place where every request is logged with a correlation ID
- **Schema validation** — reject malformed requests before they reach a service
- **API keys, developer portals, monetisation** — the "product" side of APIs

**And what it must not do.** The failure mode has a name: the gateway becomes a
distributed monolith's control centre. Symptoms:

- Business logic in gateway config (routing on request *body* content)
- Response aggregation from many services (that's a BFF — Capsule 23 — and it
  belongs in code you can test)
- Per-team deploy contention on a shared config file
- Logic expressed in Lua/Rego/YAML that nobody can unit test or debug

**Rule of thumb: the gateway may inspect and reject. It should not compute.**

### Authentication: edge, service, or both?

The most common design question at this layer.

```
   Client ──► Gateway ──────────────────► Service
              validates JWT signature      trusts the gateway?
              rejects invalid/expired      re-validates?
              injects X-User-Id
```

**Terminate at the edge** — the gateway validates and passes identity downstream
in a header. Fast, simple, one implementation. But it means **anything that can
reach a service directly can impersonate anyone**, so it demands real network
isolation (internal-only services, mTLS, or authorised invocation).

**Validate in each service** — every service verifies the token itself.
Defence in depth; no implicit trust. Costs a little CPU and requires every
service to have the JWKS keys and get validation right.

**The mature answer is both, with different jobs:** the gateway does
**authentication** (who are you — reject anonymous and malformed early), each
service does **authorization** (may *this* user do *this* thing to *this*
resource — which only the service knows). Zero-trust architectures also keep
service-level identity verification via mTLS from the mesh.

More on tokens and OIDC in [Filler Arc B3](../bonus/B3-fortuneteller-baba-auth/README.md).

### TLS: terminate, passthrough, or re-encrypt

| Mode | What happens | Use when |
|---|---|---|
| **Termination** | proxy decrypts, forwards plaintext | inside a trusted VPC; simplest, and lets the proxy read HTTP |
| **Re-encryption** | proxy decrypts, inspects, re-encrypts to the backend | you need L7 features *and* encryption in transit. The common compliance answer |
| **Passthrough** | proxy never decrypts (L4 only) | end-to-end encryption is mandatory. You lose all L7 features |

You can't have both "the proxy routes by URL path" and "the proxy can't read the
traffic". That trade-off is worth being able to state out loud.

### Sidecars and service mesh

A **sidecar** is a proxy in the same pod/host as your service, intercepting all
its traffic. A **service mesh** is a fleet of sidecars plus a control plane
configuring them.

What that buys you, without touching application code: automatic mTLS between
all services, retries and timeouts, circuit breaking, traffic splitting for
canaries, and per-hop metrics and traces.

What it costs: real operational complexity, an extra network hop and a few ms of
latency per call, sidecar memory per pod, and a control plane to run and upgrade.

**When it's worth it:** dozens of services, multiple teams, a hard mTLS
requirement, or a genuine need for uniform traffic policy. **When it isn't:**
five services and one team — you'll get 80% of the value from a shared HTTP
client library with sane timeouts and retries, at 5% of the cost.

> "We should add a service mesh" is a plausible-sounding answer that is wrong
> more often than it's right. Ask what specific problem it solves that a library
> can't.

---

## Lab — build a gateway

You're going to write a real reverse proxy in Go. It's ~150 lines and it
demystifies the whole category: nginx and Envoy do this, faster, with more
features.

### Step 1 — the gateway

**`internal/gateway/gateway.go`**

```go
// Package gateway is a minimal API gateway: authenticate, rate-limit,
// tag with a request ID, route, and proxy. It inspects and rejects.
// It does not compute.
package gateway

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Route struct {
	Prefix string // path prefix to match, e.g. "/api/"
	Target string // backend base URL, e.g. "http://scouter:8080"
	Strip  bool   // strip the prefix before forwarding
	Public bool   // if false, requires an API key
}

type Config struct {
	Routes       []Route
	APIKeys      map[string]string // key -> caller name
	RateLimit    int               // requests per minute per caller
	UpstreamWait time.Duration     // total budget for a backend response
}

type Gateway struct {
	cfg     Config
	log     *slog.Logger
	proxies map[string]*httputil.ReverseProxy
	limiter *limiter
}

func New(cfg Config, log *slog.Logger) (*Gateway, error) {
	g := &Gateway{
		cfg:     cfg,
		log:     log,
		proxies: make(map[string]*httputil.ReverseProxy),
		limiter: newLimiter(cfg.RateLimit),
	}

	for _, r := range cfg.Routes {
		target, err := url.Parse(r.Target)
		if err != nil {
			return nil, err
		}
		p := httputil.NewSingleHostReverseProxy(target)

		// The backend must never see the caller's credentials, and must
		// always see who the gateway decided they are.
		orig := p.Director
		p.Director = func(req *http.Request) {
			orig(req)
			req.Header.Del("X-Api-Key")            // strip: already verified
			req.Header.Del("Authorization")        // strip: already verified
			req.Header.Set("X-Forwarded-By", "king-yemma")
		}

		// A backend failure must not leak its error page to the client.
		p.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
			log.Error("upstream failure",
				"target", target.String(), "path", req.URL.Path, "err", err)
			http.Error(w, `{"error":"upstream unavailable"}`, http.StatusBadGateway)
		}

		g.proxies[r.Prefix] = p
	}
	return g, nil
}

func (g *Gateway) Handler() http.Handler {
	return g.withRequestID(
		g.withLogging(
			http.HandlerFunc(g.route)))
}

// --- the chain --------------------------------------------------------------

func (g *Gateway) withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" {
			b := make([]byte, 8)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
		}
		// Forward it downstream AND return it to the client, so a user can
		// quote an ID in a bug report and you can find the exact trace.
		r.Header.Set("X-Request-Id", id)
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r)
	})
}

func (g *Gateway) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &recorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		g.log.Info("gateway_request",
			"request_id", r.Header.Get("X-Request-Id"),
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"caller", r.Header.Get("X-Caller"),
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

func (g *Gateway) route(w http.ResponseWriter, r *http.Request) {
	route, proxy, ok := g.match(r.URL.Path)
	if !ok {
		writeErr(w, http.StatusNotFound, "no route for "+r.URL.Path)
		return
	}

	if !route.Public {
		caller, ok := g.cfg.APIKeys[r.Header.Get("X-Api-Key")]
		if !ok {
			// 401: we don't know who you are. (403 would mean: we know, and no.)
			writeErr(w, http.StatusUnauthorized, "valid X-Api-Key required")
			return
		}
		r.Header.Set("X-Caller", caller)

		if !g.limiter.allow(caller) {
			w.Header().Set("Retry-After", "60")
			writeErr(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
	}

	if route.Strip {
		r.URL.Path = strings.TrimPrefix(r.URL.Path, strings.TrimSuffix(route.Prefix, "/"))
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}
	}
	proxy.ServeHTTP(w, r)
}

func (g *Gateway) match(path string) (Route, *httputil.ReverseProxy, bool) {
	best := -1
	for i, rt := range g.cfg.Routes {
		if strings.HasPrefix(path, rt.Prefix) &&
			(best == -1 || len(rt.Prefix) > len(g.cfg.Routes[best].Prefix)) {
			best = i // longest prefix wins — same rule as a routing table
		}
	}
	if best == -1 {
		return Route{}, nil, false
	}
	return g.cfg.Routes[best], g.proxies[g.cfg.Routes[best].Prefix], true
}

// --- a fixed-window rate limiter -------------------------------------------
// Deliberately the simple version. Capsule 17 explains why the boundary
// between windows lets a caller burst to 2x the limit, and what to use instead.

type limiter struct {
	mu      sync.Mutex
	limit   int
	windows map[string]*window
}

type window struct {
	count int
	start time.Time
}

func newLimiter(limit int) *limiter {
	return &limiter{limit: limit, windows: make(map[string]*window)}
}

func (l *limiter) allow(key string) bool {
	if l.limit <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	w, ok := l.windows[key]
	if !ok || time.Since(w.start) > time.Minute {
		l.windows[key] = &window{count: 1, start: time.Now()}
		return true
	}
	if w.count >= l.limit {
		return false
	}
	w.count++
	return true
}

// --- helpers ----------------------------------------------------------------

type recorder struct {
	http.ResponseWriter
	status int
}

func (r *recorder) WriteHeader(c int) { r.status = c; r.ResponseWriter.WriteHeader(c) }

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(`{"error":"` + msg + `"}`))
}
```

### Step 2 — the binary

**`cmd/gateway/main.go`**

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/<your-username>/gravity-chamber/internal/gateway"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	upstream := os.Getenv("SCOUTER_URL")
	if upstream == "" {
		upstream = "http://localhost:8080"
	}

	// Keys live in the environment, never in code:  KEYS="key1:web,key2:mobile"
	keys := map[string]string{}
	for _, pair := range strings.Split(os.Getenv("API_KEYS"), ",") {
		if k, v, ok := strings.Cut(pair, ":"); ok {
			keys[k] = v
		}
	}
	if len(keys) == 0 {
		log.Error("API_KEYS is required, e.g. API_KEYS=kamehameha:web")
		os.Exit(1)
	}

	g, err := gateway.New(gateway.Config{
		Routes: []gateway.Route{
			{Prefix: "/healthz", Target: upstream, Public: true},
			{Prefix: "/api/", Target: upstream, Strip: true},
		},
		APIKeys:      keys,
		RateLimit:    30,
		UpstreamWait: 10 * time.Second,
	}, log)
	if err != nil {
		log.Error("bad gateway config", "err", err)
		os.Exit(1)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "9090"
	}
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           g.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	go func() {
		log.Info("king yemma's desk is open", "port", port, "upstream", upstream)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("gateway failed", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
	log.Info("desk closed")
}
```

### Step 3 — run and probe it

```bash
# terminal 1
make run                                   # scouter on :8080

# terminal 2
API_KEYS="kamehameha:web,galickgun:mobile" go run ./cmd/gateway
```

```bash
# terminal 3

# public route, no key needed
curl -si localhost:9090/healthz | head -1

# protected route, no key -> 401
curl -s localhost:9090/api/leaderboard | jq

# with a key -> proxied, prefix stripped, 200
curl -s -H 'X-Api-Key: kamehameha' localhost:9090/api/leaderboard | jq

# every response carries a request id you can quote in a bug report
curl -si -H 'X-Api-Key: kamehameha' localhost:9090/api/leaderboard | grep -i x-request-id

# rate limiting: 30/min, so this trips
for i in $(seq 1 35); do
  curl -s -o /dev/null -w "%{http_code} " -H 'X-Api-Key: kamehameha' \
    localhost:9090/api/leaderboard
done; echo
```

You should see `200`s turn into `429`s. Note that `mobile` still has its own
budget — the limiter keys on caller, not on the endpoint.

> ### ⏸ Natural stopping point
>
> Everything above stands on its own — commit it and come back. The steps below
> build on it but don't destabilise anything if you stop here. Two 45-minute
> sittings beat one 90-minute slog you don't finish.

### Step 4 — prove the credential never reaches the backend

Add a temporary debug line in the scouter's logging middleware:

```go
		s.log.Info("http_request",
			"method", r.Method,
			"path", r.URL.Path,
			"api_key_seen", r.Header.Get("X-Api-Key"),   // should always be empty
			"caller", r.Header.Get("X-Caller"),          // set by the gateway
			"request_id", r.Header.Get("X-Request-Id"),
			…
```

Re-run. `api_key_seen` is empty and `caller` is populated. **The backend learns
identity without ever handling a credential** — that's the whole point of
terminating auth at the edge, and stripping the header is the part people forget.

### Step 5 — the trust question, made concrete

```bash
# bypass the gateway entirely
curl -s -H 'X-Caller: king-kai-himself' localhost:8080/leaderboard | jq
```

You just impersonated an arbitrary caller by talking to the backend directly.

**This is the central risk of edge-terminated auth**, and it's why the mitigation
is *network isolation*, not header cleverness. In production the backend would
be:

- Cloud Run with `--no-allow-unauthenticated`, so only the gateway's service
  account can invoke it
- or on an internal-only VPC with no public IP
- or requiring mTLS, so the caller proves it is the gateway

Write in `NOTES.md`: *"Edge auth is only as strong as the network isolation
behind it."*

### Step 6 — do it in nginx and compare

```nginx
    location /api/ {
      # everything your Go gateway does, minus the rate limiter, in 6 lines
      if ($http_x_api_key != "kamehameha") { return 401; }
      proxy_set_header X-Api-Key "";
      proxy_set_header X-Caller "web";
      proxy_set_header X-Request-Id $request_id;
      rewrite ^/api/(.*) /$1 break;
      proxy_pass http://scouters;
    }
```

Faster and shorter. But: no unit tests, no debugger, string comparison instead
of real key lookup, and `if` inside `location` in nginx is
[famously treacherous](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html#if).

**That's the real trade-off** — config-driven proxies are fast and operationally
mature; code-driven gateways are testable and debuggable. Most organisations end
up with a managed gateway for the standard concerns and application code for
anything specific.

---

## In GCP

> **Concept only** for the paid products. Read the menu; know which one you'd
> reach for and why.

| Product | What it is | Reach for it when |
|---|---|---|
| **GCLB URL maps** | path/host routing on the load balancer | you only need routing + TLS. Free-ish, already there |
| **Cloud Armor** | WAF + DDoS + IP/geo rules, attached to a backend service | public endpoints needing protection. Preconfigured OWASP rules |
| **IAP** (Identity-Aware Proxy) | Google-identity auth in front of any backend, no app code | internal tools, admin panels. Excellent and underused |
| **API Gateway** | managed gateway from an OpenAPI spec; API keys, JWT validation | a simple public API in front of Cloud Run/Functions |
| **Cloud Endpoints / ESPv2** | an Envoy-based proxy you deploy yourself | you want gateway features but inside your own infra |
| **Apigee** | full API management: portal, monetisation, analytics, policies | you sell APIs as a product. Enterprise pricing |
| **Cloud Service Mesh** | managed Istio for GKE | many services, mTLS everywhere, uniform traffic policy |

A pragmatic default stack for a small team:

```
  Cloud Armor  →  GCLB (TLS + URL map)  →  Cloud Run services
                     ↑ Cloud CDN checkbox for cacheable GETs
```

That covers TLS, DDoS, WAF, routing and CDN with no gateway product at all. Add
API Gateway or Apigee when you need API keys, quotas per plan, or a developer
portal — that is, when the API is a *product*.

**IAP deserves a specific callout:** put it in front of an internal tool and you
get Google-account authentication, group-based authorization, and audit logs
with zero application code. For admin dashboards and staging environments it is
the highest value-per-effort thing in this entire table.

---

## Bring it to work

- **Strip credentials at the gateway.** The backend should never receive the raw
  token or key it didn't validate.
- **Generate a request ID at the edge**, propagate it downstream, *and return it
  to the client*. It's the cheapest debugging tool that exists.
- **Authenticate at the edge, authorize in the service.** The gateway can't know
  whether user 42 may edit document 7.
- **Edge auth requires network isolation.** Otherwise it's a suggestion.
- **Keep business logic out of gateway config.** If a routing rule needs the
  request body, it belongs in a service.
- **Longest-prefix wins** for route matching. Ambiguous route precedence is a
  reliable source of 3am confusion.
- **Don't reach for a service mesh** until you can name the problem it solves
  that a shared HTTP client can't.

---

## Battle drill

<details>
<summary><b>1.</b> Gateway or load balancer — where do you put authentication, and what does that assume?</summary>

Gateway. It's a policy decision requiring token validation, key lookup and
possibly a call to an identity provider; an L4 load balancer can't read enough
of the request, and even an L7 LB is the wrong place for policy that changes
often.

The assumption it carries: **backends are not directly reachable.** If anyone can
curl the service and set `X-User-Id`, edge auth is decoration. So the design must
include internal-only services, authorised invocation, or mTLS.

The mature answer is layered: authentication at the edge (reject anonymous
early, one implementation), authorization in the service (only it knows the
resource-level rules), and service identity via mTLS if you have a mesh.
</details>

<details>
<summary><b>2.</b> Your gateway config has grown to 3,000 lines of routing with Lua scripts. What went wrong and what do you do?</summary>

Business logic migrated into infrastructure config. The symptoms are predictable:
nobody can test it, changes need a specialist, teams contend on one file, and
"why did this request fail?" requires reading Lua.

Recovery: inventory what the config actually does and sort into (a) genuinely
cross-cutting — auth, rate limiting, TLS, CORS, request IDs — which stays; and
(b) request-shaping and aggregation for particular clients, which becomes a
**BFF service** (Capsule 23) that has tests, a debugger, and an owning team.

Then constrain the gateway by policy: it may inspect and reject, it may not
compute.
</details>

<details>
<summary><b>3.</b> When is a service mesh worth its cost?</summary>

When you can name the problem. Genuine triggers: mandatory mTLS between all
services for compliance; dozens of services across multiple teams where you
cannot get consistent timeout/retry behaviour by library convention; a real need
for uniform traffic-splitting and per-hop telemetry without touching app code;
polyglot services where "just use our Go client library" isn't available.

Costs: a control plane to run and upgrade, a sidecar's memory per pod, an extra
hop (~1–3 ms) per call, and a genuinely harder debugging story — an error can
now come from your code, the local sidecar, the remote sidecar, or the control
plane.

Under ~10 services with one team, a shared HTTP client with sane defaults gets
most of the benefit for almost none of the cost.
</details>

<details>
<summary><b>4.</b> Client → Gateway → Service A → Service B. A user reports an error. How do you find it?</summary>

The gateway generates `X-Request-Id`, returns it to the client, and forwards it.
Every service logs it and propagates it on outgoing calls. Search the ID and you
get every log line from the entire request path.

That's the minimum. The proper version is **distributed tracing** (Capsule 25):
W3C `traceparent` propagation, so you get a waterfall showing that Service B
took 4 seconds and why, rather than a pile of log lines you must order yourself.

The critical implementation detail is **propagation** — a single service that
drops the header breaks the chain from there on.
</details>

<details>
<summary><b>5.</b> Why can't a TLS-passthrough proxy do path-based routing?</summary>

The path is inside the encrypted payload. A passthrough proxy operates at L4 and
never decrypts, so it can see the TCP connection and — via SNI in the TLS
`ClientHello` — the *hostname*, but never the URL, headers or body.

So passthrough gives you host-based routing at best. If you need path routing,
header routing, per-request load balancing, compression, or caching, you must
terminate TLS. If encryption in transit is also required all the way to the
backend, terminate and **re-encrypt** — that's the compromise position, and it's
what most regulated environments run.
</details>

<details>
<summary><b>6.</b> Your fixed-window rate limiter allows 100/min. A caller sends 200 requests in one second. How?</summary>

The window boundary. 100 requests at 11:59:59.5 fall in one window; 100 more at
12:00:00.5 fall in the next. Both are "within limit", and your backend saw 200
requests in a second — a 2× burst over the intended rate.

Fixes: a **sliding window log** (exact, memory-hungry), a **sliding window
counter** (weighted blend of current and previous window — the usual production
choice), or a **token bucket**, which allows a *bounded* burst by design and is
generally what you want.

Capsule 17 implements a token bucket properly.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Gateway returns 502 for everything | `SCOUTER_URL` is wrong, or the backend isn't running. Check the `upstream failure` log line — it names the target. |
| Backend sees the original path with the prefix | `Strip: true` must be set on the route, and route matching is longest-prefix. |
| `X-Request-Id` missing on the response | The middleware must set it on `w.Header()` *before* the handler writes anything. Headers can't be set after the body starts. |
| Rate limiter never triggers | It keys on `X-Caller`, which is only set for non-public routes. `/healthz` is public and unlimited by design. |
| Everything 401s | `API_KEYS` format is `key:name,key2:name2`. No spaces. |
| WebSockets fail through the proxy | `httputil.ReverseProxy` handles upgrades, but your `WriteTimeout` will kill long-lived connections. Set it to 0 for those routes. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(gateway): reverse proxy with api-key auth and rate limiting

Capsule 08. Routing by longest prefix, credential stripping so backends never
see raw keys, X-Request-Id generated at the edge and returned to the client,
fixed-window rate limiting per caller. Confirmed edge auth is only as strong
as the network isolation behind it."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 08
```

**Next:** [Capsule 09 · Hyperbolic Time Chamber — Load Testing & Capacity](../09-hyperbolic-time-chamber-load-testing/README.md)
