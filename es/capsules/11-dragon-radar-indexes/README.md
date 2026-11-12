# Cápsula 11 · El Radar del Dragón — Índices y planes de query

> *Antes de que Bulma construyera el radar, encontrar una Esfera del Dragón
> significaba buscar en un planeta entero. Después, apuntás a una pantalla y volás
> derecho. Las esferas no se movieron. La búsqueda sí.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 7 | 70 min | Cápsula 10 | Local |

---

## Por qué existe esta cápsula

Un índice es la herramienta de mayor apalancamiento que tenés. Una query que tarda
4 segundos y una que tarda 3 milisegundos son frecuentemente *la misma query*
contra *los mismos datos* — la diferencia es una línea de DDL.

Más importante: acá es donde aprendés a dejar de adivinar. `EXPLAIN ANALYZE` te
dice exactamente qué hizo la base de datos y por qué. La gente que lee planes de
query arregla problemas de performance en minutos; la que no, agrega caches y
reza.

---

## El concepto

### Qué es realmente un índice B-tree

Un árbol balanceado y ordenado de clave → puntero a la ubicación de la fila.

```
  No index:          Seq Scan — read all 10,000,000 rows, discard 9,999,999
  B-tree index:      3-4 page reads to find the row. O(log n).

  10M rows: seq scan ≈ 10,000,000 reads
            index    ≈ 4 reads
```

Consecuencias que se siguen directamente de "está ordenado":

- **Igualdad y rangos funcionan los dos** (`=`, `<`, `>`, `BETWEEN`) — el árbol
  está ordenado.
- **`ORDER BY` puede ser gratis** si coincide con el orden del índice. Las filas
  salen ya ordenadas; no hay paso de sort en absoluto.
- **El matcheo por prefijo funciona** (`LIKE 'goku%'`), el de sufijo no
  (`LIKE '%goku'`) — ordenar por el principio de un string no te dice nada sobre
  su final.
- **Las escrituras se ponen más lentas.** Cada `INSERT`/`UPDATE`/`DELETE` tiene
  que mantener cada índice de la tabla. Los índices no son gratis; son un
  intercambio lectura/escritura.

### El orden de columnas en un índice compuesto lo es todo

Para `INDEX (a, b, c)`, pensalo como ordenado por `a`, después por `b` dentro de
`a` iguales, después por `c`. El índice puede servir una query solo vía un
**prefijo izquierdo**:

| Query | ¿Usa el índice? |
|---|---|
| `WHERE a = 1` | ✅ |
| `WHERE a = 1 AND b = 2` | ✅ |
| `WHERE a = 1 AND b = 2 AND c = 3` | ✅ completo |
| `WHERE b = 2` | ❌ — saltea la columna líder |
| `WHERE a = 1 AND c = 3` | ⚠️ usa solo `a`, filtra `c` |
| `WHERE a > 1 AND b = 2` | ⚠️ el rango en `a` hace inútil a `b` |

**La regla que acierta casi siempre:**

> **Las columnas de igualdad primero, la columna de rango/orden última.**

`WHERE fighter_id = ? ORDER BY recorded_at DESC` quiere
`(fighter_id, recorded_at DESC)` — igualdad en `fighter_id`, orden en
`recorded_at`. Invertilas y la base tiene que ordenar.

### La selectividad decide si el índice se usa siquiera

Un índice sobre una columna con dos valores distintos (`is_active`) en un millón
de filas es casi inútil — matchear 500.000 filas vía un índice significa 500.000
lecturas aleatorias de página, que es *más lento* que leer la tabla
secuencialmente. El planificador lo sabe y va a ignorar tu índice, correctamente.

**Regla aproximada:** si una query devuelve más del ~5–10% de una tabla, un scan
secuencial suele ser el plan correcto. **Un "seq scan" en un plan no es
automáticamente un bug.**

Las columnas de baja cardinalidad se vuelven útiles como parte *final* de un
índice compuesto, o vía un **índice parcial**:

```sql
CREATE INDEX idx_active_fighters ON fighters (name) WHERE is_active;
```

Más chico, más barato de mantener, y solo se usa donde ayuda.

### Covering indexes y index-only scans

Si un índice contiene todas las columnas que la query necesita, Postgres nunca
toca la tabla — un **index-only scan**.

```sql
CREATE INDEX idx_readings_cover ON readings (fighter_id, recorded_at DESC) INCLUDE (power);
```

`INCLUDE` agrega `power` a las páginas hoja sin hacerlo parte de la clave de
orden. La query lee solo el índice. Esto puede ser una ganancia de 5–10× en un
camino caliente.

(Salvedad: Postgres necesita el visibility map actualizado para los index-only
scans, así que una tabla sin vacuum reciente puede visitar el heap igual.)

### Paginación: OFFSET es una trampa

```sql
SELECT * FROM readings ORDER BY id LIMIT 20 OFFSET 100000;
```

Para saltear 100.000 filas la base tiene que **producirlas y descartarlas**. La
página 1 es instantánea; la página 5.000 tarda segundos. Peor: si se insertan filas
mientras alguien pagina, ve duplicados y saltos.

La **paginación por keyset (cursor)** arregla las dos cosas:

```sql
SELECT * FROM readings
WHERE (recorded_at, id) < ($1, $2)     -- the last row of the previous page
ORDER BY recorded_at DESC, id DESC
LIMIT 20;
```

Tiempo constante a cualquier profundidad, y estable ante escrituras concurrentes.
El trade-off es que no podés saltar a "página 500" — lo cual está bien, porque
nadie lo hace.

> Fijate en la comparación de tuplas `(recorded_at, id) < ($1, $2)`. Incluir un
> desempate único es lo que la hace correcta cuando los timestamps colisionan.

### Leer `EXPLAIN ANALYZE`

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

- **`EXPLAIN`** = la estimación del planificador. **`EXPLAIN ANALYZE`** = lo
  ejecuta de verdad y reporta la realidad. Usá siempre ANALYZE (ojo: realmente
  ejecuta escrituras, así que envolvelas en una transacción que revertís).
- **`BUFFERS`** muestra cuántas páginas vinieron del cache y cuántas del disco —
  a menudo la historia real.

Tipos de nodo, de peor a mejor para una búsqueda de una sola fila:

| Nodo | Significa |
|---|---|
| `Seq Scan` | leyendo la tabla entera. Está bien para tablas chicas o resultados grandes |
| `Bitmap Heap Scan` | el índice encontró muchas filas; las trae en orden de página |
| `Index Scan` | recorriendo el índice, trayendo filas |
| `Index Only Scan` | nunca tocó la tabla. El mejor |

Joins:

| Nodo | Bueno cuando |
|---|---|
| `Nested Loop` | un lado es minúsculo; el otro tiene índice en la clave de join |
| `Hash Join` | los dos lados son grandes; arma un hash del más chico |
| `Merge Join` | las dos entradas ya están ordenadas por la clave de join |

**Lo más importante para chequear:** `rows=X` (estimado) contra
`actual rows=Y`. Si el planificador cree 10 y la realidad son 100.000, eligió un
plan malo *basado en estadísticas malas* — y la solución es `ANALYZE`, no un
índice nuevo.

---

## Lab

Levantá el stack y cargá suficientes datos como para que la diferencia se vea.

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d
```

### Paso 1 — una tabla lo bastante grande como para ser honesta

```bash
docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
-- 2000 fighters
INSERT INTO fighters (name, race)
SELECT 'f_' || g, (ARRAY['saiyan','human','namekian','android'])[1 + g % 4]
FROM generate_series(1, 2000) g
ON CONFLICT DO NOTHING;

-- 2 million readings
INSERT INTO readings (fighter_id, power, recorded_at)
SELECT (random() * 1999 + 1)::bigint,
       (random() * 10000000)::bigint,
       now() - (random() * interval '365 days')
FROM generate_series(1, 2000000);

ANALYZE;
SELECT count(*) FROM readings;
SQL
```

Abrí una sesión de psql y dejala abierta:

```bash
docker compose exec postgres psql -U scouter -d scouter
```

```sql
\timing on
```

### Paso 2 — la vida sin índice

```sql
DROP INDEX IF EXISTS idx_readings_fighter_time;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM readings WHERE fighter_id = 42 ORDER BY recorded_at DESC LIMIT 10;
```

Buscá:
- `Parallel Seq Scan on readings` debajo de un `Gather Merge` — Postgres reparte
  el scan entre procesos worker, y entre todos leen los 2 millones de filas
  (`Rows Removed by Filter` es por worker, así que muestra más o menos un tercio)
- un nodo `Sort` con costo real
- `Buffers: shared hit=…` — unas 14.700 páginas, la tabla entera (`hit` quiere
  decir que ya estaban en memoria; justo después de un reinicio vas a ver `read=`)
- `Execution Time:` — decenas de milisegundos; unos 30 ms en una laptop reciente

Anotalo.

### Paso 3 — el índice, y el orden correcto de columnas

```sql
CREATE INDEX idx_readings_fighter_time ON readings (fighter_id, recorded_at DESC);
ANALYZE readings;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM readings WHERE fighter_id = 42 ORDER BY recorded_at DESC LIMIT 10;
```

Ahora deberías ver `Index Scan using idx_readings_fighter_time`, **ningún nodo
Sort**, un puñado de buffers, y ejecución por debajo del milisegundo.

La brecha se agranda a medida que crece la tabla — un sequential scan es O(n)
y el lookup por índice no, así que en una tabla chica capaz que son 10×, y acá
es muchísimo más. Medido sobre estos 2 millones de filas: 29 ms → 0,040 ms, unas
**700×**. Con una línea de DDL.

**Ahora probá que el orden de columnas importa.** Creá el índice invertido y forzá
su uso:

```sql
CREATE INDEX idx_wrong_order ON readings (recorded_at DESC, fighter_id);

-- ask the planner to compare, by disabling the good one temporarily
BEGIN;
DROP INDEX idx_readings_fighter_time;
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM readings WHERE fighter_id = 42 ORDER BY recorded_at DESC LIMIT 10;
ROLLBACK;
```

Con `(recorded_at, fighter_id)` la base recorre el índice en orden *temporal* y
chequea `fighter_id = 42` en cada entrada, tocando muchísimo más índice del que
devuelve.

**Leé la línea `Buffers`, no los conteos de filas.** En Postgres 16 los dos
planes dicen `Index Scan` y los dos dicen `Index Cond: (fighter_id = 42)` — no
hay ningún `Rows Removed by Filter` que señalar, porque el chequeo pasa adentro
del índice y no contra el heap. El trabajo igual se hizo; simplemente no se
reporta como un filtro. Medido sobre 2 millones de filas (segunda corrida de
cada uno, así todo es cache hit):

| Índice | Costo estimado | Buffers | Tiempo |
|---|---|---|---|
| `(fighter_id, recorded_at DESC)` — correcto | 39 | **13** | 0.040 ms |
| `(recorded_at DESC, fighter_id)` — equivocado | 499 | **83** | 0.148 ms |
| sin índice usable | 26132 | **14,780** | 29 ms |

Más de 6× los buffers para las mismas diez filas. Tus números exactos van a ser
otros — los datos son aleatorios — pero la forma no. Esta es la lección general:
cuando dos planes se ven estructuralmente idénticos, `BUFFERS` es lo que los
distingue — por eso `EXPLAIN (ANALYZE, BUFFERS)` debería ser tu default, no
`EXPLAIN ANALYZE`.

```sql
DROP INDEX idx_wrong_order;
```

### Paso 4 — cuándo el planificador ignora tu índice correctamente

```sql
CREATE INDEX idx_readings_power ON readings (power);
ANALYZE readings;

-- highly selective: uses the index
EXPLAIN ANALYZE SELECT count(*) FROM readings WHERE power > 9999000;

-- not selective: ignores it, and is right to
EXPLAIN ANALYZE SELECT count(*) FROM readings WHERE power > 1000;
```

La segunda matchea el **99,99%** de la tabla: `power` está repartido parejo
entre 0 y 10.000.000, así que apenas una fila de cada 10.000 vale 1000 o menos.
Leer la tabla entera de punta a punta es más barato que recorrer 2 millones de
entradas del índice y después volver a la tabla por cada una. **El planificador
no es tonto — estás viendo la selectividad en acción.**

Probátelo a vos mismo:

```sql
SET enable_seqscan = off;     -- session only, a diagnostic tool, never production
EXPLAIN ANALYZE SELECT count(*) FROM readings WHERE power > 1000;
SET enable_seqscan = on;
```

Forzar el índice lo hace *más lento*. Anotá los dos números. Qué plan te toca
depende de si autovacuum ya pasó por la tabla después de la carga masiva. Si
pasó, Postgres puede responder el `count(*)` solo con el índice (`Index Only
Scan`, `Heap Fetches: 0`) y la pérdida es chica — 76 ms contra 68 ms del seq
scan, medido. Si no pasó, te toca un `Bitmap Heap Scan` que igual visita la
tabla — 180 ms contra 72 ms. En cualquier caso, no es más rápido.

```sql
DROP INDEX idx_readings_power;
```

### Paso 5 — un index-only scan

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT recorded_at, power FROM readings WHERE fighter_id = 42
ORDER BY recorded_at DESC LIMIT 10;
-- Index Scan + heap fetches

CREATE INDEX idx_readings_cover ON readings (fighter_id, recorded_at DESC) INCLUDE (power);
ANALYZE readings;

EXPLAIN (ANALYZE, BUFFERS)
SELECT recorded_at, power FROM readings WHERE fighter_id = 42
ORDER BY recorded_at DESC LIMIT 10;
-- Index Only Scan, Heap Fetches: 0
```

Compará las líneas de `Buffers:`. El covering index eliminó el acceso a la tabla
por completo.

### Paso 6 — OFFSET vs keyset, en profundidad

```sql
\timing on

-- page 1: fast
SELECT id, recorded_at FROM readings ORDER BY recorded_at DESC, id DESC LIMIT 20 OFFSET 0;

-- page 25,000: painful
SELECT id, recorded_at FROM readings ORDER BY recorded_at DESC, id DESC LIMIT 20 OFFSET 500000;
```

Ahora la versión con keyset. Tomá la última fila de una página y usala como
cursor:

```sql
CREATE INDEX idx_readings_keyset ON readings (recorded_at DESC, id DESC);
ANALYZE readings;

SELECT id, recorded_at FROM readings
WHERE (recorded_at, id) < ('2026-01-15 00:00:00+00', 999999999)
ORDER BY recorded_at DESC, id DESC
LIMIT 20;
```

**Tiempo constante a cualquier profundidad.** Corrélo con un cursor de la "página
1" y de la "página 25.000" — los tiempos son idénticos. Ese es el punto entero.

### Paso 7 — encontrá las queries lentas automáticamente

```bash
docker compose exec -T postgres psql -U scouter -d scouter <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
```

(El setup completo necesita `shared_preload_libraries`, así que puede no activarse
en este container — el punto es conocer la herramienta.)

La query que sí vas a usar en producción:

```sql
SELECT
    round(total_exec_time::numeric, 1) AS total_ms,
    calls,
    round(mean_exec_time::numeric, 2)  AS mean_ms,
    left(query, 90)                    AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

**Ordená por `total_exec_time`, no por `mean_exec_time`.** Una query de 5 ms
llamada 500.000 veces cuesta mucho más que una de 2 segundos llamada dos veces — y
es la que vale la pena arreglar.

Aprendé también la query de "índices sin usar", porque los índices sin usar
cuestan escrituras para siempre:

```sql
SELECT schemaname, relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan < 50
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Paso 8 — medí el costo de escritura

```sql
DROP INDEX IF EXISTS idx_readings_cover;
DROP INDEX IF EXISTS idx_readings_keyset;

\timing on
INSERT INTO readings (fighter_id, power, recorded_at)
SELECT (random()*1999+1)::bigint, (random()*1000000)::bigint, now()
FROM generate_series(1, 100000);
-- note the time

CREATE INDEX idx_readings_cover  ON readings (fighter_id, recorded_at DESC) INCLUDE (power);
CREATE INDEX idx_readings_keyset ON readings (recorded_at DESC, id DESC);
CREATE INDEX idx_readings_power  ON readings (power);

INSERT INTO readings (fighter_id, power, recorded_at)
SELECT (random()*1999+1)::bigint, (random()*1000000)::bigint, now()
FROM generate_series(1, 100000);
-- note the time again
```

Se nota más lento, y es medible. **Ese es el intercambio lectura/escritura, en tus propios
números.** Cada índice que agregás le cobra impuesto a cada escritura para
siempre.

```sql
\q
```

```bash
docker compose down
```

---

## En GCP

- **Query Insights de Cloud SQL** es `pg_stat_statements` con interfaz, más planes
  por query y un desglose de carga por query. Gratis, prendido por defecto, y el
  primer lugar donde mirar cuando Postgres está lento.
- **`CREATE INDEX CONCURRENTLY`** — en producción, siempre. Un `CREATE INDEX`
  común toma un lock adyacente a `ACCESS EXCLUSIVE` que bloquea escrituras
  mientras dura; en una tabla grande eso es una caída. `CONCURRENTLY` es más lento
  y no puede correr dentro de una transacción, y puede dejar un índice `INVALID`
  si falla (borralo y reintentá) — aceptá todo eso.
- **El autovacuum mantiene frescas las estadísticas.** Si los planes se ponen
  malos después de una carga masiva, corré `ANALYZE` a mano; el planificador es
  tan bueno como sus estadísticas.
- **Bigtable / Firestore no tienen planificador de queries.** Diseñás la clave y
  el patrón de acceso *es* el schema. Ese es el tema de la Cápsula 12, y es por
  qué la gente subestima cuánto hace por vos un planificador relacional.

---

## Llevátelo al trabajo

- **`EXPLAIN ANALYZE` antes de agregar un índice.** Y de nuevo después. Números,
  no esperanza.
- **Columnas de igualdad primero, columna de rango/orden última.**
- **Chequeá filas estimadas vs reales.** Un hueco grande significa estadísticas
  viejas, y ningún índice arregla eso.
- **Paginación por keyset para cualquier cosa profunda o con scroll infinito.**
- **Ordená `pg_stat_statements` por tiempo total**, no por media.
- **Auditá los índices sin usar trimestralmente.** Cuestan cada escritura y no
  compran nada.
- **`CREATE INDEX CONCURRENTLY` en producción. Siempre.**
- **Un Seq Scan no es automáticamente un bug.** En una tabla chica o una query
  amplia es el plan correcto.

---

## Battle drill

<details>
<summary><b>1.</b> Tenés <code>INDEX (tenant_id, created_at)</code>. ¿Cuáles de estas lo usan, y cómo?</summary>

```sql
a) WHERE tenant_id = 5
b) WHERE tenant_id = 5 AND created_at > now() - interval '1 day'
c) WHERE created_at > now() - interval '1 day'
d) WHERE tenant_id = 5 ORDER BY created_at DESC
```

- **(a)** Sí — columna líder, index scan.
- **(b)** Sí, completo — igualdad y después rango es la forma ideal.
- **(c)** No. Saltea la columna líder, así que el prefijo izquierdo es
  inutilizable. Seq scan (o un bitmap scan mucho más caro sobre otro índice).
- **(d)** Sí, y este es el mejor caso: el índice provee el filtro *y* el orden, así
  que **no aparece ningún nodo Sort**.

Para (c) necesitarías un índice separado sobre `(created_at)`, y deberías
preguntarte si esa query debería existir — un scan entre tenants suele ser un olor
de diseño.
</details>

<details>
<summary><b>2.</b> Una query se puso lenta de un día para el otro. No cambió el código ni el volumen de datos. ¿Qué pasó?</summary>

Lo más probable: **estadísticas viejas** causando un cambio de plan. Una carga
masiva o un borrado grande cambió la distribución de los datos; las estimaciones
del planificador ya no coinciden con la realidad, así que pasó de un nested loop a
un hash join (o al revés) y eligió mal.

Diagnóstico: `EXPLAIN ANALYZE` y comparar `rows=` con `actual rows=`. Una
discrepancia de 100× es la firma.

Solución: `ANALYZE tabla`. Si se repite, subí `default_statistics_target` para la
columna sesgada, o agregá estadísticas extendidas (`CREATE STATISTICS`) para
columnas correlacionadas.

Otros candidatos: un índice se infló o lo borraron; el autovacuum se quedó atrás;
un problema de parameter sniffing con una prepared statement; o alguien cambió
`work_mem` y ahora un sort va a disco.
</details>

<details>
<summary><b>3.</b> ¿Cuándo NO agregarías un índice que aceleraría una query?</summary>

- **La tabla es intensiva en escrituras** y la query es rara. Le cobrarías
  impuesto a millones de escrituras para acelerar un reporte que alguien corre dos
  veces por semana.
- **Baja selectividad** — el planificador lo ignoraría igual.
- **Un prefijo de un índice compuesto existente ya lo cubre.** `(a, b)` ya sirve
  `WHERE a = ?`; un índice separado sobre `(a)` es puro costo.
- **Tamaño del índice contra RAM disponible.** Un índice que no entra en memoria
  puede ser más lento que un scan secuencial de una tabla que sí entra.
- **La query debería arreglarse en su lugar** — un N+1, un `LIMIT` faltante, o un
  `SELECT *` trayendo una columna JSONB de 2 MB que nunca usa.
</details>

<details>
<summary><b>4.</b> Explicale a un product manager por qué se sacó "ir a la página 500".</summary>

`OFFSET 10000` hace que la base genere y descarte 10.000 filas antes de devolver
20. Las páginas profundas se vuelven linealmente más lentas, así que la página 500
puede tardar 4 segundos mientras la 1 tarda 4 milisegundos — y esas queries lentas
retienen conexiones que todos los demás están esperando.

También hay un problema de corrección: con filas insertándose mientras alguien
pagina, los offsets se corren, así que los usuarios ven duplicados y se pierden
elementos.

El reemplazo — "cargar más" / scroll infinito con un cursor — es tiempo constante a
cualquier profundidad y estable ante escrituras. Y los datos lo respaldan: casi
nadie pasa de la página 3; los que lo hacen normalmente buscan algo específico y se
sirven mejor con búsqueda o un filtro.
</details>

<details>
<summary><b>5.</b> <code>EXPLAIN</code> dice 12 ms pero producción dice 800 ms. ¿Dónde está la diferencia?</summary>

- **Cache frío.** `EXPLAIN ANALYZE` sobre un buffer pool caliente lee de RAM;
  producción puede leer de disco. `BUFFERS` muestra `shared hit` vs `shared read`
  — esa es la pista.
- **Round trips de red.** 12 ms de tiempo de base más 50 round trips de latencia
  de cliente (el N+1 de la Cápsula 10).
- **Concurrencia.** Bajo carga hay contención de locks, encolamiento de CPU y la
  rodilla de latencia (Cápsula 09) — nada de eso aparece en un solo EXPLAIN
  tranquilo.
- **Parámetros distintos.** Explicaste `tenant_id = 5` (100 filas); producción
  corre `tenant_id = 1` (5 millones de filas).
- **Tiempo de espera del pool de conexiones**, que está en el request pero no en
  la query.
- **Tamaño del resultado.** 12 ms para computar, 800 ms para serializar y
  transferir 40 MB.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| Índice creado pero sin usar | Chequeá selectividad, orden de columnas, y si una función o cast sobre la columna lo deshabilita (`WHERE lower(name) = …` necesita un índice sobre `lower(name)`). |
| `EXPLAIN ANALYZE` sobre un INSERT modificó datos | Realmente ejecuta. Envolvelo en `BEGIN; … ROLLBACK;`. |
| Los tiempos varían mucho entre corridas | Buffer cache. Corré cada query dos veces y usá la segunda, o leé `BUFFERS`. |
| `CREATE INDEX` se cuelga | Está esperando un lock. `SELECT * FROM pg_locks` — y usá `CONCURRENTLY`. |
| El plan ignora un índice obviamente bueno | Corré `ANALYZE`. Después chequeá filas estimadas vs reales. |
| `pg_stat_statements` está vacío | Necesita `shared_preload_libraries = 'pg_stat_statements'` y un reinicio. Cloud SQL lo habilita con un flag. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(db): composite and covering indexes, keyset pagination

Capsule 11. (fighter_id, recorded_at DESC) took the hot lookup from ~30ms
seq scan to sub-ms index scan with no sort. Measured the reversed column
order and the write cost of extra indexes. Replaced OFFSET with keyset."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 11
```

**Siguiente:** [Cápsula 12 · Las Siete Esferas — Sharding y particionado](../12-seven-dragon-balls-sharding/README.md)
