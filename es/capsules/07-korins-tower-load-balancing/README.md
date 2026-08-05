# Cápsula 07 · La Torre de Karin — Load balancing

> *Todo el que quiere semillas del ermitaño sube la misma torre. Karin está
> arriba decidiendo quién pasa, quién está listo y quién tiene que volver abajo.
> Nadie llega arriba por accidente, y Karin sabe exactamente quién está ahí.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 6 | 70 min | Cápsula 06 | Local + concepto |

---

## Por qué existe esta cápsula

Tenés N réplicas. Algo tiene que decidir cuál recibe cada request — y ese algo
hace mucho más que elegir un número. Un load balancer es donde realmente viven el
health checking, el connection draining, la terminación TLS, los reintentos, los
timeouts y el traffic splitting.

Casi todo lo que hace que un deploy sea invisible para los usuarios (Cápsula 24)
se implementa en el load balancer. Hacé bien esta capa y una instancia muriéndose
es un no-evento; hacela mal y cada deploy es una ráfaga de errores.

---

## El concepto

### L4 vs L7

La distinción más importante, y se reduce a **qué tiene permitido leer el
balanceador**.

```
  L4 (transport)                      L7 (application)
  ─────────────────                   ─────────────────
  sees: IP + port                     sees: the full HTTP request
  routes: whole TCP connections       routes: individual requests
  fast, cheap, protocol-agnostic      smarter, costlier, HTTP/gRPC-aware

  cannot: route by path or header     can: /api → A, /static → B
  cannot: retry a failed request      can: retry idempotent requests
  cannot: terminate TLS meaningfully  can: terminate TLS, add headers,
  cannot: understand HTTP/2 streams         rate limit, compress, split traffic
```

La consecuencia que se pasa por alto: **L4 balancea conexiones, L7 balancea
requests.** Con HTTP/2 o gRPC, una sola conexión de larga vida lleva miles de
requests. Un balanceador L4 clava esa conexión entera a un backend — así que un
servicio gRPC "balanceado" puede tener un backend al 90% de CPU y el resto
ocioso. Ese es el clásico desbalance de gRPC detrás de un LB L4, y la solución es
un balanceador L7 (o load balancing del lado del cliente).

Usá L4 para TCP crudo, bases de datos, protocolos no HTTP, y cuando necesitás
throughput extremo a costo mínimo. Usá L7 para básicamente todo el tráfico HTTP.

### Algoritmos, y cuándo el default está mal

| Algoritmo | Cómo | Usalo cuando |
|---|---|---|
| **Round robin** | el siguiente backend en orden | los requests son uniformes. El default |
| **Least connections** | el que tiene menos en vuelo | las duraciones de request varían mucho |
| **Least request / least loaded** | menos requests pendientes, a veces ponderado | el mejor default general para L7 |
| **Random two-choices** | elegís 2 al azar, tomás el menos cargado | asombrosamente bueno, sin estado global — lo que usan los meshes modernos |
| **Consistent hashing** | hash de una clave → backend | necesitás localidad de cache (Cápsula 15) o afinidad de sesión |
| **Ponderado** | proporcional | deploys canary, instancias de tamaños mixtos (Cápsula 24) |

**El modo de falla del round robin:** es ciego a cuánto tardan los requests. Si 1
de cada 20 requests es un reporte de 5 segundos y el resto son de 10 ms, round
robin manda alegremente nuevos requests rápidos a la instancia que ya está trabada
con uno lento. Least-request o two-choices lo arregla gratis.

### Los health checks son el mundo entero del load balancer

Un LB solo sabe lo que le dicen sus health checks. Tres parámetros, y cada uno es
un trade-off:

- **intervalo** — cada cuánto sondear. Corto = detección rápida, más carga.
- **timeout** — cuánto esperar. Tiene que ser menor que el intervalo.
- **umbrales** — cuántas fallas consecutivas lo marcan insano (y cuántos éxitos
  para volver a marcarlo sano).

**Tiempo de detección ≈ intervalo × umbral-insano.** Con un intervalo de 10 s y
umbral 3, un backend muerto sigue recibiendo tráfico durante **30 segundos**. Ese
es tu piso real de recuperación, y casi nadie hace esta multiplicación.

**Sondeá readiness, no liveness.** De la Cápsula 01: `/readyz` es el que dice
"mandame tráfico". Apuntá el LB ahí.

**La trampa de la falla correlacionada:** si tu check de readiness pinguea la base
de datos y la base parpadea, *todos* los backends fallan readiness al mismo tiempo
y el LB se queda sin targets sanos. Algunos LBs entonces fallan abierto (mandan a
todos) y otros fallan cerrado (503 a todo) — sabé cuál hace el tuyo. Una
mitigación común es que readiness refleje *la capacidad de esta instancia* de
servir, degradando con gracia en vez de todo o nada.

### Connection draining

Cuando sacás un backend — un deploy, un scale-down, un drenado de nodo — el LB
tiene que dejar de mandar requests *nuevos* pero dejar terminar los que están en
vuelo.

```
  t=0   backend marked for removal
  t=0   LB stops sending NEW requests to it
  t=0…D existing requests complete  (D = drain timeout)
  t=D   remaining connections forcibly closed
```

La secuencia completa de gracia, de punta a punta, que ya es la cuarta vez que
este repo la dibuja porque es lo que todos hacen mal:

```
  1. LB: stop new traffic      ← readiness fails (Capsule 01)
  2. app: finish in-flight     ← http.Server.Shutdown (Capsule 01)
  3. app: exit                 ← exec-form ENTRYPOINT so SIGTERM arrives (Capsule 02)
  4. LB: forget the backend
```

Rompé cualquiera de los cuatro y los deploys producen 502.

### Qué más vive en el LB

- **Terminación TLS** — certificados en un solo lugar, texto plano (o
  re-cifrado) por detrás.
- **HTTP/2 y HTTP/3** hacia los clientes, aunque tus backends hablen HTTP/1.1.
- **Traffic splitting** — 5% a la revisión nueva (Cápsula 24).
- **Ruteo por path/host** — `/api` → un servicio, `/` → otro.
- **Reintentos, timeouts, expulsión de outliers** — a veces; mirá la Cápsula 17
  para saber por qué los reintentos a nivel LB necesitan un presupuesto.

### Load balancing global y anycast

El Application Load Balancer externo global de GCP usa **anycast**: una sola
dirección IP anunciada desde cada ubicación de borde de Google en el mundo. Un
usuario en São Paulo y otro en Frankfurt pegan a la *misma IP* y son ruteados a su
borde de Google más cercano por BGP, y después por la red privada de Google hasta
tu backend.

Dos consecuencias que vale la pena saber: TLS termina cerca del usuario (así que
los round trips caros del handshake son cortos), y después el tráfico de larga
distancia viaja por la red de Google en vez de por internet público. Es una
ganancia de latencia significativa y es la razón por la que "una IP global" es
posible.

---

## Lab

### Paso 1 — mirá los algoritmos diferir

Construí sobre el setup de la Cápsula 06. Reemplazá **`deploy/nginx.conf`**:

```nginx
events { worker_connections 1024; }

http {
  log_format upstreamlog '$remote_addr -> $upstream_addr '
                         'status=$status rt=$request_time urt=$upstream_response_time';
  access_log /dev/stdout upstreamlog;

  upstream scouters {
    # least_conn;                      # <- uncomment in Step 3
    server scouter:8080 max_fails=2 fail_timeout=10s;
    keepalive 32;                      # reuse upstream connections
  }

  server {
    listen 80;

    # Health of the LB itself, not the backends.
    location = /lb-health { return 200 "lb ok\n"; }

    location / {
      proxy_pass http://scouters;
      proxy_http_version 1.1;
      proxy_set_header Connection "";        # required for keepalive to work

      proxy_connect_timeout 2s;
      proxy_send_timeout    10s;
      proxy_read_timeout    10s;

      # Only retry on connection-level failures, and never on a request
      # that has already been sent to a non-idempotent endpoint.
      proxy_next_upstream error timeout http_502 http_503;
      proxy_next_upstream_tries 2;
      proxy_next_upstream_timeout 5s;

      add_header X-Upstream $upstream_addr always;
    }
  }
}
```

```bash
cd deploy
docker compose -f docker-compose.scale.yml up --build -d
```

Confirmá que round robin distribuye parejo:

```bash
for i in $(seq 1 30); do
  curl -si localhost:8080/healthz | awk '/X-Upstream/{print $2}'
done | sort | uniq -c
```

Más o menos 10/10/10.

### Paso 2 — el punto ciego del round robin

Ahora mezclá requests lentos y rápidos. `/train` de la Cápsula 05 es tu endpoint
lento.

```bash
# 6 slow requests in the background — these will pin some backends
for i in $(seq 1 6); do
  curl -s -o /dev/null "localhost:8080/train?rounds=3000000" &
done

sleep 1

# now 20 fast ones, and measure how long each takes
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{time_total} %{http_code}\n" localhost:8080/healthz
done | sort -n | tail -5

wait
```

> Reusá el `ROUNDS` que calibraste en la Cápsula 05 y multiplicalo por ~15 — acá
> lo que importa es un request lo bastante lento como para *ver* el desbalance, no
> un número puntual. En ARM, 3.000.000 de rounds son apenas ~300 ms y la
> diferencia entre round-robin y `least_conn` queda invisible.

Algunos requests rápidos tardaron mucho más de lo que deberían — round robin los
mandó a un backend ya ocupado con una cadena de hashes. Anotá los peores tiempos.

### Paso 3 — cambiá a least connections

Descomentá `least_conn;` en `nginx.conf`, después:

```bash
docker compose -f docker-compose.scale.yml restart lb
```

Volvé a correr el Paso 2 exactamente igual. Compará la cola (`tail -5`). Debería
ser visiblemente mejor: nginx ahora evita backends con requests en vuelo.

> **La conclusión no es "least_conn es mejor".** Es que *el algoritmo importa
> exactamente cuando las duraciones de request varían*, y que solo podés ver la
> diferencia en la **cola**, no en el promedio. Si hubieras medido la media,
> habrías concluido que no había diferencia.

### Paso 4 — health checks y tiempo de detección

Mirá el failover suceder, y cronometralo.

```bash
# continuous requests with visible status
while true; do
  curl -s -o /dev/null -w "%{http_code} " localhost:8080/healthz
  sleep 0.25
done &

# kill one backend
docker compose -f docker-compose.scale.yml ps -q scouter | head -1 | xargs docker kill
```

Vas a ver una racha de `502` antes de que se estabilice. Esa racha es tu ventana
de detección — con `max_fails=2 fail_timeout=10s`, nginx necesita dos fallas antes
de expulsar el backend, y esas dos fallas son errores reales de usuarios.

Ahora achicala:

```nginx
    server scouter:8080 max_fails=1 fail_timeout=5s;
```

```bash
docker compose -f docker-compose.scale.yml restart lb
```

Repetí. Menos errores, detección más rápida — al costo de ser más nervioso ante
parpadeos transitorios (ahora una sola respuesta lenta expulsa un backend sano).
**Ese trade-off nunca desaparece.** La detección agresiva saca capacidad sana
durante el ruido; la conservadora manda usuarios a backends muertos.

```bash
kill %1
```

### Paso 5 — drenado, bien hecho y mal hecho

**Mal** (lo que la mayoría hace por defecto):

```bash
docker compose -f docker-compose.scale.yml ps -q scouter | head -1 | xargs docker kill  # SIGKILL
```

Instantáneo. Todos los requests en vuelo cortados. Así se ve un deploy con
`--force`, un OOM kill o una interrupción de nodo.

**Bien:**

```bash
# start slow requests
for i in 1 2 3; do curl -s -o /dev/null -w "%{http_code}\n" "localhost:8080/train?rounds=3000000" & done

# graceful stop: SIGTERM, then wait
docker compose -f docker-compose.scale.yml ps -q scouter | head -1 | xargs -I{} docker stop -t 30 {}
wait
```

Los tres devuelven `200`. Tu código de shutdown de la Cápsula 01 los drenó.

Ahora mirá el hueco honesto: nginx acá no tiene health checking activo (es una
feature de nginx Plus), así que solo se entera de que un backend se fue *fallando
un request* contra él. Tu `DRAIN_DELAY` de 2 segundos es lo que cubre esa ventana
— la instancia sigue sirviendo mientras ya reporta not-ready, dándole tiempo al LB
a darse cuenta.

**En infraestructura real** (GCLB, Envoy, Kubernetes) el LB sondea readiness
activamente, así que fallar `/readyz` te saca proactivamente antes de que falle
ningún request. Esa es la razón entera por la que readiness existe como concepto
separado.

```bash
docker compose -f docker-compose.scale.yml down
```

---

## En GCP

> **Solo concepto.** Un Application Load Balancer externo global cuesta unos
> **USD 18/mes solo por existir**, antes de cualquier tráfico. No crees uno para
> practicar. Leé la anatomía; vas a reconocer cada pieza.

### La anatomía de un GCLB

GCP descompone un load balancer en recursos con nombre, lo cual confunde hasta que
lo ves como una cadena:

```
  Forwarding Rule      "IP 34.x.x.x port 443 goes here"
        │
  Target HTTPS Proxy   TLS termination + certificate
        │
  URL Map              /api/* → backend A,  /* → backend B     ← the L7 routing
        │
  Backend Service      algorithm, timeout, CDN on/off, Cloud Armor policy
        │              + a HEALTH CHECK
        │
  Backend (NEG / MIG)  the actual instances, pods, or Cloud Run services
```

En Terraform eso es `google_compute_global_forwarding_rule` →
`google_compute_target_https_proxy` → `google_compute_url_map` →
`google_compute_backend_service` → `google_compute_health_check` +
`google_compute_region_network_endpoint_group`.

Cada uno de esos nombres mapea a un concepto de arriba. El **URL Map** es donde
vive el ruteo L7. El **Backend Service** es donde se enganchan el algoritmo, los
timeouts, el CDN y el WAF.

### El menú de load balancers de GCP

| Producto | Capa | Alcance | Para qué |
|---|---|---|---|
| **Application LB externo global** | L7 | global, anycast | HTTP(S) público. El default |
| **Application LB externo regional** | L7 | una región | cuando los datos tienen que quedarse en la región |
| **Application LB interno** | L7 | interno a la VPC | HTTP entre servicios |
| **Network LB externo passthrough** | L4 | regional | TCP/UDP crudo, throughput extremo |
| **Network LB interno passthrough** | L4 | interno a la VPC | TCP interno |

Además: **Cloud CDN** es un checkbox en el backend service (Cápsula 16), y
**Cloud Armor** es una política de WAF/DDoS enganchada a él (Cápsula 08).

### Cloud Run te da uno gratis

Deployás a Cloud Run y ya tenés: un certificado TLS gestionado por Google, un
front end L7 con HTTP/2, health checking, ruteo por request entre instancias y
traffic splitting. Agregarías un GCLB explícito adelante solo cuando necesitás un
dominio propio con tu certificado, Cloud Armor, Cloud CDN, o ruteo entre varios
backends bajo un mismo hostname.

---

## Llevátelo al trabajo

- **Apuntá los health checks a readiness, no a liveness**, y hacé la cuenta:
  `intervalo × umbral` es cuánto tiempo un backend muerto sigue recibiendo
  tráfico.
- **Fallá readiness antes de dejar de aceptar**, y hacé que el retardo de drenado
  sea de al menos un intervalo de health check.
- **Preferí least-request sobre round robin** para cualquier cosa con costo de
  request variable.
- **L4 delante de gRPC/HTTP-2 te va a desbalancear.** Usá L7 o LB del lado del
  cliente.
- **Medí la cola.** Las decisiones de load balancing son invisibles en la media.
- **Sabé si tu LB falla abierto o cerrado** cuando no hay backends sanos.
- **Los reintentos a nivel LB necesitan presupuesto.** Los reintentos ciegos
  convierten una falla parcial en total (Cápsula 17).

---

## Battle drill

<details>
<summary><b>1.</b> Cada deploy produce una ráfaga de 502. Recorré las causas.</summary>

Chequeá la secuencia de cuatro pasos en orden:

1. **Sin drenado previo al stop** — la instancia deja de aceptar apenas recibe
   SIGTERM, pero el LB todavía la cree sana por un intervalo más de health check.
   Solución: fallá readiness primero, después dormí ≥ un intervalo, después
   apagate.
2. **SIGTERM no llega al proceso** — ENTRYPOINT en forma shell (Cápsula 02), así
   que al proceso lo matan en vez de drenarlo.
3. **Timeout de shutdown menor que el request más largo** — `Shutdown` se rinde y
   cierra conexiones en pleno vuelo.
4. **Instancias nuevas marcadas sanas antes de estar listas** — sin gate de
   readiness, así que llega tráfico antes de que los pools y caches estén
   calientes.

La pista para distinguir #1 de #2: con #1 ves logs de shutdown limpios y 502 igual;
con #2 no ves ningún log de shutdown.
</details>

<details>
<summary><b>2.</b> Tu servicio gRPC tiene 10 réplicas; una está al 90% de CPU y el resto ocioso. ¿Por qué?</summary>

Un load balancer L4, o un cliente que abrió una conexión y la mantuvo. gRPC
multiplexa muchos requests sobre una sola conexión HTTP/2 de larga vida, y un
balanceador L4 rutea *conexiones*, no requests — así que una vez que la conexión
de un cliente cae en un backend, cada request siguiente va ahí también.

Soluciones: un balanceador **L7** que entienda streams de HTTP/2 (Application LB
interno de GCLB, Envoy, un service mesh); **load balancing del lado del cliente**
con re-resolución periódica; o forzar el reciclado de conexiones con
`MAX_CONNECTION_AGE` en el servidor para que los clientes se redistribuyan con el
tiempo.
</details>

<details>
<summary><b>3.</b> ¿El load balancer debería reintentar requests fallidos?</summary>

Solo bajo condiciones estrictas, y es más peligroso de lo que parece:

- **Solo requests idempotentes.** Un `POST /payments` reintentado cobra dos veces.
- **Solo fallas a nivel conexión** (error de conexión, timeout antes de que el
  request se enviara) — no un 500, que el backend generó *después* de trabajar.
- **Con un presupuesto de reintentos.** Si el 30% de los backends está fallando,
  los reintentos ciegos agregan 30% más de carga a los sobrevivientes y cascadean
  la falla. Envoy topea los reintentos a un porcentaje de los requests activos
  exactamente por esto.
- **Nunca reintentes un 4xx.** Va a fallar igual para siempre.

La Cápsula 17 lo cubre en profundidad. La versión corta: los reintentos son un
multiplicador de carga aplicado en el peor momento posible.
</details>

<details>
<summary><b>4.</b> Intervalo de health check 10 s, umbral insano 3, y la app tarda 40 s en arrancar. ¿Qué se rompe?</summary>

Dos problemas separados:

**Detección**: un backend muerto sirve errores hasta 30 segundos (10 × 3) antes de
ser expulsado. Si tu SLO es ajustado, eso es la mayor parte de tu error budget en
un solo evento.

**Arranque**: salvo que tengas un `start_period` / `initialDelaySeconds` / startup
probe, el health checker empieza a sondear de inmediato, junta 3 fallas, y marca
como muerta una instancia *perfectamente sana pero todavía booteando* — posiblemente
matándola y reiniciándola para siempre en un crash loop donde la app nunca llega a
terminar de arrancar.

Para eso están los startup probes: un check separado y más paciente que tiene que
pasar una vez antes de que empiece el sondeo de liveness/readiness.
</details>

<details>
<summary><b>5.</b> Tu check de readiness pinguea la base de datos. La base parpadea 20 segundos. ¿Qué pasa en el LB?</summary>

Todos los backends fallan readiness a la vez, así que el LB tiene **cero backends
sanos**. El comportamiento depende del LB: algunos fallan abierto (mandan a todos
los backends igual, lo cual es discutiblemente mejor — la app puede devolver una
respuesta degradada), algunos fallan cerrado (503 a todo).

Peor: si es un check de *liveness*, el orquestador reinicia todas las instancias
simultáneamente — y ahora tenés cold starts y una tormenta de conexiones pegándole
a una base que se estaba recuperando.

Mejor diseño: readiness debería reflejar "¿puede esta instancia hacer trabajo
útil?", que para muchos servicios sigue siendo *sí* durante un parpadeo de la base
(lecturas cacheadas, endpoints de salud, caminos que no tocan la DB). Reservá la
falla dura de readiness para "esta instancia específicamente está rota".
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| Falta el header `X-Upstream` | Necesita `always` — `add_header X-Upstream $upstream_addr always;`. |
| Todo el tráfico va a un backend | nginx resolvió `scouter` una vez al arrancar. Reiniciá el LB después de escalar, o usá un `resolver` con una variable en `proxy_pass`. |
| `upstream timed out` en `/train` | `proxy_read_timeout` es menor que el request. Subilo o bajá `rounds`. |
| `502` inmediato en cada request | Los backends todavía no están arriba, o el puerto está mal. `docker compose logs scouter`. |
| `least_conn` no hace diferencia visible | Tus requests cuestan todos lo mismo. El punto entero es el costo variable — asegurate de que los lentos estén corriendo de verdad. |
| nginx no arranca | Sintaxis. `docker compose exec lb nginx -t` imprime la línea exacta. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(deploy): nginx load balancer with health checks and draining

Capsule 07. Compared round-robin vs least_conn under mixed request costs —
difference shows only in the tail. Measured failover detection time as
interval x threshold. Verified graceful drain returns 200s where SIGKILL
severs in-flight requests."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 07
```

**Siguiente:** [Cápsula 08 · El escritorio de Enma Daio — Proxies, gateways y el borde](../08-king-yemmas-desk-gateways/README.md)
