# Cápsula 13 · Fusión namekiana — Replicación y consistencia

> *Nail se fusiona con Piccolo. Dos seres, una mente — salvo que por un momento
> durante la fusión, todavía no son el mismo. Todo lo difícil de la replicación
> vive en ese momento: cuánto dura, qué se puede observar durante él, y quién gana
> cuando no coinciden.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 8 | 80 min | Cápsulas 10–12 | Local |

---

## Por qué existe esta cápsula

Tenés una sola base de datos. Es un punto único de falla y un cuello de botella de
lectura. La replicación arregla las dos cosas — e introduce el concepto más
difícil de los sistemas distribuidos: **las cosas pueden ser verdad en un lugar y
todavía no en otro.**

Esta cápsula es donde "consistencia eventual" deja de ser una frase que asentís y
se vuelve un bug específico que reprodujiste con tus propias manos, más los cuatro
patrones que lo arreglan.

---

## El concepto

### Replicación leader/follower

```
              writes
                │
                ▼
        ┌───────────────┐
        │    LEADER     │  accepts all writes, streams its WAL
        └───┬───────┬───┘
            │       │
      ┌─────▼──┐ ┌──▼─────┐
      │follower│ │follower│   read-only, applies the log
      └────────┘ └────────┘
            ▲       ▲
          reads   reads
```

El líder escribe a su **write-ahead log** (WAL) y se lo manda a los followers, que
lo reproducen. Ese log es el mecanismo entero, y es el mismo mecanismo detrás de
la recuperación a un punto en el tiempo, el change data capture (Cápsula 21) y la
mayor parte de la replicación entre regiones.

### Sincrónica vs asincrónica

| | Sync | Async |
|---|---|---|
| El commit vuelve | después de que un follower confirma | apenas el líder lo tiene |
| Latencia de escritura | líder + red + follower | solo el líder |
| Pérdida de datos si cae el líder | ninguna | **todo lo que no se había enviado** |
| Si un follower está lento | las escrituras se bloquean | nada |

Postgres ofrece un punto medio: `synchronous_commit = on` con
`synchronous_standby_names` en `ANY 1 (s1, s2, s3)` — esperá a *cualquiera* de
tres, así un follower lento no te frena.

**La posición práctica a la que llega la mayoría de los equipos:** un standby
sincrónico para durabilidad y failover (que es lo que te da Cloud SQL HA), más
read replicas asincrónicas para escalar.

### El lag de replicación, y los cuatro bugs que causa

El lag normalmente es de milisegundos. Se vuelve de segundos o minutos durante
cargas masivas, queries largas en el follower, problemas de red, o un follower en
hardware débil.

**1. Read-your-writes.** El usuario actualiza su perfil, lo redirigís, lee de una
réplica atrasada, y ve el valor viejo. Concluye que tu app está rota. No se
equivoca.

**2. Lecturas monótonas.** Dos lecturas consecutivas pegan en réplicas distintas
con lag distinto, así que el usuario ve datos moverse *hacia atrás en el tiempo*.

**3. Prefijo consistente.** Las réplicas aplican eventos en orden distinto entre
sí, así que una respuesta aparece antes que su pregunta.

**4. Invariantes entre entidades.** Leés A de una réplica fresca y B de una
atrasada; juntos son un estado que nunca existió.

### Las cuatro soluciones

| Patrón | Cómo | Costo |
|---|---|---|
| **Leer del líder después de escribir** | por N segundos después de la escritura de un usuario, clavá *a ese usuario* al líder | carga en el líder; hace falta seguimiento por usuario |
| **Réplica pegajosa** | un usuario siempre lee de la misma réplica | arregla solo las lecturas monótonas; carga despareja |
| **Esperar el LSN** | el cliente recuerda la posición de log de su escritura, la réplica espera alcanzarla | correcto y preciso; necesita soporte |
| **Diseñarlo para que no exista** | después de escribir, mostrá el valor que ya tenés; no releas | gratis. Normalmente la respuesta correcta |

La última merece énfasis. La mayoría de los bugs de read-your-writes son
auto-infligidos: la escritura ya devolvió el estado nuevo. Mostrar eso en vez de
volver a leer elimina el problema por completo, no cuesta nada, y es más rápido.

### CAP, honestamente

**CAP:** cuando la red se *particiona*, tenés que elegir entre **C**onsistencia y
**A**vailability. Eso es todo. CAP no dice nada sobre la operación normal, y "CP
vs AP" como etiqueta de producto es mayormente marketing.

**PACELC** es la formulación más útil:

> **si P**artición, elegí **A**vailability o **C**onsistencia;
> **E**n otro caso (operación normal), elegí **L**atencia o **C**onsistencia.

La rama del "else" es en la que vivís el 99,99% del tiempo. La consistencia fuerte
cuesta latencia *todos los días*, no solo durante particiones — porque significa
coordinación, y la coordinación significa round trips.

### Modelos de consistencia, de fuerte a débil

```
  Linearizable ──► Sequential ──► Causal ──► Eventual
  (single global    (agreed        (cause      (converges
   order, real-      order)         before      someday)
   time)                            effect)

  slower, more coordination  ────────────►  faster, more anomalies
```

La mayoría de los sistemas quiere **consistencia causal** y se conforma con
**eventual** con arreglos puntuales en los pocos lugares donde el usuario lo
notaría.

### Quórums

Para sistemas sin líder / multi-líder (Cassandra, DynamoDB):

```
  N = replicas,  W = replicas that must ack a write,  R = replicas read from

  W + R > N  →  read and write sets overlap  →  you read the latest write
```

`N=3, W=2, R=2` es el clásico: sobrevive a un nodo caído, y sigue siendo
fuertemente consistente para lecturas. `W=1, R=1` es rápido y no te da nada.

Los quórums solos no ordenan escrituras concurrentes — eso necesita version
vectors, last-write-wins (que pierde datos en silencio), o CRDTs.

### Spanner y TrueTime

Spanner logra transacciones **globalmente linealizables**, lo cual suena
imposible. El truco: GPS y relojes atómicos en cada datacenter dan una
incertidumbre de reloj acotada ε (unos pocos ms). Al commitear, Spanner
**espera deliberadamente ε** para garantizar el orden de timestamps.

Google compró consistencia con **hardware y latencia**. Es real, funciona, y la
razón para no usarlo es el costo — no la corrección.

---

## Lab

### Paso 1 — una réplica de streaming real

Replicación física de Postgres, en compose.

**`deploy/docker-compose.replica.yml`**

```yaml
name: gravity-chamber-replica

services:
  primary:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: scouter
      POSTGRES_PASSWORD: kamehameha
      POSTGRES_DB: scouter
    # initdb's default pg_hba.conf allows replication from localhost ONLY, so
    # without this the standby's pg_basebackup is refused. See Senzu.
    volumes:
      - ./sql-replication:/docker-entrypoint-initdb.d:ro
    command: >
      postgres
      -c wal_level=replica
      -c max_wal_senders=5
      -c max_replication_slots=5
      -c hot_standby=on
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scouter"]
      interval: 3s
      retries: 15

  replica:
    image: postgres:16-alpine
    depends_on:
      primary:
        condition: service_healthy
    environment:
      PGPASSWORD: kamehameha
    ports: ["5435:5432"]
    user: postgres
    # pg_basebackup clones the primary, then we start as a hot standby.
    command: >
      bash -c '
        if [ ! -s /var/lib/postgresql/data/PG_VERSION ]; then
          pg_basebackup -h primary -U scouter -D /var/lib/postgresql/data -Fp -Xs -P -R
        fi
        chmod 0700 /var/lib/postgresql/data
        exec postgres -c hot_standby=on'
```

El primary necesita una cosa más antes de que el standby pueda clonarlo:

**`deploy/sql-replication/00_allow_replication.sh`**

```bash
#!/bin/sh
# initdb writes a pg_hba.conf that permits replication connections from
# localhost only. A standby in another container is not localhost, so
# pg_basebackup gets "no pg_hba.conf entry for replication connection".
#
# `all` for the source address is fine on a compose network you control and
# nowhere else — in production this is a specific CIDR and a dedicated role
# with the REPLICATION attribute and nothing more.
set -e
echo "host replication all all scram-sha-256" >> "$PGDATA/pg_hba.conf"
```

```bash
chmod +x deploy/sql-replication/00_allow_replication.sh
```


```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose -f docker-compose.replica.yml up -d
sleep 15
docker compose -f docker-compose.replica.yml logs replica | tail -5
```

Verificá la topología:

```bash
# on the primary: who's connected?
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter -c \
  "SELECT client_addr, state, sync_state, replay_lag FROM pg_stat_replication;"

# on the replica: am I in recovery?
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_is_in_recovery();"     -- must be t
```

### Paso 2 — mirá la replicación funcionar, después mirala fallar

```bash
# schema + a row on the primary
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter <<'SQL'
CREATE TABLE IF NOT EXISTS fighters (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  race TEXT NOT NULL DEFAULT 'unknown');
INSERT INTO fighters (name, race) VALUES ('goku','saiyan') ON CONFLICT DO NOTHING;
SQL

# it's on the replica within milliseconds
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT * FROM fighters;"

# and the replica is READ ONLY
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "INSERT INTO fighters (name) VALUES ('vegeta');"
# ERROR: cannot execute INSERT in a read-only transaction
```

Ese error es el contrato. Tu aplicación tiene que saber cuál conexión es cuál —
que es el paso siguiente.

### Paso 3 — reproducí un bug de read-your-writes

Creá lag a propósito pausando el replay en la réplica:

```bash
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_wal_replay_pause();"

# write to the primary
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter -c \
  "INSERT INTO fighters (name, race) VALUES ('trunks','half-saiyan');"

echo "--- primary ---"
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter -tAc \
  "SELECT count(*) FROM fighters;"
echo "--- replica ---"
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -tAc \
  "SELECT count(*) FROM fighters;"
```

Respuestas distintas, mismo instante. **Este es el bug que tus usuarios reportan
como "lo guardé y desapareció".** Ahora medí el lag:

```bash
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter -c \
  "SELECT client_addr, replay_lag, sent_lsn, replay_lsn FROM pg_stat_replication;"
```

Reanudá y mirá cómo converge:

```bash
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_wal_replay_resume();"
sleep 1
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -tAc \
  "SELECT count(*) FROM fighters;"
```

### Paso 4 — separación de lectura/escritura en la app

**`internal/scouter/replicated.go`**

```go
package scouter

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// ReplicatedStore sends writes to the primary and reads to replicas,
// with read-your-writes protection: for a short window after a fighter is
// written, that fighter's reads are pinned to the primary.
type ReplicatedStore struct {
	primary  *PostgresStore
	replicas []*PostgresStore
	next     atomic.Uint64

	// recentWrites: fighter -> deadline until which reads must hit the primary.
	// A per-key map is a deliberate choice: pinning ALL reads to the primary
	// after ANY write would defeat the purpose of having replicas.
	mu           sync.RWMutex
	recentWrites map[string]time.Time
	window       time.Duration
}

var _ Store = (*ReplicatedStore)(nil)

func NewReplicatedStore(primary *PostgresStore, replicas []*PostgresStore, window time.Duration) *ReplicatedStore {
	s := &ReplicatedStore{
		primary:      primary,
		replicas:     replicas,
		recentWrites: make(map[string]time.Time),
		window:       window,
	}
	go s.reap()
	return s
}

// readFor picks primary or a replica, round-robin.
func (s *ReplicatedStore) readFor(fighter string) *PostgresStore {
	if len(s.replicas) == 0 {
		return s.primary
	}
	s.mu.RLock()
	until, pinned := s.recentWrites[fighter]
	s.mu.RUnlock()
	if pinned && time.Now().Before(until) {
		return s.primary // read-your-writes
	}
	i := s.next.Add(1)
	return s.replicas[int(i)%len(s.replicas)]
}

func (s *ReplicatedStore) Record(r Reading) {
	s.primary.Record(r)
	s.mu.Lock()
	s.recentWrites[r.Fighter] = time.Now().Add(s.window)
	s.mu.Unlock()
}

func (s *ReplicatedStore) Latest(fighter string) (Reading, bool) {
	return s.readFor(fighter).Latest(fighter)
}

// Leaderboard is not tied to one fighter, so it always reads a replica.
// That is a deliberate consistency trade: a leaderboard may be a second
// stale, and nobody will ever notice.
func (s *ReplicatedStore) Leaderboard(n int) []Reading {
	if len(s.replicas) == 0 {
		return s.primary.Leaderboard(n)
	}
	i := s.next.Add(1)
	return s.replicas[int(i)%len(s.replicas)].Leaderboard(n)
}

func (s *ReplicatedStore) Ping(ctx context.Context) error { return s.primary.Ping(ctx) }

func (s *ReplicatedStore) reap() {
	t := time.NewTicker(time.Minute)
	for range t.C {
		now := time.Now()
		s.mu.Lock()
		for k, v := range s.recentWrites {
			if now.After(v) {
				delete(s.recentWrites, k)
			}
		}
		s.mu.Unlock()
	}
}
```

Cableálo en `main.go` detrás de `REPLICA_URLS`:

```go
	// en cmd/scouter/main.go, justo después de abrir el pool del primary.
	// A diferencia del caso de shards, te quedás con el primary Y las replicas:
	// las escrituras y el read-your-writes van a `pg`, el resto puede servirse
	// con datos algo viejos.
	if urls := os.Getenv("REPLICA_URLS"); urls != "" {
		var replicas []*scouter.PostgresStore
		for _, dsn := range strings.Split(urls, ",") {
			r, err := scouter.NewPostgresStore(context.Background(), dsn)
			if err != nil {
				log.Error("replica unavailable", "err", err)
				os.Exit(1)
			}
			defer r.Close()
			replicas = append(replicas, r)
		}
		store = scouter.NewReplicatedStore(pg, replicas, 5*time.Second)
		log.Info("replicated store", "replicas", len(replicas))
	}
```

Ese `5*time.Second` es la ventana de read-your-writes: cuánto tiempo después de
una escritura seguís mandando las lecturas *de ese* fighter al primary. Muy
corta y el usuario ve desaparecer su propia escritura; muy larga y las replicas
dejan de justificar lo que cuestan. Medí tu lag de replicación real y poné la
ventana bastante por encima del p99.

```bash
REPLICA_URLS="postgres://scouter:kamehameha@localhost:5435/scouter?sslmode=disable" \
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" \
  make run
```

Ahora repetí el experimento de pausar el replay mientras le pegás a tu API:

```bash
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_wal_replay_pause();"

curl -s -XPOST localhost:8080/readings -d '{"fighter":"broly","power":1400000}' | jq
curl -s localhost:8080/fighters/broly | jq     # ✅ found — pinned to primary
curl -s localhost:8080/leaderboard | jq        # ⚠️ broly missing — replica is stale

PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_wal_replay_resume();"
```

**Los dos comportamientos son correctos**, y poder decir *por qué* cada uno es
aceptable es la habilidad real. Escribí el razonamiento en `NOTES.md`.

### Paso 5 — failover, y lo que cuesta

```bash
docker compose -f docker-compose.replica.yml stop primary

# reads still work
curl -s localhost:8080/leaderboard | jq 'length'

# writes do not
curl -s -XPOST localhost:8080/readings -d '{"fighter":"cell","power":900000}' | jq
```

Promové la réplica:

```bash
docker compose -f docker-compose.replica.yml exec replica \
  psql -U scouter -d scouter -c "SELECT pg_promote();"

sleep 3
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_is_in_recovery();"   -- now f
```

Anotá lo que acaba de pasar, porque es la lección real:

- Cualquier escritura que no se había enviado antes de que muriera el primario
  **se perdió**. Con replicación asincrónica, el failover significa aceptar
  pérdida de datos.
- El primario viejo no puede simplemente volver — divergió. Tiene que
  reconstruirse (`pg_rewind` o un basebackup nuevo). **Dos primarios aceptando
  escrituras es split-brain**, y corrompe datos de formas extremadamente dolorosas
  de desenredar.
- Algo tiene que decidir *cuándo* promover. Promover ante un parpadeo de red
  cuando el primario viejo está vivo es cómo llegás a split-brain, y por eso los
  setups reales usan un gestor basado en consenso (Patroni, o un servicio
  gestionado).

```bash
docker compose -f docker-compose.replica.yml down -v
```

---

## En GCP

**Cloud SQL HA** — un standby sincrónico en otra zona, failover automático en
alrededor de 60 segundos, sin pérdida de datos en el failover. Más o menos duplica
el costo. Asumí que es obligatorio para cualquier cosa de producción.

**Read replicas de Cloud SQL** — asincrónicas, hasta 10, pueden vivir en otras
regiones, y se pueden promover para recuperación ante desastres. El lag se expone
como `replica_lag` en Cloud Monitoring. **Alertá sobre eso** — una réplica
calladamente atrasada horas es peor que no tener réplica.

**AlloyDB** — un primario con read pools que escalan de forma independiente; mejor
para cargas mixtas analíticas/transaccionales.

**Spanner** — replicación multi-región sincrónica vía Paxos, externamente
consistente, sin failover que gestionar. Desde ~USD 65/mes por la instancia de
producción más chica.

**Firestore / Bigtable** — replicados automáticamente; Firestore ofrece
consistencia fuerte para lecturas de documentos y eventual para algunos tipos de
query. Leé las garantías específicas; no son uniformes.

**Multi-región es una decisión sobre dominios de falla, no sobre velocidad.**
Cuesta latencia (~100 ms entre continentes), plata (egress) y complejidad. Hacelo
cuando una caída regional sea genuinamente inaceptable, no por defecto.

---

## Llevátelo al trabajo

- **Alertá sobre el lag de replicación**, con un umbral atado a lo que tolera tu
  app.
- **Ruteá explícitamente.** Una separación lectura/escritura que "normalmente
  funciona" falla en el peor momento. Hacé que sea una decisión deliberada y
  visible por query.
- **Preferí diseñar para que read-your-writes no exista** — mostrá el valor que ya
  tenés en vez de releer.
- **Conocé tu RPO de failover.** "¿Cuántos datos perdemos si el primario muere
  ahora mismo?" debería tener un número, no un encogimiento de hombros.
- **Nunca permitas dos primarios.** Fencing y consenso, no heurísticas.
- **Las queries largas en una réplica demoran el replay.** Una query analítica de
  10 minutos puede crear 10 minutos de lag (o ser cancelada por
  `max_standby_streaming_delay`). Sabé cuál configuraste.
- **Ensayá el failover antes de necesitarlo.** Un failover que nunca ensayaste es
  una hipótesis.

---

## Battle drill

<details>
<summary><b>1.</b> Los usuarios reportan "lo guardé y no está". ¿Cómo lo diagnosticás y lo arreglás?</summary>

**Diagnóstico:** correlacioná los reportes con las métricas de lag de replicación.
Chequeá si el camino de lectura usa una réplica. Reproducilo pausando el replay
(Paso 3). Buscá el patrón "falla justo después de escribir, funciona 2 segundos
después" — esa es la firma.

**Solución, de la más barata a la más cara:**
1. **No releas.** La escritura devolvió el estado nuevo; mostralo. Gratis.
2. **Clavá las lecturas de ese usuario al primario** por unos segundos después de
   su escritura.
3. **Espera basada en LSN** — el cliente guarda la posición de log de su
   escritura; la réplica espera alcanzarla. Preciso pero necesita plomería.
4. **Leé del primario** para ese endpoint. Simple, cuesta capacidad del líder.

**Prevención:** decidí por endpoint si tolera datos viejos, y escribilo. "El
leaderboard puede estar 5 s atrasado; el perfil propio de un usuario no" es una
decisión de diseño, no un accidente.
</details>

<details>
<summary><b>2.</b> ¿Cuándo vale la replicación sincrónica lo que cuesta en latencia?</summary>

Cuando perder datos commiteados es inaceptable: pagos, libros contables,
colocación de órdenes, cualquier cosa con consecuencia legal o financiera.

El costo es real — cada commit espera un round trip de red más el fsync del
follower, así que la latencia de escritura más o menos se duplica dentro de una
región y se vuelve prohibitiva entre regiones.

Los puntos medios que conviene conocer: `synchronous_commit = on` con
`ANY 1 (s1, s2, s3)` para que un follower lento no frene las escrituras; o
configuración *por transacción*, para que el camino de pago sea sincrónico y la
escritura de analítica no. Esa última suele ser la respuesta correcta — la
consistencia es una propiedad que elegís por operación, no por base de datos.
</details>

<details>
<summary><b>3.</b> Explicale PACELC a alguien que "sabe CAP".</summary>

CAP solo describe el comportamiento *durante una partición de red*, que es raro.
No te dice nada sobre el 99,99% del tiempo en que la red está bien, que es donde
realmente vivís.

PACELC agrega esa rama: **si P**artición, elegí **A** o **C**; **E**n otro caso,
elegí **L**atencia o **C**onsistencia.

Ese "else" es el trade-off real. La consistencia fuerte requiere coordinación; la
coordinación requiere round trips; los round trips son latencia que pagás en cada
request, todos los días. DynamoDB es PA/EL — disponible bajo partición, latencia
baja en lo normal. Spanner es PC/EC — consistente siempre, y paga latencia por
eso.

La idea: **estás eligiendo latencia contra consistencia constantemente, no solo
durante las caídas.**
</details>

<details>
<summary><b>4.</b> Tu leaderboard está 30 segundos atrasado. ¿Es un bug?</summary>

Depende enteramente del *contrato*, que es por qué el contrato tiene que existir.

Preguntá: ¿alguien actúa sobre esto de una forma que importe? ¿Hay plata o un
premio de por medio? ¿El usuario ve su propio envío faltando — porque *eso* es un
problema de read-your-writes y va a generar tickets de soporte aunque el ranking
en sí esté bien?

Si 30 s es aceptable, decilo explícitamente, cacheálo agresivamente (Cápsula 14) y
**mostrá la frescura en la UI** ("actualizado hace 12 segundos"). Exponer la
obsolescencia convierte un reporte de bug en una feature.

Si no es aceptable, eso es un requisito real con costo real: leé del primario, o
mantené el ranking de forma incremental en Redis en cada escritura.

El modo de falla es no tener respuesta — lo que significa que es un bug el día que
alguien decida que lo es.
</details>

<details>
<summary><b>5.</b> ¿Qué es split-brain y cómo lo previenen los sistemas?</summary>

Dos nodos creen ambos que son el primario y ambos aceptan escrituras. Cuando se
reconcilian, tenés historias en conflicto y ningún merge correcto — este es uno de
los pocos escenarios de pérdida de datos genuinamente irrecuperables.

Pasa cuando una partición de *red* se confunde con una falla de *nodo*: el
follower no puede alcanzar al primario, asume que está muerto, se promueve solo,
mientras el primario sigue sirviendo felizmente a otro conjunto de clientes.

Prevención:
- **Quórum/consenso** — la promoción requiere mayoría (Raft, Paxos). Una partición
  minoritaria matemáticamente no puede elegir un líder.
- **Fencing / STONITH** — deshabilitá por la fuerza al primario viejo (revocá su
  lease de storage, matá la VM) antes de promover.
- **Leases con vencimiento** — el liderazgo está acotado en el tiempo y hay que
  renovarlo, así que un líder particionado deja de aceptar escrituras solo.

Esta es precisamente la razón por la que usás un servicio gestionado o un gestor
basado en consenso en vez de un script de shell que pinguea al primario y promueve
si falla.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| La réplica no arranca | `pg_basebackup` necesita `wal_level=replica` y un primary alcanzable. Mirá primero los logs de la réplica. |
| `FATAL: no pg_hba.conf entry for replication connection from host "172.x.x.x"` | El primary está rechazando el clon. El `pg_hba.conf` que escribe initdb permite replicación solo desde localhost — eso es lo que arregla `sql-replication/00_allow_replication.sh`. Si creaste el volumen del primary antes de agregar el script, hacé `docker compose -f docker-compose.replica.yml down -v` y arrancá de nuevo: `docker-entrypoint-initdb.d` corre **solo** con un data directory vacío. |
| `FATAL: data directory "/var/lib/postgresql/data" has invalid permissions` / `Permissions should be u=rwx (0700)` | Docker creó el punto de montaje en `0755` y Postgres se niega a arrancar sobre un data directory legible por grupo u otros. De ahí el `chmod 0700` después del `pg_basebackup`. Esto no es una rareza de containers — es el mismo chequeo que te muerde en un standby armado a mano sobre un host real. |
| `cannot execute INSERT in a read-only transaction` | Ruteaste una escritura a una réplica. Esa es la barrera funcionando. |
| El lag crece sin límite | Una query larga en la réplica, recursos insuficientes en la réplica, o una ráfaga de escrituras enorme. Mirá `pg_stat_activity` en la réplica. |
| Las queries de la réplica se cancelan | Se excedió `max_standby_streaming_delay` — el replay entra en conflicto con tu query. Subilo (más lag) o usá `hot_standby_feedback` (bloat en el primario). |
| La réplica promovida no vuelve como standby | Divergió. `pg_rewind` o basebackup nuevo. Nunca la reinicies y ya. |
| Los dos nodos aceptan escrituras | Split-brain. Pará todo, elegí un sobreviviente, reconstruí el otro. Después averiguá por qué se promovió. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(store): read/write split with read-your-writes pinning

Capsule 13. Real streaming replica in compose. Reproduced stale reads by
pausing WAL replay. ReplicatedStore pins a fighter's reads to the primary
for a window after their write; leaderboard deliberately tolerates staleness.
Rehearsed failover and confirmed async replication means data loss."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 13
```

**Siguiente:** [Cápsula 14 · Semilla del Ermitaño — Fundamentos de caching](../14-senzu-bean-caching/README.md)
