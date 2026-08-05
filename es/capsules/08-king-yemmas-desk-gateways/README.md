# Cápsula 08 · El escritorio de Enma Daio — Proxies, gateways y el borde

> *Toda alma que muere pasa por un escritorio. Enma Daio verifica quién sos, mira
> qué hiciste, y te rutea: Cielo, Infierno, o el Camino de la Serpiente hasta
> Kaio-sama. No pelea con nadie. No juzga los méritos de tu técnica. Verifica,
> decide y rutea — y nada lo esquiva.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 6 | 85 min | Cápsula 07 | Local + concepto |

---

## Por qué existe esta cápsula

Un load balancer responde "¿**cuál** instancia?". Un gateway responde
"¿**debería existir este request, y qué forma tiene que tener antes de que lo
vean mis servicios?**".

La distinción importa porque hay un conjunto de preocupaciones que, si no, cada
servicio implementaría por separado y de forma inconsistente: autenticación, rate
limiting, TLS, request IDs, CORS, versionado de API, cuotas. Hacer eso N veces es
cómo terminás con un servicio que valida tokens bien y cuatro que no.

Esta cápsula también es donde viven muchas preguntas de entrevista. "¿Dónde
pondrías la autenticación?" y "¿API gateway o service mesh?" son estándar, y la
buena respuesta requiere saber para qué es cada capa.

---

## El concepto

### Forward proxy vs reverse proxy

La misma maquinaria, dirección opuesta, propósito completamente distinto.

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

Todo lo demás en esta cápsula es un reverse proxy con más opiniones.

### La torta de capas

Estas se confunden constantemente. Son trabajos distintos, y un solo producto a
menudo hace varios:

| Capa | Pregunta que responde | Implementación típica |
|---|---|---|
| **Load balancer** | ¿qué instancia sana? | GCLB, upstream de nginx |
| **Reverse proxy** | ¿cómo reenvío y remodelo esto? | nginx, Envoy, Caddy |
| **API gateway** | ¿este que llama tiene permiso, está dentro de cuota, y dónde vive esta API? | Apigee, GCP API Gateway, Kong |
| **Service mesh** | ¿cómo hablan los servicios *entre sí* de forma segura? | Istio, Linkerd, Cloud Service Mesh |
| **BFF** | ¿qué forma necesita *este* cliente? | tu propio servicio (Cápsula 23) |

**Norte-sur vs este-oeste** es el vocabulario que hace que esto encaje:

- **Norte-sur** = tráfico que entra y sale de tu sistema. Territorio del gateway.
- **Este-oeste** = tráfico entre servicios, adentro. Territorio del mesh.

### Qué hace realmente un API gateway

Preocupaciones que son genuinamente transversales, así que centralizarlas está
bien:

- **Terminación TLS** y gestión de certificados
- **Autenticación** — verificar el JWT / API key / certificado mTLS *una vez*,
  rechazar temprano
- **Rate limiting y cuotas** — por API key, por tenant, por plan
- **Ruteo** — por path, host, header o versión de API
- **Transformación de request/response** — traducción de protocolo (REST↔gRPC),
  inyección/eliminación de headers
- **Observabilidad** — un solo lugar donde cada request se loguea con un ID de
  correlación
- **Validación de schema** — rechazar requests malformados antes de que lleguen a
  un servicio
- **API keys, portales de desarrolladores, monetización** — el lado "producto" de
  las APIs

**Y qué NO debe hacer.** El modo de falla tiene nombre: el gateway se convierte en
el centro de control de un monolito distribuido. Síntomas:

- Lógica de negocio en la configuración del gateway (rutear según el *body* del
  request)
- Agregación de respuestas de varios servicios (eso es un BFF — Cápsula 23 — y va
  en código que podés testear)
- Contención entre equipos por deployar un archivo de configuración compartido
- Lógica expresada en Lua/Rego/YAML que nadie puede testear ni debuggear

**Regla práctica: el gateway puede inspeccionar y rechazar. No debería computar.**

### Autenticación: ¿en el borde, en el servicio, o en los dos?

La pregunta de diseño más común de esta capa.

```
   Client ──► Gateway ──────────────────► Service
              validates JWT signature      trusts the gateway?
              rejects invalid/expired      re-validates?
              injects X-User-Id
```

**Terminar en el borde** — el gateway valida y pasa la identidad aguas abajo en un
header. Rápido, simple, una sola implementación. Pero significa que **cualquier
cosa que pueda alcanzar un servicio puede hacerse pasar por cualquiera**, así que
exige aislamiento de red real (servicios internos, mTLS, o invocación
autorizada).

**Validar en cada servicio** — cada servicio verifica el token él mismo. Defensa
en profundidad; sin confianza implícita. Cuesta un poco de CPU y requiere que cada
servicio tenga las claves JWKS y haga bien la validación.

**La respuesta madura son las dos, con trabajos distintos:** el gateway hace
**autenticación** (quién sos — rechazar anónimos y malformados temprano), cada
servicio hace **autorización** (¿puede *este* usuario hacer *esto* sobre *este*
recurso — que es algo que solo el servicio sabe). Las arquitecturas zero-trust
además mantienen verificación de identidad de servicio vía mTLS del mesh.

Más sobre tokens y OIDC en el
[Arco de Relleno B3](../bonus/B3-fortuneteller-baba-auth/README.md).

### TLS: terminar, passthrough o re-cifrar

| Modo | Qué pasa | Usalo cuando |
|---|---|---|
| **Terminación** | el proxy descifra, reenvía texto plano | dentro de una VPC confiable; lo más simple, y deja que el proxy lea HTTP |
| **Re-cifrado** | el proxy descifra, inspecciona, re-cifra hacia el backend | necesitás features L7 *y* cifrado en tránsito. La respuesta común de compliance |
| **Passthrough** | el proxy nunca descifra (solo L4) | el cifrado punta a punta es obligatorio. Perdés todas las features L7 |

No podés tener a la vez "el proxy rutea por path de URL" y "el proxy no puede leer
el tráfico". Ese trade-off vale la pena poder enunciarlo en voz alta.

### Sidecars y service mesh

Un **sidecar** es un proxy en el mismo pod/host que tu servicio, interceptando
todo su tráfico. Un **service mesh** es una flota de sidecars más un control plane
que los configura.

Lo que eso te compra, sin tocar el código de la aplicación: mTLS automático entre
todos los servicios, reintentos y timeouts, circuit breaking, traffic splitting
para canaries, y métricas y traces por salto.

Lo que cuesta: complejidad operativa real, un salto de red extra y unos pocos ms
de latencia por llamada, memoria de sidecar por pod, y un control plane que
mantener y actualizar.

**Cuándo vale la pena:** decenas de servicios, varios equipos, un requisito duro
de mTLS, o una necesidad genuina de política de tráfico uniforme. **Cuándo no:**
cinco servicios y un equipo — vas a conseguir el 80% del valor con una librería de
cliente HTTP compartida con timeouts y reintentos sensatos, al 5% del costo.

> "Deberíamos agregar un service mesh" es una respuesta que suena plausible y que
> está mal más seguido de lo que está bien. Preguntá qué problema específico
> resuelve que una librería no pueda.

---

## Lab — construí un gateway

Vas a escribir un reverse proxy real en Go. Son ~150 líneas y desmitifica la
categoría entera: nginx y Envoy hacen esto, más rápido y con más features.

### Paso 1 — el gateway

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

### Paso 2 — el binario

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

### Paso 3 — corrélo y sondealo

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

Deberías ver los `200` convertirse en `429`. Fijate que `mobile` sigue teniendo su
propio presupuesto — el limitador indexa por quien llama, no por endpoint.

> ### ⏸ Punto natural para cortar
>
> Todo lo de arriba se sostiene solo — commiteálo y volvé después. Los pasos que
> siguen construyen sobre eso pero no dejan nada inestable si parás acá. Dos
> sesiones de 45 minutos le ganan a una de 90 que no terminás.

### Paso 4 — probá que la credencial nunca llega al backend

Agregá una línea de debug temporal en el middleware de logging del scouter:

```go
		s.log.Info("http_request",
			"method", r.Method,
			"path", r.URL.Path,
			"api_key_seen", r.Header.Get("X-Api-Key"),   // should always be empty
			"caller", r.Header.Get("X-Caller"),          // set by the gateway
			"request_id", r.Header.Get("X-Request-Id"),
			…
```

Volvé a correr. `api_key_seen` está vacío y `caller` está poblado. **El backend se
entera de la identidad sin jamás manipular una credencial** — ese es el punto
entero de terminar la auth en el borde, y sacar el header es la parte que la gente
se olvida.

### Paso 5 — la pregunta de la confianza, hecha concreta

```bash
# bypass the gateway entirely
curl -s -H 'X-Caller: king-kai-himself' localhost:8080/leaderboard | jq
```

Acabás de hacerte pasar por un caller arbitrario hablándole directo al backend.

**Este es el riesgo central de la auth terminada en el borde**, y por eso la
mitigación es *aislamiento de red*, no astucia con headers. En producción el
backend estaría:

- En Cloud Run con `--no-allow-unauthenticated`, así que solo la service account
  del gateway lo puede invocar
- o en una VPC solo-interna sin IP pública
- o exigiendo mTLS, para que quien llama pruebe que es el gateway

Escribí en `NOTES.md`: *"La auth en el borde es tan fuerte como el aislamiento de
red que hay detrás."*

### Paso 6 — hacelo en nginx y compará

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

Más rápido y más corto. Pero: sin tests unitarios, sin debugger, comparación de
strings en vez de una búsqueda real de claves, y el `if` dentro de `location` en
nginx es
[famosamente traicionero](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html#if).

**Ese es el trade-off real** — los proxies manejados por configuración son rápidos
y operativamente maduros; los gateways manejados por código son testeables y
debuggeables. La mayoría de las organizaciones termina con un gateway gestionado
para las preocupaciones estándar y código de aplicación para todo lo específico.

---

## En GCP

> **Solo concepto** para los productos pagos. Leé el menú; sabé cuál agarrarías y
> por qué.

| Producto | Qué es | Usalo cuando |
|---|---|---|
| **URL maps de GCLB** | ruteo por path/host en el load balancer | solo necesitás ruteo + TLS. Casi gratis, ya está ahí |
| **Cloud Armor** | WAF + DDoS + reglas de IP/geo, enganchado a un backend service | endpoints públicos que necesitan protección. Reglas OWASP preconfiguradas |
| **IAP** (Identity-Aware Proxy) | auth con identidad de Google delante de cualquier backend, sin código | herramientas internas, paneles de admin. Excelente y poco usado |
| **API Gateway** | gateway gestionado desde una spec OpenAPI; API keys, validación de JWT | una API pública simple delante de Cloud Run/Functions |
| **Cloud Endpoints / ESPv2** | un proxy basado en Envoy que deployás vos | querés features de gateway pero dentro de tu propia infraestructura |
| **Apigee** | gestión completa de APIs: portal, monetización, analytics, políticas | vendés APIs como producto. Precio empresarial |
| **Cloud Service Mesh** | Istio gestionado para GKE | muchos servicios, mTLS en todos lados, política de tráfico uniforme |

Un stack por defecto pragmático para un equipo chico:

```
  Cloud Armor  →  GCLB (TLS + URL map)  →  Cloud Run services
                     ↑ Cloud CDN checkbox for cacheable GETs
```

Eso cubre TLS, DDoS, WAF, ruteo y CDN sin ningún producto de gateway. Agregás API
Gateway o Apigee cuando necesitás API keys, cuotas por plan, o un portal de
desarrolladores — o sea, cuando la API es un *producto*.

**IAP merece una mención específica:** ponelo delante de una herramienta interna y
tenés autenticación con cuenta de Google, autorización por grupos, y audit logs
sin nada de código de aplicación. Para dashboards de admin y entornos de staging
es lo de mayor valor por esfuerzo de toda esta tabla.

---

## Llevátelo al trabajo

- **Sacá las credenciales en el gateway.** El backend nunca debería recibir el
  token o la key cruda que no validó.
- **Generá un request ID en el borde**, propagalo aguas abajo, *y devolvéselo al
  cliente*. Es la herramienta de debugging más barata que existe.
- **Autenticá en el borde, autorizá en el servicio.** El gateway no puede saber si
  el usuario 42 puede editar el documento 7.
- **La auth en el borde requiere aislamiento de red.** Si no, es una sugerencia.
- **Mantené la lógica de negocio fuera de la configuración del gateway.** Si una
  regla de ruteo necesita el body del request, pertenece a un servicio.
- **Gana el prefijo más largo** para el matcheo de rutas. La precedencia ambigua
  de rutas es una fuente confiable de confusión a las 3 de la mañana.
- **No agarres un service mesh** hasta que puedas nombrar el problema que resuelve
  y que un cliente HTTP compartido no pueda.

---

## Battle drill

<details>
<summary><b>1.</b> ¿Gateway o load balancer — dónde ponés la autenticación, y qué asume eso?</summary>

Gateway. Es una decisión de política que requiere validación de tokens, búsqueda
de claves y posiblemente una llamada a un proveedor de identidad; un load balancer
L4 no puede leer lo suficiente del request, e incluso un LB L7 es el lugar
equivocado para política que cambia seguido.

La suposición que trae: **los backends no son directamente alcanzables.** Si
cualquiera puede hacerle curl al servicio y setear `X-User-Id`, la auth del borde
es decoración. Así que el diseño tiene que incluir servicios solo-internos,
invocación autorizada o mTLS.

La respuesta madura es por capas: autenticación en el borde (rechazar anónimos
temprano, una implementación), autorización en el servicio (solo él conoce las
reglas a nivel recurso), e identidad de servicio vía mTLS si tenés un mesh.
</details>

<details>
<summary><b>2.</b> La config de tu gateway creció a 3.000 líneas de ruteo con scripts en Lua. ¿Qué salió mal y qué hacés?</summary>

La lógica de negocio migró a la configuración de infraestructura. Los síntomas son
predecibles: nadie la puede testear, los cambios necesitan un especialista, los
equipos se pelean por un archivo, y "¿por qué falló este request?" requiere leer
Lua.

Recuperación: inventariá qué hace realmente la config y separá en (a) genuinamente
transversal — auth, rate limiting, TLS, CORS, request IDs — que se queda; y (b)
remodelado y agregación para clientes particulares, que se convierte en un
**servicio BFF** (Cápsula 23) con tests, debugger y un equipo dueño.

Después restringí el gateway por política: puede inspeccionar y rechazar, no puede
computar.
</details>

<details>
<summary><b>3.</b> ¿Cuándo vale un service mesh lo que cuesta?</summary>

Cuando podés nombrar el problema. Disparadores genuinos: mTLS obligatorio entre
todos los servicios por compliance; decenas de servicios en varios equipos donde
no lográs comportamiento consistente de timeouts/reintentos por convención de
librería; una necesidad real de traffic splitting y telemetría por salto uniformes
sin tocar código; servicios políglotas donde "usá nuestra librería de Go" no está
disponible.

Costos: un control plane que operar y actualizar, memoria de un sidecar por pod,
un salto extra (~1–3 ms) por llamada, y una historia de debugging genuinamente más
difícil — un error ahora puede venir de tu código, del sidecar local, del sidecar
remoto o del control plane.

Por debajo de ~10 servicios con un equipo, un cliente HTTP compartido con defaults
sensatos consigue casi todo el beneficio por casi nada del costo.
</details>

<details>
<summary><b>4.</b> Cliente → Gateway → Servicio A → Servicio B. Un usuario reporta un error. ¿Cómo lo encontrás?</summary>

El gateway genera `X-Request-Id`, se lo devuelve al cliente y lo reenvía. Cada
servicio lo loguea y lo propaga en sus llamadas salientes. Buscás el ID y tenés
cada línea de log de todo el camino del request.

Ese es el mínimo. La versión posta es **tracing distribuido** (Cápsula 25):
propagación de `traceparent` de W3C, así que tenés una cascada que muestra que el
Servicio B tardó 4 segundos y por qué, en vez de un montón de líneas de log que
tenés que ordenar vos.

El detalle crítico de implementación es la **propagación** — un solo servicio que
pierda el header rompe la cadena de ahí en adelante.
</details>

<details>
<summary><b>5.</b> ¿Por qué un proxy con TLS passthrough no puede rutear por path?</summary>

El path está adentro del payload cifrado. Un proxy passthrough opera en L4 y nunca
descifra, así que puede ver la conexión TCP y — vía SNI en el `ClientHello` de TLS
— el *hostname*, pero nunca la URL, los headers ni el body.

Así que passthrough te da ruteo por host en el mejor caso. Si necesitás ruteo por
path, por header, load balancing por request, compresión o caching, tenés que
terminar TLS. Si además el cifrado en tránsito es obligatorio hasta el backend,
terminá y **re-cifrá** — esa es la posición de compromiso, y es lo que corre la
mayoría de los entornos regulados.
</details>

<details>
<summary><b>6.</b> Tu rate limiter de ventana fija permite 100/min. Alguien manda 200 requests en un segundo. ¿Cómo?</summary>

El borde de la ventana. 100 requests a las 11:59:59.5 caen en una ventana; 100 más
a las 12:00:00.5 caen en la siguiente. Los dos están "dentro del límite", y tu
backend vio 200 requests en un segundo — una ráfaga de 2× sobre la tasa
pretendida.

Soluciones: un **sliding window log** (exacto, come memoria), un **sliding window
counter** (mezcla ponderada de la ventana actual y la anterior — la opción de
producción habitual), o un **token bucket**, que permite una ráfaga *acotada* por
diseño y generalmente es lo que querés.

La Cápsula 17 implementa un token bucket bien hecho.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| El gateway devuelve 502 en todo | `SCOUTER_URL` está mal, o el backend no está corriendo. Mirá la línea de log `upstream failure` — nombra el target. |
| El backend ve el path original con el prefijo | `Strip: true` tiene que estar en la ruta, y el matcheo es por prefijo más largo. |
| Falta `X-Request-Id` en la respuesta | El middleware tiene que setearlo en `w.Header()` *antes* de que el handler escriba nada. No se pueden setear headers después de empezar el body. |
| El rate limiter nunca se dispara | Indexa por `X-Caller`, que solo se setea en rutas no públicas. `/healthz` es pública y sin límite por diseño. |
| Todo devuelve 401 | El formato de `API_KEYS` es `key:nombre,key2:nombre2`. Sin espacios. |
| Los WebSockets fallan a través del proxy | `httputil.ReverseProxy` maneja upgrades, pero tu `WriteTimeout` va a matar las conexiones de larga vida. Ponelo en 0 para esas rutas. |

---

## Registralo

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

**Siguiente:** [Cápsula 09 · La Habitación del Tiempo — Load testing y capacidad](../09-hyperbolic-time-chamber-load-testing/README.md)
