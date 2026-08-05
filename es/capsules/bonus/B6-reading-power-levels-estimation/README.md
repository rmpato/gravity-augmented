# Cápsula B6 · Leer Niveles de Pelea — Estimación de servilleta

> *"Es más de 9000" es una frase de ingeniería pésima. Te dice la escala y nada más.
> Pero es el instinto correcto: Vegeta necesitaba un número, rápido, para decidir si
> pelear o correr. Esa decisión no necesita tres cifras significativas.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 65 min | ninguno | Cápsula 26 |

---

## Por qué existe esta cápsula

"¿Cuántos servidores necesitamos?" es una pregunta que congela a mucha gente de
ingeniería, y no debería. La respuesta es aritmética que podés hacer en una servilleta
en cinco minutos, y poder hacerla cambia lo que construís.

Es la diferencia entre "deberíamos shardear" (un trimestre de trabajo, basado en una
sensación) y "3.000 escrituras/seg entran en un primario de Postgres, así que no lo
vamos a hacer" (una decisión, basada en un número).

También es la parte de una entrevista de system design donde más visiblemente se
separan los candidatos.

---

## Las reglas

**1. Redondeá agresivamente.**

```
  86,400 seconds/day  →  100,000  (call it 10⁵)
  1 year              →  30M seconds ≈ 3 × 10⁷
  1 million           →  10⁶ ; 1 billion → 10⁹
```

Usar 100.000 en vez de 86.400 introduce un error del 16%. Estás decidiendo entre "un
servidor" y "cien servidores" — 16% es irrelevante, y el número redondo te deja hacerlo
mentalmente.

**2. Potencias de dos para datos.**

```
  2¹⁰ = 1 thousand   (KB)
  2²⁰ = 1 million    (MB)
  2³⁰ = 1 billion    (GB)
  2⁴⁰ = 1 trillion   (TB)
```

**3. Enunciá tus supuestos en voz alta.** El número no vale nada sin ellos, y en una
entrevista los supuestos son lo que realmente se está evaluando.

**4. Verificá contra algo que conozcas.** "Eso son 40 TB/día — más que todo el firehose
de Twitter. Me equivoqué en algún lado."

---

## Los números para memorizar

### Latencia (de la Cápsula B2)

```
  L1 cache                    0.5 ns
  Main memory               100 ns
  SSD random read           150 µs
  Datacenter round trip     500 µs
  Disk seek (spinning)       10 ms
  US → EU round trip         150 ms
```

### Throughput, orden de magnitud

| Componente | Capacidad aproximada |
|---|---|
| Un core de CPU moderno | ~10⁹ operaciones simples/seg |
| Postgres, lecturas indexadas simples | 10k–50k QPS |
| Postgres, escrituras (un primario) | 5k–20k/seg |
| Redis, una instancia | 100k+ ops/seg |
| Una instancia de servicio Go/Java | 1k–10k RPS (limitado por E/S) |
| Nginx / reverse proxy | 50k+ RPS |
| Un broker de Kafka | 100k+ msg/seg |
| Red de 1 Gbps | 125 MB/seg |
| Red de 10 Gbps | 1,25 GB/seg |
| SSD NVMe | 1–7 GB/seg, 100k+ IOPS |

**Estos son números de orden de magnitud.** Su valor es decirte si estás al 10% o al
1000% de la capacidad de un componente.

### Tamaños

```
  UUID                 16 bytes (36 as a string — this matters at scale)
  int64 / timestamp     8 bytes
  A typical DB row     100 bytes – 1 KB
  A tweet-sized text   ~300 bytes
  A small JSON API response  1–10 KB
  A web page (HTML)    50–100 KB
  A compressed image   200 KB – 2 MB
  1 min of 1080p video ~50 MB
```

---

## Las fórmulas

```
  ── TRAFFIC ────────────────────────────────────────────────
  avg QPS   = DAU × actions_per_day / 100,000
  peak QPS  = avg QPS × peak_factor        (2–10×; 3× is a good default)
  bandwidth = QPS × avg_response_size

  ── STORAGE ────────────────────────────────────────────────
  daily     = writes_per_day × bytes_per_record
  total     = daily × retention_days × replication_factor
  + indexes (roughly +30–100% of table size)
  + overhead, WAL, backups (call it ×1.5 overall)

  ── COMPUTE (Little's Law) ─────────────────────────────────
  concurrency = QPS × latency_seconds
  instances   = concurrency / concurrency_per_instance
  → then double it for redundancy and headroom

  ── CACHE ──────────────────────────────────────────────────
  hot set   = daily_active_items × item_size
  (the 80/20 rule: 20% of items usually serve 80% of requests)

  ── COST, very rough ───────────────────────────────────────
  1 vCPU · 1 month           ≈ $25
  1 GB RAM · 1 month         ≈ $3
  1 GB SSD · 1 month         ≈ $0.20
  1 GB egress to internet    ≈ $0.10
  1 GB object storage/month  ≈ $0.02
```

**El egress es la línea que sorprende a la gente.** Frecuentemente es el costo
individual más grande en un sistema de cara al consumidor, y es invisible hasta que
llega la factura.

---

## Ejemplo resuelto 1 — timelines a escala Twitter

> *"Diseñá Twitter. 300M de MAU."*

```bash
python3 - <<'PY'
MAU          = 300_000_000
DAU          = MAU * 0.5              # assumption: 50% daily
TWEETS_USER  = 0.5                    # most users read, few write
READS_USER   = 50                     # timeline refreshes
SEC_PER_DAY  = 100_000                # rounded from 86,400

writes = DAU * TWEETS_USER / SEC_PER_DAY
reads  = DAU * READS_USER  / SEC_PER_DAY
print(f"writes  {writes:>10,.0f} QPS   peak {writes*3:>10,.0f}")
print(f"reads   {reads:>10,.0f} QPS   peak {reads*3:>10,.0f}")
print(f"ratio   {reads/writes:.0f}:1  <-- THE number that drives the design\n")

TWEET = 300                            # bytes
daily = DAU * TWEETS_USER * TWEET
print(f"storage {daily/1e9:>8.1f} GB/day  {daily*365/1e12:>6.1f} TB/year")
print(f"        {daily*365*10/1e12:>8.1f} TB over 10 years (before replication)\n")

# fan-out on write: the number that decides the architecture
FOLLOWERS = 200                        # median, NOT mean
print(f"fan-out writes: {writes*FOLLOWERS:>12,.0f}/sec at {FOLLOWERS} followers")
print(f"celebrity (50M followers): {50_000_000:,} writes for ONE tweet")
PY
```

```
writes         750 QPS   peak      2,250
reads       75,000 QPS   peak    225,000
ratio   100:1  <-- THE number that drives the design

storage     22.5 GB/day     8.2 TB/year
             82.1 TB over 10 years (before replication)

fan-out writes:      150,000/sec at 200 followers
celebrity (50M followers): 50,000,000 writes for ONE tweet
```

**Lo que te dicen los números, y esta es la habilidad entera:**

- **100:1 lectura:escritura** → esto es un sistema de *lectura*. El caching y las read
  replicas son la arquitectura; el camino de escritura es comparativamente fácil.
- **225k lecturas/seg pico** → no puede venir de una base de datos. Es un problema de
  cache y CDN.
- **82 TB en 10 años** → demasiado para una máquina; el sharding es genuinamente
  necesario (a diferencia del ejemplo de la Cápsula 26, donde no lo era).
- **150.000 escrituras de fan-out/seg** para usuarios comunes es grande pero tratable.
- **50 millones de escrituras por un tweet de una celebridad** → **el fan-out al
  escribir no puede funcionar para celebridades.** Este único número es por qué la
  arquitectura real de Twitter es híbrida (Cápsula 20), y decirlo es lo más fuerte que
  podés decir en esa entrevista.

### Verificación de cordura

22,5 GB/día de *texto* de tweets — solo texto, sin media, sin metadata, sin índices.
Ese es el orden de magnitud correcto para el firehose de texto. **Plausible —
seguimos.** (La media lo empequeñecería, lo cual también vale la pena decir en voz
alta.)

---

## Ejemplo resuelto 2 — una plataforma de video

> *"Diseñá YouTube. 2.000M de usuarios, 1.000M de horas vistas por día."*

```bash
python3 - <<'PY'
HOURS_DAY   = 1_000_000_000
BITRATE_MBPS = 3                        # 1080p average across devices
bits = HOURS_DAY * 3600 * BITRATE_MBPS * 1e6
bytes_ = bits / 8
print(f"egress: {bytes_/1e15:.0f} PB/day  =  {bits/86400/1e12:.0f} Tbps sustained\n")

UPLOAD_HOURS_MIN = 500
MB_PER_MIN       = 50                    # after transcoding, all renditions
daily_up = UPLOAD_HOURS_MIN * 60 * MB_PER_MIN * 60 * 24 / 1e6
print(f"uploads: {daily_up:.0f} TB/day  =  {daily_up*365/1000:.0f} PB/year\n")

egress_cost = bytes_/1e9 * 0.02 * 365    # $0.02/GB at CDN-scale contract rates
print(f"egress at $0.02/GB: ${egress_cost/1e9:.1f} BILLION/year")
print("-> this is why YouTube built its own CDN and peers directly with ISPs")
PY
```

```
egress: 1350 PB/day  =  125 Tbps sustained

uploads: 2160 TB/day  =  788 PB/year

egress at $0.02/GB: $9.9 BILLION/year
-> this is why YouTube built its own CDN and peers directly with ISPs
```

**Verificación de cordura:** 1.350 PB/día son 1,35 exabytes. Las estimaciones públicas
del egress diario de YouTube están en ese rango, y 125 Tbps es una fracción plausible
del tráfico total de internet. **Plausible — seguimos.**

**La estimación produjo una conclusión estratégica**, no solo un número: a esta escala
la economía del ancho de banda domina todo lo demás, que es exactamente por qué Google
pone sus propias cajas de cache (Google Global Cache) *dentro* de los datacenters de
los ISPs y hace peering directo. Ninguna cantidad de pensamiento a nivel aplicación te
lleva a esa conclusión — solo la aritmética.

---

## Ejemplo resuelto 3 — el que sí te van a preguntar

> *"Tenemos 50.000 usuarios activos diarios y está lento. ¿Qué necesitamos?"*

```bash
python3 - <<'PY'
DAU = 50_000
ACTIONS = 100
qps = DAU * ACTIONS / 100_000
print(f"average: {qps:.0f} QPS,  peak (3x): {qps*3:.0f} QPS")

LAT = 0.050
conc = qps * 3 * LAT
print(f"concurrent requests at peak: {conc:.0f}")
print(f"instances at 50 concurrent each: {conc/50:.1f}  -> run 3 for redundancy")

print(f"\ndatabase: {qps*3:.0f} QPS is ~1-3% of one Postgres instance")
print("verdict: this is NOT a capacity problem.")
PY
```

```
average: 50 QPS,  peak (3x): 150 QPS
concurrent requests at peak: 8
instances at 50 concurrent each: 0.1  -> run 3 for redundancy
database: 150 QPS is ~1-3% of one Postgres instance
verdict: this is NOT a capacity problem.
```

**150 QPS no es nada.** Si está lento a 150 QPS, el problema es un índice faltante, un
N+1, una llamada externa sincrónica, o un lock — no capacidad. Agregar servidores
costaría plata y no cambiaría nada.

**Esta es la estimación más valiosa de la cápsula**, porque es la que vas a hacer más
seguido, y consistentemente evita el trabajo equivocado.

---

## Lab — cinco, cronometrados

Cinco minutos cada uno. Escribí los supuestos primero, después calculá, después
verificá la cordura.

1. **Un acortador de URLs.** 100M de URLs nuevas/día, 10.000M de redirecciones/día.
   ¿Almacenamiento después de 5 años? ¿QPS pico de redirección? ¿El mapeo entra en RAM?

2. **Una app de chat.** 50M de DAU, 40 mensajes enviados por usuario por día, tamaño
   promedio de grupo 8. ¿Mensajes escritos/seg? ¿Mensajes *entregados*/seg?
   ¿Almacenamiento por año?

3. **Un servicio de fotos.** 10M de DAU, 2 subidas/día, 5 MB cada una, 4 tamaños de
   thumbnail generados. ¿Almacenamiento por año? ¿Egress si cada foto se ve 20 veces?

4. **Una app de viajes.** 1M de conductores activos mandando ubicación cada 4 segundos.
   ¿QPS de escritura? ¿Ancho de banda? ¿Va en Postgres?

5. **Tu propio proyecto de trabajo actual.** Números reales, estimación de costo real.
   Este es el que te va a sorprender.

Respuesta resuelta del #1:

<details>
<summary>Acortador de URLs</summary>

```
ASSUMPTIONS
  100M writes/day, 10B reads/day  → 100:1 read:write
  URL record: short code (7B) + long URL (~100B) + metadata (~50B) ≈ 200 B

TRAFFIC
  writes: 100M / 100k       = 1,000 QPS   → peak 3,000
  reads:  10B  / 100k     = 100,000 QPS   → peak 300,000

STORAGE
  100M × 200 B = 20 GB/day
  × 365 × 5    = 36 TB over 5 years
  + indexes (×1.5) ≈ 55 TB

KEY GENERATION
  base62, 7 characters = 62⁷ ≈ 3.5 × 10¹²
  at 100M/day that lasts 3.5×10¹² / 10⁸ = 35,000 days ≈ 96 years  ✅

CACHE
  Zipf: ~20% of URLs get ~80% of traffic, and recent URLs dominate.
  Hot set: say 20M URLs × 200 B = 4 GB   → fits in ONE Redis instance.
  That cache absorbs ~80% of 300,000 QPS.

CONCLUSIONS
  · 300k peak reads is a CACHE + CDN problem, not a database problem
  · A 301 redirect is cached by the browser forever — huge saving, but you
    lose analytics and the ability to change the target. Use 302 if either
    matters. This trade-off is the actual design question.
  · 3,000 writes/sec fits one primary; 55 TB does not. Shard on the short
    code (hash) — reads are always by exact key, so single-shard.
  · Key generation: a counter + base62 is simplest and collision-free.
    Random requires collision checks. Pre-generated pools avoid both.
```

**Fijate en la forma del razonamiento:** cada conclusión arquitectónica es rastreable a
un número.
</details>

---

## Llevátelo al trabajo

- **Estimá antes de diseñar.** Son cinco minutos y rutinariamente evita un trimestre de
  trabajo innecesario.
- **Enunciá los supuestos explícitamente.** El número vale lo que valen ellos.
- **Calculá primero el ratio lectura:escritura.** Determina más de la arquitectura que
  cualquier otra cosa.
- **Verificá contra algo conocido.** Los resultados absurdos normalmente significan que
  se coló un factor de 1.000.
- **Hacé la estimación de costo.** "Este diseño sale USD 8k/mes; la alternativa sale
  USD 1,5k" es un argumento de calidad de decisión.
- **Re-estimá a 10× y 100×** — eso te dice qué se rompe después y cuándo.
- **Redondeá a una cifra significativa** y decilo. La precisión acá es confianza falsa.

---

## Battle drill

<details>
<summary><b>1.</b> Alguien dice "necesitamos Kafka, estamos haciendo 5.000 eventos/seg". Respondé.</summary>

5.000/seg son unos 400 millones de eventos por día. Es real, pero está bien dentro de
la capacidad de escritura de una sola tabla de Postgres (5k–20k/seg), y cómodo dentro
de un solo topic de Pub/Sub o un solo Redis Stream.

Así que la pregunta no es throughput. Preguntá qué propiedad necesitan realmente:

- **Replay** — reprocesar historia desde un offset arbitrario. Este es el argumento
  genuino a favor de Kafka.
- **Garantías de orden** por partición.
- **Varios consumidores independientes** en posiciones distintas del stream.
- **Retención larga** como fuente de verdad.

Si la respuesta es "necesitamos mover eventos de A a B", Pub/Sub o Cloud Tasks es más
simple, gestionado y más barato (Cápsula 18). Kafka es un compromiso operativo serio —
brokers, ZooKeeper/KRaft, rebalanceo de particiones, gestión de consumer groups.

La estimación no lo decide, pero saca el throughput de la conversación, que es donde
suele esconderse el argumento.
</details>

<details>
<summary><b>2.</b> Estimá el almacenamiento de 5 años de logs de aplicación.</summary>

```
  1,000 QPS × 100,000 sec/day       = 100M requests/day
  ~3 log lines per request           = 300M lines/day
  ~500 bytes per structured JSON line
    → 150 GB/day
    → 55 TB/year
    → 275 TB over 5 years
```

A ~USD 0,20/GB/mes de almacenamiento caliente eso son **USD 55.000/mes** para el año
5, lo cual es absurdo para logs que nadie lee.

Lo que hacés en realidad:
- **Retención por niveles** — 7 días caliente y buscable, 30 días tibio, después
  archivo comprimido en almacenamiento de objetos a USD 0,02/GB.
- **Muestreo** — guardá el 100% de los errores, el 1% de los éxitos.
- **Excluí los health checks**, que a menudo son 50–90% de las líneas y 0% del valor.
- **No loguees bodies de request.**
- **Agregá a métricas** donde lo único que querías era un conteo.

Eso típicamente lo corta 10–50×. Este cálculo es por qué existen las políticas de
retención de logs, y hacerlo una vez es cómo conseguís que se escriba una.
</details>

<details>
<summary><b>3.</b> ¿Cómo estimás el tamaño de un cache?</summary>

Estimá el **hot set**, no el dataset total.

```
  hot_set = active_items × item_size × safety_factor
```

Acertarle a `active_items` es la habilidad. El acceso normalmente sigue una
distribución de Zipf — más o menos el 20% de los items sirve el 80% de los requests, y
la *recencia* domina en sistemas de cara al usuario (el contenido de hoy, los usuarios
activos de esta semana).

Ejemplo: 100M de productos en total, pero 500k vistos por día, promedio 2 KB
serializados → hot set de 1 GB. Agregá 50% por overhead y crecimiento → 1,5 GB. El
overhead de clave de Redis es ~50–100 bytes/clave, lo cual importa cuando los valores
son chicos.

**Después validá el supuesto:** corré con un cache modesto y medí el hit ratio. Si es
95%, achicalo. Si es 40%, o el hot set es más grande de lo que pensabas o el patrón de
acceso es más uniforme que Zipf.

Y acordate de la Cápsula 14: **el hit ratio no es reducción de carga.** Dimensioná el
cache a partir de la carga que necesitás sacar, no de un objetivo de hit ratio.
</details>

<details>
<summary><b>4.</b> ¿Por qué importa más el ratio lectura:escritura que los números absolutos?</summary>

Porque las lecturas y las escrituras escalan por mecanismos completamente distintos.

**Las lecturas escalan fácil y barato**: cacheálas, agregá read replicas, poné un CDN
adelante. Cada uno es un cambio aditivo y bien entendido.

**Las escrituras escalan difícil**: un primario las acepta, e ir más allá significa
shardear (ruteo en la aplicación, sin transacciones entre shards, proyectos de
resharding) o una base distribuida con otras garantías y costo mucho más alto.

Entonces un sistema 100:1 con 100k QPS totales es *fácil* — 1.000 escrituras/seg en un
primario, 99.000 lecturas absorbidas por cache y CDN.

Un sistema 1:1 con 20k QPS totales es *mucho más difícil* — 10.000 escrituras/seg está
en el borde de un primario y la capa de caching apenas ayuda.

El QPS absoluto te dice cuánto tráfico hay. **El ratio te dice qué problema tenés**, y
por lo tanto qué arquitectura. Es lo primero que hay que calcular y lo primero que hay
que decir.
</details>

<details>
<summary><b>5.</b> Tu estimación dice 3 servidores. El equipo corre 40. ¿Qué preguntás?</summary>

El hueco es información, así que averiguá qué le falta a tu modelo en vez de asumir que
están equivocados.

- **¿La carga está limitada por CPU?** Mi estimación de concurrencia asumió limitada
  por E/S. Un servicio limitado por CPU necesita muchas más instancias para el mismo
  QPS.
- **Redundancia y zonas.** 3 por capacidad se vuelven 6 por HA se vuelven 9 en tres
  zonas. Ese es el costo pretendido de la disponibilidad.
- **¿Son servicios separados?** 40 instancias de 8 microservicios son 5 cada uno, que
  es completamente distinto a 40 de una cosa.
- **Forma del tráfico.** Mi factor de pico de 3× puede estar mal — un pico de 20× a las
  8 PM lo cambia todo.
- **`min-instances` por cold starts** (Cápsula 06).
- **¿Está bien dimensionado siquiera?** A veces la respuesta honesta es que nadie lo
  midió nunca, y 40 es lo que alguien configuró en 2021.

Después medí: utilización real de CPU y memoria por instancia. Si están al 5%, hay un
ahorro de costos real. Si están al 70%, a mi modelo le faltaba algo y debería averiguar
qué.
</details>

---

## Registralo

```bash
cd ~/repos/pato/gravity-augmented && ./bin/scouter done B6
```
