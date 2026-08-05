# Capsule B1 · Kame House Rules — REST API Design Essentials

> *Master Roshi's house has rules that look arbitrary until you've lived there:
> deliver the milk, plough the field, swim with the sharks. They're not
> arbitrary — they're conventions that make everyone's expectations line up
> without a conversation. That's what a REST API is.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 65 min | none | Capsule 01 |

---

## Why this capsule exists

Most engineers design APIs by instinct, and the instincts are mostly fine. The
problem is the 20% where convention exists and you didn't know it — and every
one of those becomes a breaking change later, when you have consumers.

This is the reference: the rules, the reasoning, and the specific decisions
people get wrong.

---

## Resources, not actions

A REST API exposes **nouns**. The verb is the HTTP method.

```
  ❌ POST /createFighter          ❌ GET  /getFighterById?id=5
  ❌ POST /updateFighterPower     ❌ POST /deleteFighter

  ✅ POST   /fighters             ✅ GET    /fighters/5
  ✅ PATCH  /fighters/5           ✅ DELETE /fighters/5
```

Rules that follow:

- **Plural nouns.** `/fighters`, not `/fighter`. Consistency beats grammar.
- **Nest for containment**, up to one level: `/fighters/5/readings`. Deeper than
  that (`/a/1/b/2/c/3`) becomes unusable — use query parameters instead.
- **Kebab-case in paths** (`/power-readings`), `snake_case` **or** `camelCase` in
  JSON — pick one and never mix.
- **No file extensions.** Content negotiation is what `Accept` is for.

### When the thing genuinely isn't a resource

Some operations are actions: `search`, `publish`, `cancel`, `retry`. Two
acceptable answers:

1. **Model the state change as a resource**: `POST /orders/5/cancellation`. This
   is more RESTful and gives you a place to hang metadata (who cancelled, why,
   when).
2. **Use a verb sub-path**: `POST /orders/5/cancel`. Pragmatic, widely used, and
   nobody will be confused.

Don't contort a genuine action into a noun just to satisfy a purity argument.
`POST /searches` to run a search is worse for everyone.

---

## Methods, and the two properties that matter

| Method | Purpose | Safe? | Idempotent? |
|---|---|---|---|
| `GET` | read | ✅ | ✅ |
| `HEAD` | read headers only | ✅ | ✅ |
| `POST` | create, or a non-idempotent action | ❌ | ❌ |
| `PUT` | replace the whole resource | ❌ | ✅ |
| `PATCH` | partial update | ❌ | ⚠️ depends on you |
| `DELETE` | remove | ❌ | ✅ |

- **Safe** = no side effects. A `GET` that changes state will be broken by
  crawlers, prefetchers, and every cache in existence.
- **Idempotent** = doing it twice equals doing it once. This is what makes retries
  possible (Capsule 17), which is why it matters far more than it sounds.

**`PUT` vs `PATCH`** — the most common confusion:

```http
PUT /fighters/5          ← the FULL representation. Omitted fields are CLEARED.
{"name": "goku", "race": "saiyan", "power": 9001}

PATCH /fighters/5        ← only what changes. Omitted fields are UNTOUCHED.
{"power": 9001}
```

Sending a partial body with `PUT` and expecting a merge is a bug that silently
nulls out fields. If most of your updates are partial, use `PATCH`.

**`DELETE` is idempotent**: the second call returns `404` (or `204`), and that's
correct. The *state* is the same either way — which is the definition.

---

## Status codes people get wrong

| Code | Use for |
|---|---|
| `200 OK` | success with a body |
| `201 Created` | created — **include a `Location` header** |
| `202 Accepted` | accepted for async processing; not done yet |
| `204 No Content` | success, deliberately empty (a `DELETE`, or a `PUT` returning nothing) |
| `304 Not Modified` | conditional GET, client's cache is valid (Capsule 16) |
| `400 Bad Request` | malformed syntax or invalid input |
| `401 Unauthorized` | **not authenticated** — we don't know who you are |
| `403 Forbidden` | **authenticated but not allowed** — we know, and no |
| `404 Not Found` | doesn't exist (or you may not know that it does) |
| `409 Conflict` | state conflict — duplicate, version mismatch |
| `410 Gone` | existed, permanently removed. More useful than 404 when true |
| `422 Unprocessable` | syntactically valid, semantically wrong |
| `429 Too Many Requests` | rate limited — **always include `Retry-After`** |
| `500 Internal Server Error` | you broke |
| `502 / 503 / 504` | upstream broken / overloaded / upstream timeout |

**The three that matter most:**

- **401 vs 403.** 401 means "authenticate and try again" — the client can *do*
  something. 403 means "don't bother". Getting these backwards makes clients
  retry pointlessly or give up wrongly.
- **404 vs 403 for authorization.** Returning `403` for a resource that exists
  leaks its existence. For anything sensitive, return `404` — "you can't tell the
  difference" is the security property you want.
- **4xx vs 5xx.** 4xx = the client's fault, retrying identically will fail
  forever. 5xx = your fault, retrying might work. This distinction drives every
  retry policy and every alert threshold, so getting it wrong corrupts both.

---

## Errors: use RFC 9457

Don't invent an error format. There's a standard, and it's good.

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

- `type` — a stable URI identifying the *kind* of problem. Clients branch on
  this, never on `detail`.
- `title` — short, human, stable.
- `detail` — specific to this occurrence. Safe to change.
- `errors` — an extension for field-level validation. Return **all** failures at
  once, not the first one.
- `request_id` — so a user can quote it and you can find the trace (Capsule 08).

**Never leak internals**: no stack traces, no SQL, no file paths, no internal
hostnames. Log those; return an id.

---

## Pagination

**Cursor/keyset for anything large, growing or infinite-scrolled** (Capsule 11):

```http
GET /fighters?limit=20&cursor=eyJpZCI6MTIzfQ

{
  "data": [ ... ],
  "next_cursor": "eyJpZCI6MTQzfQ",
  "has_more": true
}
```

Offset pagination is acceptable only for small, stable datasets where users
genuinely need page numbers. It gets linearly slower and produces duplicates
under concurrent writes.

**Always enforce a maximum `limit`.** An endpoint that returns everything when
asked is a denial-of-service vector you built yourself.

**Don't return a `total` count** unless you must — on a large table it's a full
scan, and it's usually the slowest part of the response. `has_more` is enough
for almost every UI.

---

## Filtering, sorting, sparse fields

```
GET /readings?fighter=goku&recorded_after=2026-01-01&sort=-power&fields=name,power
```

- **Filter** with query parameters named after the field.
- **Sort** with `sort=field` / `sort=-field` for descending. Multiple:
  `sort=-power,name`.
- **Sparse fieldsets** (`fields=`) reduce payload — the poor man's GraphQL, and
  often enough.
- **Whitelist everything.** Sortable and filterable fields must be an explicit
  allow-list, or you've handed users the ability to force full table scans on any
  column, and possibly an injection vector.

---

## Versioning

| Approach | Example | Verdict |
|---|---|---|
| **URL path** | `/v1/fighters` | ✅ Obvious, cacheable, easy to route. **Default** |
| Header | `Accept: application/vnd.api.v2+json` | Purer, harder to debug, caching subtleties |
| Query param | `/fighters?version=2` | Muddles caching, easy to omit |

**Version the whole API, not individual endpoints.** Per-endpoint versions
produce a matrix nobody can reason about.

**Better still: don't version.** Most changes can be additive:

- ✅ Adding a field, a new optional parameter, a new endpoint
- ❌ Removing or renaming a field, changing a type, changing a default, making an
  optional parameter required, changing an error code

**Clients must ignore unknown fields.** Say this in your docs. If they don't,
every additive change is a breaking change and you'll be stuck on v1 forever.

When you do version: run both, instrument usage per version, announce a
deprecation window with `Deprecation` and `Sunset` headers, and don't retire
until the telemetry says nobody's there.

---

## Idempotency for POST

`POST` isn't idempotent, but clients retry anyway — flaky networks, double
clicks, impatient users.

```http
POST /orders
Idempotency-Key: 3f2b1a9c-...

→ first call:  201 Created
→ retry:       201 Created (the same body, from cache)
                Idempotency-Replayed: true
```

Store key → response for 24 hours. Handle the concurrent case with a unique
constraint on the key so the second request waits or gets `409` rather than
double-creating. Details in Capsule 19.

---

## The rest of the checklist

- **`Cache-Control` on every response** (Capsule 16). No header means every cache
  guesses differently.
- **`ETag` + `If-None-Match`** on read endpoints — cheap 304s.
- **HTTPS only.** Redirect HTTP, and set `Strict-Transport-Security`.
- **CORS deliberately** — never `Access-Control-Allow-Origin: *` on an
  authenticated API.
- **Bound request bodies** (`http.MaxBytesReader`, Capsule 01).
- **Timestamps in RFC 3339 UTC**: `2026-08-05T14:30:00Z`. Not epoch ints, not
  local time.
- **Money as an integer of minor units + a currency code**, or a decimal string.
  Never a float.
- **IDs as strings in JSON.** JavaScript's `Number` loses precision above 2^53,
  and a large int64 id will silently corrupt in a browser.
- **`Retry-After` on 429 and 503.**
- **An OpenAPI spec**, generated from or validated against the code — not
  hand-maintained, because a hand-maintained spec is wrong within a month.

---

## Lab — audit and fix the Scouter's API

```bash
cd ~/repos/pato/gravity-chamber
```

Go through your handlers against this checklist and write the findings in
`NOTES.md`:

| Check | Yours? |
|---|---|
| Resource-shaped paths, plural nouns | |
| Correct method for each operation | |
| `201` + `Location` on create | |
| `400` vs `422` used meaningfully | |
| `problem+json` errors with a `type` | |
| All validation errors returned at once | |
| Pagination with an enforced max `limit` | |
| Filter/sort fields whitelisted | |
| `Cache-Control` on every response | |
| `ETag` on read endpoints | |
| Body size bounded | |
| Timestamps RFC 3339 UTC | |
| IDs as strings | |
| `Idempotency-Key` on POST | |
| Request id returned on errors | |

Then fix at least three. Suggested:

**1. Proper error responses:**

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

**2. Return every validation error, not just the first:**

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

A user filling a form should learn about all four problems in one round trip.

**3. `201` with a `Location` header:**

```go
	w.Header().Set("Location", "/fighters/"+url.PathEscape(rd.Fighter))
	writeJSON(w, http.StatusCreated, rd)
```

---

## Battle drill

<details>
<summary><b>1.</b> A client asks for a "delete all readings older than 30 days" endpoint. Design it.</summary>

The instinct is `DELETE /readings?before=2026-07-01`, and it's dangerous: a
bulk delete driven by a query parameter is one typo away from deleting
everything, it's slow enough to time out, and if the parameter is dropped by a
proxy you've deleted the whole table.

Better: **model it as a job resource.**

```http
POST /cleanup-jobs
{"older_than": "2026-07-01", "dry_run": true}

→ 202 Accepted
  Location: /cleanup-jobs/8f2a
  {"id": "8f2a", "status": "pending", "estimated_rows": 41203}
```

Then `GET /cleanup-jobs/8f2a` for progress. Benefits: `dry_run` first,
the estimate before committing, an audit trail of who ran what, a bounded
synchronous request, and batched deletion that doesn't lock the table
(Capsule 24).

If it must be synchronous, require an explicit confirmation token and cap the
number of rows a single call may delete.
</details>

<details>
<summary><b>2.</b> Why return 404 instead of 403 for a resource the user may not access?</summary>

`403` confirms the resource **exists**. That's an information leak, and it's
enumerable: an attacker walks `/documents/1..100000` and learns exactly which
ids are real, how many customers you have, and roughly when they signed up.

`404` makes "doesn't exist" and "not yours" indistinguishable.

Use `403` when the user already knows the resource exists — they're in the
organisation, they can see it in a list, but lack permission for this specific
action. Then `403` is more helpful and leaks nothing.

Rule of thumb: **403 when the existence is already known to this user; 404
otherwise.** GitHub does exactly this — private repos you can't see return 404.
</details>

<details>
<summary><b>3.</b> Your API returns int64 ids. A JavaScript client reports corrupted ids. Why?</summary>

JSON numbers are IEEE 754 doubles in JavaScript, exact only up to 2^53 − 1
(9,007,199,254,740,991). A snowflake id or a large int64 above that gets
**silently rounded** — `JSON.parse` produces a different number with no error.

The classic symptom: everything works until ids get large enough, then a small
fraction of requests hit the wrong record. It's intermittent and very hard to
trace.

**Fix: serialise ids as strings.** `{"id": "9007199254740993"}`. Twitter hit
this famously and now returns both `id` and `id_str`.

The general rule: **any identifier is a string in JSON**, even when it's numeric
underneath. You never do arithmetic on an id, so there's no cost — and it makes
changing to a UUID later a non-event.
</details>

<details>
<summary><b>4.</b> When would you break the REST conventions deliberately?</summary>

- **Bulk operations.** `POST /fighters/batch` with an array beats 500 individual
  requests, especially over mobile. RESTfulness loses to round trips.
- **Search.** `POST /searches` with a complex query body, because the query
  exceeds URL length limits or contains characters that don't survive encoding.
  Cacheability is lost — accept it knowingly.
- **RPC-shaped actions** that genuinely aren't resources: `POST /calls/5/transfer`.
- **A BFF endpoint** shaped for a screen rather than a domain (Capsule 23). That
  is the *correct* design and it isn't REST.
- **Long-polling / SSE / WebSockets** for realtime, where request/response
  doesn't fit at all.

The principle: **conventions exist to make things predictable. Break them when
the convention makes the API worse, and document why.** Consistency within your
API matters more than conformance to someone else's idea of purity.
</details>

<details>
<summary><b>5.</b> How do you deprecate a field without breaking clients?</summary>

1. **Announce** — changelog, email, developer portal. Give a date, not "soon".
2. **Add the replacement**, keep the old field populated. Both work.
3. **Mark it deprecated** in the OpenAPI spec, and add response headers:
   `Deprecation: true` and `Sunset: Wed, 01 Apr 2026 00:00:00 GMT` (both are real
   standards — RFC 9745 and RFC 8594).
4. **Instrument it.** Log which clients still read the old field. Without this
   you're guessing, and you'll never feel safe removing it.
5. **Contact the remaining users directly.** There are usually fewer than you
   fear, and they're usually easy to help.
6. **Remove**, after the sunset date, in a new API version if the change is
   breaking.

The step people skip is **5**, and it's the one that turns an indefinite
deprecation into a finished one.
</details>

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "refactor(api): problem+json errors, full validation, 201 Location

Capsule B1. API audited against REST conventions; errors now follow RFC 9457
with a stable type URI and a request id, all validation failures return at
once, and creates return 201 with Location."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done B1
```
