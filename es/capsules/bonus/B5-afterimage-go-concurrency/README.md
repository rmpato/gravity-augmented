# Cápsula B5 · Imagen Residual — Concurrencia en Go

> *La Imagen Residual hace parecer que estás en varios lugares a la vez. No lo
> estás — te movés entre ellos lo bastante rápido como para que la distinción deje de
> importar. La concurrencia es ocuparse de muchas cosas a la vez; el paralelismo es
> hacer muchas cosas a la vez. La imagen residual de Goku es concurrencia.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 70 min | Go básico | Cápsula 17 |

---

## Por qué existe esta cápsula

Cada servicio de este repo es concurrente lo hayas pensado o no — el servidor HTTP de
Go corre cada request en su propia goroutine. Eso significa que el estado compartido
*ya* es un peligro, y los bugs que produce son no deterministas, invisibles en tests y
catastróficos en producción (`fatal error: concurrent map writes` mata el proceso
entero, sin posibilidad de atraparlo).

Esta cápsula cubre lo que realmente necesitás: `context`, worker pools, el race
detector, y el puñado de patrones que aparecen en todo servicio real.

---

## Goroutines

```go
go doSomething()   // that's it
```

Una goroutine arranca con un stack de ~2 KB que crece a demanda, contra ~1–8 MB de un
hilo de SO. Millones de goroutines son rutina; millones de hilos no.

El scheduler de Go multiplexa goroutines sobre `GOMAXPROCS` hilos de SO (Cápsula 05 —
y la trampa de cgroups). Una goroutine que se bloquea en E/S cede su hilo a otra; una
goroutine en un loop apretado de CPU es interrumpible desde Go 1.14.

**Las dos reglas que previenen la mayoría de los bugs de goroutines:**

1. **Nunca arranques una goroutine sin saber cómo termina.** Una goroutine sin límite
   o que nunca termina es un leak, y las goroutines filtradas retienen todo lo que
   referencian.
2. **Quien la arranca es responsable de su ciclo de vida.** Pasá un `context`, o un
   canal `done`, o un `WaitGroup` — algo que diga cuándo parar.

### La trampa de la variable de loop (arreglada en Go 1.22, pero conocela)

```go
// Go < 1.22: all goroutines see the FINAL value of i. A classic.
for i := 0; i < 5; i++ {
    go func() { fmt.Println(i) }()   // prints 5,5,5,5,5
}

// Go < 1.22 fix:
for i := 0; i < 5; i++ {
    i := i                            // shadow it
    go func() { fmt.Println(i) }()
}
```

**Go 1.22+ hace las variables de loop por iteración**, así que el original ahora es
correcto. Igual necesitás reconocer el patrón en código viejo y en otros lenguajes (el
`var` de JavaScript tiene el bug idéntico).

---

## Channels

```go
ch := make(chan int)       // UNBUFFERED: send blocks until a receiver is ready
ch := make(chan int, 10)   // BUFFERED: send blocks only when full
```

**Los canales sin buffer son un punto de sincronización** — el envío y la recepción
ocurren juntos. Eso a menudo es lo que querés, y es un mecanismo natural de
backpressure.

**Los canales con buffer desacoplan** productor y consumidor hasta el tamaño del
buffer. El tamaño del buffer es una decisión de *capacidad*: muy chico y serializás,
muy grande y construiste una cola sin límite que esconde un problema de throughput
(Cápsula 17).

```go
// select: whichever is ready first. The core concurrency primitive.
select {
case v := <-ch1:
    use(v)
case ch2 <- x:
    // sent
case <-time.After(time.Second):
    // timeout
case <-ctx.Done():
    return ctx.Err()
default:
    // non-blocking: taken if nothing else is ready
}
```

**Reglas de canales que previenen panics:**

- **Solo el emisor cierra**, y solo cuando no va a haber más envíos. Enviar por un
  canal cerrado panickea; cerrar dos veces panickea.
- **Recibir de un canal cerrado** devuelve el valor cero de inmediato.
  `v, ok := <-ch` — `ok` es false cuando está cerrado y drenado.
- **Un canal nil bloquea para siempre.** Ocasionalmente útil en `select` para
  deshabilitar un caso.
- **`range ch`** recibe hasta que se cierra.

> **"Compartí memoria comunicando"** es el proverbio de Go, pero no es absoluto. Un
> mutex alrededor de un map suele ser más simple y más rápido que una alternativa
> basada en canales. **Usá canales para transferir propiedad y coordinar; usá mutexes
> para proteger estado.**

---

## Context — el tipo más importante en servicios Go

`context.Context` lleva **deadlines, cancelación y valores con alcance de request** a
través de fronteras de API. Toda función que hace E/S debería recibir uno como primer
parámetro.

```go
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()          // ALWAYS. Not calling it leaks the timer and the goroutine.

ctx, cancel := context.WithCancel(ctx)
ctx, cancel := context.WithDeadline(ctx, t)
ctx = context.WithValue(ctx, key{}, val)   // request-scoped data ONLY
```

**La cancelación se propaga hacia abajo en el árbol.** Cancelás un padre y cada
contexto derivado se cancela — que es exactamente la propagación de deadlines de la
Cápsula 17.

```go
func work(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()          // context.Canceled or DeadlineExceeded
        case job := <-jobs:
            if err := process(ctx, job); err != nil {
                return err
            }
        }
    }
}
```

**Las reglas:**

- Pasalo explícitamente como **primer parámetro**. Nunca lo guardes en un struct.
- **Siempre `defer cancel()`**, incluso cuando el contexto va a expirar igual.
- **`WithValue` es para datos con alcance de request** — ids de trace, identidad de
  usuario. No para parámetros opcionales, no para inyección de dependencias.
- Usá un **tipo struct no exportado como clave** para evitar colisiones:
  `type ctxKey struct{}`.
- Un contexto `nil` es un bug. Usá `context.TODO()` si genuinamente todavía no tenés
  uno.

---

## Primitivas de sincronización

```go
var mu sync.Mutex
mu.Lock(); defer mu.Unlock()

var rw sync.RWMutex
rw.RLock()   // many readers OR one writer
rw.Lock()    // exclusive

var wg sync.WaitGroup
wg.Add(1); go func(){ defer wg.Done(); ... }(); wg.Wait()

var once sync.Once
once.Do(func(){ /* runs exactly once, ever */ })

var counter atomic.Int64
counter.Add(1)          // lock-free, for simple counters

var m sync.Map           // for high-read, low-write, disjoint-key workloads
```

**Cómo elegir:**

- **`atomic`** para un solo contador o flag. El más rápido.
- **`Mutex`** para todo lo demás. Simple y rápido; no vayas más allá sin una medición.
- **`RWMutex`** solo cuando las lecturas dominan *fuertemente* y la sección crítica es
  larga — tiene más overhead por operación, así que para secciones críticas cortas un
  `Mutex` común suele ser más rápido.
- **`sync.Map`** *no* es un reemplazo general de `map` + `Mutex`. Está optimizado para
  dos casos específicos (escribir-una-vez-leer-muchas, y conjuntos de claves disjuntos
  por goroutine). Hacé benchmark antes de usarlo.

**`defer mu.Unlock()` inmediatamente después de `Lock()`** — la disciplina que
previene el deadlock de "retorné temprano y nunca desbloqueé".

---

## Patrones que vas a usar de verdad

### Worker pool con concurrencia acotada

```go
// Bounded concurrency. Unbounded `go` per item is how you exhaust file
// descriptors, connections, or memory (Capsule 17's bulkhead idea in code).
func ProcessAll(ctx context.Context, items []Item, workers int) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(workers)          // errgroup does the bounding for you

    for _, item := range items {
        item := item             // (unnecessary in Go 1.22+, harmless)
        g.Go(func() error {
            return process(ctx, item)
        })
    }
    // Wait returns the FIRST error, and cancels ctx so siblings stop early.
    return g.Wait()
}
```

`golang.org/x/sync/errgroup` es el default correcto para "correr N cosas, parar en la
primera falla". Combina `WaitGroup`, recolección de errores y cancelación de contexto.

### Fan-out / fan-in

```go
func FanIn[T any](ctx context.Context, chans ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup

    for _, c := range chans {
        wg.Add(1)
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return       // don't block forever if nobody is reading
                }
            }
        }(c)
    }

    go func() { wg.Wait(); close(out) }()   // closer owns the channel
    return out
}
```

### Pipeline con cancelación

```go
func generate(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)                 // producer closes
        for i := 0; i < n; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return                   // THE LEAK PREVENTION
            }
        }
    }()
    return out
}
```

**Sin el caso `ctx.Done()`, un consumidor que para temprano deja esta goroutine
bloqueada en `out <- i` para siempre.** Ese es el leak de goroutines canónico de Go, y
es por qué cada etapa de un pipeline necesita un camino de cancelación.

### Singleflight (Cápsula 15)

```go
var g singleflight.Group

v, err, shared := g.Do(key, func() (any, error) {
    return expensiveLoad(key)
})
```

### Ponerle timeout a una operación que no recibe un contexto

```go
func withTimeout[T any](ctx context.Context, d time.Duration, fn func() (T, error)) (T, error) {
    type result struct {
        v   T
        err error
    }
    ch := make(chan result, 1)   // BUFFERED: so the goroutine can exit even
                                 // if we've already returned on timeout.
    go func() {
        v, err := fn()
        ch <- result{v, err}
    }()

    select {
    case r := <-ch:
        return r.v, r.err
    case <-time.After(d):
        var zero T
        // NOTE: fn is still running. We abandoned it, we didn't cancel it.
        // This is why context-aware APIs matter.
        return zero, context.DeadlineExceeded
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

**El canal con buffer es el detalle importante.** Con un canal sin buffer, si
retornamos por timeout nadie recibe nunca, y esa goroutine se filtra para siempre.

---

## Lab

### Paso 1 — mirá un data race

**`internal/conc/race_test.go`**

```go
package conc

import (
	"sync"
	"testing"
)

func TestRaceDemo(t *testing.T) {
	// Run with -race and this fails. Run without and it "passes"
	// with a wrong answer — which is exactly why races survive in
	// production for months.
	counter := 0
	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			counter++ // READ, ADD, WRITE — three steps, not one
		}()
	}
	wg.Wait()
	t.Logf("counter = %d (want 1000)", counter)
}
```

```bash
go test ./internal/conc/ -run RaceDemo -v          # often prints ~980
go test ./internal/conc/ -run RaceDemo -race -v    # DATA RACE detected
```

**`counter++` no es atómico.** Compila a load, incrementar, store, y dos goroutines se
pueden intercalar en el medio.

Tres soluciones correctas, y cuándo usar cada una:

```go
// 1. atomic — for a plain counter. Fastest.
var counter atomic.Int64
counter.Add(1)

// 2. mutex — for anything more complex than a counter
var mu sync.Mutex
mu.Lock(); counter++; mu.Unlock()

// 3. channel — when the count is a result to collect, not shared state
results := make(chan int, 1000)
```

### Paso 2 — un leak de goroutine, y después el arreglo

```go
// LEAKS: if the consumer stops reading, this goroutine blocks forever
// on the send and is never collected. It holds its stack, its closure,
// and anything they reference.
func leaky() <-chan int {
	ch := make(chan int)
	go func() {
		for i := 0; ; i++ {
			ch <- i           // blocks forever once nobody reads
		}
	}()
	return ch
}

// FIXED
func notLeaky(ctx context.Context) <-chan int {
	ch := make(chan int)
	go func() {
		defer close(ch)
		for i := 0; ; i++ {
			select {
			case ch <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	return ch
}
```

Probalo:

```go
func TestGoroutineLeak(t *testing.T) {
	before := runtime.NumGoroutine()

	for i := 0; i < 100; i++ {
		ch := leaky()
		<-ch // read once, then abandon
	}

	time.Sleep(100 * time.Millisecond)
	after := runtime.NumGoroutine()
	t.Logf("goroutines: %d -> %d (leaked ~%d)", before, after, after-before)
	if after-before > 10 {
		t.Errorf("leaked %d goroutines", after-before)
	}
}
```

```bash
go test ./internal/conc/ -run Leak -v
```

Para servicios reales, usá `go.uber.org/goleak` en `TestMain` — falla cualquier test
que deje goroutines vivas, lo que agarra esta clase de bug automáticamente:

```go
func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}
```

### Paso 3 — concurrencia acotada vs sin límite

```go
// ❌ unbounded: 10,000 concurrent HTTP calls will exhaust file descriptors,
// hammer the target, and probably OOM
for _, url := range urls {
	go fetch(url)
}

// ✅ bounded
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(20)
for _, url := range urls {
	url := url
	g.Go(func() error { return fetch(ctx, url) })
}
if err := g.Wait(); err != nil {
	return err
}
```

Hacé benchmark de la diferencia contra un servidor local:

```go
func BenchmarkConcurrency(b *testing.B) {
	for _, workers := range []int{1, 4, 16, 64, 256} {
		b.Run(fmt.Sprintf("workers-%d", workers), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				g := new(errgroup.Group)
				g.SetLimit(workers)
				for j := 0; j < 1000; j++ {
					g.Go(func() error {
						time.Sleep(time.Millisecond) // simulated I/O
						return nil
					})
				}
				_ = g.Wait()
			}
		})
	}
}
```

```bash
go test ./internal/conc/ -bench Concurrency -benchtime 3x
```

Vas a ver las ganancias aplanarse y después revertirse — la misma rodilla de la
Cápsula 09, dentro del proceso. **Más concurrencia no es monótonamente mejor.**

### Paso 4 — cancelación de contexto de punta a punta

```go
func TestContextPropagates(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	g, ctx := errgroup.WithContext(ctx)
	started := atomic.Int32{}
	finished := atomic.Int32{}

	for i := 0; i < 10; i++ {
		g.Go(func() error {
			started.Add(1)
			select {
			case <-time.After(500 * time.Millisecond):
				finished.Add(1)
				return nil
			case <-ctx.Done():
				return ctx.Err() // respected the deadline
			}
		})
	}

	err := g.Wait()
	t.Logf("started=%d finished=%d err=%v", started.Load(), finished.Load(), err)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("got %v, want DeadlineExceeded", err)
	}
	if finished.Load() != 0 {
		t.Errorf("%d goroutines ignored the deadline", finished.Load())
	}
}
```

**Diez goroutines, un deadline, todas paran.** Ese es el mecanismo detrás de cada
timeout de la Cápsula 17.

### Paso 5 — corré siempre los tests con `-race`

```makefile
test:
	go test ./... -race -count=1
```

- `-race` instrumenta el acceso a memoria; aproximadamente 2–10× más lento y 5–10×
  más memoria.
- `-count=1` deshabilita el cache de tests para que realmente vuelvan a correr.
- **Corré `-race` en CI.** Solo detecta races que *efectivamente ocurren*, así que más
  caminos de ejecución significa más cobertura. Algunos equipos además corren un build
  con `-race` más lento en staging.

---

## Llevátelo al trabajo

- **`go test -race` en CI. Siempre.**
- **Nunca arranques una goroutine sin una salida definida.** Contexto, canal done, o
  `WaitGroup`.
- **Acotá todo fan-out.** `errgroup.SetLimit`, o un canal semáforo.
- **`context.Context` como primer parámetro** de toda función de E/S.
- **`defer cancel()` inmediatamente** después de crear un contexto cancelable.
- **`defer mu.Unlock()` inmediatamente** después de `Lock()`.
- **Solo el emisor cierra un canal.**
- **Canal con buffer de tamaño 1** para una goroutine que reporta un resultado que
  podrías abandonar — si no, se filtra.
- **`goleak` en `TestMain`** para servicios.
- **Preferí un mutex a un canal para proteger estado.** Los canales son para
  transferir propiedad.

---

## Battle drill

<details>
<summary><b>1.</b> Tu servicio funciona en tests y panickea con "concurrent map writes" en producción. Explicá.</summary>

El runtime de Go detecta el acceso concurrente a maps y **panickea a propósito** — no
es recuperable, y mata el proceso entero, llevándose todos los requests en vuelo. Eso
es intencional: un map corrupto es peor que un crash.

No pasa en tests porque tus tests son efectivamente de un solo hilo, o la ventana
temporal es lo bastante chica como para que el intercalado nunca ocurra. Los races son
probabilísticos; producción tiene miles de goroutines y las probabilidades te alcanzan.

**Encontralo:** `go test -race` con un test que ejercite el map concurrentemente. El
race detector reporta los dos stack traces — la lectura y la escritura en conflicto.

**Arreglalo:** un `sync.Mutex` (o `RWMutex` si dominan las lecturas), `sync.Map` si el
patrón de acceso encaja, o reestructurar para que una goroutine sea dueña del map y las
otras le manden mensajes.

**Prevenilo:** `-race` en CI, y tratá todo estado mutable compartido como algo que
requiere una estrategia de sincronización documentada.
</details>

<details>
<summary><b>2.</b> ¿Qué es un leak de goroutine y cómo encontrás uno?</summary>

Una goroutine que nunca termina — normalmente bloqueada para siempre en un envío o
recepción de canal que nadie va a atender, o en un loop sin camino de cancelación. Cada
una retiene su stack más todo lo que referencia su closure, así que los leaks parecen
una fuga lenta de memoria que eventualmente hace OOM.

**Detección:** exponé `runtime.NumGoroutine()` como métrica (Cápsula 25) y alertá sobre
crecimiento sostenido. En tests, `go.uber.org/goleak`. En vivo, `pprof`:

```bash
go tool pprof http://localhost:8080/debug/pprof/goroutine
# then: top, and `traces` to see where they're all stuck
```

Miles de goroutines en la misma línea es la respuesta.

**Causas comunes:** un productor sin caso `ctx.Done()`; un canal de resultado sin
buffer cuyo lector hizo timeout; un `time.Ticker` nunca detenido; una suscripción nunca
cancelada; un `WaitGroup` donde `Done()` no se alcanza en un camino de error.
</details>

<details>
<summary><b>3.</b> ¿Cuándo usarías un canal en vez de un mutex?</summary>

Canales para **transferir propiedad** y **coordinar**; mutexes para **proteger
estado**.

Canal: un pipeline donde cada etapa es dueña de los datos que recibe; distribuir
trabajo a un pool; señalizar finalización o cancelación; cualquier lugar donde un
`select` sobre varios eventos sea natural.

Mutex: un cache compartido, un contador, un struct de configuración leído por muchas
goroutines — casos donde los datos se quedan en un lugar y muchas goroutines los tocan.

Intentar proteger un map compartido con un canal significa rutear cada lectura y
escritura a través de una sola goroutine, lo que serializa todo y es a la vez más lento
y más difícil de leer que `mu.Lock()`.

El proverbio "compartí memoria comunicando" es una guía, no una ley — y la biblioteca
estándar de Go usa mutexes extensamente.
</details>

<details>
<summary><b>4.</b> ¿Por qué un canal de resultado tiene que tener buffer cuando el llamador puede hacer timeout?</summary>

```go
ch := make(chan result)     // UNBUFFERED
go func() { ch <- compute() }()

select {
case r := <-ch:  return r
case <-time.After(d): return timeout   // we leave...
}
```

Al hacer timeout, el llamador retorna. La goroutine sigue bloqueada en
`ch <- compute()` porque un envío sin buffer necesita un receptor, y nunca va a haber
uno. **Esa goroutine se filtra permanentemente**, reteniendo su stack y todo lo que
capturó.

`make(chan result, 1)` deja que el envío se complete en el buffer y la goroutine salga
limpia. El valor se descarta cuando el canal se recolecta.

Fijate lo que esto *no* arregla: `compute()` igual corrió hasta el final. La
abandonaste, no la cancelaste. Por eso las APIs conscientes de contexto son mejores que
los wrappers de timeout — la cancelación efectivamente frena el trabajo.
</details>

<details>
<summary><b>5.</b> ¿Cuántas goroutines son demasiadas?</summary>

La cantidad en sí rara vez es el problema — Go maneja millones. Lo que importa es qué
retiene cada una.

Límites reales: file descriptors (`ulimit -n`, a menudo 1024 por defecto); conexiones
de base de datos (Cápsula 10 — 10.000 goroutines queriendo una conexión contra un pool
de 100 significa 9.900 esperando); memoria (2 KB de stack mínimo, pero una goroutine
reteniendo un buffer de 1 MB es 1 MB); y capacidad aguas abajo — 10.000 llamadas
concurrentes a un servicio dimensionado para 500 es un DoS que construiste vos.

Así que la pregunta nunca es "cuántas goroutines" sino **"cuántas operaciones
concurrentes contra cada recurso restringido"** — que es la idea de mamparos de la
Cápsula 17.

En la práctica: acotá el fan-out con `errgroup.SetLimit` o un semáforo, dimensioná el
límite a partir de una medición (Cápsula 09), y monitoreá `runtime.NumGoroutine()` por
crecimiento inesperado.
</details>

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "test: run the race detector in the default test target

Capsule B5. make test now runs -race -count=1. Added goleak to TestMain so
leaked goroutines fail the build. Fan-out bounded with errgroup.SetLimit."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done B5
```
