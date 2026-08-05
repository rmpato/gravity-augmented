# Cápsula B2 · El Camino de la Serpiente — HTTP y redes esenciales

> *El Camino de la Serpiente tiene un millón de kilómetros y Goku lo corre entero. No
> se hace más rápido entrenando más — llega más rápido aprendiendo el recorrido. La
> latencia es una propiedad del camino, no de tu esfuerzo.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 70 min | ninguno | Cápsula 07 |

---

## Por qué existe esta cápsula

Toda cápsula sobre performance termina apoyándose en la red. Si los handshakes TLS,
el keep-alive, la multiplexación de HTTP/2 y los TTLs de DNS te quedan borrosos, vas a
optimizar la capa equivocada — sacándole 5 ms a un handler que gasta 200 ms armando
conexiones.

Esta es la capa que hay debajo de todo lo demás del repo.

---

## Los números para saber de memoria

```
  L1 cache reference                     0.5 ns
  Branch mispredict                        5 ns
  L2 cache reference                       7 ns
  Mutex lock/unlock                       25 ns
  Main memory reference                  100 ns
  Compress 1 KB                        3,000 ns   =   3 µs
  Send 1 KB over 1 Gbps                10,000 ns  =  10 µs
  SSD random read                     150,000 ns  = 150 µs
  Read 1 MB sequentially from memory  250,000 ns  = 250 µs
  Round trip within a datacenter      500,000 ns  = 500 µs
  Read 1 MB from SSD                1,000,000 ns  =   1 ms
  Disk seek (spinning)             10,000,000 ns  =  10 ms
  Round trip CA → Netherlands     150,000,000 ns  = 150 ms
```

Lo que importan son los ratios, no las cifras exactas:

- **La memoria es ~100× más rápida que un SSD. Un SSD es ~100× más rápido que un round
  trip intercontinental.**
- **Un round trip intercontinental cuesta lo mismo que 150.000 operaciones de mutex.**
- **Un round trip dentro del datacenter (~0,5 ms) son 5.000 referencias a memoria.**
  Por esto una query N+1 (Cápsula 10) es devastadora y un loop lento normalmente no.

**La consecuencia:** casi toda la latencia de un sistema distribuido es *esperar*, no
*computar*. Optimizá primero los round trips.

---

## El camino de un request

```
  1. DNS lookup                    0–100 ms   (cached after the first)
  2. TCP handshake (SYN/SYN-ACK/ACK)  1 RTT
  3. TLS handshake                    1 RTT   (TLS 1.3; 2 RTT for 1.2; 0 on resume)
  4. HTTP request                     1 RTT
  5. server processing              your code
  6. response transfer              size / bandwidth
```

A 80 ms de RTT eso son **240 ms antes de que corra tu handler**. Por esto:

- **Los CDNs ayudan incluso para contenido no cacheable** (Cápsula 16) — los pasos 2
  y 3 pasan en el borde.
- **La reutilización de conexiones es enorme** — los pasos 2 y 3 pasan una vez, no por
  request.
- **TLS 1.3 importa** — le sacó un round trip completo al handshake.

---

## TCP: las partes que muerden

**El handshake de tres vías** cuesta 1 RTT antes de que se mueva ningún dato.

**Slow start** — TCP no conoce el ancho de banda disponible, así que arranca con una
ventana de congestión chica (~10 paquetes ≈ 14 KB) y la duplica cada RTT. Una
respuesta de 200 KB necesita varios round trips solo para acelerar, incluso en un
enlace rápido.

Por esto **los primeros 14 KB de una respuesta son especiales**: meter tu HTML/CSS
crítico ahí significa que llega en el primer round trip. Es una optimización de
front-end real con una causa TCP.

**Head-of-line blocking** — TCP garantiza entrega ordenada, así que un paquete perdido
frena todo lo que viene detrás, incluso datos que ya llegaron. HTTP/2 multiplexa
streams sobre una conexión TCP, así que una sola pérdida frena *todos* los streams.
**HTTP/3 (QUIC sobre UDP) existe específicamente para arreglar esto.**

**El algoritmo de Nagle** bufferea escrituras chicas para reducir la cantidad de
paquetes. Combinado con ACKs demorados puede agregar ~40 ms a intercambios chicos de
request/response. La mayoría de las librerías RPC ponen `TCP_NODELAY` por esto.

---

## TLS

```
  TLS 1.2:  ClientHello → ServerHello+Cert → KeyExchange → Finished   2 RTT
  TLS 1.3:  ClientHello → ServerHello+Finished → Finished             1 RTT
  TLS 1.3 resumption (0-RTT):  data with the first packet             0 RTT
```

- **Usá TLS 1.3.** La mitad del handshake, menos suites de cifrado, ninguna opción
  conocidamente mala.
- **La reanudación de sesión** hace casi gratis las conexiones repetidas. Requiere
  reutilización de conexión o un cache de session tickets para funcionar.
- **0-RTT no es seguro contra replay.** Usalo solo para GETs idempotentes; un atacante
  puede reproducir datos 0-RTT.
- **Las cadenas de certificados cuestan bytes** en el handshake — una cadena más
  corta se nota más rápida, y es medible.
- **Terminá cerca del usuario** (Cápsula 16). Suele ser la ganancia de latencia más
  grande disponible.
- **mTLS** — los dos lados presentan certificados. La base de la auth
  servicio-a-servicio zero-trust y de los service meshes (Cápsula 08).

---

## Versiones de HTTP

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transporte | TCP | TCP | **QUIC sobre UDP** |
| Concurrencia | un request por conexión (6 por origen) | streams multiplexados | streams multiplexados |
| Head-of-line blocking | a nivel HTTP | **a nivel TCP** | ninguno |
| Headers | texto plano | comprimidos con HPACK | comprimidos con QPACK |
| Server push | no | deprecado | no |
| Migración de conexión | no | no | ✅ sobrevive a un cambio de red |

**La limitación real de HTTP/1.1** son las 6 conexiones por origen, que es por qué
existió la era del domain sharding y los sprite sheets. HTTP/2 eliminó eso, que es por
qué esas técnicas ahora son *dañinas*.

**La falla que le queda a HTTP/2** es el head-of-line blocking a nivel TCP:
multiplexar muchos streams sobre una conexión TCP significa que un paquete perdido los
frena a todos. En una red mobile con pérdida, HTTP/2 puede ser *peor* que HTTP/1.1.

**HTTP/3 lo arregla** moviéndose a QUIC sobre UDP con orden por stream, más migración
de conexión — pasar de Wi-Fi a celular no corta la conexión.

**gRPC corre sobre HTTP/2**, que es por qué necesita un load balancer L7 (Cápsula 07).

---

## Connection pooling y keep-alive

La configuración del lado del cliente con más impacto.

```go
// Go's DEFAULTS ARE WRONG for a service that fans out.
transport := &http.Transport{
	MaxIdleConns:        100,
	MaxIdleConnsPerHost: 32,  // DEFAULT IS 2. This is the one that hurts.
	IdleConnTimeout:     90 * time.Second,
	TLSHandshakeTimeout: 5 * time.Second,
	ForceAttemptHTTP2:   true,
}

client := &http.Client{
	Transport: transport,
	Timeout:   5 * time.Second,  // http.DefaultClient has NO timeout
}
```

`MaxIdleConnsPerHost: 2` significa que un servicio haciendo 50 llamadas concurrentes a
un backend abre y cierra 48 conexiones *por lote* — un handshake TCP + TLS completo
cada vez. Eso son ~2 RTT de puro desperdicio por llamada, y es invisible en tu código.

**Dos reglas:**

1. **Reutilizá un solo `http.Client`.** Crear uno por request anula el pooling por
   completo, y filtra conexiones.
2. **Siempre drená y cerrá el body**, incluso cuando no lo leés — si no, la conexión
   no se puede reutilizar:

```go
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()
```

---

## DNS

```
  browser cache → OS cache → resolver → root → TLD → authoritative
```

- **El TTL controla la velocidad de failover.** Un TTL de 300 segundos significa hasta
  5 minutos de tráfico a un endpoint muerto después de cambiar el registro.
- **Los TTL bajos cuestan lookups.** 60 s es un compromiso común para registros que
  quizás tengas que cambiar rápido.
- **Muchos clientes ignoran los TTL.** La JVM históricamente cacheaba DNS para
  siempre; el resolver de Go cachea por lookup; los pools de conexiones retienen una
  IP resuelta durante la vida de la conexión. **`MaxConnLifetime` en tus pools**
  (Cápsula 10) es en parte un mecanismo de frescura de DNS.
- **El load balancing por DNS es grueso** — sin conciencia de salud, sin failover
  rápido. El load balancing real pasa en L4/L7 (Cápsula 07), con DNS apuntando a una
  IP anycast estable.

---

## Timeouts, capa por capa

Cada uno de estos tiene un default, y varios de los defaults son "infinito".

```go
// SERVER (Capsule 01)
&http.Server{
	ReadHeaderTimeout: 5 * time.Second,   // Slowloris defence. Default: NONE
	ReadTimeout:       15 * time.Second,
	WriteTimeout:      30 * time.Second,
	IdleTimeout:       60 * time.Second,
}

// CLIENT
&http.Client{Timeout: 5 * time.Second}   // whole request. Default: NONE

// DIALER — finer control
&net.Dialer{
	Timeout:   3 * time.Second,           // connect
	KeepAlive: 30 * time.Second,          // TCP keep-alive probes
}
```

Y el deadline que pisa a todos: `context.WithTimeout` (Cápsula 17), porque es
heredable.

---

## Lab

### Paso 1 — mirá las fases de un request

```bash
cat > /tmp/curl-format.txt <<'EOF'
    dns_lookup:  %{time_namelookup}s
   tcp_connect:  %{time_connect}s
 tls_handshake:  %{time_appconnect}s
   pretransfer:  %{time_pretransfer}s
     first_byte:  %{time_starttransfer}s
         total:  %{time_total}s
EOF

curl -w "@/tmp/curl-format.txt" -o /dev/null -s https://cloud.google.com
curl -w "@/tmp/curl-format.txt" -o /dev/null -s https://cloud.google.com   # warm DNS
```

La segunda corrida es más rápida — el DNS está cacheado. Ahora probá con algo lejano y
mirá crecer cada fase proporcionalmente. **Esa es la velocidad de la luz en tu
terminal.**

### Paso 2 — medí la reutilización de conexiones

```bash
# 10 separate connections (new TCP + TLS each time)
time (for i in $(seq 1 10); do curl -s -o /dev/null https://cloud.google.com; done)

# 10 requests, ONE connection
time curl -s -o /dev/null https://cloud.google.com \
     $(for i in $(seq 1 9); do echo -n "-o /dev/null https://cloud.google.com "; done)
```

Típicamente **2–4× más rápido** para la conexión reutilizada. Ese es el valor entero
del keep-alive, en una sola comparación.

### Paso 3 — probá que el default de pooling de Go está mal

```go
// scripts/pooltest/main.go
package main

import (
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

func bench(name string, client *http.Client, url string, n int) {
	start := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := client.Get(url)
			if err != nil {
				return
			}
			// MUST drain and close, or the connection is not reusable.
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}()
	}
	wg.Wait()
	fmt.Printf("%-28s %d requests in %v\n", name, n, time.Since(start).Round(time.Millisecond))
}

func main() {
	url := "http://localhost:8080/healthz"

	bench("default (2 idle/host)", &http.Client{Timeout: 5 * time.Second}, url, 200)

	tuned := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        200,
			MaxIdleConnsPerHost: 100,
			IdleConnTimeout:     90 * time.Second,
		},
	}
	bench("tuned (100 idle/host)", tuned, url, 200)
}
```

```bash
make run &          # the Scouter on :8080
go run ./scripts/pooltest
```

Después mirá la rotación de conexiones:

```bash
# macOS
netstat -an | grep 8080 | grep TIME_WAIT | wc -l
```

El cliente por defecto deja una pila de sockets en `TIME_WAIT` — cada uno es una
conexión que se abrió, se usó una vez y se descartó.

### Paso 4 — multiplexación de HTTP/2

```bash
curl -sI --http1.1 https://cloud.google.com | head -1
curl -sI --http2   https://cloud.google.com | head -1
curl -sI --http3   https://cloud.google.com | head -1   # if your curl supports it
```

```bash
# 20 parallel requests over each version
time (for i in $(seq 1 20); do curl -s --http1.1 -o /dev/null https://cloud.google.com & done; wait)
time (for i in $(seq 1 20); do curl -s --http2   -o /dev/null https://cloud.google.com & done; wait)
```

HTTP/2 los multiplexa sobre una conexión en vez de abrir seis y encolar.

### Paso 5 — mirá qué contiene realmente un handshake

```bash
openssl s_client -connect cloud.google.com:443 -tls1_3 </dev/null 2>/dev/null \
  | grep -E 'Protocol|Cipher|Verify return'

# the certificate chain — every certificate costs handshake bytes
openssl s_client -connect cloud.google.com:443 -showcerts </dev/null 2>/dev/null \
  | grep -c 'BEGIN CERTIFICATE'
```

### Paso 6 — el presupuesto de latencia de tu propio sistema

```bash
python3 - <<'PY'
scenarios = {
    "same zone":        0.0005,
    "cross-zone":       0.001,
    "cross-region US":  0.030,
    "US → EU":          0.090,
    "US → APAC":        0.150,
}
for name, rtt in scenarios.items():
    setup = 2 * rtt          # TCP + TLS 1.3
    one   = setup + rtt
    five  = setup + 5 * rtt  # 5 sequential calls
    print(f"{name:<18} 1 call: {one*1000:>6.1f} ms   "
          f"5 sequential: {five*1000:>6.1f} ms   "
          f"5 parallel: {(setup + rtt)*1000:>6.1f} ms")
PY
```

```
same zone           1 call:    1.5 ms   5 sequential:    3.5 ms   5 parallel:    1.5 ms
cross-zone          1 call:    3.0 ms   5 sequential:    7.0 ms   5 parallel:    3.0 ms
cross-region US     1 call:   90.0 ms   5 sequential:  210.0 ms   5 parallel:   90.0 ms
US → EU             1 call:  270.0 ms   5 sequential:  630.0 ms   5 parallel:  270.0 ms
US → APAC           1 call:  450.0 ms   5 sequential: 1050.0 ms   5 parallel:  450.0 ms
```

**Dos conclusiones que le dan forma a la arquitectura:**

1. **Mantené cómputo y datos en la misma región.** Entre regiones es 30–100× la
   latencia, y está en cada llamada.
2. **El fan-out paralelo es gratis en relación al secuencial** (Cápsula 23). Cinco
   llamadas secuenciales entre regiones es un segundo; cinco paralelas son 270 ms.

---

## Llevátelo al trabajo

- **Configurá `MaxIdleConnsPerHost`.** El default de 2 está mal para cualquier
  servicio que haga fan-out.
- **Un solo `http.Client` compartido**, nunca `http.DefaultClient` (sin timeout),
  nunca uno nuevo por request.
- **Siempre drená y cerrá los bodies de respuesta** o las conexiones no se reutilizan.
- **`ReadHeaderTimeout` en cada servidor.** Si no, es un vector de DoS documentado.
- **Contá round trips, no milisegundos de CPU.** Ahí está el tiempo.
- **La misma región para cómputo y datos.**
- **TLS 1.3, terminado cerca del usuario.**
- **`MaxConnLifetime` en los pools** para que los cambios de DNS y los failovers se
  tomen.
- **Conocé tus TTLs de DNS** — son tu piso de failover.

---

## Battle drill

<details>
<summary><b>1.</b> Tu API tarda 40 ms en la misma región y 400 ms para un usuario en Sídney. ¿Dónde está el tiempo?</summary>

Casi enteramente en round trips. Sídney → us-central1 es ~160 ms de RTT, así que:

- Handshake TCP: 1 RTT = 160 ms
- Handshake TLS 1.3: 1 RTT = 160 ms
- El request en sí: 1 RTT = 160 ms

Eso son 480 ms antes de tus 40 ms de trabajo — y el hecho de que vean 400 ms significa
que la reutilización de conexiones ya está ayudando.

Soluciones, por impacto: **un CDN o presencia en el borde** para que TCP y TLS
terminen a ~2 ms (Cápsula 16); **reutilización de conexiones y reanudación de sesión**
para que los requests repetidos salteen el handshake; **menos round trips** — una
llamada al BFF en vez de cuatro (Cápsula 23); **HTTP/3** si la red tiene pérdida; y
finalmente **un deploy regional** con replicación de datos, que es la respuesta cara.

Fijate que optimizar tu handler es lo *último* de esa lista, y normalmente es lo
primero que la gente prueba.
</details>

<details>
<summary><b>2.</b> ¿Por qué HTTP/2 puede ser más lento que HTTP/1.1 en una red mobile?</summary>

**Head-of-line blocking a nivel TCP.** HTTP/2 multiplexa todos los streams sobre una
conexión TCP. TCP garantiza entrega ordenada, así que un solo paquete perdido frena
*todos* los streams hasta que se retransmite — incluso streams cuyos datos ya
llegaron.

HTTP/1.1 con seis conexiones paralelas tiene seis streams TCP independientes, así que
una pérdida frena solo un sexto del trabajo.

En una red limpia HTTP/2 gana decisivamente (sin setup de conexión por request,
compresión de headers, multiplexación real). En una red mobile con 2–5% de pérdida de
paquetes, el bloqueo puede dominar.

**HTTP/3 lo resuelve bien**: QUIC implementa orden por stream sobre UDP, así que una
pérdida en el stream 3 no toca los streams 1, 2 y 4. Más migración de conexión, así
que pasar de Wi-Fi a celular no resetea nada.
</details>

<details>
<summary><b>3.</b> ¿Qué es TIME_WAIT y cuándo se vuelve un problema?</summary>

Después de cerrar una conexión TCP, el lado que cerró primero mantiene el socket en
`TIME_WAIT` por 2×MSL (típicamente 60 s en Linux). Existe para que paquetes demorados
de la conexión vieja no se malinterpreten como pertenecientes a una nueva sobre el
mismo par de puertos.

Se vuelve un problema cuando un cliente abre muchas conexiones de vida corta: cada una
consume un puerto efímero por 60 segundos, y solo hay ~28.000 por defecto
(`net.ipv4.ip_local_port_range`). A 500 conexiones nuevas por segundo los agotás en
menos de un minuto y ves `cannot assign requested address`.

**La solución posta es la reutilización de conexiones** — keep-alive más un pool bien
dimensionado. Tunear `tcp_tw_reuse` o ampliar el rango de puertos trata el síntoma.

El diagnóstico: `netstat -an | grep TIME_WAIT | wc -l` en los miles significa que algo
no está pooleando. En Go, la causa habitual es un body de respuesta sin drenar o un
`http.Client` por request.
</details>

<details>
<summary><b>4.</b> Explicá la regla de los 14 KB.</summary>

El slow start de TCP arranca con una ventana de congestión inicial de ~10 paquetes. A
~1460 bytes de payload por paquete eso son aproximadamente **14 KB** que el servidor
puede mandar antes de tener que esperar un ACK.

Así que una respuesta de menos de 14 KB llega en **un round trip**. A 15 KB pagás un
segundo RTT — 160 ms extra para un usuario lejano, por un kilobyte de más.

Por esto los consejos de performance de front-end dicen que inlinees el CSS crítico y
mantengas chico el HTML inicial: no es superstición, es la ventana de congestión.

También aplica a las APIs. Una respuesta JSON de 13 KB y una de 20 KB pueden diferir
en un round trip completo. La compresión (`gzip`/`brotli`) ayuda directamente
llevándote por debajo del umbral.
</details>

<details>
<summary><b>5.</b> Un deploy cambió un registro DNS hace 10 minutos y parte del tráfico sigue pegándole a los servidores viejos. ¿Por qué?</summary>

Capas de caching, la mayoría de las cuales ignoran tu intención:

- **El TTL no venció** — si era de 3600 s, te quedan otros 50 minutos.
- **Resolvers que ignoran el TTL** — algunos resolvers de ISP y corporativos imponen
  sus propios mínimos.
- **Caching de DNS a nivel aplicación** — la JVM históricamente cacheaba para siempre
  (`networkaddress.cache.ttl`); muchos clientes HTTP cachean resoluciones.
- **Conexiones establecidas** — un pool de conexiones retiene una IP ya resuelta
  durante la vida de la conexión. El DNS es irrelevante para una conexión que ya está
  abierta. **Esta suele ser la respuesta real**, y es por qué existe
  `MaxConnLifetime`.

**La lección: DNS no es un mecanismo de failover.** Para un cutover rápido y confiable,
usá una IP anycast estable con un load balancer L7 que haga health checks de los
backends (Cápsula 07), y cambiá los *backends*, no el DNS.

Bajá el TTL bien antes de un cambio planificado (horas antes), y configurá los tiempos
de vida de conexión para que los pools roten.
</details>

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(http): tune client connection pooling

Capsule B2. MaxIdleConnsPerHost raised from the default 2; single shared
client with an explicit timeout; response bodies drained so connections are
reusable. Measured the difference under 200 concurrent requests."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done B2
```
