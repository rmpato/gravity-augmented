# Capsule B3 · Fortuneteller Baba — Identity, Auth & JWT

> *Baba doesn't fight. She verifies who you are, checks what you're entitled to,
> and charges accordingly — and if you can't pay, you fight her champions
> instead. Identity first, entitlement second, and there is always a cost.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 85 min | none | Capsule 08 |

---

## Why this capsule exists

Authentication is the area where confident guessing does the most damage. A
performance mistake costs milliseconds; an auth mistake costs your users' data
and your company's name in a headline.

It's also full of terms people use interchangeably that mean genuinely different
things — OAuth is not authentication, a JWT is not a session, and "log in with
Google" is OIDC, not OAuth2.

This capsule sorts that out and gives you the decision rules.

---

## Authentication vs authorization

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

**They belong in different places.** Authentication is cross-cutting and belongs
at the edge (Capsule 08). Authorization needs to know about *resources* and
belongs in the service that owns them — only the document service knows who owns
document 88.

Mixing them up produces the classic vulnerability: a gateway that authenticates
correctly and a service that assumes anyone who reached it is allowed to do
anything.

---

## Sessions vs tokens

**Server-side sessions** — the classic model:

```
  login → server creates session, stores it → sets a cookie with the session id
  request → cookie → server looks up the session → knows the user
```

**For:** revocation is instant (delete the row); the cookie carries no data;
easy to change permissions immediately.
**Against:** requires shared session storage across replicas (Capsule 06); a
lookup on every request.

**Tokens (JWT)** — self-contained:

```
  login → server signs a token containing claims → client stores it
  request → Authorization: Bearer <token> → server VERIFIES THE SIGNATURE
```

**For:** no lookup, no shared storage, works across services and domains.
**Against:** **you cannot revoke it.** A stolen token is valid until it expires.
Bigger requests. Claims can be stale.

> **The decision rule:** if you can use server-side sessions, use them. They're
> simpler and revocation actually works. Reach for JWTs when you genuinely need
> statelessness across services or domains — and then keep them short-lived.

**The hybrid that most real systems use, and the one to remember:**

- **Access token** — a JWT, short-lived (5–15 minutes), never revoked because it
  expires fast enough not to matter.
- **Refresh token** — long-lived (days/weeks), **stored server-side**, revocable,
  single-use with rotation.

You get statelessness on the hot path and real revocation where it counts.

---

## JWT, precisely

Three base64url segments separated by dots:

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

**The payload is base64, not encrypted. Anyone can read it.** Paste one into
jwt.io and see. Never put anything secret in a JWT.

### The five checks a verifier must perform

Miss any one of these and you have a vulnerability:

1. **Signature** — verified against the expected key.
2. **`alg`** — must match what you expect, **from your own configuration, not
   from the token's header**.
3. **`exp`** — not expired (with a small clock-skew allowance).
4. **`iss`** — issued by the issuer you trust.
5. **`aud`** — intended for *you*. Without this, a token minted for service A is
   accepted by service B — **token confusion**, and it's a real and common bug.

### The two classic JWT vulnerabilities

**`alg: none`.** Early libraries honoured a header claiming no algorithm and
accepted any token. **Never read `alg` from the token to decide how to verify
it.** Configure the expected algorithm yourself.

**Algorithm confusion (RS256 → HS256).** A token is signed with RSA; an attacker
changes `alg` to `HS256` and signs it using your *public key* as the HMAC secret.
A naive library uses "the key" for whichever algorithm the header names, and the
public key is public. Same fix: pin the algorithm.

### Symmetric vs asymmetric

| | HS256 (symmetric) | RS256 / ES256 (asymmetric) |
|---|---|---|
| Signing key | shared secret | private key |
| Verifying key | **the same secret** | public key |
| Who can mint tokens | anyone who can verify | only the issuer |
| Use when | one service does both | many services verify, one issues |

**In a distributed system, always asymmetric.** With HS256 every verifying
service holds a key that can also *create* tokens — one compromised service and
an attacker can impersonate anyone.

Public keys are published at a **JWKS** endpoint
(`/.well-known/jwks.json`), fetched and cached by verifiers, and `kid` in the
header selects which key — which is what makes key rotation possible without
downtime.

---

## OAuth 2.0 and OIDC

**The single most useful clarification in this capsule:**

> **OAuth 2.0 is an *authorization* framework: it grants an application limited
> access to a resource on a user's behalf. It is NOT authentication.**
>
> **OpenID Connect (OIDC) is a thin layer on top of OAuth 2.0 that adds
> authentication** — it defines an `id_token` (a JWT about the user) and a
> `/userinfo` endpoint.

"Log in with Google" is **OIDC**. Using OAuth2 alone for login is a known
anti-pattern: an access token proves you can call an API, not who the user is.

### Authorization Code flow with PKCE — the only one you should use

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

**Why PKCE** (Proof Key for Code Exchange): the authorization code travels
through the browser, where it can be intercepted. PKCE makes the code useless
without the `code_verifier`, which never left the client. Originally for mobile
apps; **now recommended for all clients, including server-side ones.**

**`state`** is a separate mechanism for CSRF protection on the redirect — it must
be random per request and validated on return.

**The flows to avoid:** *Implicit* (tokens in the URL fragment — deprecated) and
*Resource Owner Password Credentials* (the app handles the user's password —
defeats the entire point).

**Client Credentials** flow is fine and is what you use for **service-to-service**
auth with no user involved.

---

## Where to store tokens in a browser

The question with no perfect answer:

| Storage | XSS risk | CSRF risk | Notes |
|---|---|---|---|
| `localStorage` | ❌ **readable by any script** | ✅ safe | convenient, and the common bad choice |
| `sessionStorage` | ❌ same | ✅ | same problem, shorter life |
| Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) | ✅ **JS cannot read it** | ⚠️ needs `SameSite` + CSRF token | **the right default** |
| In memory only | ✅ | ✅ | lost on refresh; pair with a refresh cookie |

**Use `HttpOnly` cookies.** If an XSS vulnerability exists, `localStorage` hands
the attacker the token directly. `HttpOnly` at least means they must make requests
from the victim's browser rather than exfiltrating a credential they can use
anywhere, forever.

The strong pattern: **access token in memory, refresh token in an `HttpOnly`,
`Secure`, `SameSite=Strict` cookie scoped to the refresh endpoint only.**

---

## Authorization models

**RBAC** — roles carry permissions.
```
  user → role(s) → permissions
  alice → editor → [posts:read, posts:write]
```
Simple, familiar, and it breaks down as soon as you need "editor of *this*
project" — you get role explosion.

**ABAC** — decisions from attributes.
```
  allow if user.department == resource.department AND resource.status != "locked"
```
Flexible, harder to audit ("who can access X?" needs evaluation, not a lookup).

**ReBAC** — decisions from relationships in a graph. Google Zanzibar's model,
and what SpiceDB/OpenFGA implement.
```
  document:88#viewer@user:alice
  folder:hr#viewer@group:hr-team#member
  document:88#parent@folder:hr        → alice inherits access
```
The right model for sharing, hierarchies and "who has access to this?" queries.
It's what Google Docs actually uses.

**Start with RBAC.** Move when you feel role explosion, and move to the model
that matches how your users *talk* about permissions.

**Always enforce authorization in the service that owns the resource**, not only
in the UI or the gateway. The UI hiding a button is a usability feature, not a
security control.

---

## Lab

### Step 1 — mint and verify a JWT

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

### Step 2 — a test that proves each check works

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

**Every one of those failing tests is a real CVE somebody shipped.**

### Step 3 — decode a token by hand

```bash
TOKEN="<paste one your code minted>"
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq
```

The payload is **readable without any key**. Say it out loud: a JWT is signed,
not encrypted. Anyone with the token can read every claim.

> ### ⏸ Natural stopping point
>
> Everything above stands on its own — commit it and come back. The steps below
> build on it but don't destabilise anything if you stop here. Two 45-minute
> sittings beat one 90-minute slog you don't finish.

### Step 4 — middleware, and the authn/authz split

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

**And the part that must NOT be at the edge:**

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

### Step 5 — refresh token rotation

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

**Reuse detection is the important part**, and it's what most implementations
miss. If a refresh token is presented twice, either the client has a bug or an
attacker stole it and used it after the legitimate client. You cannot tell which,
so you revoke everything and make the user log in again. This is the standard
mitigation and it's what makes refresh-token theft survivable.

---

## In GCP

- **Identity Platform / Firebase Auth** — full authn: email/password, phone, MFA,
  every social provider, OIDC and SAML for enterprise SSO. It issues JWTs your
  backend verifies. This is what you should use rather than building login.
- **IAP (Identity-Aware Proxy)** — puts Google-account authentication in front of
  any backend with **zero application code**, plus group-based authorization and
  audit logs. For internal tools and admin panels this is the highest
  value-per-effort option on GCP (Capsule 08).
- **Service-to-service** — OIDC identity tokens from the metadata server. No
  secrets at all ([B7](../B7-kamis-ledger-iam-service-accounts/README.md)).
- **Secret Manager** for signing keys, with automatic rotation. Never a key
  generated at startup, never a key in an env var you set by hand.
- **Cloud KMS** — sign without ever holding the private key. The key material
  never leaves the HSM, which removes an entire class of compromise.
- **Cloud Armor** — bot management and rate limiting on login endpoints, which is
  where credential stuffing lands.

---

## Bring it to work

- **Never write your own login.** Use an identity provider. Password storage,
  reset flows, MFA, and account-takeover defence are entire products.
- **If you must store a password: Argon2id** (or bcrypt/scrypt), never a plain
  hash, never MD5/SHA-1, never a shared salt.
- **Verify all five JWT claims**, and **pin the algorithm**.
- **Asymmetric signing** in anything distributed.
- **Short-lived access tokens + revocable, rotating refresh tokens.**
- **`HttpOnly`, `Secure`, `SameSite` cookies.** Not `localStorage`.
- **Authorization in the service that owns the resource.** Always. The UI and the
  gateway are not security boundaries for resource access.
- **404 over 403** when existence itself is sensitive.
- **Log auth failures with enough context to detect attacks**, and never log the
  token itself.
- **Rotate keys with `kid` + JWKS** so rotation is a non-event.

---

## Battle drill

<details>
<summary><b>1.</b> Why can't you revoke a JWT, and what do you do about it?</summary>

Because verification is purely local: signature + claims. No lookup means no
place to check "was this cancelled?". That statelessness is the entire benefit
and the entire cost.

Options, with their trade-offs:

- **Short expiry (5–15 min).** The standard answer. You accept a bounded window
  of exposure and get statelessness on the hot path.
- **A denylist of `jti` values** in Redis, checked on every request. Now you have
  a lookup — you've re-created sessions with extra steps. Sometimes justified for
  high-value operations only.
- **A token version claim** compared against a per-user counter you bump on
  logout. Still a lookup, but cacheable and cheap.
- **Refresh token revocation** — the access token expires in minutes and the
  refresh token, which *is* stateful, is revoked. **This is the pattern to use.**

If you genuinely need instant revocation on every request, you need sessions.
That's a legitimate answer, not a defeat.
</details>

<details>
<summary><b>2.</b> Explain the RS256 → HS256 confusion attack.</summary>

Your service verifies RS256 tokens with a **public** key, which by definition is
public.

An attacker takes a valid token, changes the header to `{"alg":"HS256"}`, forges
whatever claims they like, and signs it using your **public key as the HMAC
shared secret**.

A naive library implements "verify with the provided key, using the algorithm the
token names". It sees HS256, uses the public key bytes as an HMAC secret, and the
signature matches — because the attacker used exactly that key.

**The fix is one line: never let the token choose the verification algorithm.**
Pin it in your configuration (`jwt.WithValidMethods([]string{"RS256"})`, and check
the method type inside the key function).

The general lesson, which applies well beyond JWTs: **never let untrusted input
determine how it will be validated.**
</details>

<details>
<summary><b>3.</b> Where do you enforce "user 42 may only edit their own posts"?</summary>

**In the posts service**, at the point of the operation, after loading the
resource.

Not in the UI — hiding the button is usability, and anyone can call the API
directly.
Not in the gateway — it has no idea who owns post 88, and giving it that
knowledge means giving it your database.
Not only in a middleware that checks a `posts:write` scope — that says the user
may write *some* post, not *this* one.

The pattern:

```go
post := load(id)
if post.AuthorID != claims.Subject && !isAdmin(claims) {
    return notFound()   // 404, not 403
}
```

And test it: an authorization test suite that asserts user A cannot touch user
B's resources is one of the highest-value test suites you can write, because this
class of bug (IDOR — insecure direct object reference) is consistently in the
OWASP Top 10.
</details>

<details>
<summary><b>4.</b> A JWT contains <code>{"role": "admin"}</code>. Is that safe?</summary>

Safe from *tampering* — yes, if you verify the signature. The claim can't be
modified without invalidating it.

Unsafe in two other ways:

**Staleness.** You demote someone from admin. Their token still says admin until
it expires. With a 24-hour token, that's 24 hours of unintended access. This is
the strongest argument for short expiry.

**Coarseness.** "admin" of what? A role claim can't express "admin of
organisation 7", so you end up either over-granting or stuffing a growing list
of organisation ids into the token — and JWTs go in headers, which have size
limits.

**The usual answer:** put *identity* and *coarse* scopes in the token
(`sub`, `scope: "posts:write"`), and look up *fine-grained* permissions in the
service, where they're current and can be as detailed as you need. Cache that
lookup for seconds if it's hot.
</details>

<details>
<summary><b>5.</b> Design authentication for: a web app, a mobile app, a public API, and internal services.</summary>

Four different clients, four different answers — and recognising that they're
different is the point.

**Web app** — OIDC Authorization Code + PKCE against an identity provider.
Session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) *or* an in-memory access
token with a refresh token in an `HttpOnly` cookie. CSRF protection via
`SameSite` plus a token on state-changing requests.

**Mobile app** — OIDC Authorization Code + PKCE (never the implicit flow), using
the system browser rather than an embedded webview so credentials aren't exposed
to the app. Tokens in the platform keychain/keystore. Refresh with rotation.

**Public API** — OAuth2 Client Credentials for machine clients; API keys only for
low-risk read endpoints, and then scoped, rate-limited and rotatable. Per-key
quotas at the gateway (Capsule 08). Never a single shared key across customers.

**Internal services** — no user identity involved: workload identity. On GCP,
OIDC identity tokens from the metadata server with `audience` set to the target
service, verified by the receiver; or mTLS via a service mesh. **No shared
secrets anywhere** ([B7](../B7-kamis-ledger-iam-service-accounts/README.md)).

Common to all four: authenticate at the edge, authorize in the service, short
credential lifetimes, and audit logs on every auth decision that matters.
</details>

---

## Log it

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
