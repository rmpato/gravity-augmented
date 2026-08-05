# Cápsula 20 · Genkidama — Fan-in, fan-out y batch

> *Goku levanta las manos y le pide un poco de energía a cada ser vivo. Ninguna
> contribución individual importa. El agregado destruye a Kid Buu. También tarda
> muchísimo en cargarse, que es el trade-off entero del procesamiento por lotes.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 8 | 80 min | Cápsulas 18–19 | Local + ☁️ opcional |

---

## Por qué existe esta cápsula

Tenés eventos fluyendo. Ahora tenés que *agregarlos* — leaderboards, totales
diarios, estadísticas por peleador, analítica.

Hacerlo ingenuamente (recomputar en cada lectura) no escala; hacerlo mal (recomputar
en cada escritura) tampoco. Esta cápsula es sobre las tres formas del trabajo de
agregación, y la pregunta más importante de la ingeniería de datos: **¿computás al
escribir o al leer?**

---

## El concepto

### Fan-out y fan-in

```
  FAN-OUT (one → many)              FAN-IN (many → one)

    event ─┬→ ranker                  worker ─┐
           ├→ notifier                worker ─┼→ aggregate → result
           ├→ indexer                 worker ─┘
           └→ analytics
    parallelism, decoupling          aggregation, summarisation
```

**Fan-out-on-write vs fan-out-on-read** es el problema clásico del timeline:

| | Al escribir | Al leer |
|---|---|---|
| Llega un post | se empuja al feed de cada seguidor | se guarda una vez |
| Leer un feed | ya está armado — rápido | juntar de todos los que seguís — lento |
| Costo | proporcional a los seguidores | proporcional a las lecturas |
| Celebridad con 50M de seguidores | 50M de escrituras por un post | ningún problema |
| Usuarios inactivos | armaste feeds que nadie lee | gratis |

Los sistemas reales (el de Twitter es el caso famosamente documentado) usan
**las dos**: fan-out al escribir para usuarios normales, fan-out al leer para
celebridades, mergeados al leer. La lección generaliza — **la respuesta correcta
suele ser híbrida, elegida por la forma de la distribución.**

### Batch vs stream

| | Batch | Stream |
|---|---|---|
| Procesa | un conjunto acotado (los datos de ayer) | un flujo sin fin |
| Latencia | minutos a horas | segundos |
| Reprocesar | trivial — corrélo de nuevo | difícil — necesita replay |
| Corrección | fácil; están todos los datos | difícil; los datos llegan tarde y desordenados |
| Costo | bajo; corre en un schedule | más alto; siempre prendido |

**El batch está subestimado.** Si el negocio necesita un número diario, computarlo
una vez por día es más simple, más barato, más fácil de testear y más fácil de
arreglar que un pipeline de streaming manteniéndolo continuamente.

> **Preguntá "¿qué latencia necesita esto realmente?"** La respuesta muy a menudo es
> "para mañana a las 9", y eso es un cron job, no Dataflow.

### Ventanas

Los streams son infinitos, así que la agregación necesita una ventana:

```
  TUMBLING (fixed, non-overlapping)     [0-5)[5-10)[10-15)
    "requests per 5 minutes"

  SLIDING (fixed, overlapping)          [0-10)[5-15)[10-20)
    "average over the last 10 min, updated every 5"

  SESSION (activity-gapped)             [user active][gap][user active]
    "one browsing session"
```

**Tiempo de evento vs tiempo de procesamiento** es donde se pone difícil. Un cliente
mobile offline por una hora sube eventos con timestamps viejos. ¿A qué ventana
pertenecen?

- **Tiempo de evento** — correcto, pero tenés que decidir cuánto esperar a los
  rezagados.
- **Tiempo de procesamiento** — simple, y equivocado en cada borde.

Las **watermarks** son la respuesta: una estimación móvil de "probablemente ya vimos
todo hasta el momento T". Pasada la watermark la ventana se cierra; cualquier cosa
posterior es *dato tardío*, manejado descartándolo, emitiendo una corrección, o
escribiéndolo a una salida lateral. Todo procesador de streams serio (Dataflow/Beam,
Flink) está construido alrededor de esto.

### Lotes para throughput

La optimización de consumidor más efectiva que existe:

```
  1000 messages, one INSERT each:   1000 round trips  ≈ 2000 ms
  1000 messages, one batched INSERT:   1 round trip   ≈    15 ms
```

Agrupá por **tamaño o tiempo, lo que pase primero** — `flush cuando 500 mensajes O
200 ms transcurridos`. Solo por tamaño te frena con tráfico bajo; solo por tiempo no
ayuda bajo carga.

El trade-off es que un crash pierde el lote sin flush, así que o el trabajo tiene que
ser idempotente y reproducible desde los mensajes sin ack (Cápsula 19) o el tamaño
del lote tiene que ser lo bastante chico como para que la pérdida sea aceptable.

### OLTP vs OLAP — sistemas distintos a propósito

| | OLTP (Postgres) | OLAP (BigQuery) |
|---|---|---|
| Forma | muchas lecturas/escrituras chicas por clave | pocos scans y agregaciones enormes |
| Almacenamiento | orientado a filas | **orientado a columnas** |
| `SELECT sum(x) FROM t` sobre 1000M de filas | minutos, y le duele a todos | segundos |

El almacenamiento columnar es la razón: un agregado sobre una columna lee solo los
datos de esa columna, y los datos columnares comprimen mucho mejor porque los valores
vecinos se parecen.

**Nunca corras analítica sobre tu base de producción.** Una sola query de agregación
sin límite satura la E/S y degrada cada request de cara al usuario. Replicá a un
warehouse y consultá ahí.

---

## Lab

### Paso 1 — inserts en lote en el consumidor

Reescribí el ranker para que acumule y haga flush.

**`internal/events/batcher.go`**

```go
package events

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Batcher accumulates items and flushes on SIZE or TIME, whichever comes
// first. Size alone stalls at low traffic; time alone doesn't help under load.
type Batcher[T any] struct {
	mu      sync.Mutex
	items   []T
	maxSize int
	maxWait time.Duration
	flush   func(context.Context, []T) error
	log     *slog.Logger

	timer *time.Timer
	done  chan struct{}
}

func NewBatcher[T any](maxSize int, maxWait time.Duration,
	flush func(context.Context, []T) error, log *slog.Logger) *Batcher[T] {
	b := &Batcher[T]{
		items:   make([]T, 0, maxSize),
		maxSize: maxSize,
		maxWait: maxWait,
		flush:   flush,
		log:     log,
		done:    make(chan struct{}),
	}
	go b.ticker()
	return b
}

func (b *Batcher[T]) Add(ctx context.Context, item T) error {
	b.mu.Lock()
	b.items = append(b.items, item)
	full := len(b.items) >= b.maxSize
	b.mu.Unlock()

	if full {
		return b.Flush(ctx)
	}
	return nil
}

func (b *Batcher[T]) Flush(ctx context.Context) error {
	b.mu.Lock()
	if len(b.items) == 0 {
		b.mu.Unlock()
		return nil
	}
	batch := b.items
	b.items = make([]T, 0, b.maxSize)
	b.mu.Unlock()

	start := time.Now()
	err := b.flush(ctx, batch)
	b.log.Info("batch flushed",
		"size", len(batch), "duration_ms", time.Since(start).Milliseconds(), "err", err)
	return err
}

func (b *Batcher[T]) ticker() {
	t := time.NewTicker(b.maxWait)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			_ = b.Flush(context.Background())
		case <-b.done:
			return
		}
	}
}

// Close flushes whatever is pending. Call it on SIGTERM (Capsule 01) or you
// silently lose the last partial batch on every deploy.
func (b *Batcher[T]) Close(ctx context.Context) error {
	close(b.done)
	return b.Flush(ctx)
}
```

El flush en lote — una sentencia, muchas filas:

```go
func (r *Ranker) FlushBatch(ctx context.Context, events []PowerRecorded) error {
	if len(events) == 0 {
		return nil
	}

	rows := make([][]any, 0, len(events))
	for _, e := range events {
		rows = append(rows, []any{e.EventID, e.Fighter, e.Power, e.RecordedAt})
	}

	// pgx CopyFrom uses the Postgres COPY protocol: dramatically faster than
	// INSERT for bulk loads. The trade-off is that it cannot do ON CONFLICT,
	// so bulk-load into a temp table and merge if you need upsert semantics.
	_, err := r.pool.CopyFrom(ctx,
		pgx.Identifier{"reading_events"},
		[]string{"event_id", "fighter", "power", "recorded_at"},
		pgx.CopyFromRows(rows))
	return err
}
```

Medilo — este es el número que convence a la gente:

```bash
# publish 5000 events
for i in $(seq 1 5000); do
  EVENT="{\"event_id\":\"$(uuidgen)\",\"fighter\":\"f_$((RANDOM % 100))\",\"power\":$RANDOM}"
  printf '%s' "$EVENT" | base64
done | while read -r b64; do
  curl -s -XPOST "http://localhost:8085/v1/projects/gravity-chamber/topics/power-readings:publish" \
    -H 'Content-Type: application/json' -d "{\"messages\":[{\"data\":\"$b64\"}]}" >/dev/null
done
```

Compará el throughput del consumidor con `maxSize=1` (por mensaje) contra
`maxSize=500`. Esperá **10–50×**. Es la ganancia de performance más barata de todo
este repo.

### Paso 2 — un agregador de ventana tumbling

```go
// WindowAggregator keeps per-minute totals in memory and emits closed windows.
//
// The lateness allowance is the whole design decision: too short and you drop
// legitimate late data, too long and results are stale. It is a correctness
// vs freshness dial, and it should be a product conversation.
type WindowAggregator struct {
	mu       sync.Mutex
	windows  map[int64]map[string]int64 // windowStart -> fighter -> total
	size     time.Duration
	lateness time.Duration
	emit     func(windowStart time.Time, totals map[string]int64)
}

func (w *WindowAggregator) Add(e PowerRecorded) {
	// EVENT time, not processing time. This is what makes replay correct.
	bucket := e.RecordedAt.Truncate(w.size).Unix()

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.windows[bucket] == nil {
		w.windows[bucket] = make(map[string]int64)
	}
	w.windows[bucket][e.Fighter] += e.Power
}

// CloseExpired emits windows whose watermark has passed.
func (w *WindowAggregator) CloseExpired(now time.Time) {
	cutoff := now.Add(-w.lateness).Truncate(w.size).Unix()

	w.mu.Lock()
	defer w.mu.Unlock()
	for start, totals := range w.windows {
		if start < cutoff {
			w.emit(time.Unix(start, 0), totals)
			delete(w.windows, start) // bound the memory. Always.
		}
	}
}
```

Ahora demostrá el dato tardío:

```bash
# an event with a timestamp from 10 minutes ago
LATE="{\"event_id\":\"$(uuidgen)\",\"fighter\":\"goku\",\"power\":9001,\"recorded_at\":\"$(date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)\"}"
```

Con una tolerancia de tardanza de 2 minutos, esa ventana ya se cerró. Tus opciones
son: descartarlo (y loguearlo — descartar datos en silencio es cómo terminás con
números que nadie cree), emitir una corrección, o mandarlo a una salida lateral para
reprocesar. **Elegí una a propósito.**

### Paso 3 — fan-out al escribir vs al leer

El leaderboard, de dos formas.

**Al leer** (lo que tenés): consultar, ordenar, agregar. Costo por lectura.

**Al escribir**: mantener un sorted set de Redis a medida que llegan los eventos.

```go
// Fan-out on write: the ranking is maintained incrementally, so a read is
// a single O(log n + m) ZREVRANGE instead of a scan-and-sort.
func (r *Ranker) HandleFanoutOnWrite(ctx context.Context, e PowerRecorded) error {
	// ZADD with GT: only update if the new score is GREATER.
	// This makes it idempotent AND order-independent for a "highest power"
	// leaderboard — Capsule 19's version check, expressed as a Redis flag.
	return r.rdb.ZAdd(ctx, "leaderboard:live", redis.Z{
		Score:  float64(e.Power),
		Member: e.Fighter,
	}).Err()
}
```

Hacé benchmark de los dos bajo carga de lectura:

```bash
k6 run --vus 100 --duration 30s scripts/load/leaderboard.js
```

| | p50 | p99 | queries/s a la DB |
|---|---|---|---|
| al leer | | | |
| al escribir | | | |

El camino de escritura se puso un poco más lento; el de lectura se puso
dramáticamente más rápido. **Ese es el intercambio que estás haciendo, y deberías
poder enunciarlo en esos términos.**

### Paso 4 — un job batch programado

Eso para lo que la gente agarra un procesador de streams, hecho en 40 líneas.

**`cmd/dailyroll/main.go`**

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// dailyroll computes yesterday's per-fighter aggregates.
//
// This is a batch job on a schedule, and for a daily number that is almost
// always the right architecture: simple, cheap, trivially re-runnable, and
// easy to test. Reach for streaming when the latency requirement demands it,
// not because streaming sounds more modern.
func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	day := time.Now().UTC().AddDate(0, 0, -1).Truncate(24 * time.Hour)
	if v := os.Getenv("DAY"); v != "" { // re-runnable for a specific day
		if d, err := time.Parse("2006-01-02", v); err == nil {
			day = d
		}
	}

	start := time.Now()
	// IDEMPOTENT: re-running for the same day overwrites rather than
	// duplicating. A batch job you cannot safely re-run is a batch job you
	// will be afraid of at 3am.
	tag, err := pool.Exec(ctx, `
		INSERT INTO daily_fighter_stats
		    (day, fighter, reading_count, max_power, avg_power)
		SELECT $1::date, f.name, count(*), max(r.power), avg(r.power)::bigint
		FROM readings r
		JOIN fighters f ON f.id = r.fighter_id
		WHERE r.recorded_at >= $1 AND r.recorded_at < $1::date + interval '1 day'
		GROUP BY f.name
		ON CONFLICT (day, fighter) DO UPDATE
		SET reading_count = EXCLUDED.reading_count,
		    max_power     = EXCLUDED.max_power,
		    avg_power     = EXCLUDED.avg_power`,
		day)
	if err != nil {
		log.Error("rollup failed", "day", day, "err", err)
		os.Exit(1)
	}

	log.Info("rollup complete",
		"day", day.Format("2006-01-02"),
		"rows", tag.RowsAffected(),
		"duration_ms", time.Since(start).Milliseconds())
}
```

```sql
CREATE TABLE daily_fighter_stats (
    day           DATE   NOT NULL,
    fighter       TEXT   NOT NULL,
    reading_count INT    NOT NULL,
    max_power     BIGINT NOT NULL,
    avg_power     BIGINT NOT NULL,
    PRIMARY KEY (day, fighter)
);
```

```bash
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" \
  go run ./cmd/dailyroll

# run it again — same result, no duplicates. That's the property that matters.
```

Ahora compará el costo:

```sql
\timing on
-- on the fly, every time someone asks
SELECT f.name, count(*), max(r.power) FROM readings r
JOIN fighters f ON f.id = r.fighter_id
WHERE r.recorded_at >= CURRENT_DATE - 1 GROUP BY f.name;

-- precomputed
SELECT * FROM daily_fighter_stats WHERE day = CURRENT_DATE - 1;
```

---

## En GCP

> ### ☁️ Opcional: BigQuery
> **Free tier: 1 TiB de queries y 10 GiB de storage por mes.** Este lab usa
> kilobytes.

```bash
gcloud services enable bigquery.googleapis.com
bq mk --dataset --location=US "${PROJECT_ID}:gravity"

bq mk --table \
  --time_partitioning_field=recorded_at \
  --time_partitioning_type=DAY \
  --clustering_fields=fighter \
  "${PROJECT_ID}:gravity.readings" \
  event_id:STRING,fighter:STRING,power:INT64,recorded_at:TIMESTAMP
```

**El particionado y el clustering son el modelo de costos entero.** BigQuery factura
por bytes *escaneados*:

```sql
-- scans everything. On a real table this is the query that costs $400.
SELECT fighter, sum(power) FROM gravity.readings GROUP BY fighter;

-- prunes to one partition. Same shape, a fraction of the bytes.
SELECT fighter, sum(power) FROM gravity.readings
WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-08-02'
GROUP BY fighter;
```

Siempre filtrá por la columna de partición. `SELECT *` es caro en un almacén
columnar por la misma razón — leés todas las columnas.

**Para meter datos:**

- **Subscription de BigQuery de Pub/Sub** — una subscription que escribe directo a
  una tabla, sin código. La mejor opción cuando la forma del evento coincide con la
  tabla.
- **Storage Write API** — throughput alto, exactly-once dentro de BigQuery.
- **Carga batch desde Cloud Storage** — gratis, y lo más barato para volúmenes
  grandes.
- **Datastream** — CDC gestionado desde Cloud SQL a BigQuery (Cápsula 21).

**Dataflow** (Apache Beam gestionado) es la respuesta de streaming: ventanas,
watermarks, datos tardíos, autoscaling, y el *mismo* código de pipeline corre en
modo batch o streaming. Es potente y no es barato — un job de streaming chico corre
continuamente y factura continuamente. Agarralo cuando el requisito de latencia
genuinamente lo exija.

**Cloud Scheduler → Cloud Run job** es cómo corrés `dailyroll` en producción:

```bash
gcloud scheduler jobs create http daily-rollup \
  --schedule="0 2 * * *" --time-zone="UTC" \
  --uri="https://dailyroll-xyz.run.app/run" \
  --oidc-service-account-email="scheduler-sa@${PROJECT_ID}.iam.gserviceaccount.com"
```

**Teardown:** `bq rm -r -f "${PROJECT_ID}:gravity"`

---

## Llevátelo al trabajo

- **Agrupá en lotes todo consumidor de alto volumen.** Por tamaño *o* tiempo, y
  flush al apagar.
- **Preguntá qué latencia necesita realmente el negocio** antes de construir un
  stream. "Para las 9" es un cron job.
- **Precomputá lo que se lee mucho más de lo que se escribe.** Enunciá el ratio
  lectura:escritura cuando lo propongas.
- **Usá tiempo de evento, no de procesamiento**, y decidí tu tolerancia de tardanza
  explícitamente.
- **Nunca corras analítica sobre la base OLTP.**
- **Particioná y clusterizá las tablas del warehouse**, y siempre filtrá por la
  columna de partición.
- **Hacé los jobs batch idempotentes y re-ejecutables para un día específico.** Vas a
  necesitar re-ejecutarlos.
- **Acotá toda agregación en memoria.** Un map sin límite indexado por id de usuario
  es un OOM con retardo.

---

## Battle drill

<details>
<summary><b>1.</b> Diseñá un leaderboard de "top 10 peleadores" para 10M de peleadores y 100k lecturas/seg.</summary>

100k lecturas/seg contra cualquier base computando un top-10 no es viable, así que
el ranking tiene que mantenerse, no computarse.

- **Sorted set de Redis**, actualizado al escribir (`ZADD`). `ZREVRANGE 0 9` es
  O(log n + 10) y trivialmente cacheable.
- **Cacheá el top-10 renderizado** con TTL de 1–5 s. 100k lecturas/seg colapsan a ~1
  recomputación por segundo, y singleflight (Cápsula 15) protege la recomputación.
- **Ponelo en el CDN** si es de lectura pública — entonces nunca llega a tu servicio
  (Cápsula 16).
- **Updates idempotentes** con `ZADD GT` para que los eventos reproducidos no lo
  corrompan.
- **Camino de reconstrucción**: un job batch que recomputa el conjunto entero desde
  la fuente de verdad, porque un ranking solo-en-Redis eventualmente se desvía.

Fijate en la forma: 100k lecturas/seg de la *misma* respuesta es un problema de
caching, no de base de datos. La pregunta interesante es el camino de escritura y
cómo reconstruís después de una divergencia.
</details>

<details>
<summary><b>2.</b> ¿Fan-out al escribir o al leer para un feed social?</summary>

**Híbrido**, y hay que poder decir por qué.

Fan-out al escribir para usuarios normales: cuando postean, empujás el id del post a
la lista de feed de cada seguidor. Las lecturas son entonces una sola query de rango.
El costo es proporcional a la cantidad de seguidores.

Fan-out al leer para celebridades: un usuario con 50 millones de seguidores
generaría 50 millones de escrituras por post. En vez de eso, guardás el post una vez
y lo mergeás al leer para quien siga a una celebridad.

Merge al leer: `feed = lista_precomputada ∪ posts_de_celebridades`, ordenado.

Otras consideraciones reales: no hagas fan-out a usuarios inactivos (armá su feed a
demanda cuando vuelvan); hacé el fan-out asíncrono para que postear siga siendo
rápido; y guardá *ids* en los feeds, hidratando el contenido aparte para que una
edición no requiera reescribir millones de filas.

El umbral entre los dos caminos es un parámetro que ajustás según tu distribución de
cantidad de seguidores.
</details>

<details>
<summary><b>3.</b> Explicá tiempo de evento vs tiempo de procesamiento con una falla concreta.</summary>

Una app mobile está offline de 10:00 a 11:00 y bufferea eventos. A las 11:00 los
sube todos.

**Tiempo de procesamiento:** cada evento cae en la ventana de las 11:00. Tu dashboard
muestra actividad cero entre 10:00 y 11:00 y un pico enorme a las 11:00. El dato está
mal de una forma que parece un evento real, así que alguien va a investigar el
"pico".

**Tiempo de evento:** cada evento lleva su timestamp verdadero y va a su ventana
correcta. Pero esas ventanas cerraron hace una hora — ¿y ahora?

Para eso están las watermarks y las tolerancias de tardanza: la ventana espera un
período configurado pasado su fin antes de finalizar. Cualquier cosa posterior es
*dato tardío*, y elegís descartarlo (y contarlo), emitir una corrección, o rutearlo a
una salida lateral para reprocesar.

La regla general: **tiempo de evento para corrección, tiempo de procesamiento solo
cuando genuinamente no te importa.** Y siempre emití una métrica de datos tardíos
descartados — la pérdida silenciosa es cómo terminás con números que nadie cree.
</details>

<details>
<summary><b>4.</b> ¿Cuándo es mejor batch que streaming?</summary>

- **El requisito de latencia lo permite.** Reportes diarios, corridas de
  facturación, sets de entrenamiento de ML, mails semanales.
- **Reprocesar importa.** ¿Encontraste un bug? Corré de nuevo lo de ayer. En
  streaming eso es un proyecto de replay.
- **El cómputo necesita todos los datos** — percentiles globales, conteos distintos
  exactos, joins sobre el dataset completo.
- **Costo.** Un job batch corre 10 minutos por día; un pipeline de streaming corre
  1.440.
- **Simplicidad.** Sin watermarks, sin datos tardíos, sin semántica de ventanas, sin
  infraestructura siempre prendida que operar.

Streaming gana cuando: el requisito de latencia son segundos, el valor del dato
decae rápido (detección de fraude, alertas, dashboards en vivo), o el volumen es
demasiado grande para procesarlo por lotes de forma económica.

Muchos sistemas maduros corren los dos — la **arquitectura lambda**: streaming para
una respuesta rápida aproximada, batch para una corrección autoritativa nocturna.
</details>

<details>
<summary><b>5.</b> Tu job batch tarda 6 horas y la ventana es de 4. ¿Qué hacés?</summary>

**Entendé primero.** Perfilalo: ¿es CPU, E/S, una etapa lenta, o sesgo de datos donde
una partición tiene la mayor parte del trabajo?

Después, más o menos en orden de esfuerzo:
- **Incremental en vez de recomputar todo** — procesá solo lo que cambió desde la
  última corrida. Normalmente la mayor ganancia y frecuentemente pasada por alto.
- **Particioná y paralelizá** — dividí por día, tenant o hash y corré las partes
  concurrentemente.
- **Arreglá la query** — esto es un job batch pegándole a una base; la Cápsula 11
  aplica entera.
- **Movelo al motor correcto** — una agregación de 6 horas en Postgres puede ser de 3
  minutos en BigQuery, porque es un problema de scan columnar.
- **Relajá el requisito** — ¿realmente tiene que ser diario, o cada 4 horas sobre una
  ventana móvil serviría mejor al negocio igual?
- **Pasalo a streaming** — si tiene que ser continuo, la agregación incremental por
  stream es la respuesta estructural. El cambio más grande, el costo más grande.

Y sin importar qué: **hacelo reanudable**, para que una falla en la hora 5 no
signifique empezar de cero.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| El lote nunca hace flush con tráfico bajo | Sin disparador por tiempo. Para eso está el ticker. |
| Se pierde el último lote al apagar | No llamaste a `Close()` en SIGTERM. Cableálo al graceful shutdown de la Cápsula 01. |
| `CopyFrom` falla con duplicados | COPY no puede hacer `ON CONFLICT`. Cargá a una tabla temporal y `INSERT … SELECT … ON CONFLICT`. |
| La memoria de las ventanas crece para siempre | Nunca borrás las ventanas cerradas. `delete(w.windows, start)` después de emitir. |
| Los eventos tardíos desaparecen en silencio | Esperado, si esa es tu política — pero emití una métrica. Los descartes silenciosos destruyen la confianza en los números. |
| La factura de BigQuery es enorme | Falta el filtro de partición, o `SELECT *`. Mirá "bytes processed" antes de correr algo grande. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(events): batching, windowed aggregation, and a daily rollup

Capsule 20. Size-or-time batcher took consumer throughput up ~20x via
CopyFrom. Event-time tumbling windows with an explicit lateness allowance.
Compared fan-out-on-write (redis sorted set) with fan-out-on-read.
Idempotent, re-runnable daily rollup job."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 20
```

**Siguiente:** [Cápsula 21 · La máquina del tiempo de Trunks — Arquitectura event-driven](../21-time-machine-event-driven/README.md)
