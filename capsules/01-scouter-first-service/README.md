# Capsule 01 · Scouter — Your First Service

> *A scouter does one job: point it at a fighter, get a number back. It's a
> read API with a latency requirement, and Vegeta gets visibly annoyed when
> it's slow.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 2 | 65 min | Capsule 00 | Local |

---

## Why this capsule exists

Every distributed system in this repo is made of services. If the *unit* is
sloppy — config baked in, no health checks, logs you can't query, a shutdown
that drops in-flight requests — then no amount of load balancing or caching
saves you. Scale multiplies whatever you already have, including the problems.

So before we scale anything, we build one service properly. Five properties,
and they are the same five whether the thing serves 10 requests a day or 10
million:

1. Configuration comes from the environment
2. It fails fast and loudly on bad config
3. It reports liveness and readiness separately
4. It emits structured logs
5. It shuts down gracefully

---

## The concept

### 1. Config from the environment (12-factor)

The same compiled binary must run on your laptop, in CI, in staging and in
production, with **nothing different but environment variables**.

Why this matters more than it sounds: the moment config is baked into the
binary, "promote the artifact that passed testing" becomes impossible. You end
up rebuilding per environment, which means the thing you tested is not the thing
you shipped.

Rule of thumb:

- **Has a sane default** → `PORT`, `LOG_LEVEL`, timeouts.
- **No default, crash if missing** → `DATABASE_URL`, credentials, anything whose
  absence means you'd silently do the wrong thing.

### 2. Fail fast

A service that boots without its database URL and then 500s on the first real
request has converted a config typo into a production incident, ten minutes
later, in a different part of the stack. Validate everything at startup and
exit non-zero. Deploy systems understand a process that refuses to start; they
do not understand a process that is quietly useless.

### 3. Liveness ≠ readiness

This distinction causes real outages when people get it wrong.

```
/healthz   LIVENESS   "is this process wedged?"
           Answer from memory. Return 200 unless you are unrecoverable.
           NEVER check the database here.

/readyz    READINESS  "should I get traffic right now?"
           Check dependencies. Failing = pulled from the LB pool, not killed.
```

**The failure mode:** you put a database ping in `/healthz`. The database has a
30-second blip. Every replica fails liveness simultaneously. The orchestrator
kills them all at once. Now you have zero replicas and a cold-start stampede
against a database that was about to recover. A degradation became an outage,
and your health check caused it.

### 4. Structured logs

```go
log.Printf("user %s did %s", id, action)      // ✗ needs a regex to query
slog.Info("reading recorded", "fighter", id)  // ✓ a field you can filter on
```

Cloud Logging, Loki, Datadog and every other log system indexes fields, not
prose. `severity>=ERROR AND fighter_id="vegeta"` only works if `fighter_id` is a
field. Go's standard `log/slog` gives you this with zero dependencies.

Log **decisions and outcomes**, never secrets, tokens, emails or full bodies.

### 5. Graceful shutdown

When a deploy replaces your container, the platform sends `SIGTERM`, waits, then
sends `SIGKILL`. If you ignore `SIGTERM`, every in-flight request is severed —
and on a busy service, deploying means a burst of 502s every time.

The correct sequence:

```
SIGTERM received
  → start failing /readyz  (LB stops sending new traffic)
  → keep serving in-flight requests
  → wait for them to finish, up to a deadline
  → close DB pools, flush buffers
  → exit 0
```

That first step is the one everyone forgets. There is a window — often 5–15
seconds — where the load balancer still thinks you're healthy. Fail readiness
*first*, then drain.

---

## Lab — build the Scouter

In `~/repos/pato/gravity-chamber`.

### Step 1 — the domain

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

> **Note the mutex.** Go's HTTP server handles every request in its own
> goroutine, so a plain map would race. Run `make test` later with `-race` and
> you'll see the detector catch it if you remove the lock. This is your first
> encounter with the thing that makes concurrency hard: shared mutable state.

### Step 2 — the HTTP layer

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

### Step 3 — config and wiring

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

Replace `<your-username>` with whatever you used in `go mod init`.

### Step 4 — a test

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

### Step 5 — run it

```bash
make fmt
make test
make run
```

In a second pane:

```bash
curl -s localhost:8080/healthz | jq
curl -s localhost:8080/readyz  | jq

curl -s -XPOST localhost:8080/readings -d '{"fighter":"raditz","power":1500}'   | jq
curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}'     | jq
curl -s -XPOST localhost:8080/readings -d '{"fighter":"krillin","power":1770}'  | jq

curl -s localhost:8080/fighters/goku | jq
curl -s localhost:8080/leaderboard   | jq
```

Watch the first pane — one JSON log line per request, plus a `WARN` when Goku's
reading blows past 9000.

### Step 6 — break it on purpose

**Config validation:**
```bash
PORT=over9000 make run     # should exit 1 immediately with a clear error
```

**Graceful shutdown.** Add a slow endpoint temporarily to `Routes()`:

```go
mux.HandleFunc("GET /slow", func(w http.ResponseWriter, r *http.Request) {
	time.Sleep(5 * time.Second)
	w.Write([]byte("finished\n"))
})
```

Then:

```bash
make run
# pane 2:
curl localhost:8080/slow &
# pane 1: press Ctrl-C immediately
```

The request **completes**. The logs show `draining` → `scouter offline`. Now
comment out `httpSrv.Shutdown(...)` and replace it with `httpSrv.Close()`, and
repeat — the curl dies mid-flight. That difference is the difference between a
clean deploy and a burst of 502s in your error dashboard every time you ship.

Put the `Shutdown` back and remove `/slow`.

---

## In GCP

You've built something Cloud Run can host almost unchanged, because it already
follows the contract:

| What Cloud Run requires | What you did |
|---|---|
| Listen on `$PORT` | `env("PORT", "8080")` |
| Listen on `0.0.0.0`, not `127.0.0.1` | `Addr: ":" + port` binds all interfaces |
| Stateless — any instance can serve any request | …not yet. That's Capsule 06's problem |
| Handle `SIGTERM` within 10s | graceful shutdown, 15s budget |
| Log JSON to stdout | `slog.NewJSONHandler(os.Stdout, …)` |

That last one has a bonus: Cloud Logging parses JSON on stdout automatically and
promotes your fields to queryable structure. If you use the key `severity`
(rather than slog's default `level`), it also colours and filters correctly in
the console — a small tweak you'll make in Capsule 25.

Deployment itself waits for Capsule 04.

---

## Bring it to work

- **`/healthz` never touches the database.** Say this in code review. It
  prevents a specific, common, self-inflicted outage.
- **Fail readiness before you drain.** The gap between "LB marks you unhealthy"
  and "you stop accepting" is where 502s live.
- **`ReadHeaderTimeout` on every `http.Server`.** Go's zero value is *no
  timeout*, which is a documented Slowloris vector. Linters flag it (`gosec`
  G112) for a reason.
- **`http.MaxBytesReader` on every request body.** Without it, one client can
  post a 4 GB body and OOM your process.
- **One structured log line per request** with method, path, status and
  duration. It's five minutes of work and it's the backbone of every debugging
  session you'll have.

---

## Battle drill

<details>
<summary><b>1.</b> Your <code>/healthz</code> pings Postgres. Postgres has a 30-second blip. Walk through what happens.</summary>

All replicas fail liveness at the same moment → the orchestrator restarts all of
them simultaneously → zero capacity → they all cold-start together and open
connections at once → the database, which was recovering, is now hammered by a
connection storm → the outage extends well past the original blip.

The health check turned a 30-second degradation into a multi-minute outage.
Dependency checks belong in **readiness**, where failing means "don't send me
traffic" rather than "kill me".
</details>

<details>
<summary><b>2.</b> Why does <code>PORT</code> get a default but <code>DATABASE_URL</code> must not?</summary>

A wrong port fails immediately and visibly — nothing can connect. A defaulted
database URL fails *invisibly and dangerously*: it might silently point at
localhost, or at the wrong environment. Default only where a wrong guess is
loud. Where a wrong guess is quiet, refuse to start.
</details>

<details>
<summary><b>3.</b> You remove the mutex from <code>MemStore</code>. Tests still pass. Why is this still a bug?</summary>

Data races are non-deterministic — a single-threaded test won't trigger one.
`go test -race` instruments memory access and catches it, which is why `-race`
is in the Makefile's `test` target. In production, concurrent map writes in Go
don't just corrupt data; the runtime detects them and *panics the whole
process*: `fatal error: concurrent map writes`. It is unrecoverable.
</details>

<details>
<summary><b>4.</b> What breaks if you run three copies of this service behind a load balancer?</summary>

Each has its own `MemStore`. A reading written to replica A is invisible to B
and C, so `/fighters/goku` returns different answers depending on which replica
you hit, and `/leaderboard` is wrong on all three. The service is **stateful**,
so it can't scale horizontally.

This is exactly the wall Capsule 06 walks you into, and the reason Capsule 10
introduces a database.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `undefined: slog` | Go < 1.21. Upgrade. |
| `pattern "GET /readings" ... invalid` | Go < 1.22. Method-prefixed patterns need 1.22+. |
| `package github.com/… is not in std` | Import path doesn't match `go mod init`. Check `head -1 go.mod`. |
| `address already in use` | Something's on 8080. `lsof -i :8080` then kill it, or `PORT=8081 make run`. |
| `curl: (52) empty reply` | Server crashed. Check pane 1 for the panic. |
| Logs are prose, not JSON | You used `log.Printf`. Use the injected `slog.Logger`. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(scouter): http service with health checks and graceful shutdown

Capsule 01. Env config with fail-fast validation, separate liveness and
readiness, JSON structured logs, drain-before-shutdown, server timeouts."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 01
```

**Next:** [Capsule 02 · Capsule #9 — Containers](../02-capsule-9-containers/README.md)
