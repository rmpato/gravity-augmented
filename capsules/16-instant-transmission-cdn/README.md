# Capsule 16 · Instant Transmission — CDN & The Edge

> *Goku puts two fingers to his forehead and arrives instantly — but only
> somewhere he can already sense. He cannot teleport to a place he has never
> been. A CDN is exactly that: zero distance to a location that is already warm,
> and a full trip for everywhere else.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 7 | 75 min | Capsules 14–15 | Local + concept |

---

## Why this capsule exists

Every optimisation so far has made your *server* faster. None of them touched
the largest single component of what a user experiences: **the speed of light.**

A round trip from Sydney to `us-central1` is ~160 ms. TLS needs a handshake. A
page needs several round trips. You can shave 40 ms off your handler and the
user in Sydney will not notice, because 500 ms of their 600 ms was network.

The edge is where that latency actually lives — and `Cache-Control` is the most
under-used performance tool in web engineering.

---

## The concept

### What a CDN is

A globally distributed set of caching reverse proxies (points of presence, POPs)
between your users and your origin.

```
   Sydney user ──2ms──► Sydney POP ──HIT?──► response.   Done.
                             │
                            MISS
                             │
                             └──160ms──► us-central1 origin
```

Three wins, in order of size:

1. **Cache hits never reach your origin.** Latency ~5 ms instead of ~160 ms, and
   your origin sees a fraction of the traffic.
2. **TLS terminates near the user.** The handshake's round trips are 2 ms each
   rather than 160 ms — this helps *even for uncacheable content*, which
   surprises people.
3. **The long haul runs on the provider's private backbone**, which is faster
   and more reliable than the public internet.

There's a fourth: **DDoS absorption.** A CDN's capacity is enormous, and attack
traffic is soaked up at the edge.

### `Cache-Control`, properly

The header that does the work:

```http
Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=60
```

| Directive | Means |
|---|---|
| `public` | any cache may store it (CDN included) |
| `private` | **browser only** — CDNs must not store it. Use for personalised responses |
| `no-store` | never store anywhere. Auth tokens, sensitive data |
| `no-cache` | store, but **always revalidate** before serving (badly named) |
| `max-age=N` | freshness in seconds, for all caches |
| `s-maxage=N` | freshness for *shared* caches only; overrides `max-age` at the CDN |
| `stale-while-revalidate=N` | serve stale up to N seconds past expiry while refreshing in the background |
| `stale-if-error=N` | serve stale for N seconds if the origin is failing |
| `immutable` | this URL's content will never change; don't even revalidate |

**`stale-while-revalidate` is the highest-value directive most teams don't
use.** It makes cache expiry invisible to users: nobody ever waits for a
refresh, and it's exactly the pattern you hand-built in Capsule 15, available
for free as one header.

**`stale-if-error` is a free availability win.** Your origin goes down; the CDN
keeps serving the last good response. Users don't notice an outage.

### Validators: ETag and Last-Modified

When something expires, the cache doesn't have to re-download it:

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

A `304` costs headers only. For a 500 KB JSON payload that's a 500 KB saving on
every revalidation.

`ETag` is exact (usually a hash of the body). `Last-Modified` has one-second
granularity and is weaker. Use ETag.

### The immutable-asset pattern

The single most effective front-end caching technique, and it's just a naming
convention:

```
  /static/app.js              →  Cache-Control: no-cache      (must revalidate)
  /static/app.a1b2c3d4.js     →  Cache-Control: max-age=31536000, immutable
```

Put a content hash in the filename. The URL *is* the version, so the content can
never change — cache it for a year with no revalidation at all. Deploy a new
build and it's a new filename, so it's a new cache entry. **Invalidation becomes
unnecessary**, which is why every modern bundler does this by default.

The HTML that references those files stays short-lived. One small revalidation
pulls in everything else for free.

### Cache keys, and the vary trap

By default the key is the full URL. Anything that changes the response but not
the URL will be served to the wrong user unless you say so:

```http
Vary: Accept-Encoding, Accept-Language
```

**`Vary: Cookie` effectively disables caching** — every distinct cookie value
becomes a separate cache entry, so hit ratio goes to zero. If a response depends
on a cookie, mark it `private` and stop pretending it's cacheable.

**The catastrophic version of this bug:** caching a personalised page under a
shared key. User A's dashboard gets served to user B. It is a data breach, not a
performance bug, and it has happened to large companies more than once.

Rules: strip query parameters that don't affect the response (`utm_source`,
`fbclid`) from the cache key or your hit ratio collapses; never cache anything
behind auth unless the key includes the identity *and* you're certain.

### Purging vs versioning

Purging (invalidating CDN content) is slow (seconds to minutes), rate-limited,
sometimes expensive, and eventually consistent across hundreds of POPs.

**Prefer versioned URLs.** Never purge what you can rename. Reserve purging for
emergencies — a leaked document, wrong pricing, a legal takedown.

### The latency budget

Write it down for a real user:

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

**A cache hit is ~9× faster than your best possible origin response.** No
backend optimisation can compete with not making the trip.

---

## Lab

You can build a real CDN edge locally: nginx as a caching proxy in front of the
Scouter, which is genuinely how CDNs work.

### Step 1 — cache headers on your API

In `internal/scouter/server.go`:

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

And for anything personalised — a rule, not a suggestion:

```go
func (s *Server) handleGetFighter(w http.ResponseWriter, r *http.Request) {
	// Per-fighter data is public here, but the moment a response depends on
	// WHO is asking, it must be private/no-store or a CDN will serve one
	// user's data to another. That is a breach, not a slow page.
	w.Header().Set("Cache-Control", "public, max-age=5, s-maxage=15")
	// …
}
```

### Step 2 — see 304s

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

### Step 3 — a local CDN edge

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

Run it:

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

Measure the difference:

```bash
echo "--- origin ---"
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" localhost:8080/leaderboard; done
echo "--- edge ---"
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" localhost:8090/leaderboard; done
```

On a laptop both are fast, so **simulate the real distance** by making the
origin slow. Add a temporary delay to the leaderboard handler (import `time` if
the file doesn't already), rebuild and restart the origin:

```go
// top of the leaderboard handler — TEMPORARY, delete after this step
time.Sleep(150 * time.Millisecond) // the origin is "on another continent"
```

Then empty the edge's cache, or the old entry gets served as `STALE` while it
refreshes in the background and you never see a slow MISS:

```bash
docker stop edge    # it was started with --rm, so its cache goes with it
```

Start it again with the same `docker run` as above, and re-run both loops. The
origin now takes ~150 ms every time. Through the edge, the first request (the
MISS) pays the 150 ms and the HITs that follow come back in a millisecond or two. **The MISS pays it. The HIT doesn't.** That gap is the
entire product. Remove the sleep before moving on.

> Why not delay the network instead, with `tc qdisc … netem` inside the edge
> container? Because that delays *every* packet leaving the edge, including the
> HIT going back to your `curl` — a HIT would cost as much as a MISS, which is
> the opposite of what you are trying to see. To fake distance with `netem` you
> would have to filter by destination. The sleep puts the delay exactly where
> the real distance is: between the edge and the origin.

### Step 4 — origin shielding under failure

```bash
# hammer the edge while the origin is DOWN
curl -s localhost:8090/leaderboard > /dev/null    # populate

# kill the origin (Ctrl-C the `make run` process)

curl -si localhost:8090/leaderboard | head -1
```

Still `200`, served stale, because of `proxy_cache_use_stale` + `stale-if-error`.
**Your origin is down and your users cannot tell.** This is one of the highest
availability-per-effort configurations in existence, and it is three lines.

### Step 5 — prove request coalescing

Restart the origin with a slow handler (300 ms), then:

```bash
docker exec edge sh -c 'rm -rf /var/cache/nginx/*'   # cold edge

time (for i in $(seq 1 50); do curl -s -o /dev/null localhost:8090/leaderboard & done; wait)
```

Check the origin's logs: with `proxy_cache_lock on` you should see **one**
request, not fifty. Turn the lock off, repeat, and count again.

### Step 6 — the cache-key mistake, made visible

```nginx
      # BROKEN — do not ship. Included so you can see the failure.
      proxy_cache_key "$scheme$request_method$host$uri";   # NOTE: $uri, not $request_uri
```

`$uri` excludes the query string. Reload nginx and:

```bash
curl -s "localhost:8090/leaderboard?limit=3"  | jq 'length'   # 3
curl -s "localhost:8090/leaderboard?limit=50" | jq 'length'   # 3  ← WRONG
```

Two different requests, one cache entry. Change one character and you serve the
wrong response to everyone.

Now imagine `$uri` where the difference was `?user_id=` instead of `?limit=`.
**That's how CDN misconfiguration becomes a data breach.** Put it back to
`$request_uri`.

```bash
docker rm -f edge
```

---

## In GCP

> **Concept only.** Cloud CDN requires a global external Application Load
> Balancer (~$18/month to exist). Read the setup; don't build it.

**Cloud CDN** is a checkbox on a backend service:

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

`cache_mode` options, and the one to pick:

- **`USE_ORIGIN_HEADERS`** — obey your app's `Cache-Control`. Correct by default:
  caching policy lives in the code that knows what the data means.
- `CACHE_ALL_STATIC` — cache static content types automatically.
- `FORCE_CACHE_ALL` — cache everything regardless of headers. **Dangerous** — it
  will happily cache authenticated responses.

The rest of the edge stack:

- **Cloud Storage + Cloud CDN** for static assets, with hashed filenames and
  `Cache-Control: public, max-age=31536000, immutable`.
- **Cloud Armor** — WAF, DDoS protection, geo and IP rules, rate limiting at the
  edge (Capsule 17). Attaches to the same backend service.
- **Media CDN** — a separate, higher-scale product for video streaming.
- **Invalidation**: `gcloud compute url-maps invalidate-cdn-cache <map> --path
  "/api/*"`. Takes minutes, is rate-limited, and is a last resort. Version
  instead.

---

## Bring it to work

- **Set `Cache-Control` deliberately on every response.** No header means every
  cache guesses, and their guesses differ.
- **`stale-while-revalidate` + `stale-if-error` on all public GETs.** Two
  directives, large latency and availability wins.
- **Hash static asset filenames and cache them for a year, `immutable`.**
- **ETags on JSON endpoints.** 304s are nearly free and clients get them
  automatically.
- **Audit the cache key.** Whitelist query params; never include cookies; never
  cache authenticated responses under a shared key.
- **`private` or `no-store` for anything personalised.** When unsure, don't
  cache — the failure mode is a breach.
- **Version, don't purge.**
- **Measure origin offload** (`hit ratio` at the edge). It's the number that
  tells you how much traffic you're not paying for.

---

## Battle drill

<details>
<summary><b>1.</b> Users report seeing other users' data. The CDN was deployed yesterday. What happened?</summary>

A personalised response was cached under a shared key. Either it lacked
`Cache-Control: private`, or the cache key omitted the distinguishing element
(the session cookie, the auth header, the user id in the path), or the CDN was
set to `FORCE_CACHE_ALL`.

**Immediate:** purge everything, set `cache_mode` to `USE_ORIGIN_HEADERS`, add
`Cache-Control: private, no-store` to every authenticated response, and confirm
by curling as two different users through the CDN.

**Then:** this is a security incident with disclosure implications, not a
performance regression. It needs an incident review.

**Prevent:** default to `no-store` and opt *in* to caching per endpoint; add an
integration test that fetches an authenticated endpoint through the CDN as two
users and asserts the responses differ.
</details>

<details>
<summary><b>2.</b> Your CDN hit ratio is 12%. Where do you look?</summary>

- **Cache key fragmentation** — `utm_source`, `fbclid` and session ids in the
  query string make every URL unique. Whitelist the params that matter.
- **`Vary: Cookie`** — one entry per cookie value, so effectively no caching.
- **TTLs too short** relative to request frequency. A 10 s TTL on a URL requested
  every 60 s is never a hit.
- **`Cache-Control: private` / `no-store`** applied more broadly than intended.
- **Genuinely personalised content** — then 12% may be correct, and the win has
  to come from caching *fragments* or the shell instead of the page.
- **Long-tail URLs** — millions of rarely-requested pages will never have a high
  hit ratio anywhere.

Diagnose by grouping CDN logs by cache status *and* by URL pattern; the answer is
almost always concentrated in one or two patterns.
</details>

<details>
<summary><b>3.</b> Why does a CDN help even for content that can't be cached?</summary>

**TLS and TCP terminate at the edge.** Connection setup is 2–3 round trips; at
80 ms per RTT that's ~240 ms, at 2 ms it's ~6 ms. That saving applies to every
request regardless of cacheability.

Then the origin fetch runs over the provider's **private backbone** with
pre-warmed, pooled connections — more direct routing, less congestion, fewer
retransmits than the public internet.

Plus: HTTP/3 and modern TLS at the edge even if your origin is old; DDoS
absorption; and WAF filtering before traffic reaches you.

Google calls this "Cloud CDN with dynamic content" and AWS calls it "CloudFront
for dynamic acceleration". It's a real and frequently overlooked win.
</details>

<details>
<summary><b>4.</b> Explain <code>stale-while-revalidate</code> to a PM.</summary>

Without it, the moment cached content expires, the next unlucky user waits for
the full origin round trip — so a handful of users randomly get a slow page, and
they're the ones who complain.

With it, that user gets the slightly-old version *instantly*, and the refresh
happens in the background. Nobody ever waits.

The cost is that some users see content up to N seconds staler than they
otherwise would. For a leaderboard, a product listing or an article that's
irrelevant. For a stock price it isn't.

So the question back to the PM is exactly the right one: **"how stale is
acceptable here?"** — and that's a product decision with a number, not an
engineering detail.
</details>

<details>
<summary><b>5.</b> Design caching for a news site: articles rarely change, homepage changes often, some content is paywalled.</summary>

Segment by content type, because they have genuinely different requirements:

- **Static assets** (JS/CSS/images) — hashed filenames,
  `max-age=31536000, immutable`. Cached forever at every layer.
- **Article bodies** — `public, s-maxage=3600, stale-while-revalidate=86400`.
  Rarely change; when they do, the URL can carry a version or you purge that one
  path.
- **Homepage** — `public, s-maxage=60, stale-while-revalidate=300`. Changes
  often, must never be slow.
- **Paywalled content** — the trap. Cache the **article shell** publicly and
  fetch the body separately with the user's credentials; or use ESI/edge logic to
  assemble. Never cache the full paywalled body publicly, and never key on a
  cookie you didn't mean to.
- **Personalised sections** ("for you") — load client-side after the shell
  renders, so the shell stays cacheable.
- **Images** — a resizing CDN with the dimensions in the URL, so every variant is
  its own immutable object.

The general principle: **split the page into a cacheable shell and personalised
fragments**, rather than making the whole page uncacheable because one part is.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `X-Cache-Status` always MISS | The origin sends `no-store`/`no-cache`, or `Set-Cookie` (nginx won't cache those by default). Check the response headers. |
| `host.docker.internal` unreachable | Add `--add-host=host.docker.internal:host-gateway` on Linux. |
| 304 never returned | Client isn't sending `If-None-Match`, or your ETag changes every request (don't include a timestamp in it). |
| Query string ignored | `$uri` instead of `$request_uri` in the cache key. |
| Stale content after deploy | That's caching working. Version the URL, or purge — and prefer versioning. |
| CDN caching authenticated pages | `cache_mode` is `FORCE_CACHE_ALL`, or responses lack `private`. Fix both. |

---

## Log it

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

**Next:** [Capsule 17 · Ki Suppression — Rate Limiting, Timeouts & Backpressure](../17-ki-suppression-rate-limiting/README.md)
