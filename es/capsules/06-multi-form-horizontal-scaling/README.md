# Cápsula 06 · Multiformas — Horizontal scaling y statelessness

> *Ten-Shin-Han se divide en cuatro. Cuatro peleadores, cuatro pares de puños — y
> cada uno tiene apenas un cuarto de su poder. La técnica es genuinamente útil y
> también es una lección sobre qué te cuesta dividirte: coordinación, y el hecho
> de que lo que sabe una copia, las otras no.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 5 | 65 min | Cápsula 05 | Local + ☁️ opcional |

---

## Por qué existe esta cápsula

La Cápsula 05 encontró el techo. La forma de pasarlo son más instancias, no más
grandes — y eso funciona **solo si cualquier instancia puede servir cualquier
request**.

Esa propiedad se llama ser **stateless**, y suena trivial hasta que salís a buscar
dónde se esconde realmente el estado en tu servicio. Rara vez está donde uno cree.
Esta cápsula te hace encontrarlo por las malas: vas a correr tres réplicas del
Scouter y mirarlo devolver tres respuestas distintas a la misma pregunta.

---

## El concepto

### Stateless no significa "sin datos"

Significa **que ningún dato con alcance de request vive en la memoria o el disco
de la instancia entre requests.** Los datos existen absolutamente — viven en una
base de datos, un cache o un almacén de objetos que toda instancia puede alcanzar.

La prueba: *¿puedo matar cualquier instancia en medio del tráfico y no perder nada
más que los requests que estaba sirviendo?*

**Dónde se esconde el estado** — buscá los seis:

| Escondite | Se ve como | Solución |
|---|---|---|
| Maps/contadores en memoria | `var cache = map[string]X{}` | cache compartido (Cápsula 14) |
| Sesiones en memoria | estado de login en un map local | cookie firmada, o almacén de sesiones compartido |
| Archivos locales | uploads escritos a `/tmp`, PDFs generados | almacenamiento de objetos (Cloud Storage) |
| Schedulers en proceso | un `time.Ticker` que corre un job | elección de líder, o un scheduler externo |
| Contadores locales de rate limit | un token bucket por instancia | contador compartido, o aceptar N× el límite (Cápsula 17) |
| Suposiciones de sticky session | "el usuario siempre pega en la misma máquina" | no. Ver abajo |

Las **sticky sessions** (afinidad de sesión) rutean a un usuario a la misma
instancia siempre. Hacen que el estado en memoria *parezca* funcionar, y son una
trampa:

- Escalar no rebalancea a los usuarios existentes, así que las instancias nuevas
  quedan ociosas mientras las viejas siguen calientes.
- Perder una instancia pierde el estado de esos usuarios por completo.
- Los deploys se vuelven disruptivos por definición.
- La carga se vuelve despareja e impredecible.

Usalas solo cuando realmente no podés evitarlo (las conexiones WebSocket de larga
vida son el caso honesto), y sabé que tomaste deuda.

### El triángulo de escalado: réplicas × concurrencia × capacidad

Tres números, y confundirlos es el error de capacidad más común:

```
  total capacity  ≈  replicas  ×  per-replica concurrency
```

- **Concurrencia** — cuántos requests maneja simultáneamente una instancia. Para
  un servicio Go haciendo trabajo de E/S, alta (cientos). Para trabajo limitado por
  CPU, cerca de la cantidad de cores.
- **Réplicas** — cuántas instancias existen.

Poner la concurrencia muy alta hace que los requests encolen *adentro* de una
instancia, así que la latencia sube mientras el autoscaler ve "capacidad de sobra"
y no escala. Ponerla muy baja significa pagar instancias que están casi ociosas.

### ¿Qué señal debería disparar un scale-up?

| Señal | Buena para | Cuidado |
|---|---|---|
| **Utilización de CPU** | trabajo limitado por CPU | inútil para servicios limitados por E/S, que están lentos al 20% de CPU |
| **Concurrencia de requests** | la mayoría de los servicios HTTP. El default de Cloud Run | necesita un objetivo sensato por instancia |
| **Profundidad de cola / backlog** | consumidores asíncronos (Cápsula 19) | la mejor señal que existe ahí |
| **Latencia p95** | SLOs de cara al usuario | va con retraso — escalás *después* de que los usuarios sufren |

**Escalá para arriba rápido, para abajo lento.** Escalar tarde para arriba te
cuesta una caída; escalar tarde para abajo te cuesta unos centavos. La asimetría
debería reflejarse en tus cooldowns.

### Cold starts y el trade-off de min-instances

Una réplica nueva tiene que: ser agendada → bajar la imagen → arrancar el proceso
→ calentarse (JIT, pools de conexiones, caches) → pasar readiness. Eso son decenas
de milisegundos para tu binario Go y varios segundos para un runtime pesado.

Durante un pico, los cold starts caen justo cuando menos te los podés permitir.
Palancas:

- `min-instances > 0` — mantené N calientes. Cuesta plata continuamente.
- Imágenes chicas, arranque rápido — la razón por la que importó la Cápsula 02.
- CPU boost de arranque (`--cpu-boost` de Cloud Run).
- Pre-calentar antes de picos conocidos (una promo, un lanzamiento).

### Lo que el horizontal scaling *no* arregla

Diez réplicas sin estado le hablan todas a **una base de datos**. Moviste el
cuello de botella, no lo sacaste — y lo empeoraste, porque diez réplicas abren
diez pools de conexiones. Ese es el tema de las Sagas 2 y 3.

---

## Lab — rompé el Scouter y después arreglalo

### Paso 1 — tres réplicas detrás de un puerto

**`deploy/docker-compose.scale.yml`**

```yaml
name: gravity-chamber-scale

services:
  scouter:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    image: scouter:dev
    environment:
      PORT: "8080"
      LOG_LEVEL: "info"
    deploy:
      replicas: 3
    # No host port mapping: three containers cannot share port 8080.
    # nginx below is the single entry point.

  lb:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - scouter
```

**`deploy/nginx.conf`**

```nginx
events {}
http {
  # Docker's embedded DNS resolves "scouter" to all three container IPs.
  # nginx round-robins between them.
  upstream scouters { server scouter:8080; }

  server {
    listen 80;
    location / {
      proxy_pass http://scouters;
      proxy_set_header Host $host;
      # So you can see WHICH replica answered.
      add_header X-Upstream $upstream_addr always;
    }
  }
}
```

```bash
cd deploy
docker compose -f docker-compose.scale.yml up --build -d
docker compose -f docker-compose.scale.yml ps    # three scouter containers
```

### Paso 2 — miralo mentirte

```bash
# write once
curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}' | jq

# read five times
for i in 1 2 3 4 5; do
  curl -si localhost:8080/fighters/goku | grep -E 'HTTP/|X-Upstream' | tr '\n' ' '
  echo
done
```

**Dos de cada tres requests devuelven 404.** La escritura cayó en una réplica; su
`MemStore` es privado. El leaderboard está mal en las tres, y cada una está mal de
forma distinta.

Esto no es un bug de tu código. Es el problema *definitorio* del horizontal
scaling, y cada arreglo de las Sagas 2 y 3 existe por esto.

```bash
for i in $(seq 1 12); do
  curl -s localhost:8080/leaderboard | jq -c 'length'
done
```

Longitudes distintas, mismo instante. Quedate un segundo con eso — así se ve un
bug de consistencia de datos desde afuera, y lo difícil que es reproducirlo con un
solo curl.

### Paso 3 — encontrá cada pedazo de estado

Grepeá tu propio servicio:

```bash
cd ~/repos/pato/gravity-chamber
grep -rn "sync\.\|map\[\|os.Create\|ioutil.WriteFile\|time.Ticker" internal/ cmd/
```

Escribí la lista en `NOTES.md` bajo "estado que encontré". Para cada uno:
*¿esto sería correcto con tres réplicas?*

Ahora mismo la respuesta honesta es `MemStore` — y nada más, que es por qué el
arreglo de la Cápsula 10 es acotado. Los servicios que crecieron orgánicamente
durante dos años producen una lista mucho más larga, y encontrarla es exactamente
este ejercicio.

### Paso 4 — el arreglo barato: hacé explícita la frontera

Todavía no podés agregar Postgres (Cápsula 10). Pero *sí* podés hacer lo que
convierte ese cambio en una línea: definir una interfaz en la frontera.

**`internal/scouter/store.go`** — agregá arriba de `MemStore`:

```go
// Store is the persistence boundary. MemStore implements it today and is
// wrong for more than one replica; Capsule 10 adds a Postgres implementation
// and nothing else in the service has to change.
type Store interface {
	Record(r Reading)
	Latest(fighter string) (Reading, bool)
	Leaderboard(n int) []Reading
}

// Compile-time proof that MemStore satisfies Store. If it ever stops
// matching, the build breaks here rather than at some call site.
var _ Store = (*MemStore)(nil)
```

Después cambiá `Server` para que dependa de la interfaz, no del tipo concreto:

```go
type Server struct {
	store Store        // was: *MemStore
	log   *slog.Logger
	ready atomic.Bool
}

func NewServer(store Store, log *slog.Logger) *Server {   // was: *MemStore
	s := &Server{store: store, log: log}
	s.ready.Store(true)
	return s
}
```

Nada más cambia; `make test` sigue pasando.

> **Por qué esto importa más allá de Go:** *dependé de la interfaz que necesitás,
> no de la implementación que tenés a mano.* Es la razón por la que la Cápsula 10
> es una cápsula chica en vez de una reescritura. Definí la costura antes de
> necesitarla — pero definila porque *ves venir* la segunda implementación, no
> especulativamente.

### Paso 5 — hacé identificable a la instancia

Cuando tres réplicas se portan mal, necesitás saber cuál. Agregá a `main.go`,
después de crear el logger:

```go
	// Every log line now carries the instance identity. In a container the
	// hostname is the container ID; on Cloud Run, set INSTANCE_ID from the
	// metadata server or just let the hostname be the revision instance.
	host, _ := os.Hostname()
	log = log.With("instance", host)
```

Reconstruí y mirá:

```bash
docker compose -f docker-compose.scale.yml up --build -d
for i in $(seq 1 6); do curl -s localhost:8080/leaderboard >/dev/null; done
docker compose -f docker-compose.scale.yml logs scouter | grep http_request | tail -6
```

Ahora cada línea dice qué instancia la sirvió. En producción este es el campo por
el que filtrás cuando exactamente una réplica está insana — y siempre hay
exactamente una.

### Paso 6 — matá una en pleno vuelo

```bash
# start a slow-ish stream of requests
while true; do curl -s -o /dev/null -w "%{http_code} " localhost:8080/healthz; sleep 0.2; done &

docker compose -f docker-compose.scale.yml ps -q scouter | head -1 | xargs docker kill
```

Mirá los códigos de estado. Con tres réplicas ves algunas fallas mientras nginx se
da cuenta, y después se recupera — **sin** que hagas nada. Esa resiliencia es la
segunda razón para correr más de una instancia, y honestamente es la mejor: la
capacidad es un lindo efecto secundario de no tener un único punto de falla.

```bash
kill %1
docker compose -f docker-compose.scale.yml down
```

---

## En GCP

El modelo de Cloud Run mapea directo a todo lo de arriba:

```bash
gcloud run deploy scouter \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \        # requests handled simultaneously per instance
  --cpu=1 --memory=512Mi
```

- **`--concurrency`** es la concurrencia por instancia del triángulo. Por defecto
  80. Para un servicio limitado por CPU, bajala (10–20) para que el autoscaler
  agregue instancias en vez de encolar adentro de una. Para uno limitado por E/S,
  más alto está bien y es más barato.
- **`--max-instances`** es un techo de costo tanto como de capacidad. También es
  una protección para lo que está aguas abajo: 1.000 instancias × 10 conexiones de
  base de datos son 10.000 conexiones, y tu base tiene un límite muy por debajo de
  eso. (Cápsula 10.)
- **`--min-instances`** cambia plata por latencia de cold start.
- Cloud Run autoescala principalmente por **utilización de concurrencia**, y
  secundariamente por CPU.

**GKE**, para el vocabulario: un `Deployment` con `replicas: N`, un
`HorizontalPodAutoscaler` apuntando a CPU o a una métrica custom, un
`PodDisruptionBudget` para que las disrupciones voluntarias (upgrades de nodos) no
puedan bajar todo de una, y `topologySpreadConstraints` para que tus réplicas no
caigan todas en una zona. Distintos sustantivos, ideas idénticas.

Los **Managed Instance Groups** de Compute Engine hacen lo mismo para VMs, con
autohealing manejado por un health check.

---

## Llevátelo al trabajo

- **"¿Puedo matar cualquier instancia ahora mismo?"** debería responderse *sí* en
  cualquier momento. Si no, nombrá el estado y adónde debería mudarse.
- **Nunca dejes que una sola instancia tenga estado visible al usuario**, incluidos
  caches en memoria cuya obsolescencia se note.
- **Logueá la identidad de la instancia en cada línea.** No negociable cuando
  N > 1.
- **Las sticky sessions son deuda.** Anotalas como deuda cuando las tomás.
- **Poné `max-instances` a propósito** — es la barrera entre un pico de tráfico y
  un incidente de agotamiento de conexiones de base de datos.
- **Capacidad = réplicas × concurrencia.** Conocé los dos números de tu servicio.
  La mayoría no conoce ninguno.

---

## Battle drill

<details>
<summary><b>1.</b> Un servicio funciona con 1 réplica y falla de a ratos con 3. ¿Dónde mirás primero?</summary>

Cualquier cosa en proceso: un cache o un almacén de sesiones en memoria, un
archivo local, un job de fondo con `time.Ticker` que ahora corre tres veces, o un
rate limiter contando por instancia (así que tu "límite de 100 req/s" ahora son
300).

El patrón diagnóstico es la pistola humeante: **fallas que correlacionan con qué
instancia sirvió el request** y desaparecen cuando volvés a una. Si tus logs
llevan el ID de instancia (Paso 5), esto toma una query en vez de un día.
</details>

<details>
<summary><b>2.</b> ¿Por qué una concurrencia alta por instancia esconde la necesidad de escalar?</summary>

El autoscaler mide *utilización* de concurrencia contra tu objetivo configurado.
Ponés el objetivo en 1000 y cada instancia acepta mil requests simultáneos — pero
su CPU y su pool de conexiones no los pueden servir, así que encolan
internamente. La latencia sube abruptamente mientras el autoscaler ve utilización
muy por debajo del objetivo y no agrega nada.

Moviste la cola del load balancer (donde es visible y descartable) a tu proceso
(donde es invisible y sin límite). Poné la concurrencia en lo que una instancia
puede servir genuinamente, y dejá que el scale-out haga el resto.
</details>

<details>
<summary><b>3.</b> ¿Cuándo se justifica genuinamente la stickiness?</summary>

Conexiones con estado de larga vida — WebSockets, SSE, streams de gRPC — donde la
conexión *es* el estado y moverla significa reconectar. También algunas apps
legadas donde externalizar el estado de sesión no es viable en el plazo
disponible.

Incluso ahí: mantené el estado recuperable, para que perder una instancia sea una
reconexión y no una pérdida de datos. Diseñá para "el cliente reconecta y
retoma", no para "el servidor se acuerda".
</details>

<details>
<summary><b>4.</b> Escalás de 5 a 50 réplicas y la base de datos se cae. ¿Qué pasó y qué hacés?</summary>

Cada réplica tiene un pool de conexiones. 50 × 20 = 1.000 conexiones; Postgres
viene con `max_connections = 100` y cada conexión cuesta varios MB de memoria del
servidor más overhead de scheduling. La base pasa el tiempo haciendo context
switching en vez de responder queries.

Soluciones, en orden: topeá `max-instances`; achicá el pool por instancia (un pool
chico por réplica suele ser lo correcto); poné un **connection pooler** adelante
(PgBouncer, o Cloud SQL Auth Proxy / el pooling incorporado de AlloyDB) para que
miles de conexiones de cliente se multiplexen sobre decenas del servidor; y
agregá read replicas o caching para sacar la carga por completo.

Este es el lab de la Cápsula 10, y es una de las fallas de escalado más comunes
del mundo real.
</details>

<details>
<summary><b>5.</b> ¿Cómo corrés un job programado en un servicio escalado horizontalmente?</summary>

No con un ticker en proceso — lo correrías N veces en paralelo.

Opciones, más o menos en orden de preferencia: un **scheduler externo** que
dispare un endpoint (Cloud Scheduler → Cloud Run, o un `CronJob` de Kubernetes);
una **cola** donde el scheduler encola y cualquier worker lo toma; o **elección de
líder** vía un lock distribuido, donde una instancia tiene el lock y hace el
trabajo.

Elijas lo que elijas, hacé el job **idempotente** — los schedulers reintentan, y
at-least-once es la única garantía que tenés (Cápsula 19).
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `port is already allocated` al escalar | Las réplicas no pueden compartir un puerto del host. Sacá `ports:` del servicio escalado; solo el LB publica uno. |
| nginx: `host not found in upstream` | Compose crea la red antes de que los containers estén sanos. `depends_on` ayuda; si no, reiniciá nginx. |
| Las réplicas nuevas no reciben tráfico después de un `--scale` | nginx resuelve `scouter` **una sola vez, al cargar la config**, y expande todos los A records que Docker devuelve en ese momento. Las réplicas que arrancan después le son invisibles. `docker compose restart lb`. (Escalar *hacia abajo* sí está cubierto: nginx saca un upstream muerto cuando falla la conexión.) En producción esto es por qué apuntás a una VIP estable del servicio, o usás `resolver 127.0.0.11 valid=5s;` con una variable en `proxy_pass`, que fuerza re-resolución por request. |
| `deploy.replicas` ignorado | Esa clave es de la era Swarm. El `docker compose up` moderno la respeta; si el tuyo no, usá `docker compose up --scale scouter=3`. |
| No sabés qué réplica respondió | Mirá el header `X-Upstream`, o el campo `instance` en los logs después del Paso 5. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "refactor(scouter): introduce Store interface; add instance identity

Capsule 06. Ran 3 replicas behind nginx and confirmed MemStore makes the
service stateful: writes are invisible to 2 of 3 replicas. Extracted a Store
interface so Capsule 10 can swap in Postgres without touching handlers.
Every log line now carries the instance hostname."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 06
```

**Siguiente:** [Cápsula 07 · La Torre de Karin — Load balancing](../07-korins-tower-load-balancing/README.md)
