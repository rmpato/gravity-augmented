# Cápsula 22 · Danza de la Fusión — Partir el monolito

> *La Danza de la Fusión requiere timing idéntico, postura idéntica y niveles de
> pelea idénticos. Errá un dedo y producís a Gotenks-gordo-e-idiota: más débil que
> cualquiera de las dos mitades, y así por treinta minutos. Goku y Vegeta son
> individualmente más fuertes que una fusión mal hecha. Eso es un monolito
> distribuido.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 9 | 85 min | Sagas 2–4 | Local |

---

## Por qué existe esta cápsula

"¿Deberíamos usar microservicios?" es la pregunta de arquitectura más común y la que
más seguido se responde por moda.

La respuesta honesta es que los microservicios resuelven un problema
**organizacional** (muchos equipos shippeando de forma independiente) aceptando un
gran costo **técnico** (fallas de red, transacciones distribuidas, overhead
operativo). Si no tenés el problema organizacional, compraste el costo por nada.

Esta cápsula es sobre trazar fronteras que valgan el precio — y reconocer el modo de
falla donde te quedás con todos los costos y ninguno de los beneficios.

---

## El concepto

### Qué te compran realmente los microservicios

| Afirmación | Realidad |
|---|---|
| "Deploy independiente" | ✅ **El beneficio real.** Los equipos shippean sin coordinar |
| "Escalado independiente" | ✅ Genuino, pero un monolito modular también escala horizontalmente |
| "Diversidad tecnológica" | ⚠️ Real, y normalmente un pasivo. Cinco lenguajes son cinco toolchains |
| "Aislamiento de fallas" | ⚠️ Solo con mamparos y breakers (Cápsula 17). Si no, tenés *más* modos de falla |
| "Más fácil de entender" | ❌ Cada servicio es más chico; el *sistema* es mucho más difícil |
| "Mejor performance" | ❌ Reemplazaste llamadas a función por llamadas de red |

**El que importa es el deploy independiente**, y solo importa cuando varios equipos
compiten por un pipeline de deploy. Con un equipo, estás pagando por un beneficio que
no podés cobrar.

### El monolito distribuido

El modo de falla. Servicios que tienen que deployarse juntos:

```
  🚩 Changing service A requires changing B and C in the same release
  🚩 Services share a database (or worse, share tables)
  🚩 A synchronous call chain 5 services deep
  🚩 Every request touches every service
  🚩 You can't test one service without running all of them
  🚩 A shared library that every service must upgrade in lockstep
```

Ahora tenés las fallas de red, el overhead operativo, el debugging distribuido *y*
el acoplamiento. Estrictamente peor que el monolito del que partiste.

### Dónde trazar las fronteras

**Domain-Driven Design, menos la ceremonia.** Una buena frontera:

- **Es dueña de sus datos.** Ningún otro servicio lee sus tablas. Nunca. Esta es la
  regla más importante, y la primera que la gente rompe.
- **Cambia por una sola razón.** Si dos cosas siempre cambian juntas, son una cosa.
- **Coincide con un equipo.** La ley de Conway no es un consejo; es una
  observación. Tu arquitectura va a espejar tu estructura de comunicación te guste o
  no, así que elegí fronteras que coincidan con cómo estás organizado.
- **Tiene un contrato claro** que estarías dispuesto a publicar externamente.
- **Puede fallar sola.** Si que A esté caído significa que B es inútil, quizás sean
  un solo servicio.

**Fronteras malas** que hay que reconocer al instante:

- **Por capa técnica** (`api-service`, `business-logic-service`,
  `data-service`). Cada feature toca las tres, así que nada se deploya de forma
  independiente. Este es el error más común.
- **Por entidad** (`user-service`, `order-service`, `product-service`) cuando los
  flujos reales las cruzan — terminás con grafos de llamadas charlatanes y
  transacciones distribuidas en todos lados.
- **Demasiado chicas.** Un servicio por endpoint significa que la red *es* tu stack
  de llamadas.

### El monolito modular es el default correcto

```
  monolith/
    internal/
      readings/     ← package boundary, enforced by the compiler
      ranking/
      notification/
    cmd/server/main.go   ← one deployable
```

Obtenés: fronteras claras, razonamiento independiente, sin llamadas de red,
transacciones de verdad, un deploy, una cosa que debuggear, una cosa que correr.

**Extraé un servicio solo cuando una presión específica lo justifique:**

- Un componente necesita escalar de forma independiente *por un factor grande*
- Un equipo separado necesita una cadencia de release independiente
- Requisitos distintos de disponibilidad o compliance
- Una necesidad tecnológica genuinamente distinta (inferencia con GPU, un runtime
  específico)

> **Hacé bien las fronteras de módulos primero.** Un monolito con buenas fronteras
> internas se puede partir después en semanas. Un monolito con malas fronteras no se
> puede partir en absoluto — y tampoco los microservicios que habrías construido con
> ese mismo entendimiento.

### ¿Sincrónico o asincrónico entre servicios?

| | Sync (REST/gRPC) | Async (eventos) |
|---|---|---|
| El que llama necesita la respuesta | ✅ | ❌ |
| Disponibilidad | se multiplica: 3 × 99,9% ≈ 99,7% | aislada |
| Acoplamiento | temporal — los dos tienen que estar arriba | solo al schema |
| Debugging | un trace | más difícil |

**La multiplicación de disponibilidad es el argumento que gana.** Una cadena de
cinco servicios al 99,9% da 99,5% — de 43 minutos de caída al mes a 3,6 horas,
puramente por la topología.

**Default a async** entre servicios, y usá sync solo cuando el que llama
genuinamente necesita la respuesta para continuar.

### REST vs gRPC internamente

| | REST/JSON | gRPC |
|---|---|---|
| Contrato | OpenAPI (opcional, a menudo desactualizado) | `.proto`, generado, impuesto |
| Payload | texto, más grande | binario, compacto |
| Streaming | incómodo (SSE/WS) | nativo, bidireccional |
| Navegador | directo | necesita grpc-web o un gateway |
| Debugging | `curl` | `grpcurl` |

**gRPC para servicio-a-servicio interno**, principalmente porque el cliente generado
es un contrato en tiempo de compilación — no podés tipear mal un nombre de campo.
**REST para APIs públicas**, porque todo el mundo lo habla (ver
[B1](../bonus/B1-kame-house-rules-rest/README.md)).

---

## Lab

### Paso 1 — trazá las fronteras antes de escribir código

Tu Scouter ahora hace cuatro cosas distinguibles:

| Capacidad | Datos que posee | Cambia cuando | Perfil de escala |
|---|---|---|---|
| **Readings** | `fighters`, `readings` | cambia la API de registro | intensiva en escritura |
| **Ranking** | `fighter_ranks`, sorted set de Redis | cambian las reglas de ranking | intensiva en lectura, 100× |
| **Notification** | `subscriptions`, `sent` | cambian los canales de notificación | irregular |
| **Analytics** | `daily_fighter_stats` | cambian las necesidades de reporte | batch |

Escribí un ADR **antes** de tocar código — este es el entregable que más importa de
esta cápsula:

**`docs/adr/001-extract-ranking-service.md`**

```markdown
# ADR 001 — Extract ranking into its own service

## Status
Accepted · 2026-08-05

## Context
- /leaderboard is 90% of read traffic; /readings is 95% of write traffic.
- They scale by different factors: reads grew 10x last quarter, writes 1.4x.
- Ranking rules change weekly (product experiments); the recording API has
  not changed in three months.
- Ranking is already fed asynchronously via Pub/Sub (Capsule 18), so the
  coupling is already a schema, not a function call.

## Decision
Extract ranking as `cmd/ranker`, owning `fighter_ranks` and the Redis sorted
set. It consumes `power.recorded` and exposes a read-only HTTP API.
Scouter keeps `fighters` and `readings` and no longer serves /leaderboard.

## Consequences
+ Ranking scales independently (its own instance count and memory profile).
+ Ranking experiments deploy without touching the write path.
+ A ranking outage does not stop readings being recorded.
- Leaderboard data is now eventually consistent (~1s behind).
- One more service to deploy, monitor and page for.
- Cross-service debugging needs distributed tracing (Capsule 25).

## Alternatives considered
- **Keep it in the monolith** — simplest, and it's what we did for six months.
  Rejected because ranking deploys now block the write path weekly.
- **Extract notifications first** — lower value; it's already async and small.
- **Split by layer (api/logic/data)** — rejected: every feature would touch
  all three, so nothing would deploy independently.

## Reversal
If the operational cost outweighs the benefit, ranking folds back into the
monolith by importing internal/ranking and re-registering the route. The
package boundary is preserved specifically so this stays possible.
```

Esa última sección vale la pena copiarla a tu vida laboral. **Un ADR que nombra cómo
deshacer la decisión es mucho más útil que uno que solo la justifica.**

### Paso 2 — imponé la frontera dentro del monolito primero

Antes de extraer nada, hacé real la frontera en un solo proceso.

```
internal/
  scouter/        ← owns fighters, readings. Publishes events.
                    (the "readings" domain — keep the name you've used since
                     Capsule 01; renaming 21 capsules of imports buys nothing)
    store.go
    service.go
  ranking/        ← owns fighter_ranks. Consumes events.
    store.go
    service.go
  platform/       ← shared infrastructure, NO domain logic
    db.go
    events.go
```

La regla, y hay que imponerla:

```go
// internal/ranking/service.go

// ✗ NEVER: reaching into another module's storage
// import "github.com/you/gravity-chamber/internal/readings"
// rows := readings.DB().Query("SELECT * FROM readings ...")

// ✅ Ranking consumes events and owns its own tables. It has no idea
// what readings' schema looks like, which is exactly why readings can
// change it freely.
func (s *Service) OnPowerRecorded(ctx context.Context, e events.PowerRecorded) error {
	return s.store.ApplyReading(ctx, e.Fighter, e.Power, e.RecordedAt)
}
```

Agregá un test que la imponga — esto vale más que cualquier página de wiki:

**`internal/architecture_test.go`**

```go
package internal_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestModuleBoundaries fails the build if one domain module imports another.
// Domain modules may import platform/ and events/, never each other.
//
// A boundary a linter enforces is worth ten a wiki describes.
func TestModuleBoundaries(t *testing.T) {
	domains := map[string]bool{"scouter": true, "ranking": true, "notification": true}

	checked := 0
	for domain := range domains {
		dir := filepath.Join(".", domain)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}
		checked++
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
				return err
			}
			f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			for _, imp := range f.Imports {
				p := strings.Trim(imp.Path.Value, `"`)
				for other := range domains {
					if other == domain {
						continue
					}
					if strings.Contains(p, "/internal/"+other) {
						t.Errorf("%s imports %s — domain modules must not depend on each other", path, other)
					}
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	// Without this the test passes VACUOUSLY when none of the directories
	// exist — a green check that proves nothing is worse than no check.
	if checked == 0 {
		t.Fatal("no domain modules found; this test was asserting nothing")
	}
}
```

```bash
go test ./internal/... -run TestModuleBoundaries -v
```

Probá agregar un import prohibido y mirá el build fallar. **Eso es una frontera.**

### Paso 3 — extraé, con un strangler fig

Nunca hagas un big-bang de una división. Ruteá el tráfico de a poco.

```go
// cmd/scouter/main.go — the strangler fig pattern.
//
// The monolith keeps serving /leaderboard until the new service is proven,
// then proxies to it, then the route is deleted. At every point you can
// revert with an environment variable rather than a rollback.
	if url := os.Getenv("RANKING_SERVICE_URL"); url != "" {
		log.Info("delegating /leaderboard to the ranking service", "url", url)
		mux.Handle("GET /leaderboard", rankingProxy(url, log))
	} else {
		mux.HandleFunc("GET /leaderboard", s.handleLeaderboard)
	}
```

El proxy — fijate que lleva las lecciones de la Cápsula 17:

```go
func rankingProxy(target string, log *slog.Logger) http.Handler {
	client := &http.Client{Timeout: 2 * time.Second}
	breaker := scouter.NewBreaker(5, 10*time.Second)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body []byte
		err := breaker.Do(func() error {
			req, err := http.NewRequestWithContext(r.Context(), "GET",
				target+"/leaderboard?"+r.URL.RawQuery, nil)
			if err != nil {
				return err
			}
			// Propagate the correlation id. Without this, a cross-service
			// request is unfollowable (Capsule 25).
			req.Header.Set("X-Request-Id", r.Header.Get("X-Request-Id"))

			resp, err := client.Do(req)
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 500 {
				return fmt.Errorf("ranking returned %d", resp.StatusCode)
			}
			body, err = io.ReadAll(resp.Body)
			return err
		})
		if err != nil {
			// DEGRADE, don't fail: an empty leaderboard beats a 500.
			log.Warn("ranking unavailable, serving empty", "err", err)
			w.Header().Set("X-Degraded", "true")
			writeJSON(w, http.StatusOK, []any{})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
}
```

> ### ⏸ Punto natural para cortar
>
> Todo lo de arriba se sostiene solo — commiteálo y volvé después. Los pasos que
> siguen construyen sobre eso pero no dejan nada inestable si parás acá. Dos
> sesiones de 45 minutos le ganan a una de 90 que no terminás.

### Paso 4 — dale una API al ranker

`cmd/ranker` por ahora solo consume. Agregale un servidor HTTP para que pueda servir
lecturas:

```go
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /leaderboard", rankingHandler)

	go func() {
		srv := &http.Server{Addr: ":8081", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
		_ = srv.ListenAndServe()
	}()
```

Corré los dos y mirá la división funcionar:

```bash
# terminal 1
DATABASE_URL="..." PUBSUB_PROJECT_ID=gravity-chamber SUBSCRIPTION_ID=ranker \
  go run ./cmd/ranker

# terminal 2 — monolith delegating
RANKING_SERVICE_URL=http://localhost:8081 DATABASE_URL="..." make run

# terminal 3
curl -s localhost:8080/leaderboard | jq
```

**Ahora rompelo, porque esa es la lección posta:**

```bash
# kill the ranker (Ctrl-C in terminal 1)
curl -si localhost:8080/leaderboard | grep -E 'HTTP/|X-Degraded'
# HTTP/1.1 200 OK
# X-Degraded: true

curl -s -XPOST localhost:8080/readings -d '{"fighter":"goku","power":9001}' | jq
# ✅ 201 — writes are completely unaffected
```

**Aislamiento de fallas, logrado a propósito.** Fijate que vino del breaker y del
fallback, no de la división en sí — dividir solo te habría dado un 500.

### Paso 5 — la aritmética de disponibilidad

```bash
python3 - <<'PY'
def uptime(n, per=0.999):
    a = per ** n
    print(f"{n} services in a SYNC chain, each {per*100}%:  {a*100:.3f}%  "
          f"= {(1-a)*365*24*60:.0f} min/year of downtime")
for n in (1, 3, 5, 10):
    uptime(n)
PY
```

```
1 services in a SYNC chain, each 99.9%:  99.900%  =  526 min/year of downtime
3 services in a SYNC chain, each 99.9%:  99.700%  = 1575 min/year of downtime
5 services in a SYNC chain, each 99.9%:  99.501%  = 2623 min/year of downtime
10 services in a SYNC chain, each 99.9%:  99.004%  = 5232 min/year of downtime
```

**Diez servicios al 99,9% en cadena te dan 99,0%** — diez veces peor, puramente por
topología. Nadie escribió un bug.

Este es *el* argumento a favor de la comunicación asincrónica entre servicios, y a
favor de la degradación con gracia cuando sync es inevitable. Poné esta tabla en tu
ADR.

### Paso 6 — un contract test

Lo que hace seguro el deploy independiente:

```go
// internal/ranking/contract_test.go
//
// A CONTRACT TEST asserts the shape the ranking service promises to its
// consumers. Break the shape and this test fails in the ranking repo's CI —
// before the change reaches anyone who depends on it.
func TestLeaderboardContract(t *testing.T) {
	rec := httptest.NewRecorder()
	handler().ServeHTTP(rec, httptest.NewRequest("GET", "/leaderboard?limit=2", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("response is not a JSON array: %v", err)
	}
	if len(got) == 0 {
		t.Skip("no data")
	}
	// Consumers depend on these fields existing with these names.
	for _, field := range []string{"fighter", "power", "recorded_at"} {
		if _, ok := got[0][field]; !ok {
			t.Errorf("contract broken: field %q missing from the response", field)
		}
	}
}
```

Para trabajo real entre equipos, formalizalo con consumer-driven contracts (Pact) o
un `.proto` compartido — pero incluso esta versión casera agarra la mayoría de las
rupturas accidentales.

---

## En GCP

- **Un servicio de Cloud Run por microservicio.** Cada uno tiene su URL, su config de
  escalado, su service account y su historial de revisiones.
- **Auth servicio-a-servicio**: deployá los servicios internos con
  `--no-allow-unauthenticated` y otorgale a la service account del que llama
  `roles/run.invoker`. El que llama adjunta un identity token OIDC. **Sin secretos
  compartidos, sin API keys, y son unas diez líneas** (ver
  [B3](../bonus/B3-fortuneteller-baba-auth/README.md) y
  [B7](../bonus/B7-kamis-ledger-iam-service-accounts/README.md)).
- **`--ingress=internal`** hace que un servicio sea alcanzable solo desde tu VPC.
- **Una base de datos por servicio** es el ideal. En la práctica, una instancia de
  Cloud SQL con **una base (o al menos un schema) por servicio, y usuarios separados**
  es el compromiso pragmático: preserva la regla de "nada de lecturas de tablas entre
  servicios" a nivel permisos, que es donde realmente se sostiene.
- **Cloud Service Mesh** si llegás a la escala donde el mTLS uniforme y la política
  de tráfico lo justifican (Cápsula 08).
- **Cloud Deploy** para rollouts coordinados de varios servicios.

---

## Llevátelo al trabajo

- **Empezá con un monolito modular.** Extraé por evidencia, no por principio.
- **Una regla por encima de todas: un servicio es dueño de sus datos.** El acceso a
  tablas entre servicios es lo que hace irreversible una división.
- **Imponé las fronteras con un test**, no con una convención.
- **Preferí async entre servicios.** Hacé la aritmética de disponibilidad en voz
  alta.
- **Cada llamada sync necesita timeout, breaker y un fallback degradado**
  (Cápsula 17).
- **Escribí el ADR antes que el código**, e incluí cómo revertir la decisión.
- **Strangler fig, nunca big bang.** Ruteá gradualmente detrás de un flag.
- **Contract tests en el CI del proveedor** — eso es lo que hace el deploy
  independiente seguro y no solo posible.
- **Si no podés deployar un servicio de forma independiente, no es uno.**

---

## Battle drill

<details>
<summary><b>1.</b> Un equipo de 5 con un monolito de 200k líneas quiere pasar a microservicios. Aconsejalos.</summary>

Preguntá qué problema están resolviendo. Si la respuesta es "los deploys dan miedo" o
"el codebase está desordenado", los microservicios van a empeorar las dos cosas — vas
a tener deploys distribuidos que dan miedo y un codebase desordenado repartido en
varios repos.

Disparadores reales: varios equipos compitiendo por un pipeline; un componente que
necesita escalado radicalmente distinto; una frontera genuina de compliance o
tecnología.

Con 5 personas, normalmente ninguno aplica. El consejo: **modularizá primero.** Trazá
fronteras de dominio dentro del monolito, imponelas con tests, dale a cada módulo sus
propias tablas, comunicá por eventos internamente. Eso es la mayor parte del
beneficio a una fracción del costo — y es el prerrequisito necesario para partir
después de todos modos.

Después extraé **un** servicio donde haya presión medible, convivé con la realidad
operativa un trimestre, y decidí si continuar con evidencia.
</details>

<details>
<summary><b>2.</b> Dos servicios necesitan los mismos datos. ¿Qué opciones tenés?</summary>

Ordenadas, de mejor a peor:

1. **Uno es dueño, el otro pregunta** — una llamada sync a la API. Simple, pero
   agrega acoplamiento y multiplica la disponibilidad.
2. **Uno es dueño, el otro mantiene una réplica** construida desde eventos. Async,
   disponibilidad independiente, eventualmente consistente. **Normalmente la
   respuesta correcta.**
3. **Reconsiderá la frontera.** Si dos servicios necesitan constantemente los mismos
   datos, esos datos quizás pertenezcan a un servicio dueño de los dos
   comportamientos. La frontera probablemente esté mal.
4. **Vista compartida de solo lectura** — una vista de base de datos exponiendo una
   proyección estable. Un estado de transición pragmático; sigue siendo
   acoplamiento.
5. **Tablas compartidas, escribiendo los dos** — ❌ nunca. Ahora ninguno puede
   cambiar el schema, no hay dueño, y tenés un monolito distribuido con pasos extra.

Elijas la que elijas, nombrá al dueño explícitamente. Los datos con dos dueños no
tienen ninguno.
</details>

<details>
<summary><b>3.</b> Explicá el monolito distribuido y cómo detectar uno.</summary>

Servicios que tienen que deployarse juntos — pagaste todos los costos de la
distribución y no cobraste ninguno de los beneficios.

**Señales de detección, más o menos en orden de gravedad:**
- Los releases se coordinan entre servicios ("shippeamos A, B y C juntos")
- Los servicios leen las tablas de base de datos de otros
- Una librería compartida que todos tienen que actualizar al mismo tiempo
- No podés correr los tests de un servicio sin levantar los demás
- Un solo request de usuario atraviesa cinco servicios sincrónicamente
- Cada feature requiere cambiar tres repos

**Medilo:** contá cuántos servicios cambian por feature. Si es consistentemente más
de uno, tus fronteras están mal.

**Recuperación:** identificá las fronteras de dominio reales (a menudo menos
servicios y más grandes); rompé primero el acoplamiento de datos — es lo más difícil
y de eso depende todo lo demás; reemplazá cadenas sync por eventos; y estate
genuinamente dispuesto a **volver a unir servicios**. Unir es una movida normal y
sana, no una admisión de fracaso.
</details>

<details>
<summary><b>4.</b> ¿Cuándo vale gRPC sobre REST internamente?</summary>

**Sí cuando:** tenés varios servicios y querés contratos seguros en tiempo de
compilación — el cliente generado convierte un nombre de campo mal tipeado en un
error de build en vez de un misterio a las 3 de la mañana. También para volumen alto
de llamadas (binario es notablemente más chico y rápido), streaming, o servicios
políglotas donde un `.proto` es la fuente de verdad compartida.

**No cuando:** el consumidor es un navegador (necesita grpc-web o un gateway); tenés
dos servicios y el costo del tooling supera el beneficio; tu equipo no tiene
experiencia con protobuf y hay cosas más valiosas que aprender este trimestre; o la
debuggeabilidad con `curl` vale más que la seguridad de tipos.

El argumento real a favor de gRPC es el **contrato**, no la performance. Si sos
disciplinado con OpenAPI y generás clientes desde ahí, obtenés la mayor parte del
mismo beneficio. La mayoría de los equipos no lo es, que es por qué gRPC gana en la
práctica.
</details>

<details>
<summary><b>5.</b> ¿Cómo decidís que un servicio debería volver a unirse?</summary>

Señales de que no se está ganando el lugar:
- Se deploya junto con otro servicio todas las veces igual
- No tiene perfil de escalado independiente — las cantidades de instancias se mueven
  al unísono
- Un solo equipo es dueño de los dos
- La mayoría de sus endpoints los llama exactamente un llamador
- Sus caídas siempre las causa, o siempre las causa a, su vecino
- Debuggear requiere rutinariamente leer los logs de los dos servicios a la vez

Unir es una decisión de ingeniería normal, y estar dispuesto a hacerlo es señal de
madurez y no de derrota. El caso bien documentado es la mudanza de Prime Video de
Amazon desde un pipeline serverless distribuido de vuelta a un monolito — con una
reducción de costos del 90%.

La movida es directa *si* las fronteras de módulo se preservaron: importás el
paquete, registrás las rutas, borrás el salto de red. Que es exactamente por qué
mantenés intacta la frontera de paquete después de extraer.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| El test de fronteras pasa pero hay acoplamiento | Solo chequea imports. Las *tablas* de base de datos compartidas le son invisibles — imponé eso con usuarios y permisos separados de DB. |
| El proxy devuelve 502 | El servicio de ranking no está arriba, o la URL está mal. Mirá el estado del breaker y el header `X-Degraded`. |
| Se pierden los IDs de correlación entre servicios | Cada salto tiene que reenviar `X-Request-Id`. Un solo servicio que lo pierda rompe la cadena de ahí en adelante. |
| Dos servicios se traban llamándose | Dependencia sync circular — un error de frontera. Rompela con un evento. |
| Los datos de ranking se desvían de los de readings | Esperado con consistencia eventual. Agregá un job periódico de reconciliación que reproduzca desde el outbox (Cápsula 21). |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "refactor(arch): extract ranking behind a strangler-fig proxy

Capsule 22. ADR 001 records the decision and how to reverse it. Domain
modules enforced by an import test. /leaderboard delegates to the ranking
service behind a circuit breaker with a degraded fallback, so a ranking
outage returns an empty board rather than a 500. Contract test on the
ranking response shape."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 22
```

**Siguiente:** [Cápsula 23 · El Gran Saiyaman — Backend for Frontend](../23-great-saiyaman-bff/README.md)
