# Cápsula 23 · El Gran Saiyaman — Backend for Frontend

> *Gohan es el mismo peleador en los Juegos de Cell y en Ciudad Satán. Pero en
> Ciudad Satán se pone un casco, una capa y una rutina de poses ridícula, porque ese
> público necesita una presentación completamente distinta. El mismo poder abajo, una
> fachada por audiencia. No le pide a los ciudadanos de Ciudad Satán que entiendan
> biología saiyajin.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 8 | 85 min | Cápsulas 08, 22 | Local |

---

## Por qué existe esta cápsula

Ahora tenés varios servicios. Una app mobile necesita datos de tres de ellos para
renderizar una pantalla. Tiene tres opciones, y dos son malas:

1. **Llamarlos a los tres ella misma** — tres round trips sobre una conexión 4G, el
   cliente conoce toda tu topología, y cada refactor del backend rompe la app.
2. **Hacer que un servicio agregue por ella** — ese servicio ahora sirve a dos amos y
   lentamente vuelve a ser un monolito.
3. **Un BFF** — un servicio delgado que existe *para ese cliente*, propiedad del
   equipo dueño de ese cliente.

El BFF es uno de los pocos patrones que es casi siempre correcto una vez que tenés
más de un tipo de cliente, y falta con frecuencia en respuestas de system design
donde correspondería.

---

## El concepto

### El problema que resuelve

```
  WITHOUT A BFF                        WITH A BFF

  📱 ──┬──► readings                   📱 ──► mobile-bff ──┬──► readings
       ├──► ranking                                        ├──► ranking
       └──► profiles                                       └──► profiles
                                       🖥 ──► web-bff ─────┬──► readings
  3 round trips over mobile network                        ├──► ranking
  client knows the topology                                └──► profiles
  over-fetching (it needs 4 fields
    of a 60-field response)            1 round trip, exactly the fields needed
```

**Tres ganancias distintas:**

- **Latencia.** Un request en vez de N. Sobre una red mobile con 100 ms de RTT,
  colapsar 4 llamadas secuenciales ahorra ~300 ms — más que cualquier optimización de
  backend que vayas a hacer.
- **Forma del payload.** Devolvés exactamente lo que la pantalla renderiza. Una lista
  mobile necesita `name`, `power`, `rank`; los objetos completos podrían ser 40× más
  grandes.
- **Desacoplamiento.** Los servicios de backend pueden refactorizar libremente; el
  BFF absorbe el cambio. El contrato del cliente es estable.

### Un BFF por *tipo de cliente*, no por cliente

```
  ✅ web-bff, mobile-bff, partner-api-bff, tv-bff
  ❌ ios-bff, android-bff, ipad-bff      (same needs → one BFF)
  ❌ one-bff-for-everything              (that's just a gateway again)
```

La señal para un BFF nuevo es un **patrón de consumo genuinamente distinto**, no una
plataforma distinta. iOS y Android normalmente renderizan las mismas pantallas; una
app de smart TV y una integración de partner no.

**La propiedad es el punto.** Un BFF es propiedad del equipo de *frontend*, en su
repo, deployado a su cadencia. Si un equipo de backend es dueño, construiste un
gateway con pasos extra, y cada cambio de pantalla se vuelve un ticket entre equipos
— exactamente el problema que el patrón existe para eliminar.

### BFF vs API gateway

Coexisten, y confundirlos es el error más común:

| | Gateway (Cápsula 08) | BFF (esta) |
|---|---|---|
| Alcance | todo el tráfico | un tipo de cliente |
| Preocupaciones | authn, rate limiting, TLS, ruteo | agregación, forma, lógica de cliente |
| Propiedad | equipo de plataforma | el equipo de frontend |
| Lógica | ninguna — inspecciona y rechaza | sí — compone y transforma |
| Cantidad | uno | uno por tipo de cliente |

Stack típico: `cliente → gateway (auth, cuotas) → BFF (forma) → servicios`.

### Dónde sale mal

- **El BFF acumula lógica de negocio.** Regla: un BFF **orquesta y transforma**;
  nunca es dueño de reglas de dominio ni de datos. Si valida un invariante de
  negocio, ese invariante ahora vive en dos lugares.
- **Se convierte en un monolito compartido** porque "web y mobile son bastante
  parecidos". Divergen; el BFF acumula flags; nadie se anima a cambiarlo.
- **Se vuelve otro salto de red sin valor** — si solo hace proxy, borralo.
- **Amplificación de fan-out** — un request de cliente convirtiéndose en 12 llamadas
  al backend. Moviste la charlatanería, no la eliminaste.
- **Es un nuevo SPOF para ese cliente.** Necesita los mismos timeouts, breakers y
  degradación que cualquier otra cosa (Cápsula 17).

### GraphQL como alternativa

GraphQL deja que los clientes pidan exactamente los campos que quieren, que es el
mismo problema que resuelve el BFF — un schema en vez de N BFFs.

**A favor:** sin un BFF por cliente; los clientes evolucionan sin cambios de backend;
la introspección y el tooling son genuinamente buenos.

**En contra:** complejidad (una capa de resolvers, un problema N+1 que necesita
DataLoader, límites de profundidad y complejidad de query para prevenir abuso); el
caching es mucho más difícil porque cada query es un POST con body único (chau
Cápsula 16); y la autorización tiene que imponerse por campo, lo cual es fácil de
equivocar sutilmente.

**Regla práctica:** pocos clientes con necesidades estables y conocidas → BFFs.
Muchos clientes con necesidades impredecibles, o una API pública donde consumidores
que no controlás necesitan flexibilidad → GraphQL. Y GraphQL no elimina la necesidad
de agregar — solo la mueve dentro de los resolvers.

### Fan-out paralelo con falla parcial

El detalle crítico de implementación. Un BFF que llama a cuatro servicios
**secuencialmente** es más lento que el cliente haciéndolo solo. Llamalos en
paralelo, y decidí por dependencia si su falla es fatal:

```
  sequential:  120ms + 80ms + 200ms + 50ms  = 450ms
  parallel:    max(120, 80, 200, 50)        = 200ms
```

Y **degradá en vez de fallar**: si el servicio de "recomendaciones" está caído, la
pantalla se renderiza sin recomendaciones. Si el servicio de "perfil" está caído, no
hay pantalla. Codificá esa diferencia explícitamente.

---

## Lab

### Paso 1 — el contrato de agregación

La pantalla mobile de "detalle de peleador" necesita: nombre, poder actual, ranking,
historial reciente, y si el usuario lo sigue. Eso son tres servicios hoy.

**`internal/bff/mobile.go`**

```go
// Package bff assembles per-client views. It orchestrates and transforms.
// It owns no data and no business rules — if you find yourself validating a
// domain invariant here, it belongs in the owning service.
package bff

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// FighterScreen is shaped for ONE SCREEN, not for a domain model.
// Field names match what the mobile view renders; nothing is included that
// the screen does not draw.
type FighterScreen struct {
	Name      string        `json:"name"`
	Power     int64         `json:"power"`
	PowerText string        `json:"power_text"`  // "9,001" — formatted server-side
	Rank      int           `json:"rank"`
	RankLabel string        `json:"rank_label"`  // "#3 of 2,041"
	Sparkline []int64       `json:"sparkline"`   // 12 points, not 5000 readings
	Following bool          `json:"following"`
	Degraded  []string      `json:"degraded,omitempty"` // what we couldn't load
}

type Client struct {
	http *http.Client
	log  *slog.Logger

	ReadingsURL string
	RankingURL  string
	SocialURL   string
}

func New(log *slog.Logger, readings, ranking, social string) *Client {
	return &Client{
		// One shared client with a bounded pool. Never http.DefaultClient:
		// it has NO timeout (Capsule 17).
		http: &http.Client{
			Timeout: 2 * time.Second,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 32,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		log:         log,
		ReadingsURL: readings,
		RankingURL:  ranking,
		SocialURL:   social,
	}
}
```

### Paso 2 — fan-out paralelo con criticidad por dependencia

**`internal/bff/mobile.go`** — *sigue el mismo archivo.* (El bloque de imports de
arriba ya lista `context`, `encoding/json`, `fmt` y `sync`; acá se usan.)

```go
// dependency describes one upstream call and whether it is essential.
type dependency struct {
	name     string
	critical bool // if true, its failure fails the whole screen
	call     func(context.Context) error
}

func (c *Client) FighterScreen(ctx context.Context, fighter, userID string) (*FighterScreen, error) {
	// The BFF's own budget. Every upstream call inherits from this, so a
	// slow dependency can never exceed what the client is willing to wait.
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	var (
		mu     sync.Mutex
		screen FighterScreen
		fatal  error
	)
	screen.Name = fighter

	deps := []dependency{
		{
			name: "readings", critical: true, // no readings, no screen
			call: func(ctx context.Context) error {
				var out struct {
					Power   int64   `json:"power"`
					History []int64 `json:"history"`
				}
				if err := c.getJSON(ctx, c.ReadingsURL+"/fighters/"+fighter, &out); err != nil {
					return err
				}
				mu.Lock()
				screen.Power = out.Power
				screen.PowerText = humanise(out.Power)
				screen.Sparkline = downsample(out.History, 12)
				mu.Unlock()
				return nil
			},
		},
		{
			name: "ranking", critical: false, // the screen works without a rank
			call: func(ctx context.Context) error {
				var out struct {
					Rank  int `json:"rank"`
					Total int `json:"total"`
				}
				if err := c.getJSON(ctx, c.RankingURL+"/rank/"+fighter, &out); err != nil {
					return err
				}
				mu.Lock()
				screen.Rank = out.Rank
				screen.RankLabel = fmt.Sprintf("#%d of %s", out.Rank, humanise(int64(out.Total)))
				mu.Unlock()
				return nil
			},
		},
		{
			name: "social", critical: false, // default to "not following"
			call: func(ctx context.Context) error {
				var out struct {
					Following bool `json:"following"`
				}
				url := c.SocialURL + "/follows?user=" + userID + "&fighter=" + fighter
				if err := c.getJSON(ctx, url, &out); err != nil {
					return err
				}
				mu.Lock()
				screen.Following = out.Following
				mu.Unlock()
				return nil
			},
		},
	}

	// PARALLEL. Sequential would make the BFF slower than the client doing
	// the calls itself, which defeats the entire purpose.
	var wg sync.WaitGroup
	for _, d := range deps {
		wg.Add(1)
		go func(d dependency) {
			defer wg.Done()
			if err := d.call(ctx); err != nil {
				c.log.Warn("bff dependency failed",
					"dep", d.name, "critical", d.critical, "err", err)
				mu.Lock()
				if d.critical {
					fatal = fmt.Errorf("%s: %w", d.name, err)
				} else {
					// Degrade: record it, render the screen anyway.
					screen.Degraded = append(screen.Degraded, d.name)
				}
				mu.Unlock()
			}
		}(d)
	}
	wg.Wait()

	if fatal != nil {
		return nil, fatal
	}
	return &screen, nil
}

func (c *Client) getJSON(ctx context.Context, url string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	// Propagate the correlation id so the whole fan-out is one trace.
	if id, ok := ctx.Value(requestIDKey{}).(string); ok {
		req.Header.Set("X-Request-Id", id)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upstream %s returned %d", url, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(dst)
}

type requestIDKey struct{}
```

Los helpers de presentación — fijate que viven acá, en el BFF, porque son
*presentación*:

**`internal/bff/mobile.go`** — *sigue siendo el mismo archivo.*

```go
func humanise(n int64) string {
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		return s
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	return string(out)
}

// downsample reduces a long history to n points for a sparkline.
// Doing this server-side means the mobile client downloads 12 numbers
// instead of 5,000 — the payload win that justifies the BFF.
func downsample(xs []int64, n int) []int64 {
	if len(xs) <= n {
		return xs
	}
	out := make([]int64, 0, n)
	step := float64(len(xs)) / float64(n)
	for i := 0; i < n; i++ {
		out = append(out, xs[int(float64(i)*step)])
	}
	return out
}
```

### Paso 3 — el binario del BFF

**`cmd/mobile-bff/main.go`**

```go
package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/<your-username>/gravity-chamber/internal/bff"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	client := bff.New(log,
		env("READINGS_URL", "http://localhost:8080"),
		env("RANKING_URL", "http://localhost:8081"),
		env("SOCIAL_URL", "http://localhost:8082"),
	)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("GET /screens/fighter/{name}", func(w http.ResponseWriter, r *http.Request) {
		user := r.Header.Get("X-User-Id") // set by the gateway (Capsule 08)
		screen, err := client.FighterScreen(r.Context(), r.PathValue("name"), user)
		if err != nil {
			log.Error("screen failed", "fighter", r.PathValue("name"), "err", err)
			http.Error(w, `{"error":"unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		// Screens are per-user, so this must never be cached by a shared
		// cache (Capsule 16). Getting this wrong leaks one user's data
		// to another.
		w.Header().Set("Cache-Control", "private, max-age=5")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(screen)
	})

	srv := &http.Server{
		Addr:              ":9000",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Info("mobile bff online", "port", 9000)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("bff failed", "err", err)
		os.Exit(1)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
```

> ### ⏸ Punto natural para cortar
>
> Todo lo de arriba se sostiene solo — commiteálo y volvé después. Los pasos que
> siguen construyen sobre eso pero no dejan nada inestable si parás acá. Dos
> sesiones de 45 minutos le ganan a una de 90 que no terminás.

### Paso 4 — medí la ganancia

```bash
# start scouter (:8080) and ranker (:8081), then the BFF
go run ./cmd/mobile-bff
```

**Agregación del lado del cliente** (tres llamadas secuenciales, como haría una app
mobile):

```bash
time (
  curl -s localhost:8080/fighters/goku > /dev/null
  curl -s localhost:8081/rank/goku     > /dev/null
  curl -s localhost:8082/follows       > /dev/null
)
```

**Agregación por BFF:**

```bash
time curl -s localhost:9000/screens/fighter/goku | jq
```

En localhost la diferencia es chica. Agregá latencia de red realista para ver el
efecto real:

```bash
# simulate 100ms RTT per call by sleeping in each upstream handler,
# or just do the arithmetic:
python3 - <<'PY'
rtt = 0.100          # mobile network round trip
work = [0.020, 0.015, 0.010]
print(f"client-side, sequential: {sum(w + rtt for w in work)*1000:.0f} ms")
print(f"BFF (client pays 1 RTT, fan-out is parallel on a fast network):"
      f" {(rtt + max(work) + 0.002)*1000:.0f} ms")
PY
```

```
client-side, sequential: 345 ms
BFF (client pays 1 RTT, fan-out is parallel on a fast network): 122 ms
```

**~3× más rápido, y el cliente recibió un payload más chico.** Esa es la propuesta de
valor entera del patrón, y viene de la geografía más que de la astucia: el BFF está
al lado de los servicios, así que su fan-out es barato.

### Paso 5 — probá la degradación con gracia

```bash
# kill the ranking service
curl -s localhost:9000/screens/fighter/goku | jq
```

```json
{
  "name": "goku",
  "power": 9001,
  "power_text": "9,001",
  "rank": 0,
  "sparkline": [8200, 8400, ...],
  "following": false,
  "degraded": ["ranking", "social"]
}
```

**La pantalla igual se renderiza.** Falta el ranking y el cliente sabe exactamente
qué falta, así que puede esconder ese widget en vez de mostrar un valor incorrecto.

Ahora matá el servicio de *readings*:

```bash
curl -si localhost:9000/screens/fighter/goku | head -1
# HTTP/1.1 503 Service Unavailable
```

Correcto: sin readings no hay pantalla. **El flag `critical` codificó una decisión de
producto en el código**, que es exactamente donde esa decisión pertenece — y es la
parte que la mayoría de las implementaciones se saltea.

### Paso 6 — un ejercicio de comparar alternativas

Escribí en `NOTES.md`, con honestidad, para el Scouter:

| Enfoque | Round trips (mobile) | Payload | El cliente conoce la topología | Servicio extra |
|---|---|---|---|---|
| Agregación del lado del cliente | 3 | grande | sí | no |
| BFF | 1 | chico, exacto | no | sí |
| GraphQL | 1 | elegido por el cliente | no | sí + resolvers |
| Un endpoint gordo en un servicio | 1 | grande | no | no, pero re-monolitiza |

Después contestá: *para este sistema, con un cliente web y uno mobile, ¿cuál
elegirías y por qué?*

Hay un argumento defendible a favor de la cuarta opción a este tamaño — y saber
cuándo lo simple es lo correcto es el punto del ejercicio.

---

## En GCP

- **Un BFF es simplemente otro servicio de Cloud Run.** Deployalo en la misma región
  que los servicios que llama — el fan-out entre regiones destruye el beneficio de
  latencia por el que lo estás construyendo.
- **Mantené los backends internos.** `--ingress=internal` +
  `--no-allow-unauthenticated` en readings/ranking/social; solo el BFF (y el gateway)
  pueden alcanzarlos. Después la service account del BFF recibe `roles/run.invoker`
  en cada uno.
- **Auth servicio-a-servicio**: pedí un identity token OIDC al metadata server,
  audience = la URL del servicio destino, y adjuntalo como bearer token. El paquete
  `idtoken` de Google lo hace en unas pocas líneas
  ([B7](../bonus/B7-kamis-ledger-iam-service-accounts/README.md)).
- **`--concurrency`** importa acá: un BFF está limitado por E/S (mayormente espera a
  otros servicios), así que una concurrencia *alta* (100–250) es eficiente — lo
  opuesto a un servicio limitado por CPU.
- **Cloud Trace** es lo que hace debuggeable a un BFF: un trace muestra el fan-out
  como spans paralelos y revela de inmediato cuál upstream es el lento (Cápsula 25).
- **Apigee/API Gateway adelante, BFF atrás.** El gateway hace auth y cuotas; el BFF
  hace la forma. No pongas lógica de forma en el gateway.

---

## Llevátelo al trabajo

- **Un BFF por tipo de cliente, propiedad del equipo de ese cliente.** La propiedad
  es el patrón, no el código.
- **Un BFF orquesta y transforma. Nunca es dueño de reglas de dominio ni de datos.**
- **Siempre hacé fan-out en paralelo**, con un presupuesto total heredado del
  request.
- **Marcá cada dependencia como crítica u opcional**, y degradá en vez de fallar.
  Decile al cliente qué falta.
- **Dale forma para la pantalla**, incluyendo formateo y downsampling — esa es la
  ganancia de payload.
- **`Cache-Control: private`** en cualquier cosa por usuario. Siempre.
- **Propagá el ID de correlación** en cada llamada upstream.
- **Si el BFF solo hace proxy, borralo.** Un salto sin valor es un salto con solo
  costo.

---

## Battle drill

<details>
<summary><b>1.</b> Tu BFF hace 12 llamadas al backend por pantalla. ¿Es un problema?</summary>

Probablemente, pero preguntá qué tipo de 12.

**Está bien:** 12 llamadas paralelas, todas rápidas, latencia total ≈ la más lenta.
Le ahorraste al cliente 11 round trips.

**No está bien:** cualquiera de ellas *secuencial* porque la salida de una alimenta
la entrada de otra — 12 llamadas secuenciales son 12× la latencia y acabás de mover
la charlatanería un salto más cerca de los servicios.

También preocupa a los 12: amplificación de cola (Cápsula 12) — esperar 12 cosas
significa muestrear la cola 12 veces, así que tu p99 está hecho con sus p95; y
sugiere un problema de fronteras (¿por qué una pantalla necesita 12 servicios?).

Soluciones: paralelizá todo lo que no sea genuinamente dependiente; agrupá (una
llamada con 10 ids le gana a 10 llamadas); cacheá las partes estables; marcá la
mayoría como opcionales para que un servicio lento no retenga la pantalla; y
reconsiderá si algunos de esos servicios deberían ser uno.
</details>

<details>
<summary><b>2.</b> Los equipos de web y mobile quieren agregar el mismo campo. ¿Dónde va?</summary>

Depende de qué sea el campo.

**Datos existentes, forma nueva** — cada BFF lo agrega de forma independiente, desde
datos que los servicios ya exponen. Sin cambio de backend, sin coordinación, los dos
equipos shippean hoy. **Esto es el patrón funcionando exactamente como se pretende.**

**Datos nuevos que los servicios no tienen** — el servicio dueño lo agrega, después
cada BFF lo expone. Dos pasos, pero el cambio de dominio ocurre una vez en el lugar
correcto.

**Puramente presentacional** (un string formateado, una etiqueta computada) — el BFF,
todas las veces. Para eso está.

El antipatrón es ponerlo en un BFF *compartido* "porque los dos lo necesitan". Hoy
necesitan lo mismo; en tres meses web lo necesita paginado y mobile truncado, y ahora
tenés flags. La duplicación entre BFFs es aceptable y a menudo correcta — sirven a
amos distintos.
</details>

<details>
<summary><b>3.</b> GraphQL en vez de tres BFFs — argumentá los dos lados.</summary>

**A favor de GraphQL:** un schema en vez de tres servicios que mantener; los clientes
evolucionan sus queries sin ningún deploy de backend; tipado fuerte e introspección;
tooling excelente; genuinamente mejor cuando tenés muchos clientes o clientes que no
controlás.

**En contra:** igual necesitás resolvers que agreguen — el trabajo no desapareció, se
mudó. El problema N+1 es severo y necesita batching con DataLoader. El caching HTTP
se pierde en gran medida (POST con body único derrota entera a la Cápsula 16), así
que necesitás persisted queries o un cache especializado. Las queries profundas
maliciosas o descuidadas te pueden hacer DoS, así que necesitás límites de
profundidad y complejidad. Y la autorización tiene que imponerse por campo, y
equivocarse expone datos.

**Decidí por cantidad y previsibilidad de clientes.** Dos o tres clientes conocidos
con necesidades estables → BFFs, menos maquinaria, caching más fácil. Muchos clientes
o consumidores desconocidos → GraphQL se gana su complejidad.

Y ojo que se componen: un BFF puede hablar GraphQL a los clientes y REST a los
servicios.
</details>

<details>
<summary><b>4.</b> ¿Debería cachear el BFF?</summary>

Sí, pero con cuidado, y la distinción es lo que importa.

**Cacheá las respuestas upstream** (compartidas, no personalizadas): el leaderboard,
las estadísticas públicas de un peleador. TTL corto, en Redis, compartido entre
instancias del BFF. Este es el cache de alto valor y es seguro.

**Cacheá pantallas ensambladas** (por usuario): posible, pero la clave tiene que
incluir el id de usuario, el TTL tiene que ser corto, y la respuesta tiene que ser
`Cache-Control: private`. Si te equivocás, le servís la pantalla de un usuario a otro
— una filtración, no un bug (Cápsula 16).

**No cachees** nada que tenga que ser inmediatamente consistente con la propia acción
del usuario — el problema de read-your-writes (Cápsula 13) es muy visible acá, porque
el usuario acaba de tocar la cosa.

El mejor caching de BFF normalmente es **parcial**: cacheá los componentes estables,
traé los volátiles en vivo, ensamblá cada vez. Eso mantiene alto el hit ratio donde
es seguro y la frescura donde importa.
</details>

<details>
<summary><b>5.</b> El equipo de mobile quiere ser dueño del BFF pero no tiene experiencia de backend. ¿Qué hacés?</summary>

Apoyá la propiedad; no se la saques. La propiedad *es* el patrón — un BFF propiedad
de un equipo de backend es un gateway con latencia extra, y cada cambio de pantalla se
vuelve un ticket entre equipos.

Lo que lo hace funcionar en la práctica:
- **Un camino pavimentado**: un repo template con logging, tracing, health checks,
  timeouts, breakers, CI y deploy ya cableados. Ellos escriben handlers, no
  infraestructura.
- **Dejalos usar su lenguaje.** Un BFF en TypeScript propiedad de un equipo de
  frontend TS le gana a un BFF en Go que nadie de ese equipo puede debuggear a las 2
  de la mañana.
- **Pair programming el primer mes**, después asesoría.
- **Fronteras claras**: ellos son dueños de la forma y la orquestación. Las reglas de
  dominio, la persistencia y los invariantes de negocio se quedan en los servicios.
  Imponelo en code review.
- **Guardia compartida al principio**, migrando a la de ellos a medida que ganan
  confianza — y sé honesto de que eso es parte del trato.

Los equipos que fracasan con BFFs normalmente son aquellos donde la propiedad era
nominal.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| El BFF es más lento que el cliente haciéndolo solo | Fan-out secuencial. Usá goroutines y un `WaitGroup`. |
| Data race sobre el struct de la pantalla | Goroutines concurrentes escribiendo estado compartido — para eso está el mutex. `go test -race`. |
| Un upstream lento retiene toda la pantalla | Poné un timeout por llamada *y* un presupuesto general; marcá las dependencias no esenciales como opcionales. |
| Se le sirvió una pantalla al usuario equivocado | Falta `Cache-Control: private`, o a la clave de cache le falta el id de usuario. Incidente, no bug. |
| `context deadline exceeded` en cada llamada | El presupuesto del BFF es más corto que la latencia típica del upstream. Medí primero, después configuralo. |
| Pool de conexiones agotado bajo carga | El default de `MaxIdleConnsPerHost` es 2. Subilo — un BFF es intensivo en fan-out por diseño. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(bff): mobile backend-for-frontend with parallel fan-out

Capsule 23. One screen-shaped endpoint replaces three client round trips.
Fan-out is parallel with an inherited deadline; each dependency is marked
critical or optional so a ranking outage degrades the screen instead of
breaking it. Formatting and downsampling done server-side."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 23
```

**Siguiente:** [Cápsula 24 · Cambio de Cuerpo de Ginyu — Deploys seguros](../24-body-change-deployments/README.md)
