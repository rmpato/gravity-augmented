# Capsule B4 · Ancient Namekian — SQL Essentials

> *The Dragon Balls only work if someone can read Ancient Namekian. Dende can,
> Bulma can't, and no amount of engineering brilliance substitutes for being
> able to read the language the truth is written in.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 70 min | none | Capsule 10 |

---

## Why this capsule exists

An ORM will get you to `SELECT * FROM users WHERE id = ?`. Beyond that, the
engineers who can drop into SQL solve problems in one query that others solve
with three round trips and a loop in application code.

This is the SQL that actually comes up: joins done right, aggregation, window
functions, upserts, and the handful of things that quietly produce wrong answers.

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

Some data to work with:

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

## Joins — and the one that catches everyone

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

**The trap that produces wrong answers silently:**

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

> **`WHERE` on a left-joined table turns the LEFT JOIN into an INNER JOIN**,
> because `NULL > 500000` is not true. Conditions on the *right* table belong in
> `ON`; conditions on the *left* table belong in `WHERE`. This is the single most
> common SQL bug in production reports.

Run both. Look for yamcha.

---

## NULL is not a value

```sql
SELECT NULL = NULL;              -- (null), NOT true
SELECT NULL <> NULL;             -- (null)
SELECT 1 IN (1, NULL);           -- true
SELECT 2 IN (1, NULL);           -- (null)  -- NOT false!
SELECT 2 NOT IN (1, NULL);       -- (null)  -- so the row is excluded
```

`NULL` means "unknown", so any comparison with it is unknown, and `WHERE`
only keeps rows that are **true**.

**The practical consequence — a genuinely dangerous one:**

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

Prove it:

```sql
SELECT NULL IN (SELECT home FROM fighters);       -- (null)
SELECT count(*) FROM fighters WHERE home NOT IN (SELECT home FROM fighters);
-- 0 rows, because `home` is NULL for frieza and cell
```

**Rule: use `NOT EXISTS`, never `NOT IN`, against anything nullable.**

Useful NULL tools:

```sql
SELECT coalesce(home, 'unknown') FROM fighters;      -- first non-null
SELECT nullif(home, '') FROM fighters;               -- '' -> NULL
SELECT name, home IS DISTINCT FROM 'earth' FROM fighters;  -- NULL-safe <>
```

---

## Aggregation, `GROUP BY` and `HAVING`

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

- **`WHERE` filters rows *before* grouping. `HAVING` filters groups *after*.**
  Putting an aggregate in `WHERE` is an error; putting a plain column condition
  in `HAVING` works but is slower — it groups rows it will then discard.
- **`count(*)` counts rows. `count(col)` skips NULLs.** That difference is a
  bug source: `count(r.id)` in a LEFT JOIN correctly gives 0 for unmatched rows,
  while `count(*)` gives 1.
- **`FILTER` is cleaner than `CASE` for conditional aggregation:**

```sql
SELECT f.race,
       count(*) FILTER (WHERE r.power > 500000) AS strong_readings,
       count(*) FILTER (WHERE r.power <= 500000) AS weak_readings
FROM fighters f JOIN readings r ON r.fighter_id = f.id
GROUP BY f.race;
```

---

## Window functions — the biggest single upgrade

Aggregates collapse rows. **Windows compute across rows while keeping them.**

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

The ones worth memorising:

| Function | Gives you |
|---|---|
| `row_number()` | 1,2,3,4 — always unique |
| `rank()` | 1,2,2,4 — ties share, then skip |
| `dense_rank()` | 1,2,2,3 — ties share, no skip |
| `lag(x)` / `lead(x)` | the previous / next row's value |
| `first_value` / `last_value` | endpoints of the window |
| `sum/avg/count OVER (...)` | running or partitioned aggregate |
| `ntile(4)` | quartile buckets |

**The canonical use — "latest row per group":**

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

Compare their plans with `EXPLAIN ANALYZE` (Capsule 11). `DISTINCT ON` can walk
an index and stop; the window function usually sorts.

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

Readable, composable, and self-documenting. Since Postgres 12, CTEs are inlined
and optimised like subqueries — before that they were an **optimisation fence**,
which is why old advice warns against them.

Use `WITH ... AS MATERIALIZED` when you *want* the fence (an expensive CTE
referenced several times).

**Recursive CTEs** for hierarchies:

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

Org charts, category trees, graph traversal, and "everyone who reports to X".
Always include a depth guard — a cycle without one runs forever.

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

- **`EXCLUDED`** is the row you tried to insert.
- **`RETURNING`** gives you back the affected rows — one round trip instead of
  insert-then-select.
- **The `WHERE` on `DO UPDATE`** avoids writing a row that hasn't changed, which
  matters: a no-op update still creates a dead tuple, still writes WAL, and still
  fires triggers.
- **`ON CONFLICT` requires a unique constraint or index** on those columns.

`RETURNING` works on `UPDATE` and `DELETE` too, and it's one of Postgres's best
features:

```sql
DELETE FROM readings WHERE recorded_at < now() - interval '90 days'
RETURNING id, fighter_id;
```

---

## Transactions in practice

```sql
BEGIN;
    UPDATE fighters SET home = 'namek' WHERE name = 'piccolo';
    SAVEPOINT sp1;
    UPDATE fighters SET home = 'nowhere' WHERE name = 'frieza';
    ROLLBACK TO sp1;          -- undo only the second statement
COMMIT;
```

**`SELECT ... FOR UPDATE`** locks rows so a read-modify-write is safe
(Capsule 10):

```sql
BEGIN;
SELECT power FROM readings WHERE id = 1 FOR UPDATE;   -- blocks other writers
UPDATE readings SET power = power + 100 WHERE id = 1;
COMMIT;
```

**`FOR UPDATE SKIP LOCKED`** is how you build a work queue in Postgres — each
worker grabs different rows instead of blocking (Capsule 21):

```sql
SELECT id, payload FROM jobs
WHERE status = 'pending'
ORDER BY created_at
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

**Keep transactions short.** A transaction held open across a network call holds
locks, blocks `VACUUM`, and bloats the table.

---

## Types worth knowing

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

**`JSONB` vs `JSON`:** `JSONB` is parsed, binary, indexable and reorders keys.
`JSON` is the raw text. Use `JSONB` unless you need byte-exact preservation.

**Don't let JSONB become a schema-avoidance habit.** Columns you query and
constrain should be real columns; JSONB is for genuinely variable attributes.

---

## Lab — ten queries to write yourself

Do these without looking. Then check with `EXPLAIN ANALYZE`.

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

Worked answers for the three hardest:

<details>
<summary><b>6.</b> Gap filling — days with no data</summary>

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

Generating the calendar and left-joining data onto it is the standard solution
to "my chart has holes in it". Note the `coalesce` — without it, empty days show
`(null)` rather than `0`.
</details>

<details>
<summary><b>8.</b> Improvement between first and last reading</summary>

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

Two details worth noticing: the explicit `ROWS BETWEEN UNBOUNDED PRECEDING AND
UNBOUNDED FOLLOWING` — without it `last_value` sees only up to the current row,
which is the most common window-function surprise. And `nullif(x, 0)` to avoid
division by zero, which returns NULL instead of erroring.
</details>

<details>
<summary><b>9.</b> Moving average</summary>

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

`RANGE` with an interval is time-based (the last 7 *days*); `ROWS` is
count-based (the last 7 *rows*). They give different answers when data is
irregularly spaced, and picking the wrong one is a subtle reporting bug.
</details>

---

## Bring it to work

- **Conditions on a LEFT JOIN's right table go in `ON`, not `WHERE`.**
- **`NOT EXISTS`, never `NOT IN`**, against anything nullable.
- **Learn window functions.** They replace enormous amounts of application-side
  looping.
- **`RETURNING`** saves a round trip on every insert, update and delete.
- **`ON CONFLICT DO NOTHING`** is your idempotency primitive (Capsule 19).
- **`FOR UPDATE SKIP LOCKED`** turns a table into a work queue.
- **`EXPLAIN ANALYZE` before you optimise** (Capsule 11).
- **Keep transactions short** — never hold one across a network call.
- **Parameterised queries only.** String concatenation is SQL injection; the
  driver's `$1` placeholders are not slower.

---

## Battle drill

<details>
<summary><b>1.</b> Why did adding a WHERE clause to your LEFT JOIN make rows disappear?</summary>

Because a condition on the right-hand table in `WHERE` evaluates against `NULL`
for unmatched rows, and `NULL > 500000` is unknown, not true — so `WHERE`
discards it. Your LEFT JOIN has silently become an INNER JOIN.

The fix is to move the condition into the `ON` clause, where it filters *which
rows join* rather than *which rows survive*:

```sql
LEFT JOIN readings r ON r.fighter_id = f.id AND r.power > 500000
```

The exception is `WHERE r.id IS NULL`, which is deliberate — that's the standard
"anti-join" idiom for finding left rows with no match.

Mental model: `ON` decides what matches; `WHERE` filters the result. For the
right table of a LEFT JOIN, those are very different things.
</details>

<details>
<summary><b>2.</b> Explain why <code>NOT IN</code> with a subquery is dangerous.</summary>

If the subquery returns even one `NULL`, the entire `NOT IN` evaluates to
unknown for every row, and you get **zero results** — silently, with no error.

`x NOT IN (1, NULL)` expands to `x <> 1 AND x <> NULL`. The second comparison is
unknown, so the conjunction is at best unknown, never true.

This is nastier than most bugs because it fails *closed*: an empty result set
looks like "no matches" rather than "broken query", so it can survive in a report
for months.

Use `NOT EXISTS`, which uses proper existential semantics and is unaffected by
NULLs. It also usually produces a better plan (an anti-join rather than a
materialised subquery).
</details>

<details>
<summary><b>3.</b> When is a window function better than GROUP BY?</summary>

When you need the aggregate **and** the individual rows.

`GROUP BY` collapses: you get one row per group and lose the detail. A window
function computes across a partition while every row survives.

So: "each reading, plus that fighter's average" is a window function. "each
fighter's average" is `GROUP BY`.

Windows also do things `GROUP BY` simply cannot: running totals, moving
averages, ranking within a group, comparing a row to its neighbour (`lag`/`lead`),
and "top N per group".

The alternative — self-joining the aggregate back onto the detail — works, but
it's slower and much harder to read.

Cost: windows usually require a sort, so they're not free. `EXPLAIN ANALYZE` and
compare; `DISTINCT ON` often beats `row_number()` when an index provides the
ordering.
</details>

<details>
<summary><b>4.</b> How would you find and fix a slow query you didn't write?</summary>

1. **Find it**: `pg_stat_statements` ordered by `total_exec_time`, not mean — a
   5 ms query called a million times costs more than a 2 s query called twice
   (Capsule 11).
2. **`EXPLAIN (ANALYZE, BUFFERS)`** it with realistic parameters.
3. **Compare estimated vs actual rows.** A large gap means stale statistics —
   `ANALYZE` the table before doing anything else.
4. **Look for the expensive node**: a Seq Scan on a big table, a Nested Loop with
   a large outer side, a Sort spilling to disk (`external merge`), or a filter
   removing far more rows than it keeps.
5. **Check the shape**, not just the plan: `SELECT *` pulling a large JSONB
   column, missing `LIMIT`, an N+1 in disguise, `OFFSET` deep in a result set.
6. **Fix in order of cheapness**: an index, then rewriting the query, then
   denormalising, then caching. Re-measure after each.
</details>

<details>
<summary><b>5.</b> Should business logic live in the database?</summary>

Some of it, and the line is worth being clear about.

**Yes, in the database:**
- **Constraints** — `NOT NULL`, `CHECK`, `UNIQUE`, foreign keys. The database is
  the last line of defence, other writers exist (migrations, admin tools, another
  team), and application validation has bugs.
- **Set-based operations** — aggregation, joins, window functions. Pulling 100k
  rows into your app to sum them is strictly worse.

**Usually not:**
- **Complex stored procedures and triggers.** They're hard to version, hard to
  test, invisible in code review, and they surprise people — a trigger firing on
  an unrelated write is a genuinely miserable debugging session.
- **Anything that needs to call an external service.**

The pragmatic position: **data integrity in the database, business workflow in
the application.** And whichever you choose, make it discoverable — a constraint
nobody knows about is as confusing as a trigger nobody knows about.
</details>

---

## Log it

```bash
cd ~/repos/pato/gravity-augmented && ./bin/scouter done B4
```
