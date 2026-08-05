# Cápsula 10 · El Archivo del Gran Patriarca — Datos relacionales

> *El Gran Patriarca está en lo alto de Namek y se acuerda de todo: cada
> namekiano, cada Esfera del Dragón, cada linaje. Es la única fuente de verdad de
> un planeta entero — y cuando muere, las Esferas se vuelven piedra. Todo depende
> de él, y todos lo saben.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 7 | 85 min | Cápsulas 06, 09 · opcional [B4 SQL esencial](../bonus/B4-ancient-namekian-sql/README.md) | Local + concepto |

---

## Por qué existe esta cápsula

La Cápsula 06 probó que el Scouter tiene estado y por lo tanto no puede escalar.
Este es el arreglo — y también es donde empiezan los problemas genuinamente
difíciles.

El cómputo es fácil: es sin estado, intercambiable y descartable. **Los datos son
donde vive la dificultad**, porque tienen que ser correctos, durables,
consistentes y disponibles todo a la vez, y esos objetivos entran en conflicto.
Cada cápsula que queda en este repo está aguas abajo de una decisión que se toma
acá.

También vas a conocer los dos modos de falla que explican una enorme proporción de
los incidentes reales de "el sitio está lento": **agotamiento del pool de
conexiones** y **queries N+1**.

---

## El concepto

### Por qué lo relacional es el default correcto

Te van a decir que SQL no escala. Lo que quieren decir es que *un solo primario*
no escala escrituras pasado cierto punto — lo cual es cierto, y son las Cápsulas
12 y 13. Todo lo demás de las bases relacionales es un default fuerte:

- **Los schemas** agarran una clase entera de bug al escribir en vez de al leer,
  seis meses después, en otro servicio.
- **Transacciones con garantías ACID** — lo que más vas a extrañar si lo resignás.
- **Los joins** te dejan evitar duplicar datos. Desnormalizar es una optimización
  que deberías tener que justificar.
- **Un planificador de queries declarativo** — decís qué querés, él resuelve cómo.
  Casi nunca le vas a ganar a mano (Cápsula 11).
- **Cuarenta años de conocimiento operativo.** Todos saben cómo respaldarla,
  restaurarla, monitorearla y tunearla.

Empezá acá. Movete cuando tengas una razón medida, no una sensación.

### ACID, rápido

- **Atomicidad** — toda la transacción o nada.
- **Consistencia** — las restricciones valen antes y después.
- **Aislamiento** — las transacciones concurrentes no ven el desorden de las
  otras.
- **Durabilidad** — commiteado significa que sobrevive a un crash.

**Los niveles de aislamiento** son lo que sí tenés que entender, porque son una
perilla de corrección contra throughput:

| Nivel | Previene | Todavía permite |
|---|---|---|
| Read Uncommitted | — | dirty reads (Postgres nunca los hace realmente) |
| **Read Committed** *(default de Postgres)* | dirty reads | non-repeatable reads, fantasmas |
| Repeatable Read | + non-repeatable reads | (en Postgres: fallas de serialización) |
| Serializable | todo | nada — pero las transacciones pueden abortarse y hay que reintentarlas |

El default es Read Committed, y significa que **la misma query adentro de una
transacción puede devolver resultados distintos** si otro commitea en el medio.
Eso sorprende. Cuando necesitás "leer el saldo, después actualizarlo según lo que
leí", necesitás o bien `SELECT … FOR UPDATE`, o Serializable con un loop de
reintentos, o una actualización atómica de una sola sentencia.

### Connection pooling — leé esto dos veces

Una conexión de Postgres es un **proceso de SO separado** en el servidor con
varios MB de memoria. `max_connections` viene en 100. Las conexiones son caras de
crear (TCP + TLS + auth ≈ 5–50 ms) y caras de *tener*.

```
  10 replicas × 20 connections each = 200 connections
  Postgres max_connections = 100
  → half your replicas cannot connect. Under load. Simultaneously.
```

Y aun cuando entran, una cantidad alta de conexiones duele: pasado más o menos
`2 × cores + effective_spindles`, Postgres pasa el tiempo haciendo context
switching en vez de responder queries. **Menos conexiones a menudo significa más
throughput.**

Las reglas:

- El tamaño del pool por réplica debería ser **chico** — a menudo 5–10, no 100.
- `conexiones totales = réplicas × tamaño del pool` tiene que quedar bien por
  debajo de `max_connections`.
- Topeá `max-instances` (Cápsula 06) precisamente por esta cuenta.
- Pasadas unas pocas centenas de clientes, poné un **pooler** adelante: PgBouncer
  en modo transacción multiplexa miles de conexiones de cliente sobre decenas del
  servidor. En GCP, el Cloud SQL Auth Proxy maneja la conectividad y AlloyDB trae
  pooling incorporado.
- Siempre poné `max_conn_lifetime` — deja que las conexiones roten para que un
  failover o un cambio de DNS no te deje clavado a un host muerto.

### La query N+1

El bug de performance más común del código de aplicación:

```
  1 query:  SELECT * FROM fighters LIMIT 100
  then, in a loop, 100 queries: SELECT ... FROM readings WHERE fighter_id = ?

  = 101 round trips. At 2ms each that's 202ms of pure network latency,
    for data one JOIN would have returned in 3ms.
```

Los ORMs lo causan por defecto vía lazy loading, y es invisible en local (round
trips de 0,1 ms) y catastrófico en producción (round trips de 2 ms).

Soluciones: un `JOIN`; un solo `WHERE id = ANY($1)` con todos los ids; o un
lateral join / window function para "top N por grupo". El diagnóstico es siempre
el mismo: **contá tus queries por request.**

### Diseño de schema que conviene hacer bien

- **Toda tabla tiene primary key.** Preferí `BIGINT GENERATED ALWAYS AS IDENTITY`
  para claves internas; usá UUIDv7 si necesitás ids generados por el cliente (un
  UUIDv4 como primary key destruye la localidad de índice e infla los B-trees).
- **`TIMESTAMPTZ`, nunca `TIMESTAMP`.** Guardar hora local sin zona es un bug que
  descubrís en un cambio de horario.
- **`NOT NULL` por defecto.** Cada columna nullable es una rama en cada pedazo de
  código que la lee.
- **Foreign keys con `ON DELETE` explícito.** Decí qué pasa; que no sea una
  sorpresa.
- **`NUMERIC` para plata, nunca `FLOAT`.** `0.1 + 0.2 != 0.3`.
- **Restricciones `CHECK` para invariantes.** La base de datos es la última línea
  de defensa y nunca tiene un bug en la capa de aplicación.

---

## Lab — dale al Scouter una base de datos de verdad

### Paso 1 — Postgres en compose

Agregá a **`deploy/docker-compose.yml`**:

```yaml
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: scouter
      POSTGRES_PASSWORD: kamehameha      # local only — see the note below
      POSTGRES_DB: scouter
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./sql:/docker-entrypoint-initdb.d:ro   # *.sql here runs on first boot
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scouter"]
      interval: 3s
      timeout: 2s
      retries: 10

volumes:
  pgdata:
```

Y hacé que la app espere una base *sana*, no solo arrancada:

```yaml
  scouter:
    # …existing config…
    environment:
      PORT: "8080"
      LOG_LEVEL: "${LOG_LEVEL:-info}"
      DATABASE_URL: "postgres://scouter:kamehameha@postgres:5432/scouter?sslmode=disable"
    depends_on:
      postgres:
        condition: service_healthy
```

> **La contraseña está en el archivo.** Eso está bien *solo* porque esta base
> existe en tu laptop y tiene datos falsos. En cualquier otro contexto el valor
> viene de Secret Manager o del almacén de secretos de tu plataforma, y el archivo
> de compose referencia `${POSTGRES_PASSWORD}` desde un `.env` ignorado. Decilo en
> voz alta para que el hábito quede.

### Paso 2 — el schema

**`deploy/sql/001_init.sql`**

```sql
-- Fighters: the entities we measure.
CREATE TABLE fighters (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    race        TEXT        NOT NULL DEFAULT 'unknown',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Readings: one power-level measurement. This is the table that grows.
CREATE TABLE readings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fighter_id  BIGINT      NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
    power       BIGINT      NOT NULL CHECK (power >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The access pattern is "latest readings for a fighter", so the index is
-- (fighter_id, recorded_at DESC). Column ORDER matters — Capsule 11.
CREATE INDEX idx_readings_fighter_time ON readings (fighter_id, recorded_at DESC);

-- Seed data so the service does something on first run.
INSERT INTO fighters (name, race) VALUES
    ('goku', 'saiyan'), ('vegeta', 'saiyan'), ('piccolo', 'namekian'),
    ('krillin', 'human'), ('frieza', 'frost demon'), ('gohan', 'half-saiyan');
```

### Paso 3 — el store de Postgres

```bash
go get github.com/jackc/pgx/v5/pgxpool
```

> **Mirá tu `go.mod` después de esto.** pgx requiere un Go reciente, así que
> `go get` puede subir la directiva `go` de tu módulo — y si queda por encima del
> tag `FROM golang:` de tu Dockerfile, el build sigue andando en local y falla
> solo en Docker. `head -3 go.mod`, y después emparejá el Dockerfile (Cápsula 02).

> **Por qué pgx y no `database/sql`:** pgx habla el protocolo binario de Postgres
> de forma nativa, que es más rápido y te da tipos reales de Postgres (arrays,
> JSONB, intervals) en vez de conversiones a string. `database/sql` es la interfaz
> genérica; pgx es la de Postgres. Para un servicio que solo usa Postgres, usá
> pgx.

**`internal/scouter/postgres.go`**

```go
package scouter

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

var _ Store = (*PostgresStore)(nil) // the interface from Capsule 06 pays off

func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	// Pool sizing is a capacity decision, not a default to accept.
	// total connections = replicas x MaxConns, and it must stay well under
	// the server's max_connections (100 by default).
	cfg.MaxConns = 10
	cfg.MinConns = 2                        // keep a few warm; connecting costs ms
	cfg.MaxConnLifetime = 30 * time.Minute  // rotate so failover isn't sticky
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// Fail fast at startup rather than on the first request.
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() { s.pool.Close() }

// Ping backs the readiness probe. Liveness must NOT call this (Capsule 01).
func (s *PostgresStore) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *PostgresStore) Record(r Reading) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Upsert the fighter, then insert the reading, atomically.
	// ON CONFLICT makes this idempotent — the same pattern Capsule 19 needs.
	const q = `
		WITH f AS (
			INSERT INTO fighters (name) VALUES ($1)
			ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
			RETURNING id
		)
		INSERT INTO readings (fighter_id, power, recorded_at)
		SELECT f.id, $2, $3 FROM f`

	if _, err := s.pool.Exec(ctx, q, r.Fighter, r.Power, r.RecordedAt); err != nil {
		// Store's signature has no error return (Capsule 01's shape).
		// Capsule 17 fixes that; for now, at least don't swallow it silently.
		fmt.Printf(`{"level":"ERROR","msg":"record failed","err":%q}`+"\n", err)
	}
}

func (s *PostgresStore) Latest(fighter string) (Reading, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	const q = `
		SELECT f.name, r.power, r.recorded_at
		FROM readings r
		JOIN fighters f ON f.id = r.fighter_id
		WHERE f.name = $1
		ORDER BY r.recorded_at DESC
		LIMIT 1`

	var out Reading
	err := s.pool.QueryRow(ctx, q, fighter).Scan(&out.Fighter, &out.Power, &out.RecordedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Reading{}, false
	}
	if err != nil {
		return Reading{}, false
	}
	return out, true
}

// Leaderboard: the latest reading per fighter, top n by power.
// DISTINCT ON is a Postgres-specific "first row per group" — it pairs with
// ORDER BY and is dramatically faster than a self-join or a window function
// when an index covers the ordering.
func (s *PostgresStore) Leaderboard(n int) []Reading {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	const q = `
		SELECT name, power, recorded_at FROM (
			SELECT DISTINCT ON (r.fighter_id)
			       f.name, r.power, r.recorded_at
			FROM readings r
			JOIN fighters f ON f.id = r.fighter_id
			ORDER BY r.fighter_id, r.recorded_at DESC
		) latest
		ORDER BY power DESC
		LIMIT $1`

	rows, err := s.pool.Query(ctx, q, n)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]Reading, 0, n)
	for rows.Next() {
		var r Reading
		if err := rows.Scan(&r.Fighter, &r.Power, &r.RecordedAt); err != nil {
			return out
		}
		out = append(out, r)
	}
	return out
}
```

### Paso 4 — cableálo

> **Una cosa para arreglar ya que estás.** Ahora `DATABASE_URL` es *obligatoria*,
> y el `deploy/docker-compose.scale.yml` de la Cápsula 06 no la setea. Agregala
> ahí también. Si no lo hacés, la próxima vez que vuelvas a correr el lab de
> escalado horizontal las réplicas se mueren al arrancar y nginx se cae con
> `host not found in upstream "scouter:8080"` — lo que te manda a debuggear nginx
> por un problema que no tiene nada que ver con nginx.

**`internal/scouter/config.go`** — agregá el campo y hacelo obligatorio:

```go
type Config struct {
	Port            string
	LogLevel        string
	DatabaseURL     string
	ShutdownTimeout time.Duration
	DrainDelay      time.Duration
}
```

```go
	c.DatabaseURL = os.Getenv("DATABASE_URL")
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
```

(Importá `errors`.) **Sin default** — adivinar una URL de base de datos es
exactamente la "respuesta equivocada silenciosa" de la Cápsula 01.

**`cmd/scouter/main.go`** — reemplazá `MemStore`:

```go
	store, err := scouter.NewPostgresStore(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Error("database unavailable at startup", "err", err)
		os.Exit(1)
	}
	defer store.Close()

	srv := scouter.NewServer(store, log)
```

**Gracias a la interfaz `Store` de la Cápsula 06, ningún handler cambió.** Ese es
el rédito, y vale la pena notarlo.

Hacé que readiness realmente chequee la base (`internal/scouter/server.go`):

```go
type Server struct {
	store Store
	log   *slog.Logger
	ready atomic.Bool
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	if !s.ready.Load() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "draining"})
		return
	}
	// Readiness checks dependencies. Liveness never does.
	if p, ok := s.store.(interface{ Ping(context.Context) error }); ok {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := p.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable,
				map[string]string{"status": "database unreachable"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
```

### Paso 5 — corrélo y probá que el bug de la Cápsula 06 se fue

```bash
cd deploy
docker compose up --build -d
docker compose ps            # postgres healthy, scouter running
```

```bash
curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}' | jq
curl -s localhost:8080/fighters/goku | jq
curl -s localhost:8080/leaderboard | jq
```

Ahora escalá — lo que se rompía en la Cápsula 06:

```bash
docker compose up -d --scale scouter=3
# (put the nginx lb from Capsule 07 in front, or just hit each container)
```

Todas las réplicas ven todas las escrituras. **El estado se fue del proceso.**

> ### ⏸ Punto natural para cortar
>
> Todo lo de arriba se sostiene solo — commiteálo y volvé después. Los pasos que
> siguen construyen sobre eso pero no dejan nada inestable si parás acá. Dos
> sesiones de 45 minutos le ganan a una de 90 que no terminás.

### Paso 6 — construí un N+1 y después matalo

Agregá un endpoint deliberadamente ingenuo a `postgres.go`:

```go
// LeaderboardNaive is the N+1 version. Do not ship this. It exists so you can
// see the difference in EXPLAIN and in the query count.
func (s *PostgresStore) LeaderboardNaive(n int) []Reading {
	ctx := context.Background()

	rows, _ := s.pool.Query(ctx, `SELECT id, name FROM fighters LIMIT $1`, n)
	type f struct {
		id   int64
		name string
	}
	var fs []f
	for rows.Next() {
		var x f
		_ = rows.Scan(&x.id, &x.name)
		fs = append(fs, x)
	}
	rows.Close()

	out := make([]Reading, 0, len(fs))
	for _, x := range fs { // <-- one query per fighter. This is the bug.
		var r Reading
		err := s.pool.QueryRow(ctx,
			`SELECT power, recorded_at FROM readings
			 WHERE fighter_id = $1 ORDER BY recorded_at DESC LIMIT 1`, x.id).
			Scan(&r.Power, &r.RecordedAt)
		if err == nil {
			r.Fighter = x.name
			out = append(out, r)
		}
	}
	return out
}
```

Cargá datos y compará:

```bash
# 20k readings across 500 fighters
docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
INSERT INTO fighters (name, race)
SELECT 'fighter_' || g, 'saiyan' FROM generate_series(1, 500) g
ON CONFLICT DO NOTHING;

INSERT INTO readings (fighter_id, power, recorded_at)
SELECT (random() * 499 + 1)::bigint,
       (random() * 1000000)::bigint,
       now() - (random() * interval '90 days')
FROM generate_series(1, 20000);

ANALYZE;
SQL
```

Prendé el logging de queries y contá:

```bash
docker compose exec -T postgres psql -U scouter -d scouter \
  -c "ALTER SYSTEM SET log_statement = 'all';" -c "SELECT pg_reload_conf();"

curl -s "localhost:8080/leaderboard?limit=50" >/dev/null
docker compose logs postgres --since 10s | grep -c "SELECT"   # ~1

# then wire /leaderboard-naive to LeaderboardNaive and hit it
docker compose logs postgres --since 10s | grep -c "SELECT"   # ~51
```

**51 round trips contra 1.** En tu laptop la diferencia son ~20 ms. Sobre una red
real a 2 ms por round trip son 100 ms de latencia pura, por request, a cambio de
nada.

Apagá el logging de nuevo — es *muy* caro:

```bash
docker compose exec -T postgres psql -U scouter -d scouter \
  -c "ALTER SYSTEM SET log_statement = 'none';" -c "SELECT pg_reload_conf();"
```

### Paso 7 — agotá el pool de conexiones a propósito

```bash
# 10 max connections in the pool; fire far more concurrent slow requests
k6 run --vus 100 --duration 30s scripts/load/stress.js
```

Mirá qué pasa:

```bash
docker compose exec -T postgres psql -U scouter -d scouter \
  -c "SELECT count(*), state FROM pg_stat_activity WHERE datname='scouter' GROUP BY state;"
```

Vas a ver las conexiones clavadas en tu `MaxConns` y los requests encolando
*adentro de la app* esperando una. La latencia sube mientras Postgres se ve
aburrido.

**Esa es la firma del agotamiento del pool**: latencia alta en la app, CPU baja en
la base de datos. Reconocela y te ahorraste una tarde. La solución nunca es
"agrandá el pool" — es queries más rápidas, un pooler, o menos réplicas.

```bash
docker compose down
```

---

## En GCP

> **Solo concepto.** Cloud SQL **no tiene free tier**; la instancia más chica
> cuesta unos **USD 8–10/mes facturados mientras exista**, la uses o no. Todo lo
> de arriba corre en Docker exactamente por eso.

**Cloud SQL para PostgreSQL** — Postgres gestionado. Lo que te da:

- Backups automáticos + recuperación a un punto en el tiempo (testeá tus
  restauraciones, no tus backups)
- **Alta disponibilidad**: un standby sincrónico en otra zona, failover
  automático en ~60 s. Más o menos duplica el costo. No negociable para
  producción.
- Read replicas (Cápsula 13)
- Ventanas de mantenimiento — el parcheo *va* a reiniciar tu instancia; elegí la
  ventana
- Autenticación de base de datos por IAM, así no hay contraseñas

**Para conectarte**, en orden de preferencia:

1. **Cloud SQL Auth Proxy** / la librería de conectores — maneja TLS, auth por IAM
   y rotación. Este es el default.
2. **IP privada con un VPC connector** desde Cloud Run — sin exposición pública.
3. **IP pública con redes autorizadas** — evitalo.

**`max_connections`** en los tiers más chicos es bajo (un `db-f1-micro` permite
~25). Hacé la cuenta del Paso 7 antes de deployar, o agregá PgBouncer.

**Cuándo ir más allá de Cloud SQL:**

- **AlloyDB** — compatible con Postgres, mucho más rápido en analítica, pooling
  incorporado. Más caro.
- **Spanner** — solo cuando genuinamente necesitás escalado horizontal de
  escrituras con consistencia fuerte y podés pagarlo (Cápsula 13).
- **Firestore** — modelo completamente distinto; bueno para documentos por usuario
  y sync en tiempo real, malo para cualquier cosa que necesite joins o queries
  agregadas.

---

## Llevátelo al trabajo

- **Pools chicos.** `réplicas × tamaño_pool < max_connections`, con margen. Escribí
  la cuenta en la descripción del PR.
- **Siempre `context.WithTimeout` en las queries.** Una query sin límite se queda
  con una conexión para siempre y se lleva puesto el pool.
- **`TIMESTAMPTZ`, `NUMERIC` para plata, `NOT NULL` por defecto.**
- **Contá queries por request en code review.** N+1 es invisible en local y brutal
  en producción.
- **Readiness pinguea la base; liveness nunca.**
- **Fallá el arranque si falta `DATABASE_URL`.** Ruidoso le gana a callado.
- **La base de datos es la última línea de defensa.** Poné restricciones reales en
  el schema — la validación de aplicación tiene bugs, y existen otros escritores.

---

## Battle drill

<details>
<summary><b>1.</b> La latencia de la app es 3 s. La CPU de la base está al 8%. ¿Qué está pasando?</summary>

Casi seguro **agotamiento del pool de conexiones**. Los requests están encolando
adentro de tu app esperando una conexión; la base está ociosa porque no está
recibiendo el trabajo.

Confirmalo con métricas del pool (pgx expone `pool.Stat()`: `AcquireCount`,
`AcquireDuration`, `EmptyAcquireCount`) y con `pg_stat_activity` en el servidor.

Causas, en orden: una query lenta que retiene conexiones; un timeout faltante así
que las conexiones nunca se devuelven; una conexión filtrada (rows no cerrados);
demasiadas réplicas para el presupuesto del pool; o un pool genuinamente muy chico.

Soluciones: encontrá primero la query lenta (Cápsula 11), agregá timeouts, después
considerá un pooler. Subir `MaxConns` es la *última* opción y a menudo lo empeora.
</details>

<details>
<summary><b>2.</b> Dos requests leen un saldo de 100 y cada uno resta 30. ¿Qué queda guardado, y cómo lo arreglás?</summary>

Bajo Read Committed los dos leen 100, los dos computan 70, los dos escriben 70.
**Perdiste una actualización** — el saldo debería ser 40.

Tres soluciones correctas:

1. **Sentencia atómica única**: `UPDATE accounts SET balance = balance - 30
   WHERE id = $1 AND balance >= 30`. La más simple y normalmente la correcta.
2. **Lock pesimista**: `SELECT … FOR UPDATE` adentro de una transacción; el
   segundo lector se bloquea hasta que el primero commitea.
3. **Optimista**: una columna `version`, `UPDATE … WHERE version = $old`; si
   afecta cero filas, reintentá.

El aislamiento Serializable también lo previene, pero aborta transacciones bajo
contención así que igual necesitás un loop de reintentos. Fijate que "usá una
transacción" *no* está en la lista — una transacción sola en Read Committed no
frena esto.
</details>

<details>
<summary><b>3.</b> ¿Por qué un pool de conexiones más grande suele ser más lento?</summary>

Cada conexión de Postgres es un proceso backend con su propia memoria. Pasadas más
o menos `2 × cores`, agregar conexiones agrega context switching, contención de
locks y presión de cache sin agregar paralelismo — el throughput total *baja*
mientras la latencia por query sube.

La cola tiene que existir en algún lado. Es mejor encolar en tu aplicación, donde
la podés ver, acotar, timeoutear y descartar, que adentro de la base de datos,
donde degrada todo para todos.

Por eso PgBouncer en modo transacción es tan efectivo: miles de conexiones de
cliente, unas pocas decenas del servidor, y la base corre en su punto eficiente.
</details>

<details>
<summary><b>4.</b> ¿Cuándo es genuinamente correcto agarrar una base no relacional?</summary>

Disparadores concretos, no vibras:

- **Bigtable/Cassandra** — > 10 TB, patrones de acceso por clave única, sin
  necesidad de joins, y throughput de escritura más allá de un primario. Series
  temporales e IoT son los casos clásicos.
- **Firestore/DynamoDB** — acceso a documentos por usuario, sync en tiempo real,
  clientes offline, y patrones de acceso que conocés completamente de antemano.
- **Elasticsearch** — ranking de relevancia de texto completo. (El full-text de
  Postgres es genuinamente suficiente hasta escalas sorprendentemente grandes.)
- **Redis** — caching y estado efímero, no verdad durable (Cápsula 14).
- **BigQuery** — analítica sobre miles de millones de filas, al lado del almacén
  transaccional y no en su lugar.

Lo que resignás son joins, queries ad-hoc, transacciones multi-fila y cuarenta años
de herramientas. Ese es un costo real, así que el disparador debería ser una
medición.
</details>

<details>
<summary><b>5.</b> Tu ORM genera 200 queries para una página. Recorré cómo lo arreglás.</summary>

**Medí**: prendé el logging de queries o usá un APM para tener el conteo exacto y
las sentencias. Nunca adivines.

**Categorizá**: el patrón es casi siempre una query padre más N hijos cargados
perezosamente, a veces anidados (N×M).

**Arreglá en orden**:
1. Cargá la asociación de forma ansiosa (`JOIN` / `preload` / `includes`).
2. Agrupá los ids: un `WHERE id = ANY($1)` en vez de N queries.
3. Para "top N por grupo", usá `DISTINCT ON` o una window function.
4. Si sigue caliente, desnormalizá un contador o cacheá el resultado (Cápsula 14).

**Prevení**: afirmá un presupuesto de cantidad de queries en un test de
integración. Eso convierte "alguien lo va a notar en producción" en "el build
falla". Es uno de los tests de mayor valor que podés escribir.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `connection refused` al arrancar | Postgres todavía no está sano. Usá `depends_on: condition: service_healthy`. |
| `password authentication failed` | Las credenciales de `DATABASE_URL` no coinciden con el entorno de compose. |
| El schema no se aplicó | `docker-entrypoint-initdb.d` solo corre con un volumen **vacío**. `docker compose down -v` y después up. |
| Errores de `sslmode` | Postgres local no tiene TLS: `?sslmode=disable`. Nunca hagas esto contra una base real. |
| `too many clients already` | `réplicas × MaxConns > max_connections`. Hacé la cuenta. |
| `context deadline exceeded` | La query es más lenta que tu timeout — ese es el timeout haciendo su trabajo. Encontrá la query lenta (Cápsula 11). |
| Los datos desaparecieron al reiniciar | Sin volumen nombrado, o corriste `down -v`. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(store): postgres-backed store replaces in-memory map

Capsule 10. Schema with constraints and a (fighter_id, recorded_at DESC)
index. pgx pool sized deliberately (10 conns/replica). Readiness now pings
the DB; liveness still does not. Reproduced N+1 (51 queries vs 1) and pool
exhaustion (high app latency, idle database)."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 10
```

**Siguiente:** [Cápsula 11 · El Radar del Dragón — Índices y planes de query](../11-dragon-radar-indexes/README.md)
