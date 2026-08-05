# Cápsula B3 · La Adivina Uranai Baba — Identidad, auth y JWT

> *Baba no pelea. Verifica quién sos, revisa a qué tenés derecho, y cobra en
> consecuencia — y si no podés pagar, peleás contra sus campeones. Identidad primero,
> permisos después, y siempre hay un costo.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 85 min | ninguno | Cápsula 08 |

---

## Por qué existe esta cápsula

La autenticación es el área donde adivinar con confianza hace más daño. Un error de
performance cuesta milisegundos; un error de auth cuesta los datos de tus usuarios y
el nombre de tu empresa en un titular.

También está llena de términos que la gente usa indistintamente y que significan
cosas genuinamente distintas — OAuth no es autenticación, un JWT no es una sesión, y
"iniciar sesión con Google" es OIDC, no OAuth2.

Esta cápsula ordena eso y te da las reglas de decisión.

---

## Autenticación vs autorización

```
  AUTHENTICATION (authn) — WHO are you?
      login, password, token, certificate, biometric
      → answer: "you are user 4291"
      → failure: 401 Unauthorized

  AUTHORIZATION (authz)  — WHAT may you do?
      roles, permissions, policies, ownership
      → answer: "user 4291 may read document 88, not delete it"
      → failure: 403 Forbidden
```

**Van en lugares distintos.** La autenticación es transversal y va en el borde
(Cápsula 08). La autorización necesita conocer *recursos* y va en el servicio dueño
de ellos — solo el servicio de documentos sabe quién es dueño del documento 88.

Confundirlos produce la vulnerabilidad clásica: un gateway que autentica bien y un
servicio que asume que cualquiera que llegó hasta él puede hacer cualquier cosa.

---

## Sesiones vs tokens

**Sesiones del lado del servidor** — el modelo clásico:

```
  login → server creates session, stores it → sets a cookie with the session id
  request → cookie → server looks up the session → knows the user
```

**Tokens (JWT)** — autocontenidos:

```
  login → server signs a token containing claims → client stores it
  request → Authorization: Bearer <token> → server VERIFIES THE SIGNATURE
```

**A favor:** sin lookup, sin almacenamiento compartido, funciona entre servicios y
dominios.
**En contra:** **no los podés revocar.** Un token robado es válido hasta que expire.
Requests más grandes. Los claims pueden estar viejos.

> **La regla de decisión:** si podés usar sesiones del lado del servidor, usalas. Son
> más simples y la revocación funciona de verdad. Agarrá JWTs cuando genuinamente
> necesitás statelessness entre servicios o dominios — y ahí, mantenelos de vida
> corta.

**El híbrido que usan la mayoría de los sistemas reales, y el que hay que recordar:**

- **Access token** — un JWT, de vida corta (5–15 minutos), nunca revocado porque
  expira lo bastante rápido como para que no importe.
- **Refresh token** — de vida larga (días/semanas), **guardado del lado del
  servidor**, revocable, de un solo uso con rotación.

Tenés statelessness en el camino caliente y revocación real donde cuenta.

---

## JWT, con precisión

Tres segmentos base64url separados por puntos:

```
  eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9  .  eyJzdWIiOiI0MjkxIiwiZXhwIjoxNzY...  .  MEUCIQD...
  └─────────── header ───────────────┘     └─────────── payload ──────────┘     └─ signature ─┘
```

```json
// header
{"alg": "RS256", "typ": "JWT", "kid": "2026-08-key-1"}

// payload — these are CLAIMS, and the registered ones are standardised
{
  "iss": "https://auth.example.com",   // issuer      — WHO issued it
  "sub": "4291",                        // subject     — WHO it is about
  "aud": "https://api.example.com",     // audience    — WHO it is for
  "exp": 1767225600,                    // expiry      — MUST be checked
  "iat": 1767224700,                    // issued at
  "nbf": 1767224700,                    // not before
  "jti": "a3f2b1",                      // unique id   — for a denylist
  "scope": "readings:write readings:read"
}
```

**El payload es base64, no está cifrado. Cualquiera lo puede leer.** Pegá uno en
jwt.io y fijate. Nunca pongas nada secreto en un JWT.

### Los cinco chequeos que tiene que hacer un verificador

Salteate cualquiera y tenés una vulnerabilidad:

1. **Firma** — verificada contra la clave esperada.
2. **`alg`** — tiene que coincidir con lo que esperás, **desde tu propia
   configuración, no desde el header del token**.
3. **`exp`** — no expirado (con una tolerancia chica de desfase de reloj).
4. **`iss`** — emitido por el emisor en el que confiás.
5. **`aud`** — destinado a *vos*. Sin esto, un token acuñado para el servicio A lo
   acepta el servicio B — **confusión de tokens**, y es un bug real y común.

### Las dos vulnerabilidades clásicas de JWT

**`alg: none`.** Las librerías tempranas respetaban un header que declaraba ningún
algoritmo y aceptaban cualquier token. **Nunca leas `alg` del token para decidir cómo
verificarlo.** Configurá vos el algoritmo esperado.

**Confusión de algoritmos (RS256 → HS256).** Un token se firma con RSA; un atacante
cambia `alg` a `HS256` y lo firma usando tu *clave pública* como secreto HMAC. Una
librería ingenua usa "la clave" para el algoritmo que nombre el header, y la clave
pública es pública. La misma solución: fijá el algoritmo.

### Simétrico vs asimétrico

| | HS256 (simétrico) | RS256 / ES256 (asimétrico) |
|---|---|---|
| Clave de firma | secreto compartido | clave privada |
| Clave de verificación | **el mismo secreto** | clave pública |
| Quién puede acuñar tokens | cualquiera que pueda verificar | solo el emisor |
| Usalo cuando | un servicio hace las dos cosas | muchos verifican, uno emite |

**En un sistema distribuido, siempre asimétrico.** Con HS256 cada servicio que
verifica tiene una clave que también puede *crear* tokens — un servicio comprometido y
un atacante puede hacerse pasar por cualquiera.

Las claves públicas se publican en un endpoint **JWKS**
(`/.well-known/jwks.json`), los verificadores las bajan y cachean, y `kid` en el
header selecciona cuál — que es lo que hace posible la rotación de claves sin
downtime.

---

## OAuth 2.0 y OIDC

**La aclaración más útil de esta cápsula:**

> **OAuth 2.0 es un framework de *autorización*: le otorga a una aplicación acceso
> limitado a un recurso en nombre de un usuario. NO es autenticación.**
>
> **OpenID Connect (OIDC) es una capa fina sobre OAuth 2.0 que agrega
> autenticación** — define un `id_token` (un JWT sobre el usuario) y un endpoint
> `/userinfo`.

"Iniciar sesión con Google" es **OIDC**. Usar OAuth2 solo para login es un antipatrón
conocido: un access token prueba que podés llamar a una API, no quién es el usuario.

### Flujo Authorization Code con PKCE — el único que deberías usar

```
  1. app → browser → authorization server
       ?client_id=...&redirect_uri=...&scope=openid email
       &code_challenge=BASE64URL(SHA256(verifier))&state=xyz

  2. user authenticates and consents

  3. authorization server → redirect back with ?code=abc&state=xyz

  4. app → token endpoint (BACK CHANNEL, server to server)
       code=abc & code_verifier=<the original random string>

  5. ← { access_token, id_token, refresh_token }
```

**Por qué PKCE** (Proof Key for Code Exchange): el código de autorización viaja por el
navegador, donde puede ser interceptado. PKCE hace inútil el código sin el
`code_verifier`, que nunca salió del cliente. Originalmente para apps mobile;
**ahora se recomienda para todos los clientes, incluidos los del lado del servidor.**

**`state`** es un mecanismo separado de protección CSRF en el redirect — tiene que ser
aleatorio por request y validarse al volver.

**Los flujos a evitar:** *Implicit* (tokens en el fragmento de la URL — deprecado) y
*Resource Owner Password Credentials* (la app maneja la contraseña del usuario —
anula el punto entero).

El flujo **Client Credentials** está bien y es el que usás para auth
**servicio-a-servicio** sin usuario involucrado.

---

## Dónde guardar tokens en un navegador

La pregunta sin respuesta perfecta:

| Almacenamiento | Riesgo XSS | Riesgo CSRF | Notas |
|---|---|---|---|
| `localStorage` | ❌ **legible por cualquier script** | ✅ seguro | conveniente, y la mala elección común |
| `sessionStorage` | ❌ igual | ✅ | mismo problema, vida más corta |
| Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) | ✅ **JS no la puede leer** | ⚠️ necesita `SameSite` + token CSRF | **el default correcto** |
| Solo en memoria | ✅ | ✅ | se pierde al refrescar; combinalo con una cookie de refresh |

**Usá cookies `HttpOnly`.** Si existe una vulnerabilidad XSS, `localStorage` le
entrega el token al atacante directamente. `HttpOnly` al menos significa que tiene que
hacer requests desde el navegador de la víctima en vez de exfiltrar una credencial que
puede usar en cualquier lado, para siempre.

El patrón fuerte: **access token en memoria, refresh token en una cookie `HttpOnly`,
`Secure`, `SameSite=Strict` acotada solo al endpoint de refresh.**

---

## Modelos de autorización

**RBAC** — los roles cargan permisos.
```
  user → role(s) → permissions
  alice → editor → [posts:read, posts:write]
```
Simple, familiar, y se rompe apenas necesitás "editor de *este* proyecto" — terminás
con explosión de roles.

**ABAC** — decisiones a partir de atributos.
```
  allow if user.department == resource.department AND resource.status != "locked"
```
Flexible, más difícil de auditar ("¿quién puede acceder a X?" necesita evaluación, no
una búsqueda).

**ReBAC** — decisiones a partir de relaciones en un grafo. El modelo de Zanzibar de
Google, y lo que implementan SpiceDB/OpenFGA.
```
  document:88#viewer@user:alice
  folder:hr#viewer@group:hr-team#member
  document:88#parent@folder:hr        → alice inherits access
```

El modelo correcto para compartir, jerarquías y queries de "¿quién tiene acceso a
esto?". Es lo que usa Google Docs en realidad.

**Empezá con RBAC.** Movete cuando sientas la explosión de roles, y movete al modelo
que coincida con cómo tus usuarios *hablan* de los permisos.

**Siempre imponé la autorización en el servicio dueño del recurso**, no solo en la UI
o el gateway. Que la UI esconda un botón es usabilidad, no un control de seguridad.

---

## Lab

### Paso 1 — acuñá y verificá un JWT

```bash
go get github.com/golang-jwt/jwt/v5
```

**`internal/auth/jwt.go`**

```go
package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	Scope string `json:"scope"`
	jwt.RegisteredClaims
}

type Issuer struct {
	key      *rsa.PrivateKey
	kid      string
	issuer   string
	audience string
	ttl      time.Duration
}

func NewIssuer(issuer, audience string, ttl time.Duration) (*Issuer, error) {
	// In production this key comes from Secret Manager or a KMS — never
	// generated at startup, or every restart invalidates every token.
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	return &Issuer{key: key, kid: "dev-key-1", issuer: issuer, audience: audience, ttl: ttl}, nil
}

func (i *Issuer) Mint(subject, scope string) (string, error) {
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, Claims{
		Scope: scope,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    i.issuer,
			Subject:   subject,
			Audience:  jwt.ClaimStrings{i.audience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			// SHORT. A JWT cannot be revoked, so expiry is your only
			// mechanism for limiting the damage of a stolen token.
			ExpiresAt: jwt.NewNumericDate(now.Add(i.ttl)),
			ID:        randomID(),
		},
	})
	tok.Header["kid"] = i.kid
	return tok.SignedString(i.key)
}

type Verifier struct {
	pub      *rsa.PublicKey
	issuer   string
	audience string
}

func (i *Issuer) Verifier() *Verifier {
	return &Verifier{pub: &i.key.PublicKey, issuer: i.issuer, audience: i.audience}
}

var ErrInvalidToken = errors.New("invalid token")

// Verify performs ALL FIVE required checks. Skipping any one of them is a
// vulnerability, not a shortcut.
func (v *Verifier) Verify(raw string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(raw, &Claims{},
		func(t *jwt.Token) (any, error) {
			// 2. ALGORITHM PINNED HERE, from our config — never read from
			// the token's own header. This is what defeats `alg: none`
			// and RS256->HS256 algorithm confusion.
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
			}
			return v.pub, nil // 1. signature verified against our public key
		},
		jwt.WithValidMethods([]string{"RS256"}), // belt and braces
		jwt.WithIssuer(v.issuer),                // 4. issuer
		jwt.WithAudience(v.audience),            // 5. AUDIENCE — prevents token confusion
		jwt.WithExpirationRequired(),            // 3. expiry must be present
		jwt.WithLeeway(30*time.Second),          // clock skew
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}

	claims, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// randomID gives each token a unique jti, so a denylist is possible later.
func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}
```

### Paso 2 — un test que prueba que cada chequeo funciona

**`internal/auth/jwt_test.go`**

```go
package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func newIssuer(t *testing.T, ttl time.Duration) *Issuer {
	t.Helper()
	i, err := NewIssuer("https://auth.test", "https://api.test", ttl)
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func TestValidTokenPasses(t *testing.T) {
	i := newIssuer(t, time.Minute)
	tok, err := i.Mint("user-4291", "readings:write")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := i.Verifier().Verify(tok)
	if err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
	if claims.Subject != "user-4291" || claims.Scope != "readings:write" {
		t.Errorf("claims = %+v", claims)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	i := newIssuer(t, -time.Hour) // already expired
	tok, _ := i.Mint("user-1", "")
	if _, err := i.Verifier().Verify(tok); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("expired token accepted: %v", err)
	}
}

func TestWrongAudienceRejected(t *testing.T) {
	// A token minted for the billing API must NOT be accepted by this one.
	// Without the aud check, any service that trusts the same issuer
	// accepts tokens meant for any other service — token confusion.
	other, _ := NewIssuer("https://auth.test", "https://billing.test", time.Minute)
	tok, _ := other.Mint("user-1", "")

	// Trust the same issuer and the same signing key — the ONLY difference
	// is the audience we expect. The token is perfectly valid; it just
	// wasn't minted for us.
	v := &Verifier{pub: &other.key.PublicKey, issuer: "https://auth.test", audience: "https://api.test"}
	if _, err := v.Verify(tok); err == nil {
		t.Error("token for a different audience was accepted")
	}
}

func TestTamperedTokenRejected(t *testing.T) {
	i := newIssuer(t, time.Minute)
	tok, _ := i.Mint("user-1", "readings:read")

	parts := strings.Split(tok, ".")
	// swap a character in the payload
	payload := []byte(parts[1])
	payload[5] = 'A'
	tampered := parts[0] + "." + string(payload) + "." + parts[2]

	if _, err := i.Verifier().Verify(tampered); err == nil {
		t.Error("tampered token accepted — the signature check is not working")
	}
}

func TestAlgNoneRejected(t *testing.T) {
	// The classic attack: a token claiming no signature at all.
	// {"alg":"none","typ":"JWT"} . {"sub":"admin"} .
	forged := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0." +
		"eyJzdWIiOiJhZG1pbiIsImlzcyI6Imh0dHBzOi8vYXV0aC50ZXN0In0."

	i := newIssuer(t, time.Minute)
	if _, err := i.Verifier().Verify(forged); err == nil {
		t.Error("alg:none token accepted — CRITICAL")
	}
}
```

```bash
go test ./internal/auth/ -v
```

**Cada uno de esos tests fallando es un CVE real que alguien shippeó.**

### Paso 3 — decodificá un token a mano

```bash
TOKEN="<paste one your code minted>"
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq
```

El payload es **legible sin ninguna clave**. Decilo en voz alta: un JWT está firmado,
no cifrado. Cualquiera con el token puede leer cada claim.

> ### ⏸ Punto natural para cortar
>
> Todo lo de arriba se sostiene solo — commiteálo y volvé después. Los pasos que
> siguen construyen sobre eso pero no dejan nada inestable si parás acá. Dos
> sesiones de 45 minutos le ganan a una de 90 que no terminás.

### Paso 4 — middleware, y la separación authn/authz

```go
type ctxKey struct{}

// Authenticate answers WHO. It belongs at the edge and it is generic.
func Authenticate(v *Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok {
				// 401 = we don't know who you are. WWW-Authenticate tells
				// the client how to fix it, which is what makes it a 401
				// rather than a 403.
				w.Header().Set("WWW-Authenticate", `Bearer realm="api"`)
				writeErr(w, http.StatusUnauthorized, "bearer token required")
				return
			}
			claims, err := v.Verify(raw)
			if err != nil {
				w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
				writeErr(w, http.StatusUnauthorized, "invalid token")
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, claims)))
		})
	}
}

// RequireScope answers WHAT — a coarse check that can live at the edge.
func RequireScope(scope string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(ctxKey{}).(*Claims)
		if !ok || !slices.Contains(strings.Fields(claims.Scope), scope) {
			// 403 = we know who you are, and no.
			writeErr(w, http.StatusForbidden, "missing scope: "+scope)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

**Y la parte que NO va en el borde:**

```go
func (s *Server) handleDeleteReading(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxKey{}).(*Claims)
	reading, err := s.store.GetReading(r.Context(), r.PathValue("id"))
	// …

	// RESOURCE-LEVEL AUTHORIZATION. The gateway cannot do this — it has no
	// idea who owns reading 88. Every service must enforce ownership for
	// the resources it owns.
	if reading.OwnerID != claims.Subject && !hasRole(claims, "admin") {
		// 404, not 403: don't confirm that a reading you can't access exists.
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	// …
}
```

### Paso 5 — rotación de refresh tokens

```go
// Refresh tokens ARE stored server-side, which is what makes them revocable.
// Rotation means each refresh invalidates the previous token.
type RefreshStore interface {
	Issue(ctx context.Context, userID string) (token string, err error)
	// Redeem returns the user and invalidates the token. If a token that was
	// ALREADY redeemed is presented, that means it was stolen and replayed:
	// revoke the entire family and force a re-login.
	Redeem(ctx context.Context, token string) (userID string, reused bool, err error)
	RevokeAllForUser(ctx context.Context, userID string) error
}
```

**La detección de reuso es la parte importante**, y es la que la mayoría de las
implementaciones se pierde. Si un refresh token se presenta dos veces, o el cliente
tiene un bug o un atacante lo robó y lo usó después del cliente legítimo. No podés
saber cuál, así que revocás todo y hacés que el usuario vuelva a loguearse. Esta es la
mitigación estándar y es lo que hace sobrevivible el robo de un refresh token.

---

## En GCP

- **Identity Platform / Firebase Auth** — authn completa: email/contraseña, teléfono,
  MFA, todos los proveedores sociales, OIDC y SAML para SSO empresarial. Emite JWTs
  que tu backend verifica. Esto es lo que deberías usar en vez de construir login.
- **IAP (Identity-Aware Proxy)** — pone autenticación con cuenta de Google delante de
  cualquier backend con **cero código de aplicación**, más autorización por grupos y
  audit logs. Para herramientas internas y paneles de admin es la opción de mayor
  valor por esfuerzo de GCP (Cápsula 08).
- **Servicio-a-servicio** — identity tokens OIDC desde el metadata server. Sin
  secretos ([B7](../B7-kamis-ledger-iam-service-accounts/README.md)).
- **Secret Manager** para las claves de firma, con rotación automática. Nunca una
  clave generada al arrancar, nunca una clave en una variable de entorno que pusiste a
  mano.
- **Cloud KMS** — firmá sin nunca tener la clave privada. El material de la clave
  nunca sale del HSM, lo que elimina una categoría entera de compromiso.
- **Cloud Armor** — gestión de bots y rate limiting en los endpoints de login, que es
  donde cae el credential stuffing.

---

## Llevátelo al trabajo

- **Nunca escribas tu propio login.** Usá un proveedor de identidad. El
  almacenamiento de contraseñas, los flujos de reseteo, el MFA y la defensa contra
  toma de cuentas son productos enteros.
- **Si tenés que guardar una contraseña: Argon2id** (o bcrypt/scrypt), nunca un hash
  pelado, nunca MD5/SHA-1, nunca una sal compartida.
- **Verificá los cinco claims del JWT**, y **fijá el algoritmo**.
- **Firma asimétrica** en cualquier cosa distribuida.
- **Access tokens de vida corta + refresh tokens revocables y rotativos.**
- **Cookies `HttpOnly`, `Secure`, `SameSite`.** No `localStorage`.
- **Autorización en el servicio dueño del recurso.** Siempre. La UI y el gateway no
  son fronteras de seguridad para acceso a recursos.
- **404 sobre 403** cuando la existencia misma es sensible.
- **Logueá las fallas de auth con contexto suficiente para detectar ataques**, y nunca
  loguees el token en sí.
- **Rotá claves con `kid` + JWKS** para que la rotación sea un no-evento.

---

## Battle drill

<details>
<summary><b>1.</b> ¿Por qué no podés revocar un JWT, y qué hacés al respecto?</summary>

Porque la verificación es puramente local: firma + claims. Sin lookup no hay lugar
donde chequear "¿esto fue cancelado?". Esa statelessness es el beneficio entero y el
costo entero.

Opciones, con sus trade-offs:

- **Expiración corta (5–15 min).** La respuesta estándar. Aceptás una ventana acotada
  de exposición y obtenés statelessness en el camino caliente.
- **Una denylist de valores `jti`** en Redis, chequeada en cada request. Ahora tenés
  un lookup — recreaste las sesiones con pasos extra. A veces se justifica solo para
  operaciones de alto valor.
- **Un claim de versión de token** comparado contra un contador por usuario que
  incrementás al cerrar sesión. Sigue siendo un lookup, pero cacheable y barato.
- **Revocación del refresh token** — el access token expira en minutos y el refresh
  token, que *sí* tiene estado, se revoca. **Este es el patrón a usar.**

Si genuinamente necesitás revocación instantánea en cada request, necesitás sesiones.
Esa es una respuesta legítima, no una derrota.
</details>

<details>
<summary><b>2.</b> Explicá el ataque de confusión RS256 → HS256.</summary>

Tu servicio verifica tokens RS256 con una clave **pública**, que por definición es
pública.

Un atacante toma un token válido, cambia el header a `{"alg":"HS256"}`, falsifica los
claims que quiera, y lo firma usando tu **clave pública como secreto compartido de
HMAC**.

Una librería ingenua implementa "verificá con la clave provista, usando el algoritmo
que nombre el token". Ve HS256, usa los bytes de la clave pública como secreto HMAC, y
la firma coincide — porque el atacante usó exactamente esa clave.

**La solución es una línea: nunca dejes que el token elija el algoritmo de
verificación.** Fijalo en tu configuración
(`jwt.WithValidMethods([]string{"RS256"})`, y chequeá el tipo del método dentro de la
función de clave).

La lección general, que aplica mucho más allá de los JWTs: **nunca dejes que la
entrada no confiable determine cómo se va a validar.**
</details>

<details>
<summary><b>3.</b> ¿Dónde imponés "el usuario 42 solo puede editar sus propios posts"?</summary>

**En el servicio de posts**, en el punto de la operación, después de cargar el
recurso.

No en la UI — esconder el botón es usabilidad, y cualquiera puede llamar a la API
directo.
No en el gateway — no tiene idea de quién es dueño del post 88, y darle ese
conocimiento significa darle tu base de datos.
No solo en un middleware que chequea un scope `posts:write` — eso dice que el usuario
puede escribir *algún* post, no *este*.

El patrón:

```go
post := load(id)
if post.AuthorID != claims.Subject && !isAdmin(claims) {
    return notFound()   // 404, not 403
}
```

Y testealo: una suite de tests de autorización que verifique que el usuario A no puede
tocar los recursos del B es una de las suites de mayor valor que podés escribir,
porque esta clase de bug (IDOR — insecure direct object reference) está
consistentemente en el OWASP Top 10.
</details>

<details>
<summary><b>4.</b> Un JWT contiene <code>{"role": "admin"}</code>. ¿Es seguro?</summary>

Seguro contra *manipulación* — sí, si verificás la firma. El claim no se puede
modificar sin invalidarlo.

Inseguro de otras dos formas:

**Obsolescencia.** Degradás a alguien de admin. Su token sigue diciendo admin hasta
que expira. Con un token de 24 horas, eso son 24 horas de acceso no intencionado. Este
es el argumento más fuerte a favor de la expiración corta.

**Granularidad.** ¿"admin" de qué? Un claim de rol no puede expresar "admin de la
organización 7", así que terminás sobre-otorgando o metiendo una lista creciente de
ids de organización en el token — y los JWTs van en headers, que tienen límites de
tamaño.

**La respuesta habitual:** poné *identidad* y scopes *gruesos* en el token
(`sub`, `scope: "posts:write"`), y buscá los permisos *finos* en el servicio, donde
están actualizados y pueden ser tan detallados como necesites. Cacheá ese lookup por
segundos si es caliente.
</details>

<details>
<summary><b>5.</b> Diseñá la autenticación para: una app web, una app mobile, una API pública y servicios internos.</summary>

Cuatro clientes distintos, cuatro respuestas distintas — y reconocer que son distintas
es el punto.

**App web** — OIDC Authorization Code + PKCE contra un proveedor de identidad. Cookie
de sesión (`HttpOnly`, `Secure`, `SameSite=Lax`) *o* un access token en memoria con un
refresh token en una cookie `HttpOnly`. Protección CSRF vía `SameSite` más un token en
los requests que cambian estado.

**App mobile** — OIDC Authorization Code + PKCE (nunca el flujo implicit), usando el
navegador del sistema en vez de un webview embebido para que las credenciales no
queden expuestas a la app. Tokens en el keychain/keystore de la plataforma. Refresh
con rotación.

**API pública** — OAuth2 Client Credentials para clientes máquina; API keys solo para
endpoints de lectura de bajo riesgo, y ahí acotadas, con rate limit y rotables. Cuotas
por key en el gateway (Cápsula 08). Nunca una sola key compartida entre clientes.

**Servicios internos** — sin identidad de usuario involucrada: identidad de workload.
En GCP, identity tokens OIDC desde el metadata server con `audience` apuntando al
servicio destino, verificados por el receptor; o mTLS vía un service mesh. **Sin
secretos compartidos en ningún lado**
([B7](../B7-kamis-ledger-iam-service-accounts/README.md)).

Común a los cuatro: autenticá en el borde, autorizá en el servicio, credenciales de
vida corta, y audit logs en cada decisión de auth que importe.
</details>

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(auth): RS256 JWT issuing and verification with all five checks

Capsule B3. Algorithm pinned in config so alg:none and RS256->HS256 confusion
are rejected; audience checked so tokens for other services are refused.
Tests cover expiry, tampering, wrong audience and alg:none. Authentication is
middleware; resource ownership is enforced in the handler."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done B3
```
