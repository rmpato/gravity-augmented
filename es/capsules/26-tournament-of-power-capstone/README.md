# Cápsula 26 · El Torneo del Poder — El capstone

> *Todo, a la vez, con límite de tiempo, frente a jurados. Sin semillas del
> ermitaño, sin Esferas del Dragón, sin segundas oportunidades. Los peleadores que
> les va bien no son los que tienen la técnica individual más grande — son los que
> pueden leer la situación y elegir la movida correcta.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 10 | 2–3 horas (partilo) | Todo · opcional [B6 estimación](../bonus/B6-reading-power-levels-estimation/README.md) | Local |

---

## Por qué existe esta cápsula

Aprendiste veintiséis cosas. Acá es donde dejan de ser veintiséis cosas y se
convierten en una habilidad: **mirar un problema y saber cuál de ellas aplica.**

Esa habilidad es lo que evalúa una entrevista de system design y — más importante —
es lo que *es* la ingeniería senior. Nadie te va a pedir que implementes un anillo de
consistent hashing. Te van a preguntar por qué la página de checkout está lenta, y
vas a tener que saber si la respuesta es un índice, un cache, una cola, o una
frontera que está en el lugar equivocado.

No hay material nuevo acá. Es un ejercicio de diseño, un modelo de costos, un
análisis de fallas y un ensayo.

---

## El método

Usá esta estructura siempre. Es la misma contra la que puntúan los entrevistadores, y
es genuinamente cómo van las buenas conversaciones de diseño.

### 1. Requisitos (5 min) — nunca lo saltees

**Funcionales:** ¿qué tiene que hacer? Escribí 4–6 bullets. Listá explícitamente lo
que *no* estás construyendo.

**No funcionales — los números que realmente manejan el diseño:**

| Pregunta | Por qué lo cambia todo |
|---|---|
| ¿Cuántos usuarios? ¿DAU/MAU? | fija la escala de todo lo de abajo |
| ¿Ratio lectura:escritura? | 100:1 → caching y réplicas. 1:1 → el camino de escritura es el problema |
| ¿Objetivo de latencia, p99? | 50 ms y 2 s son arquitecturas distintas |
| ¿Requisito de consistencia? | fuerte vs eventual es la bifurcación más grande |
| ¿Objetivo de disponibilidad? | 99,9% vs 99,99% es una región vs multi-región |
| ¿Retención de datos? | 30 días vs para siempre cambia el nivel de almacenamiento |
| ¿Forma del tráfico? | estable vs pico de 100× a las 8 PM cambia el autoscaling |

**Preguntá sobre consistencia temprano.** Es la restricción que elimina más opciones,
y quien la pregunta tarde termina rediseñando.

### 2. Estimá (5 min)

De servilleta, en voz alta. Mirá
[B6](../bonus/B6-reading-power-levels-estimation/README.md) para los números que hay
que memorizar.

```
  DAU × actions/day / 86,400          = average QPS
  average QPS × peak factor (3-10×)   = peak QPS
  QPS × payload size                  = bandwidth
  records/day × size × retention      = storage
  QPS × latency (Little's Law)        = concurrency → instance count
```

Redondeá agresivamente. `86.400 ≈ 100.000`. Estás decidiendo entre "un servidor" y
"mil servidores", no entre 40 y 45.

### 3. API y modelo de datos (10 min)

Los endpoints, después el schema, y después — **y este es el paso que la gente
saltea** — los **patrones de acceso**. Los patrones de acceso determinan los índices,
que determinan la shard key, que determinan si tu diseño funciona o no.

### 4. Diseño de alto nivel (15 min)

Dibujá las cajas. Empezá con **lo más simple que podría funcionar** — un servicio,
una base de datos — y después agregá componentes *porque identificaste un cuello de
botella*, narrando por qué.

> Empezar con un diagrama lleno de Kafka y caches shardeados señala memorización.
> Empezar simple y hacerlo evolucionar bajo presión señala ingeniería.

### 5. Profundizar (15 min)

El entrevistador elige un área, o elegís vos la más riesgosa. Andá profundo: el
schema real, la clave de cache real, el modo de falla real.

### 6. Escala, fallas y costo (10 min)

- ¿Dónde se rompe con 10×? ¿Con 100×?
- ¿Qué pasa cuando muere cada componente?
- ¿Cuánto sale por mes, y por usuario?

El costo es la sección que casi nadie hace, y es la que hace creíble un diseño ante
cualquiera que tenga que aprobarlo.

---

## Parte A — diseñá el Scouter en serio

Ya lo construiste. Ahora diseñalo como si fuera para una empresa, a una escala que no
alcanzaste.

**El brief:**

> **PowerLevel.gg** — una plataforma donde los peleadores registran lecturas de nivel
> de pelea, ven leaderboards globales y por raza, siguen rivales y reciben
> notificaciones cuando alguien que siguen establece un récord.
>
> - 50 millones de usuarios registrados, 5 millones de DAU
> - Cada usuario activo registra ~10 lecturas/día
> - Cada usuario activo mira leaderboards ~30 veces/día
> - Global, con usuarios concentrados en NA (40%), EU (30%), APAC (30%)
> - Los leaderboards pueden estar hasta 10 segundos atrasados
> - Un usuario **siempre** tiene que ver su propia lectura de inmediato
> - Notificaciones dentro de 1 minuto
> - Lecturas retenidas para siempre; detalle crudo caliente por 90 días
> - El tráfico se triplica durante torneos programados

Escribí la respuesta en `docs/design/powerlevel-gg.md`. Hacé la estimación **antes**
de leer la solución de abajo.

### Planilla de estimación

```bash
python3 - <<'PY'
DAU              = 5_000_000
WRITES_PER_USER  = 10
READS_PER_USER   = 30
PEAK_FACTOR      = 5          # tournaments
SEC_PER_DAY      = 86_400

w = DAU * WRITES_PER_USER / SEC_PER_DAY
r = DAU * READS_PER_USER  / SEC_PER_DAY
print(f"writes: {w:>10,.0f} QPS avg   {w*PEAK_FACTOR:>10,.0f} QPS peak")
print(f"reads:  {r:>10,.0f} QPS avg   {r*PEAK_FACTOR:>10,.0f} QPS peak")
print(f"read:write ratio = {r/w:.0f}:1")

ROW = 64                                   # bytes per reading
daily = DAU * WRITES_PER_USER * ROW
print(f"\nstorage: {daily/1e9:.1f} GB/day  {daily*365/1e12:.2f} TB/year")
print(f"         {daily*365*5/1e12:.1f} TB after 5 years")

# Little's Law -> instances
LAT = 0.020                                 # 20ms p50
concurrency = (r + w) * PEAK_FACTOR * LAT
print(f"\nconcurrent requests at peak: {concurrency:,.0f}")
print(f"at 80 concurrent/instance:   {concurrency/80:,.0f} instances")
PY
```

```
writes:        579 QPS avg        2,894 QPS peak
reads:       1,736 QPS avg        8,681 QPS peak
read:write ratio = 3:1

storage: 3.2 GB/day  1.17 TB/year
         5.8 TB after 5 years

concurrent requests at peak: 231
at 80 concurrent/instance:   3 instances
```

**Leé esos números antes de diseñar.** No son lo que la mayoría supone.

- **3.000 escrituras/seg pico** entra cómodo en un primario de Postgres bien tuneado.
  **No necesitás shardear.** Decirlo en voz alta, con el número, es una señal fuerte.
- **9.000 lecturas/seg** es un problema de caching, no de base de datos.
- **1,2 TB/año** entra en una instancia por años. Particioná por mes (Cápsula 12) para
  retención, no para escala.
- **Tres instancias de aplicación** en el pico. Corré diez por redundancia y margen,
  no porque necesites la capacidad.

> La falla más común del capstone es diseñar para una escala que nadie pidió. La
> estimación es lo que te protege de eso.

### El diseño resuelto

```
                            users (NA / EU / APAC)
                                     │
                      ┌──────────────▼──────────────┐
                      │  Cloud CDN + Cloud Armor    │  C16, C08
                      │  leaderboards: s-maxage=10  │
                      │  stale-while-revalidate=60  │
                      └──────────────┬──────────────┘
                                     │  (~85% of reads never get past here)
                      ┌──────────────▼──────────────┐
                      │  Global external L7 LB      │  C07
                      │  TLS, anycast, health checks│
                      └───────┬─────────────┬───────┘
                              │             │
                     ┌────────▼───┐   ┌─────▼──────┐
                     │  web BFF   │   │ mobile BFF │  C23
                     └────────┬───┘   └─────┬──────┘
                              └──────┬──────┘
                    ┌────────────────┼────────────────┐
           ┌────────▼──────┐ ┌───────▼──────┐ ┌───────▼──────┐
           │ readings-api  │ │ ranking-api  │ │ social-api   │  C22
           │ (writes)      │ │ (reads)      │ │ (follows)    │
           └───┬───────┬───┘ └───┬──────┬───┘ └──────┬───────┘
               │       │         │      │            │
     ┌─────────▼──┐ ┌──▼─────────▼──┐ ┌─▼────────────▼───┐
     │ Cloud SQL  │ │  Memorystore  │ │   Cloud SQL      │
     │ HA primary │ │  Redis        │ │   (social)       │
     │ + 2 read   │ │  · ZSET ranks │ └──────────────────┘
     │   replicas │ │  · cache      │
     │ partitioned│ └───────────────┘
     └─────┬──────┘         ▲
           │ outbox (C21)   │
     ┌─────▼──────────────┐ │
     │  relay → Pub/Sub   │ │
     └─────┬──────────────┘ │
           │                │
    ┌──────▼──────┐  ┌──────┴───────┐  ┌──────────────┐
    │ ranker      │  │ notifier     │  │ BigQuery     │  C20
    │ (updates    │  │ (fan-out to  │  │ (analytics,  │
    │  ZSET)      │  │  followers)  │  │  90d+ cold)  │
    └─────────────┘  └──────────────┘  └──────────────┘
```

**El razonamiento, decisión por decisión — esto es lo que dirías en voz alta:**

| Decisión | Por qué | Cápsula |
|---|---|---|
| CDN delante de los leaderboards | 10 s de obsolescencia está permitido, así que ~85% de las 9k lecturas/seg nunca nos llegan. La ganancia individual más grande, un header | 16 |
| Sorted set de Redis para rankings | `ZREVRANGE` es O(log n + m) y se mantiene al escribir. Recomputar un top-100 desde 50M de filas por lectura no es viable | 14, 20 |
| Un primario de Postgres, **sin sharding** | 3k escrituras/seg entran cómodas. Shardear no compra nada y cuesta un trimestre | 10, 12 |
| Particionado mensual | Para retención (`DROP` de una partición) y tamaño de índice, no para escala de escritura | 12 |
| Read replicas para las queries de leaderboard | Las lecturas dominan; la obsolescencia es aceptable ahí | 13 |
| **Pinning read-your-writes** en las lecturas propias del usuario | El único requisito duro de consistencia del brief | 13 |
| Transactional outbox | Una lectura registrada nunca puede fallar en notificar. La doble escritura no es aceptable acá | 21 |
| Pub/Sub + consumidores idempotentes | Notificación y ranking son asincrónicos; los duplicados están garantizados | 18, 19 |
| Dos BFFs | Mobile necesita un payload chico de sparkline; web necesita el historial completo | 23 |
| Servicio `social` separado | Los follows tienen otro perfil de escala y otro equipo. **No** dividido por capa | 22 |
| BigQuery para analítica fría | Nunca corras agregaciones sobre el almacén OLTP | 20 |

### Modelo de costos

La sección que lo hace real:

```bash
python3 - <<'PY'
# Rough list prices, mid-2026, us-central1. One significant figure is the
# point — you are comparing designs, not writing an invoice.
items = [
  ("Cloud Run  (~10 instances avg, 1 vCPU / 512Mi)", 260),
  ("Cloud SQL HA  (4 vCPU / 16 GB, regional)",       580),
  ("Cloud SQL read replicas (2x)",                   440),
  ("Memorystore Redis Standard, 5 GB",               190),
  ("Global LB + Cloud Armor",                         45),
  ("Cloud CDN egress (~8 TB/mo)",                    640),
  ("Pub/Sub (~200 GB/mo)",                             8),
  ("BigQuery storage + queries",                      60),
  ("Cloud Logging (30 GB/mo over the free tier)",     15),
]
total = sum(v for _, v in items)
for name, v in items:
    print(f"{name:<48} ${v:>6,.0f}")
print(f"{'TOTAL':<48} ${total:>6,.0f} / month")
print(f"\nper DAU: ${total/5_000_000:.5f}/month  ${total*12/5_000_000:.4f}/year")
PY
```

```
Cloud Run  (~10 instances avg, 1 vCPU / 512Mi)   $   260
Cloud SQL HA  (4 vCPU / 16 GB, regional)         $   580
Cloud SQL read replicas (2x)                     $   440
Memorystore Redis Standard, 5 GB                 $   190
Global LB + Cloud Armor                          $    45
Cloud CDN egress (~8 TB/mo)                      $   640
Pub/Sub (~200 GB/mo)                             $     8
BigQuery storage + queries                       $    60
Cloud Logging (30 GB/mo over the free tier)      $    15
TOTAL                                            $ 2,238 / month

per DAU: $0.00045/month  $0.0054/year
```

Después contestá la pregunta que haría un CFO: **¿cuál es la línea más grande, y qué
harías al respecto?**

(Es el egress del CDN. Opciones: mejor compresión, payloads más chicos desde el BFF,
TTLs más largos, o un descuento por compromiso de egress. Fijate que tres de esas
cuatro son decisiones de *ingeniería*, que es por qué el costo pertenece a una
revisión de diseño.)

### Análisis de fallas

Para cada componente: qué pasa, qué ven los usuarios, qué hacés.

| Falla el componente | Impacto | Mitigación | Cápsula |
|---|---|---|---|
| Una instancia de app | ninguno | los health checks del LB la expulsan | 07 |
| Todas las instancias de una zona | ninguno | multi-zona, autoscaling | 06 |
| Redis | los rankings se recomputan desde Postgres; las lecturas se ponen lentas pero andan | circuit breaker + fall through | 14, 17 |
| Primario de Postgres | las escrituras fallan ~60 s | failover de Cloud SQL HA; las lecturas siguen desde réplicas | 13 |
| Una read replica | las lecturas se corren al primario | el LB la saca; el primario tiene que tener margen | 13 |
| Pub/Sub | notificaciones demoradas | los eventos están a salvo en el outbox; el relay se pone al día | 21 |
| Consumidor ranker | los rankings se ponen viejos | el backlog lo absorbe; alertá sobre la edad del más viejo sin ack | 18 |
| CDN | **6.7×** de carga en el origen (~1.300 → ~8.700 lecturas/seg) | **el riesgo honesto** — el origen tiene que aguantarlo, o descartar carga | 16, 17 |
| Una región | 30–40% de los usuarios afectados | aceptado con 99,9%; multi-región haría falta para 99,99% | — |
| Deploy malo | limitado al % del canary | traffic split + aborto automático | 24 |

**Nombrá el riesgo que estás aceptando.** "Una caída del CDN significa 6,7× de carga en
el origen, y dimensionamos para 2×; descartaríamos carga y serviríamos un leaderboard
degradado" es una respuesta mucho mejor que fingir que el CDN nunca falla.

### Escribilo

`docs/design/powerlevel-gg.md`, con estas secciones:

1. Requisitos (funcionales, no funcionales, no-objetivos explícitos)
2. Estimación (con la aritmética mostrada)
3. API + modelo de datos + patrones de acceso
4. Diagrama de arquitectura
5. Decisiones clave, cada una con la alternativa que rechazaste y por qué
6. Análisis de fallas
7. Modelo de costos
8. Qué se rompe con 10× y 100×, y qué cambiarías

---

## Parte B — tres más, cronometrados

45 minutos cada uno, en voz alta, pizarra o papel. **El límite de tiempo es parte del
ejercicio** — te fuerza a priorizar, que es la habilidad real.

### B1 · Un acortador de URLs

*"Diseñá un acortador de URLs. 100M de URLs nuevas/día, 10.000M de redirecciones/día."*

Prestá atención a: el ratio lectura:escritura (100:1 — esto es un problema de caching
y CDN); la generación de claves (contador+base62 vs hash vs pool pre-generado — y por
qué un hash aleatorio necesita manejo de colisiones); por qué esto es un problema
**clave-valor**, no relacional; el trade-off 301 vs 302 (301 lo cachea el navegador
para siempre, así que perdés analítica *y* la capacidad de cambiar el destino);
aliases custom y la carrera entre dos usuarios reclamando uno.

### B2 · Un rate limiter como servicio

*"Diseñá un rate limiter distribuido usado por 500 servicios."*

Prestá atención a: la elección de algoritmo y por qué (Cápsula 17); dónde vive el
estado (Redis vs local vs híbrido); el trade-off precisión-latencia (un chequeo
sincrónico a Redis agrega un round trip a cada request); **qué pasa cuando el limiter
está caído** (fallar abierto o cerrado — y la respuesta difiere entre protección
contra abuso y facturación); claves calientes; y el truco que la mayoría se pierde —
buckets *locales* rellenados periódicamente desde una autoridad central, dándote
límites globales aproximados con cero latencia por request.

### B3 · Un sistema de notificaciones

*"Diseñá notificaciones: push, email, SMS. 100M de usuarios, 1.000M de
notificaciones/día."*

Prestá atención a: fan-out al escribir vs al leer (Cápsula 20); preferencias por
usuario y horarios de silencio; deduplicación y rate limiting *por usuario* (nadie
quiere 400 pushes); falla de proveedor y fallback entre canales; colas prioritarias
para que un reseteo de contraseña no quede atrás de una campaña de marketing; el
pipeline de templates/renderizado; e idempotencia, porque mandar una notificación dos
veces es muy visible.

---

## Parte C — el ensayo

La parte que la gente saltea, y la que realmente importa en una entrevista.

1. **Elegí un diseño. Explicalo en voz alta por 20 minutos. Grabate.**
2. Miralo. Vas a notar: muletillas, saltar a soluciones antes de los requisitos, y los
   lugares donde estás vago porque en realidad no sabés.
3. **Contestá estas cinco, en voz alta:**
   - "¿Por qué no usar Kafka acá?"
   - "¿Y si la consistencia tuviera que ser fuerte?"
   - "Esto cuesta USD 2.000/mes. Bajalo a la mitad."
   - "Son las 3 de la mañana y el p99 es 8 segundos. Recorreme los primeros diez
     minutos."
   - "¿Cuál es la parte más débil de este diseño?"

Esa última es la más importante. **Alguien que nombra el punto más débil de su propio
diseño es mucho más convincente que alguien que defiende todo.** Los ingenieros
senior saben dónde están enterrados los cuerpos en sus propios sistemas.

---

## La autoevaluación

Puntuate honestamente, 1–5. Cualquier cosa por debajo de 3 se relee.

| | Cápsula | Puntaje |
|---|---|---|
| Puedo containerizar un servicio y explicar cada línea del Dockerfile | 02 | |
| Puedo ubicar cualquier servicio de GCP en el espectro de cómputo/datos | 04 | |
| Puedo explicar cuándo el vertical scaling es la respuesta correcta | 05 | |
| Puedo encontrar dónde se esconde el estado en un servicio | 06 | |
| Puedo explicar L4 vs L7 y por qué gRPC necesita L7 | 07 | |
| Sé qué va en un gateway y qué no | 08 | |
| Puedo leer un load test y encontrar la rodilla | 09 | |
| Puedo diagnosticar agotamiento de pool por los síntomas | 10 | |
| Puedo leer `EXPLAIN ANALYZE` y elegir un índice | 11 | |
| Puedo argumentar *en contra* de shardear con números | 12 | |
| Puedo explicar los bugs de lag de replicación y sus cuatro soluciones | 13 | |
| Puedo diseñar un cache que degrada en vez de fallar | 14 | |
| Puedo nombrar y arreglar una estampida, una penetración y una clave caliente | 15 | |
| Puedo escribir `Cache-Control` correcto para cualquier endpoint | 16 | |
| Puedo explicar cómo una dependencia lenta tira abajo un servicio | 17 | |
| Puedo elegir entre Pub/Sub, Cloud Tasks y Kafka | 18 | |
| Puedo hacer idempotente cualquier consumidor | 19 | |
| Puedo elegir batch vs stream a partir del requisito de latencia | 20 | |
| Puedo implementar un transactional outbox y decir por qué | 21 | |
| Puedo argumentar *en contra* de microservicios con la matemática de disponibilidad | 22 | |
| Sé cuándo un BFF se gana su salto | 23 | |
| Puedo hacer expand/migrate/contract sin downtime | 24 | |
| Puedo definir un SLO y una política de error budget | 25 | |
| Puedo estimar la escala y el costo de un sistema en 10 minutos | 26 | |

---

## Y ahora qué

**El repo está terminado. El entrenamiento no.**

Movidas concretas siguientes, en orden de valor:

1. **Deployá `gravity-chamber` de verdad** y corrélo un mes. Poné un SLO. Miralo
   romperse. Nada en este repo enseña tanto como ser dueño de algo que está vivo.
2. **Escribí un postmortem** de algo que se rompió — aunque sea un incidente a escala
   de laptop. El formato es una habilidad.
3. **Elegí una cápsula y andá tres niveles más profundo.** Leé el código fuente del
   planificador de queries de Postgres. Implementá Raft. Leé los papers de Dynamo,
   Spanner y Bigtable.
4. **Enseñale una de estas a un compañero.** Vas a descubrir exactamente qué partes
   solo *creés* que entendés.
5. **Hacé el Arco de Relleno** si no lo hiciste — es cómo pasás los 9000.

**Los libros que valen el tiempo:**
- *Designing Data-Intensive Applications*, Kleppmann — el mejor libro de sistemas que
  hay. Cada cápsula de la Saga 2 es una versión superficial de uno de sus capítulos.
- *Site Reliability Engineering* (Google, gratis online) — la Cápsula 25 en
  profundidad.
- *Release It!*, Nygard — la Cápsula 17 como libro entero.
- *Building Microservices*, Newman — la Cápsula 22 hecha en serio.

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "docs(design): powerlevel.gg capstone design

Capsule 26. Full design with estimation, cost model and failure analysis.
Notable conclusion: at 3k writes/sec peak, sharding is unnecessary — the
estimate is what prevented over-engineering."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 26
./bin/scouter status
```

```
  POWER LEVEL  9000 / 9000
  ========================================  100%

  WHAT?! 9000?!
  The main arc is done. The Filler Arc takes you over.
```

**El Arco de Relleno:** [`capsules/bonus/`](../bonus/) — diez cápsulas opcionales,
150 cada una, y la única forma de pasar los 9000.
