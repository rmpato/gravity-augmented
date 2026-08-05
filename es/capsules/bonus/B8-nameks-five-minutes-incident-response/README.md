# Cápsula B8 · Los cinco minutos de Namek — Respuesta a incidentes y postmortems

> *"Namek va a explotar en cinco minutos."* Namek después tardó **diez
> episodios** en explotar. Esta es la representación más precisa de la respuesta
> a incidentes que se haya emitido jamás: el ETA está mal, todos gritan, y los
> que realmente ayudan son los que dejan de entrar en pánico y empiezan a hacer
> una cosa útil a la vez.

| Power level | Tiempo | Prerrequisitos | Mejor después de |
|---|---|---|---|
| Bonus · 150 | 75 min | Cápsulas 13, 17, 25 | Cápsula 25 |

---

## Por qué existe esta cápsula

Todo el arco principal hace que tu sistema sea *menos probable* de romperse.
Nada de eso lo hace irrompible, y la diferencia entre un buen ingeniero y uno
excelente se ve sobre todo durante los treinta minutos en que **sí** está roto.

Esa habilidad casi nunca se enseña. La gente la aprende estando de guardia y
pasándola mal, lo que produce los dos modos de falla más comunes:

- **El héroe** — se mete en la base de datos, lo arregla solo, no le cuenta a
  nadie, y la organización no aprende nada.
- **El conejo** — se pasa 40 minutos buscando la *causa raíz* mientras los
  usuarios siguen caídos, porque diagnosticar se siente como progreso.

Los dos son el mismo error: confundir "entender el problema" con "terminar el
impacto". Esta cápsula es sobre lo segundo.

---

## El lore

Los cinco minutos de Namek son un chiste recurrente, pero mirá lo que realmente
pasa en ese planeta. Goku no investiga la inestabilidad del núcleo. No pregunta
por qué. Saca a todos del planeta, y *después* se ocupa de Frieza.

**Evacuá primero. Entendé después.** Esa es toda la cápsula.

---

## La única regla

> **Mitigá antes de diagnosticar.**

Si no te llevás nada más: cuando suena el pager, tu trabajo no es descubrir qué
está mal. Tu trabajo es hacer que el impacto pare. Son trabajos distintos y
muchas veces tienen respuestas distintas.

| Diagnóstico | Mitigación |
|---|---|
| "El query plan cambió después del update de estadísticas" | revertí el deploy |
| "Hay un goroutine leak en el camino de reintentos" | reiniciá los pods, después limitá la concurrencia |
| "El cache está thrashing porque el jitter del TTL está mal" | subí el TTL, o saltá el cache |
| "Un cliente manda 40k QPS desde una sola key" | ponele rate limit a esa key |

La columna derecha suele ser **más rápida, más segura y reversible**. La columna
izquierda es lo que escribís mañana.

El corolario que a la gente le cuesta aceptar: **tenés permitido arreglar un
incidente sin llegar a descubrir jamás qué lo causó.** Lo que no tenés permitido
es *cerrarlo* así — pero terminar el impacto a las 03:10 y entenderlo a las
11:00 es una buena noche.

---

## Severidad, y por qué no es una sensación

La severidad decide a quién despertás. Si es una cuestión de criterio, se va a
discutir a las 3am entre gente que a las 3am discute mal. Escribila en vez de
eso.

| Sev | Significa | Respuesta | Ejemplo |
|---|---|---|---|
| **1** | Caída total, o pérdida/corrupción de datos | Page inmediato, todos, comunicación a dirección | Escrituras fallando globalmente; el leaderboard sirviendo datos de otro usuario |
| **2** | Degradación grave, el SLO se quema rápido | Page al on-call | p99 5× lo normal; una región caída; el error budget se acaba en un día |
| **3** | Menor o con workaround | Al día hábil siguiente | Un endpoint no crítico degradado; una réplica con lag |
| **4** | Cosmético, sin impacto al usuario | Backlog | Un dashboard está mal |

Dos reglas que evitan discusiones:

- **Pérdida de datos o un problema de seguridad es Sev 1 sin importar a cuán
  poca gente toque.** El volumen es el eje equivocado para esos casos.
- **Cualquiera puede subir la severidad; solo el incident commander la baja.**
  Si no, nadie escala, porque dar una falsa alarma se siente peor que estar
  calladamente equivocado.

---

## Roles — incluso cuando sos solo vos

A las 3am con una sola persona, "roles" suena a burocracia. No lo es; es una
checklist de tareas que igual hay que hacer.

| Rol | Se hace cargo de | La falla si no está |
|---|---|---|
| **Incident Commander** | decisiones, severidad, quién hace qué | cinco personas investigando la misma teoría, nadie mitigando |
| **Ops / manos en el teclado** | correr los comandos posta | el IC se absorbe en una terminal y deja de coordinar |
| **Comunicación** | status updates, stakeholders | entra un directivo a la llamada y vuelve a preguntar todo, perdiendo 10 minutos |
| **Escriba** | la línea de tiempo en el canal | el postmortem se escribe de memoria, y la memoria es ficción |

**El IC no tipea.** En el momento en que el comandante está en una terminal, no
hay comandante. Si estás solo, sos los cuatro — y la forma práctica de eso es:
narrá lo que estás haciendo en el canal del incidente mientras lo hacés. Ese
único hábito te da comunicación y escriba gratis, y es cómo alguien que se suma
en el minuto 12 se pone al día sin interrumpirte.

---

## Los primeros cinco minutos

En orden. No te saltees pasos porque creés que ya sabés qué es.

```
1. DECLARE.   Open a channel. Say "I am IC for <thing>." Even alone. Even if
              you're not sure it's real. Un-declaring is cheap.

2. ASSESS.    Who is affected, how badly, since when? One sentence.
              Check: is it all users, one region, one endpoint, one customer?

3. STABILISE. Is there a rollback? Take it. Was there a deploy or a config
              change in the last hour? That's your first suspect, always.
              Feature flag off > rollback > scale up > everything else.

4. COMMUNICATE. First update within 5 minutes, even with nothing to report.
              "Investigating elevated errors on X, next update in 15 min"
              is a complete and useful status update.

5. THEN diagnose.
```

El paso 3 merece énfasis. **El último cambio es el primer sospechoso** — no
porque los ingenieros sean descuidados, sino porque es la única variable que se
movió. Un sistema que anduvo bien seis semanas y se rompió cuatro minutos
después de un deploy no es una casualidad, y "pero ese cambio no tenía nada que
ver" es la frase más cara de la respuesta a incidentes.

### Escribir un status update cuando no sabés nada

La falla de comunicación más común es el silencio mientras esperás tener algo
que valga la pena decir. Nunca lo vas a tener. Un buen update tiene cuatro
partes y lleva 20 segundos:

```
IMPACT   Leaderboard reads are failing for ~30% of users since 14:05 UTC.
         Writes are unaffected.
STATUS   Investigating. We rolled back deploy #4412 at 14:12; no improvement yet.
NEXT     Checking Redis connection saturation.
ETA      Next update by 14:35.
```

Fijate que no hay ETA *de resolución*. Nunca des uno — no lo tenés, y uno que no
cumplís cuesta más confianza que el silencio. Comprometete al próximo **update**
en su lugar. Esa es una promesa que siempre podés cumplir.

---

## Lab — corré un incidente de verdad

Leer sobre esto no sirve de nada. Necesitás el pequeño pico de adrenalina de un
sistema que está roto mientras corre un cronómetro.

### Paso 1 — el script de caos

**`scripts/chaos.sh`**

```bash
#!/usr/bin/env bash
# Picks one failure at random and applies it. Do NOT read the case statement
# before you run it — the whole point is that you don't know what you did.
#
#   ./scripts/chaos.sh          break something
#   ./scripts/chaos.sh reset    put everything back
set -euo pipefail
cd "$(dirname "$0")/../deploy"

if [ "${1:-}" = "reset" ]; then
  # ALTER SYSTEM persists in postgresql.auto.conf, so undo it explicitly before
  # recreating — `up --force-recreate` alone keeps the volume and the setting.
  docker compose start postgres >/dev/null 2>&1 || true
  sleep 3
  docker compose exec -T postgres psql -U scouter -d scouter \
    -c "ALTER SYSTEM RESET max_connections;" >/dev/null 2>&1 || true
  docker compose start redis >/dev/null 2>&1 || true
  docker compose exec -T redis redis-cli CONFIG SET maxmemory 0 >/dev/null 2>&1 || true
  docker compose up -d --force-recreate >/dev/null 2>&1 || true
  echo "restored."
  exit 0
fi

# Every branch ends in `|| true`. Without it, `set -e` kills the script the
# moment a command touches a container a PREVIOUS run already stopped — so the
# script would exit silently having done nothing, which is a confusing way to
# start an incident drill.
case $((RANDOM % 5)) in
  0) docker compose stop redis >/dev/null 2>&1 || true ;;
  1) docker compose exec -T postgres psql -U scouter -d scouter \
       -c "ALTER SYSTEM SET max_connections = 3;" >/dev/null 2>&1 || true
     docker compose restart postgres >/dev/null 2>&1 || true ;;
  2) docker compose exec -T redis redis-cli CONFIG SET maxmemory 1mb >/dev/null 2>&1 || true ;;
  3) docker compose stop postgres >/dev/null 2>&1 || true ;;
  4) : ;;   # nothing is wrong. This case exists on purpose — see Step 4.
esac
echo "chaos applied at $(date -u +%H:%M:%S)Z"
```

```bash
chmod +x scripts/chaos.sh
```

### Paso 2 — levantalo, después rompelo

```bash
cd ~/repos/pato/gravity-chamber
docker compose -f deploy/docker-compose.yml up -d
sleep 10

# generate steady traffic in one terminal and LEAVE IT RUNNING
while true; do
  curl -s -o /dev/null -w "%{http_code} %{time_total}\n" localhost:8080/fighters/goku
  sleep 0.5
done
```

En una segunda terminal:

```bash
./scripts/chaos.sh
```

### Paso 3 — corré el drill, en voz alta, contra reloj

Arrancá un cronómetro. Abrí `NOTES.md` y escribí a medida que avanzás — este es
tu registro de escriba. La regla: **no podés correr un comando hasta haber
escrito por qué.**

```
T+0    DECLARE   I am IC. Symptom:
T+?    ASSESS    Impact:                    Scope:
T+?    STABILISE Tried:                     Result:
T+?    UPDATE    (write the 4-line status block)
T+?    MITIGATED Impact ended at:
T+?    CAUSE     (only now)
```

Dos cosas para notar sobre vos mismo:

- ¿Cuánto tardaste en escribir una declaración de impacto? Si arrancaste
  corriendo comandos, hiciste lo normal y lo equivocado.
- ¿Fuiste a `docker compose logs`, o a `/metrics` y `/readyz`? La Cápsula 25
  existe para que lo segundo sea más rápido. Si no lo fue, tu instrumentación
  todavía no es suficiente — y eso es un hallazgo.

Después:

```bash
./scripts/chaos.sh reset
```

Correlo tres veces más. Las fallas se repiten, y está bien: la segunda vez que
te cruzás la misma falla deberías ser *mucho* más rápido, y notar eso es el
punto.

### Paso 4 — el caso donde no hay nada roto

Uno de los cinco resultados no rompe absolutamente nada.

Si "encontraste" una causa durante esa corrida, acabás de experimentar lo más
peligroso de la respuesta a incidentes: **un sistema bajo escrutinio siempre
parece culpable.** Todo servicio tiene una línea de log que asusta, un gráfico
con picos, una query lenta. Bajo presión tu cerebro va a promover una a villano
con toda la alegría del mundo.

La defensa es una sola pregunta, dicha en voz alta, antes de actuar sobre
cualquier teoría:

> **¿Esto explica el síntoma, el timing Y el alcance?**

Un warning de Redis que aparece cada hora desde hace tres semanas no explica algo
que arrancó a las 14:05. El timing es la prueba más barata que tenés y mata la
mayoría de las pistas falsas gratis.

---

## El postmortem

Escribí uno por cada Sev 1 y Sev 2, dentro de las 48 horas mientras la memoria
todavía sirve. Ponelo en el repo: `docs/incidents/YYYY-MM-DD-nombre-corto.md`.

**`docs/incidents/2026-08-05-leaderboard-outage.md`**

```markdown
# 2026-08-05 · Leaderboard reads failing

**Severity:** 2 · **Duration:** 14:05–14:41 UTC (36 min) · **Author:** you
**Status:** action items open

## Impact
~30% of leaderboard reads returned 500 for 36 minutes. Writes unaffected.
No data lost. 41 minutes of error budget consumed (of 43/month).

## Timeline (UTC)
| Time | Event |
|---|---|
| 14:02 | Deploy #4412 (cache TTL change) reaches 100% |
| 14:05 | Error rate crosses 5%. **Nobody paged — see AI-2** |
| 14:14 | Reported by a user in #support |
| 14:16 | Incident declared, Sev 2 |
| 14:22 | Rolled back #4412. No improvement — cache already cold |
| 14:33 | Raised Redis maxmemory; errors began falling |
| 14:41 | Error rate normal. Impact ends |
| 15:20 | Root cause confirmed |

## What happened
The TTL change reduced effective cache lifetime by ~90%, raising Redis memory
churn past `maxmemory`. Evictions caused a stampede onto Postgres, which
saturated its connection pool, which failed leaderboard reads.

## Why it wasn't caught
Staging has 1/1000th of the key volume, so the memory ceiling was never
approached there.

## What went well
- The circuit breaker (Capsule 17) kept `/fighters/{name}` serving throughout.
  Only the leaderboard was affected — the blast radius held.

## What went badly
- **9 minutes of undetected impact.** A user told us, not the alert.
- The rollback was assumed to be the fix. It wasn't, and we waited 11 minutes
  on it before trying anything else.

## Contributing factors
1. No alert on Redis eviction rate.
2. Staging is not representative in the one dimension that mattered.
3. Rollback was treated as a diagnosis rather than a hypothesis to test.

## Action items
| # | Action | Owner | Due | Status |
|---|---|---|---|---|
| AI-1 | Alert on `redis_evicted_keys_total > 0` | you | 2026-08-12 | open |
| AI-2 | Page on error rate > 2% for 2 min | you | 2026-08-08 | open |
| AI-3 | Load staging to 10% of prod key volume | you | 2026-08-30 | open |
```

### Las tres reglas de un postmortem

**1. Sin culpa — y sé preciso sobre qué significa eso.** No significa "sin
nombres". Significa que la pregunta nunca es *quién* sino *qué hizo que esto
fuera lo razonable de hacer*. "Ana deployó sin chequear la memoria de staging"
es culpa. "Nuestra checklist de deploy no menciona el margen de memoria, y
staging no podría haberlo mostrado igual" es un hallazgo que podés arreglar. La
prueba: ¿podría una persona competente y cuidadosa haber cometido este error? Si
la respuesta es sí — y casi siempre lo es — el problema es el sistema.

**2. "Factores contribuyentes", no "causa raíz".** La causa raíz singular es una
ficción reconfortante. La caída de arriba necesitó un cambio de TTL *y* un techo
de memoria bajo *y* un staging no representativo *y* una alerta faltante. Sacá
cualquiera de esos y no hay incidente. Elegir uno para que sea La Causa
significa que tapás uno de cuatro agujeros y te sentís terminado.

**3. Un action item sin dueño y sin fecha es un deseo.** Limitate a 3–5. Diez
action items significa que ninguno se hace y todos aprenden que los postmortems
son teatro. Menos, reales, con seguimiento.

---

## Guardias, de forma sostenible

- **Un pager que suena por cosas sobre las que no podés actuar va a ser
  ignorado**, incluso cuando tiene razón. Cada alerta necesita una acción
  documentada; si la acción es "mirarlo a ver", es un dashboard, no una alerta.
- **Alertá sobre síntomas, no sobre causas** (Cápsula 25). "Error rate > 2%"
  sobrevive a una re-arquitectura. "Redis CPU > 80%" queda obsoleta el día que
  pasás a Memorystore, y suena cuando no pasa nada.
- **Toda página debería tener un link al runbook en la alerta misma.** A las 3am
  tu razonamiento es mediblemente peor; un link le gana a la memoria.
- **Llevá registro de las páginas que no produjeron ninguna acción.** Una rota
  donde la mitad de las páginas fue ruido es una rota de la que la gente se va.
- **El que estuvo de guardia a la noche no trabaja al día siguiente.** No es un
  favor — es recuperación.

---

## Llevátelo al trabajo

- **El primer status update es lo de mayor apalancamiento que vas a hacer**, y
  lo podés mandar antes de entender nada. Impacto / estado / siguiente / próximo
  update.
- **"¿Qué cambió?" responde la mayoría de los incidentes.** Hacé que los deploys
  y los cambios de configuración sean visibles en la misma línea de tiempo que
  tus métricas y lo tenés gratis.
- **Preguntá "¿esto explica el síntoma, el timing Y el alcance?"** en voz alta.
  Mata pistas falsas gratis y se contagia para bien.
- **Un postmortem que nadie lee igual vale la pena escribirlo** — pero uno con
  tres action items con dueño y fecha vale por diez de esos.

---

## Battle drill

<details>
<summary><b>1.</b> Van 25 minutos, la caída sigue, y tenés una teoría fuerte pero ninguna prueba. ¿Qué hacés?</summary>

Mitigá sobre la teoría si la mitigación es barata y reversible, y decí en voz
alta que es una corazonada. "Reiniciando los pods; esto es una hipótesis, no un
diagnóstico" es una jugada legítima — cuesta 30 segundos y podría terminar el
impacto.

Lo que no podés hacer es pasar otros 20 minutos juntando pruebas mientras los
usuarios están caídos. Las pruebas son el trabajo de mañana. La asimetría es el
punto: una mitigación barata equivocada cuesta segundos; 20 minutos más de caída
te cuestan el error budget.
</details>

<details>
<summary><b>2.</b> Tu rollback no lo arregló. ¿Qué te dice eso?</summary>

Menos de lo que la gente asume. Tres posibilidades, y todavía no las podés
distinguir:

1. El deploy no era la causa.
2. El deploy *sí* era la causa pero el daño persiste — un cache envenenado, una
   fila corrupta, una cola llena, un cache frío que ahora no puede calentarse.
3. El rollback no se aplicó del todo (una flota drenada a medias, una config
   cacheada).

El instinto — "el rollback falló, así que el deploy queda exculpado" — está mal
lo bastante seguido como para ser peligroso. Verificá que el rollback realmente
haya aterrizado (`/version`, Cápsula 24), y después mantené el deploy en la lista
de sospechosos.
</details>

<details>
<summary><b>3.</b> ¿Por qué el incident commander no toca el teclado?</summary>

Porque tipear absorbe. En el momento en que estás en una terminal dejás de
seguir quién hace qué, dejás de notar que hace 20 minutos que no sale
comunicación, y dejás de escuchar a la persona que tiene la respuesta.

Solo no lo podés evitar — así que narrá en su lugar. Escribir "probando X porque
Y" en el canal antes de cada comando mantiene despierta la mitad coordinadora de
tu cerebro, y te escribe la línea de tiempo del postmortem sola.
</details>

<details>
<summary><b>4.</b> Un postmortem tiene 14 action items. ¿Qué está mal?</summary>

Ninguno se va a hacer. Catorce es una lista de deseos producida por una sala
tratando de demostrar que se tomó el incidente en serio.

Elegí los 3 que realmente habrían prevenido o acortado *este* incidente, dales
dueño y fecha, y mandá el resto al backlog, que es donde van. La credibilidad de
toda la práctica depende de que los action items sean reales, porque la primera
vez que un equipo ve los del trimestre pasado todavía abiertos, los postmortems
se vuelven papeleo.
</details>

<details>
<summary><b>5.</b> No hay nada roto, pero tu dashboard tiene un panel en rojo y una línea de log que asusta. ¿Esto es un incidente?</summary>

Todavía no. Un incidente se define por **impacto al usuario**, no por una cosa
roja.

La trampa es la inversa de la habitual: bajo escrutinio todo sistema parece
culpable, y si salís a buscar un villano lo vas a encontrar. Preguntate si
explica un síntoma que los usuarios estén experimentando de verdad. Si no hay
síntoma, tenés un hallazgo de monitoreo, no un incidente — registralo, ajustá la
alerta, y volvé a dormir.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `chaos.sh` parece no hacer nada | Uno de los cinco resultados es inofensivo a propósito. Eso es el Paso 4. |
| No podés resetear limpio | `docker compose down -v && docker compose up -d`. `ALTER SYSTEM` persiste en `postgresql.auto.conf`, así que `-v` es la solución segura. |
| El cambio de `max_connections` no se aplicó | Necesita un restart, no un reload. El script reinicia; si lo corriste a mano, `docker compose restart postgres`. |
| El loop de tráfico muestra `000` | curl no pudo ni conectarse — el servicio está caído, no lento. Esa distinción ya es un diagnóstico en sí. |
| No podés saber cuándo empezó el impacto | Ese es el hallazgo. Necesitás las métricas RED de la Cápsula 25 y un marcador de deploy en la misma línea de tiempo. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done B8
```

**Siguiente:** [B9 · El hechizo de Babidi — Seguridad más allá de auth](../B9-babidis-spell-security/README.md)
