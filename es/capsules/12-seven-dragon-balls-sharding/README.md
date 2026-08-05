# Cápsula 12 · Las Siete Esferas — Sharding y particionado

> *Un deseo, partido en siete pedazos, desparramados por un planeta. Cada esfera
> es inútil sola. Necesitás las siete juntas, y encontrarlas es la trama entera de
> la serie. Eso es sharding: los datos están partidos a propósito, y volver a
> juntarlos es la parte cara.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 8 | 75 min | Cápsulas 10–11 | Local |

---

## Por qué existe esta cápsula

En algún momento una base de datos no puede contener tus datos ni absorber tus
escrituras. El sharding es la respuesta, y también es una de las decisiones
arquitectónicas más caras que podés tomar — elimina las transacciones entre
shards, complica cada query, y convierte agregar capacidad en un proyecto.

Así que el objetivo acá es *criterio*, no entusiasmo: sabé cómo funciona, sabé qué
cuesta, y sabé las cuatro cosas más baratas para probar antes.

---

## El concepto

### Particionado vs sharding

La gente los usa indistintamente. No son lo mismo.

```
  PARTITIONING — one database, one table split into pieces.
    Postgres knows about all of them. Transactions and joins still work.
    You get: smaller indexes, fast bulk delete (DROP a partition),
             partition pruning at query time.
    You do NOT get: more write throughput. It's still one server.

  SHARDING — many databases, each holding a subset of the data.
    Nothing knows about the others. YOUR CODE routes.
    You get: horizontal write scaling, capacity beyond one machine.
    You lose: cross-shard transactions, cross-shard joins, easy resharding,
              and a great deal of operational simplicity.
```

**El particionado es barato y a menudo suficiente. El sharding es un proyecto.**
Agarrá particionado mucho antes que sharding.

### Divisiones verticales vs horizontales

- **Particionado vertical** — distintas *columnas* o *tablas* a distintos lugares.
  "Usuarios en una DB, eventos de analítica en otra." Fácil, efectivo, y
  normalmente lo primero que deberías hacer.
- **Particionado horizontal (sharding)** — las filas de la *misma* tabla partidas
  por clave. El difícil.

### Elegir una shard key

Esta es la decisión entera. Una vez elegida es muy difícil de cambiar.

| Estrategia | Cómo | Buena | Mala |
|---|---|---|---|
| **Hash** | `hash(clave) % N` | distribución pareja, sin hotspots | las queries por rango pegan en todos los shards; el resharding mueve casi todo |
| **Rango** | `A–M`, `N–Z`, o por fecha | las queries por rango tocan un shard; fácil agregar un shard | hotspots — las fechas recientes y los prefijos populares concentran carga |
| **Directorio** | una tabla de búsqueda clave → shard | flexibilidad total, rebalanceo fácil | el directorio ahora es un cuello de botella y un punto único de falla |
| **Geo** | por región | residencia de datos, latencia baja | poblaciones desparejas |

Una buena shard key tiene tres propiedades:

1. **Alta cardinalidad** — muchos valores distintos. (`country` es mala clave;
   `user_id` es buena.)
2. **Distribución pareja de accesos** — ningún valor recibe una porción
   desproporcionada del tráfico.
3. **Aparece en la mayoría de las queries** — si no, cada query es un
   scatter-gather.

**El problema del hotspot es el que muerde.** Shardeá por `created_at` y *todas*
las escrituras de hoy van a un shard mientras los otros nueve están ociosos.
Shardeá una app social por `user_id` y la cuenta de la celebridad con 50 millones
de seguidores derrite su shard. La distribución de *datos* y la distribución de
*tráfico* son cosas distintas, y tenés que planificar para las dos.

### Scatter-gather

Una query que no incluye la shard key tiene que preguntarle a todos los shards y
mergear:

```
   SELECT * FROM readings ORDER BY power DESC LIMIT 10

   shard 0 ──┐
   shard 1 ──┼──► ask all N, take top 10 from each,
   shard 2 ──┤     merge, re-sort, take global top 10
   shard 3 ──┘
```

Tres costos que se subestiman:

- **La latencia es la del shard más lento, no el promedio.** Con 10 shards estás
  efectivamente muestreando el p99 de tu backend en cada request — un fenómeno
  llamado *amplificación de cola*.
- **La corrección de los agregados es sutil.** El top-10 global necesita el top-10
  de cada shard (bien). La *mediana* global o un `COUNT(DISTINCT)` no se pueden
  computar desde resultados por shard, sin aproximación (HyperLogLog, t-digest).
- **`OFFSET` deja de tener sentido.** La página 5 global no es la página 5 de
  ningún shard.

### Consistent hashing

El `hash(clave) % N` ingenuo significa que cambiar `N` remapea casi todas las
claves. Pasar de 4 shards a 5 mueve ~80% de tus datos.

El **consistent hashing** ubica shards y claves en un anillo; agregar un shard
mueve solo `1/N` de las claves. Con **nodos virtuales** (cada shard físico ocupando
muchas posiciones del anillo) la distribución se mantiene pareja.

Te vas a cruzar el mismo algoritmo de nuevo en la Cápsula 15 para clusters de
cache, donde es lo que evita que la falla de un nodo te invalide el cache entero.

### Las cuatro cosas para hacer antes de shardear

En orden. La mayoría de los equipos nunca necesita el paso 5.

1. **Indexá bien** (Cápsula 11). Un índice faltante se ve exactamente igual que
   "necesitamos shardear".
2. **Cacheá** (Cápsulas 14–15). Saca carga de lectura por completo.
3. **Read replicas** (Cápsula 13). Las lecturas escalan barato; solo las
   escrituras son genuinamente difíciles.
4. **Escalado vertical + particionado.** Un Postgres moderno en una instancia
   grande maneja decenas de miles de escrituras/seg. Eso es mucho negocio.
5. *Después* shardeá — o mudate a una base que shardee sola (Spanner, Bigtable,
   Vitess, Citus).

---

## Lab

### Parte A — particionado nativo de Postgres (el que sí vas a usar)

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d
docker compose exec postgres psql -U scouter -d scouter
```

```sql
-- Range-partition readings by month. Declarative partitioning: Postgres
-- routes inserts and prunes partitions at query time automatically.
CREATE TABLE readings_p (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    fighter_id  BIGINT      NOT NULL,
    power       BIGINT      NOT NULL CHECK (power >= 0),
    recorded_at TIMESTAMPTZ NOT NULL,
    -- the partition key MUST be part of the primary key
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE readings_2026_01 PARTITION OF readings_p
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE readings_2026_02 PARTITION OF readings_p
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE readings_2026_03 PARTITION OF readings_p
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- anything outside the declared ranges is rejected on insert
CREATE TABLE readings_default PARTITION OF readings_p DEFAULT;

-- Indexes created on the parent are created on every partition.
CREATE INDEX ON readings_p (fighter_id, recorded_at DESC);

INSERT INTO readings_p (fighter_id, power, recorded_at)
SELECT (random()*1999+1)::bigint,
       (random()*10000000)::bigint,
       '2026-01-01'::timestamptz + (random() * interval '89 days')
FROM generate_series(1, 500000);

ANALYZE readings_p;
```

**Mirá el pruning en acción:**

```sql
\timing on

-- one month: only ONE partition is scanned
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM readings_p
WHERE recorded_at >= '2026-02-01' AND recorded_at < '2026-03-01';

-- no partition key in the predicate: ALL partitions scanned
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM readings_p WHERE power > 9000000;
```

En el primer plan buscá `Partitions removed: 3` (o que aparezca solo un hijo). En
el segundo aparecen todas las particiones.

**Ese contraste es la lección entera del sharding**, a costo operativo cero: *las
queries que incluyen la clave son baratas; las que no, tocan todo.*

**Y la feature asesina:**

```sql
-- Deleting a month of data: instant, no dead tuples, no vacuum debt.
\timing on
DROP TABLE readings_2026_01;

-- versus what it replaces:
-- DELETE FROM readings WHERE recorded_at < '2026-02-01';   -- minutes, then vacuum
```

Para retención de series temporales esto solo ya justifica el particionado.

### Parte B — sharding real, en tu aplicación

Dos bases de datos independientes, y código Go que rutea.

**Agregá al final de** `deploy/docker-compose.yml` — esto es un fragmento, no el
archivo completo. Tus servicios `scouter`, `postgres` y `redis` quedan tal cual
están:

```yaml
  shard0:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: scouter, POSTGRES_PASSWORD: kamehameha, POSTGRES_DB: scouter }
    ports: ["5433:5432"]
    volumes: ["./sql:/docker-entrypoint-initdb.d:ro"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scouter"]
      interval: 3s
      retries: 10

  shard1:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: scouter, POSTGRES_PASSWORD: kamehameha, POSTGRES_DB: scouter }
    ports: ["5434:5432"]
    volumes: ["./sql:/docker-entrypoint-initdb.d:ro"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scouter"]
      interval: 3s
      retries: 10
```

**`internal/scouter/sharded.go`**

```go
package scouter

import (
	"context"
	"hash/fnv"
	"sort"
	"sync"
)

// ShardedStore routes by fighter name. Note what this class does NOT offer:
// cross-shard transactions, cross-shard joins, or a way to reshard without
// moving data. That is the deal you sign when you shard.
type ShardedStore struct {
	shards []*PostgresStore
}

var _ Store = (*ShardedStore)(nil)

func NewShardedStore(ctx context.Context, dsns []string) (*ShardedStore, error) {
	s := &ShardedStore{}
	for _, dsn := range dsns {
		p, err := NewPostgresStore(ctx, dsn)
		if err != nil {
			return nil, err
		}
		s.shards = append(s.shards, p)
	}
	return s, nil
}

func (s *ShardedStore) Close() {
	for _, p := range s.shards {
		p.Close()
	}
}

// shardFor is naive modulo hashing: changing len(shards) remaps almost every
// key. Capsule 15 replaces this with a consistent hash ring.
func (s *ShardedStore) shardFor(key string) *PostgresStore {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	return s.shards[int(h.Sum32())%len(s.shards)]
}

// Single-shard operations: cheap. The key is in the query.
func (s *ShardedStore) Record(r Reading) { s.shardFor(r.Fighter).Record(r) }

func (s *ShardedStore) Latest(fighter string) (Reading, bool) {
	return s.shardFor(fighter).Latest(fighter)
}

// Leaderboard is a SCATTER-GATHER: no shard key, so every shard is queried.
// Correctness note: to get a global top-n you must take the top-n from EACH
// shard. Taking top-n/len(shards) each would be wrong — one shard may hold
// all the strongest fighters.
func (s *ShardedStore) Leaderboard(n int) []Reading {
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		all []Reading
	)
	for _, sh := range s.shards {
		wg.Add(1)
		go func(p *PostgresStore) {
			defer wg.Done()
			part := p.Leaderboard(n) // full n from every shard
			mu.Lock()
			all = append(all, part...)
			mu.Unlock()
		}(sh)
	}
	wg.Wait() // total latency = the SLOWEST shard, not the average

	sort.Slice(all, func(i, j int) bool { return all[i].Power > all[j].Power })
	if len(all) > n {
		all = all[:n]
	}
	return all
}
```

Cableálo en `main.go`, controlado por una variable de entorno para poder volver:

```go
	var store scouter.Store
	if dsns := os.Getenv("SHARD_URLS"); dsns != "" {
		sharded, err := scouter.NewShardedStore(context.Background(), strings.Split(dsns, ","))
		if err != nil {
			log.Error("shards unavailable", "err", err)
			os.Exit(1)
		}
		defer sharded.Close()
		store = sharded
		log.Info("sharded store", "shards", len(strings.Split(dsns, ",")))
	} else {
		pg, err := scouter.NewPostgresStore(context.Background(), cfg.DatabaseURL)
		if err != nil {
			log.Error("database unavailable", "err", err)
			os.Exit(1)
		}
		defer pg.Close()
		store = pg
	}
	srv := scouter.NewServer(store, log)
```

Corrélo:

```bash
docker compose up -d shard0 shard1

SHARD_URLS="postgres://scouter:kamehameha@localhost:5433/scouter?sslmode=disable,postgres://scouter:kamehameha@localhost:5434/scouter?sslmode=disable" \
  DATABASE_URL=unused make run
```

```bash
for f in goku vegeta piccolo krillin frieza gohan trunks bulma yamcha tien; do
  curl -s -XPOST localhost:8080/readings \
    -d "{\"fighter\":\"$f\",\"power\":$((RANDOM * 100))}" > /dev/null
done

# where did each land?
for port in 5433 5434; do
  echo "--- shard on :$port ---"
  PGPASSWORD=kamehameha psql -h localhost -p $port -U scouter -d scouter \
    -c "SELECT f.name FROM fighters f JOIN readings r ON r.fighter_id=f.id ORDER BY f.name;"
done
```

Más o menos la mitad en cada uno. Después:

```bash
curl -s localhost:8080/leaderboard | jq   # scatter-gather across both
```

### Paso 3 — construí un hotspot a propósito

```bash
# 500 writes to the SAME fighter — one shard takes all of it
for i in $(seq 1 500); do
  curl -s -XPOST localhost:8080/readings \
    -d '{"fighter":"goku","power":9001}' > /dev/null
done

for port in 5433 5434; do
  echo -n "shard :$port readings = "
  PGPASSWORD=kamehameha psql -h localhost -p $port -U scouter -d scouter \
    -tAc "SELECT count(*) FROM readings;"
done
```

Muy despareja. **`fighter` era una mala shard key para esta carga** — los datos
estaban distribuidos parejo pero el *tráfico* no.

Escribí en `NOTES.md`: *"Una distribución pareja de datos no implica una
distribución pareja de carga."*

Las soluciones del mundo real: shardear por una clave compuesta
(`fighter_id + bucket de tiempo`), agregar una sal aleatoria a las claves calientes
y mergear al leer, o manejar a las celebridades por un camino dedicado.

### Paso 4 — sentí el dolor del resharding (experimento mental + matemática)

Tenés 2 shards. Agregás un tercero.

```
  hash("goku") % 2 = 1   →  hash("goku") % 3 = 0    MOVED
```

Calculá cuánto se mueve:

```bash
python3 - <<'PY'
import hashlib
def h(k): return int(hashlib.md5(k.encode()).hexdigest(), 16)
keys = [f"fighter_{i}" for i in range(100000)]
moved = sum(1 for k in keys if h(k) % 2 != h(k) % 3)
print(f"modulo hashing: {moved/len(keys)*100:.1f}% of keys move when 2 -> 3")
PY
```

Más o menos **dos tercios de tus datos tienen que moverse**, mientras el sistema
sigue online, sin perder escrituras, con dual-write y backfill y verificación y
cutover.

Por eso la shard key y la cantidad de shards son decisiones que tomás una vez, con
cuidado, y por eso existe el consistent hashing (Cápsula 15).

```bash
docker compose down
```

---

## En GCP

| Producto | Modelo de sharding | Usalo cuando |
|---|---|---|
| **Cloud SQL** | ninguno incorporado — shardeás en la app, como arriba | todavía no pasaste un primario |
| **Spanner** | automático, por rangos de primary key; se divide y rebalancea solo | necesitás escrituras horizontales **y** consistencia fuerte, y podés pagarlo |
| **Bigtable** | automático, por rangos de row-key | escala enorme, acceso por clave única, sin joins |
| **Firestore** | automático, por documento | documentos por usuario, tiempo real |
| **AlloyDB** | un primario, muchos read pools | el problema son las lecturas, no las escrituras |

**El diseño de claves en Bigtable y Spanner es el juego entero**, y la regla es lo
opuesto a lo que se siente natural:

```
  BAD:   rowkey = timestamp                → all writes hit the newest range.
                                             "Hotspotting on monotonic keys."
  BAD:   rowkey = user_id                  → celebrity users concentrate load
  GOOD:  rowkey = reverse(timestamp)       → spreads writes
  GOOD:  rowkey = hash(user_id) + user_id + timestamp
  GOOD:  rowkey = user_id + reverse_timestamp   (per-user time series)
```

Spanner tiene la misma trampa. Nunca hagas que un valor monótonamente creciente sea
la columna líder de una primary key de Spanner — usá un UUID, un prefijo de hash, o
una secuencia con bits invertidos.

**Chequeo de costo:** Spanner arranca alrededor de **USD 65/mes** por la unidad de
producción más chica. Es una base de datos genuinamente excelente y casi nunca es
la respuesta correcta para una startup. Decilo en voz alta en una revisión de
diseño.

---

## Llevátelo al trabajo

- **Agotá índices, caching, read replicas y escalado vertical primero.** Anotá
  cuáles probaste y qué te compró cada uno.
- **Preferí el particionado nativo** — la mayoría de los problemas de "necesitamos
  shardear" son en realidad "esta tabla es demasiado grande para hacerle vacuum y
  borrar", que el particionado resuelve.
- **La shard key es una puerta de una sola dirección.** Dedicale tiempo real y
  documentá el razonamiento en un ADR.
- **Planificá para hotspots**, no solo para datos parejos. Modelá tu distribución
  de tráfico, no tu cantidad de filas.
- **Asumí que vas a reshardear.** Usá consistent hashing o muchos más shards
  lógicos que físicos (por ejemplo 1024 shards lógicos mapeados sobre 4
  servidores — mover shards lógicos es mucho más fácil que rehashear).
- **Sabé qué queries son scatter-gather** y mantené la lista corta. Cada una es un
  amplificador de latencia de cola.

---

## Battle drill

<details>
<summary><b>1.</b> Shardeá una app SaaS multi-tenant. ¿Cuál es tu clave, y qué se rompe?</summary>

`tenant_id` es la clave natural: casi toda query tiene alcance de tenant, así que
casi todo queda en un shard, y el aislamiento entre tenants sale gratis.

Qué se rompe:
- **Tenants ballena.** Un cliente con el 60% de los datos derrite su shard.
  Mitigá dándoles un shard dedicado a los grandes (la estrategia de directorio),
  que es lo que terminan haciendo la mayoría de las plataformas SaaS reales.
- **La analítica entre tenants** se vuelve scatter-gather — empujá eso a un
  warehouse (BigQuery) en su lugar.
- **La migración de un tenant** entre shards es un proyecto real que deberías
  diseñar el día uno, no el día 900.

La respuesta habitual de producción es un **directorio/lookup** en vez de hashing
puro, precisamente porque te deja mover un tenant individual.
</details>

<details>
<summary><b>2.</b> ¿Por qué no podés hacer <code>COUNT(DISTINCT user_id)</code> entre shards?</summary>

Porque un usuario podría aparecer en varios shards, y los conteos distintos por
shard no se pueden sumar — la cardinalidad de la unión no es la suma de las
partes.

Opciones: traer todos los ids distintos a un lugar y contar (caro, a veces está
bien); usar un sketch **HyperLogLog** por shard, que *sí* es mergeable y da ~2% de
error en kilobytes; o mantener el conteo de forma incremental a medida que ocurren
las escrituras.

Esto generaliza: **sumas, conteos, mínimos y máximos se mergean trivialmente. Las
medianas, los percentiles y los conteos distintos no.** Para esos necesitás
sketches mergeables (t-digest, HLL) — que es exactamente lo que usan los sistemas
de monitoreo por la misma razón.
</details>

<details>
<summary><b>3.</b> Un usuario transfiere plata a otro, en shards distintos. ¿Cómo?</summary>

No podés usar una sola transacción ACID — ese es el costo del sharding.

- **Two-phase commit (2PC)** — correcto, pero bloquea: si el coordinador muere en
  medio del commit, los participantes retienen locks indefinidamente. Rara vez
  vale la pena.
- **Saga** — una secuencia de transacciones locales con acciones compensatorias.
  `debitar(A)` → `acreditar(B)`; si el crédito falla, `reembolsar(A)`.
  Eventualmente consistente, y cada paso tiene que ser idempotente (Cápsula 19).
- **Transactional outbox** (Cápsula 21) — el mecanismo que hace confiables a las
  sagas: escribís el cambio local y el evento saliente en una sola transacción
  local, publicás de forma asíncrona.
- **Co-ubicá entidades relacionadas.** Si las transferencias son comunes dentro de
  un hogar o una organización, shardeá por esa entidad para que el caso común
  quede en un shard.
- **Usá una base que haga transacciones distribuidas** — Spanner lo hace bien, y
  es el argumento más fuerte para pagarlo.
</details>

<details>
<summary><b>4.</b> ¿Cómo reshardeás de 4 a 8 sin downtime?</summary>

El manual estándar:

1. **Dual-write.** Escribí a la topología vieja y a la nueva; leé de la vieja.
   Deployá y dejá que se asiente.
2. **Backfill** de los datos históricos a los shards nuevos, en lotes, con
   throttling.
3. **Verificá** — compará conteos de filas y checksums por rango de claves;
   arreglá desvíos.
4. **Cambiá las lecturas** a la topología nueva detrás de un feature flag, de a
   poco (1%, 10%, 100%).
5. **Dejá de hacer dual-write**, después borrá los datos viejos.

Todos los pasos son reversibles hasta el 5, que es el punto. Semanas de trabajo.

El enfoque más barato es haberlo diseñado: **muchos shards lógicos, pocos
físicos.** Con 1024 shards lógicos sobre 4 servidores, ir a 8 significa mover
shards lógicos, no rehashear claves — horas, no semanas. Hacé esto desde el
principio.
</details>

<details>
<summary><b>5.</b> Tu servicio hace scatter-gather a 20 shards. El p50 es 8 ms, el p99 es 400 ms. ¿Por qué está tan mal el p99?</summary>

**Amplificación de cola.** Cada request espera al más lento de 20 respuestas, así
que estás muestreando la cola 20 veces. Si cada shard tiene 1% de chance de estar
lento, la probabilidad de que *al menos uno* lo esté es `1 - 0,99²⁰ ≈ 18%`. Tu p99
está construido con los p95 de tus shards.

Mitigaciones: **hedged requests** (mandá un duplicado a una réplica después de que
pasa el p95, tomá la primera respuesta — Google mostró que esto recorta
dramáticamente la latencia de cola por unos pocos por ciento de carga extra);
**timeouts por shard con resultados parciales** si la query lo tolera; reducir el
fan-out (mejor shard key, o cachear el agregado); o precomputar el agregado de
forma asíncrona (Cápsula 20).
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `no partition of relation found for row` | El valor cae fuera de todos los rangos declarados. Agregá una partición `DEFAULT`, y automatizá la creación de particiones con anticipación. |
| La clave de partición no está en la primary key | Postgres requiere que la clave de partición sea parte de toda restricción única. Incluila. |
| El pruning de particiones no ocurre | El predicado tiene que referenciar la clave de partición directamente — una función o un cast sobre ella lo deshabilita. |
| Todas las escrituras shardeadas caen en un shard | Tu clave tiene baja cardinalidad, o hasheaste el campo equivocado. Imprimí el índice de shard mientras debuggeás. |
| El scatter-gather devuelve el top-N mal | Tomaste `n/shards` por shard. Tomá el `n` completo de cada uno y mergeá. |
| Un shard es 10× más grande | Shard key equivocada, o un tenant ballena. Considerá una estrategia de directorio. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(store): sharded store and native range partitioning

Capsule 12. Range-partitioned readings by month; confirmed pruning and
instant retention via DROP partition. Added app-level hash sharding across
two databases with parallel scatter-gather. Built a hotspot on purpose:
even data distribution does not imply even load."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 12
```

**Siguiente:** [Cápsula 13 · Fusión namekiana — Replicación y consistencia](../13-namekian-fusion-replication/README.md)
