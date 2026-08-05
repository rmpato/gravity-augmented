# Cápsula B1 · Reglas de Kame House — REST API design esencial

> *La casa del Maestro Roshi tiene reglas que parecen arbitrarias hasta que viviste
> ahí: repartir la leche, arar el campo, nadar con tiburones. No son arbitrarias —
> son convenciones que alinean las expectativas de todos sin necesidad de una
> conversación. Eso es una API REST.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 65 min | ninguno | Cápsula 01 |

---

## Por qué existe esta cápsula

La mayoría de la gente diseña APIs por instinto, y los instintos están mayormente
bien. El problema es el 20% donde existe una convención y no la conocías — y cada uno
de esos se convierte después en un cambio incompatible, cuando ya tenés consumidores.

Esta es la referencia: las reglas, el razonamiento, y las decisiones específicas que
la gente entiende mal.

---

## Recursos, no acciones

Una API REST expone **sustantivos**. El verbo es el método HTTP.

```
  ❌ POST /createFighter          ❌ GET  /getFighterById?id=5
  ❌ POST /updateFighterPower     ❌ POST /deleteFighter

  ✅ POST   /fighters             ✅ GET    /fighters/5
  ✅ PATCH  /fighters/5           ✅ DELETE /fighters/5
```

Reglas que se siguen:

- **Sustantivos en plural.** `/fighters`, no `/fighter`. La consistencia le gana a la
  gramática.
- **Anidá por contención**, hasta un nivel: `/fighters/5/readings`. Más profundo que
  eso (`/a/1/b/2/c/3`) se vuelve inusable — usá parámetros de query.
- **kebab-case en las rutas** (`/power-readings`), `snake_case` **o** `camelCase` en
  el JSON — elegí uno y nunca los mezcles.
- **Sin extensiones de archivo.** Para eso está `Accept` y la negociación de
  contenido.

### Cuando la cosa genuinamente no es un recurso

Algunas operaciones son acciones: `search`, `publish`, `cancel`, `retry`. Dos
respuestas aceptables:

1. **Modelá el cambio de estado como recurso**: `POST /orders/5/cancellation`. Es más
   RESTful y te da un lugar donde colgar metadata (quién canceló, por qué, cuándo).
2. **Usá un sub-path con verbo**: `POST /orders/5/cancel`. Pragmático, ampliamente
   usado, y nadie se va a confundir.

No contorsiones una acción genuina en un sustantivo solo para satisfacer un argumento
de pureza. `POST /searches` para correr una búsqueda es peor para todos.

---

## Métodos, y las dos propiedades que importan

| Método | Propósito | ¿Seguro? | ¿Idempotente? |
|---|---|---|---|
| `GET` | leer | ✅ | ✅ |
| `HEAD` | leer solo headers | ✅ | ✅ |
| `POST` | crear, o una acción no idempotente | ❌ | ❌ |
| `PUT` | reemplazar el recurso entero | ❌ | ✅ |
| `PATCH` | actualización parcial | ❌ | ⚠️ depende de vos |
| `DELETE` | eliminar | ❌ | ✅ |

- **Seguro** = sin efectos secundarios. Un `GET` que cambia estado va a ser roto por
  crawlers, prefetchers y todos los caches que existen.
- **Idempotente** = hacerlo dos veces equivale a hacerlo una. Esto es lo que hace
  posibles los reintentos (Cápsula 17), que es por qué importa mucho más de lo que
  suena.

**`PUT` vs `PATCH`** — la confusión más común:

```http
PUT /fighters/5          ← the FULL representation. Omitted fields are CLEARED.
{"name": "goku", "race": "saiyan", "power": 9001}

PATCH /fighters/5        ← only what changes. Omitted fields are UNTOUCHED.
{"power": 9001}
```

Mandar un body parcial con `PUT` esperando un merge es un bug que borra campos en
silencio. Si la mayoría de tus updates son parciales, usá `PATCH`.

**`DELETE` es idempotente**: la segunda llamada devuelve `404` (o `204`), y eso es
correcto. El *estado* es el mismo de cualquier forma — que es la definición.

---

## Códigos de estado que la gente entiende mal

| Código | Usalo para |
|---|---|
| `200 OK` | éxito con body |
| `201 Created` | creado — **incluí un header `Location`** |
| `202 Accepted` | aceptado para procesamiento asíncrono; todavía no está hecho |
| `204 No Content` | éxito, deliberadamente vacío (un `DELETE`, o un `PUT` que no devuelve nada) |
| `304 Not Modified` | GET condicional, el cache del cliente sigue válido (Cápsula 16) |
| `400 Bad Request` | sintaxis malformada o entrada inválida |
| `401 Unauthorized` | **no autenticado** — no sabemos quién sos |
| `403 Forbidden` | **autenticado pero sin permiso** — sabemos quién sos, y no |
| `404 Not Found` | no existe (o no deberías saber que existe) |
| `409 Conflict` | conflicto de estado — duplicado, versión desincronizada |
| `410 Gone` | existía, se removió permanentemente. Más útil que 404 cuando es cierto |
| `422 Unprocessable` | sintácticamente válido, semánticamente incorrecto |
| `429 Too Many Requests` | rate limit — **siempre incluí `Retry-After`** |
| `500 Internal Server Error` | rompiste vos |
| `502 / 503 / 504` | upstream roto / sobrecargado / timeout del upstream |

**Los tres que más importan:**

- **401 vs 403.** 401 significa "autenticate y probá de nuevo" — el cliente puede
  *hacer* algo. 403 significa "no te gastes". Invertirlos hace que los clientes
  reintenten al pedo o se rindan cuando no deberían.
- **404 vs 403 para autorización.** Devolver `403` por un recurso que existe filtra
  su existencia. Para cualquier cosa sensible, devolvé `404` — "no podés notar la
  diferencia" es la propiedad de seguridad que querés.
- **4xx vs 5xx.** 4xx = culpa del cliente, reintentar igual va a fallar para siempre.
  5xx = culpa tuya, reintentar podría funcionar. Esta distinción maneja cada política
  de reintentos y cada umbral de alerta, así que equivocarla corrompe las dos.

---

## Errores: usá RFC 9457

No inventes un formato de error. Hay un estándar, y es bueno.

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-power",
  "title": "Power level is invalid",
  "status": 422,
  "detail": "Power must be between 0 and 100000000; got -5",
  "instance": "/fighters/goku/readings",
  "errors": [
    {"field": "power", "message": "must be >= 0"}
  ],
  "request_id": "3f2b1a9c"
}
```

- `type` — un URI estable que identifica el *tipo* de problema. Los clientes
  ramifican por esto, nunca por `detail`.
- `title` — corto, humano, estable.
- `detail` — específico de esta ocurrencia. Seguro de cambiar.
- `errors` — una extensión para validación por campo. Devolvé **todas** las fallas de
  una, no la primera.
- `request_id` — para que un usuario lo pueda citar y vos encontrar el trace
  (Cápsula 08).

**Nunca filtres internals**: sin stack traces, sin SQL, sin rutas de archivo, sin
hostnames internos. Logueá eso; devolvé un id.

---

## Paginación

**Cursor/keyset para cualquier cosa grande, creciente o con scroll infinito**
(Cápsula 11):

```http
GET /fighters?limit=20&cursor=eyJpZCI6MTIzfQ

{
  "data": [ ... ],
  "next_cursor": "eyJpZCI6MTQzfQ",
  "has_more": true
}
```

La paginación por offset es aceptable solo para datasets chicos y estables donde los
usuarios genuinamente necesitan números de página. Se pone linealmente más lenta y
produce duplicados con escrituras concurrentes.

**Siempre imponé un `limit` máximo.** Un endpoint que devuelve todo cuando se lo
piden es un vector de denegación de servicio que construiste vos.

**No devuelvas un `total`** salvo que tengas que hacerlo — en una tabla grande es un
scan completo, y suele ser la parte más lenta de la respuesta. `has_more` alcanza para
casi cualquier UI.

---

## Filtrado, ordenamiento, campos escasos

```
GET /readings?fighter=goku&recorded_after=2026-01-01&sort=-power&fields=name,power
```

- **Filtrá** con parámetros de query nombrados como el campo.
- **Ordená** con `sort=campo` / `sort=-campo` para descendente. Múltiple:
  `sort=-power,name`.
- **Sparse fieldsets** (`fields=`) reducen el payload — el GraphQL del pobre, y a
  menudo suficiente.
- **Whitelisteá todo.** Los campos ordenables y filtrables tienen que ser una lista
  explícita de permitidos, o le diste a los usuarios la capacidad de forzar scans
  completos sobre cualquier columna, y posiblemente un vector de inyección.

---

## Versionado

| Enfoque | Ejemplo | Veredicto |
|---|---|---|
| **Ruta en la URL** | `/v1/fighters` | ✅ Obvio, cacheable, fácil de rutear. **El default** |
| Header | `Accept: application/vnd.api.v2+json` | Más puro, más difícil de debuggear, sutilezas de caching |
| Parámetro de query | `/fighters?version=2` | Enturbia el caching, fácil de omitir |

**Versioná la API entera, no endpoints individuales.** Las versiones por endpoint
producen una matriz sobre la que nadie puede razonar.

**Mejor todavía: no versiones.** La mayoría de los cambios pueden ser aditivos:

- ✅ Agregar un campo, un parámetro opcional nuevo, un endpoint nuevo
- ❌ Sacar o renombrar un campo, cambiar un tipo, cambiar un default, hacer
  obligatorio un parámetro opcional, cambiar un código de error

**Los clientes tienen que ignorar campos desconocidos.** Decilo en tu documentación.
Si no lo hacen, cada cambio aditivo es un cambio incompatible y vas a quedar clavado
en v1 para siempre.

Cuando sí versiones: corré las dos, instrumentá el uso por versión, anunciá una
ventana de deprecación con headers `Deprecation` y `Sunset`, y no retires hasta que la
telemetría diga que no queda nadie.

---

## Idempotencia para POST

`POST` no es idempotente, pero los clientes reintentan igual — redes inestables,
doble clic, usuarios impacientes.

```http
POST /orders
Idempotency-Key: 3f2b1a9c-...

→ first call:  201 Created
→ retry:       201 Created (the same body, from cache)
                Idempotency-Replayed: true
```

Guardá clave → respuesta por 24 horas. Manejá el caso concurrente con una restricción
única sobre la clave para que el segundo request espere o reciba `409` en vez de crear
dos veces. Los detalles en la Cápsula 19.

---

## El resto del checklist

- **`Cache-Control` en cada respuesta** (Cápsula 16). Sin header, cada cache adivina
  distinto.
- **`ETag` + `If-None-Match`** en los endpoints de lectura — 304 baratos.
- **Solo HTTPS.** Redirigí HTTP, y poné `Strict-Transport-Security`.
- **CORS a propósito** — nunca `Access-Control-Allow-Origin: *` en una API
  autenticada.
- **Acotá los bodies de request** (`http.MaxBytesReader`, Cápsula 01).
- **Timestamps en RFC 3339 UTC**: `2026-08-05T14:30:00Z`. No enteros epoch, no hora
  local.
- **Plata como entero de unidades menores + código de moneda**, o un string decimal.
  Nunca un float.
- **IDs como strings en JSON.** El `Number` de JavaScript pierde precisión por encima
  de 2^53, y un int64 grande se corrompe en silencio en un navegador.
- **`Retry-After` en 429 y 503.**
- **Una spec OpenAPI**, generada desde o validada contra el código — no mantenida a
  mano, porque una spec mantenida a mano está desactualizada en un mes.

---

## Lab — auditá y arreglá la API del Scouter

```bash
cd ~/repos/pato/gravity-chamber
```

Recorré tus handlers contra este checklist y escribí los hallazgos en `NOTES.md`:

| Chequeo | ¿La tuya? |
|---|---|
| Rutas con forma de recurso, sustantivos plurales | |
| Método correcto para cada operación | |
| `201` + `Location` al crear | |
| `400` vs `422` usados con sentido | |
| Errores `problem+json` con un `type` | |
| Todos los errores de validación devueltos de una | |
| Paginación con `limit` máximo impuesto | |
| Campos de filtro/orden whitelisteados | |
| `Cache-Control` en cada respuesta | |
| `ETag` en los endpoints de lectura | |
| Tamaño de body acotado | |
| Timestamps en RFC 3339 UTC | |
| IDs como strings | |
| `Idempotency-Key` en POST | |
| Request id devuelto en los errores | |

Después arreglá al menos tres. Sugeridos:

**1. Respuestas de error correctas:**

```go
type Problem struct {
	Type      string        `json:"type"`
	Title     string        `json:"title"`
	Status    int           `json:"status"`
	Detail    string        `json:"detail,omitempty"`
	Instance  string        `json:"instance,omitempty"`
	Errors    []FieldError  `json:"errors,omitempty"`
	RequestID string        `json:"request_id,omitempty"`
}

type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func writeProblem(w http.ResponseWriter, r *http.Request, p Problem) {
	p.Instance = r.URL.Path
	p.RequestID = r.Header.Get("X-Request-Id")
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(p)
}
```

**2. Devolvé todos los errores de validación, no solo el primero:**

```go
func validateReading(in recordRequest) []FieldError {
	var errs []FieldError
	if in.Fighter == "" {
		errs = append(errs, FieldError{"fighter", "is required"})
	}
	if len(in.Fighter) > 64 {
		errs = append(errs, FieldError{"fighter", "must be at most 64 characters"})
	}
	if in.Power < 0 {
		errs = append(errs, FieldError{"power", "must be >= 0"})
	}
	if in.Power > 100_000_000 {
		errs = append(errs, FieldError{"power", "must be <= 100000000"})
	}
	return errs
}
```

Alguien completando un formulario debería enterarse de los cuatro problemas en un
solo round trip.

**3. `201` con un header `Location`:**

```go
	w.Header().Set("Location", "/fighters/"+url.PathEscape(rd.Fighter))
	writeJSON(w, http.StatusCreated, rd)
```

---

## Battle drill

<details>
<summary><b>1.</b> Un cliente pide un endpoint de "borrar todas las lecturas de más de 30 días". Diseñalo.</summary>

El instinto es `DELETE /readings?before=2026-07-01`, y es peligroso: un borrado masivo
manejado por un parámetro de query está a un typo de borrar todo, es lo bastante lento
como para hacer timeout, y si un proxy descarta el parámetro borraste la tabla entera.

Mejor: **modelalo como un recurso de job.**

```http
POST /cleanup-jobs
{"older_than": "2026-07-01", "dry_run": true}

→ 202 Accepted
  Location: /cleanup-jobs/8f2a
  {"id": "8f2a", "status": "pending", "estimated_rows": 41203}
```

Después `GET /cleanup-jobs/8f2a` para el progreso. Beneficios: `dry_run` primero, la
estimación antes de comprometerte, una pista de auditoría de quién corrió qué, un
request sincrónico acotado, y borrado en lotes que no bloquea la tabla (Cápsula 24).

Si tiene que ser sincrónico, exigí un token de confirmación explícito y topeá cuántas
filas puede borrar una sola llamada.
</details>

<details>
<summary><b>2.</b> ¿Por qué devolver 404 en vez de 403 para un recurso al que el usuario no puede acceder?</summary>

`403` confirma que el recurso **existe**. Eso es una filtración de información, y es
enumerable: un atacante recorre `/documents/1..100000` y aprende exactamente qué ids
son reales, cuántos clientes tenés, y más o menos cuándo se registraron.

`404` hace indistinguibles "no existe" y "no es tuyo".

Usá `403` cuando el usuario ya sabe que el recurso existe — está en la organización,
lo ve en una lista, pero le falta permiso para esta acción específica. Ahí `403` es
más útil y no filtra nada.

Regla práctica: **403 cuando la existencia ya es conocida por este usuario; 404 si
no.** GitHub hace exactamente esto — los repos privados que no podés ver devuelven
404.
</details>

<details>
<summary><b>3.</b> Tu API devuelve ids int64. Un cliente JavaScript reporta ids corruptos. ¿Por qué?</summary>

Los números JSON son doubles IEEE 754 en JavaScript, exactos solo hasta 2^53 − 1
(9.007.199.254.740.991). Un id snowflake o un int64 grande por encima de eso se
**redondea en silencio** — `JSON.parse` produce un número distinto sin ningún error.

El síntoma clásico: todo funciona hasta que los ids se hacen lo bastante grandes, y
después una fracción chica de requests pega en el registro equivocado. Es intermitente
y muy difícil de rastrear.

**Solución: serializá los ids como strings.** `{"id": "9007199254740993"}`. Twitter
pegó contra esto famosamente y ahora devuelve `id` e `id_str`.

La regla general: **cualquier identificador es un string en JSON**, incluso cuando por
debajo es numérico. Nunca hacés aritmética con un id, así que no hay costo — y hace
que cambiar a un UUID después sea un no-evento.
</details>

<details>
<summary><b>4.</b> ¿Cuándo romperías las convenciones REST a propósito?</summary>

- **Operaciones en lote.** `POST /fighters/batch` con un array le gana a 500 requests
  individuales, especialmente sobre mobile. La RESTfulness pierde contra los round
  trips.
- **Búsqueda.** `POST /searches` con un body de query complejo, porque la query excede
  el largo de URL o contiene caracteres que no sobreviven la codificación. Se pierde
  la cacheabilidad — aceptalo a sabiendas.
- **Acciones con forma de RPC** que genuinamente no son recursos:
  `POST /calls/5/transfer`.
- **Un endpoint de BFF** con forma de pantalla en vez de dominio (Cápsula 23). Ese es
  el diseño *correcto* y no es REST.
- **Long-polling / SSE / WebSockets** para tiempo real, donde request/response no
  encaja en absoluto.

El principio: **las convenciones existen para hacer las cosas predecibles. Rompelas
cuando la convención empeora la API, y documentá por qué.** La consistencia dentro de
tu API importa más que la conformidad con la idea de pureza de otro.
</details>

<details>
<summary><b>5.</b> ¿Cómo deprecás un campo sin romper clientes?</summary>

1. **Anunciá** — changelog, mail, portal de desarrolladores. Dá una fecha, no "pronto".
2. **Agregá el reemplazo**, mantené el campo viejo poblado. Los dos funcionan.
3. **Marcalo deprecado** en la spec OpenAPI, y agregá headers de respuesta:
   `Deprecation: true` y `Sunset: Wed, 01 Apr 2026 00:00:00 GMT` (los dos son
   estándares reales — RFC 9745 y RFC 8594).
4. **Instrumentalo.** Logueá qué clientes siguen leyendo el campo viejo. Sin esto
   estás adivinando, y nunca te vas a sentir seguro de removerlo.
5. **Contactá directamente a los usuarios que quedan.** Normalmente son menos de los
   que temés, y normalmente son fáciles de ayudar.
6. **Remové**, después de la fecha de sunset, en una versión nueva de la API si el
   cambio es incompatible.

El paso que la gente saltea es el **5**, y es el que convierte una deprecación
indefinida en una terminada.
</details>

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "refactor(api): problem+json errors, full validation, 201 Location

Capsule B1. API audited against REST conventions; errors now follow RFC 9457
with a stable type URI and a request id, all validation failures return at
once, and creates return 201 with Location."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done B1
```
