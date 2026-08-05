# Cápsula 21 · La máquina del tiempo de Trunks — Arquitectura event-driven

> *Trunks viaja al pasado para advertir a todos sobre los Androides. Funciona — y
> no arregla su propio futuro, porque cambiar el pasado crea una línea temporal
> nueva en vez de editar la vieja. Eso es un log append-only: nunca mutás la
> historia, la agregás al final, y reproducirla desde otro punto produce un
> presente distinto.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 9 | 80 min | Cápsulas 18–20 | Local |

---

## Por qué existe esta cápsula

La Cápsula 18 dejó un agujero:

```go
  store.Record(reading)      // ✅ committed
  publisher.Publish(event)   // ✗ process dies. Downstream never learns.
```

Ese es el **problema de la doble escritura**, y es imposible de arreglar con orden,
reintentos o cuidado. Esta cápsula lo cierra bien, y al hacerlo introduce la idea que
hace tratables a los sistemas grandes: **el log de lo que pasó es la fuente de
verdad, y toda otra vista se deriva de él.**

---

## El concepto

### El transactional outbox

No podés escribir atómicamente a una base de datos y a un broker de mensajes. Pero
*sí* podés escribir atómicamente dos filas a la misma base.

```
  ┌─ ONE TRANSACTION ──────────────────────┐
  │  INSERT INTO readings (...)            │
  │  INSERT INTO outbox (event, payload)   │
  └────────────────────────────────────────┘
                    │
         a separate relay process
                    │
                    ▼
              publish to Pub/Sub  ──► mark the outbox row sent
```

Ahora la garantía es limpia: **si los datos de negocio commitearon, el evento
existe.** El relay puede publicar un mensaje dos veces (crash después del publish,
antes de marcarlo), así que tenés **at-least-once** — que la Cápsula 19 ya hizo
inofensivo.

Este es el patrón más importante de esta cápsula y uno de los más útiles de los
sistemas de producción en general.

### Change data capture (CDC)

En vez de que tu aplicación escriba eventos, leé el propio log de replicación de la
base:

```
   Postgres WAL ──► Debezium / Datastream ──► Kafka / Pub/Sub ──► consumers
```

**A favor:** captura a *todos* los escritores, incluidas migraciones, herramientas
de admin y servicios de otros equipos. Sin cambios de aplicación. Nunca se pierde una
escritura.

**En contra:** los eventos son *cambios de filas*, no eventos de dominio. Los
consumidores quedan acoplados a tu schema — renombrá una columna y los rompés. Hay
complejidad operativa real, y necesita `wal_level = logical` más replication slots
(que te van a llenar el disco si un consumidor se detiene).

**Outbox vs CDC:** el outbox produce eventos de dominio significativos al costo de
código de aplicación; CDC produce eventos con forma de schema al costo de
acoplamiento. Un híbrido común es **CDC sobre la tabla outbox** — obtenés eventos
bien diseñados *y* captura garantizada, sin relay que operar.

### Event sourcing (y por qué probablemente no lo quieras entero)

El event sourcing completo guarda *solo* eventos; el estado actual es un fold sobre
ellos.

```
  events:  Created{power: 100} → Increased{by: 50} → Decreased{by: 20}
  state:   fold(events) = 130
```

**A favor:** una pista de auditoría perfecta, viaje en el tiempo ("¿cómo se veía
esto el martes?"), modelos de lectura nuevos construidos reproduciendo la historia, y
debugging por replay.

**En contra:** cada lectura es un fold (así que necesitás snapshots), la evolución de
schema es genuinamente difícil porque nunca podés borrar una forma vieja de evento, y
la sobrecarga mental es real. Borrar datos por GDPR es doloroso en un almacén
append-only.

**"Event sourcing liviano" es lo que la mayoría de los sistemas debería hacer:**
mantené estado mutable normal como fuente de verdad, *y* agregá un log inmutable de
eventos al lado. Obtenés auditoría, replay e integración sin convertir cada lectura
en un fold.

### Coreografía vs orquestación

```
  CHOREOGRAPHY                       ORCHESTRATION
  each service reacts to events      a coordinator tells services what to do

  Order ──► OrderPlaced             ┌──────────────┐
              ├─► Payment            │ Orchestrator │──► Payment
              ├─► Inventory          │              │──► Inventory
              └─► Shipping           │              │──► Shipping
                                     └──────────────┘

  + loose coupling                   + the flow is explicit and visible
  + easy to add reactors             + easy to see where it failed
  - nobody knows the whole flow      - the coordinator is a coupling point
  - hard to debug                    - it can grow into a monolith
```

**Usá coreografía** para fan-out con forma de notificación ("pasó algo; el que le
importe, que reaccione"). **Usá orquestación** para procesos de negocio multi-paso
con compensación — checkout, onboarding, reembolsos. La regla práctica: si un humano
lo dibujaría como un diagrama de flujo con ramas de error, orquestalo.

### Sagas

Una transacción distribuida, hecha de transacciones locales más compensaciones:

```
  reserve inventory  →  charge card  →  ship
        │                    │
        │              (card fails)
        │                    ▼
        └────────── release inventory (compensate)
```

Las compensaciones **no son rollbacks** — son acciones nuevas hacia adelante que
deshacen el efecto. No podés des-enviar un mail; mandás una disculpa. No podés
des-cobrar; reembolsás. Esta distinción importa, porque las compensaciones pueden
fallar ellas mismas y hay que reintentarlas, lo que significa que tienen que ser
idempotentes (Cápsula 19).

### Evolución de schema

Los eventos sobreviven al código que los escribió. Reglas:

- **Solo agregá campos opcionales.** Nunca saques, nunca renombres, nunca cambies el
  tipo o el significado de un campo.
- **Versioná explícitamente** — un campo `version` en el payload (Cápsula 18) o un
  nombre de topic/tipo versionado.
- **Los consumidores ignoran campos desconocidos.** El parseo estricto que rechaza
  campos extra convierte cada cambio del productor en un cambio incompatible.
- **Para cambiar el significado, emití un tipo de evento nuevo.** `PowerRecordedV2`
  junto a V1, y retirá V1 cuando nada lo consuma.
- **Usá un schema registry** para cualquier cosa seria: schemas de Pub/Sub,
  Confluent Schema Registry. Convierte los chequeos de compatibilidad en una falla de
  build en vez de una de producción.

---

## Lab

### Paso 1 — la tabla outbox

```sql
-- deploy/sql/004_outbox.sql
CREATE TABLE outbox (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id      UUID        NOT NULL UNIQUE,
    aggregate     TEXT        NOT NULL,        -- e.g. 'fighter'
    aggregate_id  TEXT        NOT NULL,        -- e.g. 'goku'
    event_type    TEXT        NOT NULL,        -- 'power.recorded'
    payload       JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,                 -- NULL = not yet sent
    attempts      INT         NOT NULL DEFAULT 0,
    last_error    TEXT
);

-- A PARTIAL index: only unpublished rows. Stays tiny even when the table
-- holds millions of published rows.
CREATE INDEX idx_outbox_unpublished ON outbox (created_at)
    WHERE published_at IS NULL;
```

### Paso 2 — escribí ambos en una transacción

**`internal/scouter/outbox.go`**

```go
package scouter

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// RecordWithOutbox writes the reading AND its event in ONE transaction.
//
// This is the fix for the dual-write problem: there is no window in which the
// data is committed but the event is lost, because they commit together or
// not at all.
func (s *PostgresStore) RecordWithOutbox(ctx context.Context, r Reading) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var fighterID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO fighters (name) VALUES ($1)
		ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		RETURNING id`, r.Fighter).Scan(&fighterID); err != nil {
		return fmt.Errorf("upsert fighter: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO readings (fighter_id, power, recorded_at)
		VALUES ($1, $2, $3)`,
		fighterID, r.Power, r.RecordedAt); err != nil {
		return fmt.Errorf("insert reading: %w", err)
	}

	eventID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"event_id":    eventID,
		"fighter":     r.Fighter,
		"power":       r.Power,
		"recorded_at": r.RecordedAt,
		"version":     1,
	})
	if err != nil {
		return err
	}

	// Same transaction. This is the whole point.
	if _, err := tx.Exec(ctx, `
		INSERT INTO outbox (event_id, aggregate, aggregate_id, event_type, payload)
		VALUES ($1, 'fighter', $2, 'power.recorded', $3)`,
		eventID, r.Fighter, payload); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}

	return tx.Commit(ctx)
}
```

### Paso 3 — el relay

**`cmd/relay/main.go`**

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cloud.google.com/go/pubsub"
	"github.com/jackc/pgx/v5/pgxpool"
)

// relay publishes unsent outbox rows and marks them published.
//
// It may publish the same event twice (crash after publish, before UPDATE),
// so this is at-least-once — which Capsule 19 already made harmless.
// Do not try to make it exactly-once. You cannot, and you do not need to.
func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	client, err := pubsub.NewClient(ctx, os.Getenv("PUBSUB_PROJECT_ID"))
	if err != nil {
		log.Error("pubsub", "err", err)
		os.Exit(1)
	}
	defer client.Close()

	topic := client.Topic(os.Getenv("TOPIC_ID"))
	topic.EnableMessageOrdering = true
	defer topic.Stop()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	log.Info("relay online")
	for {
		select {
		case <-ctx.Done():
			log.Info("relay offline")
			return
		case <-ticker.C:
			if n, err := drain(ctx, pool, topic, log); err != nil {
				log.Error("drain failed", "err", err)
			} else if n > 0 {
				log.Info("relayed", "count", n)
			}
		}
	}
}

func drain(ctx context.Context, pool *pgxpool.Pool, topic *pubsub.Topic, log *slog.Logger) (int, error) {
	// FOR UPDATE SKIP LOCKED lets several relay instances run concurrently
	// without processing the same rows. It is the standard "queue in
	// Postgres" primitive and worth remembering on its own.
	rows, err := pool.Query(ctx, `
		SELECT id, event_id, aggregate_id, event_type, payload
		FROM outbox
		WHERE published_at IS NULL
		ORDER BY id
		LIMIT 100
		FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return 0, err
	}

	type row struct {
		id        int64
		eventID   string
		aggID     string
		eventType string
		payload   []byte
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.eventID, &r.aggID, &r.eventType, &r.payload); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, r)
	}
	rows.Close()

	published := 0
	for _, r := range batch {
		res := topic.Publish(ctx, &pubsub.Message{
			Data: r.payload,
			Attributes: map[string]string{
				"event_type": r.eventType,
				"event_id":   r.eventID,
			},
			OrderingKey: r.aggID, // per-aggregate ordering
		})
		if _, err := res.Get(ctx); err != nil {
			// Leave published_at NULL: it will be retried next tick.
			_, _ = pool.Exec(ctx,
				`UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
				r.id, err.Error())
			log.Warn("publish failed, will retry", "outbox_id", r.id, "err", err)
			continue
		}
		if _, err := pool.Exec(ctx,
			`UPDATE outbox SET published_at = now() WHERE id = $1`, r.id); err != nil {
			// Published but not marked: it will publish again next tick.
			// That is a DUPLICATE, not a loss — and duplicates are handled.
			log.Warn("published but not marked", "outbox_id", r.id, "err", err)
		}
		published++
	}
	return published, nil
}
```

### Paso 4 — probá que sobrevive a un crash

```bash
cd deploy && docker compose up -d postgres pubsub && cd ..
export PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber
./scripts/pubsub-setup.sh

# API writing through the outbox — relay NOT running
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" make run

for f in goku vegeta piccolo; do
  curl -s -XPOST localhost:8080/readings -d "{\"fighter\":\"$f\",\"power\":$((RANDOM*10))}" >/dev/null
done

psql "postgres://scouter:kamehameha@localhost:5432/scouter" -c \
  "SELECT id, event_type, aggregate_id, published_at FROM outbox ORDER BY id;"
```

Tres filas, `published_at` en NULL. **Los eventos están a salvo en la base de
datos.** El broker nunca estuvo involucrado, y no se perdió nada.

Ahora arrancá el relay:

```bash
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" \
PUBSUB_PROJECT_ID=gravity-chamber TOPIC_ID=power-readings \
  go run ./cmd/relay
```

Se publican, y `published_at` se llena. **Esta es la propiedad que te faltaba**: que
el broker esté caído, o que el proceso muera, ya no pierde eventos.

Probá el caso del crash:

```bash
# take the broker away entirely
docker compose stop pubsub

curl -s -XPOST localhost:8080/readings -d '{"fighter":"broly","power":1400000}' | jq
# ✅ 201. The API doesn't care.

psql "postgres://scouter:kamehameha@localhost:5432/scouter" -tAc \
  "SELECT count(*) FROM outbox WHERE published_at IS NULL;"
# 1 — waiting

docker compose start pubsub
# the relay catches up on its own
```

### Paso 5 — CDC, con replicación lógica real

Postgres puede transmitir cambios lógicos sin ninguna participación de la
aplicación.

```bash
docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
ALTER SYSTEM SET wal_level = 'logical';
SQL
docker compose restart postgres
sleep 5

docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
-- a publication says WHICH tables to stream
CREATE PUBLICATION scouter_changes FOR TABLE readings, fighters;

-- a slot is a durable cursor into the WAL
SELECT pg_create_logical_replication_slot('cdc_demo', 'pgoutput');
SQL
```

Generá cambios y leelos como un stream de cambios:

```bash
curl -s -XPOST localhost:8080/readings -d '{"fighter":"gohan","power":200000}' >/dev/null

docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT lsn, xid, left(data, 120) FROM pg_logical_slot_peek_changes(
       'cdc_demo', NULL, NULL, 'proto_version','1','publication_names','scouter_changes');"
```

Estás leyendo el propio log de cambios de la base — sin código de aplicación. Esto
es exactamente lo que consumen Debezium y Datastream.

> ⚠️ **La trampa operativa, y es seria:** un replication slot que nadie lee hace que
> Postgres **retenga WAL para siempre**. Se te llena el disco y la base se para.
> Siempre monitoreá el lag del slot, y borrá los que no usás:

```bash
docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT slot_name, active,
          pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
   FROM pg_replication_slots;"

docker compose exec -T postgres psql -U scouter -d scouter -c \
  "SELECT pg_drop_replication_slot('cdc_demo');"
```

### Paso 6 — replay, que es el punto de todo esto

Como el outbox es una historia append-only, podés reconstruir cualquier vista
derivada.

```bash
psql "postgres://scouter:kamehameha@localhost:5432/scouter" <<'SQL'
-- a new read model, built from scratch by replaying history
TRUNCATE fighter_ranks, processed_events;

-- reset the log so everything is unpublished again
UPDATE outbox SET published_at = NULL;
SQL
```

Reiniciá el relay. Cada evento se republica, los consumidores reconstruyen
`fighter_ranks` desde cero, y — **como el consumidor es idempotente (Cápsula 19)** —
el resultado es correcto en vez de duplicado.

**Ese es el rédito.** Un modelo de lectura nuevo, un arreglo de bug en una
proyección, o una migración a otro almacén es un *replay*, no un proyecto de
migración de datos.

Probalo: cambiá `Handle` para que también compute `max_power`, truncá, reproducí. El
campo nuevo queda poblado para toda la historia.

```bash
cd deploy && docker compose down
```

---

## En GCP

- **Datastream** — CDC gestionado desde Cloud SQL/MySQL/Oracle hacia BigQuery o
  Cloud Storage. Maneja slots, snapshots y drift de schema por vos. Esta es la forma
  de bajo esfuerzo de tener una copia analítica sin tocar código de aplicación.
- **Eventarc** — rutea eventos de 90+ servicios de GCP (un objeto creado en GCS, una
  entrada de audit log de Cloud SQL, un mensaje de Pub/Sub) hacia Cloud Run. Pegamento
  útil.
- **Workflows** — un orquestador gestionado: pasos definidos en YAML/JSON con
  reintentos, manejo de errores y estado. La herramienta correcta para sagas
  orquestadas cuando no querés correr un motor de workflows.
- **Cloud Tasks** — para la mitad de "llamá a este endpoint después, con reintentos"
  de una saga.
- **Schemas de Pub/Sub** — Avro o Protocol Buffers atados a un topic, con
  verificación de compatibilidad al publicar. Convierte un cambio incompatible en un
  error de publicación en vez de una caída de consumidores:

```bash
gcloud pubsub schemas create power-recorded --type=AVRO --definition-file=schema.avsc
gcloud pubsub topics create power-readings \
  --schema=power-recorded --message-encoding=JSON
```

- **Los change streams de Spanner** y los **triggers de Firestore** te dan CDC de
  forma nativa si estás en esos almacenes.

---

## Llevátelo al trabajo

- **Transactional outbox para todo evento que no se puede perder.** Es una tabla y
  un relay, y elimina una categoría entera de incidentes de "a aguas abajo le faltan
  datos".
- **Aceptá at-least-once del relay.** Los consumidores idempotentes lo vuelven un no
  problema; perseguir exactly-once desperdicia meses.
- **`FOR UPDATE SKIP LOCKED`** es cómo corrés varios relays (y cómo construís una
  cola en Postgres en general).
- **Índice parcial sobre las filas sin publicar**, y podá las publicadas.
- **Monitoreá el lag de los replication slots.** Un slot abandonado llena el disco y
  tira abajo la base.
- **Los eventos son append-only y solo aditivos.** Campos opcionales nuevos, tipos de
  evento nuevos, nunca cambios incompatibles.
- **Coreografía para notificaciones, orquestación para procesos de negocio.**
- **Diseñá para el replay desde el día uno** — es lo que convierte "necesitamos
  hacer un backfill" de un proyecto en una tarde.

---

## Battle drill

<details>
<summary><b>1.</b> ¿Por qué no podés publicar el evento primero y escribir a la base después?</summary>

Porque podés publicar un evento sobre algo que nunca pasó. Si la escritura a la base
falla, los consumidores ya reaccionaron — mandaron el mail, cobraron la tarjeta,
actualizaron el índice — por un estado que no existe. Eso es peor que un evento
faltante, porque ahora tus sistemas se contradicen activamente.

Publicar después del commit tiene la falla opuesta (los datos existen, nadie se
entera), que al menos es *consistente* y recuperable por reconciliación.

Ningún orden es seguro, que es el punto: **dos escrituras independientes no se
pueden hacer atómicas ordenándolas.** El outbox funciona porque convierte dos
escrituras en una — las dos filas van en la misma transacción, en la misma base.
</details>

<details>
<summary><b>2.</b> ¿Outbox o CDC?</summary>

**Outbox** cuando querés eventos de *dominio* — contratos significativos, bien
formados y estables (`PowerRecorded`, no "se insertó una fila en readings"). Los
consumidores dependen de tu schema de eventos, que controlás a propósito, así que
podés refactorizar las tablas libremente. Cuesta código de aplicación y un relay que
operar.

**CDC** cuando no podés cambiar la aplicación, cuando existen otros escritores que no
controlás (migraciones, herramientas de admin, otro equipo), o cuando querés una
copia analítica sin nada de código. Cuesta acoplamiento de schema — los consumidores
ahora dependen de tus nombres de columnas — más cuidado operativo real con los
replication slots.

**El híbrido que conviene conocer:** corré **CDC sobre la tabla outbox**. Obtenés
eventos de dominio diseñados a propósito *y* captura garantizada directo del WAL, sin
proceso de relay que operar. Debezium soporta este patrón explícitamente.
</details>

<details>
<summary><b>3.</b> Diseñá el checkout como una saga: reservar inventario, cobrar tarjeta, enviar.</summary>

**Orquestada**, no coreografiada — esto tiene ramas de error y un humano lo dibujaría
como un diagrama de flujo.

Camino hacia adelante: `ReservarInventario` → `CobrarTarjeta` → `CrearEnvío`.

Compensaciones, aplicadas al revés: `LiberarInventario`, `ReembolsarCobro`. Ojo que
estas son *acciones nuevas*, no rollbacks — no podés des-cobrar una tarjeta, la
reembolsás, y eso aparece en el resumen del cliente.

Los detalles que hacen que funcione de verdad:
- **Cada paso y cada compensación es idempotente** (Cápsula 19) — se van a
  reintentar.
- **Persistí el estado de la saga** para que un orquestador que crashea retome en vez
  de reiniciar.
- **Timeouts por paso**, con una decisión sobre qué significa un timeout: ¿el pago
  quizás tuvo éxito? Necesitás consultar en vez de asumir.
- **Algunos pasos no se pueden compensar.** Un mail enviado, un paquete despachado.
  Ordená la saga para que los pasos irreversibles vayan *últimos*.
- **Exponé los estados parciales al usuario** honestamente ("pago recibido, envío
  demorado") en vez de fingir que es atómico.

En GCP, Workflows es un orquestador gestionado razonable para esto.
</details>

<details>
<summary><b>4.</b> ¿Deberías usar event sourcing completo?</summary>

Normalmente no, y las razones honestas vale la pena enunciarlas.

**Sí cuando:** la pista de auditoría es un requisito duro (finanzas, salud, dominios
regulados); el negocio genuinamente piensa en eventos (trading, libros contables,
reservas); necesitás viaje en el tiempo como feature; o esperás construir muchos
modelos de lectura distintos desde los mismos hechos.

**No cuando:** tu dominio tiene forma de CRUD; el equipo nunca lo hizo antes (la
curva de aprendizaje es empinada y los errores son estructurales); necesitás queries
ad-hoc sobre el estado actual (cada lectura es un fold, así que necesitás snapshots y
proyecciones); o tenés requisitos de borrado por GDPR (borrar de un log inmutable es
genuinamente doloroso — la respuesta habitual es crypto-shredding, que es su propio
proyecto).

**El punto medio pragmático**, y lo que construye esta cápsula: mantené estado
mutable como fuente de verdad *y* agregá un log inmutable de eventos. Obtenés
auditoría, integración y replay, sin nada del costo de "cada lectura es un fold". La
mayoría de los equipos que adoptan "event sourcing" con éxito en realidad están
haciendo esto.
</details>

<details>
<summary><b>5.</b> ¿Cómo evolucionás un schema de eventos con 12 consumidores que no controlás?</summary>

**Nunca lo rompés.** Asumí que no podés coordinar un deploy simultáneo, porque no
podés.

- **Solo aditivo** — los campos nuevos tienen que ser opcionales con defaults
  sensatos.
- **Nunca saques, renombres ni cambies el tipo de un campo**, y nunca cambies el
  *significado* de un campo manteniendo su nombre. Esa última es la ruptura más
  traicionera.
- **Significado nuevo → tipo de evento nuevo.** Publicá `PowerRecordedV2` junto a V1
  durante una ventana de deprecación, después retirá V1 cuando la telemetría muestre
  que nada lo consume. (Lo que significa que necesitás telemetría de consumidores.)
- **Los consumidores tienen que ignorar campos desconocidos.** El parseo estricto
  convierte cada cambio del productor en una caída.
- **Schema registry con chequeos de compatibilidad** — schemas de Pub/Sub o el
  registry de Confluent — para que un cambio incompatible falle al publicar, en CI, y
  no en producción.
- **Versión en el payload** (Cápsula 18) para que los consumidores puedan ramificar
  cuando tengan que hacerlo.
- **Anunciá y medí las deprecaciones.** "V1 se retira en 90 días" más un dashboard de
  quién lo sigue usando.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| Las filas del outbox nunca se publican | El relay no está corriendo, o `TOPIC_ID` está mal. Mirá `attempts` y `last_error` — están para eso. |
| Eventos duplicados después de reiniciar el relay | Esperado: publicado-pero-no-marcado. Tu consumidor idempotente lo maneja. |
| Dos relays procesan las mismas filas | Omitiste `FOR UPDATE SKIP LOCKED`. |
| El cambio de `wal_level` no tiene efecto | Necesita un reinicio completo, no `pg_reload_conf()`. |
| Se llena el disco de la base de datos | Un replication slot inactivo reteniendo WAL. Mirá `pg_replication_slots` y borralo. |
| El replay duplica los datos | El consumidor no es idempotente. Esa es la Cápsula 19, y el replay es exactamente por qué importa. |
| La tabla outbox está enorme | Podá las filas publicadas: `DELETE FROM outbox WHERE published_at < now() - interval '7 days'`. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(events): transactional outbox and relay; CDC exploration

Capsule 21. Closes the dual-write gap from Capsule 18: business data and its
event now commit in one transaction, and a relay publishes with SKIP LOCKED
so it can run multiple instances. Verified events survive a broker outage.
Explored logical replication as CDC, including the slot-fills-the-disk trap.
Rebuilt a read model by replaying the outbox."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 21
```

**Siguiente:** [Cápsula 22 · Danza de la Fusión — Partir el monolito](../22-fusion-dance-microservices/README.md)
