# Cápsula 25 · Scouter Mk. II — Observabilidad y SLOs

> *El scouter es la pieza de tecnología más útil de la serie y falla
> constantemente — lee un número, no lo puede explicar, y explota cuando el valor es
> demasiado grande. Vegeta termina tirando el suyo y aprendiendo a sentir el ki
> directamente, porque un solo número que solo te dice "grande" no es información.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 9 | 95 min | Sagas 1–5 | Local + ☁️ opcional |

---

## Por qué existe esta cápsula

Tenés un sistema distribuido: un gateway, un monolito, un ranker, un BFF, una base de
datos, un cache y un message bus. Cuando un usuario dice "está lento", ahora mismo no
tenés forma de averiguar *dónde*.

El monitoreo te dice **que** algo está mal. La observabilidad te deja preguntar **por
qué** — incluidas preguntas que no anticipaste cuando instrumentaste.

Esta también es la cápsula que convierte "¿el sistema está sano?" de una opinión en
un número con presupuesto.

---

## El concepto

### Las tres señales, y para qué sirve cada una

| | Responde | Costo | Cardinalidad |
|---|---|---|---|
| **Métricas** | "cuántos, qué tan rápido, qué tan lleno" | barato | ⚠️ **tiene que ser baja** |
| **Logs** | "qué pasó exactamente en este caso" | moderado | ilimitada |
| **Traces** | "adónde se fue el tiempo entre servicios" | muestreado | alta |

Son complementarias, y el flujo de trabajo estándar usa las tres en orden:

```
  metric alert fires  →  find the trace showing the slow span
                      →  read the logs for that trace id
```

### RED y USE

**RED** — para cualquier cosa manejada por requests:
- **R**ate — requests por segundo
- **E**rrors — fallas por segundo (y como ratio)
- **D**uration — distribución de latencia

**USE** — para cualquier recurso (CPU, memoria, pool, cola):
- **U**tilization — % ocupado
- **S**aturation — cuánto trabajo está *esperando*
- **E**rrors

La saturación es la que predice problemas — la Cápsula 09 tiene el argumento
completo, y la Cápsula 05 te lo hizo sentir. Lo que importa *acá* es que casi
todos los dashboards vienen con medidores de utilización y ninguna métrica de
saturación, así que esta es la que tenés que agregar a propósito: profundidad de
cola, tiempo de espera del pool, segundos de CPU estrangulados.

### La cardinalidad te va a fundir

La cantidad de combinaciones únicas de labels:

```
  http_requests{method, status, endpoint}
    5 methods × 10 statuses × 50 endpoints          = 2,500 series   ✅

  http_requests{method, status, endpoint, user_id}
    2,500 × 1,000,000 users                = 2.5 BILLION series      💥
```

Cada serie se almacena, indexa y factura. Esta es la forma más común en que los
equipos gastan accidentalmente más en monitoreo que en cómputo.

**Reglas:**
- **Nunca** pongas un id de usuario, id de request, email, id de trace, path de URL
  completo o mensaje de error crudo en un label de métrica.
- Agrupá en cambio: `path=/fighters/{name}`, no `/fighters/goku`.
- Los datos de alta cardinalidad van en **logs y traces**, que están construidos para
  eso.

*(Los scouters explotan cuando leen un número demasiado grande. La misma lección.)*

### Tracing distribuido

Un **trace** es el viaje de un request; un **span** es una operación dentro de él.

```
  trace_id: abc123
  ├─ span: gateway            [────────────────────────] 240ms
  │  ├─ span: bff             [──────────────────────]   225ms
  │  │  ├─ span: readings     [────]                      40ms
  │  │  ├─ span: ranking      [────────────────────]     195ms  ← the culprit
  │  │  │  └─ span: db query  [───────────────────]      190ms  ← the real culprit
  │  │  └─ span: social       [──]                        20ms
```

Ves de un vistazo que ranking está lento, que es la base y no el servicio, y que
readings y social corrieron en paralelo.

**La propagación de contexto es el mecanismo entero**: el header `traceparent` de
W3C se pasa de servicio a servicio. **Un solo servicio que lo pierda rompe la cadena
de ahí en adelante**, y por eso la propagación es lo primero que hay que hacer bien.

**Muestreo** — no podés tracear todo a escala.
- **Head-based**: decidís al principio (por ejemplo 1%). Simple, barato, puede
  perderse los requests interesantes.
- **Tail-based**: bufereás el trace completo, decidís después (guardá todos los
  errores, todos los lentos, 1% del resto). Mucho más útil, más infraestructura.

### SLI, SLO, SLA, error budget

- **SLI** (indicador) — una medición. "% de requests bajo 300 ms."
- **SLO** (objetivo) — una meta con **ventana**. "99,9% bajo 300 ms en 28 días."
- **SLA** (acuerdo) — un SLO con penalidades económicas. Siempre más laxo que tu SLO.
- **Error budget** — `100% − SLO`. Con 99,9% en 28 días, eso son **40 minutos** de
  falla permitida.

**El error budget es el punto.** Convierte la confiabilidad de una discusión en
aritmética:

- Queda presupuesto → shippeá features, tomá riesgos, deployá un viernes.
- Presupuesto agotado → freeze de features, solo trabajo de confiabilidad.

Esa es una política que ingeniería y producto pueden acordar *por adelantado*, que es
lo que evita que la pelea de "movete rápido" contra "sé estable" se repita todos los
meses.

**100% es el objetivo equivocado.** Es imposible, y perseguirlo significa que no
shippeás nada. Elegí el número más bajo que tus usuarios no vayan a notar.

### Alertá sobre síntomas, no sobre causas

```
  ❌ "CPU > 80%"                    — so what? Maybe it's efficient
  ❌ "disk 70% full"                — a ticket, not a page
  ✅ "error rate > 1% for 5 min"    — users are affected
  ✅ "p99 > 1s for 10 min"          — users are affected
  ✅ "error budget burning 14x"     — you'll exhaust the month in 2 days
```

**Cada página tiene que ser accionable y urgente.** Si la acción de quien responde es
"reconocer y volver a dormir", no debería haber sido una página. La fatiga de alertas
es un modo de falla real: los equipos a los que les suena todo dejan de leer las
alertas, y ahí se pierden la posta.

**Las alertas de burn rate multi-ventana** son la forma madura: paginá rápido ante un
consumo veloz (14× en 1 hora → el presupuesto se acaba en 2 días), abrí un ticket
lento ante uno gradual (3× en 6 horas). Agarra tanto la caída como la fuga lenta sin
paginar por ruido.

---

## Lab

### Paso 1 — logs estructurados con un ID de correlación

Venís llevando `X-Request-Id` desde la Cápsula 08. Ahora hacé que cada línea de log
lo herede automáticamente.

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

Cloud Logging quiere `severity`, no el `level` por defecto de slog. Un replacer lo
arregla, y es la diferencia entre logs coloreados y filtrables y texto gris:

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

### Paso 2 — métricas RED, con disciplina de cardinalidad

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

Ahora **aplicalas**, y exponé el endpoint de scrape.

`obs.Metrics` recibe el *pattern* de la ruta como argumento en vez de leer
`r.URL.Path` por su cuenta — a propósito, porque eso es lo que mantiene acotado
el label set. La consecuencia es que hay que aplicarlo al registrar, ruta por
ruta. Un helper chiquito evita que sea tedioso:

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

> **Registrar los collectors no alcanza.** Un `CounterVec` de Prometheus con cero
> combinaciones de labels observadas no emite *absolutamente nada* — ni siquiera
> su línea `# HELP`. Si te salteás el helper `route`, el chequeo de abajo imprime
> vacío y parece que tu build está roto. No lo está; simplemente nunca
> incrementaste nada.

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

**Mirá ese label `route`.** Dice `GET /fighters/{name}`, no
`GET /fighters/goku`. Ese es todo el punto, y el bloque siguiente muestra qué
pasa cuando lo hacés mal.

**Cometé el error a propósito una vez**, para reconocerlo después:

```go
	// ❌ DO NOT SHIP — this is here so you can see the explosion.
	requests.WithLabelValues(r.Method, r.URL.Path, strconv.Itoa(rec.status)).Inc()
```

```bash
for i in $(seq 1 500); do curl -s "localhost:8080/fighters/f_$i" >/dev/null; done
curl -s localhost:8080/metrics | grep -c '^http_requests_total'
# 500+ series from ONE endpoint. Now imagine a million users.
```

Volvelo al patrón.

> ### ⏸ Punto natural para cortar
>
> Todo lo de arriba se sostiene solo — commiteálo y volvé después. Los pasos que
> siguen construyen sobre eso pero no dejan nada inestable si parás acá. Dos
> sesiones de 45 minutos le ganan a una de 90 que no terminás.

### Paso 3 — tracing distribuido con OpenTelemetry

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

Instrumentá el servidor y el cliente — dos líneas cada uno:

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

Agregá spans alrededor del trabajo interesante:

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

Corré la cadena y leé un trace:

```bash
go run ./cmd/ranker 2> ranker-traces.json &
make run 2> scouter-traces.json &
curl -s localhost:9000/screens/fighter/goku > /dev/null

jq -r 'select(.Name) | "\(.Name)  \(.SpanContext.TraceID[0:8])  \((.EndTime|fromdate) - (.StartTime|fromdate))s"' \
  scouter-traces.json | head
```

El mismo `TraceID` en los dos archivos es el punto entero: **un request, muchos
servicios, un identificador.**

### Paso 4 — definí un SLO y calculá el error budget

No una abstracción — un número que podés consultar.

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

Las queries que lo hacen real (PromQL):

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

Calculá tu presupuesto concretamente:

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

**Cuatro minutos por mes con 99,99%.** Eso es menos que un deploy malo. Ver esta
tabla es normalmente lo que hace que alguien deje de prometer cuatro nueves a la
ligera.

### Paso 5 — Prometheus + Grafana en local

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

Queries que vale la pena tipear vos mismo, porque son las que vas a usar para
siempre:

```promql
sum(rate(http_requests_total[1m])) by (route)                        # RED: rate
sum(rate(http_requests_total{status=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))  # errors
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, route))  # p99
http_requests_in_flight                                              # saturation
```

**Mirá el p99 subir mientras aumentás la carga** — estás mirando la rodilla de
latencia de la Cápsula 09, en vivo, en un gráfico. Ese es el momento en que las dos
cápsulas se conectan.

### Paso 6 — el ejercicio de debugging

Rompé algo y seguí las señales en el orden correcto:

```bash
docker compose pause postgres
```

1. **Métrica** — la tasa de error salta, `http_requests_in_flight` sube.
2. **Trace** — encontrá un request fallido; el span de `store.Leaderboard` muestra el
   timeout.
3. **Log** — buscá el id de trace; el error exacto y los parámetros están ahí.

Ahora hacelo *sin* tracing (comentá el propagador) e intentá de nuevo. Vas a tener
que adivinar qué servicio, después grepear logs por timestamp y esperar.

**Esa diferencia es lo que compra la observabilidad**, y hacerlo una vez a mano es lo
que te hace estar dispuesto a pagarla.

```bash
docker compose unpause postgres
docker compose -f deploy/docker-compose.obs.yml down
```

---

## En GCP

> ### ☁️ Opcional
> Cloud Logging: 50 GiB/mes gratis. Cloud Trace: 2,5M spans/mes gratis.
> Cloud Monitoring: todas las métricas de GCP gratis. Este lab entra cómodo.

**Cloud Logging** — cualquier JSON en stdout se parsea e indexa automáticamente
(Cápsula 01). Usá `severity`, e incluí
`logging.googleapis.com/trace` para vincular logs con traces:

```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND severity>=ERROR AND jsonPayload.route="/leaderboard"' \
  --limit=20 --format=json | jq '.[].jsonPayload'
```

**Las métricas basadas en logs** convierten un patrón de log en una métrica — útil
para cosas que no instrumentaste, pero cuidá la cardinalidad igual de cerca.

**Cloud Trace** — ingesta gratis hasta la cuota, y acepta OTLP. Cambiá el exporter de
stdout por `texporter` (el exporter de GCP) o apuntá OTLP a un collector. La vista de
cascada es la misma que construiste a mano arriba.

**Los SLOs de Cloud Monitoring son un objeto de primera clase**, lo cual es
genuinamente excelente:

```bash
gcloud alpha monitoring slos create \
  --service=scouter \
  --slo-id=availability \
  --goal=0.999 \
  --rolling-period=28d \
  --request-based-good-total-ratio \
  --good-service-filter='metric.label.response_code_class!="5xx"'
```

Obtenés alertas de burn rate y un gráfico de presupuesto sin construir nada.

**Managed Service for Prometheus** — si ya hablás PromQL, GCP te corre Prometheus y
te deja el lenguaje de queries.

**Error Reporting** agrupa stack traces automáticamente y notifica sobre tipos de
error nuevos — la alerta útil más barata que podés habilitar.

**Advertencia de costo:** el logging es la línea que sorprende a la gente. El logging
de debug a alto volumen puede costar más que el cómputo. Configurá el nivel de log
por entorno, excluí los logs de health checks (son la mayor parte de tu volumen y
nada de tu valor), y usá filtros de exclusión agresivamente.

---

## Llevátelo al trabajo

- **ID de correlación generado en el borde, propagado a todos lados, devuelto al
  cliente.** La herramienta de debugging más barata que existe.
- **RED en cada servicio, USE en cada recurso.**
- **Nunca pongas valores sin límite en labels de métricas.** Patrones de ruta, no
  paths.
- **Histogramas para latencia, siempre.** Los percentiles no se promedian.
- **OpenTelemetry, no un SDK de proveedor** — instrumentás una vez, cambiás de
  backend después.
- **El propagador es lo primero que hay que hacer bien.** Sin propagación, no hay
  traces.
- **Escribí los SLOs y acordá la política de error budget por adelantado**, mientras
  nadie está enojado.
- **Alertá sobre síntomas**, con burn rates multi-ventana. Cada página tiene que ser
  accionable.
- **Instrumentá métricas de negocio también.** Un servicio sano que dejó de hacer su
  trabajo sigue estando roto.
- **Excluí los health checks de los logs.** Son la mayoría de tu volumen.

---

## Battle drill

<details>
<summary><b>1.</b> Tu factura de monitoreo supera tu factura de cómputo. ¿Qué pasó?</summary>

Casi seguro **cardinalidad**, después **volumen de logs**.

Cardinalidad: un label con valores sin límite — id de usuario, id de request, path
completo de URL, mensaje de error crudo, o un `customer_name`. Cada combinación única
es una serie separada almacenada e indexada. Un mal label en una métrica con tráfico
produce millones.

Encontralo: la mayoría de los sistemas expone una vista de "top métricas por cantidad
de series". En Prometheus, `topk(20, count by (__name__)({__name__=~".+"}))`.

Volumen de logs: logging de debug en producción, requests de health check logueados
(a menudo 90% de las líneas y 0% del valor), o bodies completos de request/response.

Soluciones: agrupá los labels de alta cardinalidad; mové ese detalle a logs y traces
donde pertenece; muestreá los traces; excluí los health checks; y configurá la
retención a propósito — 30 días de logs calientes más archivo barato normalmente es
lo correcto, no 400 días calientes.
</details>

<details>
<summary><b>2.</b> ¿Por qué no podés promediar los p99 de diez instancias?</summary>

Los percentiles no son lineales. Promediar diez valores de p99 te da un número sin
significado estadístico — no es el p99 de la población combinada, y puede estar
salvajemente errado en cualquier dirección.

Concretamente: nueve instancias ociosas con p99 = 10 ms y una saturada con
p99 = 5.000 ms. El promedio es 509 ms. El p99 combinado verdadero depende enteramente
de la distribución del tráfico y podría ser 10 ms (si la instancia lenta casi no
recibe tráfico) o 5.000 ms (si recibe la mayoría).

La solución son los **histogramas**. Cada instancia reporta conteos de buckets; los
buckets se suman entre instancias; el percentil se computa desde el histograma
mergeado. Eso es exactamente lo que hace
`histogram_quantile(0.99, sum(rate(...)) by (le))`, y por qué el `by (le)` importa.

Esto generaliza: sumas, conteos, mínimos y máximos se mergean. Percentiles, medianas
y conteos distintos no — para esos necesitás sketches mergeables (histogramas,
t-digest, HLL).
</details>

<details>
<summary><b>3.</b> Diseñá SLOs para un servicio de checkout.</summary>

Empezá por los recorridos de usuario, no por los endpoints.

- **Disponibilidad de "colocar orden"**: 99,95% sin 5xx en 28 días (≈20 min de
  presupuesto). Más ajustado que navegar porque una falla acá es ingreso perdido y
  confianza perdida.
- **Latencia de "colocar orden"**: 99% bajo 2 s. Los usuarios toleran más latencia
  cuando se comprometieron a comprar que cuando están navegando.
- **Disponibilidad de "navegar catálogo"**: 99,9%, y debería degradar con gracia a un
  catálogo cacheado en vez de fallar.
- **Corrección**: 99,999% de los pagos exitosos resultan en exactamente una orden.
  Este importa más que los otros juntos, y es un SLI que la mayoría de los equipos
  nunca define.
- **Frescura**: 99% de las órdenes visibles en el historial dentro de 30 s (el camino
  asincrónico).

Notas para explicitar: medí desde la perspectiva del **usuario** (RUM del lado del
cliente o el load balancer, no tu handler); elegí objetivos distintos para recorridos
distintos en vez de un número para el servicio; y escribí la política de error budget
al lado, porque un SLO sin política es un número sobre el que nadie actúa.
</details>

<details>
<summary><b>4.</b> ¿Cuál de estas debería despertar a alguien a las 3 AM? CPU 90%, disco 75%, tasa de error 0,5%, p99 4 s, un pod reiniciándose.</summary>

- **CPU 90%** — no. Podría ser eficiencia. Alertá sobre el *síntoma* que causaría.
- **Disco 75%** — no, ticket. Paginá cuando el tiempo proyectado hasta llenarse sea
  de pocas horas, que es mucho más útil que un umbral estático.
- **Tasa de error 0,5%** — depende del SLO. Si el objetivo es 99,9%, entonces 0,5% es
  un burn rate de 5×; paginá si el burn multi-ventana lo confirma. Si el objetivo es
  99%, está dentro del presupuesto.
- **p99 4 s** — paginá si viola el SLO de latencia y es sostenido. Un pico no es una
  caída.
- **Un pod reiniciándose** — no. Eso es el sistema auto-curándose, que es para lo que
  está. Paginá ante reinicios *repetidos* (un crash loop) o pérdida de capacidad.

La regla unificadora: **paginá sobre síntomas visibles al usuario con una respuesta
accionable.** Todo lo demás es un ticket o un dashboard. Y cada página debería
linkear a un runbook — si no hay runbook, o lo escribís o bajás la alerta.
</details>

<details>
<summary><b>5.</b> Explicale los error budgets a un product manager que quiere 100% de uptime.</summary>

100% es imposible — las redes se particionan, los discos fallan, las regiones de nube
se caen, y tus dependencias tienen sus propios SLAs. Perseguirlo significa no
shippear nunca, porque todo cambio es un riesgo y la única forma de eliminar el
riesgo es congelar.

Así que la pregunta real es: **¿cuánta falta de confiabilidad no van a notar los
usuarios?** Normalmente eso es 99,9% — 40 minutos por mes — e ir a 99,99% (4 minutos)
típicamente significa multi-región, más guardia y entrega más lenta, a varias veces
el costo.

El error budget hace el trade-off concreto y *compartido*: 0,1% es un presupuesto que
acordamos gastar. Gastalo en shippear features rápido, y aceptamos algunas fallas.
Si sobra, shippeamos más agresivamente. Si se agota, paramos el trabajo de features
hasta que la confiabilidad se recupere.

Esa es la parte que lo hace funcionar: **es una regla acordada de antemano, no una
discusión durante un incidente.** Ingeniería deja de ser "el equipo que dice que no",
y producto obtiene una palanca que entiende. La conversación pasa a ser "¿qué features
valen el presupuesto?" en vez de "¿por qué no lo podés hacer perfecto?".
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| Los traces se parten en fragmentos | El propagador no está configurado, o un cliente no usa `otelhttp.NewTransport`. Cada salto tiene que extraer e inyectar. |
| `histogram_quantile` devuelve NaN | No hay datos en el rango, o te olvidaste `by (le)`. El label `le` es obligatorio. |
| Prometheus no puede scrapear | En macOS usá `host.docker.internal` más `extra_hosts`. Mirá `/targets` en la UI de Prometheus. |
| La cardinalidad de métricas explota | Un label con valores sin límite. `topk(20, count by (__name__)({__name__=~".+"}))`. |
| Los logs no se vinculan con los traces en GCP | El campo tiene que ser exactamente `logging.googleapis.com/trace` con el valor `projects/PROJECT/traces/TRACE_ID`. |
| Todo loguea en DEBUG en producción | `LOG_LEVEL` no configurado por entorno. Esta suele ser la línea más grande de la factura de logging. |

---

## Registralo

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

**Siguiente:** [Cápsula 26 · El Torneo del Poder — El capstone](../26-tournament-of-power-capstone/README.md)
