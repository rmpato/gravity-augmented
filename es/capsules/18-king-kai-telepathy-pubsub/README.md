# Cápsula 18 · Telepatía de Kaio-sama — Pub/Sub

> *Kaio-sama conecta mentes a través de galaxias. Habla una vez y todos los que
> conectó lo escuchan. No sabe ni le importa quién está escuchando, nadie tiene que
> estar en el mismo lugar, y agregar otro oyente no le cambia nada al que habla.
> Eso es publish/subscribe, y es por qué los Guerreros Z pueden coordinar un plan
> entre dos planetas.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 7 | 85 min | Cápsulas 10, 17 | Local + ☁️ opcional |

---

## Por qué existe esta cápsula

Cada servicio que construiste hasta ahora es sincrónico: llega un request, hacés
todo el trabajo, respondés. Ese modelo tiene un límite duro — **el que llama espera
todo, y falla si algo falla.**

Pensá en registrar una lectura de nivel de pelea. Hoy: escribís a la base,
respondés. Pronto también debería actualizar un leaderboard, notificar a los
seguidores, correr chequeos de fraude, alimentar analítica y actualizar un índice
de búsqueda. Sincrónicamente, eso es un request de 2 segundos que falla si el
servicio de notificaciones está caído.

La mensajería desacopla *qué pasó* de *qué debería pasar por eso*. Es el cambio
arquitectónico más grande de este repo.

---

## El concepto

### Cola vs topic

```
  QUEUE (point-to-point)          TOPIC (publish/subscribe)

  producer → [queue] → consumer   publisher → [topic] ─┬→ sub A → consumer A
                                                       ├→ sub B → consumer B
  one message, ONE consumer                            └→ sub C → consumer C
  work distribution                 one message, EVERY subscription gets a copy
                                    event broadcast
```

**Google Cloud Pub/Sub es las dos cosas**, y la distinción vive en la
*subscription*, que es lo que la gente entiende mal:

- Una subscription con muchas instancias consumidoras → **consumidores
  compitiendo**, el trabajo se distribuye (semántica de cola).
- Muchas subscriptions sobre un topic → cada una recibe su propia copia (fan-out).

Así que "¿cuántas subscriptions?" es la pregunta de diseño. Una por *preocupación
consumidora*, no una por instancia consumidora.

### Qué compra realmente el desacoplamiento

| | Sincrónico | Asincrónico |
|---|---|---|
| El que llama espera | todo | solo el publish |
| Un consumidor está caído | el request falla | los mensajes esperan |
| Agregar un consumidor | cambiás el productor | agregás una subscription |
| Pico de tráfico | todo tiene que escalar ya | la cola lo absorbe |
| Debugging | un stack trace | distribuido, más difícil |
| Consistencia | inmediata | eventual |

**La cola como amortiguador** suele ser la ganancia más grande: un pico de tráfico
de 10× se convierte en un backlog creciente que se drena en los próximos minutos,
en vez de una caída.

### Push vs pull

| | Pull | Push |
|---|---|---|
| Cómo | el consumidor pide mensajes | Pub/Sub hace POST a tu endpoint HTTPS |
| Control de flujo | el consumidor decide su ritmo | Pub/Sub se adapta a tus tiempos de respuesta |
| Encaja con | workers, batch, throughput alto, jobs de Cloud Run | servicios de Cloud Run/Functions, scale-to-zero |
| Backpressure | natural — pedí menos | Pub/Sub baja el ritmo ante 429/5xx |

Push es elegante con Cloud Run: no hay consumidor corriendo hasta que llega un
mensaje, y Pub/Sub maneja los reintentos. Pull te da control más fino y en general
más throughput.

El **streaming pull** (el default en el cliente de Go) mantiene abierto un stream
gRPC y entrega mensajes a medida que llegan — latencia baja, throughput alto.

### Ack deadlines

Cuando un consumidor recibe un mensaje tiene un **ack deadline** (10 s por
defecto) para confirmar. Si no confirma a tiempo, el mensaje se **reentrega** —
posiblemente a otro consumidor.

```
  receive ──► process ──► ack        ✅ done
  receive ──► process ──✗ (crash)    → redelivered after the deadline
  receive ──► process (too slow)     → REDELIVERED WHILE STILL PROCESSING
                                        ↑ you are now running it twice
```

Ese último caso es el que muerde: el trabajo que tarda más que el ack deadline se
procesa repetidamente y nunca termina. Soluciones: extender el deadline (el cliente
de Go lo hace automáticamente mientras corre tu handler), subir el default de la
subscription, o — lo mejor — hacer el handler rápido haciendo la parte lenta en otro
lado.

**Hacé nack explícito** ante una falla en vez de esperar el deadline. Una
reentrega inmediata le gana a un freno de 10 segundos.

### Orden

Pub/Sub **no** garantiza orden por defecto, y este es el default correcto — el
orden global requiere un único punto de serialización, lo que topea el throughput.

Las **ordering keys** dan orden por clave: los mensajes con la misma clave se
entregan en orden de publicación. Todos los mensajes de `fighter:goku` quedan
ordenados entre sí; peleadores distintos son independientes y siguen en paralelo.

El costo: las ordering keys quedan atadas a una región, y un mensaje trabado
bloquea todo lo que viene detrás *para esa clave*.

**Normalmente no deberías necesitar orden.** Diseñá los eventos para que el orden
no importe — incluí una versión o timestamp y que los consumidores ignoren los
viejos. Eso es más robusto que exigirle al transporte que lo resuelva.

### El backlog es la mejor señal de autoscaling que existe

Para un servicio request/response, la señal es la concurrencia (Cápsula 06). Para
un consumidor es **`num_undelivered_messages`** — el backlog:

- Backlog creciendo → los consumidores no dan abasto → escalá para arriba.
- Backlog vacío → escalá a cero.
- **La edad del mensaje sin ack más viejo** → tu lag real de punta a punta, y lo
  que hay que alertar.

El backlog es un indicador adelantado; la CPU es uno atrasado. Por eso el
autoscaling por cola (KEDA en Kubernetes, los triggers de Pub/Sub de Cloud Run)
funciona tan bien.

---

## Lab

### Paso 1 — el emulador de Pub/Sub

Google publica un emulador local. Gratis, offline, y la misma API.

Agregá a **`deploy/docker-compose.yml`**:

```yaml
  pubsub:
    image: gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators
    command: >
      gcloud beta emulators pubsub start
        --project=gravity-chamber
        --host-port=0.0.0.0:8085
    ports: ["8085:8085"]
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8085 || exit 1"]
      interval: 3s
      retries: 20
```

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d pubsub
sleep 10
curl -s localhost:8085   # "Ok"
```

La librería cliente cambia al emulador puramente con una variable de entorno —
**sin cambios de código**, que es el punto:

```bash
export PUBSUB_EMULATOR_HOST=localhost:8085
export PUBSUB_PROJECT_ID=gravity-chamber
```

### Paso 2 — publicar

```bash
go get cloud.google.com/go/pubsub
```

**`internal/events/publisher.go`**

```go
// Package events is the messaging boundary. Nothing outside it should know
// which broker is in use.
package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"cloud.google.com/go/pubsub"
)

// PowerRecorded is an EVENT: a statement of fact about something that already
// happened, in the past tense. Not a command ("UpdateLeaderboard") — the
// publisher must not know or care who reacts to it.
type PowerRecorded struct {
	EventID    string    `json:"event_id"`   // for idempotency (Capsule 19)
	Fighter    string    `json:"fighter"`
	Power      int64     `json:"power"`
	RecordedAt time.Time `json:"recorded_at"`
	Version    int       `json:"version"`    // schema version, from day one
}

type Publisher struct {
	client *pubsub.Client
	topic  *pubsub.Topic
	log    *slog.Logger
}

func NewPublisher(ctx context.Context, projectID, topicID string, log *slog.Logger) (*Publisher, error) {
	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("pubsub client: %w", err)
	}

	topic := client.Topic(topicID)
	ok, err := topic.Exists(ctx)
	if err != nil {
		return nil, fmt.Errorf("topic exists: %w", err)
	}
	if !ok {
		if topic, err = client.CreateTopic(ctx, topicID); err != nil {
			return nil, fmt.Errorf("create topic: %w", err)
		}
	}

	// REQUIRED because we set an OrderingKey below. Without it, every single
	// Publish fails with "EnableMessageOrdering=false, but an OrderingKey was
	// set" — and since we deliberately log-and-continue on publish errors, the
	// API still returns 201 and you get NO events with no obvious cause.
	// This is a publisher-side client setting; creating the topic is not enough.
	topic.EnableMessageOrdering = true

	// Batching trades a little latency for a lot of throughput.
	topic.PublishSettings.DelayThreshold = 20 * time.Millisecond
	topic.PublishSettings.CountThreshold = 100

	return &Publisher{client: client, topic: topic, log: log}, nil
}

func (p *Publisher) Close() {
	p.topic.Stop() // flushes buffered messages — do not skip this
	_ = p.client.Close()
}

func (p *Publisher) PublishPowerRecorded(ctx context.Context, e PowerRecorded) error {
	body, err := json.Marshal(e)
	if err != nil {
		return err
	}

	res := p.topic.Publish(ctx, &pubsub.Message{
		Data: body,
		// Attributes are filterable by subscriptions WITHOUT decoding the
		// body — put routing metadata here, not in the payload.
		Attributes: map[string]string{
			"event_type": "power.recorded",
			"fighter":    e.Fighter,
			"version":    "1",
		},
		// Same key => same order. Different fighters stay parallel.
		OrderingKey: e.Fighter,
	})

	// Publish is async; Get blocks for the server ack. Doing this inline
	// makes the publish synchronous from the caller's point of view — which
	// is what you want when the caller must know the event was accepted.
	id, err := res.Get(ctx)
	if err != nil {
		return fmt.Errorf("publish: %w", err)
	}
	p.log.Debug("published", "message_id", id, "fighter", e.Fighter)
	return nil
}
```

Ahora dale al server dónde guardarlo. **Definí la interfaz en
`internal/scouter`, no en `internal/events`** — así el package del servicio nunca
importa el cliente de pubsub, y la costura queda testeable con un fake de dos
líneas:

**`internal/scouter/server.go`**

```go
// Publisher is OUR interface, declared where it is USED. internal/events
// satisfies it without ever being imported here.
type Publisher interface {
	PublishPowerRecorded(ctx context.Context, fighter string, power int64, at time.Time) error
}

type Server struct {
	// …
	pub Publisher
}

// SetPublisher is optional by design: the service is fully functional without
// events. Nothing about recording a reading should depend on a message broker
// being up.
func (s *Server) SetPublisher(p Publisher) { s.pub = p }
```

Y cableálo en `cmd/scouter/main.go`, con la misma forma de dependencia opcional
que el cache y las replicas:

```go
	if proj := os.Getenv("PUBSUB_PROJECT_ID"); proj != "" {
		pub, err := events.NewPublisher(context.Background(), proj,
			getenv("TOPIC_ID", "power-readings"), log)
		if err != nil {
			log.Error("pubsub unavailable", "err", err)
			os.Exit(1)
		}
		defer pub.Close()
		srv.SetPublisher(pub)
		log.Info("event publishing enabled", "project", proj)
	}
```

Ahora enganchalo en `Record`. **Fijate en el orden — base de datos primero, después
publish:**

```go
// in the handler, after a successful store.Record(...)
	if s.pub != nil {
		ev := events.PowerRecorded{
			EventID:    uuid.NewString(),
			Fighter:    rd.Fighter,
			Power:      rd.Power,
			RecordedAt: rd.RecordedAt,
			Version:    1,
		}
		if err := s.pub.PublishPowerRecorded(r.Context(), ev); err != nil {
			// The write succeeded and the event did not. The data is correct
			// but downstream will never learn about it. This is the "dual
			// write problem" and Capsule 21 fixes it properly with an outbox.
			s.log.Error("event publish failed after commit", "err", err,
				"fighter", rd.Fighter)
		}
	}
```

Leé ese comentario con atención — es la costura que existe para que la Cápsula 21
la cierre.

### Paso 3 — un consumidor

**`cmd/ranker/main.go`** — un segundo binario. El `cmd/` de la Cápsula 00 rinde.

```go
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"cloud.google.com/go/pubsub"
	"github.com/<your-username>/gravity-chamber/internal/events"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	projectID := os.Getenv("PUBSUB_PROJECT_ID")
	subID := os.Getenv("SUBSCRIPTION_ID")
	if projectID == "" || subID == "" {
		log.Error("PUBSUB_PROJECT_ID and SUBSCRIPTION_ID are required")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		log.Error("pubsub client", "err", err)
		os.Exit(1)
	}
	defer client.Close()

	sub := client.Subscription(subID)

	// Flow control bounds how much work is in flight. Without it, a large
	// backlog is pulled into memory all at once and you OOM — the async
	// equivalent of an unbounded queue (Capsule 17).
	sub.ReceiveSettings.MaxOutstandingMessages = 100
	sub.ReceiveSettings.MaxOutstandingBytes = 32 * 1024 * 1024
	sub.ReceiveSettings.NumGoroutines = 4

	var processed atomic.Uint64
	log.Info("ranker online", "subscription", subID)

	// Receive blocks until ctx is cancelled, running the callback
	// concurrently for each message.
	err = sub.Receive(ctx, func(ctx context.Context, m *pubsub.Message) {
		var e events.PowerRecorded
		if err := json.Unmarshal(m.Data, &e); err != nil {
			// A message we can NEVER parse must not be retried forever.
			// Ack it so it leaves the subscription, and log loudly.
			// Capsule 19 sends these to a dead-letter topic instead.
			log.Error("undecodable message, dropping",
				"id", m.ID, "err", err, "data", string(m.Data))
			m.Ack()
			return
		}

		if err := handle(ctx, e); err != nil {
			log.Warn("handler failed, nacking for redelivery",
				"event_id", e.EventID, "err", err)
			m.Nack() // explicit nack = immediate redelivery, not a 10s stall
			return
		}

		n := processed.Add(1)
		log.Info("ranked",
			"event_id", e.EventID,
			"fighter", e.Fighter,
			"power", e.Power,
			"delivery_attempt", deliveryAttempt(m),
			"publish_lag_ms", time.Since(m.PublishTime).Milliseconds(),
			"total", n,
		)
		m.Ack()
	})
	if err != nil {
		log.Error("receive stopped", "err", err)
		os.Exit(1)
	}
	log.Info("ranker offline", "processed", processed.Load())
}

func handle(ctx context.Context, e events.PowerRecorded) error {
	// Real work goes here: update a Redis sorted set, recompute a rank, etc.
	// It MUST be idempotent — this may be the second time you've seen this
	// exact event. That is Capsule 19.
	select {
	case <-time.After(50 * time.Millisecond):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func deliveryAttempt(m *pubsub.Message) int {
	if a := m.DeliveryAttempt; a != nil {
		return *a
	}
	return 1
}
```

### Paso 4 — corré todo junto

```bash
# terminal 1: emulator already running via compose
export PUBSUB_EMULATOR_HOST=localhost:8085
export PUBSUB_PROJECT_ID=gravity-chamber

# create the subscription (idempotent helper — put it in scripts/)
cat > scripts/pubsub-setup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
: "${PUBSUB_EMULATOR_HOST:?set PUBSUB_EMULATOR_HOST}"
P="${PUBSUB_PROJECT_ID:-gravity-chamber}"
TOPIC="${1:-power-readings}"
SUB="${2:-ranker}"

curl -s -XPUT "http://$PUBSUB_EMULATOR_HOST/v1/projects/$P/topics/$TOPIC" >/dev/null
curl -s -XPUT "http://$PUBSUB_EMULATOR_HOST/v1/projects/$P/subscriptions/$SUB" \
  -H 'Content-Type: application/json' \
  -d "{\"topic\":\"projects/$P/topics/$TOPIC\",\"ackDeadlineSeconds\":10}" >/dev/null
echo "topic=$TOPIC sub=$SUB ready"
EOF
chmod +x scripts/pubsub-setup.sh
./scripts/pubsub-setup.sh
```

```bash
# terminal 2: the consumer
PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber \
  SUBSCRIPTION_ID=ranker go run ./cmd/ranker

# terminal 3: the producer
PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber \
  TOPIC_ID=power-readings \
  DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" \
  make run

# terminal 4
for f in goku vegeta piccolo krillin frieza; do
  curl -s -XPOST localhost:8080/readings -d "{\"fighter\":\"$f\",\"power\":$((RANDOM*10))}" >/dev/null
done
```

El terminal 2 muestra los eventos llegando. **La API respondió antes de que el
ranker hiciera nada.** Ese es el desacoplamiento.

> ### ⏸ Punto natural para cortar
>
> Todo lo de arriba se sostiene solo — commiteálo y volvé después. Los pasos que
> siguen construyen sobre eso pero no dejan nada inestable si parás acá. Dos
> sesiones de 45 minutos le ganan a una de 90 que no terminás.

### Paso 5 — las propiedades que importan

**Consumidor caído → los mensajes esperan.**

```bash
# stop the ranker (Ctrl-C in terminal 2)
for i in $(seq 1 20); do
  curl -s -XPOST localhost:8080/readings -d '{"fighter":"cell","power":900000}' >/dev/null
done
# the API is completely unaffected — 20 fast 201s

# check the backlog
curl -s "http://localhost:8085/v1/projects/gravity-chamber/subscriptions/ranker" | jq

# restart the ranker: it drains the backlog
```

**Fan-out: agregá un consumidor sin tocar el productor.**

```bash
./scripts/pubsub-setup.sh power-readings notifier

PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber \
  SUBSCRIPTION_ID=notifier go run ./cmd/ranker
```

Ahora publicá de nuevo — **las dos** subscriptions reciben cada mensaje. El
productor no se redeployó, ni se reinició, ni se enteró. Esa es la propiedad que
hace que la arquitectura event-driven valga sus costos.

**Consumidores compitiendo: la misma subscription, más instancias.**

```bash
# three instances on the SAME subscription
for i in 1 2 3; do
  PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=gravity-chamber \
    SUBSCRIPTION_ID=ranker go run ./cmd/ranker &
done

for i in $(seq 1 60); do
  curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}' >/dev/null
done
```

El trabajo se *distribuye*, no se duplica. **Mismo topic, una subscription = cola.
Mismo topic, muchas subscriptions = fan-out.** Esa sola frase es el modelo mental.

### Paso 6 — pasate del ack deadline

Cambiá `handle` para que duerma 30 segundos (el deadline es 10):

```go
	case <-time.After(30 * time.Second):
```

Publicá un mensaje y mirá:

```
  ranked  delivery_attempt=1
  ranked  delivery_attempt=2      ← the SAME message, again
  ranked  delivery_attempt=3
```

**Un publish, tres entregas, tres ejecuciones.** Si `handle` cobrara una tarjeta de
crédito, la cobraste tres veces.

Ahora ojo que el cliente de Go *sí* extiende el deadline automáticamente mientras
corre tu callback — así que para ver esto limpio quizás tengas que bajar
`sub.ReceiveSettings.MaxExtension` a unos pocos segundos. Hacelo, observalo, y
volvelo atrás.

Dos lecciones: **la entrega at-least-once es la realidad**, y **el trabajo largo no
va en un handler de mensajes** — registrá la intención y que otro lo haga.

La Cápsula 19 trata enteramente sobre hacer esto seguro.

```bash
cd deploy && docker compose down
```

---

## En GCP

> ### ☁️ Opcional: Pub/Sub de verdad
> **Free tier: 10 GiB de throughput de mensajes por mes.** Este lab son unos pocos
> kilobytes. Genuinamente gratis — y vale hacerlo una vez para que el emulador no
> te esconda nada.

```bash
gcloud services enable pubsub.googleapis.com

gcloud pubsub topics create power-readings
gcloud pubsub subscriptions create ranker \
  --topic=power-readings \
  --ack-deadline=30 \
  --message-retention-duration=7d \
  --expiration-period=never

# publish and pull by hand
gcloud pubsub topics publish power-readings \
  --message='{"event_id":"1","fighter":"goku","power":9001}' \
  --attribute=event_type=power.recorded

gcloud pubsub subscriptions pull ranker --auto-ack --limit=5
```

Tu código Go **no necesita cambios** — solo desconfigurá `PUBSUB_EMULATOR_HOST` y
usá credenciales reales (`gcloud auth application-default login`).

**Filtrado** — un topic, subscriptions que solo ven lo que les importa:

```bash
gcloud pubsub subscriptions create saiyans-only \
  --topic=power-readings \
  --message-filter='attributes.fighter = "goku" OR attributes.fighter = "vegeta"'
```

Los filtros corren **solo sobre attributes**, no sobre el payload — que es por qué
los metadatos de ruteo van en attributes.

**Push a Cloud Run:**

```bash
gcloud pubsub subscriptions create ranker-push \
  --topic=power-readings \
  --push-endpoint="https://ranker-xyz.run.app/events" \
  --push-auth-service-account=ranker-sa@$PROJECT.iam.gserviceaccount.com
```

La service account hace que Pub/Sub mande un token OIDC firmado, así tu endpoint
puede verificar que el request realmente vino de Pub/Sub (Cápsula B3). Combinado con
`--no-allow-unauthenticated`, el endpoint no es públicamente invocable en absoluto.

**Teardown:**

```bash
gcloud pubsub subscriptions delete ranker saiyans-only ranker-push --quiet
gcloud pubsub topics delete power-readings --quiet
```

**Productos relacionados:** **Cloud Tasks** (dirigido, con scheduling y control de
tasa por tarea — mejor para "llamá a este endpoint más tarde"), **Eventarc** (rutea
eventos de servicios de GCP a Cloud Run), **Pub/Sub Lite** (más barato, zonal, la
capacidad la gestionás vos).

---

## Llevátelo al trabajo

- **Los eventos son hechos en pasado.** `PowerRecorded`, no `UpdateLeaderboard`.
  Los comandos acoplan; los hechos no.
- **Versioná todo schema de evento desde el mensaje uno.** Meter un campo de versión
  a posteriori en un topic con consumidores vivos es miserable.
- **Los metadatos de ruteo van en attributes**, para que las subscriptions puedan
  filtrar sin decodificar.
- **Una subscription por preocupación consumidora**, no por instancia.
- **Configurá el control de flujo.** El prefetch sin límite es un OOM esperando un
  backlog.
- **Hacé nack explícito** ante fallas. No quemes el ack deadline.
- **Alertá sobre la edad del mensaje sin ack más viejo**, no solo sobre el tamaño
  del backlog. Es tu lag real de punta a punta.
- **Mantené rápidos los handlers.** El trabajo largo va detrás de otra cola o en un
  job.
- **El hueco entre commit y publish es real.** Sabé que existe; la Cápsula 21 lo
  arregla.

---

## Battle drill

<details>
<summary><b>1.</b> ¿Cuándo debería una operación ser asincrónica en vez de sincrónica?</summary>

**Async cuando:** el que llama no necesita el resultado (mandar un mail, actualizar
un índice, emitir analítica); el trabajo es lento o variable (transcodificar video,
generar reportes); el trabajo puede fallar y reintentarse sin que al usuario le
importe; necesitás absorber ráfagas; o varios consumidores independientes se
interesan por el mismo evento.

**Sync cuando:** el que llama necesita el resultado para continuar; el usuario está
mirando y espera confirmación inmediata; es una lectura; o tiene que ser fuertemente
consistente con otra cosa.

**La prueba:** *"si este paso fallara, ¿debería fallar el request del usuario?"* Si
no, es candidato a async.

**El costo que estás aceptando:** consistencia eventual, debugging más difícil,
entregas duplicadas y preguntas de orden. No es gratis — solo que normalmente vale
la pena.
</details>

<details>
<summary><b>2.</b> Tu consumidor procesa 100 msg/s; el productor publica 500 msg/s. ¿Qué pasa, y qué hacés?</summary>

El backlog crece 400/s — 1,4 millones de mensajes por hora. Pub/Sub los retiene (7
días por defecto), así que no se pierde nada, pero el lag de punta a punta crece sin
límite y tus datos están cada vez más viejos.

**Escalá consumidores**: agregá instancias en la *misma* subscription (consumidores
compitiendo). Autoescalá por `num_undelivered_messages`, no por CPU.

**Hacé el consumidor más rápido**: escrituras en lote a la base en vez de una por
mensaje, sacá un N+1, o mové el trabajo genuinamente lento detrás de otra cola.

**Fijate si es desparejo**: con ordering keys, una clave caliente serializa y
ninguna cantidad de escalado ayuda.

**Alertá sobre `oldest_unacked_message_age`.** El *tamaño* del backlog es ruidoso;
la *edad* del mensaje es el SLO.

Si la tasa del productor es permanente y los consumidores no se pueden escalar, el
diseño está mal — o el trabajo es demasiado caro por mensaje, o debería agruparse en
lotes (Cápsula 20).
</details>

<details>
<summary><b>3.</b> ¿Deberías usar ordering keys? Argumentá los dos lados.</summary>

**A favor:** algunos dominios genuinamente lo necesitan. Cambios de saldo de cuenta,
transiciones de máquina de estados, streams de CDC — aplicar "estado = enviado"
antes de "crear orden" no tiene sentido.

**En contra:** el orden serializa por clave, así que el throughput por clave está
topeado y un mensaje trabado bloquea todo lo que viene detrás. También ata la
publicación a una región, y hace el sistema más difícil de razonar ante fallas.

**La mejor respuesta, la mayoría de las veces:** hacé los consumidores independientes
del orden. Incluí una versión o timestamp en el evento y que el consumidor ignore
cualquier cosa más vieja que lo que ya aplicó (un chequeo de "gana la última
escritura por versión"). Son unas pocas líneas de código, funciona sin importar el
transporte, y también sobrevive al replay y a las entregas duplicadas.

Usá ordering keys cuando no puedas diseñar el requisito de orden fuera — y elegí la
clave más angosta posible para que las entidades no relacionadas sigan en paralelo.
</details>

<details>
<summary><b>4.</b> ¿Pub/Sub vs Cloud Tasks vs Kafka — cuándo cada uno?</summary>

**Pub/Sub** — difusión de eventos con fan-out a consumidores desconocidos.
Serverless, sin capacidad que gestionar, retención de 7 días. El default en GCP.

**Cloud Tasks** — trabajo *dirigido*: "llamá a este endpoint específico, a esta
hora, a esta tasa, con estos reintentos". Scheduling y dedup por tarea, rate
limiting por cola. Mejor cuando sabés exactamente quién debe hacer el trabajo y
cuándo. Excelente para "mandá este mail en 24 horas".

**Kafka (o Managed Service for Kafka)** — un **log** durable y reproducible en vez
de una cola. Los consumidores manejan sus propios offsets, así que podés rebobinar y
reproducir semanas de historia; el orden es por partición; la retención puede ser
para siempre. Elegilo para event sourcing, procesamiento de streams, o cuando
necesitás el replay como operación de primera clase. Cuesta esfuerzo operativo real.

Regla práctica: **difusión → Pub/Sub. Job dirigido → Cloud Tasks. Log reproducible →
Kafka.**
</details>

<details>
<summary><b>5.</b> Un mensaje falla y se reentrega para siempre. ¿Qué está mal y qué hacés?</summary>

Un **mensaje veneno**: algo de él hace que el handler falle determinísticamente —
payload malformado, un cambio de schema que el consumidor no entiende, una fila
referenciada que se borró, un caso borde sin manejar.

Es peor que un mensaje trabado: consume throughput en cada reentrega, y con ordering
keys bloquea todos los mensajes detrás para esa clave.

**Solución:** un **dead-letter topic**. Después de N intentos de entrega, Pub/Sub
mueve el mensaje a un topic separado donde podés inspeccionarlo, arreglarlo y
reproducirlo. Esto no es opcional para ninguna subscription de producción.

```bash
gcloud pubsub subscriptions update ranker \
  --dead-letter-topic=power-readings-dlq \
  --max-delivery-attempts=5
```

**Además:** alertá sobre la profundidad de la DLQ (cualquier cosa > 0 es una señal);
distinguí fallas permanentes (ack y DLQ de inmediato) de transitorias (nack y
reintento); y nunca hagas ack en silencio de una falla que no manejaste.

La Cápsula 19 construye esto en serio.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| El cliente intenta llegar a GCP real | `PUBSUB_EMULATOR_HOST` no está seteado en *ese* terminal. Tiene que estarlo para publisher y consumidor. |
| `topic does not exist` | El estado del emulador es en memoria: recreá los topics después de cada reinicio. Para eso está `scripts/pubsub-setup.sh`. |
| El consumidor no recibe nada | La subscription se creó *después* de publicar. Las subscriptions solo reciben mensajes publicados después de existir. |
| Cada mensaje se entrega dos veces | Se excedió el ack deadline, o hacés `Ack()` en un camino que también retorna antes. Logueá `DeliveryAttempt`. |
| El consumidor hace OOM con un backlog grande | Sin control de flujo. Poné `MaxOutstandingMessages`/`Bytes`. |
| `EnableMessageOrdering=false, but an OrderingKey was set` | `topic.EnableMessageOrdering = true` es obligatorio en el **cliente publisher**, no solo al crear el topic. El `NewPublisher` de arriba lo setea — si escribiste el publisher a mano, esa es la línea que te falta. |
| Mensajes perdidos al apagar | No llamaste a `topic.Stop()`. Los mensajes en buffer se descartan. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(events): publish PowerRecorded and add a ranker consumer

Capsule 18. Pub/Sub emulator in compose; same code path as real Pub/Sub via
PUBSUB_EMULATOR_HOST. Events are past-tense facts with a version field and
filterable attributes. Consumer has flow control and explicit nack. Verified
fan-out (2 subs) vs competing consumers (1 sub, 3 instances), and reproduced
duplicate delivery by exceeding the ack deadline."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 18
```

**Siguiente:** [Cápsula 19 · La absorción de Cell — Semánticas de entrega e idempotencia](../19-cell-absorption-delivery-semantics/README.md)
