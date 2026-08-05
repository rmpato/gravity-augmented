# Cápsula 01 · Scouter — Tu primer servicio

> *Un scouter hace una sola cosa: lo apuntás a un peleador y te devuelve un
> número. Es una API de lectura con un requisito de latencia, y a Vegeta se le
> nota cuando está lenta.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 2 | 65 min | Cápsula 00 | Local |

---

## Por qué existe esta cápsula

Cada sistema distribuido de este repo está hecho de servicios. Si la *unidad* es
chota — config metida en el código, sin health checks, logs que no podés
consultar, un shutdown que corta requests en vuelo — entonces ninguna cantidad de
load balancing o caching te salva. La escala multiplica lo que ya tenés, incluidos
los problemas.

Así que antes de escalar nada, construimos un servicio bien. Cinco propiedades, y
son las mismas cinco tanto si el servicio atiende 10 requests por día como 10
millones:

1. La configuración viene del entorno
2. Falla rápido y ruidosamente ante config inválida
3. Reporta liveness y readiness por separado
4. Emite logs estructurados
5. Se apaga de forma limpia

---

## El concepto

### 1. Config del entorno (12-factor)

El mismo binario compilado tiene que correr en tu máquina, en CI, en staging y en
producción, **sin nada distinto salvo las variables de entorno**.

Por qué importa más de lo que parece: en el momento en que la config queda
horneada en el binario, "promové el artefacto que pasó los tests" se vuelve
imposible. Terminás recompilando por entorno, lo que significa que lo que
probaste no es lo que deployaste.

Regla práctica:

- **Tiene un default razonable** → `PORT`, `LOG_LEVEL`, timeouts.
- **Sin default, explotá si falta** → `DATABASE_URL`, credenciales, cualquier
  cosa cuya ausencia signifique hacer silenciosamente algo incorrecto.

### 2. Fallá rápido

Un servicio que bootea sin la URL de su base de datos y después tira 500 en el
primer request real convirtió un typo de configuración en un incidente de
producción, diez minutos después, en otra parte del stack. Validá todo al
arrancar y salí con código distinto de cero. Los sistemas de deploy entienden un
proceso que se niega a arrancar; no entienden un proceso que está calladamente
inservible.

### 3. Liveness ≠ readiness

Esta distinción causa caídas reales cuando la gente se la lleva puesta.

```
/healthz   LIVENESS   "¿este proceso está colgado?"
           Respondé desde memoria. Devolvé 200 salvo que seas irrecuperable.
           NUNCA chequees la base de datos acá.

/readyz    READINESS  "¿debería recibir tráfico ahora mismo?"
           Chequeá dependencias. Fallar = te sacan del pool del LB, no te matan.
```

**El modo de falla:** ponés un ping a la base de datos en `/healthz`. La base
tiene un parpadeo de 30 segundos. Todas las réplicas fallan liveness al mismo
tiempo. El orquestador las mata a todas de una. Ahora tenés cero réplicas y una
estampida de cold starts contra una base que estaba por recuperarse. Una
degradación se volvió una caída, y tu health check la causó.

### 4. Logs estructurados

```go
log.Printf("user %s did %s", id, action)      // ✗ necesitás una regex para consultarlo
slog.Info("reading recorded", "fighter", id)  // ✓ un campo por el que filtrar
```

Cloud Logging, Loki, Datadog y cualquier otro sistema de logs indexan campos, no
prosa. `severity>=ERROR AND fighter_id="vegeta"` solo funciona si `fighter_id` es
un campo. El `log/slog` de la biblioteca estándar de Go te da esto con cero
dependencias.

Logueá **decisiones y resultados**, nunca secretos, tokens, emails ni bodies
completos.

### 5. Graceful shutdown

Cuando un deploy reemplaza tu container, la plataforma manda `SIGTERM`, espera y
después manda `SIGKILL`. Si ignorás `SIGTERM`, todos los requests en vuelo se
cortan — y en un servicio con tráfico, deployar significa una ráfaga de 502 cada
vez.

La secuencia correcta:

```
llega SIGTERM
  → empezá a fallar /readyz  (el LB deja de mandarte tráfico nuevo)
  → seguí sirviendo los requests en vuelo
  → esperá a que terminen, hasta un deadline
  → cerrá pools de DB, hacé flush de buffers
  → salí con 0
```

Ese primer paso es el que todos se olvidan. Hay una ventana — normalmente de 5 a
15 segundos — donde el load balancer todavía te cree sano. Fallá readiness
*primero*, después drenás.

---

## Lab — construí el Scouter

En `~/repos/pato/gravity-chamber`.

### Paso 1 — el dominio

**`internal/scouter/store.go`**

```go
package scouter

import (
	"sort"
	"sync"
	"time"
)

// Reading is one power-level measurement of one fighter.
type Reading struct {
	Fighter    string    `json:"fighter"`
	Power      int64     `json:"power"`
	RecordedAt time.Time `json:"recorded_at"`
}

// MemStore is an in-memory store. It is deliberately the wrong answer:
// it dies with the process and cannot be shared between replicas.
// Capsule 06 will make that hurt, and Capsule 10 will fix it.
type MemStore struct {
	mu      sync.RWMutex
	byFight map[string][]Reading
}

func NewMemStore() *MemStore {
	return &MemStore{byFight: make(map[string][]Reading)}
}

func (s *MemStore) Record(r Reading) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byFight[r.Fighter] = append(s.byFight[r.Fighter], r)
}

func (s *MemStore) Latest(fighter string) (Reading, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rs := s.byFight[fighter]
	if len(rs) == 0 {
		return Reading{}, false
	}
	return rs[len(rs)-1], true
}

// Leaderboard returns the top n fighters by their most recent reading.
func (s *MemStore) Leaderboard(n int) []Reading {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]Reading, 0, len(s.byFight))
	for _, rs := range s.byFight {
		out = append(out, rs[len(rs)-1])
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Power > out[j].Power })
	if len(out) > n {
		out = out[:n]
	}
	return out
}
```

> **Fijate en el mutex.** El servidor HTTP de Go maneja cada request en su propia
> goroutine, así que un map pelado tendría un race. Cuando corras `make test` con
> `-race` más adelante, vas a ver que el detector lo agarra si sacás el lock. Este
> es tu primer encuentro con lo que hace difícil la concurrencia: estado mutable
> compartido.

### Paso 2 — la capa HTTP

**`internal/scouter/server.go`**

```go
package scouter

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"
)

type Server struct {
	store *MemStore
	log   *slog.Logger
	ready atomic.Bool // flipped false on shutdown so the LB drains us
}

func NewServer(store *MemStore, log *slog.Logger) *Server {
	s := &Server{store: store, log: log}
	s.ready.Store(true)
	return s
}

func (s *Server) NotReady() { s.ready.Store(false) }

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux() // Go 1.22+ mux: method + path params, no deps

	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /readyz", s.handleReadyz)
	mux.HandleFunc("POST /readings", s.handleRecord)
	mux.HandleFunc("GET /fighters/{name}", s.handleGetFighter)
	mux.HandleFunc("GET /leaderboard", s.handleLeaderboard)

	return s.withLogging(mux)
}

// --- middleware -------------------------------------------------------------

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(c int) {
	r.status = c
	r.ResponseWriter.WriteHeader(c)
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)

		// One structured line per request. This is the raw material for the
		// RED metrics (Rate, Errors, Duration) you build in Capsule 25.
		s.log.Info("http_request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// --- handlers ---------------------------------------------------------------

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	// Liveness: memory only. No dependency checks. Ever.
	writeJSON(w, http.StatusOK, map[string]string{"status": "alive"})
}

func (s *Server) handleReadyz(w http.ResponseWriter, _ *http.Request) {
	if !s.ready.Load() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "draining"})
		return
	}
	// From Capsule 10 this also pings the database.
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) handleRecord(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Fighter string `json:"fighter"`
		Power   int64  `json:"power"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if in.Fighter == "" || in.Power < 0 {
		writeErr(w, http.StatusBadRequest, "fighter required and power must be >= 0")
		return
	}

	rd := Reading{Fighter: in.Fighter, Power: in.Power, RecordedAt: time.Now().UTC()}
	s.store.Record(rd)

	if in.Power > 9000 {
		s.log.Warn("power level exceeds scouter range", "fighter", in.Fighter, "power", in.Power)
	}
	writeJSON(w, http.StatusCreated, rd)
}

func (s *Server) handleGetFighter(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	rd, ok := s.store.Latest(name)
	if !ok {
		writeErr(w, http.StatusNotFound, "no readings for "+name)
		return
	}
	writeJSON(w, http.StatusOK, rd)
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	writeJSON(w, http.StatusOK, s.store.Leaderboard(limit))
}

// --- helpers ----------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
```

### Paso 3 — config y cableado

**`internal/scouter/config.go`**

```go
package scouter

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port            string
	LogLevel        string
	ShutdownTimeout time.Duration
	DrainDelay      time.Duration
}

// LoadConfig reads config from the environment. Defaults are for values that
// have a safe one; anything unsafe to guess must return an error instead.
func LoadConfig() (Config, error) {
	c := Config{
		Port:            env("PORT", "8080"),
		LogLevel:        env("LOG_LEVEL", "info"),
		ShutdownTimeout: envDur("SHUTDOWN_TIMEOUT", 15*time.Second),
		DrainDelay:      envDur("DRAIN_DELAY", 2*time.Second),
	}
	if _, err := strconv.Atoi(c.Port); err != nil {
		return c, fmt.Errorf("PORT %q is not a number", c.Port)
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envDur(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
```

**`cmd/scouter/main.go`**

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/<your-username>/gravity-chamber/internal/scouter"
)

func main() {
	cfg, err := scouter.LoadConfig()
	if err != nil {
		// Fail fast, loudly, non-zero. The deploy system understands this.
		slog.Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	level := slog.LevelInfo
	if cfg.LogLevel == "debug" {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))

	srv := scouter.NewServer(scouter.NewMemStore(), log)

	httpSrv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: srv.Routes(),
		// Never run a public server without these. A client that opens a
		// connection and sends nothing will otherwise hold a slot forever
		// (this is a real, named attack: Slowloris).
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Trap SIGTERM (what orchestrators send) and SIGINT (Ctrl-C).
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	go func() {
		log.Info("scouter online", "port", cfg.Port)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()

	// 1. Fail readiness FIRST so the load balancer stops sending new traffic.
	log.Info("shutdown signal received, draining")
	srv.NotReady()
	time.Sleep(cfg.DrainDelay) // give the LB a health-check interval to notice

	// 2. Then stop accepting and let in-flight requests finish.
	shutCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := httpSrv.Shutdown(shutCtx); err != nil {
		log.Error("graceful shutdown failed, forcing close", "err", err)
		_ = httpSrv.Close()
	}
	log.Info("scouter offline")
}
```

Reemplazá `<your-username>` con lo que hayas usado en `go mod init`.

### Paso 4 — un test

**`internal/scouter/server_test.go`**

```go
package scouter

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestServer() http.Handler {
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	return NewServer(NewMemStore(), log).Routes()
}

func TestRecordThenRead(t *testing.T) {
	h := newTestServer()

	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"fighter":"goku","power":9001}`)
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/readings", body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("record: got %d want 201: %s", rec.Code, rec.Body)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/fighters/goku", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("read: got %d want 200", rec.Code)
	}
	var got Reading
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Power != 9001 {
		t.Errorf("power = %d, want 9001", got.Power)
	}
}

func TestRejectsBadInput(t *testing.T) {
	h := newTestServer()
	for name, body := range map[string]string{
		"empty fighter": `{"fighter":"","power":100}`,
		"negative":      `{"fighter":"krillin","power":-1}`,
		"not json":      `hello`,
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest("POST", "/readings", strings.NewReader(body)))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("got %d, want 400", rec.Code)
			}
		})
	}
}

func TestLivenessIgnoresDependencies(t *testing.T) {
	// Liveness must answer from memory. If this ever needs a database
	// running to pass, the check is wrong.
	rec := httptest.NewRecorder()
	newTestServer().ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d, want 200", rec.Code)
	}
}
```

### Paso 5 — corrélo

```bash
make fmt
make test
make run
```

En un segundo panel:

```bash
curl -s localhost:8080/healthz | jq
curl -s localhost:8080/readyz  | jq

curl -s -XPOST localhost:8080/readings -d '{"fighter":"raditz","power":1500}'   | jq
curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}'     | jq
curl -s -XPOST localhost:8080/readings -d '{"fighter":"krillin","power":1770}'  | jq

curl -s localhost:8080/fighters/goku | jq
curl -s localhost:8080/leaderboard   | jq
```

Mirá el primer panel — una línea de log JSON por request, más un `WARN` cuando la
lectura de Goku pasa los 9000.

### Paso 6 — rompelo a propósito

**Validación de config:**
```bash
PORT=over9000 make run     # tiene que salir con 1 al instante y un error claro
```

**Graceful shutdown.** Agregá temporalmente un endpoint lento a `Routes()`:

```go
mux.HandleFunc("GET /slow", func(w http.ResponseWriter, r *http.Request) {
	time.Sleep(5 * time.Second)
	w.Write([]byte("finished\n"))
})
```

Después:

```bash
make run
# panel 2:
curl localhost:8080/slow &
# panel 1: apretá Ctrl-C enseguida
```

El request **termina**. Los logs muestran `draining` → `scouter offline`. Ahora
comentá `httpSrv.Shutdown(...)` y reemplazalo por `httpSrv.Close()`, y repetí —
el curl muere en pleno vuelo. Esa diferencia es la diferencia entre un deploy
limpio y una ráfaga de 502 en tu dashboard de errores cada vez que shippeás.

Volvé a poner el `Shutdown` y sacá `/slow`.

---

## En GCP

Construiste algo que Cloud Run puede hostear casi sin cambios, porque ya cumple
el contrato:

| Lo que pide Cloud Run | Lo que hiciste |
|---|---|
| Escuchar en `$PORT` | `env("PORT", "8080")` |
| Escuchar en `0.0.0.0`, no en `127.0.0.1` | `Addr: ":" + port` bindea todas las interfaces |
| Stateless — cualquier instancia sirve cualquier request | …todavía no. Ese es el problema de la Cápsula 06 |
| Manejar `SIGTERM` en menos de 10 s | graceful shutdown, presupuesto de 15 s |
| Loguear JSON a stdout | `slog.NewJSONHandler(os.Stdout, …)` |

Esto último tiene un bonus: Cloud Logging parsea el JSON de stdout
automáticamente y promueve tus campos a estructura consultable. Si usás la clave
`severity` (en vez del `level` por defecto de slog), además colorea y filtra bien
en la consola — un ajuste chico que vas a hacer en la Cápsula 25.

El deploy en sí espera hasta la Cápsula 04.

---

## Llevátelo al trabajo

- **`/healthz` nunca toca la base de datos.** Decilo en code review. Previene una
  caída específica, común y auto-infligida.
- **Fallá readiness antes de drenar.** El hueco entre "el LB te marca insano" y
  "dejás de aceptar" es donde viven los 502.
- **`ReadHeaderTimeout` en todo `http.Server`.** El valor cero de Go es *sin
  timeout*, que es un vector de Slowloris documentado. Los linters lo marcan
  (`gosec` G112) por algo.
- **`http.MaxBytesReader` en todo body de request.** Sin eso, un cliente puede
  postear 4 GB y hacerte OOM.
- **Una línea de log estructurado por request** con método, path, status y
  duración. Son cinco minutos de trabajo y es la columna vertebral de cada sesión
  de debugging que vayas a tener.

---

## Battle drill

<details>
<summary><b>1.</b> Tu <code>/healthz</code> pinguea Postgres. Postgres parpadea 30 segundos. Contá qué pasa.</summary>

Todas las réplicas fallan liveness en el mismo momento → el orquestador las
reinicia todas a la vez → cero capacidad → todas hacen cold start juntas y abren
conexiones al mismo tiempo → la base de datos, que se estaba recuperando, ahora
recibe una tormenta de conexiones → la caída se extiende mucho más allá del
parpadeo original.

El health check convirtió una degradación de 30 segundos en una caída de varios
minutos. Los chequeos de dependencias van en **readiness**, donde fallar significa
"no me mandes tráfico" en vez de "matame".
</details>

<details>
<summary><b>2.</b> ¿Por qué <code>PORT</code> tiene default y <code>DATABASE_URL</code> no debe tenerlo?</summary>

Un puerto equivocado falla de inmediato y de forma visible — nada se puede
conectar. Una URL de base de datos con default falla *de forma invisible y
peligrosa*: puede apuntar en silencio a localhost, o al entorno equivocado.

Poné default solo donde una respuesta equivocada sea ruidosa. Donde sea callada,
negate a arrancar.
</details>

<details>
<summary><b>3.</b> Sacás el mutex de <code>MemStore</code>. Los tests siguen pasando. ¿Por qué sigue siendo un bug?</summary>

Los data races son no deterministas — un test de un solo hilo no dispara ninguno.
`go test -race` instrumenta los accesos a memoria y lo agarra, que es por qué
`-race` está en el target `test` del Makefile.

En producción, las escrituras concurrentes a un map en Go no solo corrompen datos;
el runtime las detecta y *panickea el proceso entero*:
`fatal error: concurrent map writes`. Es irrecuperable.
</details>

<details>
<summary><b>4.</b> ¿Qué se rompe si corrés tres copias de este servicio detrás de un load balancer?</summary>

Cada una tiene su propio `MemStore`. Una lectura escrita en la réplica A es
invisible para B y C, así que `/fighters/goku` devuelve respuestas distintas según
a qué réplica le pegues, y `/leaderboard` está mal en las tres.

El servicio es **stateful**, así que no puede escalar horizontalmente.

Ese es exactamente el muro contra el que te lleva la Cápsula 06, y la razón por la
que la Cápsula 10 introduce una base de datos.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `undefined: slog` | Go < 1.21. Actualizá. |
| `pattern "GET /readings" ... invalid` | Go < 1.22. Los patterns con método requieren 1.22+. |
| `package github.com/… is not in std` | El import path no coincide con `go mod init`. Mirá `head -1 go.mod`. |
| `address already in use` | Algo está en el 8080. `lsof -i :8080` y matalo, o `PORT=8081 make run`. |
| `curl: (52) empty reply` | El servidor crasheó. Mirá el panic en el panel 1. |
| Los logs son prosa, no JSON | Usaste `log.Printf`. Usá el `slog.Logger` inyectado. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(scouter): http service with health checks and graceful shutdown

Capsule 01. Env config with fail-fast validation, separate liveness and
readiness, JSON structured logs, drain-before-shutdown, server timeouts."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 01
```

**Siguiente:** [Cápsula 02 · Cápsula #9 — Containers](../02-capsule-9-containers/README.md)
