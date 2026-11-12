# Cápsula 15 · Tácticas de las Fuerzas Ginyu — Cuando el cache te traiciona

> *Las Fuerzas Ginyu son individualmente fuertes y colectivamente ridículas.
> Insisten en posar en formación antes de cada pelea, atacan de a uno, y pierden
> por su propia coordinación. Una estampida de cache es exactamente esto: mil
> requests perfectamente razonables, llegando en sincronización perfecta,
> destruyendo lo que venían a proteger.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 8 | 80 min | Cápsula 14 | Local |

---

## Por qué existe esta cápsula

La Cápsula 14 te dio un cache. Esta cubre todo lo que sale mal con él — y estas
fallas comparten una propiedad que las hace peligrosas: **solo aparecen bajo
carga.** Tu cache funciona perfecto en dev, en staging, y en producción hasta
justo el momento en que más importa.

Cada falla acá tiene un nombre, un mecanismo y una solución específica. Conocerlas
por nombre es la mayor parte de la batalla, porque el síntoma ("la base de datos se
cayó exactamente a las 14:00:00") es de otro modo desconcertante.

---

## El concepto

### Estampida de cache / thundering herd

Expira una clave popular. 1.000 requests concurrentes fallan simultáneamente. Los
1.000 consultan la base por la misma fila. La base, que servía 10 QPS, de golpe
recibe 1.000 — y estas son las queries *caras* sin cachear.

```
  t=0.000   key expires
  t=0.001   1000 requests miss
  t=0.002   1000 identical queries hit the database
  t=0.500   database saturated, everything slows
  t=2.000   requests time out, clients retry, 2000 queries arrive
  t=5.000   outage
```

**Tres soluciones, y querés más de una:**

1. **Coalescencia de requests (singleflight).** Solo el *primer* miss de una clave
   hace el trabajo; los que llaman en paralelo esperan y comparten su resultado.
   Una query en vez de mil. Estas son las 20 líneas de mayor valor de la cápsula.
2. **Expiración temprana probabilística (XFetch).** Antes de que termine el TTL,
   cada request tiene una chance chica y creciente de refrescar la clave temprano.
   Los refrescos se reparten en el tiempo en vez de caer todos en un instante.
3. **Stale-while-revalidate.** Servís el valor viejo al instante y refrescás en
   segundo plano. La latencia se mantiene plana; el costo es obsolescencia acotada.

### Penetración de cache

Requests por claves que **no existen en ningún lado**. Cada una falla el cache,
consulta la base, no encuentra nada, no cachea nada — así que el próximo request
idéntico hace todo de nuevo.

Inocentemente: un recurso borrado todavía linkeado desde algún lado.
Maliciosamente: un atacante pidiendo ids aleatorios para saltear tu cache por
completo y martillar la base directo.

**Soluciones:** cachear también el resultado negativo (con TTL corto, por ejemplo
30 s); o un **filtro de Bloom** de las claves existentes delante del cache — un
conjunto probabilístico que responde "definitivamente no está" en tiempo constante
y unos pocos MB.

### Claves calientes

Una clave recibe una porción desproporcionada del tráfico — una celebridad, un
item de portada, un evento en vivo. Esa clave vive en **un** nodo de Redis, así
que ninguna cantidad de escalado del cluster ayuda; ese nodo se satura.

**Soluciones:** un cache en proceso chico (TTL de 1–5 s) delante de Redis, para
que la mayoría de los requests calientes nunca salgan del proceso; o **partición de
clave** — escribir a `key:goku:0..9` y leer una al azar, repartiendo el mismo valor
entre nodos.

### Avalancha de cache

Todo expira a la vez — un reinicio masivo, un flush, un deploy que limpió el
cache, o mil claves creadas juntas con TTLs idénticos.

**Soluciones:** jitter en los TTL (Cápsula 14); calentar el cache antes de tomar
tráfico; escalonar los deploys para que nunca hagas flush de todo simultáneamente.

### Consistent hashing (para clusters de cache)

Con `hash(clave) % N` sobre N nodos de cache, perder uno remapea ~todas las claves
— tu cache entero se invalida en el peor momento posible (un nodo acaba de morir).

El **consistent hashing** pone nodos y claves en un anillo. Cada clave pertenece al
siguiente nodo en sentido horario. Sacar un nodo solo reasigna *sus* claves —
`1/N` en vez de todo.

```
             node A
          ·         ·
      ·                 ·
   ·      k1   k2         ·  node B
   ·                      ·
      ·      k3        ·
          ·         ·
             node C

  node B dies → only k2 moves (to C). k1 and k3 are untouched.
```

Los **nodos virtuales** — cada nodo físico ocupa ~150 posiciones del anillo —
mantienen la distribución pareja y hacen que sacar un nodo reparta su carga entre
todos los sobrevivientes en vez de volcarla sobre un vecino.

### La invalidación es la parte difícil

> "Solo hay dos cosas difíciles en Ciencias de la Computación: la invalidación de
> caches y nombrar cosas." — Phil Karlton

Estrategias, de más débil a más fuerte:

- **Solo TTL** — simple, siempre eventualmente correcto, siempre a veces viejo.
- **Invalidación explícita al escribir** — correcta si encontrás *todos* los
  caminos de escritura. No lo vas a hacer; los jobs batch, las herramientas de
  admin y las migraciones esquivan tu servicio.
- **Claves versionadas** — subís un número de versión en vez de borrar.
  `user:{id}:v{version}` — las entradas viejas se vuelven inalcanzables y expiran
  solas. Sin borrado, sin carrera.
- **Invalidación por eventos** — la base emite eventos de cambio (CDC, Cápsula 21)
  y un consumidor invalida. Agarra a todos los escritores, incluidos los que no
  controlás.
- **Write-through** — cache y almacén actualizados juntos, así que no pueden
  divergir.

---

## Lab

### Paso 1 — construí una estampida

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d postgres redis
cd ..
REDIS_ADDR=localhost:6379 \
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" make run
```

Agregá un endpoint deliberadamente caro para que la estampida se vea.
En `postgres.go`:

```go
// SlowLeaderboard simulates an expensive uncached query — the kind that is
// fine at 10 QPS and fatal at 1000.
func (s *PostgresStore) SlowLeaderboard(n int) []Reading {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _ = s.pool.Exec(ctx, "SELECT pg_sleep(0.3)")
	return s.Leaderboard(n)
}
```

Apuntá `/leaderboard` a él temporalmente, poné el TTL del cache en 5 segundos, y:

```bash
# 200 concurrent requests, timed to land right as the key expires
curl -s "localhost:8080/leaderboard" > /dev/null      # populate
sleep 5                                               # let it expire

time (for i in $(seq 1 200); do
        curl -s -o /dev/null localhost:8080/leaderboard &
      done; wait)
```

Mirá la base mientras pasa:

```bash
docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT count(*), state FROM pg_stat_activity WHERE datname='scouter' GROUP BY state;"
```

Decenas de queries idénticas, todas computando la misma respuesta. **Esa es la
estampida.** Anotá el tiempo transcurrido.

### Paso 2 — singleflight

```bash
go get golang.org/x/sync/singleflight
```

> Mismo detalle que en la Cápsula 10: revisá `head -3 go.mod` después y mantené
> el tag `FROM golang:` de tu Dockerfile igual o por encima de la directiva `go`.

**`internal/scouter/coalesced.go`**

```go
package scouter

import (
	"golang.org/x/sync/singleflight"
)

// Coalescer collapses concurrent identical cache misses into ONE call to the
// underlying loader. The other callers block briefly and share the result.
//
// This is the single highest-value pattern in cache engineering: it turns a
// 1000x database spike into a 1x one, in about twenty lines.
type Coalescer struct {
	group singleflight.Group
}

// Do runs fn for key, sharing the result with any concurrent callers.
func (c *Coalescer) Do(key string, fn func() (any, error)) (any, bool, error) {
	v, err, shared := c.group.Do(key, fn)
	return v, shared, err
}
```

Usalo en `CachedStore`:

```go
type CachedStore struct {
	inner Store
	rdb   *redis.Client
	log   *slog.Logger
	ttl   time.Duration
	sf    singleflight.Group          // <-- add this

	hits, misses, errs, coalesced atomic.Uint64
}
```

```go
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
	}
	c.misses.Add(1)

	// MISS: only one goroutine per key does the work.
	v, err, shared := c.sf.Do(key, func() (any, error) {
		out := c.inner.Leaderboard(n)
		if b, err := json.Marshal(out); err == nil {
			bg, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			defer cancel()
			_ = c.rdb.Set(bg, key, b, c.jittered()).Err()
		}
		return out, nil
	})
	if shared {
		c.coalesced.Add(1) // this request rode along on someone else's work
	}
	if err != nil {
		return nil
	}
	return v.([]Reading)
}
```

Volvé a correr el Paso 1:

```bash
curl -s localhost:8080/leaderboard > /dev/null
sleep 5
time (for i in $(seq 1 200); do curl -s -o /dev/null localhost:8080/leaderboard & done; wait)

docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname='scouter' AND state='active';"
```

**Una query en vez de doscientas.** El tiempo total también debería bajar
dramáticamente, porque 199 requests esperaron 300 ms en vez de encolarse uno detrás
de otro en la base.

> **Limitación importante:** singleflight es *por proceso*. Con 10 réplicas tenés
> 10 queries, no 1 — que sigue siendo una mejora de 20×. Para coalescencia global
> real necesitás un lock distribuido (`SET key val NX PX 5000`), donde una
> instancia gana el derecho a recomputar y las otras esperan o sirven datos viejos.

### Paso 3 — negative caching

```bash
for i in $(seq 1 100); do
  curl -s -o /dev/null "localhost:8080/fighters/nonexistent_$RANDOM"
done
```

Cada uno de esos pega en Postgres. Ahora cacheá los misses. En
`CachedStore.Latest`:

```go
	r, ok := c.inner.Latest(fighter)
	if !ok {
		// NEGATIVE CACHE: remember that this doesn't exist, briefly.
		// Short TTL so a newly created fighter appears quickly.
		// Without this, an attacker requesting random ids bypasses the cache
		// entirely and queries your database directly, every time.
		_ = c.rdb.Set(ctx, key, "null", 30*time.Second).Err()
		return Reading{}, false
	}
```

Y manejalo al leer:

```go
	raw, err := c.rdb.Get(ctx, key).Bytes()
	if err == nil {
		if string(raw) == "null" {
			c.hits.Add(1)
			return Reading{}, false      // cached negative
		}
		...
	}
```

Volvé a correr el loop y mirá las queries a la base caer a casi cero para los
repetidos.

**El trade-off:** creá un peleador que hace poco fue pedido-y-no-encontrado, y se
queda invisible hasta 30 segundos. Por eso el TTL negativo es corto — y por eso
invalidás la clave al crear.

### Paso 4 — construí una clave caliente y después absorbela

```bash
# 90% of traffic to one fighter
cat > /tmp/hot.js <<'EOF'
import http from 'k6/http';
export const options = { vus: 50, duration: '30s' };
export default function () {
  const f = Math.random() < 0.9 ? 'goku' : `f_${Math.floor(Math.random()*2000)}`;
  http.get(`http://localhost:8080/fighters/${f}`);
}
EOF
k6 run /tmp/hot.js
```

```bash
redis-cli --stat        # ops/sec — nearly all for one key
redis-cli OBJECT FREQ scouter:fighter:goku   # needs maxmemory-policy allkeys-lfu
```

Ahora agregá un cache en proceso minúsculo — la mitigación estándar de claves
calientes:

```go
// A 1-second in-process cache in front of Redis. Bounded staleness of ONE
// SECOND, in exchange for removing hot-key load from the network entirely.
// This is safe here precisely because the staleness window is tiny and
// explicit; it is the Capsule 06 trap only if you forget the TTL.
type localEntry struct {
	r       Reading
	ok      bool
	expires time.Time
}

type CachedStore struct {
	// …
	local   sync.Map // string -> localEntry
	localTTL time.Duration
}

func (c *CachedStore) Latest(fighter string) (Reading, bool) {
	if v, found := c.local.Load(fighter); found {
		e := v.(localEntry)
		if time.Now().Before(e.expires) {
			return e.r, e.ok
		}
	}
	r, ok := c.latestFromRedisOrDB(fighter)   // the previous body
	c.local.Store(fighter, localEntry{r: r, ok: ok, expires: time.Now().Add(c.localTTL)})
	return r, ok
}
```

Volvé a correr el load test. Las ops/seg de Redis para la clave caliente deberían
colapsar.

### Paso 5 — consistent hashing, medido

```bash
go get github.com/cespare/xxhash/v2
```

**`internal/scouter/ring.go`**

```go
package scouter

import (
	"sort"
	"strconv"

	"github.com/cespare/xxhash/v2"
)

// Ring is a consistent hash ring with virtual nodes.
// Removing a node reassigns only that node's keys (~1/N), instead of the
// ~all-of-them you get with hash(key) % N.
type Ring struct {
	replicas int
	hashes   []uint64          // sorted positions on the ring
	owner    map[uint64]string // position -> node name
}

func NewRing(replicas int, nodes ...string) *Ring {
	r := &Ring{replicas: replicas, owner: make(map[uint64]string)}
	for _, n := range nodes {
		r.Add(n)
	}
	return r
}

func (r *Ring) Add(node string) {
	for i := 0; i < r.replicas; i++ {
		h := xxhash.Sum64String(node + "#" + strconv.Itoa(i))
		r.hashes = append(r.hashes, h)
		r.owner[h] = node
	}
	sort.Slice(r.hashes, func(i, j int) bool { return r.hashes[i] < r.hashes[j] })
}

func (r *Ring) Remove(node string) {
	kept := r.hashes[:0]
	for _, h := range r.hashes {
		if r.owner[h] == node {
			delete(r.owner, h)
			continue
		}
		kept = append(kept, h)
	}
	r.hashes = kept
}

// Get returns the node that owns key: the first ring position clockwise.
func (r *Ring) Get(key string) string {
	if len(r.hashes) == 0 {
		return ""
	}
	h := xxhash.Sum64String(key)
	i := sort.Search(len(r.hashes), func(i int) bool { return r.hashes[i] >= h })
	if i == len(r.hashes) {
		i = 0 // wrap around
	}
	return r.owner[r.hashes[i]]
}
```

**`internal/scouter/ring_test.go`** — probá la propiedad en vez de creerla:

```go
package scouter

import (
	"fmt"
	"testing"
)

func TestRingRemapsFewKeysOnNodeLoss(t *testing.T) {
	keys := make([]string, 100000)
	for i := range keys {
		keys[i] = fmt.Sprintf("fighter_%d", i)
	}

	ring := NewRing(150, "cache-a", "cache-b", "cache-c", "cache-d")
	before := make(map[string]string, len(keys))
	for _, k := range keys {
		before[k] = ring.Get(k)
	}

	ring.Remove("cache-c")

	moved := 0
	for _, k := range keys {
		if ring.Get(k) != before[k] {
			moved++
		}
	}
	pct := float64(moved) / float64(len(keys)) * 100
	t.Logf("consistent hashing: %.1f%% of keys moved when 1 of 4 nodes was removed", pct)

	// Losing 1 of 4 nodes should move ~25% — the keys that node owned.
	if pct > 35 {
		t.Errorf("moved %.1f%%, expected ~25%%", pct)
	}
}

func TestModuloRemapsAlmostEverything(t *testing.T) {
	// The comparison that makes the point.
	moved := 0
	const n = 100000
	for i := 0; i < n; i++ {
		h := xxhashString(fmt.Sprintf("fighter_%d", i))
		if h%4 != h%3 {
			moved++
		}
	}
	t.Logf("modulo hashing: %.1f%% of keys moved when going from 4 to 3 nodes",
		float64(moved)/n*100)
}
```

Agregá el helper minúsculo a `ring.go`:

```go
func xxhashString(s string) uint64 { return xxhash.Sum64String(s) }
```

```bash
go test ./internal/scouter/ -run 'Ring|Modulo' -v
```

Deberías ver más o menos **26% contra ~75%**. Ese hueco — perder un cuarto de tu
cache contra perder tres cuartos, en el momento exacto en que un nodo acaba de
morir — es por qué todo cache distribuido y todo datastore shardeado usa un
anillo.

```bash
cd deploy && docker compose down
```

---

## En GCP

- **Memorystore Redis Cluster** shardea entre nodos usando consistent hashing
  internamente — obtenés la propiedad sin implementarla, pero igual necesitás
  entender las claves calientes, porque una clave caliente sigue viviendo en un
  solo shard.
- **Cloud CDN** tiene el mismo problema de estampida en el borde. Su
  `request coalescing` colapsa misses concurrentes del mismo objeto en un solo
  fetch al origen — la misma idea de singleflight, una capa más arriba
  (Cápsula 16).
- **El rate limiting de Cloud Armor** es tu defensa contra la penetración
  deliberada de cache: un atacante probando ids aleatorios recibe rate limiting
  antes de llegar a tu origen.
- **`stale-while-revalidate`** es una directiva estándar de `Cache-Control` que
  Cloud CDN respeta — la versión a nivel HTTP del patrón del Paso 2, y gratis.

---

## Llevátelo al trabajo

- **Poné singleflight en todo cache miss caro.** Veinte líneas, rédito enorme.
- **Jitter en todos los TTL.** Sin excepciones.
- **Cacheá negativamente los misses** con TTL corto — también es un control de
  seguridad.
- **Conocé tus claves calientes**, y poné un cache local de 1 segundo delante.
- **Consistent hashing para cualquier sharding del lado del cliente**, de cache o
  de lo que sea.
- **Versioná tus claves de cache** para que un cambio de schema sea un bump de
  prefijo y no un proyecto de invalidación.
- **Testeá el comportamiento del cache bajo concurrencia.** Estos bugs son
  invisibles en un test de un solo hilo y solo aparecen en el momento de carga
  pico.
- **Serví datos viejos en vez de fallar.** `stale-while-revalidate` es casi
  siempre la respuesta correcta para datos públicos con muchas lecturas.

---

## Battle drill

<details>
<summary><b>1.</b> Todos los días a las 14:00 exactas, la CPU de la base salta al 100% por 90 segundos. ¿Por qué?</summary>

Expiración sincronizada. Algo puebla un conjunto grande de claves de cache en el
mismo momento cada día — un job batch, un calentamiento programado, un deploy —
todas con TTL idéntico. Expiran juntas y la estampida resultante cae como un solo
pico.

Confirmalo correlacionando el pico con la tasa de cache miss y con lo que sea que
corra a las 14:00 menos el TTL.

Soluciones, en capas: **jitter** en los TTL para que la expiración se reparta en
minutos; **singleflight** para que los misses concurrentes de la misma clave
colapsen; **stale-while-revalidate** para que los usuarios nunca esperen un
refresco; y refrescar proactivamente antes de la expiración en vez de reactivamente
después.
</details>

<details>
<summary><b>2.</b> Singleflight funciona por proceso. Tenés 50 réplicas. ¿Y ahora?</summary>

Singleflight reduce 50.000 misses concurrentes a 50 — ya es una ganancia de 1000×,
y para la mayoría de los sistemas alcanza. Shippealo primero y medí.

Si 50 sigue siendo mucho (una query genuinamente cara, una base frágil):

- **Lock distribuido**: `SET lock:{key} {id} NX PX 5000`. El ganador recomputa; los
  perdedores esperan un poco y releen, o sirven datos viejos. Tiene que tener TTL,
  o un poseedor que crashee bloquea para siempre.
- **Stale-while-revalidate**: mantené dos TTLs — uno blando (refrescar) y uno duro
  (expirar). Pasado el blando, una instancia refresca en segundo plano mientras
  todos los demás siguen recibiendo el valor viejo al instante.
- **Refresco proactivo**: un job de fondo mantiene calientes las claves calientes
  para que nunca expiren bajo tráfico.

La última es la más robusta para un conjunto chico de claves conocidas como
calientes.
</details>

<details>
<summary><b>3.</b> ¿Qué es la penetración de cache y por qué es un problema de seguridad?</summary>

Requests por claves que no existen en ningún lado. Cada una falla el cache,
consulta la base, no encuentra nada, y no cachea nada — así que el cache no da
ninguna protección y cada request llega a la base.

Se vuelve un problema de seguridad porque es un **ataque de amplificación barato**:
un atacante pide `/users/{aleatorio}` a alta tasa, saltea toda tu capa de cache por
construcción, y convierte un servicio diseñado para 100 QPS de base en uno que
recibe 10.000.

Defensas: negative caching con TTL corto; un **filtro de Bloom** de ids válidos
delante del cache (tiempo constante, unos pocos MB, y "definitivamente no está" es
exactamente la respuesta que necesitás); validación de entrada rechazando formatos
de id imposibles antes de cualquier búsqueda; y rate limiting por cliente
(Cápsula 17).
</details>

<details>
<summary><b>4.</b> Compará solo-TTL, invalidación explícita y claves versionadas.</summary>

**Solo TTL** — simplísimo, sin coordinación, siempre eventualmente correcto,
siempre posiblemente viejo hasta el TTL. La elección correcta cuando la
obsolescencia acotada es aceptable, que es más seguido de lo que la gente cree.

**Invalidación explícita** — fresco de inmediato, pero solo si encontrás todos los
caminos de escritura. No lo vas a hacer: jobs batch, herramientas de admin,
migraciones, el servicio de otro equipo y SQL manual esquivan tu código de
invalidación. Además tiene carrera — un lector puede repoblar un valor viejo entre
la escritura a la DB y el borrado.

**Claves versionadas** (`user:{id}:v{n}`) — subís la versión al escribir; las
entradas viejas se vuelven inalcanzables y expiran solas. Sin borrados, sin
carrera, y funciona simultáneamente en varios caches y capas de CDN. El costo es
guardar la versión en algún lado rápido, y tener temporalmente dos generaciones en
memoria.

Los sistemas reales las combinan: claves versionadas con TTL de respaldo, más
invalidación por eventos (CDC, Cápsula 21) para agarrar a los escritores que no
controlás.
</details>

<details>
<summary><b>5.</b> Diseñá el caching para un marcador deportivo en vivo: 1M de espectadores concurrentes, los puntajes cambian cada ~30 s.</summary>

La forma de este problema es *una clave caliente, un fan-out de lectura enorme, una
tasa de escritura minúscula* — así que casi todo debería resolverse en el borde, no
en Redis.

- **CDN con TTL de 5 segundos y `stale-while-revalidate`.** 1M de espectadores se
  convierten en un puñado de requests al origen. Esto hace el 99,9% del trabajo.
- **Cache en proceso (1 s)** en cada instancia de origen, para que ni siquiera las
  revalidaciones del CDN lleguen a Redis casi nunca.
- **Redis** como fuente compartida del payload renderizado; actualizado por el
  camino de ingesta al cambiar el puntaje, no recomputado al leer.
- **Push, no polling**, para el último tramo: fan-out por WebSocket/SSE significa
  que los espectadores no generan carga de requests en absoluto. (Y ahí tu problema
  de escala pasa a ser la cantidad de conexiones, que es un problema distinto y más
  agradable.)
- **Singleflight + un lock distribuido** en el origen para que un flush de cache
  del CDN en un momento importante no genere estampida.
- **Precomputar al escribir.** Un cambio de puntaje es raro; recomputar el payload
  una vez por cambio y pushearlo es mucho más barato que computarlo por lectura.

Presupuesto de obsolescencia: 5 segundos está bien para un marcador y debería
enunciarse explícitamente — y mostrarse en la UI.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| Singleflight no tiene efecto | Estás llamando a `Do` con una clave que varía por request, o después de escribir al cache en vez de alrededor de la carga. La clave tiene que ser la *clave de cache*. |
| `shared` siempre es false | Los requests no son realmente concurrentes, o cada uno tiene clave única. Lanzalos en paralelo. |
| El cache negativo esconde registros nuevos | Esperado — ese es el TTL. Invalidá la clave al crear, y mantené corto el TTL negativo. |
| La distribución del anillo es despareja | Muy pocos nodos virtuales. 150 por nodo físico es la cifra habitual. |
| `OBJECT FREQ` da error | Requiere `maxmemory-policy allkeys-lfu`. Usá `OBJECT IDLETIME` con LRU. |
| El cache local sirve datos viejos para siempre | Guardaste la entrada pero nunca comparaste `expires`. Revisá la rama. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(cache): singleflight, negative caching, hot-key absorption

Capsule 15. Reproduced a 200-query stampede and collapsed it to 1 with
singleflight. Negative caching closes the penetration path. 1s in-process
cache absorbs hot keys. Consistent hash ring with a test proving ~25%
remap on node loss vs ~75% for modulo."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 15
```

**Siguiente:** [Cápsula 16 · Teletransportación — CDN y el borde](../16-instant-transmission-cdn/README.md)
