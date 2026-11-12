# Cápsula 09 · La Habitación del Tiempo — Load testing y capacidad

> *Un año de entrenamiento adentro, un día afuera. La gravedad es diez veces la
> normal y el aire está enrarecido. Y lo crucial: es una habitación de la que
> podés salir. Encontrás tus límites en un lugar del que podés irte caminando, no
> en el medio de una pelea.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 6 | 70 min | Cápsulas 05–08 | Local |

---

## Por qué existe esta cápsula

Cada conversación de capacidad que vas a tener — "¿aguantamos el Black Friday?",
"¿necesitamos instancias más grandes?", "¿por qué se cayó a las 3 de la tarde?" —
se responde con números o se responde con vibras.

Esta cápsula es donde dejás de adivinar. Vas a generar carga real, leer
percentiles bien, encontrar el punto exacto donde tu servicio se cae por un
precipicio, y aprender por qué ese precipicio existe matemáticamente en vez de
misteriosamente.

También es la cápsula que hace medibles a todas las *siguientes*. De acá en
adelante, "el cache lo hizo más rápido" es un número.

---

## El concepto

### Los promedios mienten. Los percentiles no.

```
  1000 requests: 990 take 10ms, 10 take 5000ms

  average  =  59ms      ← looks great, is a lie
  p50      =  10ms
  p95      =  10ms
  p99      =  10ms
  p99.9    = 5000ms     ← the truth
```

Peor: **los usuarios no experimentan un request.** Una página que hace 20 llamadas
al backend pega en la latencia p99 con probabilidad `1 - 0,99²⁰ ≈ 18%`. Tu "1%
lento" se convierte en "1 de cada 5 cargas de página es lenta". Tus usuarios más
pesados — los que más importan — viven permanentemente en tu cola.

Reportá **p50, p95, p99** siempre, y p99.9 para cualquier cosa de cara al usuario.
Nunca promedies percentiles entre instancias o entre intervalos de tiempo; eso es
matemáticamente sin sentido. (Por eso los sistemas de monitoreo reales guardan
histogramas, no percentiles precalculados.)

### La ley de Little

La única pieza de teoría de colas que vale la pena memorizar:

```
        L = λ × W

   L = concurrent requests in the system
   λ = arrival rate (requests/sec)
   W = average time in the system (sec)
```

Es simple y responde preguntas reales:

- *"1000 RPS, 200 ms de latencia promedio — ¿cuántos requests concurrentes?"*
  `L = 1000 × 0,2 = 200`. Así que necesitás al menos 200 slots concurrentes. Si tu
  servicio maneja 80 concurrentes por instancia, eso son **3 instancias mínimo**.
- *"Mi pool de conexiones es 20 y cada query tarda 50 ms. ¿Throughput máximo?"*
  `λ = L/W = 20/0,05 = 400 QPS`. Ninguna cantidad de réplicas web extra cambia ese
  número — el pool es el techo.

### La rodilla de la latencia

La utilización y la latencia no son lineales. Por teoría de colas, para un sistema
simple, `tiempo de espera ∝ ρ / (1 - ρ)` donde ρ es la utilización:

```
  latency
    │                                        ╱│  ← vertical asymptote at 100%
    │                                      ╱
    │                                   ╱
    │                              ╱
    │                    ╱────╱          ← THE KNEE (~70-80%)
    │  ────────────╱
    └──────────────────────────────────────────► utilisation
       10%   30%   50%   70%   80%  90%  95%
```

Al 50% de utilización, el encolamiento suma 1× el tiempo de servicio. Al 90%,
suma **9×**. Al 99%, **99×**.

Dos consecuencias que le dan forma a la arquitectura real:

1. **Nunca planifiques correr al 90% de utilización.** Apuntá a 60–70% para tener
   margen ante un pico, y para que la latencia se mantenga plana en vez de no
   lineal.
2. **"Ayer andaba bien al 65% y hoy se cayó al 78%"** no es misterioso. Es la
   rodilla.

### Modelos de carga cerrados vs abiertos

Esto es lo que más gente hace mal, y invalida sus resultados.

**Modelo cerrado** — N usuarios virtuales, cada uno en un loop: request → esperar
respuesta → pensar → repetir. Si el servidor se pone lento, los usuarios *también
se ponen lentos*, así que la carga ofrecida baja. Esto **esconde la sobrecarga**:
el sistema parece degradarse con gracia porque tu generador de carga se está
retirando educadamente.

**Modelo abierto** — los requests llegan a una tasa fija sin importar qué esté
haciendo el servidor. Así funciona el tráfico real: internet no te espera. Bajo
sobrecarga la cola crece sin límite y ves el precipicio real.

> Usá un modelo **cerrado** para simular un conjunto fijo de clientes (un job
> batch, una app mobile con concurrencia limitada). Usá un modelo **abierto** para
> encontrar tu punto de quiebre. En k6 eso es `constant-arrival-rate`; en la
> mayoría de las otras herramientas es "modo RPS".
>
> No distinguir esto se llama **coordinated omission**, y es por qué tantos
> benchmarks publicados son optimismo sin sentido.

### Cuatro tipos de test

| Test | Forma | Responde |
|---|---|---|
| **Smoke** | carga mínima, 1 min | ¿funciona siquiera? Corrélo en CI |
| **Load** | pico esperado, 10–30 min | ¿cumplimos los SLOs en el pico normal? |
| **Stress** | rampa hasta romperlo | ¿dónde está el precipicio, y cómo falla? |
| **Soak** | carga moderada, horas | leaks de memoria, de conexiones, disco lleno |

**Los soak tests agarran lo que ningún otro agarra.** Un leak de 1 MB cada 1000
requests es invisible en un test de 10 minutos y te tira producción abajo el
cuarto día.

### Qué medir mientras generás carga

- **RED** (por servicio): **R**ate, **E**rrors, **D**uration
- **USE** (por recurso): **U**tilization, **S**aturation, **E**rrors

La utilización es "qué tan ocupado". **La saturación es "cuánto está esperando"** —
profundidad de cola, longitud de la run-queue, tiempo de CPU estrangulado, tiempo
de espera del pool. La saturación es la métrica que predice la rodilla; la
utilización solo te dice dónde estás parado en la curva.

---

## Lab

```bash
brew install k6
```

k6 es un generador de carga que se scriptea en JavaScript y reporta percentiles
posta. Su executor `constant-arrival-rate` te da un modelo abierto de verdad, que
es por qué lo usamos en vez de `ab` o `wrk`.

> **¿No querés instalar otro binario?** k6 corre perfecto desde su propia
> imagen, y cada `k6 run …` de esta cápsula se traduce a:
>
> ```bash
> docker run --rm -i --network host -v "$PWD/scripts/load:/s:ro" \
>   grafana/k6 run -e BASE=http://localhost:8080 /s/smoke.js
> ```
>
> `--network host` es lo que le permite al container llegar a tu servicio en
> `localhost`. Esta cápsula entera se verificó así.

### Paso 1 — un smoke test

**`scripts/load/smoke.js`** en `gravity-chamber`:

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 1,
  duration: '20s',
  thresholds: {
    // Thresholds are pass/fail criteria. A failed threshold exits non-zero,
    // which is what makes this runnable in CI.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
  },
};

const BASE = __ENV.BASE || 'http://localhost:8080';

export default function () {
  const res = http.get(`${BASE}/leaderboard`);
  check(res, {
    'status 200': (r) => r.status === 200,
    'has body': (r) => r.body.length > 0,
  });
}
```

```bash
make run                       # scouter on :8080
k6 run scripts/load/smoke.js
```

Leé el resumen con atención — `http_req_duration` con `avg`, `min`, `med`, `max`,
`p(90)`, `p(95)`. Fijate qué lejos está `max` de `p(95)`. Ese hueco es la cola, y
es donde vive tu peor usuario.

### Paso 2 — encontrá la rodilla (modelo abierto)

**`scripts/load/stress.js`**

```javascript
import http from 'k6/http';
import { Trend } from 'k6/metrics';

// OPEN model: requests arrive at a fixed rate whether or not the server keeps
// up. This is what real traffic does, and it is the only way to see the cliff.
export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 800,          // must be high enough not to become the bottleneck
      stages: [
        { target: 50,   duration: '30s' },
        { target: 100,  duration: '30s' },
        { target: 200,  duration: '30s' },
        { target: 400,  duration: '30s' },
        { target: 800,  duration: '30s' },
        { target: 1600, duration: '30s' },
      ],
    },
  },
};

const BASE = __ENV.BASE || 'http://localhost:8080';
const write = new Trend('write_latency', true);

export default function () {
  // A read-heavy mix with some writes — closer to real traffic than either alone.
  if (Math.random() < 0.1) {
    const r = http.post(`${BASE}/readings`,
      JSON.stringify({ fighter: `f${Math.floor(Math.random() * 1000)}`,
                       power: Math.floor(Math.random() * 100000) }),
      { headers: { 'Content-Type': 'application/json' } });
    write.add(r.timings.duration);
  } else {
    http.get(`${BASE}/leaderboard?limit=10`);
  }
}
```

Corrélo contra el container para poder restringir recursos:

```bash
make docker-build
docker run -d --rm -p 8080:8080 --name hbtc --cpus=0.25 --memory=512m scouter:latest

k6 run scripts/load/stress.js
```

> **Por qué `--cpus=0.25` y no 1.** Un servicio Go en memoria sobre una laptop
> moderna es muchísimo más rápido que esta rampa. Medido en una Mac M-series de
> 8 cores, con el mismo script:
>
> | Límite del servicio | p95 | pico de VUs | iteraciones descartadas |
> |---|---|---|---|
> | `--cpus=1` | **1,16 ms** | 3 | 0 |
> | `--cpus=0.25` | **68 ms** | 151 | 332 |
>
> Con `--cpus=1` no hay ningún codo que encontrar — la latencia queda plana
> hasta los 1600 rps y k6 nunca necesita más de 3 VUs concurrentes. Concluirías
> que el servicio escala infinito, que es exactamente el error que esta cápsula
> existe para prevenir.
>
> Dos corridas de esa segunda fila dieron p95 de 68 ms y 30 ms, con picos de VUs
> de 151 y 45. **Tus números exactos van a diferir y no van a repetirse — lo que
> es estable es la forma.** La brecha entre restringido y sin restringir (26–60×)
> es mucho más grande que esa dispersión entre corridas, y eso es lo que hace que
> el codo sea un hallazgo real y no ruido. La Cápsula 07 te muestra el caso
> opuesto, donde un efecto más chico que la varianza no es un hallazgo.
>
> **Si tu máquina es rápida, BAJÁ el límite hasta poder ver el precipicio.**
> Elegir la restricción para que el efecto sea visible es parte legítima del load
> testing — no estás haciendo trampa, estás eligiendo una escala donde la
> dinámica se puede observar. Mirá las columnas de pico de VUs e iteraciones
> descartadas: se mueven mucho antes que la latencia, lo que las hace la señal
> de saturación más temprana que tenés.

En un segundo panel, mirá cómo pasa:

```bash
lazydocker      # Stats panel: CPU pinning at 100%, memory climbing
```

**Anotá los números en `NOTES.md`:**

| RPS objetivo | RPS logrado | p50 | p95 | p99 | % error |
|---|---|---|---|---|---|
| 50 | | | | | |
| 100 | | | | | |
| 200 | | | | | |
| 400 | | | | | |
| 800 | | | | | |
| 1600 | | | | | |

Tres cosas que buscar, y llegan en este orden:

1. **El RPS logrado deja de seguir al RPS objetivo.** Eso es saturación. La fila
   donde divergen es tu capacidad real.
2. **El p99 sube mucho más rápido que el p50.** La cola siempre se va primero.
   Para cuando se mueve el p50, ya pasaste la rodilla bien de largo.
3. **Aparecen errores.** Normalmente al final, y normalmente como timeouts en vez
   de 500.

El punto donde ocurre (1) es el número que ponés en un plan de capacidad. Todo lo
que sigue es el precipicio.

### Paso 3 — probá la ley de Little con tus propios datos

Tomá una fila de tu tabla por debajo de la rodilla:

```
  L = λ × W

  λ = achieved RPS
  W = p50 latency in seconds
  L = concurrent requests in flight
```

Ahora compará `L` con los `vus` que reporta `k6` en ese momento. Deberían estar
cerca. Si no, tu generador de carga era el cuello de botella (`maxVUs` muy bajo), y
tu test entero es inválido — esa es la forma más común en que los load tests
mienten.

### Paso 4 — cerrado vs abierto, lado a lado

Copiá `stress.js` a `closed.js` y cambiá el executor — **y de paso arreglá el
comentario `// OPEN model:` de arriba de todo.** Un comentario que contradice al
código que tiene debajo es peor que ningún comentario; este archivo ahora
demuestra justo lo contrario de lo que esa línea afirma.

```javascript
    ramp: {
      executor: 'ramping-vus',      // CLOSED: N users, each waits for a response
      startVUs: 10,
      stages: [
        { target: 50,  duration: '30s' },
        { target: 200, duration: '30s' },
        { target: 800, duration: '30s' },
      ],
    },
```

```bash
k6 run scripts/load/closed.js
```

Compará con la corrida abierta. El modelo cerrado muestra **latencia más alta pero
sin precipicio de errores** — porque a medida que el servidor se pone lento, los
usuarios virtuales se ponen lentos con él y dejan de ofrecer carga. Parece
degradación con gracia. No lo es; es tu generador de carga siendo educado de una
forma en que los usuarios reales nunca lo son.

Escribí en `NOTES.md`: *"Un test de modelo cerrado no puede encontrar mi punto de
quiebre."*

### Paso 5 — variá los recursos, mirá moverse la rodilla

```bash
for cpus in 0.125 0.25 0.5; do
  docker rm -f hbtc 2>/dev/null
  docker run -d --rm -p 8080:8080 --name hbtc --cpus=$cpus --memory=512m scouter:latest
  sleep 2
  echo "=== cpus=$cpus ==="
  k6 run --quiet scripts/load/stress.js 2>&1 | grep -E 'http_reqs|http_req_duration|http_req_failed|dropped_iterations|vus_max'
done
```

Son el límite del Paso 2 a la mitad y al doble. No `0.5 1 2`: con `--cpus=1` la
rodilla ya queda más allá del techo de esta rampa (mirá el Paso 2), así que casi
todo un barrido por ahí arriba se vería plano.

Compará `dropped_iterations` y `vus_max` entre corridas, no `http_reqs`. A todas
las corridas se les ofrece el mismo calendario de llegadas, así que la cantidad
de requests casi no cambia mientras el servicio da abasto. Si no aparece la línea
`dropped_iterations`, no se descartó nada. Esperá tres formas distintas:

- **`0.125`**: bien pasada la rodilla. El p95 es órdenes de magnitud peor que en
  las otras, se descarta una buena parte de las iteraciones y `vus_max` llega al
  techo de 800.
- **`0.25`**: tu corrida del Paso 2, en la rodilla o cerca, al final de la rampa.
- **`0.5`**: plana. p95 bajo, casi nada descartado, `vus_max` queda cerca de sus
  50 prealocados. La rodilla no desapareció. Se corrió más allá de 1600 rps, el
  techo de la rampa. Una corrida plana es una cota inferior ("por lo menos 1600
  rps"), no un número de capacidad.

Duplicar la CPU corrió la rodilla más lejos de lo que esta rampa puede seguir, y
ese es el resultado. Si en tu máquina las tres se ven planas, dividí los tres
valores por dos; si las tres colapsan, duplicalos. Vale la misma regla que en el
Paso 2: elegí la escala donde la rodilla cae dentro de la rampa.

Ahora tenés un **modelo de capacidad**: RPS por vCPU. Sacalo de una corrida cuya
rodilla caiga dentro de la rampa (el RPS logrado donde dejó de seguir al
objetivo, dividido por `--cpus`), nunca de una corrida plana, que solo te dice
que el techo está todavía más arriba. Ese único número te deja
responder "¿cuántas instancias para 10.000 RPS?" sin correr otro test — y es
exactamente lo que la Cápsula 26 te pide producir.

### Paso 6 — un threshold que hace de gate en CI

Agregá al Makefile:

```makefile
## loadtest: smoke test with SLO thresholds (fails the build if breached)
loadtest:
	k6 run scripts/load/smoke.js
```

`k6` sale con código distinto de cero cuando falla un threshold, así que esto es un
gate de calidad real. Una regresión de performance que se habría shippeado ahora
rompe un build.

```bash
docker rm -f hbtc
```

---

## En GCP

- **Cloud Monitoring** muestra latencia de requests, cantidad de instancias y CPU
  para Cloud Run automáticamente. La latencia ahí es una **distribución**, así que
  podés graficar p50/p95/p99 sin instrumentar nada.
- **Cloud Trace** muestrea requests y muestra adónde se fue el tiempo — invaluable
  cuando hay varios servicios (Cápsula 25).
- **La concurrencia de Cloud Run** es la concurrencia por instancia de la Cápsula
  06. Usá tus números de k6 para ponerla: si una instancia se satura alrededor de
  60 requests en vuelo, poné `--concurrency=60`, no el default de 80.
- **Hacerle load testing a la infraestructura de otro es un ataque.** Los términos
  de Google permiten testear *tus propios* recursos; revisá la política vigente
  antes de algo grande, y nunca apuntes un generador de carga a una API de
  terceros.
- **Advertencia de costo:** un stress test contra Cloud Run con
  `--max-instances=100` va a escalar alegremente a 100 instancias y te va a
  facturar. Poné `--max-instances` bajo antes de testear, y preferí testear en
  local.

---

## Llevátelo al trabajo

- **Nunca reportes una latencia promedio.** p50/p95/p99, siempre.
- **Modelo abierto para encontrar límites.** Si tu herramienta no tiene modo de
  tasa de llegada, tus números de punto de quiebre son optimistas.
- **Planificá para 60–70% de utilización.** La rodilla es real y es empinada.
- **Hacé soak tests antes de cualquier lanzamiento grande.** Los leaks son
  invisibles en tests cortos.
- **Poné un smoke test con thresholds en CI.** Son 20 segundos y agarra regresiones
  cuando tienen un commit de antigüedad.
- **Testeá la mezcla, no un endpoint.** El tráfico real son lecturas *y*
  escrituras, y la contención de escritura suele ser lo primero que se rompe.
- **Registrá la capacidad como un ratio** (RPS por vCPU, RPS por instancia). Es la
  única forma que sobrevive a que tu tráfico se duplique.

---

## Battle drill

<details>
<summary><b>1.</b> Load test: promedio 45 ms, p99 3,2 s. El equipo dice "el promedio está bien, shippeá". Respondé.</summary>

El 1% de los requests tarda 3,2 segundos. Si una página hace 10 llamadas al
backend, ~10% de las cargas de página contienen al menos una llamada de 3
segundos, así que alrededor de 1 de cada 10 usuarios tiene una mala experiencia —
no 1 de cada 100.

Segundo: la latencia correlaciona con el peso del usuario. El usuario con más
datos pega en el camino lento *todas las veces*, así que tus mejores clientes
experimentan el p99 como su p50.

Tercero: ¿cuál es el p99.9? Con reintentos y timeouts, un p99 de 3,2 s
normalmente esconde un p99.9 de 15 s, que es donde viven los timeouts y las fallas
en cascada.

Investigá qué hace lentos a esos requests — casi siempre es una causa específica
(un índice faltante, un cache frío, un N+1, un lock), no lentitud uniforme.
</details>

<details>
<summary><b>2.</b> Tu load test muestra 5.000 RPS. Producción se cae en 800. ¿Qué salió mal?</summary>

Los sospechosos de siempre, en orden de frecuencia:

- **Mezcla de carga equivocada** — testeaste un endpoint barato; producción tiene
  20 endpoints y los caros dominan.
- **Sin datos** — una base vacía con 100 filas tiene todos los índices en memoria.
  Producción tiene 50 millones de filas y pega en disco.
- **Cache caliente en el test** — pedir la misma clave repetidamente da un hit
  rate del 100% que producción nunca ve.
- **Test de modelo cerrado** — coordinated omission escondió el precipicio.
- **El generador de carga era el cuello de botella** — mediste tu laptop, no el
  servicio.
- **El entorno de test ≠ producción** — instancias de otro tamaño, sin salto de
  red, sin TLS, sin sidecars, sin vecinos ruidosos.

La solución es una mezcla realista, volumen de datos con forma de producción, hit
rates de cache realistas, y llegadas de modelo abierto.
</details>

<details>
<summary><b>3.</b> La latencia está plana hasta el 70% de CPU y después explota. ¿Por qué no es lineal?</summary>

Encolamiento. Una vez que un recurso está ocupado, el trabajo nuevo espera, y el
tiempo de espera escala como `ρ/(1-ρ)`. Al 50% de utilización la cola suma 1× el
tiempo de servicio; al 90% suma 9×; al 99%, 99×. La curva tiene una asíntota
vertical en 100%.

Por eso la planificación de capacidad apunta a 60–70%: no es conservadurismo, es
la forma de la función. También es por qué "agregamos 10% más de tráfico y se
rompió todo" es algo completamente normal cuando ya estabas al 85%.
</details>

<details>
<summary><b>4.</b> Explicá coordinated omission en un párrafo.</summary>

Un generador de carga de modelo cerrado manda el siguiente request solo después de
que vuelve el anterior. Cuando el servidor se traba 2 segundos, el generador *no
manda* los requests que habría mandado en esa ventana — así que esos requests
nunca se miden, y el freno se registra como un solo request lento en vez de los
cientos de usuarios que en realidad habrían quedado encolados detrás.

El resultado son percentiles sistemáticamente optimistas. La solución es un modelo
abierto (tasa de llegada fija) o un generador que compense reconstruyendo los
timestamps que debería haber usado.
</details>

<details>
<summary><b>5.</b> Tu pool de conexiones es 20, las queries promedian 50 ms. ¿Cuál es tu throughput máximo, y cómo lo subís?</summary>

Ley de Little: `λ = L/W = 20 / 0,05 = 400 QPS`. Techo duro, sin importar cuántas
réplicas web agregues — solo van a hacer cola por el pool.

Para subirlo: hacé las queries más rápidas (`W` abajo — un índice a 5 ms te da
4.000 QPS, una ganancia de 10× por cero infraestructura); o agrandá el pool (`L`
arriba — pero la base tiene su propio límite, y pasado ese lo empeorás); o sacá
las queries por completo con un cache (Cápsula 14); o agregá read replicas
(Cápsula 13).

Fijate el orden: `W` es casi siempre la palanca más barata, y es la que la gente
agarra última.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `dial: i/o timeout` a tasas altas | Límite local de file descriptors. `ulimit -n 10240` en el shell de k6. |
| El RPS logrado nunca alcanza al objetivo | O el servicio está saturado (¡el hallazgo!) o `maxVUs` es muy bajo (test inválido). Mirá `vus` vs `vus_max` en la salida. |
| La latencia se ve igual a cualquier tasa | Estás testeando un endpoint cacheado/trivial, o el port forwarding de Docker es el cuello de botella. Usá una mezcla realista. |
| Agotamiento de puertos efímeros en macOS | `sysctl net.inet.ip.portrange.first` — o bajá la tasa. Las laptops no son plataformas de load testing. |
| Los resultados varían 2× entre corridas | Throttling térmico, apps de fondo, contención de la VM de Docker. Corré tres veces, tomá la mediana, mirá la forma y no los valores absolutos. |
| k6 satura tu CPU | El generador compite con el servicio por cores. En una sola laptop, tomá los números absolutos como indicativos nomás. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "test(load): k6 smoke and open-model stress scenarios

Capsule 09. Found the knee at N RPS at --cpus=0.25; recorded RPS-per-vCPU as a
capacity ratio. Confirmed a closed-model test cannot find the breaking point
(coordinated omission). Smoke test has SLO thresholds so CI can gate on it."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 09
```

**Siguiente:** [Cápsula 10 · El Archivo del Gran Patriarca — Datos relacionales](../10-grand-elder-archive-relational/README.md)
