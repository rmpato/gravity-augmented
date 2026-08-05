# Cápsula B9 · El hechizo de Babidi — Seguridad más allá de auth

> *Babidi nunca le gana a nadie peleando. No le hace falta. Encuentra un
> guerrero que ya es fuerte, que ya está adentro, que ya goza de confianza — y
> hace que ejecute sus instrucciones en vez de las propias. A Vegeta no lo
> hackean desde afuera. Lo dan vuelta.*

| Power level | Tiempo | Prerrequisitos | Mejor después de |
|---|---|---|---|
| Bonus · 150 | 80 min | Cápsulas 10, 23 · [B3 auth](../B3-fortuneteller-baba-auth/README.md) | Cápsula 23 |

---

## Por qué existe esta cápsula

[B3](../B3-fortuneteller-baba-auth/README.md) cubre *autenticación*: probar
quién es alguien. [B7](../B7-kamis-ledger-iam-service-accounts/README.md) cubre
*autorización*: qué puede hacer esa identidad. Las dos asumen que el atacante
está en la puerta de entrada.

Casi ninguno de los incidentes que vas a vivir de verdad se parece a eso. Se
parecen a Babidi: algo que ya está adentro de tu sistema, ya autenticado, ya
confiable, es persuadido de hacer trabajo en nombre de un atacante. Tu servicio
se convierte en el arma.

Esta cápsula es sobre las cuatro formas en que eso pasa en el sistema que
construiste — injection, SSRF, secretos y dependencias — y es completamente
práctica contra **tu propio** stack local.

> Todo acá es defensivo. Estás atacando un servicio que escribiste vos,
> corriendo en tu máquina, para ver funcionar tus propias defensas. No apuntes
> nada de esto a sistemas que no sean tuyos.

---

## El lore

La marca de Majin no hace a Vegeta más fuerte y no rompe sus defensas. Cambia
*las instrucciones de quién sigue*. Cada vulnerabilidad de esta cápsula tiene esa
misma forma: tu código ejecuta algo fielmente, y la única pregunta es quién lo
eligió.

La defensa también es siempre la misma, y es por eso que "sanitizá el input" es
un consejo tan malo: **no podés arreglar esto inspeccionando la instrucción con
más cuidado. Lo arreglás no dejando nunca que el dato se convierta en
instrucción.**

---

## 1 · Injection — datos que se vuelven instrucción

Venís usando pgx con parámetros desde la Cápsula 10, así que ya estás a salvo.
El punto de esta sección es ver *por qué*, para que reconozcas el día que alguien
"solo necesita" armar una query con `fmt.Sprintf`.

### Vela funcionar

Agregá este endpoint roto a propósito. Borralo al final de la cápsula.

**`internal/scouter/vuln.go`**

```go
//go:build vulnerable

// Package-level build tag: this file only compiles with
//   go build -tags vulnerable
// so it can never accidentally ship. That tag is the only reason it's safe to
// have this file in a repo at all.
package scouter

import (
	"fmt"
	"net/http"
)

// ❌ NEVER. Concatenating user input into SQL.
func (s *Server) handleSearchUnsafe(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("name")
	sql := fmt.Sprintf("SELECT name FROM fighters WHERE name = '%s'", q)
	s.log.Warn("UNSAFE QUERY", "sql", sql)
	// ... executes sql ...
}
```

Mirá lo que imprime el log para `?name=goku' OR '1'='1`:

```
SELECT name FROM fighters WHERE name = 'goku' OR '1'='1'
```

La comilla no escapó un string — lo *terminó*, y todo lo que viene después es
ahora SQL que la base va a ejecutar. Nada fue "hackeado". La base hizo
exactamente lo que le dijeron; el atacante simplemente consiguió ser quien le
dice.

Ahora intentá defenderlo escapando. `'` → `''` cubre ese caso. Después alguien
manda una secuencia UTF-8 que tu escaper maneja mal, o la columna es un entero
así que no hay comillas que escapar, o es una cláusula `ORDER BY`. **Todo enfoque
de escapado es una blocklist, y las blocklists pierden.**

### El arreglo posta

```go
// ✅ The query is a CONSTANT. The value travels separately, over a different
// part of the protocol, and can never be parsed as SQL.
const searchQuery = `SELECT name FROM fighters WHERE name = $1`

rows, err := s.pool.Query(ctx, searchQuery, q)
```

El valor no se escapa — nunca está en el string de la query. No hay nada de lo
cual escapar.

### La parte que la gente hace mal

Los parámetros bindean **valores**, no identificadores. Esto no funciona:

```go
// ❌ Still injectable — you cannot parameterise a column name.
s.pool.Query(ctx, "SELECT * FROM readings ORDER BY $1", userSort)
```

Para columnas de orden, tamaños de página, nombres de tabla — cualquier cosa
estructural — el único patrón seguro es una **allowlist**:

```go
// ✅ The user picks an index into YOUR list. Their string never reaches SQL.
var sortColumns = map[string]string{
	"power":   "power DESC",
	"recent":  "recorded_at DESC",
	"fighter": "fighter_id ASC",
}

order, ok := sortColumns[r.URL.Query().Get("sort")]
if !ok {
	order = "power DESC" // default, not an error — be liberal about junk input
}
query := "SELECT * FROM readings ORDER BY " + order // safe: order is OURS
```

La misma forma en todos lados: comandos de shell (`exec.Command("ls", userInput)`,
nunca `sh -c`), templates (`html/template` escapa automáticamente según el
contexto; `text/template` no — usar el equivocado para renderizar HTML es una
fábrica de XSS), y log injection (un salto de línea en el input del usuario
falsifica líneas de log — otra razón más para los logs JSON estructurados de la
Cápsula 25).

---

## 2 · SSRF — cuando tu BFF es el arma

Esta es la que realmente te va a agarrar, porque la Cápsula 23 construyó
exactamente el componente vulnerable: un servicio cuyo trabajo entero es buscar
URLs.

El ataque: aceptás una URL del usuario, y tu servidor la busca. Tu servidor está
*adentro* de la red. Puede llegar al metadata service, a paneles de administración
internos, a bases de datos — todo lo que el usuario no puede.

```
user ──▶ your BFF ──▶ http://metadata.google.internal/computeMetadata/v1/
                       ↑
              the user could never reach this.
              Your service can, and it just did it for them.
```

En GCP ese endpoint devuelve **access tokens de service accounts**. Un solo fetch
sin validar convierte un bug web en credenciales completas de la nube.

### Construí uno, después bloquealo

```bash
mkdir -p internal/safefetch
```

**`internal/safefetch/safefetch.go`**

```go
// Package safefetch builds an http.Client that refuses to talk to private
// networks — the defence against SSRF.
package safefetch

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"syscall"
	"time"
)

// IsPrivate reports whether an IP is one a server-side fetcher must never
// reach: loopback, link-local (169.254.169.254 is the cloud metadata service
// on GCP, AWS and Azure alike), private ranges, and the unspecified address.
func IsPrivate(ip net.IP) bool {
	return ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() ||
		ip.IsUnspecified()
}

// CheckURL validates the scheme before we even resolve. Cheap and catches
// file://, gopher://, and friends.
func CheckURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("scheme %q not allowed", u.Scheme)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("no host")
	}
	return u, nil
}

// Client returns an http.Client that blocks private destinations.
//
// The check lives in Control, which runs AFTER DNS resolution and immediately
// BEFORE connect, on the actual address being dialled. That placement is the
// whole trick: validating the hostname up front loses to DNS rebinding, where
// a name resolves to a public IP when you check it and to 169.254.169.254 when
// you connect. Here there is no gap to exploit.
func Client(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(network, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil {
				return fmt.Errorf("unparseable address %q", address)
			}
			if IsPrivate(ip) {
				return fmt.Errorf("blocked private address %s", ip)
			}
			return nil
		},
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{DialContext: dialer.DialContext},
		// Redirects are re-dialled through the same Control hook, but an
		// open redirect can still walk you somewhere surprising — cap them.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
}

// Fetch is the safe entry point: validate, then dial through the guarded client.
func Fetch(ctx context.Context, rawURL string) (*http.Response, error) {
	u, err := CheckURL(rawURL)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	return Client(5 * time.Second).Do(req)
}
```

**`internal/safefetch/safefetch_test.go`**

```go
package safefetch

import (
	"context"
	"net"
	"strings"
	"testing"
)

func TestIsPrivate(t *testing.T) {
	blocked := []string{
		"127.0.0.1",        // loopback
		"169.254.169.254",  // ← the cloud metadata service. The big one.
		"10.0.0.1",         // private
		"192.168.1.1",      // private
		"172.16.0.1",       // private
		"0.0.0.0",          // unspecified
		"::1",              // IPv6 loopback
		"fd00::1",          // IPv6 unique local
	}
	for _, s := range blocked {
		if !IsPrivate(net.ParseIP(s)) {
			t.Errorf("%s must be blocked", s)
		}
	}

	for _, s := range []string{"8.8.8.8", "1.1.1.1", "93.184.216.34"} {
		if IsPrivate(net.ParseIP(s)) {
			t.Errorf("%s must be allowed", s)
		}
	}
}

func TestSchemeAllowlist(t *testing.T) {
	for _, bad := range []string{
		"file:///etc/passwd",
		"gopher://evil.test:70/_GET",
		"ftp://internal.test/",
	} {
		if _, err := CheckURL(bad); err == nil {
			t.Errorf("CheckURL(%q) must fail", bad)
		}
	}
	if _, err := CheckURL("https://example.test/ok"); err != nil {
		t.Errorf("https must be allowed: %v", err)
	}
}

// The test that matters: a real dial to a private address must be refused at
// connect time, not merely by string-matching the hostname.
func TestFetchBlocksLoopback(t *testing.T) {
	_, err := Fetch(context.Background(), "http://127.0.0.1:9/blocked")
	if err == nil {
		t.Fatal("fetching loopback must fail")
	}
	if !strings.Contains(err.Error(), "blocked private address") {
		t.Fatalf("wrong reason: %v", err)
	}
}
```

```bash
go test ./internal/safefetch/ -v
```

Los tres tienen que pasar. `TestFetchBlocksLoopback` es el importante: prueba que
el bloqueo pasa en el **connect**, que es lo que lo vuelve inmune al DNS
rebinding.

> **En producción, hacé algo mejor que una denylist.** Esto bloquea los rangos
> conocidos como malos, que es la lección *local* correcta. En GCP los controles
> más fuertes son: mandar el egress por un proxy con una **allowlist** explícita
> de destinos, y exigir `Metadata-Flavor: Google` (ya se exige) para que un fetch
> pelado de la URL de metadata falle igual. Defensa en profundidad: asumí que
> este código tiene un bug.

---

## 3 · Secretos

La Cápsula 00 puso `.env` y `*-credentials.json` en el `.gitignore` en el primer
commit. Esa fue la línea de mayor valor de todo este repo. Acá va el resto.

### Revisá tu propio historial

```bash
cd ~/repos/pato/gravity-chamber

# Anything that looks like a key, anywhere in history
git log -p --all | grep -nEi \
  '(api[_-]?key|secret|password|token|BEGIN [A-Z ]*PRIVATE KEY)[^a-z]' \
  | head -20

# Files that should never have been committed
git log --all --name-only --format="" | sort -u | grep -Ei \
  '\.(env|pem|key|p12|pfx)$|credentials.*\.json'
```

Esperá ruido. Corrido contra este proyecto, el primer grep matchea `"go/token"` y
`token.NewFileSet()` — la palabra "token" aparece en un montón de código
inocente. También encuentra correctamente `POSTGRES_PASSWORD: kamehameha`, que es
la contraseña deliberadamente solo-local de la Cápsula 03. **Grep solo encuentra
los patrones que se te ocurrieron, y marca un montón que no querías.** Es una
primera pasada de cinco segundos, no una auditoría; `gitleaks` o `trufflehog`
conocen las formas de las credenciales reales.

Si cualquiera de los dos encuentra algo real: **rotá la credencial.** No
"reescribí el historial" — rotá. Reescribir el historial es limpieza, y el objeto ya está
clonado, cacheado por el forge, y muy probablemente scrapeado. El drill de la
Cápsula 00 decía esto y vale la pena repetirlo porque la gente confiablemente
hace el rewrite y se saltea la rotación.

### La jerarquía

| Enfoque | Veredicto |
|---|---|
| Hardcodeado en el código | Nunca. |
| En un archivo de config commiteado | Nunca. |
| Variable de entorno desde un `.env` gitignoreado | Está bien en local. |
| Secret manager, leído al arrancar | Bien. |
| Secret manager + tokens de vida corta, sin ningún secreto estático | Lo mejor — y es lo que arma [B7](../B7-kamis-ledger-iam-service-accounts/README.md) con Workload Identity |

La dirección del viaje es **de secretos que tenés que proteger hacia identidades
que no se pueden robar**. Un archivo de key de service account es una contraseña
que no expira nunca y que se manda por mail; una service account adjunta es una
identidad por la que la plataforma sale de garante, con tokens que mueren en una
hora.

### No los loguees

```go
// ❌ The whole struct, including its Password field, in your logs forever.
s.log.Info("connecting", "config", cfg)

// ✅ Say only what helps you debug.
s.log.Info("connecting", "host", cfg.Host, "user", cfg.User, "db", cfg.Name)
```

Mejor aún: hacé que el tipo sea incapaz de filtrar, así nadie tiene que
acordarse.

**`internal/scouter/secret.go`**

```go
package scouter

// Secret wraps a sensitive string so it cannot be printed by accident.
// It satisfies fmt.Stringer, encoding.TextMarshaler and json.Marshaler, which
// covers %s, %v, slog, and encoding/json. Reveal() is deliberately ugly to
// type — that's the point; it makes leaking a decision instead of a default.
type Secret string

func (Secret) String() string                { return "[REDACTED]" }
func (Secret) MarshalText() ([]byte, error)  { return []byte("[REDACTED]"), nil }
func (Secret) MarshalJSON() ([]byte, error)  { return []byte(`"[REDACTED]"`), nil }
func (s Secret) Reveal() string              { return string(s) }
```

**`internal/scouter/secret_test.go`**

```go
package scouter

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestSecretNeverLeaks(t *testing.T) {
	s := Secret("kamehameha")

	cases := map[string]string{
		"%v":   fmt.Sprintf("%v", s),
		"%s":   fmt.Sprintf("%s", s),
		"in struct": fmt.Sprintf("%+v", struct {
			User string
			Pass Secret
		}{"scouter", s}),
	}
	b, err := json.Marshal(map[string]Secret{"password": s})
	if err != nil {
		t.Fatal(err)
	}
	cases["json"] = string(b)

	for name, got := range cases {
		if strings.Contains(got, "kamehameha") {
			t.Errorf("%s leaked the secret: %s", name, got)
		}
	}

	if s.Reveal() != "kamehameha" {
		t.Error("Reveal() must still return the real value")
	}
}
```

```bash
go test ./internal/scouter/ -run TestSecretNeverLeaks -v
```

> `%#v` igual muestra el valor subyacente — el formateo `GoString` de Go saltea
> `String()` por diseño. Esto hace que los accidentes sean raros, no imposibles.
> Es una baranda, no una garantía.

---

## 4 · Dependencias — el ataque que no podés code-reviewear

Tu `go.mod` se trae código que nunca leíste, que corre con todos los privilegios
de tu servicio. Esto es la cadena de suministro, y Go trae una herramienta posta
para eso.

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

Lo que hace a `govulncheck` inusualmente bueno: hace **análisis de
alcanzabilidad**. No reporta "dependés de una versión vulnerable" — reporta
"vos *llamás* a una función vulnerable, acá, en esta línea".

Salida real contra este proyecto:

```
  More info: https://pkg.go.dev/vuln/GO-2025-4007
  Standard library
    Found in: crypto/x509@go1.25
    Fixed in: crypto/x509@go1.25.3
    Example traces found:
      #1: internal/scouter/postgres.go:20:33: scouter.NewPostgresStore calls
          pgxpool.ParseConfig, which eventually calls x509.CertPool.AppendCertsFromPEM
      #4: internal/scouter/postgres.go:48:47: scouter.PostgresStore.Close calls
          pgxpool.Pool.Close, which eventually calls x509.ParseCertificate

Your code is affected by 27 vulnerabilities from 1 module and the Go standard library.
This scan also found 7 vulnerabilities in packages you import and 7
vulnerabilities in modules you require, but your code doesn't appear to call
these vulnerabilities.
```

Leé la última oración dos veces. **Se suprimieron 7 hallazgos porque no los
llamás** — ese es el ruido que un scanner convencional te habría mostrado. Y la
traza nombra tu propio archivo y línea, así que "¿esto es real?" lleva segundos
en vez de una tarde.

Fijate también qué está marcado acá: **el toolchain de Go en sí**.
`crypto/x509@go1.25` arreglado en `go1.25.3` significa que el fix es un upgrade
de Go, no un `go get`. Tu compilador también es una dependencia — que es la otra
mitad de la lección de la Cápsula 02 sobre mantener la imagen builder al día.

```bash
# Also worth knowing:
go list -m all | wc -l          # how many modules you actually depend on
go mod graph | grep -c ' '      # every edge — usually a shock
go mod verify                   # checksums match go.sum
go mod tidy -diff               # is go.mod honest? (CI should fail on drift)
```

Dos hábitos que valen más que cualquier scanner:

- **`go.sum` está commiteado y CI corre `go mod verify`.** Esa es tu protección
  contra que un módulo sea alterado después de que lo revisaste.
- **Menos dependencias.** Cada módulo es un equipo en el que decidiste confiar
  para siempre. La librería estándar de Go es inusualmente buena; usala.
  `left-pad` y `event-stream` eran los dos paquetes triviales que nadie
  necesitaba.

---

## Lab — armá todo junto

```bash
go test ./internal/safefetch/ ./internal/scouter/ -run 'Private|Scheme|Blocks|Secret' -v
govulncheck ./...
```

Después cableá `safefetch` en el BFF de la Cápsula 23, para que su fan-out
saliente use el cliente protegido en vez de un `http.Client` pelado, y borrá
`internal/scouter/vuln.go`.

Por último, agregá una sección de seguridad a tu `README.md` — tres líneas,
honestas:

```markdown
## Security notes
- All SQL uses parameters; sort/order columns come from a server-side allowlist.
- Outbound fetches go through internal/safefetch (blocks private ranges at dial).
- Secrets come from the environment; `Secret` type prevents accidental logging.
- Known gap: no rate limit on /readings by IP, only by API key (tracked: #12).
```

Esa última línea es la que importa. **Un documento de seguridad sin una sección
de huecos conocidos no es un documento de seguridad.**

---

## Llevátelo al trabajo

- **"Sanitizá el input" es el instinto equivocado.** Separá dato de instrucción
  — parámetros, allowlists, `exec.Command` sin shell. Después no hay nada que
  sanitizar.
- **Cualquier feature que busque una URL provista por el usuario es un SSRF
  hasta que se demuestre lo contrario.** Webhooks, avatar-por-URL, "importar
  desde link", renderizadores de PDF, previews de links. Hacete la pregunta
  siempre.
- **Rotá primero, reescribí el historial después.** Cada hora gastada en
  `git filter-repo` antes de rotar es una hora en que la credencial sigue viva.
- **`govulncheck` en CI, haciendo fallar el build.** Es basado en
  alcanzabilidad, así que la relación señal/ruido es lo bastante alta como para
  que la gente no lo silencie.
- **Escribí tus huecos conocidos.** Convierte "somos seguros" (falso, siempre)
  en una lista que alguien puede priorizar.

---

## Battle drill

<details>
<summary><b>1.</b> Escapás cada <code>'</code> como <code>''</code>. ¿Estás a salvo de SQL injection?</summary>

No. Cubriste un caso en un contexto.

Los contextos numéricos no tienen comillas que escapar: `WHERE id = 5 OR 1=1` no
necesita ningún apóstrofo. Los identificadores (`ORDER BY`, nombres de tabla) no
se pueden parametrizar *ni* citar de la misma forma. Algunas codificaciones
permiten que una secuencia multi-byte se coma tu carácter de escape. Y ahora
tenés que hacerlo bien en cada call site, para siempre.

Los parámetros no son un escaper mejor — eliminan la concatenación entera, así
que no hay parser que confundir. Para identificadores, allowlist.
</details>

<details>
<summary><b>2.</b> Tu BFF valida que la URL del usuario no resuelva a una IP privada, y después la busca. ¿Cuál es el hueco?</summary>

**DNS rebinding.** Resolvés `evil.test` → `93.184.216.34`, pasa el chequeo, y
después llamás a `http.Get`, que resuelve *de nuevo* — y esta vez el registro con
TTL de 1 segundo del atacante responde `169.254.169.254`. El chequeo y la
conexión usaron resoluciones distintas. Esto es un bug de TOCTOU.

Por eso el bloqueo va en `Dialer.Control`: corre sobre la dirección que
realmente se está discando, después de la resolución, justo antes de conectar.
Sin ventana.
</details>

<details>
<summary><b>3.</b> Se commiteó un secreto y se pusheó hace 20 minutos a un repo privado. Solo tu equipo tiene acceso. ¿Cuán urgente es?</summary>

Rotá ahora. "Privado" es más débil de lo que suena: está expuesto a todos los que
tienen acceso al repo (incluyendo CI, bots, integraciones y cualquier SaaS
conectado al forge), está en cada clon y en cada cache de CI, y la visibilidad
del repo está a un misclick de cambiar.

Veinte minutos alcanzan. Los secretos en repos públicos se scrapean en
*segundos*, y el costo de rotar es chico mientras que el de equivocarse no tiene
techo.
</details>

<details>
<summary><b>4.</b> ¿Por qué <code>govulncheck</code> es más útil que un scanner que marca toda versión vulnerable?</summary>

Alcanzabilidad. Reporta vulnerabilidades en funciones que tu código realmente
llama, vía análisis estático del grafo de llamadas.

La mayoría de los scanners de dependencias te inundan de CVEs en caminos de
código que nunca ejecutás, los equipos aprenden que la salida es casi todo
ruido, y después se pierden el que importaba. Una herramienta sobre la que
actuás le gana a una con mejor cobertura que todos silencian — y ese trade-off es
toda la razón por la que esta vale la pena en CI.
</details>

<details>
<summary><b>5.</b> Tu tipo <code>Secret</code> redacta en <code>%v</code>, <code>%s</code>, slog y JSON. ¿Dónde puede filtrar todavía?</summary>

`%#v` (el formateo en sintaxis de Go saltea `String()`), volcadores basados en
reflection, un debugger o un core dump, `Reveal()` llamado y después logueado, y
cualquier lugar donde el valor se copie a un `string` común antes de loguearse.

Es una baranda que hace imposible el accidente común, no una garantía. Vale la
pena tenerla justamente porque mueve el filtrado de "me olvidé" a "elegí".
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `govulncheck: command not found` | `go install golang.org/x/vuln/cmd/govulncheck@latest`, y después asegurate de que `$(go env GOPATH)/bin` esté en tu `PATH`. |
| `govulncheck` reporta vulns que no podés arreglar | `go get -u <módulo>`, después `go mod tidy`. Si no hay versión con fix, la traza de alcanzabilidad te dice si siquiera llamás al camino afectado. |
| `TestFetchBlocksLoopback` falla con otro error | Algo respondió en el puerto 9. Elegí un puerto donde no haya nada escuchando — el punto es que tiene que fallar *en el dial*, antes de conectar. |
| `vuln.go` no compila | No debería, sin `-tags vulnerable`. Ese es el build tag haciendo su trabajo. |
| `Secret` igual se imprime en `%#v` | Esperado — `GoString` saltea `String()` por diseño. Documentado arriba. |
| `git log -p --all \| grep` no encuentra nada pero no estás seguro | Probá un scanner dedicado (`gitleaks`, `trufflehog`); grep solo encuentra los patrones que se te ocurrieron. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done B9
```

**Siguiente:** [B10 · Kamehameha Instantáneo — Go para quien ya programa](../B10-instant-kamehameha-go-for-java/README.md), o volvé al
[mapa de sagas](../../../docs/saga-map.md).
