# Capsule B9 · Babidi's Spell — Security Beyond Auth

> *Babidi never beats anyone in a fight. He doesn't have to. He finds a warrior
> who is already strong, already inside, already trusted — and makes them
> execute his instructions instead of their own. Vegeta doesn't get hacked from
> outside. He gets turned.*

| Power level | Time | Prereqs | Best taken after |
|---|---|---|---|
| Bonus · 150 | 80 min | Capsules 10, 23 · [B3 auth](../B3-fortuneteller-baba-auth/README.md) | Capsule 23 |

---

## Why this capsule exists

[B3](../B3-fortuneteller-baba-auth/README.md) covers *authentication*: proving
who someone is. [B7](../B7-kamis-ledger-iam-service-accounts/README.md) covers
*authorisation*: what that identity may do. Both assume the attacker is at the
front door.

Almost none of the incidents you'll actually live through look like that. They
look like Babidi: something already inside your system, already authenticated,
already trusted, is persuaded to do work on an attacker's behalf. Your service
becomes the weapon.

This capsule is about the four ways that happens in the system you have built —
injection, SSRF, secrets, and dependencies — and it is entirely hands-on
against **your own** local stack.

> Everything here is defensive. You are attacking a service you wrote, running
> on your laptop, to see your own defences work. Do not point any of it at
> systems you don't own.

---

## The lore

The Majin mark doesn't make Vegeta stronger and it doesn't break his defences.
It changes *whose instructions he follows*. Every vulnerability in this capsule
is that same shape: your code faithfully executes something, and the only
question is who chose it.

The defence is always the same too, and it's why "sanitise the input" is such
bad advice: **you cannot fix this by inspecting the instruction more carefully.
You fix it by never letting data become instruction in the first place.**

---

## 1 · Injection — data that becomes instruction

You have used pgx with parameters since Capsule 10, so you are already safe.
The point of this section is to see *why*, so you recognise the day someone
"just needs" to build a query with `fmt.Sprintf`.

### See it work

Add this deliberately-broken endpoint. Delete it at the end of the capsule.

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

Look at what the log prints for `?name=goku' OR '1'='1`:

```
SELECT name FROM fighters WHERE name = 'goku' OR '1'='1'
```

The quote didn't escape a string — it *ended* one, and everything after it is
now SQL the database will execute. Nothing was "hacked". The database did
exactly what it was told; the attacker just got to do the telling.

Now try to defend it by escaping. `'` → `''` handles that case. Then someone
sends a UTF-8 sequence your escaper mishandles, or the column is an integer so
there are no quotes to escape, or it's an `ORDER BY` clause. **Every escaping
approach is a blocklist, and blocklists lose.**

### The actual fix

```go
// ✅ The query is a CONSTANT. The value travels separately, over a different
// part of the protocol, and can never be parsed as SQL.
const searchQuery = `SELECT name FROM fighters WHERE name = $1`

rows, err := s.pool.Query(ctx, searchQuery, q)
```

The value is not escaped — it is never in the query string at all. There is
nothing to escape *out of*.

### The part people get wrong

Parameters bind **values**, not identifiers. This does not work:

```go
// ❌ Still injectable — you cannot parameterise a column name.
s.pool.Query(ctx, "SELECT * FROM readings ORDER BY $1", userSort)
```

For sort columns, page sizes, table names — anything structural — the only safe
pattern is an **allowlist**:

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

Same shape everywhere else: shell commands (`exec.Command("ls", userInput)`,
never `sh -c`), templates (`html/template` auto-escapes by context;
`text/template` does not — using the wrong one to render HTML is an XSS
factory), and log injection (a newline in user input forges log lines — which
is one more reason for structured JSON logs from Capsule 25).

---

## 2 · SSRF — when your BFF is the weapon

This is the one that will actually get you, because Capsule 23 built exactly the
component that's vulnerable: a service whose whole job is to fetch URLs.

The attack: you accept a URL from a user, and your server fetches it. Your
server is *inside* the network. It can reach the metadata service, internal
admin panels, databases — everything the user can't.

```
user ──▶ your BFF ──▶ http://metadata.google.internal/computeMetadata/v1/
                       ↑
              the user could never reach this.
              Your service can, and it just did it for them.
```

On GCP that endpoint returns **service account access tokens**. A single
unvalidated fetch converts a web bug into full cloud credentials.

### Build one, then block it

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

All three must pass. `TestFetchBlocksLoopback` is the important one: it proves
the block happens at **connect**, which is what makes it immune to DNS
rebinding.

> **In production, do better than a denylist.** This blocks the known-bad
> ranges, which is the right *local* lesson. On GCP the stronger controls are:
> run egress through a proxy with an explicit **allowlist** of destinations, and
> require `Metadata-Flavor: Google` (already enforced) so a plain fetch of the
> metadata URL fails anyway. Defence in depth: assume this code has a bug.

---

## 3 · Secrets

Capsule 00 put `.env` and `*-credentials.json` in `.gitignore` on the first
commit. That was the single highest-value line in this whole repo. Here's the
rest.

### Check your own history

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

Expect noise. Run against this project, the first grep matches `"go/token"` and
`token.NewFileSet()` — the word "token" appears in a lot of innocent code. It
also correctly finds `POSTGRES_PASSWORD: kamehameha`, which is the deliberate
local-only password from Capsule 03. **Grep only finds the patterns you thought
of, and flags a lot you didn't mean.** It's a five-second first pass, not an
audit; `gitleaks` or `trufflehog` know the shapes of real credentials.

If either finds something real: **rotate the credential.** Not "rewrite history"
— rotate. History rewriting is cleanup, and the object is already cloned, cached
by the forge, and very likely scraped. Capsule 00's drill said this and it is
worth repeating because people reliably do the rewrite and skip the rotation.

### The hierarchy

| Approach | Verdict |
|---|---|
| Hardcoded in source | Never. |
| In a committed config file | Never. |
| Environment variable from a `.gitignore`d `.env` | Fine locally. |
| Secret manager, fetched at boot | Good. |
| Secret manager + short-lived tokens, no static secret at all | Best — and it's what [B7](../B7-kamis-ledger-iam-service-accounts/README.md) sets up with Workload Identity |

The direction of travel is **from secrets you must protect to identities you
can't steal**. A service account key file is a password that never expires and
gets emailed around; an attached service account is an identity the platform
vouches for, with tokens that die in an hour.

### Don't log them

```go
// ❌ The whole struct, including its Password field, in your logs forever.
s.log.Info("connecting", "config", cfg)

// ✅ Say only what helps you debug.
s.log.Info("connecting", "host", cfg.Host, "user", cfg.User, "db", cfg.Name)
```

Better: make the type incapable of leaking, so nobody has to remember.

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

> `%#v` still shows the underlying value — Go's `GoString` formatting bypasses
> `String()` by design. This makes accidents rare, not impossible. It is a
> guardrail, not a guarantee.

---

## 4 · Dependencies — the attack you can't code-review

Your `go.mod` pulls in code you have never read, which runs with your
service's full privileges. This is the supply chain, and Go ships a real tool
for it.

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

What makes `govulncheck` unusually good: it does **reachability analysis**. It
doesn't report "you depend on a vulnerable version" — it reports "you *call* a
vulnerable function, here, on this line".

Real output against this project:

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

Read the last sentence twice. **7 findings were suppressed because you don't
call them** — that's the noise a conventional scanner would have shown you.
And the trace names your own file and line, so "is this real?" takes seconds
instead of an afternoon.

Note also what's flagged here: the **Go toolchain itself**. `crypto/x509@go1.25`
fixed in `go1.25.3` means the fix is a Go upgrade, not a `go get`. Your compiler
is a dependency too — which is the other half of Capsule 02's lesson about
keeping the builder image current.

```bash
# Also worth knowing:
go list -m all | wc -l          # how many modules you actually depend on
go mod graph | grep -c ' '      # every edge — usually a shock
go mod verify                   # checksums match go.sum
go mod tidy -diff               # is go.mod honest? (CI should fail on drift)
```

Two habits worth more than any scanner:

- **`go.sum` is committed and CI runs `go mod verify`.** That's your protection
  against a module being altered after you vetted it.
- **Fewer dependencies.** Every module is a team you've decided to trust
  forever. Go's standard library is unusually good; use it. `left-pad` and
  `event-stream` were both trivial packages nobody needed.

---

## Lab — put it together

```bash
go test ./internal/safefetch/ ./internal/scouter/ -run 'Private|Scheme|Blocks|Secret' -v
govulncheck ./...
```

Then wire `safefetch` into the BFF from Capsule 23, so its outbound fan-out uses
the guarded client rather than a bare `http.Client`, and delete
`internal/scouter/vuln.go`.

Finally, add a security section to your `README.md` — three lines, honest:

```markdown
## Security notes
- All SQL uses parameters; sort/order columns come from a server-side allowlist.
- Outbound fetches go through internal/safefetch (blocks private ranges at dial).
- Secrets come from the environment; `Secret` type prevents accidental logging.
- Known gap: no rate limit on /readings by IP, only by API key (tracked: #12).
```

That last line is the one that matters. **A security doc with no known-gaps
section is not a security doc.**

---

## Bring it to work

- **"Sanitise the input" is the wrong instinct.** Separate data from
  instruction — parameters, allowlists, `exec.Command` without a shell. Then
  there is nothing to sanitise.
- **Any feature that fetches a user-supplied URL is an SSRF until proven
  otherwise.** Webhooks, avatar-by-URL, "import from link", PDF renderers,
  link previews. Ask the question every time.
- **Rotate first, rewrite history second.** Every hour spent on `git filter-repo`
  before rotating is an hour the credential is still live.
- **`govulncheck` in CI, failing the build.** It's reachability-based, so the
  signal-to-noise is high enough that people won't mute it.
- **Write down your known gaps.** It converts "we're secure" (false, always)
  into a list someone can prioritise.

---

## Battle drill

<details>
<summary><b>1.</b> You escape every <code>'</code> as <code>''</code>. Are you safe from SQL injection?</summary>

No. You've handled one case in one context.

Numeric contexts have no quotes to escape: `WHERE id = 5 OR 1=1` needs no
apostrophe. Identifiers (`ORDER BY`, table names) can't be parameterised *or*
quoted the same way. Some encodings let a multi-byte sequence swallow your
escape character. And you now have to get it right at every call site forever.

Parameters aren't a better escaper — they remove the concatenation entirely, so
there is no parser to confuse. For identifiers, allowlist.
</details>

<details>
<summary><b>2.</b> Your BFF validates that the user's URL doesn't resolve to a private IP, then fetches it. What's the hole?</summary>

**DNS rebinding.** You resolve `evil.test` → `93.184.216.34`, pass the check,
then call `http.Get`, which resolves *again* — and this time the attacker's
1-second-TTL record answers `169.254.169.254`. The check and the connection used
different resolutions. This is a TOCTOU bug.

That's why the block belongs in `Dialer.Control`: it runs on the address
actually being dialled, after resolution, immediately before connect. No gap.
</details>

<details>
<summary><b>3.</b> A secret was committed and pushed 20 minutes ago to a private repo. Only your team has access. How urgent?</summary>

Rotate now. "Private" is weaker than it sounds: it's exposed to everyone with
repo access (including CI, bots, integrations and any forge-connected SaaS),
it's in every clone and every CI cache, and repo visibility is one misclick from
changing.

Twenty minutes is enough. Public-repo secrets are scraped within *seconds*, and
the cost of rotating is small while the cost of being wrong is unbounded.
</details>

<details>
<summary><b>4.</b> Why is <code>govulncheck</code> more useful than a scanner that flags every vulnerable version?</summary>

Reachability. It reports vulnerabilities in functions your code actually calls,
via static analysis of the call graph.

Most dependency scanners flood you with CVEs in code paths you never execute,
teams learn the output is mostly noise, and then they miss the real one. A tool
you act on beats a tool with better coverage that everyone mutes — and that
tradeoff is the whole reason this one is worth putting in CI.
</details>

<details>
<summary><b>5.</b> Your <code>Secret</code> type redacts in <code>%v</code>, <code>%s</code>, slog and JSON. Where can it still leak?</summary>

`%#v` (Go-syntax formatting bypasses `String()`), reflection-based dumpers,
a debugger or core dump, `Reveal()` called and then logged, and anywhere the
value is copied into a plain `string` before being logged.

It's a guardrail that makes the common accident impossible, not a guarantee.
Worth having precisely because it moves leaking from "forgot" to "chose".
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `govulncheck: command not found` | `go install golang.org/x/vuln/cmd/govulncheck@latest`, then ensure `$(go env GOPATH)/bin` is on your `PATH`. |
| `govulncheck` reports vulns you can't fix | `go get -u <module>`, then `go mod tidy`. If there's no fixed version, the reachability trace tells you whether you call the affected path at all. |
| `TestFetchBlocksLoopback` fails with a different error | Something answered on port 9. Pick a port nothing is bound to — the point is that it must fail *at dial*, before connecting. |
| `vuln.go` won't compile | It shouldn't, without `-tags vulnerable`. That's the build tag doing its job. |
| `Secret` still prints in `%#v` | Expected — `GoString` bypasses `String()` by design. Documented above. |
| `git log -p --all \| grep` finds nothing but you're unsure | Try a dedicated scanner (`gitleaks`, `trufflehog`); grep only finds patterns you thought of. |

---

## Log it

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done B9
```

**Next:** [B10 · Instant Kamehameha — Go for People Who Already Program](../B10-instant-kamehameha-go-for-java/README.md), or back to
[the saga map](../../../docs/saga-map.md).
