# Cápsula 24 · Cambio de Cuerpo de Ginyu — Deploys seguros

> *El Capitán Ginyu intercambia cuerpos con Goku en medio de una pelea. La misma
> mente, un vehículo completamente distinto, y el cambio ocurre al instante sin
> downtime. También le sale mal dos veces — una termina siendo una rana — que es por
> qué siempre mantenés disponible el cuerpo viejo y ensayás el camino de vuelta.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 8 | 80 min | Cápsulas 02, 07, 22 | Local + ☁️ opcional |

---

## Por qué existe esta cápsula

Todo en este repo no vale nada si no lo podés shippear con seguridad. El deploy es
donde se originan la mayoría de los incidentes de producción — no porque el código
estuviera mal, sino porque la *transición* lo estaba.

Los equipos que deployan veinte veces por día con confianza no son más valientes.
Hicieron que deployar sea **aburrido**: cambios chicos, rollback instantáneo, y un
paso de release separado del paso de deploy.

---

## El concepto

### Deploy ≠ release

La idea más importante de acá.

- **Deploy** — el código nuevo está corriendo en servidores.
- **Release** — los usuarios lo están recibiendo.

Separarlos es lo que hace posible todo lo demás: deployás a las 10 de la mañana con
cero impacto en usuarios, después liberás al 1% a las 11 y mirás. Si está mal, volvés
al 0% en segundos — sin rebuild, sin pipeline de rollback, sin git revert.

Los mecanismos son **traffic splitting** (infraestructura) y **feature flags**
(aplicación).

### Las estrategias

**Rolling** — reemplazás instancias de a pocas.

```
  [v1][v1][v1][v1] → [v2][v1][v1][v1] → [v2][v2][v1][v1] → [v2][v2][v2][v2]
```

El default en Kubernetes. Sin costo de capacidad extra. Pero las dos versiones
sirven simultáneamente (así que tienen que ser compatibles), y el rollback es otro
rolling lento.

**Blue/green** — dos entornos completos, cambiás todo el tráfico de una.

```
  blue (v1) ←── 100% traffic
  green (v2) ←─ 0%, warm and tested
                     ↓ switch
  blue (v1) ←── 0%
  green (v2) ←─ 100%
```

Rollback instantáneo (volvés a cambiar). Cuesta 2× capacidad durante la transición, y
cada usuario se mueve de una — así que un release malo le pega a todos.

**Canary** — un porcentaje chico primero, después aumentás.

```
  v1: 95% ──► v1: 90% ──► v1: 50% ──► v1: 0%
  v2:  5%     v2: 10%     v2: 50%     v2: 100%
       ↑ watch error rate and latency at each step
```

El mejor control de radio de explosión. Necesita buenas métricas y paciencia. **Este
es el default que deberías querer.**

**Shadow / dark launch** — mandás una copia del tráfico de producción a v2 y
descartás sus respuestas. Testea patrones de tráfico reales con riesgo cero para los
usuarios. Ojo: la sombra no tiene que causar efectos secundarios (sin escrituras, sin
mails, sin cobros).

### Expand → migrate → contract

**No podés deployar código y schema en el mismo instante**, porque durante un rolling
deploy las dos versiones corren simultáneamente. Así que nunca escribas una migración
que lo requiera.

Renombrar `power` a `power_level`, hecho con seguridad:

```
  1. EXPAND    ALTER TABLE readings ADD COLUMN power_level BIGINT;
               Old code unaffected. Deploy this alone.

  2. MIGRATE   Deploy code that WRITES BOTH and READS power_level
               with a fallback to power. Backfill in batches.

  3. CONTRACT  Once nothing reads `power`: ALTER TABLE DROP COLUMN power;
               A separate deploy, often days later.
```

Tres deploys en vez de uno, y cada estado intermedio funciona con las dos versiones
corriendo. **Toda migración tiene que poder correr mientras la versión vieja sigue
sirviendo.**

Las reglas que se siguen:

- **Los cambios aditivos son seguros** (columna nullable nueva, tabla nueva, índice
  con `CONCURRENTLY`).
- **Los cambios destructivos necesitan un ciclo completo de expand/contract** (drop,
  rename, cambio de tipo, agregar `NOT NULL`).
- **Nunca hagas que una migración y un cambio de código dependan uno del otro.**
- **Hacé el backfill en lotes** con una pausa — un solo `UPDATE` sobre 50M de filas
  bloquea la tabla y te tira el sitio.

### Feature flags

Los flags desacoplan release de deploy *dentro* de la aplicación:

```go
if flags.Enabled(ctx, "new-ranking-algorithm", userID) {
    return newRanking(ctx)
}
return oldRanking(ctx)
```

- **Flags de release** — temporales, para el rollout. **Borralos en semanas.**
- **Flags de operación** (kill switches) — permanentes, para desactivar una feature
  cara bajo carga.
- **Flags de experimento** — tests A/B, removidos cuando termina el experimento.

**La deuda de flags es real.** Cada flag duplica un camino de código; diez flags son
1.024 combinaciones teóricas. Ponele fecha de vencimiento a los flags de release e
imponela.

### Qué mirar durante un rollout

Compará **canary contra baseline**, no canary contra su propia historia:

- **Tasa de error** — la señal principal. Cualquier aumento aborta.
- **Latencia p95/p99** — un canary suele ser más rápido con una porción chica de
  tráfico; compará peras con peras.
- **Saturación** — memoria y CPU por request, que agarra leaks.
- **Métricas de negocio** — conversión de checkout, registros. Un release
  técnicamente sano que corta a la mitad las conversiones es un release fallido.

**Automatizá el aborto.** Un humano mirando un dashboard no es una estrategia de
rollback; se van a almorzar.

### Disciplina de rollback

> **Sabé tu comando de rollback antes de deployar.** Escribilo en el PR.

- **Revertir código** es fácil si los artefactos son inmutables y están etiquetados
  con el SHA de git (Cápsula 02).
- **Revertir un schema normalmente es imposible** — no podés des-borrar una columna
  con datos. Por eso existe expand/contract.
- **Revertir datos** escritos por la versión mala puede necesitar una reparación
  aparte.
- **Fix hacia adelante vs rollback**: rollback por defecto, porque es el estado
  conocido bueno. Fix hacia adelante solo cuando el rollback es genuinamente
  imposible (ya corrió una migración irreversible) — y ahí estás en un incidente, no
  en un deploy.

---

## Lab

### Paso 1 — un endpoint de versión que puedas mirar

```go
// Set at build time: -ldflags "-X main.version=$(git rev-parse --short HEAD)"
var version = "dev"

	mux.HandleFunc("GET /version", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"version":  version,
			"instance": hostname,
		})
	})
```

```makefile
VERSION ?= $(shell git rev-parse --short HEAD)

docker-build:
	docker build -f deploy/Dockerfile \
	  --build-arg VERSION=$(VERSION) \
	  -t $(IMAGE):$(VERSION) .
```

Fijate que **no hay tag `:latest`** acá. Un tag inmutable por build es lo que hace
del rollback un cambio de una palabra en vez de un rebuild.

### Paso 2 — blue/green en local

```bash
make docker-build VERSION=v1
# make a visible change, then:
make docker-build VERSION=v2
```

**`deploy/nginx-bluegreen.conf`**

```nginx
events {}
http {
  upstream app {
    # Weighted traffic split. This is what a canary IS — everything else
    # is tooling around this one idea.
    server blue:8080  weight=100;
    # NOT weight=0 — nginx rejects that outright:
    #   [emerg] invalid parameter "weight=0"
    # Weights must be >= 1, so "no traffic" is expressed with `down`.
    server green:8080 down;
  }

  server {
    listen 80;
    location / {
      proxy_pass http://app;
      add_header X-Served-By $upstream_addr always;
    }
  }
}
```

> **`down`, no `weight=0`.** nginx se niega a arrancar con `weight=0` — los pesos
> tienen que ser al menos 1. `down` marca el servidor como administrativamente no
> disponible, que es lo que realmente querés decir en 0%. Para arrancar el canary
> reemplazás `down` por un peso real:
>
> ```nginx
> server blue:8080  weight=80;
> server green:8080 weight=20;
> ```
>
> Verificado: con `down`, 10 de 10 requests fueron a blue. Con 80/20, 4 de 20
> fueron a green — exactamente 20%.

```bash
docker network create deploy-lab 2>/dev/null
docker run -d --rm --network deploy-lab --name blue  scouter:v1
docker run -d --rm --network deploy-lab --name green scouter:v2
docker run -d --rm --network deploy-lab --name lb -p 8080:80 \
  -v "$PWD/deploy/nginx-bluegreen.conf:/etc/nginx/nginx.conf:ro" nginx:alpine

for i in $(seq 1 20); do curl -s localhost:8080/version | jq -r .version; done | sort | uniq -c
# 20 v1
```

### Paso 3 — canary, paso a paso

```bash
canary() {   # canary <blue_weight> <green_weight>
  sed -i.bak "s/server blue:8080  weight=[0-9]*/server blue:8080  weight=$1/;
              s/server green:8080 weight=[0-9]*/server green:8080 weight=$2/" \
      deploy/nginx-bluegreen.conf
  docker exec lb nginx -s reload 2>/dev/null
  sleep 1
  echo "--- blue=$1 green=$2 ---"
  for i in $(seq 1 100); do curl -s localhost:8080/version | jq -r .version; done \
    | sort | uniq -c
}

canary 95 5      # 5% canary
canary 90 10
canary 50 50
canary 0 100     # full release
canary 100 0     # INSTANT ROLLBACK
```

Esa última línea tarda alrededor de un segundo. **Ese es el punto entero de separar
deploy de release** — el rollback no es un pipeline, es un peso.

### Paso 4 — hacé fallar el canary, y atrapalo

Construí una v3 deliberadamente rota:

```go
	mux.HandleFunc("GET /leaderboard", func(w http.ResponseWriter, r *http.Request) {
		if version == "v3" && rand.Float64() < 0.3 {
			http.Error(w, "boom", http.StatusInternalServerError) // 30% failure
			return
		}
		s.handleLeaderboard(w, r)
	})
```

```bash
make docker-build VERSION=v3
docker rm -f green; docker run -d --rm --network deploy-lab --name green scouter:v3
canary 90 10
```

Ahora automatizá la decisión — este script es el entregable de la cápsula:

**`scripts/canary-watch.sh`**

```bash
#!/usr/bin/env bash
# Watch a canary and abort automatically if its error rate exceeds a threshold.
# A human watching a dashboard is not a rollback strategy.
set -euo pipefail

URL="${URL:-http://localhost:8080/leaderboard}"
SAMPLES="${SAMPLES:-200}"
MAX_ERROR_PCT="${MAX_ERROR_PCT:-2}"

errors=0
for i in $(seq 1 "$SAMPLES"); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
  [ "$code" -ge 500 ] && errors=$((errors + 1))
done

pct=$(( errors * 100 / SAMPLES ))
echo "errors: $errors/$SAMPLES (${pct}%)  threshold: ${MAX_ERROR_PCT}%"

if [ "$pct" -gt "$MAX_ERROR_PCT" ]; then
  echo "ABORT — rolling back"
  exit 1
fi
echo "healthy — proceeding"
```

```bash
chmod +x scripts/canary-watch.sh
./scripts/canary-watch.sh   # ~3% errors at 10% canary of a 30%-broken build
# ABORT — rolling back
canary 100 0
```

**Una tasa de falla del 30% apareció como ~3% del tráfico total** porque el canary
era solo el 10%. Eso es control de radio de explosión expresado como aritmética, y es
la razón por la que los canaries valen la ceremonia.

### Paso 5 — expand / migrate / contract, en serio

Renombrá `power` a `power_level` sin downtime.

**Migración 1 — expand** (`deploy/sql/005_expand_power_level.sql`):

```sql
-- Additive only. Old code is completely unaffected by this.
ALTER TABLE readings ADD COLUMN power_level BIGINT;

-- CONCURRENTLY: does not lock writes. Cannot run inside a transaction,
-- and may leave an INVALID index if it fails (drop and retry).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_readings_power_level
    ON readings (power_level);
```

**Código v2 — escribí las dos, leé la nueva con fallback:**

```go
// TRANSITION CODE. Writes both columns; reads the new one, falling back to
// the old for rows not yet backfilled. Delete this after the contract step —
// and put the deletion in your backlog now, not later.
const insertBoth = `
	INSERT INTO readings (fighter_id, power, power_level, recorded_at)
	VALUES ($1, $2, $2, $3)`

const selectWithFallback = `
	SELECT COALESCE(power_level, power) AS power, recorded_at
	FROM readings WHERE fighter_id = $1
	ORDER BY recorded_at DESC LIMIT 1`
```

**Backfill — en lotes, con throttling:**

```sql
-- Never a single UPDATE over the whole table: it takes a lock, generates
-- enormous WAL, and blocks everyone. Batch, and sleep between batches.
DO $$
DECLARE
    rows_updated INT;
BEGIN
    LOOP
        UPDATE readings
        SET power_level = power
        WHERE id IN (
            SELECT id FROM readings
            WHERE power_level IS NULL
            LIMIT 10000
        );
        GET DIAGNOSTICS rows_updated = ROW_COUNT;
        EXIT WHEN rows_updated = 0;
        RAISE NOTICE 'backfilled % rows', rows_updated;
        COMMIT;
        PERFORM pg_sleep(0.1);   -- let replicas keep up (Capsule 13)
    END LOOP;
END $$;
```

**Verificá antes de contraer** — esta query tiene que devolver 0:

```sql
SELECT count(*) FROM readings WHERE power_level IS NULL;
```

**Código v3 — leé y escribí solo la columna nueva.** Deployá. Esperá. Confirmá que
nada referencia `power` (grepeá el codebase, mirá los logs de queries).

**Migración 2 — contract**, días después:

```sql
ALTER TABLE readings DROP COLUMN power;
```

Hacé el ciclo entero en tu base local y anotá cuántos *deploys* llevó. Tres. Ese es
el número correcto, y la razón por la que la gente shippea migraciones rotas es que
querían que fuera uno.

### Paso 6 — feature flags

**`internal/flags/flags.go`**

```go
// Package flags separates RELEASE from DEPLOY inside the application.
package flags

import (
	"hash/fnv"
	"os"
	"strconv"
	"strings"
	"sync"
)

type Flags struct {
	mu    sync.RWMutex
	rules map[string]int // flag -> rollout percentage 0..100
}

// New reads flags from the environment: FLAGS="new-ranking=25,dark-mode=100"
// In production this comes from a config service or LaunchDarkly/Unleash, so
// it can change WITHOUT a deploy — which is the entire point.
func New() *Flags {
	f := &Flags{rules: map[string]int{}}
	for _, pair := range strings.Split(os.Getenv("FLAGS"), ",") {
		name, pct, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		if n, err := strconv.Atoi(pct); err == nil {
			f.rules[strings.TrimSpace(name)] = n
		}
	}
	return f
}

// Enabled is STICKY per subject: the same user always gets the same answer
// for a given flag. Random per-request would flip users between code paths
// mid-session, which is how you get bug reports nobody can reproduce.
func (f *Flags) Enabled(flag, subject string) bool {
	f.mu.RLock()
	pct, ok := f.rules[flag]
	f.mu.RUnlock()
	if !ok || pct <= 0 {
		return false
	}
	if pct >= 100 {
		return true
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(flag + ":" + subject))
	return int(h.Sum32()%100) < pct
}

// SetPercent allows runtime changes — the kill switch.
func (f *Flags) SetPercent(flag string, pct int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rules[flag] = pct
}
```

**`internal/flags/flags_test.go`**

```go
package flags

import (
	"fmt"
	"testing"
)

func TestStickiness(t *testing.T) {
	f := &Flags{rules: map[string]int{"exp": 50}}
	first := f.Enabled("exp", "user-42")
	for i := 0; i < 100; i++ {
		if f.Enabled("exp", "user-42") != first {
			t.Fatal("flag is not sticky for the same subject")
		}
	}
}

func TestDistribution(t *testing.T) {
	f := &Flags{rules: map[string]int{"exp": 25}}
	on := 0
	const n = 10000
	for i := 0; i < n; i++ {
		if f.Enabled("exp", fmt.Sprintf("user-%d", i)) {
			on++
		}
	}
	pct := on * 100 / n
	t.Logf("25%% rollout produced %d%%", pct)
	if pct < 22 || pct > 28 {
		t.Errorf("distribution = %d%%, want ~25%%", pct)
	}
}
```

```bash
go test ./internal/flags/ -v
FLAGS="new-ranking=25" make run
```

```bash
docker rm -f blue green lb; docker network rm deploy-lab
```

---

## En GCP

> ### ☁️ Opcional: traffic splitting de Cloud Run
> Elegible para el free tier. Cloud Run tiene traffic splitting por revisión
> incorporado, lo que lo convierte en el sistema de canary más fácil que vas a usar.

```bash
# deploy WITHOUT taking traffic — this is "deploy", not "release"
gcloud run deploy scouter \
  --image="$IMAGE:v2" \
  --no-traffic \
  --tag=v2 \
  --region=us-central1

# the tagged revision gets its own URL for smoke testing
# https://v2---scouter-xyz.run.app
curl -s "https://v2---scouter-xyz.run.app/version"

# release to 5%
gcloud run services update-traffic scouter --to-tags=v2=5 --region=us-central1

# watch, then ramp
gcloud run services update-traffic scouter --to-tags=v2=25 --region=us-central1
gcloud run services update-traffic scouter --to-tags=v2=100 --region=us-central1

# INSTANT ROLLBACK to the previous revision
gcloud run services update-traffic scouter --to-revisions=scouter-00042-abc=100 \
  --region=us-central1
```

`--no-traffic --tag` es la separación deploy/release más limpia disponible en
cualquier plataforma: la revisión está viva, direccionable y testeable, con cero
tráfico de producción.

Las otras piezas:

- **`gcloud run revisions list`** — cada revisión pasada se retiene y se puede
  re-apuntar al instante. El rollback es un comando sin rebuild.
- **Cloud Deploy** — pipelines de entrega con puertas de aprobación entre
  dev → staging → prod, incluidos rollouts multi-servicio.
- **Triggers de Cloud Build** — construí y deployá al push, con sustituciones para el
  SHA de git.
- **Las políticas de alerta de Cloud Monitoring** pueden vigilar un canary; conectá
  la notificación a una Cloud Function que llame a `update-traffic` para abortar
  automáticamente.
- **GKE**: `Deployment` con `maxSurge`/`maxUnavailable` para rolling, más Argo
  Rollouts o Flagger para análisis de canary de verdad.
- **Binary Authorization** puede exigir que solo se deployen imágenes firmadas por tu
  pipeline.

---

## Llevátelo al trabajo

- **Deploy y release son eventos separados.** Construí la capacidad antes de
  necesitarla.
- **Artefactos inmutables etiquetados con SHA.** Nunca deployes `:latest`.
- **Escribí el comando de rollback en la descripción del PR.**
- **Expand → migrate → contract para todo cambio destructivo de schema.** Sin
  excepciones, y son tres deploys.
- **Backfill en lotes con una pausa.** Mirá el lag de replicación mientras corre.
- **Automatizá el aborto del canary.** Los humanos se van a almorzar.
- **Compará el canary contra un baseline concurrente**, nunca contra ayer.
- **Ponele fecha de vencimiento a los flags de release** y limpialos. La deuda de
  flags se acumula.
- **Practicá los rollbacks.** Un camino de rollback que nunca ejercitaste es una
  hipótesis.

---

## Battle drill

<details>
<summary><b>1.</b> Recorré cómo renombrar una columna en una tabla de 500M de filas sin downtime.</summary>

**Expand:** `ADD COLUMN nombre_nuevo` (nullable, sin default — un default con valor
reescribe la tabla en Postgres viejo). Agregá cualquier índice con `CONCURRENTLY`.
Deployá esta migración sola; el código viejo ni se entera.

**Migrate (código):** deployá una versión que escriba las dos columnas y lea
`COALESCE(nombre_nuevo, nombre_viejo)`. Ahora las instancias viejas y nuevas son
correctas durante un rolling deploy.

**Backfill:** lotes de ~10k con una pausa corta, monitoreando el lag de replicación y
el disco (WAL). Sobre 500M de filas esto son horas o días, y está bien — nada está
bloqueado.

**Verificá:** `SELECT count(*) WHERE nombre_nuevo IS NULL` tiene que ser 0. Después
deployá código que use solo `nombre_nuevo`.

**Contract:** días después, cuando estés seguro de que nada lo lee,
`DROP COLUMN nombre_viejo`.

Total: 3 deploys, 2 migraciones, un backfill. Cada estado intermedio es seguro con
las dos versiones de código corriendo — que es el requisito real, y la razón por la
que no se puede comprimir.
</details>

<details>
<summary><b>2.</b> ¿Blue/green o canary?</summary>

**Canary** es el mejor default. Limita el radio de explosión (5% de los usuarios ve
un release malo, no el 100%), te da señal real de producción con bajo riesgo, y te
deja abortar barato. Costo: lleva más tiempo, necesita buenas métricas por versión, y
las dos versiones corren simultáneamente así que tienen que ser compatibles.

**Blue/green** es correcto cuando las versiones *no pueden* coexistir — un cambio
incompatible de schema o de protocolo — o cuando necesitás un entorno completamente
limpio para validar, o cuando el cambio tiene que ser atómico por corrección. Costo:
2× capacidad durante la transición, y todos se mueven de una.

Ojo que blue/green no elimina el problema de compatibilidad, solo lo mueve a la base
de datos, que igual es compartida por los dos entornos. Por eso expand/contract es
obligatorio sin importar la estrategia.

En la práctica: canary para cambios de aplicación, blue/green para cambios de
infraestructura o plataforma, y expand/contract para schema siempre.
</details>

<details>
<summary><b>3.</b> Tu canary muestra 0,1% más errores que el baseline. ¿Shippeás o abortás?</summary>

**Abortá, después investigá.** La asimetría de costos es decisiva: abortar cuesta una
hora de investigación; shippear una regresión real cuesta un incidente, y quizás
datos.

Pero primero verificá si la señal es real:
- **¿Es estadísticamente significativa?** Con 5% de tráfico durante 2 minutos podés
  tener 200 requests; 0,1% de eso es ruido, no señal. Calculá un intervalo de
  confianza o extendé la ventana de observación.
- **¿Son los *mismos* errores?** Un tipo de error nuevo es mucho más alarmante que un
  aumento leve de uno preexistente.
- **¿El baseline es concurrente?** Comparar el canary de ahora contra ayer confunde
  la versión con la hora del día, la mezcla de tráfico y la salud de las
  dependencias.
- **¿Lo causa el canary en sí?** Un cache frío, un pool de conexiones vacío o una
  fase de calentamiento del JIT pueden producir errores transitorios en cualquier
  instancia nueva.

Si persiste con una ventana más larga y baseline concurrente, abortá. "Es solo 0,1%"
es cómo te enterás después de que ese 0,1% era un cliente entero.
</details>

<details>
<summary><b>4.</b> Deployaste hace 30 minutos y los errores están subiendo. ¿Rollback o fix hacia adelante?</summary>

**Revertí primero, diagnosticá después.** La versión vieja es un estado conocido
bueno; un fix hacia adelante es código no verificado escrito bajo presión por alguien
estresado. Frená la hemorragia, después pensá.

El rollback *no* está disponible cuando:
- Ya corrió una migración irreversible (borraste una columna) — que es exactamente lo
  que previene expand/contract.
- La versión nueva escribió datos que la vieja no puede leer.
- Un sistema externo ya recibió algo que no podés retractar.

En esos casos estás en un incidente, no en un deploy, y el fix hacia adelante es el
único camino — con una vara mucho más alta de testeo antes de shippear.

**Después, la pregunta del postmortem no es "¿por qué estaba mal el código?" sino
"¿por qué el canary no lo agarró?"** Treinta minutos de errores subiendo significa o
que no había canary, o que la ventana de observación era muy corta, o que nadie
estaba mirando. Arreglá eso.
</details>

<details>
<summary><b>5.</b> Un compañero quiere dejar un feature flag "por las dudas, indefinidamente". Respondé.</summary>

Distinguí dos cosas.

**Los flags de operación / kill switches son legítimamente permanentes** —
"desactivar recomendaciones bajo carga", "apagar el reporte caro". Son controles
operativos con dueño claro y propósito documentado.

**Los flags de release tienen que morir.** Cada uno duplica un camino de código. Diez
flags son 1.024 combinaciones teóricas, y testeás quizás tres. Los caminos no testeados
son donde viven los bugs, y eventualmente alguien prende un flag viejo y descubre que
el código detrás dejó de funcionar hace ocho meses.

Entonces: ¿para qué es este flag? Si es "por si el código nuevo está mal", la
respuesta es que eso lo determinás durante el canary, no indefinidamente. Si es un
control operativo genuino, nombralo como tal, documentalo y dale un dueño.

Política práctica: los flags de release llevan fecha de vencimiento en el código
(`// EXPIRES: 2026-10-01`), una regla de lint rompe el build pasada esa fecha, y el
ticket para removerlo se crea cuando se crea el flag — no "después".
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| El reload de nginx no cambia el split | `docker exec lb nginx -t` primero — un error de sintaxis deja cargada la config vieja. |
| Las dos versiones reportan el mismo string de versión | `-ldflags -X main.version` requiere que la variable sea un `var` a nivel paquete en `main`, no una constante. |
| `CREATE INDEX CONCURRENTLY` falla | No puede correr dentro de una transacción. Si falla deja un índice INVALID — borralo y reintentá. |
| El backfill dispara alertas de lag de réplica | Lotes muy grandes o sin pausa. Reducí las dos cosas y mirá `pg_stat_replication`. |
| Los usuarios saltan entre versiones a mitad de sesión | La evaluación del flag no es pegajosa, o el LB no es consistente. Hasheá sobre un id de sujeto estable. |
| El rollback falla: imagen no encontrada | Solo etiquetaste `:latest`. Etiquetá con el SHA de git y conservá los artefactos. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(deploy): canary tooling, expand/migrate/contract, feature flags

Capsule 24. /version endpoint and SHA-tagged images. Weighted canary via
nginx with an automated abort script — a 30%-broken build showed as 3% of
traffic at a 10% canary. Full expand/migrate/contract column rename with a
batched, throttled backfill. Sticky percentage-based feature flags."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 24
```

**Siguiente:** [Cápsula 25 · Scouter Mk. II — Observabilidad y SLOs](../25-scouter-mk2-observability/README.md)
