# Cápsula B4 · Namekiano Antiguo — SQL esencial

> *Las Esferas del Dragón solo funcionan si alguien puede leer namekiano antiguo.
> Dende puede, Bulma no, y ninguna cantidad de brillantez en ingeniería sustituye a
> poder leer el idioma en el que está escrita la verdad.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 70 min | ninguno | Cápsula 10 |

---

## Por qué existe esta cápsula

Un ORM te lleva hasta `SELECT * FROM users WHERE id = ?`. Más allá de eso, quienes
pueden bajar a SQL resuelven en una query problemas que otros resuelven con tres round
trips y un loop en código de aplicación.

Este es el SQL que aparece de verdad: joins bien hechos, agregación, window functions,
upserts, y el puñado de cosas que calladamente producen respuestas incorrectas.

---

## Setup

```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose up -d postgres
docker compose exec postgres psql -U scouter -d scouter
```

```sql
\timing on
\pset null '(null)'
```

Algunos datos para trabajar:

```sql
CREATE TABLE IF NOT EXISTS fighters (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    race    TEXT NOT NULL,
    home    TEXT
);

CREATE TABLE IF NOT EXISTS readings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fighter_id  BIGINT NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
    power       BIGINT NOT NULL CHECK (power >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fighters (name, race, home) VALUES
  ('goku','saiyan','earth'), ('vegeta','saiyan','earth'),
  ('piccolo','namekian','earth'), ('krillin','human','earth'),
  ('frieza','frost demon',NULL), ('cell','android',NULL),
  ('yamcha','human','earth')
ON CONFLICT DO NOTHING;

INSERT INTO readings (fighter_id, power, recorded_at)
SELECT f.id,
       (random() * 1000000)::bigint,
       now() - (random() * interval '60 days')
FROM fighters f, generate_series(1, 40)
WHERE f.name <> 'yamcha';    -- yamcha has no readings. That matters below.
```

---

## Joins — y el que agarra a todo el mundo

```sql
-- INNER: only rows with a match on BOTH sides
SELECT f.name, r.power
FROM fighters f
JOIN readings r ON r.fighter_id = f.id;
-- yamcha is ABSENT

-- LEFT: every row from the left, NULLs where there is no match
SELECT f.name, r.power
FROM fighters f
LEFT JOIN readings r ON r.fighter_id = f.id;
-- yamcha appears once, with power = (null)
```

**La trampa que produce respuestas incorrectas en silencio:**

```sql
-- ❌ This is secretly an INNER JOIN
SELECT f.name, count(r.id)
FROM fighters f
LEFT JOIN readings r ON r.fighter_id = f.id
WHERE r.power > 500000          -- <-- filters out yamcha's NULL row
GROUP BY f.name;

-- ✅ Put the condition in the JOIN, not the WHERE
SELECT f.name, count(r.id)
FROM fighters f
LEFT JOIN readings r ON r.fighter_id = f.id AND r.power > 500000
GROUP BY f.name;
-- yamcha now appears with count 0
```

> **`WHERE` sobre una tabla del lado derecho de un LEFT JOIN lo convierte en un INNER
> JOIN**, porque `NULL > 500000` no es verdadero. Las condiciones sobre la tabla
> *derecha* van en `ON`; las condiciones sobre la *izquierda* van en `WHERE`. Este es
> el bug de SQL más común en reportes de producción.

Corré las dos. Buscá a yamcha.

---

## NULL no es un valor

```sql
SELECT NULL = NULL;              -- (null), NOT true
SELECT NULL <> NULL;             -- (null)
SELECT 1 IN (1, NULL);           -- true
SELECT 2 IN (1, NULL);           -- (null)  -- NOT false!
SELECT 2 NOT IN (1, NULL);       -- (null)  -- so the row is excluded
```

`NULL` significa "desconocido", así que cualquier comparación con él es desconocida, y
`WHERE` solo se queda con las filas que son **verdaderas**.

**La consecuencia práctica — genuinamente peligrosa:**

```sql
-- ❌ Returns NOTHING if the subquery contains a single NULL
SELECT * FROM fighters
WHERE id NOT IN (SELECT fighter_id FROM readings WHERE power > 900000);

-- ✅ NOT EXISTS handles NULLs correctly, and usually plans better too
SELECT * FROM fighters f
WHERE NOT EXISTS (
    SELECT 1 FROM readings r WHERE r.fighter_id = f.id AND r.power > 900000
);
```

Probalo:

```sql
SELECT NULL IN (SELECT home FROM fighters);       -- (null)
SELECT count(*) FROM fighters WHERE home NOT IN (SELECT home FROM fighters);
-- 0 rows, because `home` is NULL for frieza and cell
```

**Regla: usá `NOT EXISTS`, nunca `NOT IN`, contra cualquier cosa nullable.**

Herramientas útiles para NULL:

```sql
SELECT coalesce(home, 'unknown') FROM fighters;      -- first non-null
SELECT nullif(home, '') FROM fighters;               -- '' -> NULL
SELECT name, home IS DISTINCT FROM 'earth' FROM fighters;  -- NULL-safe <>
```

---

## Agregación, `GROUP BY` y `HAVING`

```sql
SELECT f.race,
       count(*)                          AS readings,
       count(DISTINCT f.id)              AS fighters,
       round(avg(r.power))               AS avg_power,
       max(r.power)                      AS max_power,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY r.power) AS median_power
FROM fighters f
JOIN readings r ON r.fighter_id = f.id
GROUP BY f.race
HAVING count(*) > 50
ORDER BY avg_power DESC;
```

- **`WHERE` filtra filas *antes* de agrupar. `HAVING` filtra grupos *después*.**
  Poner un agregado en `WHERE` es un error; poner una condición de columna común en
  `HAVING` funciona pero es más lento — agrupa filas que después descarta.
- **`count(*)` cuenta filas. `count(col)` saltea NULLs.** Esa diferencia es fuente de
  bugs: `count(r.id)` en un LEFT JOIN da correctamente 0 para las filas sin match,
  mientras que `count(*)` da 1.
- **`FILTER` es más limpio que `CASE` para agregación condicional:**

```sql
SELECT f.race,
       count(*) FILTER (WHERE r.power > 500000) AS strong_readings,
       count(*) FILTER (WHERE r.power <= 500000) AS weak_readings
FROM fighters f JOIN readings r ON r.fighter_id = f.id
GROUP BY f.race;
```

---

## Window functions — la mejora individual más grande

Los agregados colapsan filas. **Las ventanas computan a través de filas
manteniéndolas.**

```sql
-- rank fighters by their best reading, WITHOUT losing the rows
SELECT
    f.name,
    r.power,
    r.recorded_at,
    row_number() OVER (PARTITION BY f.id ORDER BY r.recorded_at DESC) AS recency,
    rank()       OVER (ORDER BY r.power DESC)                          AS power_rank,
    r.power - lag(r.power) OVER (PARTITION BY f.id ORDER BY r.recorded_at)
                                                                       AS change,
    avg(r.power) OVER (PARTITION BY f.id)                              AS fighter_avg,
    avg(r.power) OVER (PARTITION BY f.id ORDER BY r.recorded_at
                       ROWS BETWEEN 4 PRECEDING AND CURRENT ROW)       AS moving_avg_5
FROM fighters f
JOIN readings r ON r.fighter_id = f.id
ORDER BY f.name, r.recorded_at DESC;
```

Las que vale la pena memorizar:

| Función | Te da |
|---|---|
| `row_number()` | 1,2,3,4 — siempre único |
| `rank()` | 1,2,2,4 — los empates comparten, después saltan |
| `dense_rank()` | 1,2,2,3 — los empates comparten, sin salto |
| `lag(x)` / `lead(x)` | el valor de la fila anterior / siguiente |
| `first_value` / `last_value` | los extremos de la ventana |
| `sum/avg/count OVER (...)` | agregado acumulado o particionado |
| `ntile(4)` | buckets de cuartiles |

**El uso canónico — "la última fila por grupo":**

```sql
-- with a window function
SELECT name, power, recorded_at FROM (
    SELECT f.name, r.power, r.recorded_at,
           row_number() OVER (PARTITION BY f.id ORDER BY r.recorded_at DESC) AS rn
    FROM fighters f JOIN readings r ON r.fighter_id = f.id
) t WHERE rn = 1;

-- Postgres-specific, and usually FASTER when an index covers the ordering
SELECT DISTINCT ON (f.id) f.name, r.power, r.recorded_at
FROM fighters f JOIN readings r ON r.fighter_id = f.id
ORDER BY f.id, r.recorded_at DESC;
```

Compará sus planes con `EXPLAIN ANALYZE` (Cápsula 11). `DISTINCT ON` puede recorrer un
índice y parar; la window function normalmente ordena.

---

## CTEs

```sql
WITH recent AS (
    SELECT fighter_id, power, recorded_at
    FROM readings
    WHERE recorded_at > now() - interval '7 days'
),
totals AS (
    SELECT fighter_id, count(*) AS n, max(power) AS best
    FROM recent GROUP BY fighter_id
)
SELECT f.name, t.n, t.best
FROM totals t JOIN fighters f ON f.id = t.fighter_id
ORDER BY t.best DESC;
```

Legible, componible y autodocumentado. Desde Postgres 12, los CTEs se inlinean y
optimizan como subqueries — antes de eso eran una **barrera de optimización**, que es
por qué los consejos viejos advierten contra ellos.

Usá `WITH ... AS MATERIALIZED` cuando *querés* la barrera (un CTE caro referenciado
varias veces).

**CTEs recursivos** para jerarquías:

```sql
WITH RECURSIVE lineage AS (
    SELECT id, name, mentor_id, 1 AS depth FROM fighters WHERE name = 'goku'
    UNION ALL
    SELECT f.id, f.name, f.mentor_id, l.depth + 1
    FROM fighters f JOIN lineage l ON f.mentor_id = l.id
    WHERE l.depth < 10          -- ALWAYS bound the recursion
)
SELECT * FROM lineage;
```

Organigramas, árboles de categorías, recorrido de grafos, y "todos los que reportan a
X". Siempre incluí una guarda de profundidad — un ciclo sin ella corre para siempre.

---

## Upserts

```sql
-- do nothing on conflict — idempotent insert (Capsule 19)
INSERT INTO fighters (name, race) VALUES ('broly', 'saiyan')
ON CONFLICT (name) DO NOTHING;

-- update on conflict — the real upsert
INSERT INTO fighters (name, race, home) VALUES ('broly', 'saiyan', 'vampa')
ON CONFLICT (name) DO UPDATE
SET race = EXCLUDED.race,
    home = EXCLUDED.home
WHERE fighters.home IS DISTINCT FROM EXCLUDED.home   -- skip no-op updates
RETURNING id, name, home;
```

- **`EXCLUDED`** es la fila que intentaste insertar.
- **`RETURNING`** te devuelve las filas afectadas — un round trip en vez de
  insert-después-select.
- **El `WHERE` en `DO UPDATE`** evita escribir una fila que no cambió, lo cual
  importa: un update que no hace nada igual crea una tupla muerta, igual escribe WAL, e
  igual dispara triggers.
- **`ON CONFLICT` requiere una restricción o índice único** sobre esas columnas.

`RETURNING` funciona también en `UPDATE` y `DELETE`, y es una de las mejores features
de Postgres:

```sql
DELETE FROM readings WHERE recorded_at < now() - interval '90 days'
RETURNING id, fighter_id;
```

---

## Transacciones en la práctica

```sql
BEGIN;
    UPDATE fighters SET home = 'namek' WHERE name = 'piccolo';
    SAVEPOINT sp1;
    UPDATE fighters SET home = 'nowhere' WHERE name = 'frieza';
    ROLLBACK TO sp1;          -- undo only the second statement
COMMIT;
```

**`SELECT ... FOR UPDATE`** bloquea filas para que un read-modify-write sea seguro
(Cápsula 10):

```sql
BEGIN;
SELECT power FROM readings WHERE id = 1 FOR UPDATE;   -- blocks other writers
UPDATE readings SET power = power + 100 WHERE id = 1;
COMMIT;
```

**`FOR UPDATE SKIP LOCKED`** es cómo construís una cola de trabajo en Postgres — cada
worker agarra filas distintas en vez de bloquearse (Cápsula 21):

```sql
SELECT id, payload FROM jobs
WHERE status = 'pending'
ORDER BY created_at
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

**Mantené cortas las transacciones.** Una transacción abierta a través de una llamada
de red retiene locks, bloquea `VACUUM`, e infla la tabla.

---

## Tipos que vale la pena conocer

```sql
-- JSONB: indexable, queryable semi-structured data
ALTER TABLE fighters ADD COLUMN meta JSONB DEFAULT '{}';
UPDATE fighters SET meta = '{"transformations":["ssj","ssj2"],"tail":false}'
WHERE name = 'goku';

SELECT name, meta->>'tail' AS tail, meta->'transformations' AS forms
FROM fighters WHERE meta @> '{"tail": false}';

CREATE INDEX idx_fighters_meta ON fighters USING GIN (meta);  -- GIN for @>, ?

-- Arrays
SELECT name FROM fighters WHERE race = ANY(ARRAY['saiyan','namekian']);

-- Ranges
SELECT tstzrange(now() - interval '1 day', now()) @> now();

-- Full text search — often enough to avoid running Elasticsearch
SELECT name FROM fighters
WHERE to_tsvector('english', name || ' ' || race) @@ plainto_tsquery('saiyan');
```

**`JSONB` vs `JSON`:** `JSONB` está parseado, es binario, indexable y reordena las
claves. `JSON` es el texto crudo. Usá `JSONB` salvo que necesites preservación exacta
byte a byte.

**No dejes que JSONB se vuelva un hábito para evitar el schema.** Las columnas que
consultás y restringís deberían ser columnas reales; JSONB es para atributos
genuinamente variables.

---

## Lab — diez queries para escribir vos

Hacé estas sin mirar. Después verificá con `EXPLAIN ANALYZE`.

```sql
-- 1. Fighters with NO readings (two ways: LEFT JOIN + IS NULL, and NOT EXISTS)

-- 2. Each fighter's most recent reading (DISTINCT ON and row_number())

-- 3. Per race: fighter count, avg power, median power

-- 4. Fighters whose latest reading is HIGHER than their previous one (lag)

-- 5. Top 3 readings per fighter (row_number() + PARTITION BY)

-- 6. Daily total power for the last 14 days, INCLUDING days with no readings
--    (hint: generate_series + LEFT JOIN — the "gap filling" problem)

-- 7. Each fighter's power as a % of the strongest fighter's power

-- 8. Fighters who improved by more than 50% between their first and last reading

-- 9. A 7-day moving average of power per fighter

-- 10. Upsert a reading such that re-running it changes nothing
```

Respuestas resueltas de las tres más difíciles:

<details>
<summary><b>6.</b> Relleno de huecos — días sin datos</summary>

```sql
WITH days AS (
    SELECT generate_series(
        date_trunc('day', now()) - interval '13 days',
        date_trunc('day', now()),
        interval '1 day'
    )::date AS day
)
SELECT d.day,
       coalesce(sum(r.power), 0) AS total_power,
       count(r.id)               AS readings
FROM days d
LEFT JOIN readings r ON date_trunc('day', r.recorded_at)::date = d.day
GROUP BY d.day
ORDER BY d.day;
```

Generar el calendario y hacerle left join a los datos es la solución estándar a "mi
gráfico tiene agujeros". Fijate el `coalesce` — sin él, los días vacíos muestran
`(null)` en vez de `0`.
</details>

<details>
<summary><b>8.</b> Mejora entre la primera y la última lectura</summary>

```sql
WITH bounds AS (
    SELECT fighter_id,
           first_value(power) OVER w AS first_power,
           last_value(power)  OVER w AS last_power,
           row_number()       OVER w AS rn
    FROM readings
    WINDOW w AS (PARTITION BY fighter_id ORDER BY recorded_at
                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
)
SELECT f.name,
       b.first_power,
       b.last_power,
       round((b.last_power - b.first_power) * 100.0 / nullif(b.first_power, 0), 1) AS pct
FROM bounds b
JOIN fighters f ON f.id = b.fighter_id
WHERE b.rn = 1
  AND b.last_power > b.first_power * 1.5
ORDER BY pct DESC;
```

Dos detalles que vale la pena notar: el `ROWS BETWEEN UNBOUNDED PRECEDING AND
UNBOUNDED FOLLOWING` explícito — sin él, `last_value` solo ve hasta la fila actual,
que es la sorpresa más común de las window functions. Y `nullif(x, 0)` para evitar la
división por cero, que devuelve NULL en vez de dar error.
</details>

<details>
<summary><b>9.</b> Promedio móvil</summary>

```sql
SELECT f.name,
       r.recorded_at::date,
       r.power,
       round(avg(r.power) OVER (
           PARTITION BY r.fighter_id
           ORDER BY r.recorded_at
           RANGE BETWEEN interval '7 days' PRECEDING AND CURRENT ROW
       )) AS moving_avg_7d
FROM readings r
JOIN fighters f ON f.id = r.fighter_id
ORDER BY f.name, r.recorded_at;
```

`RANGE` con un intervalo es por tiempo (los últimos 7 *días*); `ROWS` es por conteo
(las últimas 7 *filas*). Dan respuestas distintas cuando los datos están espaciados de
forma irregular, y elegir mal es un bug sutil de reportes.
</details>

---

## Llevátelo al trabajo

- **Las condiciones sobre la tabla derecha de un LEFT JOIN van en `ON`, no en
  `WHERE`.**
- **`NOT EXISTS`, nunca `NOT IN`**, contra cualquier cosa nullable.
- **Aprendé window functions.** Reemplazan cantidades enormes de loops del lado de la
  aplicación.
- **`RETURNING`** te ahorra un round trip en cada insert, update y delete.
- **`ON CONFLICT DO NOTHING`** es tu primitiva de idempotencia (Cápsula 19).
- **`FOR UPDATE SKIP LOCKED`** convierte una tabla en una cola de trabajo.
- **`EXPLAIN ANALYZE` antes de optimizar** (Cápsula 11).
- **Mantené cortas las transacciones** — nunca sostengas una a través de una llamada
  de red.
- **Solo queries parametrizadas.** La concatenación de strings es inyección SQL; los
  placeholders `$1` del driver no son más lentos.

---

## Battle drill

<details>
<summary><b>1.</b> ¿Por qué agregar un WHERE a tu LEFT JOIN hizo desaparecer filas?</summary>

Porque una condición sobre la tabla derecha en `WHERE` se evalúa contra `NULL` para
las filas sin match, y `NULL > 500000` es desconocido, no verdadero — así que `WHERE`
la descarta. Tu LEFT JOIN se convirtió silenciosamente en un INNER JOIN.

La solución es mover la condición a la cláusula `ON`, donde filtra *qué filas se
unen* en vez de *qué filas sobreviven*:

```sql
LEFT JOIN readings r ON r.fighter_id = f.id AND r.power > 500000
```

La excepción es `WHERE r.id IS NULL`, que es deliberada — ese es el idioma estándar de
"anti-join" para encontrar filas izquierdas sin match.

Modelo mental: `ON` decide qué matchea; `WHERE` filtra el resultado. Para la tabla
derecha de un LEFT JOIN, esas son cosas muy distintas.
</details>

<details>
<summary><b>2.</b> Explicá por qué <code>NOT IN</code> con una subquery es peligroso.</summary>

Si la subquery devuelve aunque sea un `NULL`, el `NOT IN` entero se evalúa como
desconocido para cada fila, y obtenés **cero resultados** — en silencio, sin ningún
error.

`x NOT IN (1, NULL)` se expande a `x <> 1 AND x <> NULL`. La segunda comparación es
desconocida, así que la conjunción es como mucho desconocida, nunca verdadera.

Es más feo que la mayoría de los bugs porque falla *cerrado*: un conjunto de
resultados vacío parece "sin coincidencias" en vez de "query rota", así que puede
sobrevivir en un reporte durante meses.

Usá `NOT EXISTS`, que usa semántica existencial correcta y no se ve afectada por los
NULLs. También suele producir un mejor plan (un anti-join en vez de una subquery
materializada).
</details>

<details>
<summary><b>3.</b> ¿Cuándo es mejor una window function que GROUP BY?</summary>

Cuando necesitás el agregado **y** las filas individuales.

`GROUP BY` colapsa: obtenés una fila por grupo y perdés el detalle. Una window
function computa sobre una partición mientras cada fila sobrevive.

Entonces: "cada lectura, más el promedio de ese peleador" es una window function.
"el promedio de cada peleador" es `GROUP BY`.

Las ventanas también hacen cosas que `GROUP BY` simplemente no puede: totales
acumulados, promedios móviles, ranking dentro de un grupo, comparar una fila con su
vecina (`lag`/`lead`), y "top N por grupo".

La alternativa — hacer self-join del agregado contra el detalle — funciona, pero es
más lenta y mucho más difícil de leer.

Costo: las ventanas normalmente requieren un sort, así que no son gratis.
`EXPLAIN ANALYZE` y compará; `DISTINCT ON` a menudo le gana a `row_number()` cuando un
índice provee el ordenamiento.
</details>

<details>
<summary><b>4.</b> ¿Cómo encontrarías y arreglarías una query lenta que no escribiste?</summary>

1. **Encontrala**: `pg_stat_statements` ordenado por `total_exec_time`, no por media —
   una query de 5 ms llamada un millón de veces cuesta más que una de 2 s llamada dos
   veces (Cápsula 11).
2. **`EXPLAIN (ANALYZE, BUFFERS)`** con parámetros realistas.
3. **Compará filas estimadas vs reales.** Un hueco grande significa estadísticas
   viejas — `ANALYZE` la tabla antes de hacer cualquier otra cosa.
4. **Buscá el nodo caro**: un Seq Scan sobre una tabla grande, un Nested Loop con un
   lado externo grande, un Sort volcando a disco (`external merge`), o un filtro que
   remueve muchas más filas de las que conserva.
5. **Mirá la forma**, no solo el plan: `SELECT *` trayendo una columna JSONB grande,
   `LIMIT` faltante, un N+1 disfrazado, `OFFSET` profundo en un resultado.
6. **Arreglá en orden de qué tan barato es**: un índice, después reescribir la query,
   después desnormalizar, después cachear. Volvé a medir después de cada uno.
</details>

<details>
<summary><b>5.</b> ¿La lógica de negocio debería vivir en la base de datos?</summary>

Parte de ella, y vale la pena tener clara la línea.

**Sí, en la base de datos:**
- **Restricciones** — `NOT NULL`, `CHECK`, `UNIQUE`, foreign keys. La base es la
  última línea de defensa, existen otros escritores (migraciones, herramientas de
  admin, otro equipo), y la validación de aplicación tiene bugs.
- **Operaciones de conjuntos** — agregación, joins, window functions. Traer 100k filas
  a tu app para sumarlas es estrictamente peor.

**Normalmente no:**
- **Stored procedures y triggers complejos.** Son difíciles de versionar, difíciles de
  testear, invisibles en code review, y sorprenden a la gente — un trigger disparándose
  en una escritura no relacionada es una sesión de debugging genuinamente miserable.
- **Cualquier cosa que necesite llamar a un servicio externo.**

La posición pragmática: **integridad de datos en la base, flujo de negocio en la
aplicación.** Y elijas lo que elijas, hacelo descubrible — una restricción que nadie
conoce es tan confusa como un trigger que nadie conoce.
</details>

---

## Registralo

```bash
cd ~/repos/pato/gravity-augmented && ./bin/scouter done B4
```
