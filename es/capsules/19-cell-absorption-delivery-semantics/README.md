# Cápsula 19 · La absorción de Cell — Semánticas de entrega e idempotencia

> *Cell absorbe al Androide 17, y después intenta absorberlo de nuevo. No pasa
> nada — ya lo tiene. Eso es idempotencia: la segunda aplicación de la misma
> operación no cambia nada. El diseño entero de Cell asume que se va a encontrar
> con el mismo objetivo más de una vez, y está hecho para que no importe.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 8 | 80 min | Cápsula 18 | Local |

---

## Por qué existe esta cápsula

La Cápsula 18 terminó con el mismo mensaje procesado tres veces. Eso no era un bug
del emulador — **es la garantía que realmente tenés**, y ningún sistema de
mensajería del mundo te da una mejor gratis.

Esta cápsula es sobre diseñar para esa realidad. Es corta en infraestructura nueva y
larga en una forma de pensar que, una vez que la tenés, hace desaparecer una
categoría entera de bug de producción.

---

## El concepto

### Las tres semánticas de entrega

| Semántica | Significa | Realidad |
|---|---|---|
| **At-most-once** | 0 o 1 entregas | disparar y olvidar; perdés mensajes |
| **At-least-once** | 1 o más | ✅ lo que tenés. Hay duplicados |
| **Exactly-once** | exactamente 1 | no existe de punta a punta |

**Por qué exactly-once es imposible:** el consumidor tiene que (a) hacer el trabajo
y (b) confirmar. Esas dos cosas no pueden ser una operación atómica a través de una
red.

```
  process → crash → ack never sent → REDELIVERED   (duplicate)
  ack → crash → work never done                     (loss)
```

No hay ningún orden de esos dos pasos que sea seguro. Tenés que elegir qué falla
querés tener.

Lo que los sistemas llaman "exactly-once" siempre es alguna de estas:

- **Effectively-once**: entrega at-least-once + un **consumidor idempotente**. Esto
  es lo que construís, y es genuinamente correcto.
- **Procesamiento transaccional**: consumir y producir dentro de una transacción en
  el *mismo* sistema (la exactly-once semantics de Kafka). Correcto dentro del
  límite de ese sistema; en el momento en que escribís a una base afuera, volviste a
  at-least-once.
- Las *subscriptions* exactly-once de Pub/Sub: una feature real que elimina
  duplicados dentro del ack deadline, al costo de throughput. Angosta la ventana; no
  elimina tu necesidad de idempotencia.

> **La respuesta de ingeniería:** dejá de intentar prevenir duplicados. Hacelos
> inofensivos.

### Idempotencia, de cuatro formas

**1. Operaciones naturalmente idempotentes.** El mejor caso — no hay nada que hacer.

```sql
UPDATE fighters SET power = 9001 WHERE id = 1;   -- idempotent (absolute)
UPDATE fighters SET power = power + 100 ...;     -- NOT (relative)
```

Preferí setear valores absolutos antes que incrementos relativos siempre que puedas.

**2. Restricciones únicas.** Que la base lo imponga.

```sql
CREATE TABLE readings (
    event_id UUID PRIMARY KEY,   -- second insert of the same event fails
    ...
);
INSERT ... ON CONFLICT (event_id) DO NOTHING;
```

Barato, hermético, y funciona entre procesos y reinicios. Normalmente la respuesta
correcta.

**3. Una tabla de mensajes procesados.** Cuando el trabajo no es un solo insert.

```sql
CREATE TABLE processed_events (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

La parte crítica: **el trabajo y la marca tienen que estar en la misma
transacción.** Si no, podés hacer el trabajo, crashear antes de registrarlo, y
repetirlo.

**4. Idempotency keys** (la versión de API). El cliente genera una clave; el
servidor guarda clave → respuesta y reproduce la respuesta guardada ante una
repetición.

```http
POST /payments
Idempotency-Key: 3f2b1a...
```

Así funciona exactamente la API de Stripe, y es el patrón correcto para cualquier
endpoint no idempotente que un cliente pueda reintentar.

### El problema de la doble escritura

El bug del final de la Cápsula 18:

```go
  store.Record(reading)          // ✅ committed
  publisher.Publish(event)       // ✗ process dies here
```

Base de datos actualizada, evento nunca enviado. Aguas abajo nunca se entera. **No
existe ningún orden de dos escrituras independientes que sea seguro** — publicá
primero y podés anunciar algo que nunca pasó.

Las soluciones:

- **Transactional outbox** (Cápsula 21) — escribís el evento en una tabla `outbox`
  *en la misma transacción*, y un proceso separado publica desde ahí. La respuesta
  correcta.
- **CDC** — leés el log de replicación de la base y derivás eventos de él
  (Cápsula 21).
- **Aceptarlo, con reconciliación** — logueás la falla y corrés un job periódico que
  encuentra y reemite los eventos perdidos. Pragmático, y honesto sobre el hueco.

### Dead-letter queues

Un mensaje que falla determinísticamente va a fallar para siempre. Después de N
intentos, movelo aparte:

```
  subscription ──(5 failed attempts)──► dead-letter topic ──► a human, or a fixer job
```

Reglas que hacen que las DLQs realmente funcionen:

- **Toda subscription de producción tiene una.** Sin excepciones.
- **Alertá con profundidad > 0.** Una DLQ que nadie mira es un canal silencioso de
  pérdida de datos.
- **Guardá suficiente contexto para reproducir**: el mensaje original, el error, la
  cuenta de intentos, el timestamp.
- **Distinguí fallas permanentes de transitorias.** Un payload malformado debería ir
  a la DLQ en el intento 1; un timeout de base de datos debería reintentarse.

### El orden y los duplicados interactúan

La reentrega rompe el orden: el mensaje 5 falla y se reentrega *después* de que el 6
tuvo éxito. Si tu consumidor no es independiente del orden, ahora tenés estado
corrupto.

El patrón robusto es **chequeo de versión** — la misma idea que la concurrencia
optimista:

```sql
UPDATE fighter_ranks
   SET power = $2, version = $3
 WHERE fighter = $1 AND version < $3;   -- older events are silently ignored
```

Esto te da idempotencia *y* independencia del orden en una sola línea, sin
necesitar que el transporte garantice nada. Es el patrón más útil de esta cápsula.

---

## Lab

### Paso 1 — mirá un duplicado causar daño real

Dale al ranker un handler no idempotente — un total acumulado, que es la forma más
común de este bug:

```sql
-- deploy/sql/002_ranks.sql
CREATE TABLE fighter_ranks (
    fighter        TEXT PRIMARY KEY,
    total_power    BIGINT      NOT NULL DEFAULT 0,
    reading_count  INT         NOT NULL DEFAULT 0,
    last_version   BIGINT      NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`internal/events/ranker_naive.go`**

```go
package events

import "context"

// HandleNaive is NOT idempotent. Every delivery adds to the total, so a
// redelivery silently corrupts the data — and nothing errors, which is what
// makes this class of bug so hard to find.
func (r *Ranker) HandleNaive(ctx context.Context, e PowerRecorded) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO fighter_ranks (fighter, total_power, reading_count)
		VALUES ($1, $2, 1)
		ON CONFLICT (fighter) DO UPDATE
		SET total_power   = fighter_ranks.total_power + EXCLUDED.total_power,
		    reading_count = fighter_ranks.reading_count + 1,
		    updated_at    = now()`,
		e.Fighter, e.Power)
	return err
}
```

Publicá el mismo evento dos veces, a propósito:

```bash
export PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber

EVENT='{"event_id":"11111111-1111-1111-1111-111111111111","fighter":"goku","power":9001,"version":1}'
B64=$(printf '%s' "$EVENT" | base64)

for i in 1 2 3; do
  curl -s -XPOST \
    "http://localhost:8085/v1/projects/gravity-chamber/topics/power-readings:publish" \
    -H 'Content-Type: application/json' \
    -d "{\"messages\":[{\"data\":\"$B64\"}]}" > /dev/null
done
```

```bash
psql "postgres://scouter:kamehameha@localhost:5432/scouter" -c \
  "SELECT fighter, total_power, reading_count FROM fighter_ranks;"
```

```
 fighter | total_power | reading_count
---------+-------------+---------------
 goku    |       27003 |             3
```

**Un evento. Tres entregas. Contado triple.** No se levantó ningún error, no sonó
ninguna alerta, y los datos ahora están mal de una forma que una reconciliación
posterior tendría que detectar. Quedate un momento con eso — esta es la forma de la
mayoría de los incidentes de procesamiento duplicado.

### Paso 2 — idempotencia vía tabla de procesados

**`internal/events/ranker.go`**

```go
package events

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Ranker struct {
	pool *pgxpool.Pool
}

func NewRanker(pool *pgxpool.Pool) *Ranker { return &Ranker{pool: pool} }

// Handle is idempotent: applying the same event twice has the same effect as
// applying it once.
//
// The essential detail is that the dedup marker and the work commit in the
// SAME transaction. Insert the marker separately and you can do the work,
// crash, and repeat it — which is exactly the bug you were trying to fix.
func (r *Ranker) Handle(ctx context.Context, e PowerRecorded) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	// Claim the event. If it's already there, someone (or a past self)
	// handled it: stop, and ack.
	tag, err := tx.Exec(ctx,
		`INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`,
		e.EventID)
	if err != nil {
		return fmt.Errorf("claim: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil // duplicate — already applied. Not an error.
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO fighter_ranks (fighter, total_power, reading_count)
		VALUES ($1, $2, 1)
		ON CONFLICT (fighter) DO UPDATE
		SET total_power   = fighter_ranks.total_power + EXCLUDED.total_power,
		    reading_count = fighter_ranks.reading_count + 1,
		    updated_at    = now()`,
		e.Fighter, e.Power); err != nil {
		return fmt.Errorf("apply: %w", err)
	}

	return tx.Commit(ctx)
}
```

Agregá la tabla:

```sql
-- deploy/sql/003_processed_events.sql
CREATE TABLE processed_events (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- This table grows forever unless you prune it. The retention must exceed
-- the broker's message retention (Pub/Sub: 7 days) or you can un-dedupe a
-- message that gets redelivered from the backlog.
CREATE INDEX idx_processed_events_time ON processed_events (processed_at);
```

Reseteá y volvé a correr el publish triple:

```bash
psql "postgres://scouter:kamehameha@localhost:5432/scouter" \
  -c "TRUNCATE fighter_ranks, processed_events;"
# publish the same event 3x again
psql "postgres://scouter:kamehameha@localhost:5432/scouter" \
  -c "SELECT fighter, total_power, reading_count FROM fighter_ranks;"
```

```
 fighter | total_power | reading_count
---------+-------------+---------------
 goku    |        9001 |             1
```

**Tres entregas, una aplicación.** Effectively-once, construido con at-least-once
más una restricción única.

### Paso 3 — el mejor patrón: chequeos de versión

La tabla de procesados funciona pero crece para siempre. Cuando tus eventos llevan
una versión monótona por entidad, obtenés idempotencia *e* independencia del orden
gratis:

```go
// HandleVersioned is idempotent AND order-independent. An out-of-order or
// duplicate event simply doesn't match the WHERE clause and is ignored.
//
// This is strictly better than a processed-events table when you have a
// natural version: no extra table, no growth, no pruning, and redelivery
// after a newer event is handled correctly rather than corrupting state.
func (r *Ranker) HandleVersioned(ctx context.Context, e PowerRecorded) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO fighter_ranks (fighter, total_power, reading_count, last_version)
		VALUES ($1, $2, 1, $3)
		ON CONFLICT (fighter) DO UPDATE
		SET total_power   = EXCLUDED.total_power,
		    last_version  = EXCLUDED.last_version,
		    updated_at    = now()
		WHERE fighter_ranks.last_version < EXCLUDED.last_version`,
		e.Fighter, e.Power, e.RecordedAt.UnixNano())
	return err
}
```

Además del `WHERE` cambiaron dos cosas, y las dos son a propósito. Primero,
`total_power` ahora se **pisa**, no se suma: un chequeo de versión sólo sirve
para updates del tipo "dejalo en este estado" (pregunta 5 del drill), porque un
total acumulado no puede ignorar un evento viejo sin perderlo. Así que en esta
variante la columna guarda el poder *más reciente* del peleador (el nombre
quedó del Paso 1) y `reading_count` se queda en 1. Si necesitás un total de
verdad, eso es un delta, y los deltas necesitan la tabla de procesados del
Paso 2.

Segundo, la versión es `recorded_at` en nanosegundos, **no** el campo
`"version"` del JSON del evento, que es la versión del *schema* de la Cápsula
18. Esto importa si reusás el evento armado a mano del Paso 1 para probarlo: no
tiene `recorded_at`, así que Go decodifica el tiempo cero, `UnixNano()`
devuelve un número negativo enorme, y contra la fila que dejó el Paso 2
(`last_version = 0`) el update no matchea nada, en silencio. Probá con eventos
del publisher real, o agregale `"recorded_at":"2026-01-01T00:00:00Z"` al JSON.

Testealo bien — este es un test que vale la pena tener en un codebase real:

**`internal/events/ranker_test.go`**

```go
package events

import "testing"

func TestVersionOrdering(t *testing.T) {
	// Documents the intended semantics without needing a database.
	cases := []struct {
		name      string
		current   int64
		incoming  int64
		wantApply bool
	}{
		{"first event", 0, 100, true},
		{"newer event", 100, 200, true},
		{"duplicate", 200, 200, false},
		{"out of order (older)", 200, 150, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.current < c.incoming; got != c.wantApply {
				t.Errorf("apply = %v, want %v", got, c.wantApply)
			}
		})
	}
}
```

### Paso 4 — una dead-letter queue

```bash
# a DLQ topic and a subscription to inspect it
curl -s -XPUT "http://localhost:8085/v1/projects/gravity-chamber/topics/power-readings-dlq"
curl -s -XPUT "http://localhost:8085/v1/projects/gravity-chamber/subscriptions/dlq-inspector" \
  -H 'Content-Type: application/json' \
  -d '{"topic":"projects/gravity-chamber/topics/power-readings-dlq"}'

# attach the DLQ to the main subscription
curl -s -X PATCH "http://localhost:8085/v1/projects/gravity-chamber/subscriptions/ranker" \
  -H 'Content-Type: application/json' \
  -d '{
    "subscription": {
      "name": "projects/gravity-chamber/subscriptions/ranker",
      "topic": "projects/gravity-chamber/topics/power-readings",
      "deadLetterPolicy": {
        "deadLetterTopic": "projects/gravity-chamber/topics/power-readings-dlq",
        "maxDeliveryAttempts": 5
      }
    },
    "updateMask": "deadLetterPolicy"
  }'
```

Ahora clasificá las fallas en el consumidor — la distinción que hace útil a una
DLQ:

```go
// Two kinds of failure, two different responses.
type PermanentError struct{ Err error }

func (e PermanentError) Error() string { return "permanent: " + e.Err.Error() }
func (e PermanentError) Unwrap() error { return e.Err }

// in the Receive callback (dlq := client.Topic("power-readings-dlq"),
// created once, next to sub):
	if err := handle(ctx, e); err != nil {
		var perm PermanentError
		if errors.As(err, &perm) {
			// Retrying will NEVER help: malformed payload, unknown schema
			// version, a business rule that rejects it. Send it to the DLQ
			// now instead of burning 5 attempts.
			log.Error("permanent failure, dead-lettering",
				"event_id", e.EventID, "err", err)
			// Copy it aside FIRST, and wait for the broker to confirm.
			// Ack first and a failed publish loses the message for good.
			res := dlq.Publish(ctx, &pubsub.Message{
				Data:       m.Data,
				Attributes: map[string]string{"error": err.Error()},
			})
			if _, perr := res.Get(ctx); perr != nil {
				log.Error("dead-letter publish failed, nacking",
					"event_id", e.EventID, "err", perr)
				m.Nack() // redelivered; maxDeliveryAttempts is the backstop
				return
			}
			m.Ack() // the copy is safe; now let go of the original
			return
		}
		// Transient: database timeout, cache down, network blip. Retry.
		log.Warn("transient failure, nacking", "event_id", e.EventID,
			"attempt", deliveryAttempt(m), "err", err)
		m.Nack()
		return
	}
```

Envenená un mensaje y mirá:

```bash
BAD=$(printf '%s' '{"event_id":"not-a-uuid","fighter":"","power":-5}' | base64)
curl -s -XPOST \
  "http://localhost:8085/v1/projects/gravity-chamber/topics/power-readings:publish" \
  -H 'Content-Type: application/json' -d "{\"messages\":[{\"data\":\"$BAD\"}]}"

# it fails, retries, and lands in the DLQ
curl -s -XPOST \
  "http://localhost:8085/v1/projects/gravity-chamber/subscriptions/dlq-inspector:pull" \
  -H 'Content-Type: application/json' -d '{"maxMessages":10}' | jq
```

### Paso 5 — una idempotency key en la API

El mismo problema, sabor HTTP. Un usuario hace doble clic; un cliente mobile
reintenta con red inestable.

```go
// Idempotent POST: the client supplies a key; we store key -> response and
// replay it on repeats. This is how Stripe's API works, and it is the right
// pattern for any non-idempotent endpoint a client might retry.
func (s *Server) handleRecord(w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get("Idempotency-Key")
	if key != "" {
		if cached, ok := s.idem.Get(key); ok {
			w.Header().Set("Idempotency-Replayed", "true")
			writeJSON(w, http.StatusCreated, cached)
			return
		}
	}

	// … decode, validate, store as before …

	if key != "" {
		s.idem.Put(key, rd, 24*time.Hour)
	}
	writeJSON(w, http.StatusCreated, rd)
}
```

```bash
KEY=$(uuidgen)
for i in 1 2 3; do
  curl -si -XPOST localhost:8080/readings \
    -H "Idempotency-Key: $KEY" \
    -d '{"fighter":"goku","power":9001}' | grep -E 'HTTP/|Idempotency-Replayed'
done
```

Se crea un registro; tres respuestas idénticas.

> **Dos sutilezas para producción:** la clave tiene que guardarse *de forma
> durable* (Redis o la base, no en proceso, o una réplica distinta no la ve —
> Cápsula 06), y tenés que manejar el caso **concurrente** donde dos requests con la
> misma clave llegan simultáneamente. Insertá la clave con estado "en progreso"
> primero, usando una restricción única, para que el segundo request espere o reciba
> un `409`.

---

## En GCP

- **Las subscriptions exactly-once de Pub/Sub**
  (`--enable-exactly-once-delivery`) genuinamente eliminan duplicados dentro del ack
  deadline. Menos throughput, y **no hace idempotente a tu handler** — un crash
  después de escribir a tu base pero antes del ack igual reentrega. Usalo como
  defensa en profundidad, nunca como sustituto.
- **Los dead-letter topics** necesitan `roles/pubsub.publisher` en el topic de DLQ y
  `roles/pubsub.subscriber` en la subscription origen, ambos otorgados al service
  agent de Pub/Sub. Olvidarse de esto es por qué las DLQs no funcionan en silencio.
- **Política de reintentos**: `--min-retry-delay` / `--max-retry-delay` dan backoff
  exponencial entre reentregas — la misma idea de la Cápsula 17, en el transporte.
- **Cloud Tasks** tiene dedup incorporado: un nombre de tarea que ya existió se
  rechaza por ~1 hora. Útil, pero esa ventana es una restricción real.
- **Los streaming inserts de BigQuery** aceptan un `insertId` para dedup dentro de
  unos minutos. De nuevo: angosta la ventana, no la cierra.

---

## Llevátelo al trabajo

- **Asumí duplicados. Siempre.** Diseñá el handler, no el transporte.
- **Cada evento lleva un `event_id` único y estable** generado por el productor, no
  por el broker.
- **La marca de dedup y el trabajo commitean en la misma transacción.** Este es el
  detalle que hace o rompe el patrón.
- **Preferí un chequeo de versión antes que una tabla de procesados** cuando tenés
  una versión natural — también maneja el desorden, y no crece.
- **Podá `processed_events`**, con retención mayor a la del broker.
- **Una DLQ en cada subscription, y una alerta con profundidad > 0.**
- **Clasificá fallas permanentes vs transitorias.** Reintentar cinco veces un
  payload malformado no ayuda a nadie.
- **`Idempotency-Key` en cada endpoint público no idempotente.**

---

## Battle drill

<details>
<summary><b>1.</b> Un proveedor dice que su cola ofrece entrega exactly-once. ¿Qué preguntás?</summary>

"¿Exactly-once *dentro de qué límite*?"

Si significa consumir-y-producir dentro de su propio sistema atómicamente (la EOS
transaccional de Kafka), eso es real y útil — dentro de ese sistema. En el momento
en que tu consumidor escribe a Postgres, manda un mail o llama a una API, ese efecto
externo está fuera de la transacción y volviste a at-least-once.

Después: "¿qué pasa si mi consumidor commitea a mi base y crashea antes del ack?".
No hay respuesta que evite la reentrega. Esa pregunta termina la conversación con
honestidad.

El encuadre útil: la *entrega* exactly-once es imposible; el *procesamiento*
exactly-once es alcanzable, y se logra con un consumidor idempotente, no con el
transporte.
</details>

<details>
<summary><b>2.</b> ¿Por qué la marca de dedup y el trabajo tienen que estar en una transacción?</summary>

Considerá las alternativas:

**Marca primero, trabajo después** — insertás la marca, crasheás, el trabajo nunca
pasa. El mensaje ahora está deduplicado como "procesado" y nunca se va a reintentar.
**Pérdida silenciosa de datos**, y el peor de los tres resultados.

**Trabajo primero, marca después** — hacés el trabajo, crasheás, la marca no se
escribe. La reentrega repite el trabajo. Volviste al bug original.

**Los dos en una transacción** — o commitean los dos o ninguno. Ante un crash, no
pasó nada y la reentrega lo hace limpio.

Por eso el trabajo tiene que vivir en la misma base que la marca. Si el trabajo es
una llamada a una API externa, no podés tener esta propiedad, y necesitás otro
enfoque: hacer idempotente la llamada externa con una clave derivada del id del
evento, o usar una saga con compensación.
</details>

<details>
<summary><b>3.</b> Diseñá la idempotencia para "mandar mail de bienvenida".</summary>

El mail es externo, así que ninguna transacción lo abarca. Necesitás que el
*proveedor* deduplique, o necesitás aceptar un riesgo chico.

- **Lo mejor:** usá un proveedor que soporte idempotency key (la mayoría de las APIs
  de mail transaccional lo hace) derivada determinísticamente del evento:
  `welcome:{user_id}`. El proveedor descarta la repetición.
- **Si no:** una tabla `sent_emails` con `PRIMARY KEY (user_id, template)`. Insertá
  *antes* de enviar, en una transacción que también reclame el trabajo. Si el envío
  falla, decidí a propósito si revertís (arriesgando envío duplicado) o dejás la fila
  (arriesgando un mail nunca enviado más una alerta).
- **Reducí el radio de explosión:** hacé el envío rápido para que la ventana de
  crash sea minúscula.
- **Aceptá el riesgo residual:** un mail de bienvenida duplicado es levemente
  vergonzoso. Una *factura* duplicada no — para esos, pagá la garantía más fuerte.

La lección general: **cuando el efecto es externo, la idempotencia tiene que
empujarse al sistema dueño del efecto.**
</details>

<details>
<summary><b>4.</b> Tu DLQ tiene 50.000 mensajes. ¿Y ahora?</summary>

**No los reproduzcas todavía.** Primero entendé.

1. **Muestreá y clasificá** — sacá 20, agrupá por error. Normalmente 50.000 mensajes
   son dos o tres causas distintas.
2. **¿Fue un deploy?** Correlacioná el crecimiento de la DLQ con los tiempos de
   deploy. Un cambio de schema que los consumidores no pudieron parsear es la causa
   clásica.
3. **Evaluá el daño** — ¿qué no pasó? Notificaciones faltantes es distinto de
   asientos financieros faltantes.
4. **Arreglá el consumidor**, deployá, y verificá contra unos pocos mensajes
   primero.
5. **Reproducí de forma controlada** — un job de replay dedicado, con rate limit
   para no abrumar a un sistema que se está recuperando, y **apoyándote en la
   idempotencia que construiste** para que reproducir algo ya procesado sea seguro.
6. **Postmortem:** ¿por qué la alerta no sonó en el mensaje 1? Una alarma de DLQ que
   solo suena en 50.000 no es una alarma.

La retención importa: si la DLQ retiene 7 días y estamos en el día 6, cambian las
prioridades.
</details>

<details>
<summary><b>5.</b> Compará una tabla de eventos procesados con un update con chequeo de versión.</summary>

**Tabla de eventos procesados:** funciona para cualquier evento, incluidos los que
no tienen orden natural. Cuesta una tabla extra que crece para siempre y hay que
podar; requiere una transacción que abarque la marca y el trabajo; y no ayuda con
entregas fuera de orden (un evento viejo igual se aplica, solo que una vez).

**Chequeo de versión:** sin tabla extra, sin crecimiento, sin poda. Maneja
duplicados *y* entregas fuera de orden en una sola cláusula `WHERE`. Requiere una
versión monótona por entidad (un timestamp, un número de secuencia, una posición de
log de CDC) y solo funciona cuando el update es "poné este estado" en vez de "aplicá
este delta".

**Usá chequeos de versión** para trabajo con forma de replicación de estado —
proyecciones, vistas desnormalizadas, caches, índices de búsqueda. Eso cubre la
mayoría de los consumidores.

**Usá una tabla de procesados** para efectos secundarios y deltas: "incrementá un
contador", "cobrá una tarjeta", "mandá una notificación".

Muchos sistemas usan las dos: chequeos de versión para proyecciones, tabla de
procesados para efectos.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| Los duplicados se siguen aplicando | El insert de la marca no está en la misma transacción que el trabajo, o no se chequea `RowsAffected()`. |
| `processed_events` crece sin límite | Agregá un job de poda. Retención > retención del broker (7 días para Pub/Sub). |
| La DLQ queda vacía a pesar de las fallas | Al service agent de Pub/Sub le falta permiso de publish sobre el topic de DLQ. En el emulador el soporte de DLQ es parcial — verificá contra Pub/Sub real. |
| La idempotency key funciona local y falla en prod | La guardaste en memoria del proceso. Múltiples réplicas (Cápsula 06). Usá Redis o la base. |
| Dos requests concurrentes con la misma clave crean los dos | Chequeaste-y-después-insertaste sin restricción única. Insertá primero, que la restricción arbitre. |
| El chequeo de versión nunca aplica nada | `last_version` se inicializó más alto que las versiones entrantes, o estás comparando unidades distintas (ns vs s). |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "fix(events): idempotent consumer, DLQ, and API idempotency keys

Capsule 19. Reproduced triple-counting from at-least-once delivery. Dedup
marker now commits in the same transaction as the work. Added a version-check
variant that is idempotent AND order-independent. Dead-letter policy with
permanent-vs-transient classification. Idempotency-Key on POST /readings."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 19
```

**Siguiente:** [Cápsula 20 · Genkidama — Fan-in, fan-out y batch](../20-spirit-bomb-fan-in-out/README.md)
