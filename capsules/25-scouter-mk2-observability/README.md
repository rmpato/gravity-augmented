# Capsule 25 · Scouter Mk. II — Observability & SLOs

> *The scouter is the most useful piece of technology in the series and it fails
> constantly — it reads a number, it can't explain it, and it explodes when the
> value is too large. Vegeta eventually throws his away and learns to sense ki
> directly, because a single number that only tells you "big" is not
> information.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 9 | 95 min | Sagas 1–5 | Local + ☁️ optional |

---

## Why this capsule exists

You have a distributed system: a gateway, a monolith, a ranker, a BFF, a
database, a cache and a message bus. When a user says "it's slow", you currently
have no way to find out *where*.

Monitoring tells you **that** something is wrong. Observability lets you ask
**why** — including questions you didn't anticipate when you instrumented it.

This is also the capsule that turns "is the system healthy?" from an opinion
into a number with a budget.

---

## The concept

### The three signals, and what each is for

| | Answers | Cost | Cardinality |
|---|---|---|---|
| **Metrics** | "how many, how fast, how full" | cheap | ⚠️ **must be low** |
| **Logs** | "what exactly happened in this case" | moderate | unlimited |
| **Traces** | "where did the time go across services" | sampled | high |

They're complementary, and the standard workflow uses all three in order:

```
  metric alert fires  →  find the trace showing the slow span
                      →  read the logs for that trace id
```

### RED and USE

**RED** — for anything request-driven:
- **R**ate — requests per second
- **E**rrors — failures per second (and as a ratio)
- **D**uration — latency distribution

**USE** — for any resource (CPU, memory, pool, queue):
- **U**tilisation — % busy
- **S**aturation — how much work is *waiting*
- **E**rrors

Saturation is the one that predicts trouble — Capsule 09 has the full
argument, and Capsule 05 made you feel it. What matters *here* is that most
dashboards ship with utilisation gauges and no saturation metric at all, so
this is the one you have to add deliberately: queue depth, pool wait time,
throttled CPU seconds.

### Cardinality will bankrupt you

The number of unique label combinations:

```
  http_requests{method, status, endpoint}
    5 methods × 10 statuses × 50 endpoints          = 2,500 series   ✅

  http_requests{method, status, endpoint, user_id}
    2,500 × 1,000,000 users                = 2.5 BILLION series      💥
```

Each series is stored, indexed and billed. This is the single most common way
teams accidentally spend more on monitoring than on compute.

**Rules:**
- **Never** put a user id, request id, email, trace id, full URL path or raw
  error message in a metric label.
- Bucket instead: `path=/fighters/{name}`, not `/fighters/goku`.
- High-cardinality data belongs in **logs and traces**, which are built for it.

*(Scouters explode when they read a number too large. Same lesson.)*

### Distributed tracing

A **trace** is one request's journey; a **span** is one operation within it.

```
  trace_id: abc123
  ├─ span: gateway            [────────────────────────] 240ms
  │  ├─ span: bff             [──────────────────────]   225ms
  │  │  ├─ span: readings     [────]                      40ms
  │  │  ├─ span: ranking      [────────────────────]     195ms  ← the culprit
  │  │  │  └─ span: db query  [───────────────────]      190ms  ← the real culprit
  │  │  └─ span: social       [──]                        20ms
```

You can see at a glance that ranking is slow, that it's the database and not the
service, and that readings and social ran in parallel.

**Context propagation** is the entire mechanism: the W3C `traceparent` header is
passed from service to service. **One service that drops it breaks the chain
from there on**, which is why propagation is the thing to get right first.

**Sampling** — you can't trace everything at scale.
- **Head-based**: decide at the start (e.g. 1%). Simple, cheap, may miss the
  interesting requests.
- **Tail-based**: buffer the whole trace, decide after (keep all errors, all slow
  requests, 1% of the rest). Much more useful, more infrastructure.

### SLI, SLO, SLA, error budget

- **SLI** (indicator) — a measurement. "% of requests under 300 ms."
- **SLO** (objective) — a target with a **window**. "99.9% under 300 ms over 28
  days."
- **SLA** (agreement) — an SLO with financial penalties. Always looser than your
  SLO.
- **Error budget** — `100% − SLO`. At 99.9% over 28 days, that's **40 minutes**
  of allowed failure.

**The error budget is the point.** It converts reliability from an argument into
arithmetic:

- Budget remaining → ship features, take risks, deploy on Friday.
- Budget exhausted → feature freeze, reliability work only.

That's a policy both engineering and product can agree to *in advance*, which is
what stops the "move fast" vs "be stable" argument from recurring monthly.

**100% is the wrong target.** It's impossible, and pursuing it means you ship
nothing. Pick the lowest number your users won't notice.

### Alert on symptoms, not causes

```
  ❌ "CPU > 80%"                    — so what? Maybe it's efficient
  ❌ "disk 70% full"                — a ticket, not a page
  ✅ "error rate > 1% for 5 min"    — users are affected
  ✅ "p99 > 1s for 10 min"          — users are affected
  ✅ "error budget burning 14x"     — you'll exhaust the month in 2 days
```

**Every page must be actionable and urgent.** If the responder's action is
"acknowledge and go back to sleep", it should not have been a page. Alert
fatigue is a real failure mode: teams that get paged for everything stop reading
pages, and then miss the real one.

**Multi-window burn-rate alerting** is the mature form: page fast on a rapid burn
(14× over 1 hour → budget gone in 2 days), ticket slowly on a gradual one (3×
over 6 hours). It catches both the outage and the slow leak without paging for
noise.

---

## Lab

### Step 1 — structured logs with a correlation id

You've been carrying `X-Request-Id` since Capsule 08. Now make every log line
inherit it automatically.

**`internal/obs/logging.go`**

```go
// Package obs holds cross-cutting observability plumbing.
package obs

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type ctxKey struct{}

// WithLogger stores a request-scoped logger that already carries the
// correlation fields, so handlers never have to remember to add them.
func WithLogger(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, ctxKey{}, l)
}

// L returns the request-scoped logger, or the default.
func L(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// Middleware attaches trace and request ids to every log line for the
// lifetime of the request. This is what makes "find everything about
// request X" a single query instead of an archaeology project.
func Middleware(base *slog.Logger, service, version string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			traceID, spanID := traceFromHeader(r.Header.Get("traceparent"))
			reqID := r.Header.Get("X-Request-Id")
			if reqID == "" {
				reqID = spanID
			}
			if reqID == "" {
				// Neither header present: mint one. Otherwise every log line
				// from a client that sends neither is uncorrelatable — and
				// those are exactly the requests you end up investigating.
				reqID = uuid.NewString()
			}

			l := base.With(
				"service", service,
				"version", version,
				"request_id", reqID,
				// Cloud Logging correlates logs with traces automatically
				// when the field is named exactly this.
				"logging.googleapis.com/trace", traceID,
			)
			ctx := WithLogger(r.Context(), l)
			w.Header().Set("X-Request-Id", reqID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// traceFromHeader parses a W3C traceparent:
//
//	00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
//	│  │                                │                │
//	│  trace-id (32 hex)                span-id (16 hex) flags
//	version
//
// It returns empty strings for anything malformed rather than an error. That
// is the important decision here: a broken header from an upstream you do not
// control must degrade to "no trace", never fail the request.
func traceFromHeader(h string) (traceID, spanID string) {
	parts := strings.Split(h, "-")
	if len(parts) != 4 || len(parts[1]) != 32 || len(parts[2]) != 16 {
		return "", ""
	}
	if parts[1] == strings.Repeat("0", 32) || parts[2] == strings.Repeat("0", 16) {
		return "", "" // all-zero ids are explicitly invalid in the spec
	}
	return parts[1], parts[2]
}
```

Cloud Logging wants `severity`, not slog's default `level`. One replacer fixes
it, and it's the difference between coloured, filterable logs and grey text:

```go
// GCPHandler renames slog's level -> severity and message -> message,
// which is what Cloud Logging's structured ingestion expects.
func GCPHandler(w io.Writer, level slog.Level) slog.Handler {
	return slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level: level,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			switch a.Key {
			case slog.LevelKey:
				a.Key = "severity"
				if a.Value.Any().(slog.Level) == slog.LevelWarn {
					a.Value = slog.StringValue("WARNING") // GCP's spelling
				}
			case slog.MessageKey:
				a.Key = "message"
			case slog.TimeKey:
				a.Key = "timestamp"
			}
			return a
		},
	})
}
```

### Step 2 — RED metrics, with cardinality discipline

```bash
go get github.com/prometheus/client_golang/prometheus
go get github.com/prometheus/client_golang/prometheus/promhttp
```

**`internal/obs/metrics.go`**

```go
package obs

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// RED: Rate and Errors come from this counter (errors = status>=500).
	//
	// LABELS ARE DELIBERATELY LOW-CARDINALITY. `route` is the PATTERN
	// ("/fighters/{name}"), never the actual path. Putting the real path
	// here would create one series per fighter — the classic mistake.
	requests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total HTTP requests.",
	}, []string{"method", "route", "status"})

	// D: Duration. A HISTOGRAM, not a gauge — you cannot compute a
	// percentile from an average, and you cannot average percentiles
	// across instances. Histograms are mergeable; percentiles are not.
	duration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency.",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	}, []string{"method", "route"})

	// USE: saturation of in-flight work.
	inFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "http_requests_in_flight",
		Help: "Requests currently being served.",
	})

	// Business metrics matter as much as technical ones. A perfectly
	// healthy service that stopped recording readings is still broken.
	readingsRecorded = promauto.NewCounter(prometheus.CounterOpts{
		Name: "scouter_readings_recorded_total",
		Help: "Power readings successfully recorded.",
	})
)

func RecordReading() { readingsRecorded.Inc() }

type recorder struct {
	http.ResponseWriter
	status int
}

func (r *recorder) WriteHeader(c int) { r.status = c; r.ResponseWriter.WriteHeader(c) }

// Metrics wraps a handler. `route` must be the PATTERN, not the path.
func Metrics(route string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inFlight.Inc()
		defer inFlight.Dec()

		start := time.Now()
		rec := &recorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)

		elapsed := time.Since(start).Seconds()
		requests.WithLabelValues(r.Method, route, strconv.Itoa(rec.status)).Inc()
		duration.WithLabelValues(r.Method, route).Observe(elapsed)
	})
}
```

Now **apply it**, and expose the scrape endpoint.

`obs.Metrics` takes the route *pattern* as an argument rather than reading
`r.URL.Path` itself — deliberately, because that is what keeps the label set
bounded. The consequence is that it has to be applied at registration time, one
route at a time. A tiny helper keeps that from being tedious:

```go
// route registers a handler AND its RED metrics with the route PATTERN as the
// label. This is the concrete answer to "how do I get the pattern, not the path".
func route(mux *http.ServeMux, pattern string, h http.HandlerFunc) {
	mux.Handle(pattern, obs.Metrics(pattern, h))
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	// Prometheus scrapes this. Deliberately NOT metered — a scrape every 15s
	// would otherwise be the busiest "endpoint" on your dashboard.
	mux.Handle("GET /metrics", promhttp.Handler())

	route(mux, "GET /healthz", s.handleHealthz)
	route(mux, "GET /readyz", s.handleReadyz)
	route(mux, "POST /readings", s.handleRecord)
	route(mux, "GET /fighters/{name}", s.handleGetFighter)
	route(mux, "GET /leaderboard", s.handleLeaderboard)
	// …and the rest
}
```

> **Registering the collectors is not enough.** A Prometheus `CounterVec` with
> zero observed label combinations emits *nothing at all* — not even its `# HELP`
> line. If you skip the `route` helper, the check below prints an empty result
> and it looks like your build is broken. It isn't; you just never incremented
> anything.

```bash
make run
curl -s localhost:8080/healthz >/dev/null
curl -s localhost:8080/fighters/goku >/dev/null
curl -s localhost:8080/metrics | grep -E '^http_requests_total|^http_request_duration'
```

```
http_requests_total{method="GET",route="GET /healthz",status="200"} 1
http_requests_total{method="GET",route="GET /fighters/{name}",status="404"} 1
```

**Look at that `route` label.** It says `GET /fighters/{name}`, not
`GET /fighters/goku`. That is the whole point, and the next block shows what
happens when you get it wrong.

**Deliberately make the mistake once**, so you recognise it later:

```go
	// ❌ DO NOT SHIP — this is here so you can see the explosion.
	requests.WithLabelValues(r.Method, r.URL.Path, strconv.Itoa(rec.status)).Inc()
```

```bash
for i in $(seq 1 500); do curl -s "localhost:8080/fighters/f_$i" >/dev/null; done
curl -s localhost:8080/metrics | grep -c '^http_requests_total'
# 500+ series from ONE endpoint. Now imagine a million users.
```

Put it back to the pattern.

> ### ⏸ Natural stopping point
>
> Everything above stands on its own — commit it and come back. The steps below
> build on it but don't destabilise anything if you stop here. Two 45-minute
> sittings beat one 90-minute slog you don't finish.

### Step 3 — distributed tracing with OpenTelemetry

```bash
go get go.opentelemetry.io/otel \
       go.opentelemetry.io/otel/sdk \
       go.opentelemetry.io/otel/exporters/stdout/stdouttrace \
       go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
```

**`internal/obs/tracing.go`**

```go
package obs

import (
	"context"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// InitTracing wires up an OpenTelemetry tracer. Swap the exporter for OTLP
// (Cloud Trace, Jaeger, Honeycomb) without touching any instrumented code —
// that vendor-neutrality is the reason to use OTel rather than a vendor SDK.
func InitTracing(ctx context.Context, service, version string) (func(context.Context) error, error) {
	exporter, err := stdouttrace.New(stdouttrace.WithWriter(os.Stderr))
	if err != nil {
		return nil, err
	}

	res, err := resource.New(ctx, resource.WithAttributes(
		semconv.ServiceName(service),
		semconv.ServiceVersion(version),
	))
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		// Head-based sampling. 100% locally; 1-5% in production, or
		// tail-based sampling via a collector so you keep all the errors.
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(1.0))),
	)
	otel.SetTracerProvider(tp)

	// THE MOST IMPORTANT LINE. Without a propagator, every service starts
	// its own trace and you get N disconnected fragments instead of one
	// picture. W3C traceparent is the standard.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp.Shutdown, nil
}
```

Instrument the server and the client — two lines each:

```go
	// server: extracts traceparent, creates a span
	handler = otelhttp.NewHandler(handler, "scouter")

	// client: INJECTS traceparent into outgoing requests. Miss this and
	// the trace stops at your service.
	client := &http.Client{
		Transport: otelhttp.NewTransport(http.DefaultTransport),
		Timeout:   2 * time.Second,
	}
```

Add spans around the interesting work:

```go
func (s *PostgresStore) Leaderboard(n int) []Reading {
	ctx, span := otel.Tracer("scouter/store").Start(context.Background(), "store.Leaderboard")
	defer span.End()
	span.SetAttributes(attribute.Int("limit", n))
	// …
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "query failed")
	}
}
```

Run the chain and read one trace:

```bash
go run ./cmd/ranker 2> ranker-traces.json &
make run 2> scouter-traces.json &
curl -s localhost:9000/screens/fighter/goku > /dev/null

jq -r 'select(.Name) | "\(.Name)  \(.SpanContext.TraceID[0:8])  \((.EndTime|fromdate) - (.StartTime|fromdate))s"' \
  scouter-traces.json | head
```

The same `TraceID` across both files is the whole point: **one request, many
services, one identifier.**

### Step 4 — define an SLO and compute the error budget

Not an abstraction — a number you can query.

**`docs/slo.md`**

```markdown
# SLOs — Scouter

## SLO 1 · Availability
**SLI:** proportion of `/leaderboard` and `/fighters/*` requests returning
non-5xx.
**Objective:** 99.9% over a rolling 28 days.
**Error budget:** 0.1% = 40 minutes of full outage, or 40,000 failed requests
per 40M.
**Rationale:** users refresh; a brief failure is survivable. 99.99% would
require multi-region and is not justified by the product.

## SLO 2 · Latency
**SLI:** proportion of `/leaderboard` requests served in < 300 ms.
**Objective:** 99% over 28 days.
**Rationale:** 300 ms is the threshold at which the list feels instant.

## SLO 3 · Freshness
**SLI:** proportion of readings reflected in the leaderboard within 5 s.
**Objective:** 99% over 28 days.
**Rationale:** the ranking pipeline is async (Capsule 18); this makes the
staleness we accepted explicit and measurable rather than assumed.

## Error budget policy
- **> 50% remaining** — normal delivery. Ship freely.
- **< 50%** — no risky deploys on Fridays; canaries required.
- **< 25%** — feature freeze on the affected service; reliability work only.
- **exhausted** — full freeze until the budget recovers; a postmortem is
  required before the freeze lifts.

Agreed by engineering and product on 2026-08-05. Reviewed quarterly.
```

The queries that make it real (PromQL):

```promql
# Availability SLI over 28 days
1 - (
  sum(rate(http_requests_total{status=~"5.."}[28d]))
  /
  sum(rate(http_requests_total[28d]))
)

# Latency SLI: proportion under 300ms, from the histogram
sum(rate(http_request_duration_seconds_bucket{le="0.3"}[28d]))
/
sum(rate(http_request_duration_seconds_count[28d]))

# Error budget CONSUMED (0 = untouched, 1 = exhausted)
(
  sum(rate(http_requests_total{status=~"5.."}[28d]))
  / sum(rate(http_requests_total[28d]))
) / 0.001

# Multi-window burn rate: PAGE if burning 14x over 1h AND 5m.
# Requiring both windows is what stops a 30-second blip from paging you.
(
  sum(rate(http_requests_total{status=~"5.."}[1h])) / sum(rate(http_requests_total[1h])) > 14 * 0.001
)
and
(
  sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 14 * 0.001
)
```

Compute your budget concretely:

```bash
python3 - <<'PY'
for slo in (0.99, 0.999, 0.9999, 0.99999):
    mins = (1 - slo) * 28 * 24 * 60
    print(f"SLO {slo*100:7.3f}%  →  {mins:7.1f} min of error budget per 28 days")
PY
```

```
SLO  99.000%  →   403.2 min of error budget per 28 days
SLO  99.900%  →    40.3 min
SLO  99.990%  →     4.0 min
SLO  99.999%  →     0.4 min
```

**Four minutes a month at 99.99%.** That's less than one bad deploy. Seeing this
table is usually what stops someone from casually promising four nines.

### Step 5 — Prometheus + Grafana locally

```yaml
# deploy/docker-compose.obs.yml
name: gravity-chamber-obs

services:
  prometheus:
    image: prom/prometheus:latest
    ports: ["9090:9090"]
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    extra_hosts: ["host.docker.internal:host-gateway"]

  grafana:
    image: grafana/grafana:latest
    ports: ["3000:3000"]
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: "Admin"
```

```yaml
# deploy/prometheus.yml
global:
  scrape_interval: 5s

scrape_configs:
  - job_name: scouter
    static_configs:
      - targets: ["host.docker.internal:8080"]
  - job_name: ranker
    static_configs:
      - targets: ["host.docker.internal:8081"]
```

```bash
docker compose -f deploy/docker-compose.obs.yml up -d
k6 run scripts/load/stress.js &
open http://localhost:9090   # Prometheus
open http://localhost:3000   # Grafana (add Prometheus at http://prometheus:9090)
```

Queries worth typing yourself, because they're the ones you'll use forever:

```promql
sum(rate(http_requests_total[1m])) by (route)                        # RED: rate
sum(rate(http_requests_total{status=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))  # errors
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, route))  # p99
http_requests_in_flight                                              # saturation
```

**Watch p99 climb as you increase load** — you are looking at the latency knee
from Capsule 09, live, on a graph. That's the moment the two capsules connect.

### Step 6 — the debugging drill

Break something and follow the signals in the correct order:

```bash
docker compose pause postgres
```

1. **Metric** — error rate spikes, `http_requests_in_flight` climbs.
2. **Trace** — find a failed request; the `store.Leaderboard` span shows the
   timeout.
3. **Log** — search the trace id; the exact error and parameters are there.

Now do it *without* tracing (comment out the propagator) and try again. You'll
have to guess which service, then grep logs by timestamp and hope.

**That difference is what observability buys**, and doing it once by hand is
what makes you willing to pay for it.

```bash
docker compose unpause postgres
docker compose -f deploy/docker-compose.obs.yml down
```

---

## In GCP

> ### ☁️ Optional
> Cloud Logging: 50 GiB/month free. Cloud Trace: 2.5M spans/month free.
> Cloud Monitoring: all GCP metrics free. This lab fits comfortably.

**Cloud Logging** — anything JSON on stdout is parsed and indexed automatically
(Capsule 01). Use `severity`, and include
`logging.googleapis.com/trace` to link logs to traces:

```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND severity>=ERROR AND jsonPayload.route="/leaderboard"' \
  --limit=20 --format=json | jq '.[].jsonPayload'
```

**Log-based metrics** turn a log pattern into a metric — useful for things you
didn't instrument, but watch cardinality just as carefully.

**Cloud Trace** — free ingestion up to the quota, and it accepts OTLP. Swap the
stdout exporter for `texporter` (the GCP exporter) or point OTLP at a collector.
The waterfall view is the same one you built by hand above.

**Cloud Monitoring SLOs are a first-class object**, which is genuinely excellent:

```bash
gcloud alpha monitoring slos create \
  --service=scouter \
  --slo-id=availability \
  --goal=0.999 \
  --rolling-period=28d \
  --request-based-good-total-ratio \
  --good-service-filter='metric.label.response_code_class!="5xx"'
```

You get burn-rate alerting and a budget graph without building any of it.

**Managed Service for Prometheus** — if you already speak PromQL, GCP will run
Prometheus for you and keep the query language.

**Error Reporting** groups stack traces automatically and notifies on new error
types — the cheapest useful alert you can enable.

**Cost warning:** logging is the line item that surprises people. Debug logging
at high volume can cost more than compute. Set log level by environment, exclude
health-check logs (they're most of your volume and none of your value), and use
log exclusion filters aggressively.

---

## Bring it to work

- **Correlation id generated at the edge, propagated everywhere, returned to the
  client.** Cheapest debugging tool that exists.
- **RED on every service, USE on every resource.**
- **Never put unbounded values in metric labels.** Route patterns, not paths.
- **Histograms for latency, always.** Percentiles don't average.
- **OpenTelemetry, not a vendor SDK** — instrument once, change backend later.
- **The propagator is the thing to get right first.** No propagation, no traces.
- **Write SLOs down and agree the error budget policy in advance**, while nobody
  is angry.
- **Alert on symptoms**, with multi-window burn rates. Every page must be
  actionable.
- **Instrument business metrics too.** A healthy service that stopped doing its
  job is still broken.
- **Exclude health checks from logs.** They're the majority of your volume.

---

## Battle drill

<details>
<summary><b>1.</b> Your monitoring bill exceeds your compute bill. What happened?</summary>

Almost certainly **cardinality**, then **log volume**.

Cardinality: a label with unbounded values — user id, request id, full URL path,
raw error message, or a `customer_name`. Each unique combination is a separate
stored, indexed series. One bad label on a busy metric produces millions.

Find it: most systems expose a "top metrics by series count" view. In Prometheus,
`topk(20, count by (__name__)({__name__=~".+"}))`.

Log volume: debug logging in production, health-check requests logged (often 90%
of lines and 0% of value), or full request/response bodies.

Fixes: bucket high-cardinality labels; move that detail to logs and traces where
it belongs; sample traces; exclude health checks; set retention deliberately —
30 days of hot logs plus cheap archive is usually right, not 400 days of hot.
</details>

<details>
<summary><b>2.</b> Why can't you average p99s across ten instances?</summary>

Percentiles aren't linear. Averaging ten p99 values gives you a number with no
statistical meaning — it isn't the p99 of the combined population, and it can be
wildly off in either direction.

Concretely: nine instances idle with p99 = 10 ms and one saturated with
p99 = 5,000 ms. The average is 509 ms. The true combined p99 depends entirely on
the traffic distribution and could be 10 ms (if the slow instance takes almost no
traffic) or 5,000 ms (if it takes most of it).

The fix is **histograms**. Each instance reports bucket counts; the buckets are
summed across instances; the percentile is computed from the merged histogram.
That's exactly what `histogram_quantile(0.99, sum(rate(...)) by (le))` does, and
why the `by (le)` matters.

This generalises: sums, counts, mins and maxes merge. Percentiles, medians and
distinct counts do not — you need mergeable sketches (histograms, t-digest, HLL).
</details>

<details>
<summary><b>3.</b> Design SLOs for a checkout service.</summary>

Start from user journeys, not endpoints.

- **Availability of "place order"**: 99.95% non-5xx over 28 days (≈20 min
  budget). Tighter than browsing because failure here is lost revenue and lost
  trust.
- **Latency of "place order"**: 99% under 2 s. Users tolerate more latency when
  they've committed to buying than when browsing.
- **Availability of "browse catalogue"**: 99.9%, and it should degrade gracefully
  to a cached catalogue rather than fail.
- **Correctness**: 99.999% of successful payments result in exactly one order.
  This one matters more than the others combined, and it's an SLI most teams
  never define.
- **Freshness**: 99% of orders visible in order history within 30 s (the async
  path).

Notes worth making explicit: measure from the **user's** perspective (client-side
RUM or the load balancer, not your handler); pick different objectives for
different journeys rather than one number for the service; and write the error
budget policy alongside them, because an SLO without a policy is a number nobody
acts on.
</details>

<details>
<summary><b>4.</b> Which of these should page someone at 3am? CPU 90%, disk 75%, error rate 0.5%, p99 4s, one pod restarting.</summary>

- **CPU 90%** — no. It might be efficient. Alert on the *symptom* it would cause.
- **Disk 75%** — no, ticket. Page when the projected time-to-full is under a few
  hours, which is far more useful than a static threshold.
- **Error rate 0.5%** — depends on the SLO. If the objective is 99.9%, then 0.5%
  is a 5× burn rate; page if the multi-window burn confirms it. If the objective
  is 99%, it's within budget.
- **p99 4 s** — page if it breaches the latency SLO and is sustained. One spike is
  not an outage.
- **One pod restarting** — no. That's the system self-healing, which is what it's
  for. Page on *repeated* restarts (a crash loop) or on capacity loss.

The unifying rule: **page on user-visible symptoms with an actionable response.**
Everything else is a ticket or a dashboard. And every page should link to a
runbook — if there's no runbook, either write one or downgrade the alert.
</details>

<details>
<summary><b>5.</b> Explain error budgets to a product manager who wants 100% uptime.</summary>

100% is impossible — networks partition, disks fail, cloud regions have outages,
and your dependencies have their own SLAs. Chasing it means never shipping,
because every change is a risk and the only way to eliminate risk is to freeze.

So the real question is: **how much unreliability will users not notice?** That's
usually 99.9% — 40 minutes a month — and going to 99.99% (4 minutes) typically
means multi-region, more on-call, and slower delivery, at several times the cost.

The error budget makes the trade-off concrete and *shared*: 0.1% is a budget we
agree to spend. Spend it on shipping features quickly, and we accept some
failures. Have it left over, and we ship more aggressively. Exhaust it, and we
stop feature work until reliability recovers.

That's the part that makes it work: **it's a pre-agreed rule, not an argument
during an incident.** Engineering stops being "the team that says no", and
product gets a lever it understands. The conversation becomes "which features are
worth the budget?" rather than "why can't you make it perfect?"
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Traces split into fragments | The propagator isn't set, or a client isn't using `otelhttp.NewTransport`. Every hop must both extract and inject. |
| `histogram_quantile` returns NaN | No data in the range, or you forgot `by (le)`. The `le` label is required. |
| Prometheus can't scrape | On macOS use `host.docker.internal` plus `extra_hosts`. Check `/targets` in the Prometheus UI. |
| Metrics cardinality exploding | A label with unbounded values. `topk(20, count by (__name__)({__name__=~".+"}))`. |
| Logs not linked to traces in GCP | The field must be exactly `logging.googleapis.com/trace` with the value `projects/PROJECT/traces/TRACE_ID`. |
| Everything logs at DEBUG in production | `LOG_LEVEL` not set per environment. This is usually the biggest single line on the logging bill. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(obs): RED metrics, OpenTelemetry tracing, SLOs

Capsule 25. Request-scoped logger carrying trace and request ids. RED
metrics with route PATTERNS as labels (reproduced the cardinality explosion
first). OTel tracing with W3C propagation across scouter, ranker and bff.
docs/slo.md defines three SLOs with an agreed error budget policy, plus the
PromQL for multi-window burn-rate alerting."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 25
```

**Next:** [Capsule 26 · Tournament of Power — The Capstone](../26-tournament-of-power-capstone/README.md)
