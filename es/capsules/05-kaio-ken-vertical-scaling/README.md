# Cápsula 05 · Kaio-ken — Vertical scaling y su precio

> *El Kaio-ken multiplica el poder de Goku al instante. Sin peleadores nuevos,
> sin coordinación, sin estrategia — solo más, ya. También le destroza el cuerpo,
> y cada multiplicador cuesta más que el anterior. La advertencia de Kaio-sama es
> la lección entera: funciona, y no escala.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 5 | 70 min | Cápsulas 00–04 | Local |

---

## Por qué existe esta cápsula

Cuando algo está lento, el primer instinto es agrandar la máquina. ¡Y muchas veces
es correcto! Siempre es *lo más barato de probar* en horas de ingeniería, y
"comprate una máquina más grande" salvó más fines de semana que cualquier sistema
distribuido.

Pero tiene un techo, una curva de costo y modos de falla específicos. Esta cápsula
te lleva al punto donde podés decir, con números, **"el vertical scaling nos
compra N meses, esto es lo que cuesta, y este es el muro."** Esa frase es la
diferencia entre alguien que adivina y alguien que planifica.

---

## El concepto

### Qué controla realmente "vertical"

Por debajo, esto son límites de cgroups — el mismo mecanismo de la Cápsula 02.

| Recurso | El límite se ve así | Cómo pegás contra el muro |
|---|---|---|
| **CPU** | `--cpus=2` (una cuota por período) | los requests hacen cola, la latencia sube, el throughput se aplana |
| **Memoria** | `--memory=512m` | el **OOM killer** mata el proceso. Al instante. Sin gracia. |
| **E/S de disco** | topes de IOPS/throughput | latencia misteriosa que no es CPU |
| **Red** | topes de ancho de banda por clase de instancia | meseta de throughput en respuestas grandes |

**El throttling de CPU y el OOM de memoria son fallas completamente distintas.** La
presión de CPU te degrada gradualmente — las cosas se ponen más lentas. La presión
de memoria te mata al instante, en medio de un request, sin chance de drenar. Esa
asimetría significa que los límites de memoria merecen mucho más margen que los de
CPU.

### La curva de costo es superlineal

El precio de las instancias de nube es más o menos lineal en vCPU hasta que deja
de serlo:

```
  cost
   │                                        ╱  ← specialised/large SKUs:
   │                                    ╱      the price per vCPU rises
   │                          ╱─────╱
   │              ╱───────╱
   │      ╱───╱
   │  ╱╱
   └────────────────────────────────────────►  vCPUs
     2    4     8     16      32      64     128
```

Y la curva de *beneficio* es sublineal, por dos razones:

**La ley de Amdahl** — si una fracción *s* de tu trabajo es inherentemente serial,
el mejor speedup que vas a conseguir con *N* procesadores es
`1 / (s + (1-s)/N)`. Con un 10% de trabajo serial, infinitos cores te dan **10×**.
No 100×. No 1000×. Diez.

**Contención** — más hilos sobre estado compartido significa más contención de
locks, más rebote de líneas de cache, más presión de GC. Pasado cierto punto,
agregar cores hace *más lento* un programa mal formado.

Costo superlineal contra beneficio sublineal es por qué el vertical scaling siempre
termina.

### Los cuatro límites duros

1. **La máquina más grande existe.** GCP topea alrededor de 224 vCPU / 12 TB
   (`m3-ultramem`). Es muy cara y en algún momento vas a llegar.
2. **Es un único punto de falla.** Una máquina enorme tiene un solo destino. Este
   es el argumento que normalmente gana, antes que el costo.
3. **Redimensionar normalmente requiere un reinicio.** El vertical scaling no es
   elástico — no podés seguir un pico de tráfico con él en tiempo real.
4. **Amdahl te topea** sin importar el presupuesto.

### Cuándo el vertical scaling es genuinamente la respuesta correcta

No sobre-aprendas la lección. Agarrá una máquina más grande cuando:

- **La carga tiene estado y es difícil de distribuir** — una base de datos
  primaria es el caso canónico. Shardear una base (Cápsula 12) es un proyecto que
  se mide en trimestres; duplicarle la RAM es una tarde.
- **Estás limitado por memoria sobre un working set que tiene que estar en un
  solo lugar.**
- **Estás temprano.** Dos ingenieros y 500 usuarios no necesitan un sistema
  distribuido. Una VM grande y dormir bien es la arquitectura correcta.
- **La fracción serial es grande** — algunas cargas simplemente no paralelizan, y
  un core más rápido es la única palanca.

**El principio general: escalá vertical hasta que sea incómodo, después escalá
horizontal.** La distribución prematura es el error más caro: te cuesta
complejidad, latencia, problemas de consistencia y dificultad de debugging *para
siempre*, a cambio de capacidad que todavía no necesitabas.

### La trampa de CPU en containers (esta le pega a todo el mundo)

Un runtime que le pregunta al SO "¿cuántas CPUs hay?" recibe la cuenta del
**host**, no el límite del cgroup. Dale a un container `--cpus=1` en una máquina
de 10 cores y Go igual va a poner `GOMAXPROCS=10`, corriendo diez hilos de SO que
colectivamente reciben la cuota de un core.

El resultado: mucho context switching, tormentas de GC assist, y **picos de
latencia con una utilización de CPU que se ve bien**. Es uno de los problemas de
producción más comunes y más confusos en Go containerizado.

La misma clase de bug existe en la JVM (resuelto con
`-XX:+UseContainerSupport`, activo por defecto en JDKs modernos) y en el
dimensionamiento del thread pool de `libuv` en Node.

Lo vas a reproducir más abajo.

> Go 1.25 hizo al runtime consciente de cgroups, así que `GOMAXPROCS` respeta el
> límite de CPU automáticamente. En versiones anteriores — incluida la 1.23 de
> estas cápsulas — lo ponés vos o usás `go.uber.org/automaxprocs`. Conocé el
> mecanismo igual; la trampa equivalente en otros runtimes está viva y coleando.

---

## Lab — encontrá tu propio techo

En `~/repos/pato/gravity-chamber`.

### Paso 1 — algo que realmente queme CPU

Agregá a **`internal/scouter/server.go`**, en `Routes()`:

```go
	mux.HandleFunc("GET /train", s.handleTrain)
```

y el handler, más sus imports de `crypto/sha256` y `strconv`:

```go
// handleTrain burns CPU on purpose: a deliberately serial hash chain that
// no amount of parallelism inside one request can speed up.
//
// CALIBRATE `rounds` ON YOUR MACHINE — do not trust a number from a README.
// ARM chips (Apple Silicon, Graviton) have SHA-256 in hardware and run this
// loop roughly 5x faster than an x86 core without the extension. On an M-series
// Mac 1,000,000 rounds is ~100ms; on an older x86 laptop 200,000 might be.
func (s *Server) handleTrain(w http.ResponseWriter, r *http.Request) {
	rounds := 1_000_000
	if v := r.URL.Query().Get("rounds"); v != "" {
		// NOTE THE SILENT FALLBACK. Ask for more than the cap and you get the
		// DEFAULT, with no error — so a too-large `rounds` looks like a very
		// fast machine rather than a rejected request. Always check
		// `duration_ms` in the response rather than trusting what you asked
		// for. (Capsule 07 leans on this endpoint; if its "slow" requests come
		// back in 20ms, this is why.)
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50_000_000 {
			rounds = n
		}
	}

	start := time.Now()
	sum := sha256.Sum256([]byte("kaio-ken"))
	for i := 0; i < rounds; i++ {
		sum = sha256.Sum256(sum[:]) // each round needs the previous one
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"rounds":      rounds,
		"digest":      hex.EncodeToString(sum[:8]),
		"duration_ms": time.Since(start).Milliseconds(),
		"gomaxprocs":  runtime.GOMAXPROCS(0),
		"num_cpu":     runtime.NumCPU(),
	})
}
```

Agregá los imports: `crypto/sha256`, `encoding/hex`, `runtime`.

Fijate qué reporta la respuesta: **`gomaxprocs` y `num_cpu`**. Que esos dos números
no coincidan es la trampa.

### Paso 2 — calibrá, después medí la línea de base

```bash
make docker-build
docker run -d --rm -p 8080:8080 --name kaioken scouter:latest

curl -s "localhost:8080/train?rounds=1000000" | jq
```

**Calibrá antes de medir cualquier cosa.** Toda la cápsula depende de que un
request tarde lo suficiente como para dominar el overhead de HTTP — apuntá a
**~200 ms**. Si te salteás esto, la escalera del Paso 3 es casi todo ruido:

```bash
# Encontrá el valor de rounds que caiga cerca de 200ms en TU máquina.
for r in 250000 500000 1000000 2000000 4000000; do
  ms=$(curl -s "localhost:8080/train?rounds=$r" | jq .duration_ms)
  echo "rounds=$r  ${ms}ms"
done
```

Elegí el más cercano a 200 y fijalo para el resto de la cápsula:

```bash
export ROUNDS=2000000     # <- TU número, no este
```

> Apple Silicon y AWS Graviton implementan SHA-256 en hardware, así que
> necesitan cerca de **5× los rounds** que necesita un core x86 sin esa
> extensión. Esto es un buen hábito en sí mismo: un benchmark que no calibraste
> en la máquina bajo prueba está midiendo la máquina, no tu cambio.

Anotá `num_cpu` y `gomaxprocs`. Ahora medí el throughput con un loop de carga
rudimentario pero honesto:

```bash
# 40 requests, 8 at a time — no extra tooling needed
time (for i in $(seq 1 40); do
        curl -s -o /dev/null "localhost:8080/train?rounds=$ROUNDS" &
        [ $((i % 8)) -eq 0 ] && wait
      done; wait)
```

Anotá el tiempo transcurrido. `docker stop kaioken`.

### Paso 3 — la escalera del Kaio-ken

Corré la misma carga en cada límite de CPU y anotá los números:

```bash
for cpus in 0.25 0.5 1 2 4; do
  docker run -d --rm -p 8080:8080 --name kaioken --cpus=$cpus scouter:latest >/dev/null
  sleep 1
  echo "=== --cpus=$cpus ==="
  time (for i in $(seq 1 40); do
          curl -s -o /dev/null "localhost:8080/train?rounds=$ROUNDS" &
          [ $((i % 8)) -eq 0 ] && wait
        done; wait)
  docker stop kaioken >/dev/null
done
```

Poné esto en una tabla en `NOTES.md`:

| `--cpus` | tiempo | req/s | speedup vs 0.25 | *lineal* sería |
|---|---|---|---|---|
| 0.25 | | | 1,0× | 1× |
| 0.5 | | | | 2× |
| 1 | | | | 4× |
| 2 | | | | 8× |
| 4 | | | | 16× |

**Mirá las dos últimas columnas.** En algún punto el speedup real deja de seguir
al teórico. Ese hueco es Amdahl más contención más la cantidad real de cores de tu
laptop — y encontrar esa rodilla es la habilidad de capacidad más útil de todo
este repo.

Mientras uno esté corriendo, abrí `lazydocker` → **Stats** y mirá el gráfico de
CPU clavarse exactamente en el límite. Ese techo plano es el throttling de cgroups,
en vivo.

### Paso 4 — reproducí la trampa de GOMAXPROCS

```bash
docker run --rm --cpus=1 scouter:latest &   # (or just curl the running one)
curl -s "localhost:8080/train?rounds=100000" | jq '{gomaxprocs, num_cpu}'
```

Vas a ver algo como `{"gomaxprocs": 10, "num_cpu": 10}` en una máquina de 10 cores
**aunque el container esté limitado a 1 CPU**. Diez hilos ejecutables peleando por
la cuota de un core.

Ahora arreglalo y compará:

```bash
docker run -d --rm -p 8081:8081 --name fixed --cpus=1 \
  -e PORT=8081 -e GOMAXPROCS=1 scouter:latest

curl -s "localhost:8081/train?rounds=100000" | jq '{gomaxprocs, num_cpu, duration_ms}'
```

Corré la carga concurrente contra los dos y compará la latencia de cola, no solo
la media. El que tiene GOMAXPROCS sin restringir normalmente muestra un p99 peor —
ese es el costo del context switching, y es exactamente lo que hace tan difícil de
detectar este bug desde un dashboard que muestra CPU promedio saludable.

La solución de producción es un import en `main.go`:

```go
import _ "go.uber.org/automaxprocs"   // go get go.uber.org/automaxprocs
```

Lee la cuota del cgroup al arrancar y pone `GOMAXPROCS` en consecuencia.
Agregalo — es un hábito genuinamente bueno para cualquier servicio Go
containerizado en Go < 1.25.

### Paso 5 — conocé al OOM killer

La presión de CPU es educada. La de memoria no.

Agregá temporalmente un handler que aloque:

```go
	mux.HandleFunc("GET /bulk", func(w http.ResponseWriter, r *http.Request) {
		mb := 50
		if v := r.URL.Query().Get("mb"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 4096 {
				mb = n
			}
		}
		hold := make([][]byte, 0, mb)
		for i := 0; i < mb; i++ {
			b := make([]byte, 1<<20)
			for j := range b {
				b[j] = byte(i) // touch every page so it's really resident
			}
			hold = append(hold, b)
		}
		writeJSON(w, http.StatusOK, map[string]any{"allocated_mb": len(hold)})
	})
```

```bash
make docker-build
docker run -d --rm -p 8080:8080 --name oom --memory=256m scouter:latest

curl -s "localhost:8080/bulk?mb=100" | jq     # fine
curl -s "localhost:8080/bulk?mb=400" | jq     # ...

docker inspect oom --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

`curl` recibe una respuesta vacía. `OOMKilled: true`, código de salida **137**
(128 + SIGKILL).

**No hubo logs de shutdown.** El graceful shutdown que construiste en la Cápsula
01 nunca corrió, porque SIGKILL no se puede atrapar. Todos los requests en vuelo
de esa instancia murieron. Anotá el código 137 — reconocerlo al instante te va a
ahorrar una hora algún día.

Sacá el handler `/bulk` cuando termines. Dejá `/train`; la Cápsula 09 lo usa.

---

## En GCP

Límites verticales de **Cloud Run**: hasta 8 vCPU y 32 GiB por instancia (gen2).
La facturación es `vCPU-segundos × precio + GiB-segundos × precio`, así que
duplicar la CPU más o menos duplica el costo por unidad de tiempo.

```bash
gcloud run deploy scouter --cpu=2 --memory=1Gi --region=us-central1
```

Dos particularidades de Cloud Run que vale la pena conocer:

- **`--cpu-boost`** da CPU extra solo durante el arranque del container. Es una
  solución dirigida a la latencia de cold start sin pagar por una instancia más
  grande todo el tiempo.
- **La CPU se estrangula a casi cero entre requests** salvo que pongas
  `--no-cpu-throttling` (también llamado "CPU always allocated"). Si corrés
  goroutines en segundo plano — un refrescador de cache, un flusher de batch — se
  van a frenar misteriosamente entre requests. Esto sorprende a todo el mundo una
  vez.

Familias de máquinas de **Compute Engine**, y para qué son:

| Familia | Forma | Uso |
|---|---|---|
| `e2` | barata, opciones de core compartido | dev, servicios chicos. Irregular e impredecible |
| `n2` / `n2d` | balanceada | el default |
| `c3` / `c2` | clock alto, optimizada para cómputo | trabajo limitado por CPU, game servers |
| `m3` | memoria enorme (hasta 12 TB) | bases de datos en memoria, caches grandes |

**Cloud SQL** es donde de verdad vas a hacer vertical scaling en serio: cambiás el
tipo de máquina y se reinicia (una caída breve, o un failover si HA está prendido).
Por eso planificar capacidad para una base de datos importa más que para servicios
sin estado — redimensionar tiene un costo que no podés esconder.

---

## Llevátelo al trabajo

- **Siempre poné requests y limits.** Memoria sin límite significa que un request
  malo desaloja a sus vecinos; CPU sin límite significa performance impredecible.
- **Dale más margen a la memoria que a la CPU.** La presión de CPU degrada; la de
  memoria mata sin aviso.
- **Conocé la historia de conciencia de containers de tu runtime.**
  `automaxprocs` para Go < 1.25, `UseContainerSupport` para la JVM,
  `UV_THREADPOOL_SIZE` para Node.
- **El código de salida 137 significa OOMKilled.** Memorizalo.
- **Medí la rodilla antes de comprar la máquina más grande.** "Probamos 1, 2, 4 y
  8 vCPU; la ganancia de 4→8 fue del 12%" es un argumento de capacidad real. "Se
  siente lento" no.
- **Enunciá el techo explícitamente en los documentos de diseño**: "esto nos lleva
  a ~8k RPS, después necesitamos horizontal scaling y un cache compartido".

---

## Battle drill

<details>
<summary><b>1.</b> La latencia se duplicó. La utilización de CPU marca 45%. ¿Qué estás mirando?</summary>

La utilización es un promedio y esconde todo lo interesante:

- **Throttling de CPU** — cuota del cgroup agotada dentro de cada período de 100
  ms. El promedio se ve bien; el proceso está frenado durante parte de cada
  período. Mirá `container_cpu_cfs_throttled_seconds_total`, no la utilización.
- **La trampa de GOMAXPROCS** — demasiados hilos para la cuota disponible, así que
  el tiempo se va en context switching.
- **No estás limitado por CPU en absoluto** — contención de locks, E/S de disco,
  una dependencia lenta o pausas de GC. Todo eso muestra CPU baja con latencia
  alta.
- **Encolamiento** — estás en la rodilla de la curva de latencia, donde un aumento
  chico de utilización produce un aumento grande de latencia (Cápsula 09).

La lección: **utilización no es saturación.** Las métricas de saturación
(profundidad de cola, tiempo estrangulado, longitud de la run-queue) son las que
te lo dicen.
</details>

<details>
<summary><b>2.</b> Un compañero dice "estamos al 80% de CPU, dupliquemos el tamaño de la instancia". ¿Qué preguntás?</summary>

- Latencia p50 vs p99 — ¿alguien está sufriendo de verdad, o el 80% es solo
  eficiencia?
- ¿Está throttleando, o genuinamente haciendo trabajo?
- ¿Cuál es la *tasa de crecimiento*? Duplicar te compra una duplicación; si el
  tráfico crece 20% por mes, eso son menos de cuatro meses.
- ¿El servicio es sin estado? Si sí, horizontal probablemente sea más barato y más
  seguro.
- ¿Qué dice el profiling? Una sola query mala o un N+1 (Cápsula 10) suele valer
  10× y no cuesta nada por mes.
- ¿Cuánto sale la instancia más grande por mes contra dos de la actual?

Duplicar la máquina es una respuesta legítima — solo que rara vez es lo *primero*
que conviene revisar.
</details>

<details>
<summary><b>3.</b> ¿Por qué el vertical scaling sigue siendo la respuesta correcta para una base de datos primaria mucho más tiempo que para la capa web?</summary>

La capa web es sin estado: las réplicas son intercambiables y agregar una es un
cambio de configuración. Una base primaria tiene estado, así que "agregar una"
significa elegir entre sharding (ruteo a nivel aplicación, queries entre shards,
proyectos de resharding — Cápsula 12) o un sistema SQL distribuido como Spanner
(caro, con otras restricciones).

Las dos son trimestres de trabajo. Duplicar la instancia es una tarde y un
reinicio. Así que comprás tiempo verticalmente, a propósito, mientras construís la
respuesta horizontal — y te asegurás de empezar a construirla antes del techo, no
después.
</details>

<details>
<summary><b>4.</b> Tu servicio tiene 10% de trabajo inherentemente serial. ¿Cuál es la cantidad máxima útil de cores?</summary>

Amdahl: speedup = 1 / (0,1 + 0,9/N). Con N=8 → 4,7×. Con N=16 → 6,4×. Con N=∞ →
**10×**.

Así que pasar de 8 a 16 cores cuesta 2× y compra 1,36×. Ese es el momento en que
el vertical scaling deja de tener sentido económico, y el número que ponés en el
documento de diseño.

La jugada de mayor apalancamiento suele ser atacar la fracción serial en sí — el
lock global, el generador secuencial de IDs, el paso de serialización de un solo
hilo.
</details>

<details>
<summary><b>5.</b> ¿Por qué la presión de memoria es más peligrosa que la de CPU en un container?</summary>

La CPU es *comprimible*: excedés tu cuota y el kernel te estrangula, así que vas
más lento pero seguís corriendo y podés hacer load shedding o escalar.

La memoria es *incomprimible*: no existe "correr al 80% de memoria". Excedés el
límite y el OOM killer del kernel manda SIGKILL — inatrapable, sin drenado, sin
hooks de shutdown, todos los requests en vuelo perdidos, salida 137.

Consecuencias prácticas: poné límites de memoria con margen real, conocé tu perfil
de asignación bajo carga pico, acotá los tamaños de body de request
(`http.MaxBytesReader` de la Cápsula 01), y paginá todo lo que pueda devolver un
conjunto de resultados sin límite.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `--cpus` parece no tener efecto | Docker Desktop/OrbStack tiene su propia asignación de CPU a nivel VM. Mirá su configuración; el container no puede exceder a la VM. |
| Los tiempos son muy inconsistentes | Cerrá otras apps, corré cada test dos veces para atenuar el ruido térmico, y tomá la mediana. Las laptops son pésimos hosts de benchmark — lo que importa es la *forma* de la curva, no los números absolutos. |
| El container sale con 137 | OOMKilled. Subí `--memory` o reducí la asignación. |
| El container sale con 139 | SIGSEGV — un crash real, no un límite. |
| `gomaxprocs` sigue mal después de `automaxprocs` | El import tiene que ser en blanco (`_ "go.uber.org/automaxprocs"`) y en el paquete de `main`. Corré `go mod tidy`. |
| `/train` vuelve al instante | `rounds` está topeado en 5.000.000 y por defecto es 200.000. Subilo si tu máquina es rápida. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(scouter): cpu-bound /train endpoint and automaxprocs

Capsule 05. Measured the vertical scaling curve from 0.25 to 4 vCPU and
found the knee. Reproduced the GOMAXPROCS-vs-cgroup trap and fixed it.
Confirmed OOM kill is SIGKILL: no graceful shutdown, exit 137."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 05
```

**Siguiente:** [Cápsula 06 · Multiformas — Horizontal scaling y statelessness](../06-multi-form-horizontal-scaling/README.md)
