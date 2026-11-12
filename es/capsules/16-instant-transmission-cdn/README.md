# Cápsula 16 · Teletransportación — CDN y el borde

> *Goku se pone dos dedos en la frente y llega al instante — pero solo a un lugar
> que ya puede sentir. No puede teletransportarse a un lugar donde nunca estuvo.
> Un CDN es exactamente eso: distancia cero hacia un lugar que ya está caliente, y
> el viaje completo para todo lo demás.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 7 | 75 min | Cápsulas 14–15 | Local + concepto |

---

## Por qué existe esta cápsula

Cada optimización hasta acá hizo más rápido tu *servidor*. Ninguna tocó el
componente individual más grande de lo que experimenta un usuario: **la velocidad
de la luz.**

Un round trip de Sídney a `us-central1` es ~160 ms. TLS necesita un handshake. Una
página necesita varios round trips. Podés sacarle 40 ms a tu handler y el usuario
de Sídney no lo va a notar, porque 500 ms de sus 600 ms eran red.

El borde es donde vive realmente esa latencia — y `Cache-Control` es la
herramienta de performance más desaprovechada de la ingeniería web.

---

## El concepto

### Qué es un CDN

Un conjunto globalmente distribuido de reverse proxies con cache (points of
presence, POPs) entre tus usuarios y tu origen.

```
   Sydney user ──2ms──► Sydney POP ──HIT?──► response.   Done.
                             │
                            MISS
                             │
                             └──160ms──► us-central1 origin
```

Tres ganancias, en orden de tamaño:

1. **Los cache hits nunca llegan a tu origen.** Latencia de ~5 ms en vez de
   ~160 ms, y tu origen ve una fracción del tráfico.
2. **TLS termina cerca del usuario.** Los round trips del handshake son de 2 ms en
   vez de 160 ms — esto ayuda *incluso para contenido no cacheable*, lo que
   sorprende a la gente.
3. **El tramo largo corre por la red privada del proveedor**, que es más rápida y
   más confiable que internet público.

Hay una cuarta: **absorción de DDoS.** La capacidad de un CDN es enorme, y el
tráfico de ataque se absorbe en el borde.

### `Cache-Control`, en serio

El header que hace el trabajo:

```http
Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=60
```

| Directiva | Significa |
|---|---|
| `public` | cualquier cache puede guardarlo (CDN incluido) |
| `private` | **solo el navegador** — los CDNs no deben guardarlo. Usalo para respuestas personalizadas |
| `no-store` | nunca guardar en ningún lado. Tokens de auth, datos sensibles |
| `no-cache` | guardar, pero **siempre revalidar** antes de servir (mal nombrado) |
| `max-age=N` | frescura en segundos, para todos los caches |
| `s-maxage=N` | frescura solo para caches *compartidos*; pisa a `max-age` en el CDN |
| `stale-while-revalidate=N` | servir datos viejos hasta N segundos pasada la expiración mientras se refresca en segundo plano |
| `stale-if-error=N` | servir datos viejos por N segundos si el origen está fallando |
| `immutable` | el contenido de esta URL nunca va a cambiar; ni siquiera revalides |

**`stale-while-revalidate` es la directiva de más valor que la mayoría de los
equipos no usa.** Hace invisible la expiración del cache: nadie espera nunca un
refresco, y es exactamente el patrón que construiste a mano en la Cápsula 15,
disponible gratis como un header.

**`stale-if-error` es disponibilidad gratis.** Tu origen se cae; el CDN sigue
sirviendo la última respuesta buena. Los usuarios no notan la caída.

### Validadores: ETag y Last-Modified

Cuando algo expira, el cache no tiene que volver a descargarlo:

```http
→ GET /leaderboard
← 200 OK
  ETag: "a1b2c3"
  Cache-Control: max-age=60

  … 60 seconds later …

→ GET /leaderboard
  If-None-Match: "a1b2c3"
← 304 Not Modified          ← no body. Bytes saved, latency saved.
```

Un `304` cuesta solo headers. Para un payload JSON de 500 KB eso son 500 KB de
ahorro en cada revalidación.

`ETag` es exacto (normalmente un hash del body). `Last-Modified` tiene granularidad
de un segundo y es más débil. Usá ETag.

### El patrón de assets inmutables

La técnica de caching de front-end más efectiva que existe, y es solo una
convención de nombres:

```
  /static/app.js              →  Cache-Control: no-cache      (must revalidate)
  /static/app.a1b2c3d4.js     →  Cache-Control: max-age=31536000, immutable
```

Poné un hash del contenido en el nombre del archivo. La URL *es* la versión, así
que el contenido nunca puede cambiar — cacheálo un año sin ninguna revalidación.
Deployás un build nuevo y es un nombre nuevo, así que es una entrada de cache
nueva. **La invalidación se vuelve innecesaria**, que es por qué todo bundler
moderno lo hace por defecto.

El HTML que referencia esos archivos se mantiene de vida corta. Una revalidación
chiquita trae todo lo demás gratis.

### Cache keys, y la trampa de vary

Por defecto la clave es la URL completa. Cualquier cosa que cambie la respuesta
pero no la URL va a servirse al usuario equivocado salvo que lo declares:

```http
Vary: Accept-Encoding, Accept-Language
```

**`Vary: Cookie` deshabilita el caching en la práctica** — cada valor distinto de
cookie se vuelve una entrada de cache separada, así que el hit ratio se va a cero.
Si una respuesta depende de una cookie, marcala `private` y dejá de pretender que
es cacheable.

**La versión catastrófica de este bug:** cachear una página personalizada bajo una
clave compartida. El dashboard del usuario A se le sirve al usuario B. Es una
filtración de datos, no un bug de performance, y le pasó a empresas grandes más de
una vez.

Reglas: sacá de la clave de cache los parámetros de query que no afectan la
respuesta (`utm_source`, `fbclid`) o tu hit ratio colapsa; nunca cachees nada
detrás de autenticación salvo que la clave incluya la identidad *y* estés seguro.

### Purgar vs versionar

Purgar (invalidar contenido del CDN) es lento (segundos a minutos), tiene rate
limit, a veces cuesta plata, y es eventualmente consistente entre cientos de POPs.

**Preferí URLs versionadas.** Nunca purgues lo que podés renombrar. Reservá la
purga para emergencias — un documento filtrado, un precio equivocado, una baja
legal.

### El presupuesto de latencia

Escribilo para un usuario real:

```
  DNS lookup                 20 ms   (cached after first visit)
  TCP handshake              30 ms   (1 RTT)
  TLS handshake              30 ms   (1 RTT with TLS 1.3; 0 on resumption)
  ─────────────────────────────────
  connection setup           80 ms   ← all of this happens at the POP with a CDN
  request → CDN               5 ms
  CDN → origin (miss)       160 ms
  origin processing          40 ms
  response transfer          30 ms
  ─────────────────────────────────
  total on a MISS           315 ms
  total on a HIT             35 ms
```

**Un cache hit es ~9× más rápido que tu mejor respuesta posible de origen.**
Ninguna optimización de backend puede competir con no hacer el viaje.

---

## Lab

Podés construir un borde de CDN real en local: nginx como proxy con cache delante
del Scouter, que es genuinamente cómo funcionan los CDNs.

### Paso 1 — headers de cache en tu API

En `internal/scouter/server.go`:

```go
func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	board := s.store.Leaderboard(limit)

	body, err := json.Marshal(board)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "encode failed")
		return
	}

	// A strong ETag: a hash of exactly the bytes we would send.
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)

	// public          — shared caches may store it (it is not personalised)
	// max-age=10      — browsers hold it 10s
	// s-maxage=30     — the CDN holds it 30s (longer; it serves many users)
	// stale-while-revalidate=60 — nobody ever waits for a refresh
	// stale-if-error=300        — if the origin dies, keep serving for 5 min
	w.Header().Set("Cache-Control",
		"public, max-age=10, s-maxage=30, stale-while-revalidate=60, stale-if-error=300")
	w.Header().Set("Vary", "Accept-Encoding")

	// Conditional request: the client already has this exact body.
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	_, _ = w.Write(body)
}
```

Y para cualquier cosa personalizada — una regla, no una sugerencia:

```go
func (s *Server) handleGetFighter(w http.ResponseWriter, r *http.Request) {
	// Per-fighter data is public here, but the moment a response depends on
	// WHO is asking, it must be private/no-store or a CDN will serve one
	// user's data to another. That is a breach, not a slow page.
	w.Header().Set("Cache-Control", "public, max-age=5, s-maxage=15")
	// …
}
```

### Paso 2 — mirá los 304

```bash
make run

ETAG=$(curl -sI localhost:8080/leaderboard | awk '/[Ee][Tt]ag/{print $2}' | tr -d '\r')
echo "etag=$ETAG"

curl -si -H "If-None-Match: $ETAG" localhost:8080/leaderboard | head -1
# HTTP/1.1 304 Not Modified   ← zero body bytes

curl -s -o /dev/null -w "full:  %{size_download} bytes\n" localhost:8080/leaderboard
curl -s -o /dev/null -w "304:   %{size_download} bytes\n" \
  -H "If-None-Match: $ETAG" localhost:8080/leaderboard
```

### Paso 3 — un borde de CDN local

**`deploy/nginx-cdn.conf`**

```nginx
events {}
http {
  # A disk-backed cache: 10MB of keys, 100MB of bodies. This is a POP.
  proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=edge:10m
                   max_size=100m inactive=10m use_temp_path=off;

  log_format edge '$request_uri  cache=$upstream_cache_status  rt=$request_time';
  access_log /dev/stdout edge;

  upstream origin { server host.docker.internal:8080; }

  server {
    listen 80;

    location / {
      proxy_pass http://origin;
      proxy_cache edge;

      # Trust the ORIGIN's Cache-Control. Overriding it here is how you end up
      # with a CDN and an app that disagree about freshness.
      proxy_cache_revalidate on;                       # send If-None-Match upstream

      # Request coalescing: concurrent misses for the same key become ONE
      # origin request. Capsule 15's singleflight, at the edge.
      proxy_cache_lock on;
      proxy_cache_lock_timeout 5s;

      # stale-while-revalidate / stale-if-error, nginx spelling.
      proxy_cache_background_update on;
      proxy_cache_use_stale updating error timeout http_500 http_502 http_503 http_504;

      # The cache key. Note what is NOT here: cookies, auth headers.
      proxy_cache_key "$scheme$request_method$host$request_uri";

      add_header X-Cache-Status $upstream_cache_status always;
    }
  }
}
```

Corrélo:

```bash
docker run -d --rm --name edge -p 8090:80 \
  -v "$PWD/deploy/nginx-cdn.conf:/etc/nginx/nginx.conf:ro" \
  --add-host=host.docker.internal:host-gateway \
  nginx:alpine
```

```bash
curl -si localhost:8090/leaderboard | grep -i x-cache-status   # MISS
curl -si localhost:8090/leaderboard | grep -i x-cache-status   # HIT
curl -si localhost:8090/leaderboard | grep -i x-cache-status   # HIT
```

Medí la diferencia:

```bash
echo "--- origin ---"
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" localhost:8080/leaderboard; done
echo "--- edge ---"
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" localhost:8090/leaderboard; done
```

En una laptop los dos son rápidos, así que **simulá la distancia real**
haciendo lento al origen. Agregá un retardo temporal al handler del leaderboard
(importá `time` si el archivo todavía no lo importa), recompilá y reiniciá el
origen:

```go
// top of the leaderboard handler — TEMPORARY, delete after this step
time.Sleep(150 * time.Millisecond) // the origin is "on another continent"
```

Después vaciá el cache del edge, o la entrada vieja se sirve como `STALE`
mientras se refresca en segundo plano y nunca llegás a ver un MISS lento:

```bash
docker stop edge    # it was started with --rm, so its cache goes with it
```

Levantalo de nuevo con el mismo `docker run` de arriba y volvé a correr los dos
loops. El origen ahora tarda ~150 ms cada vez. A través del edge, el primer
request (el MISS) paga los 150 ms y los HIT que siguen vuelven en un milisegundo
o dos. **El MISS lo paga. El HIT no.** Ese hueco es el producto entero. Sacá el
sleep antes de seguir.

> ¿Por qué no retrasar la red, con `tc qdisc … netem` adentro del contenedor del
> edge? Porque eso retrasa *cada* paquete que sale del edge, incluido el HIT que
> vuelve a tu `curl` — un HIT costaría lo mismo que un MISS, que es justo lo
> contrario de lo que querés ver. Para simular distancia con `netem` tendrías
> que filtrar por destino. El sleep pone el retardo exactamente donde está la
> distancia real: entre el edge y el origen.

### Paso 4 — protección del origen bajo falla

```bash
# hammer the edge while the origin is DOWN
curl -s localhost:8090/leaderboard > /dev/null    # populate

# kill the origin (Ctrl-C the `make run` process)

curl -si localhost:8090/leaderboard | head -1
```

Sigue siendo `200`, servido viejo, gracias a `proxy_cache_use_stale` +
`stale-if-error`. **Tu origen está caído y tus usuarios no se enteran.** Esta es
una de las configuraciones con mejor relación disponibilidad-por-esfuerzo que
existen, y son tres líneas.

### Paso 5 — probá la coalescencia de requests

Reiniciá el origen con un handler lento (300 ms), después:

```bash
docker exec edge sh -c 'rm -rf /var/cache/nginx/*'   # cold edge

time (for i in $(seq 1 50); do curl -s -o /dev/null localhost:8090/leaderboard & done; wait)
```

Mirá los logs del origen: con `proxy_cache_lock on` deberías ver **un** request, no
cincuenta. Apagá el lock, repetí, y contá de nuevo.

### Paso 6 — el error de cache key, hecho visible

```nginx
      # BROKEN — do not ship. Included so you can see the failure.
      proxy_cache_key "$scheme$request_method$host$uri";   # NOTE: $uri, not $request_uri
```

`$uri` excluye el query string. Recargá nginx y:

```bash
curl -s "localhost:8090/leaderboard?limit=3"  | jq 'length'   # 3
curl -s "localhost:8090/leaderboard?limit=50" | jq 'length'   # 3  ← WRONG
```

Dos requests distintos, una entrada de cache. Cambiás un carácter y le servís la
respuesta equivocada a todo el mundo.

Ahora imaginate `$uri` donde la diferencia fuera `?user_id=` en vez de `?limit=`.
**Así una mala configuración de CDN se convierte en una filtración de datos.**
Volvelo a `$request_uri`.

```bash
docker rm -f edge
```

---

## En GCP

> **Solo concepto.** Cloud CDN requiere un Application Load Balancer externo global
> (~USD 18/mes solo por existir). Leé el setup; no lo construyas.

**Cloud CDN** es un checkbox en un backend service:

```hcl
resource "google_compute_backend_service" "scouter" {
  name        = "scouter-backend"
  enable_cdn  = true

  cdn_policy {
    cache_mode        = "USE_ORIGIN_HEADERS"   # obey your Cache-Control
    default_ttl       = 3600
    client_ttl        = 300
    max_ttl           = 86400
    negative_caching  = true                   # cache 404s briefly
    serve_while_stale = 86400                  # stale-if-error

    cache_key_policy {
      include_protocol     = true
      include_host         = true
      include_query_string = true
      # Include ONLY the params that change the response. Everything else
      # (utm_source, fbclid, gclid) fragments the cache for nothing.
      query_string_whitelist = ["limit", "page"]
    }
  }
}
```

Opciones de `cache_mode`, y cuál elegir:

- **`USE_ORIGIN_HEADERS`** — respetá el `Cache-Control` de tu app. Correcto por
  defecto: la política de caching vive en el código que sabe qué significan los
  datos.
- `CACHE_ALL_STATIC` — cachea tipos de contenido estático automáticamente.
- `FORCE_CACHE_ALL` — cachea todo sin importar los headers. **Peligroso** — va a
  cachear alegremente respuestas autenticadas.

El resto del stack de borde:

- **Cloud Storage + Cloud CDN** para assets estáticos, con nombres hasheados y
  `Cache-Control: public, max-age=31536000, immutable`.
- **Cloud Armor** — WAF, protección DDoS, reglas de geo e IP, rate limiting en el
  borde (Cápsula 17). Se engancha al mismo backend service.
- **Media CDN** — un producto separado de mayor escala para streaming de video.
- **Invalidación**: `gcloud compute url-maps invalidate-cdn-cache <map> --path
  "/api/*"`. Tarda minutos, tiene rate limit, y es el último recurso. Versioná en
  su lugar.

---

## Llevátelo al trabajo

- **Poné `Cache-Control` a propósito en cada respuesta.** Sin header, cada cache
  adivina, y sus adivinanzas difieren.
- **`stale-while-revalidate` + `stale-if-error` en todos los GET públicos.** Dos
  directivas, ganancias grandes de latencia y disponibilidad.
- **Hasheá los nombres de assets estáticos y cacheálos un año, `immutable`.**
- **ETags en los endpoints JSON.** Los 304 son casi gratis y los clientes los
  obtienen automáticamente.
- **Auditá la cache key.** Whitelist de parámetros de query; nunca incluyas
  cookies; nunca cachees respuestas autenticadas bajo una clave compartida.
- **`private` o `no-store` para cualquier cosa personalizada.** Ante la duda, no
  cachees — el modo de falla es una filtración.
- **Versioná, no purgues.**
- **Medí la descarga del origen** (hit ratio en el borde). Es el número que te dice
  cuánto tráfico no estás pagando.

---

## Battle drill

<details>
<summary><b>1.</b> Los usuarios reportan que ven datos de otros usuarios. El CDN se deployó ayer. ¿Qué pasó?</summary>

Una respuesta personalizada se cacheó bajo una clave compartida. O le faltaba
`Cache-Control: private`, o la cache key omitía el elemento distintivo (la cookie
de sesión, el header de auth, el id de usuario en el path), o el CDN estaba en
`FORCE_CACHE_ALL`.

**Inmediato:** purgá todo, poné `cache_mode` en `USE_ORIGIN_HEADERS`, agregá
`Cache-Control: private, no-store` a cada respuesta autenticada, y confirmá
haciendo curl como dos usuarios distintos a través del CDN.

**Después:** esto es un incidente de seguridad con implicancias de notificación, no
una regresión de performance. Necesita una revisión de incidente.

**Prevención:** default a `no-store` y optá *explícitamente* por cachear endpoint
por endpoint; agregá un test de integración que traiga un endpoint autenticado a
través del CDN como dos usuarios y verifique que las respuestas difieren.
</details>

<details>
<summary><b>2.</b> El hit ratio de tu CDN es 12%. ¿Dónde mirás?</summary>

- **Fragmentación de la cache key** — `utm_source`, `fbclid` e ids de sesión en el
  query string hacen única cada URL. Whitelisteá los parámetros que importan.
- **`Vary: Cookie`** — una entrada por valor de cookie, así que efectivamente no hay
  caching.
- **TTLs muy cortos** relativos a la frecuencia de requests. Un TTL de 10 s en una
  URL pedida cada 60 s nunca es un hit.
- **`Cache-Control: private` / `no-store`** aplicado más ampliamente de lo
  pretendido.
- **Contenido genuinamente personalizado** — entonces 12% puede ser correcto, y la
  ganancia tiene que venir de cachear *fragmentos* o el shell en su lugar.
- **URLs de cola larga** — millones de páginas pedidas raramente nunca van a tener
  hit ratio alto en ningún lado.

Diagnosticalo agrupando los logs del CDN por estado de cache *y* por patrón de URL;
la respuesta casi siempre está concentrada en uno o dos patrones.
</details>

<details>
<summary><b>3.</b> ¿Por qué un CDN ayuda incluso para contenido que no se puede cachear?</summary>

**TLS y TCP terminan en el borde.** El establecimiento de conexión son 2–3 round
trips; a 80 ms por RTT eso son ~240 ms, a 2 ms son ~6 ms. Ese ahorro aplica a cada
request sin importar si es cacheable.

Después el fetch al origen corre por la **red privada** del proveedor con conexiones
pre-calentadas y pooleadas — ruteo más directo, menos congestión, menos
retransmisiones que internet público.

Además: HTTP/3 y TLS moderno en el borde aunque tu origen sea viejo; absorción de
DDoS; y filtrado de WAF antes de que el tráfico te llegue.

Google le dice "Cloud CDN con contenido dinámico" y AWS "CloudFront para
aceleración dinámica". Es una ganancia real y frecuentemente pasada por alto.
</details>

<details>
<summary><b>4.</b> Explicale <code>stale-while-revalidate</code> a un PM.</summary>

Sin eso, en el momento en que el contenido cacheado expira, el siguiente usuario
desafortunado espera el round trip completo al origen — así que un puñado de
usuarios al azar recibe una página lenta, y son los que se quejan.

Con eso, ese usuario recibe la versión un poquito vieja *al instante*, y el refresco
pasa en segundo plano. Nadie espera nunca.

El costo es que algunos usuarios ven contenido hasta N segundos más viejo de lo que
verían si no. Para un leaderboard, un listado de productos o un artículo eso es
irrelevante. Para el precio de una acción no.

Así que la pregunta que le devolvés al PM es exactamente la correcta: **"¿cuán
viejo es aceptable acá?"** — y esa es una decisión de producto con un número, no un
detalle de ingeniería.
</details>

<details>
<summary><b>5.</b> Diseñá el caching para un sitio de noticias: los artículos cambian poco, la home cambia seguido, algo del contenido está detrás de paywall.</summary>

Segmentá por tipo de contenido, porque tienen requisitos genuinamente distintos:

- **Assets estáticos** (JS/CSS/imágenes) — nombres hasheados,
  `max-age=31536000, immutable`. Cacheados para siempre en todas las capas.
- **Cuerpos de artículos** — `public, s-maxage=3600, stale-while-revalidate=86400`.
  Cambian poco; cuando lo hacen, la URL puede llevar una versión o purgás ese path.
- **Home** — `public, s-maxage=60, stale-while-revalidate=300`. Cambia seguido, no
  puede estar lenta nunca.
- **Contenido de paywall** — la trampa. Cacheá el **shell del artículo**
  públicamente y traé el cuerpo aparte con las credenciales del usuario; o usá
  ESI/lógica de borde para ensamblar. Nunca cachees el cuerpo pago públicamente, y
  nunca indexes por una cookie que no querías.
- **Secciones personalizadas** ("para vos") — cargalas del lado del cliente después
  de renderizar el shell, para que el shell siga siendo cacheable.
- **Imágenes** — un CDN de redimensionado con las dimensiones en la URL, así cada
  variante es su propio objeto inmutable.

El principio general: **partí la página en un shell cacheable y fragmentos
personalizados**, en vez de hacer toda la página no cacheable porque una parte lo
es.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `X-Cache-Status` siempre MISS | El origen manda `no-store`/`no-cache`, o `Set-Cookie` (nginx no cachea esas por defecto). Mirá los headers de respuesta. |
| `host.docker.internal` inalcanzable | Agregá `--add-host=host.docker.internal:host-gateway` en Linux. |
| Nunca se devuelve un 304 | El cliente no manda `If-None-Match`, o tu ETag cambia en cada request (no incluyas un timestamp). |
| El query string se ignora | `$uri` en vez de `$request_uri` en la cache key. |
| Contenido viejo después de un deploy | Eso es el caching funcionando. Versioná la URL, o purgá — y preferí versionar. |
| El CDN cachea páginas autenticadas | `cache_mode` es `FORCE_CACHE_ALL`, o a las respuestas les falta `private`. Arreglá las dos. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(http): cache-control, etags and a local CDN edge

Capsule 16. ETag + 304 on /leaderboard. stale-while-revalidate and
stale-if-error so refreshes are invisible and an origin outage is survivable.
nginx proxy_cache as a POP, with proxy_cache_lock for edge-level request
coalescing. Reproduced the \$uri-vs-\$request_uri cache-key bug."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 16
```

**Siguiente:** [Cápsula 17 · Suprimir el ki — Rate limiting, timeouts y backpressure](../17-ki-suppression-rate-limiting/README.md)
