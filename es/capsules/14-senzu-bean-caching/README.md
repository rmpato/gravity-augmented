# Cápsula 14 · Semilla del Ermitaño — Fundamentos de caching

> *Una semilla, recuperación total, al instante. Karin cultiva quizás una cada
> pocos meses, así que siempre son escasas, y toda pelea donde alguien tiene una
> Senzu es una pelea sobre si puede alcanzarla a tiempo. Nadie gana nunca por
> tener una Senzu — ganan por no necesitarla.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 7 | 75 min | Cápsulas 10–13 | Local + concepto |

---

## Por qué existe esta cápsula

El caching es la herramienta de latencia de mayor apalancamiento que existe — y la
forma más rápida de introducir bugs que no podés reproducir.

El cache es una *segunda copia de la verdad*. Cada cache es por lo tanto un
problema de consistencia que elegiste aceptar, y la ingeniería consiste enteramente
en elegir dónde la obsolescencia es inofensiva y dónde no.

También hay un número que casi todos entienden mal, y lo vas a medir acá: **el hit
ratio no es reducción de carga.** Un hit ratio del 90% puede dejar tu base de datos
al 100% de carga.

---

## El concepto

### Las estrategias

**Cache-aside (lazy loading)** — el default, y lo que vas a implementar:

```
  read:   check cache → hit? return
                      → miss? read DB, write cache, return
  write:  write DB, then INVALIDATE the cache key
```

*A favor:* solo se cachea lo que realmente se pide; una falla del cache degrada a
lento, no a roto. *En contra:* cada miss paga la latencia de la DB; hay una ventana
de carrera al escribir.

**Write-through** — escribís al cache y a la DB juntos, sincrónicamente.
*A favor:* el cache nunca está viejo. *En contra:* escrituras más lentas, y
cacheás datos que quizás nunca se lean.

**Write-behind (write-back)** — escribís al cache, hacés flush a la DB de forma
asíncrona. *A favor:* escrituras muy rápidas, absorbe ráfagas. *En contra:*
**pérdida de datos si el cache muere antes del flush.** Solo para datos que te
podés dar el lujo de perder (contadores de vistas, timestamps de "visto por
última vez").

**Read-through** — la librería de cache carga sola en el miss. Código más limpio,
menos control, y esconde adónde se va tu latencia.

> **Invalidá, no actualices.** Al escribir, borrá la clave en vez de escribir el
> valor nuevo. Dos escritores concurrentes actualizando un cache pueden
> intercalarse y dejar el valor *más viejo* cacheado permanentemente. El borrado es
> idempotente y siempre seguro.

### Hit ratio vs reducción de carga — hacé la cuenta

```
  10,000 req/s, 90% hit ratio  →  1,000 req/s still reach the database
```

Si la base solo aguantaba 800 req/s, seguís caído. Y peor: los cache misses no son
una muestra aleatoria. Los items cacheados son los *populares* — baratos, bien
indexados, pedidos repetidamente. Los misses son la cola larga: raros, complejos,
queries caras.

**Así que un hit ratio del 90% puede dejar intacto el 60% de la carga real de la
base.** Medí la reducción de carga de la base de datos, no el hit ratio, y
desconfiá de quien te cite solo lo segundo.

### El TTL es una decisión de corrección

El TTL es "¿cuán viejo puede estar esto?" — una pregunta de producto disfrazada de
operaciones.

| Dato | TTL razonable |
|---|---|
| El perfil propio del usuario | segundos, o invalidar al escribir |
| Leaderboard público | 10–60 s |
| Catálogo de productos | minutos |
| Cotizaciones de moneda | lo que el negocio permita |
| Asset estático con hash en el nombre | para siempre (inmutable) |

**Siempre agregá jitter.** Mil claves creadas juntas expiran juntas y producen una
estampida sincronizada exactamente en el mismo segundo (Cápsula 15).
`ttl = base + rand(0, base*0,1)`.

### Políticas de evicción

Cuando la memoria se llena, algo tiene que irse:

- **LRU** — desalojá el menos usado recientemente. Buen default.
- **LFU** — el menos usado frecuentemente. Mejor cuando la popularidad es estable;
  resiste que un scan te borre el working set.
- **Solo TTL** — desalojar solo al expirar. Riesgo de OOM.
- **`allkeys-lru`** vs **`volatile-lru`** en Redis: desalojar de todas las claves,
  o solo de las que tienen TTL. **Equivocarse acá es una caída clásica**: con
  `noeviction` (¡el default!) Redis empieza a devolver errores al escribir cuando
  se llena, en vez de hacer lugar.

### Capas de cache, de la más rápida a la más lenta

```
  1. In-process (a Go map)     ~50ns   per-instance, inconsistent across replicas
  2. Distributed (Redis)       ~1ms    shared, consistent, a network hop
  3. CDN edge (Capsule 16)     ~10ms   geographic, HTTP only
  4. Database buffer pool      ~0.1ms  free, already happening
```

No te olvides de la #4. Postgres ya cachea páginas calientes en RAM. Si tu working
set entra en `shared_buffers`, "agregá Redis" puede comprarte mucho menos de lo que
suponés — medí antes de agregar infraestructura.

**Los caches en proceso son una trampa de la Cápsula 06:** cada réplica tiene el
suyo, así que la invalidación no se propaga y los usuarios ven respuestas distintas
según el ruteo. Usalos solo para datos genuinamente inmutables (configuración
cargada al arrancar, templates compilados).

### Qué no cachear

- Datos que tienen que estar exactamente bien, ahora mismo (el saldo de una cuenta
  durante una transferencia).
- Cualquier cosa por usuario bajo una clave compartida (**el bug catastrófico
  clásico**: cachear una página personalizada bajo una clave de URL y servirle los
  datos del usuario A al usuario B).
- Queries baratas. Un cache agrega un salto de red; una búsqueda indexada de 0,2 ms
  no lo necesita.
- Datos con hit ratio cercano a cero — estás pagando el costo de escritura para
  nada.

---

## Lab

### Paso 1 — Redis en el stack

Agregá a **`deploy/docker-compose.yml`**:

```yaml
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: >
      redis-server
      --maxmemory 128mb
      --maxmemory-policy allkeys-lru
      --save ""
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      retries: 10
```

- `--maxmemory-policy allkeys-lru` — desalojar en vez de dar error. El default es
  `noeviction`, que convierte un cache lleno en fallas de escritura.
- `--save ""` — sin persistencia a disco. **Esto es un cache.** Si necesitás que
  sobreviva a un reinicio, no es un cache, es una base de datos, y deberías pensarlo
  mucho más.

```bash
brew install redis    # for redis-cli
cd deploy && docker compose up -d redis
redis-cli ping        # PONG
```

### Paso 2 — un decorador cache-aside

La interfaz `Store` de la Cápsula 06 te deja envolver, no reescribir.

```bash
go get github.com/redis/go-redis/v9
```

**`internal/scouter/cached.go`**

```go
package scouter

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// CachedStore wraps any Store with cache-aside caching in Redis.
// It is a decorator: the wrapped Store has no idea a cache exists.
type CachedStore struct {
	inner Store
	rdb   *redis.Client
	log   *slog.Logger
	ttl   time.Duration

	hits, misses, errs atomic.Uint64
}

var _ Store = (*CachedStore)(nil)

func NewCachedStore(inner Store, addr string, ttl time.Duration, log *slog.Logger) *CachedStore {
	return &CachedStore{
		inner: inner,
		rdb: redis.NewClient(&redis.Options{
			Addr:         addr,
			DialTimeout:  1 * time.Second,
			ReadTimeout:  200 * time.Millisecond, // a slow cache must not become
			WriteTimeout: 200 * time.Millisecond, // slower than the database
			PoolSize:     20,
		}),
		log: log,
		ttl: ttl,
	}
}

func (c *CachedStore) Close() error { return c.rdb.Close() }

// jitter spreads expiries so keys created together don't expire together.
func (c *CachedStore) jittered() time.Duration {
	return c.ttl + time.Duration(rand.Int63n(int64(c.ttl/10)))
}

func fighterKey(name string) string { return "scouter:fighter:" + name }
func boardKey(n int) string         { return "scouter:board:" + strconv.Itoa(n) }

func (c *CachedStore) Latest(fighter string) (Reading, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	key := fighterKey(fighter)

	raw, err := c.rdb.Get(ctx, key).Bytes()
	switch {
	case err == nil:
		var r Reading
		if json.Unmarshal(raw, &r) == nil {
			c.hits.Add(1)
			return r, true
		}
		// corrupt entry — treat as a miss and overwrite below
	case errors.Is(err, redis.Nil):
		c.misses.Add(1)
	default:
		// CACHE FAILURE MUST NOT BE REQUEST FAILURE. Log it, fall through
		// to the database, keep serving.
		c.errs.Add(1)
		c.log.Warn("cache read failed", "key", key, "err", err)
	}

	r, ok := c.inner.Latest(fighter)
	if !ok {
		return Reading{}, false
	}
	if b, err := json.Marshal(r); err == nil {
		if err := c.rdb.Set(ctx, key, b, c.jittered()).Err(); err != nil {
			c.log.Warn("cache write failed", "key", key, "err", err)
		}
	}
	return r, true
}

func (c *CachedStore) Leaderboard(n int) []Reading {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	key := boardKey(n)

	if raw, err := c.rdb.Get(ctx, key).Bytes(); err == nil {
		var out []Reading
		if json.Unmarshal(raw, &out) == nil {
			c.hits.Add(1)
			return out
		}
	} else if !errors.Is(err, redis.Nil) {
		c.errs.Add(1)
		c.log.Warn("cache read failed", "key", key, "err", err)
	} else {
		c.misses.Add(1)
	}

	out := c.inner.Leaderboard(n)
	if b, err := json.Marshal(out); err == nil {
		_ = c.rdb.Set(ctx, key, b, c.jittered()).Err()
	}
	return out
}

func (c *CachedStore) Record(r Reading) {
	c.inner.Record(r) // database first: it is the source of truth

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	// INVALIDATE, don't update. Two concurrent writers updating the cache can
	// interleave and leave the older value in place forever. Deletion can't.
	if err := c.rdb.Del(ctx, fighterKey(r.Fighter)).Err(); err != nil {
		c.log.Warn("invalidate failed", "fighter", r.Fighter, "err", err)
	}

	// The leaderboard is derived from all fighters, so any write invalidates
	// every variant. Scanning keys is fine at this scale; at real scale you
	// would keep the ranking in a Redis sorted set instead (see below).
	iter := c.rdb.Scan(ctx, 0, "scouter:board:*", 100).Iterator()
	for iter.Next(ctx) {
		_ = c.rdb.Del(ctx, iter.Val()).Err()
	}
}

// Stats reports hit ratio. Export these as metrics in Capsule 25.
func (c *CachedStore) Stats() (hits, misses, errs uint64, ratio float64) {
	h, m, e := c.hits.Load(), c.misses.Load(), c.errs.Load()
	if h+m > 0 {
		ratio = float64(h) / float64(h+m)
	}
	return h, m, e, ratio
}
```

Cableálo en `main.go`:

```go
	if addr := os.Getenv("REDIS_ADDR"); addr != "" {
		cached := scouter.NewCachedStore(store, addr, 30*time.Second, log)
		defer cached.Close()
		store = cached
		log.Info("cache enabled", "addr", addr, "ttl", "30s")
	}
```

Exponé las estadísticas para poder verlas:

```go
	mux.HandleFunc("GET /cache-stats", func(w http.ResponseWriter, r *http.Request) {
		type statser interface {
			Stats() (uint64, uint64, uint64, float64)
		}
		s2, ok := s.store.(statser)
		if !ok {
			writeErr(w, http.StatusNotFound, "cache not enabled")
			return
		}
		h, m, e, ratio := s2.Stats()
		writeJSON(w, http.StatusOK, map[string]any{
			"hits": h, "misses": m, "errors": e, "hit_ratio": ratio,
		})
	})
```

### Paso 3 — medí la diferencia con honestidad

```bash
docker compose up -d postgres redis

# baseline: no cache
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" make run
k6 run scripts/load/stress.js 2>&1 | grep -E 'http_req_duration|http_reqs'
```

```bash
REDIS_ADDR=localhost:6379 \
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" make run

k6 run scripts/load/stress.js 2>&1 | grep -E 'http_req_duration|http_reqs'
curl -s localhost:8080/cache-stats | jq
```

| | sin cache | con cache | cambio |
|---|---|---|---|
| p50 | | | |
| p95 | | | |
| p99 | | | |
| RPS | | | |
| hit ratio | — | | |

### Paso 4 — la medición de reducción de carga que realmente importa

El hit ratio es vanidad. La carga de la base es el número.

```bash
docker compose exec -T postgres psql -U scouter -d scouter \
  -c "SELECT pg_stat_statements_reset();" 2>/dev/null || true

docker compose exec -T postgres psql -U scouter -d scouter -tAc \
  "SELECT sum(calls) FROM pg_stat_statements;" 2>/dev/null

# or, simpler and always available:
docker compose exec -T postgres psql -U scouter -d scouter -tAc \
  "SELECT xact_commit + xact_rollback FROM pg_stat_database WHERE datname='scouter';"
```

Tomá ese contador antes y después de cada corrida de k6. Calculá:

```
  load reduction = 1 - (transactions_with_cache / transactions_without_cache)
```

Comparalo con tu hit ratio. **No van a coincidir**, y entender por qué es el punto
de este paso: el 10% que falla son las queries caras.

### Paso 5 — matá Redis en pleno vuelo

```bash
k6 run --vus 20 --duration 40s scripts/load/stress.js &
sleep 10
docker compose stop redis
```

Mirá el servicio. Tiene que:
- seguir devolviendo 200
- ponerse más lento (ahora cada request pega en Postgres)
- loguear warnings de `cache read failed`

```bash
sleep 10
docker compose start redis
wait
```

**Degradado, no roto.** Esa es la propiedad para la que hay que diseñar, y viene
enteramente de tres decisiones del código: timeouts cortos de cache, caer al
siguiente nivel ante un error, y nunca tratar un cache miss como una falla del
request.

Ahora rompelo a propósito — cambiá la rama de error para que devuelva un error al
cliente, volvé a correr, y mirá tu disponibilidad colapsar en cuanto Redis
hipa. Después volvelo atrás.

### Paso 6 — la estructura de datos correcta para un leaderboard

Escanear claves para invalidar un leaderboard está bien a este tamaño y mal a
escala. Redis tiene una estructura hecha a medida:

```bash
redis-cli
> ZADD scouter:live 9001 goku 8500 vegeta 530000 frieza 1400000 broly
> ZREVRANGE scouter:live 0 4 WITHSCORES     # top 5, O(log n + m)
> ZINCRBY scouter:live 500 goku             # atomic increment
> ZREVRANK scouter:live goku                # "what rank am I?" — O(log n)
> ZCARD scouter:live
```

Un **sorted set** mantiene el ranking de forma incremental en cada escritura. Sin
invalidación, sin recomputación, sin escaneo — y `ZREVRANK` responde "¿qué puesto
tengo?", que es genuinamente caro en SQL.

**Esta es la lección real de la cápsula:** el mejor cache muchas veces no es una
copia cacheada del resultado de una query, sino *una estructura de datos distinta
que mantiene la respuesta a medida que ocurren las escrituras.* Probá implementar
`Leaderboard` con `ZREVRANGE` y compará.

```bash
docker compose down
```

---

## En GCP

> **Solo concepto.** Memorystore no tiene free tier: alrededor de **USD 25–35/mes**
> mínimo para la instancia de Redis más chica. Redis en Docker para los labs.

**Memorystore para Redis** — Redis gestionado. Tier Basic (un nodo, datos perdidos
ante falla) y tier Standard (réplica + failover automático). Es solo interno a la
VPC, así que Cloud Run necesita un **Serverless VPC Access connector** para
alcanzarlo, que es su propio costo chico y una sorpresa común.

**Memorystore para Memcached** — más simple, multi-hilo, sin persistencia, sin
estructuras de datos. Elegí Redis salvo que quieras específicamente la simplicidad
de Memcached.

Otras capas de caching de GCP, para que conozcas la escalera completa:

- **Cloud CDN** — respuestas HTTP en el borde (Cápsula 16).
- **Cloud Storage + CDN** — assets estáticos.
- **BigQuery** cachea resultados de queries idénticas por 24 h, gratis.
- **El buffer pool de Cloud SQL** — gratis, ya está corriendo, y se pasa por alto.

Nota de costo: Memorystore se factura por GB-hora la uses o no. Un cache que no
necesitás es pura pérdida — otra razón para medir la reducción de carga de la base
antes de agregar uno.

---

## Llevátelo al trabajo

- **Cache-aside es el default.** Invalidá al escribir, nunca actualices.
- **Una falla de cache tiene que degradar, no fallar.** Timeouts cortos, caer al
  siguiente nivel, loguearlo, seguir sirviendo.
- **Medí la reducción de carga de la base de datos, no el hit ratio.**
- **Siempre poné jitter en los TTL.**
- **Configurá una política de evicción explícita.** `noeviction` es el default y va
  a convertir un cache lleno en una caída.
- **Nunca cachees datos personalizados bajo una clave compartida.** Poné la
  identidad del usuario en la clave o no lo cachees.
- **Nombrá y versioná tus claves** (`svc:v2:entidad:id`) para que un cambio de
  schema sea un bump de prefijo en vez de una migración.
- **Considerá la estructura de datos, no solo la copia.** Los sorted sets, los HLL
  y los bitmaps a menudo le ganan a cachear el resultado de una query.

---

## Battle drill

<details>
<summary><b>1.</b> 95% de hit ratio, y la base de datos sigue al 100% de CPU. Explicá.</summary>

El hit ratio cuenta *requests*, no *costo*. El 5% que falla es la cola cara:
queries sin índice, scans grandes, reportes raros pero pesados. El 95% cacheado
eran las baratas, que nunca fueron el problema.

También es posible: la tasa total de requests creció, así que el 5% de un número
mucho más grande sigue siendo mucho; o las escrituras (que nunca se cachean) son la
carga real; o tu invalidación es tan agresiva que las claves populares se
recomputan constantemente.

Diagnosticalo con `pg_stat_statements` ordenado por `total_exec_time` — eso
muestra en qué está gastando tiempo la base *realmente*, que normalmente no es lo
que cacheaste.
</details>

<details>
<summary><b>2.</b> ¿Por qué invalidar en vez de actualizar el cache al escribir?</summary>

Los escritores concurrentes se pueden intercalar:

```
  W1 writes DB (value=10)
  W2 writes DB (value=20)
  W2 updates cache (20)
  W1 updates cache (10)   ← the older value wins, permanently
```

El cache ahora tiene 10 mientras la base tiene 20, y nada lo va a arreglar hasta
que expire el TTL. Con borrado, el peor resultado es un miss extra, y la próxima
lectura repuebla desde la fuente de verdad.

Sigue habiendo una carrera menor con cache-aside (un lector puede poblar un valor
viejo entre la escritura a la DB y el borrado del escritor). Mitigaciones: borrar
*después* de la escritura a la DB (como hace el código), usar TTLs cortos como red
de seguridad, o usar claves versionadas para que una escritura vieja nunca pueda
pisar una más nueva.
</details>

<details>
<summary><b>3.</b> ¿Cuándo es correcto un cache en proceso?</summary>

Cuando los datos son **inmutables o efectivamente inmutables**: configuración
cargada al arrancar, templates o regexes compilados, defaults de feature flags,
datos de referencia que cambian con el deploy.

Es la elección correcta ahí porque es 20.000× más rápido que un salto de red y no
tiene modo de falla.

Es la elección equivocada para cualquier cosa visible al usuario y mutable, porque
cada réplica tiene su propia copia, la invalidación no se propaga, y los usuarios
reciben respuestas distintas según qué instancia los atendió — exactamente el bug
de la Cápsula 06, reintroducido.

El punto medio que usan los sistemas reales: un cache en proceso chico con un TTL
muy corto (1–5 s) delante de Redis, para absorber tráfico de claves calientes.
Obsolescencia acotada que aceptaste explícitamente.
</details>

<details>
<summary><b>4.</b> Diseñá un cache para un feed por usuario.</summary>

La clave tiene que incluir al usuario: `feed:v1:user:{id}:page:{cursor}`. Nunca una
clave compartida — ese es el bug donde el usuario A ve los datos del B, y es un
incidente serio, no un problema de performance.

TTL corto (30–60 s) porque los feeds cambian; invalidá ante las acciones del propio
usuario para que valga read-your-writes (el problema de la Cápsula 13 con otro
disfraz).

Cuidado con la memoria: una entrada por usuario por página son millones de claves.
Cacheá solo la primera página (la abrumadora mayoría de las lecturas), guardá
*ids* en vez de objetos hidratados, y cacheá los objetos por separado para que se
compartan entre feeds.

A escala real precomputarías los feeds al escribir (fan-out-on-write) en una lista
de Redis por usuario — convirtiendo un join en tiempo de lectura en un push en
tiempo de escritura, que es la Cápsula 20.
</details>

<details>
<summary><b>5.</b> Redis se cayó. ¿Qué debería hacer tu servicio?</summary>

**Servir desde la base de datos, más lento.** Los errores de cache tienen que
atraparse, loguearse y caer al siguiente nivel. Un cache es una optimización; un
servicio que falla cuando su optimización falla convirtió la optimización en una
dependencia.

Requisitos para que eso sea real:
- **Timeouts cortos** (100–500 ms). Un Redis colgado no puede volverse más lento
  que la base que debía acelerar.
- **Un circuit breaker** (Cápsula 17) para dejar de llamar a un cache muerto y no
  pagar el timeout en cada request.
- **Margen de capacidad** — ¿la base sobrevive al 100% del tráfico? Si no, el cache
  es estructural, y necesitás Redis con HA más un plan (load shedding, respuestas
  degradadas) para cuando se caiga igual.
- **Una alerta sobre el colapso del hit ratio**, no solo sobre Redis inalcanzable —
  un cache que está arriba pero desalojando todo es la falla más traicionera.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `dial tcp: connection refused` | Redis no está arriba, o usaste el nombre del container desde el host. `localhost:6379` desde el host, `redis:6379` desde un container. |
| `OOM command not allowed when used memory > maxmemory` | `maxmemory-policy` está en `noeviction`. Poné `allkeys-lru`. |
| Hit ratio cercano a cero | Las claves difieren en cada request (un timestamp o un valor aleatorio en la clave), o el TTL es más corto que el intervalo entre requests. Imprimí las claves. |
| Datos viejos después de escribir | La invalidación no corre, o borra una clave construida distinto. Usá una sola función compartida para armar claves. |
| El cache es más lento que la base | Costo de serialización en valores grandes, o un salto de red para una query que tardaba 0,2 ms. No todo merece un cache. |
| La memoria sigue creciendo | Claves sin TTL. `redis-cli --scan \| head` y después `TTL <clave>` — cualquier cosa que devuelva `-1` es inmortal. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(cache): cache-aside decorator over Store with redis

Capsule 14. Jittered TTLs, invalidate-not-update on write, short timeouts and
fall-through so a cache outage degrades rather than fails. Measured database
load reduction separately from hit ratio — they differ substantially."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 14
```

**Siguiente:** [Cápsula 15 · Tácticas de las Fuerzas Ginyu — Cuando el cache te traiciona](../15-ginyu-force-cache-failures/README.md)
