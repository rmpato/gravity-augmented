# Cápsula 17 · Suprimir el ki — Rate limiting, timeouts y backpressure

> *Suprimir el ki es una técnica, no una debilidad. Los peleadores que transmiten
> a máxima potencia todo el tiempo son encontrados, se agotan y pierden. Los que
> sobreviven controlan su salida a propósito y eligen cuándo gastarla.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 8 | 90 min | Cápsulas 08–09, 14 · opcional [B5 concurrencia en Go](../bonus/B5-afterimage-go-concurrency/README.md) | Local |

---

## Por qué existe esta cápsula

Todo hasta acá hizo tu sistema más *rápido*. Esta cápsula lo hace **sobrevivir**.

Los sistemas normalmente no fallan por ir lento. Fallan **en cascada**: una
dependencia lenta agota un pool de conexiones, lo que pone lentos a los que la
llaman, lo que llena *sus* pools, lo que pone lentos a *sus* llamadores — hasta que
nada funciona y ningún componente está obviamente roto.

Cada mecanismo acá existe para cortar esa cadena. Si aprendés una sola cápsula de
este repo en serio para trabajo de producción, que sea esta.

---

## El concepto

### La primera regla: lento es peor que caído

Una dependencia que devuelve errores al instante está *bien* — fallás rápido,
devolvés un fallback, seguís. Una dependencia que tarda 30 segundos es
**catastrófica**, porque cada request esperando retiene una goroutine, una conexión
y memoria. Tus pools de recursos se llenan de cosas que están esperando, y te morís
de agotamiento sin hacer trabajo.

Por eso **los timeouts son la base** y todo lo demás se construye encima.

### Timeouts y propagación de deadlines

Cada llamada de red necesita un deadline, y tiene que ser *heredado*:

```
  client → gateway (5s) → service A (4s) → service B (2s) → database (1s)
                ▲
                │  each hop gets LESS than its caller.
                │  If A's budget is gone, it must not start a call to B.
```

En Go esto es `context.Context`, y es la razón por la que toda función que hace E/S
debería recibir uno como primer parámetro.

**El antipatrón:** un timeout fijo por servicio sin relación con el presupuesto del
que llama. El cliente se rindió hace 4 segundos y vos seguís consultando la base
por él. Eso es puro desperdicio, y bajo carga es el desperdicio que te mata.

### Reintentos: un multiplicador de carga, aplicado en el peor momento

Tres reglas, y violar cualquiera lo empeora:

**1. Backoff exponencial con full jitter.**

```
  no jitter:    1s, 2s, 4s, 8s   → every client retries in lockstep. Self-DDoS.
  full jitter:  rand(0,1), rand(0,2), rand(0,4)   → spread out
```

El análisis publicado de AWS encontró que el jitter *completo*
(`sleep = rand(0, base·2^n)`) le gana tanto al sin jitter como al "jitter parcial".
Usalo.

**2. Un presupuesto de reintentos.** Topeá los reintentos a un porcentaje del total
de requests (digamos 10%). Sin eso, un servicio con 50% de fallas duplica su propia
carga precisamente cuando está sufriendo — la **tormenta de reintentos** que
convierte una caída parcial en total.

**3. Reintentá solo lo que es seguro.** Operaciones idempotentes, o hechas
idempotentes con una clave (Cápsula 19). **Nunca reintentes un 4xx** — va a fallar
igual para siempre.

### Circuit breakers

Dejá de llamar a una dependencia que está claramente rota.

```
              failures > threshold
    CLOSED ──────────────────────────► OPEN
      ▲                                  │
      │                                  │ after a cooldown
      │   success                        ▼
      └──────────────────────── HALF-OPEN
                                (let a few through and see)
```

- **Cerrado** — normal; contás fallas.
- **Abierto** — fallás de inmediato sin llamar. Devolvés un fallback. Este es el
  punto: dejás de pagar el timeout en cada request.
- **Semi-abierto** — después de un enfriamiento, dejás pasar un hilito. Un éxito lo
  cierra; una falla lo vuelve a abrir.

El valor no es proteger a la dependencia (aunque ayuda). Es protegerte **a vos**:
un breaker abierto significa que dejás de retener miles de goroutines esperando algo
que no va a responder.

### Algoritmos de rate limiting

| Algoritmo | Comportamiento | Notas |
|---|---|---|
| **Ventana fija** | contás por minuto de reloj | simple; permite una **ráfaga de 2× en el borde** (Cápsula 08) |
| **Sliding window log** | timestamps de cada request | exacto, come memoria |
| **Sliding window counter** | mezcla ponderada de esta ventana y la anterior | la opción de producción habitual |
| **Token bucket** | los tokens se rellenan a tasa R, capacidad B | **permite una ráfaga controlada.** El mejor default general |
| **Leaky bucket** | tasa de salida fija, cola adelante | salida perfectamente pareja; agrega latencia |

**El token bucket normalmente es lo correcto** porque el tráfico real es irregular
y los usuarios esperan que una ráfaga corta funcione. `rate` fija el límite
sostenido; `burst` fija cuánta holgura permitís.

**Dónde aplicarlo:**

- **Por cliente/API key** — equidad. Evita que un tenant deje a todos sin nada.
- **Por endpoint** — protege los caminos caros específicamente.
- **Global** — protege el límite duro de una dependencia aguas abajo.

**El rate limiting distribuido es un problema real.** N réplicas limitando cada una
a 100/s significa que el límite efectivo es N×100. Opciones: dividir el límite por
la cantidad de réplicas (se rompe cuando las réplicas escalan); un contador
compartido en Redis (preciso, agrega un round trip); o aceptar la aproximación y
configurar el límite por réplica en consecuencia. La mayoría de los equipos usa
Redis para todo lo que tiene que ser exacto (facturación, cuotas) y límites locales
para protección gruesa.

### Backpressure y load shedding

Cuando no das abasto, tenés exactamente tres opciones:

1. **Encolar** — solo con límite. Una cola sin límite convierte un problema de
   throughput en un crash por falta de memoria, y cada request encolado es uno cuyo
   cliente ya se rindió.
2. **Descartar** — rechazá de inmediato con `429` o `503` + `Retry-After`. Fallar
   rápido le permite al cliente retroceder.
3. **Degradar** — devolvé una respuesta más barata. Cache viejo, menos resultados,
   sin personalización.

> **Descartar carga es una feature, no una admisión de derrota.** Un servicio al
> 100% de capacidad que sirve el 100% de lo que puede y rechaza el resto está
> *sano*. Un servicio que acepta todo y hace timeout en todo no sirve a nadie.

**El descarte priorizado** es la versión madura: descartá primero el tráfico de
fondo y los reintentos, conservá los requests interactivos de usuarios. El enfoque
de Google usa niveles de criticidad de request exactamente para esto.

### Bulkheads (mamparos)

Aislá recursos para que una falla no pueda consumirlo todo:

```
  ONE pool of 100 connections:
     the slow /reports endpoint takes all 100 → checkout is down too

  BULKHEADS: reports=20, checkout=50, admin=10, spare=20
     /reports saturates its 20 and stops. Checkout is unaffected.
```

Se llaman así por los compartimientos de un barco: inundá uno, el barco flota.
Aplica a pools de conexiones, thread pools, límites de goroutines y deploys
separados.

---

## Lab

### Paso 1 — un token bucket

La librería de extensiones estándar de Go tiene uno bueno.

```bash
go get golang.org/x/time/rate
```

**`internal/scouter/limit.go`**

```go
package scouter

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limiter holds one token bucket per caller.
//
// Token bucket rather than fixed window: real traffic is bursty, and a user
// who sends 5 requests in one second then nothing for a minute is behaving
// normally. Burst allows that; rate bounds the sustained load.
type Limiter struct {
	mu       sync.Mutex
	buckets  map[string]*entry
	rate     rate.Limit
	burst    int
	idleFor  time.Duration
}

type entry struct {
	lim  *rate.Limiter
	seen time.Time
}

func NewLimiter(perSecond float64, burst int) *Limiter {
	l := &Limiter{
		buckets: make(map[string]*entry),
		rate:    rate.Limit(perSecond),
		burst:   burst,
		idleFor: 10 * time.Minute,
	}
	go l.reap() // unbounded maps are memory leaks with extra steps
	return l
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	e, ok := l.buckets[key]
	if !ok {
		e = &entry{lim: rate.NewLimiter(l.rate, l.burst)}
		l.buckets[key] = e
	}
	e.seen = time.Now()
	l.mu.Unlock()
	return e.lim.Allow()
}

func (l *Limiter) reap() {
	t := time.NewTicker(time.Minute)
	for range t.C {
		cut := time.Now().Add(-l.idleFor)
		l.mu.Lock()
		for k, e := range l.buckets {
			if e.seen.Before(cut) {
				delete(l.buckets, k)
			}
		}
		l.mu.Unlock()
	}
}

// Middleware rejects over-limit callers with 429 and the headers clients
// need in order to back off correctly.
func (l *Limiter) Middleware(keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := keyFn(r)
			if !l.Allow(key) {
				// Telling the client HOW LONG to wait is what turns a 429 from
				// an error into a coordination mechanism.
				w.Header().Set("Retry-After", "1")
				w.Header().Set("X-RateLimit-Limit", strconv.Itoa(int(l.rate)))
				writeErr(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

Cableálo en `Routes()`:

```go
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	// … existing routes …

	limiter := NewLimiter(50, 100) // 50 rps sustained, burst of 100
	byIP := func(r *http.Request) string {
		if c := r.Header.Get("X-Caller"); c != "" { // set by the gateway (C08)
			return c
		}
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		return host
	}
	return s.withLogging(limiter.Middleware(byIP)(mux))
}
```

Probá el comportamiento de ráfaga, que es el punto entero de un token bucket:

```bash
make run

# 120 requests as fast as possible: ~100 pass (the burst), then ~50/s
for i in $(seq 1 120); do
  curl -s -o /dev/null -w "%{http_code} " localhost:8080/healthz
done; echo

sleep 2   # bucket refills

for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code} " localhost:8080/healthz
done; echo    # all 200 again
```

### Paso 2 — propagación de deadlines que podés ver

Agregá un endpoint que respete el deadline de quien lo llama:

```go
	mux.HandleFunc("GET /slow", func(w http.ResponseWriter, r *http.Request) {
		// r.Context() is cancelled when the CLIENT disconnects or its
		// deadline passes. Respecting it means we stop doing work nobody
		// is waiting for — which is most of what backpressure is.
		select {
		case <-time.After(3 * time.Second):
			writeJSON(w, http.StatusOK, map[string]string{"status": "finished"})
		case <-r.Context().Done():
			s.log.Warn("client went away, abandoning work",
				"path", r.URL.Path, "err", r.Context().Err())
			// No response is possible; the client is gone.
		}
	})
```

```bash
# client gives up after 1s
curl -m 1 localhost:8080/slow
# server logs "client went away, abandoning work" — it stopped working
```

**Contrastá con un handler que ignora el contexto**: sigue quemando CPU y reteniendo
una conexión de base de datos dos segundos más, para un cliente que ya se fue. Bajo
carga, así acumulás trabajo para nadie.

### Paso 3 — un circuit breaker

**`internal/scouter/breaker.go`**

```go
package scouter

import (
	"errors"
	"sync"
	"time"
)

var ErrCircuitOpen = errors.New("circuit breaker open")

type breakerState int

const (
	closed breakerState = iota
	open
	halfOpen
)

// Breaker stops calling a dependency that is clearly failing.
// The point is not to protect the dependency — it is to stop YOU from
// holding thousands of goroutines waiting on something that will not answer.
type Breaker struct {
	mu sync.Mutex

	state        breakerState
	failures     int
	successes    int
	openedAt     time.Time

	threshold    int           // consecutive failures that trip it
	cooldown     time.Duration // how long to stay open
	halfOpenNeed int           // consecutive successes to close again
}

func NewBreaker(threshold int, cooldown time.Duration) *Breaker {
	return &Breaker{
		state:        closed,
		threshold:    threshold,
		cooldown:     cooldown,
		halfOpenNeed: 3,
	}
}

func (b *Breaker) Do(fn func() error) error {
	if !b.allow() {
		return ErrCircuitOpen // fails INSTANTLY: no timeout paid
	}
	err := fn()
	b.record(err == nil)
	return err
}

func (b *Breaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case open:
		if time.Since(b.openedAt) > b.cooldown {
			b.state = halfOpen
			b.successes = 0
			return true // let one through to probe
		}
		return false
	default:
		return true
	}
}

func (b *Breaker) record(ok bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if ok {
		switch b.state {
		case halfOpen:
			b.successes++
			if b.successes >= b.halfOpenNeed {
				b.state = closed
				b.failures = 0
			}
		default:
			b.failures = 0
		}
		return
	}

	b.failures++
	if b.state == halfOpen || b.failures >= b.threshold {
		b.state = open
		b.openedAt = time.Now()
	}
}

func (b *Breaker) State() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return [...]string{"closed", "open", "half-open"}[b.state]
}
```

**`internal/scouter/breaker_test.go`**

```go
package scouter

import (
	"errors"
	"testing"
	"time"
)

func TestBreakerOpensAndRecovers(t *testing.T) {
	b := NewBreaker(3, 50*time.Millisecond)
	boom := errors.New("boom")

	for i := 0; i < 3; i++ {
		if err := b.Do(func() error { return boom }); !errors.Is(err, boom) {
			t.Fatalf("call %d: got %v", i, err)
		}
	}
	if b.State() != "open" {
		t.Fatalf("state = %s, want open", b.State())
	}

	// While open, calls fail instantly without invoking fn.
	called := false
	if err := b.Do(func() error { called = true; return nil }); !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("got %v, want ErrCircuitOpen", err)
	}
	if called {
		t.Error("fn was called while the circuit was open")
	}

	time.Sleep(60 * time.Millisecond) // cooldown

	for i := 0; i < 3; i++ {
		if err := b.Do(func() error { return nil }); err != nil {
			t.Fatalf("recovery call %d: %v", i, err)
		}
	}
	if b.State() != "closed" {
		t.Errorf("state = %s, want closed", b.State())
	}
}
```

```bash
go test ./internal/scouter/ -run Breaker -v
```

Ahora envolvé el cache con él (`cached.go`) — un Redis muerto es el caso de uso
perfecto, porque si no pagás el timeout de 200 ms en *cada request*:

```go
type CachedStore struct {
	// …
	breaker *Breaker
}

// NOTE THE FUNCTION NAME. Capsule 15 split `Latest` into a 1-second local-cache
// wrapper plus `latestFromRedisOrDB`, which is where the Redis call now lives.
// The breaker belongs on the Redis call — putting it back in `Latest` would
// either duplicate the network call or throw away your hot-key cache.
func (c *CachedStore) latestFromRedisOrDB(fighter string) (Reading, bool) {
	var raw []byte
	err := c.breaker.Do(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		b, err := c.rdb.Get(ctx, fighterKey(fighter)).Bytes()
		if errors.Is(err, redis.Nil) {
			return nil // a miss is not a failure — don't trip the breaker on it
		}
		raw = b
		return err
	})
	if errors.Is(err, ErrCircuitOpen) {
		miss = true // an open circuit IS a miss: go straight to the database
		err = nil
	}
	// then classify — see the warning below
	// …
}
```

> **⚠ Esto rompe los contadores de la Cápsula 14 si no cambiás también el `switch`.**
>
> La Cápsula 14 decidía "hit / miss / error" chequeando `errors.Is(err, redis.Nil)`.
> Acabás de envolver el `Get` en algo que — correctamente — convierte un miss en
> un error `nil` para que nunca dispare el breaker. El case de `redis.Nil` ya no
> matchea nunca, así que **todos los misses caen en `default`**: se cuentan como
> errores y se loguean como `cache read failed err=null`.
>
> Trackeá el miss explícitamente en vez de inferirlo de un error que un wrapper
> tiene permitido reescribir:
>
> ```go
> var raw []byte
> var miss bool          // <- new
> err := c.breaker.Do(func() error {
> 	b, gerr := c.rdb.Get(ctx, key).Bytes()
> 	if errors.Is(gerr, redis.Nil) {
> 		miss = true
> 		return nil
> 	}
> 	raw = b
> 	return gerr
> })
> if errors.Is(err, ErrCircuitOpen) {
> 	miss = true
> 	err = nil
> }
> switch {
> case err == nil && !miss: // hit
> case miss:                c.misses.Add(1)
> default:                  c.errs.Add(1); c.log.Warn("cache read failed", "key", key, "err", err)
> }
> ```
>
> La lección general vale más que el arreglo: **un error centinela es parte del
> contrato de una función, y envolver esa función puede borrarlo.** Mirá
> `/cache-stats` después de este cambio — si `misses` se queda en 0 mientras
> `errors` sube, te lo salteaste.

Fijate también qué **no** protegiste. `Leaderboard` y la escritura de vuelta al
cache siguen llamando a Redis directo. Heredan el deadline de 500 ms, así que un
Redis muerto te cuesta latencia y no corrección — pero "le puse un circuit
breaker al cache" todavía no es cierto. Envolvelos igual, o escribí por qué
decidiste no hacerlo.

> Fijate en la sutileza: **un cache miss no debe contar como falla.** Disparás un
> breaker con misses y se abre permanentemente la primera vez que tu cache está
> frío.

> ### ⏸ Punto natural para cortar
>
> Todo lo de arriba se sostiene solo — commiteálo y volvé después. Los pasos que
> siguen construyen sobre eso pero no dejan nada inestable si parás acá. Dos
> sesiones de 45 minutos le ganan a una de 90 que no terminás.

### Paso 4 — reintentos con full jitter

**`internal/scouter/retry.go`**

```go
package scouter

import (
	"context"
	"math"
	"math/rand"
	"time"
)

type RetryPolicy struct {
	MaxAttempts int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
}

// Retry runs fn with exponential backoff and FULL jitter.
//
// Full jitter (sleep = rand(0, base*2^n)) beats both no-jitter and
// half-jitter: without it, every client that failed at the same moment
// retries at the same moment, and you have built a self-inflicted DDoS
// that fires exactly when the dependency is trying to recover.
//
// Only ever wrap IDEMPOTENT operations in this.
func Retry(ctx context.Context, p RetryPolicy, fn func(ctx context.Context) error) error {
	var err error
	for attempt := 0; attempt < p.MaxAttempts; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(float64(p.BaseDelay) * math.Pow(2, float64(attempt-1)))
			if backoff > p.MaxDelay {
				backoff = p.MaxDelay
			}
			jittered := time.Duration(rand.Int63n(int64(backoff) + 1))

			select {
			case <-time.After(jittered):
			case <-ctx.Done():
				// The caller's deadline is gone. Retrying now is pure waste.
				return ctx.Err()
			}
		}

		if err = fn(ctx); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return err
}
```

**`internal/scouter/retry_test.go`**

```go
package scouter

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRetrySucceedsOnThirdAttempt(t *testing.T) {
	calls := 0
	err := Retry(context.Background(),
		RetryPolicy{MaxAttempts: 5, BaseDelay: time.Millisecond, MaxDelay: 10 * time.Millisecond},
		func(context.Context) error {
			calls++
			if calls < 3 {
				return errors.New("transient")
			}
			return nil
		})
	if err != nil || calls != 3 {
		t.Fatalf("err=%v calls=%d, want nil/3", err, calls)
	}
}

func TestRetryStopsWhenContextExpires(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	calls := 0
	err := Retry(ctx,
		RetryPolicy{MaxAttempts: 100, BaseDelay: 10 * time.Millisecond, MaxDelay: time.Second},
		func(context.Context) error { calls++; return errors.New("always") })

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("got %v, want DeadlineExceeded", err)
	}
	if calls > 5 {
		t.Errorf("made %d calls after the deadline — retries ignored the context", calls)
	}
}
```

### Paso 5 — load shedding

Una guarda que rechaza cuando el trabajo en vuelo excede lo que podés servir:

**`internal/scouter/shedder.go`**

```go
package scouter

import "net/http"

// Shedder bounds concurrent in-flight requests. Past the limit it rejects
// IMMEDIATELY rather than queueing — a request that would time out anyway
// is better rejected now, while the client can still do something about it.
type Shedder struct {
	sem chan struct{}
}

func NewShedder(max int) *Shedder {
	return &Shedder{sem: make(chan struct{}, max)}
}

func (s *Shedder) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never shed health checks — losing them makes the load balancer
		// remove you, which is the opposite of what an overloaded but
		// working service needs.
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			next.ServeHTTP(w, r)
			return
		}
		select {
		case s.sem <- struct{}{}:
			defer func() { <-s.sem }()
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Retry-After", "1")
			writeErr(w, http.StatusServiceUnavailable, "overloaded, retry shortly")
		}
	})
}
```

Compará los dos comportamientos bajo sobrecarga:

```bash
# without shedding: everything queues, everything times out
k6 run --vus 500 --duration 30s scripts/load/stress.js

# with shedding at, say, 100 concurrent
k6 run --vus 500 --duration 30s scripts/load/stress.js
```

Mirá qué cambió: con shedding, los requests que *sí* se sirven mantienen un p99
sano, y el resto falla rápido con un `503` y un `Retry-After`. Sin eso, **todo**
está lento y la mayoría de los requests hace timeout.

**El total de requests exitosos normalmente es más alto con shedding.** Ese es el
resultado que vale la pena internalizar.

### Paso 6 — simulá una cascada, después frenala

```bash
# make Postgres artificially slow
docker compose exec -T postgres psql -U scouter -d scouter -c \
  "ALTER SYSTEM SET default_transaction_isolation='serializable'; SELECT pg_reload_conf();"
```

O simplemente pausá el container:

```bash
docker compose pause postgres
k6 run --vus 100 --duration 20s scripts/load/stress.js
```

Sin breaker: cada request espera el timeout completo de la query, las goroutines se
apilan, la memoria crece, los health checks empiezan a fallar, y el load balancer
saca tus instancias (sanas).

Con breaker + shedder: los requests fallan en ~0 ms con un error claro, la memoria
se mantiene plana, los health checks siguen pasando, y te recuperás en el instante
en que vuelve la base de datos.

```bash
docker compose unpause postgres
```

---

## En GCP

- **Cloud Armor** hace rate limiting en el borde, antes de que el tráfico llegue a
  tu servicio — por IP, por región, por header. `rate_limit_options` con
  `enforce_on_key = "IP"` o `"HTTP_HEADER"`. **Este es el lugar más barato para
  descartar carga abusiva**, porque no la pagás en absoluto.
- **API Gateway / Apigee** aplican cuotas por API key — la versión a nivel producto
  (Cápsula 08).
- **`--max-instances` de Cloud Run** es un mecanismo de backpressure: pasado eso,
  los requests encolan y después dan 429. Configurarlo es cómo protegés tu base de
  datos de tu propio autoscaler.
- **El timeout de request de Cloud Run** (300 s por defecto, máximo 60 min) es el
  deadline más externo. Ponelo mucho más bajo para servicios de cara al usuario —
  30 s como mucho. Un endpoint que legítimamente necesita 5 minutos debería ser un
  job asíncrono (Cápsula 20).
- **Cloud Tasks** te da reintentos con backoff, rate limiting y control de
  concurrencia como servicio gestionado, lo que a menudo es mejor que
  implementarlo.
- **Las librerías cliente** de los servicios de GCP traen reintentos con backoff
  incorporados. Conocé sus defaults — interactúan con *tus* timeouts, y las capas
  de reintentos duplicadas se multiplican.

---

## Llevátelo al trabajo

- **Un timeout en cada llamada de red**, derivado del deadline de quien llama.
- **Full jitter en cada reintento**, más un presupuesto de reintentos, más
  idempotencia.
- **Nunca reintentes 4xx.**
- **Un circuit breaker en cada dependencia externa** — especialmente las
  opcionales, como caches, donde un breaker abierto es estrictamente mejor que un
  timeout.
- **Acotá cada cola.** Las colas sin límite son crashes por falta de memoria con
  retardo.
- **Descartá carga a propósito**, y nunca descartes los health checks.
- **Devolvé `Retry-After` con 429/503.** Es cómo cooperan los clientes bien
  educados.
- **Poné mamparos en tus pools** para que un endpoint malo no pueda tirar abajo el
  servicio.
- **Testealo con caos.** Pausá una dependencia en staging y mirá. Un breaker sin
  testear es una hipótesis.

---

## Battle drill

<details>
<summary><b>1.</b> Un servicio aguas abajo pasa de 50 ms a 5 s. Tu servicio, que ni siquiera depende de él para la mayoría de los requests, se cae. Explicá la cadena.</summary>

1. Los requests que tocan la dependencia lenta retienen su goroutine/hilo y su
   conexión 5 s en vez de 50 ms — un **aumento de 100× del trabajo concurrente en
   vuelo** a la misma tasa de requests (ley de Little).
2. Esos requests agotan un recurso compartido: pool de conexiones, thread pool o
   memoria.
3. Los requests que *no* tocan esa dependencia ahora hacen cola por el mismo recurso
   agotado. **Ahora todo está lento.**
4. Los health checks hacen timeout. El load balancer saca instancias. Las que quedan
   reciben más tráfico y fallan más rápido.
5. Los clientes hacen timeout y reintentan, duplicando la carga ofrecida.

**Soluciones:** timeouts agresivos (fallá a los 500 ms, no a los 5 s); un circuit
breaker (dejá de llamarla del todo); **mamparos** (un pool separado y chico para esa
dependencia, así solo puede consumir su propia porción); load shedding; y checks de
liveness que no dependan de ella.

El paso 3 es el crítico — la razón por la que muere un endpoint no relacionado es un
recurso *compartido*, que es exactamente lo que eliminan los mamparos.
</details>

<details>
<summary><b>2.</b> ¿Por qué ocurre una tormenta de reintentos, y qué la frena?</summary>

Una dependencia se degrada y empieza a fallar el 30% de los requests. Todos los
clientes reintentan. La carga ofrecida ahora es 130% — en el momento exacto en que
la dependencia tiene *menos* capacidad. Más fallas, más reintentos, y nunca se
recupera, ni siquiera después de que el disparador original desaparece. Esto es una
**falla metaestable**: el sistema se mantiene roto por su propio lazo de
realimentación.

Se frena con:
- **Presupuestos de reintentos** — reintentos totales topeados a ~10% de los
  requests, así nunca pueden dominar.
- **Circuit breakers** — los clientes dejan de reintentar del todo cuando está
  claramente caído.
- **Full jitter** — los reintentos se reparten en vez de llegar en olas.
- **`Retry-After` del servidor** — el servidor le dice a los clientes cuándo
  volver.
- **Load shedding en el servidor** — rechazá rápido para que los clientes no
  retengan conexiones.

El principio general: **los reintentos tienen que ser una fracción chica y acotada
del tráfico, nunca un multiplicador.**
</details>

<details>
<summary><b>3.</b> ¿Circuit breaker o solo timeout — por qué los dos?</summary>

Un timeout acota *un* request. Un breaker acota el *patrón*.

Con solo timeouts, una dependencia muerta te cuesta un timeout completo en cada
request para siempre: a 1.000 rps con un timeout de 2 s, eso son 2.000 requests
permanentemente en vuelo, todos garantizados a fallar. Estás quemando todo tu
presupuesto de concurrencia en trabajo condenado y conocido.

El breaker nota el patrón y falla al instante — sin goroutine, sin conexión, sin
espera — y devuelve un fallback. También *deja de martillar a una dependencia que
se está recuperando*, dándole aire para volver.

Se componen: los timeouts detectan lentitud individual, el breaker reacciona a la
lentitud agregada.
</details>

<details>
<summary><b>4.</b> Diseñá rate limiting para una API pública con tiers gratis y pago.</summary>

- **Token bucket por API key**, con rate y burst del plan
  (gratis: 10/s burst 20; pro: 100/s burst 200).
- **Aplicalo en Redis**, no por réplica — un límite que se multiplica por tu
  cantidad de réplicas no es un límite, y los límites cercanos a facturación tienen
  que ser exactos.
- **Poné capas de claves**: por API key (equidad), por endpoint (proteger los
  caminos caros), y global (proteger la base). Un request tiene que pasar las tres.
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, y
  `Retry-After` en el 429. Los clientes no pueden portarse bien sin eso.
- **Aplicación en el borde** (Cloud Armor) para tráfico abusivo/anónimo, así no
  pagás por rechazarlo.
- **Fallá abierto si el limitador falla.** Si Redis está caído, permitir tráfico le
  gana a rechazar a todos — salvo que el límite sea una restricción dura de
  facturación, en cuyo caso fallá cerrado. Decidí a propósito y escribilo.
- **Monitoreá la tasa de 429 por cliente.** Un cliente constantemente en su límite
  es una conversación de ventas, no un incidente.
</details>

<details>
<summary><b>5.</b> Tu servicio está al 100% de capacidad. Argumentá a favor de rechazar requests.</summary>

Al límite, aceptar más trabajo no produce más trabajo completado — produce más
trabajo *encolado*. El tiempo de cola se le suma a cada request, así que la latencia
sube para todos, incluidos los requests que podrías haber servido bien. Los clientes
llegan a sus propios timeouts, se rinden y reintentan — así que gastás capacidad
computando respuestas que nadie va a recibir, y después recibís más carga.

Rechazar de inmediato significa: los requests que aceptás siguen cumpliendo su SLO;
los clientes rechazados se enteran en 1 ms en vez de 30 s y pueden retroceder,
hacer failover o mostrar un mensaje útil; tu memoria se mantiene plana; y tus health
checks siguen pasando, así que no te sacan del pool.

**Resultado medido:** el total de requests exitosos normalmente es *más alto* con
shedding, y el p99 de los requests servidos es dramáticamente mejor.

El matiz es *qué* descartar: tirá primero los reintentos y el trabajo de fondo,
conservá los requests interactivos de usuarios. Y nunca descartes los health checks.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| El rate limiter bloquea a todos | La función de clave devuelve una constante. Logueá la clave mientras debuggeás. |
| El límite es N× más alto de lo configurado | Limitación por réplica con N réplicas. Usá Redis, o dividí el límite. |
| El breaker nunca abre | ¿Estás contando misses o 404 como fallas? No — al revés: contá solo fallas *reales*, y verificá que `record(false)` realmente se alcance. |
| El breaker nunca cierra | Los `halfOpenNeed` éxitos nunca se acumulan porque los sondeos siguen fallando — la dependencia realmente sigue caída. |
| Los reintentos tardan una eternidad | Sin tope de `MaxDelay`, el backoff exponencial llega a minutos. Topealo. |
| La memoria crece con el limitador | Map por clave sin limpieza. Para eso está `reap()`. |
| El shedding rechaza health checks | Excluí `/healthz` y `/readyz` explícitamente. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(resilience): rate limiting, circuit breaker, retries, shedding

Capsule 17. Token-bucket limiter per caller with Retry-After. Circuit breaker
around the cache so a dead Redis costs 0ms instead of a timeout per request.
Retry with full jitter that respects the caller's deadline. Bounded in-flight
shedder returning 503 rather than queueing. Verified under a paused database."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 17
```

**Siguiente:** [Cápsula 18 · Telepatía de Kaio-sama — Pub/Sub](../18-king-kai-telepathy-pubsub/README.md)
