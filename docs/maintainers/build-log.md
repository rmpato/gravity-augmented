# Build log — bugs found by building the course

**Maintainer notes, not course material.** See [`../../MAINTAINERS.md`](../../MAINTAINERS.md).

This is the record of what went wrong while working through every capsule and
building [`gravity-chamber-reference`](https://github.com/rmpato/gravity-chamber-reference)
from the capsule text. Each entry is a real defect that was fixed in the course,
the reference, or both.

**Why keep it.** Almost none of these were findable by reading. `weight=0` looks
fine until nginx refuses to start; `traceFromHeader` looks defined until you
compile; the least_conn comparison looks instructive until you measure the noise.
The pattern is consistent enough to be a working rule: **a lab that has not been
run is not finished.** That rule is now point 3 of the merge bar in
`MAINTAINERS.md`, and this file is the evidence for it.

It also records two things I got **wrong** and later corrected — the migration
numbering "collision" and the claim that `capsule-25` didn't compile. Those are
kept deliberately. A findings list that only contains hits is not a findings
list.

---

## Findings from building the reference repo

- **Capsule 09, Step 4**: "Copy stress.js to closed.js and swap the executor"
  leaves the stale `// OPEN model:` comment at the top of closed.js, which
  directly contradicts what the file now does. Add a line telling the reader to
  update the comment too.
- **Capsule 12, Part B**: the shard0/shard1 block is introduced with
  "Add to **`deploy/docker-compose.yml`**" — the same phrasing Capsule 03 uses
  for a block that IS the complete file. A skimming reader can overwrite their
  compose. Capsule 10 handles this correctly (it shows `# …existing config…`);
  12 should do the same, or the fragment should be labelled
  "**append to** `deploy/docker-compose.yml`".
- **Capsule 13, Step 4**: "Wire it in `main.go` behind `REPLICA_URLS`, the same
  way you did for shards" — the wiring is never shown, and it is more involved
  than the shard case (you must build a `[]*PostgresStore` and keep the primary
  around). Either show it or say explicitly that it's left as an exercise.

### HIGH: Go base image vs the go.mod directive (capsules 02 + 10)

Capsule 02 pins `FROM golang:1.23-alpine`. Capsule 10's `go get
github.com/jackc/pgx/v5/pgxpool` (and Capsule 15's `golang.org/x/sync`) pulls a
version whose own go.mod requires `go >= 1.25`, which raises the learner's
`go` directive to 1.25.0.

The build then **passes locally and fails only inside Docker**, because the
official golang images set `GOTOOLCHAIN=local` while a local `go` defaults to
`auto` and silently downloads the newer toolchain. Error:

    go: go.mod requires go >= 1.25.0 (running go 1.23.12; GOTOOLCHAIN=local)

Fixes needed:
1. Capsule 02 Dockerfile: bump to `golang:1.25-alpine` and add a comment that
   this must stay >= the `go` directive in go.mod.
2. Capsule 02 "Bring it to work": the pin-your-base-image advice is right but
   incomplete — add that `go get` can raise the directive under you.
3. Capsule 02 Senzu: add the exact error string and the fix.
4. Capsule 10: one line warning that adding pgx may bump the go directive.
Mirror all of it into es/.

### MEDIUM: /train is mis-calibrated on Apple Silicon (capsules 05, 07, 15)

ARM has hardware SHA-256, so the hash chain is ~5x faster than the capsule
assumes. Measured on an M-series Mac:

    rounds=200000     ~20 ms   (capsule 05 says "roughly 100ms")
    rounds=1000000   ~103 ms
    rounds=5000000   ~515 ms   (this is the hard cap in the handler)

Consequences: capsule 05's ladder is noisy because each request is only ~20ms;
capsule 07's "slow" request at 3M rounds is ~300ms, which is not slow enough to
make round-robin vs least_conn visibly differ; capsule 15's stampede window is
tight.

Fix: raise the cap from 5,000,000 to 50,000,000, raise the default to
1,000,000, and add a calibration line to capsule 05 Step 2 —
"time one request and pick `rounds` so it lands near 200ms on YOUR machine;
ARM Macs need ~5x the rounds an x86 box does."

### Capsule 06: my Senzu note was wrong (verified against real Docker)

The lab works exactly as written — nginx distributed 10/10/10 across three
replicas and the write/read split produced the taught 404-vs-200 pattern.

The existing Senzu row says:

> "All requests hit the same replica — nginx caches the DNS resolution of
>  `scouter`. Use `resolver 127.0.0.11 valid=5s;` plus a variable in
>  `proxy_pass`, or just accept it for this lab."

That is misleading and makes a working lab sound unreliable. nginx resolves
`scouter` at config-load time and **expands all A records Docker returns**, so
with `depends_on` ensuring the replicas exist first, it balances correctly.

The real caveat is different: if you `--scale` AFTER nginx has started, the new
replicas are not picked up until you restart the `lb` container. Replace the row
with that.

### HIGH: Capsule 13's replica setup does not work as written (verified)

`docker-compose.replica.yml` fails in two places. Both fixed and re-verified in
the reference repo.

1. **`pg_basebackup` is refused.**
       FATAL: no pg_hba.conf entry for replication connection from host "..."
   initdb's default `pg_hba.conf` only allows replication from localhost. The
   primary needs an init script that appends:
       host replication all all scram-sha-256
   Mount it at `/docker-entrypoint-initdb.d` on the PRIMARY.

2. **Postgres then refuses to start on the cloned directory.**
       FATAL: data directory "/var/lib/postgresql/data" has invalid permissions
       DETAIL: Permissions should be u=rwx (0700) or u=rwx,g=rx (0750).
   Docker creates the mount point 0755. The replica command needs
   `chmod 0700 /var/lib/postgresql/data` after pg_basebackup.

After both fixes the whole lab works: streaming/async in pg_stat_replication,
read-only enforcement, the pause-replay divergence (primary 2 rows vs replica 1),
convergence on resume, and pg_promote() flipping pg_is_in_recovery to f.

Both fixes are instructive in their own right — add them to the capsule with the
error text, since these are the two most common reasons a hand-rolled replica
fails in real life. Add Senzu rows for both. Mirror into es/.

### Capsule 17: two fragments don't land cleanly

1. **The `Shedder` block has no filename.** Every other type in the capsule is
   introduced as `**\`internal/scouter/limit.go\`**` etc, but Shedder is a bare
   ```go fence — the reader doesn't know which file it belongs in, and the block
   omits the `package` line and the `net/http` import. Give it
   `**\`internal/scouter/shedder.go\`**` and a complete header.

2. **The breaker-around-the-cache fragment targets the wrong function.** It shows
   `func (c *CachedStore) Latest(...)` wrapping the Redis GET in `breaker.Do`.
   But Capsule 15 already refactored `Latest` into a 1-second local-cache wrapper
   and moved the Redis call into `latestFromRedisOrDB`. Applied literally, the
   reader either reintroduces the Redis call into the wrong layer or loses the
   hot-key cache. The fragment should target `latestFromRedisOrDB`.

   Also worth stating: with the breaker wrapping the GET, `redis.Nil` must be
   returned as `nil` from inside `Do` (a miss is not a failure) and
   `ErrCircuitOpen` must be mapped to "miss" so the caller falls through to the
   database. The capsule hints at this in a callout but doesn't show the code.

### Capsule 18: the publisher is never wired up

Step 2 says "Hook it into `Record`" and shows the handler body using `s.pub`,
but never shows:
  - the `pub` field being added to `Server`
  - how it gets set (constructor arg? setter?)
  - the wiring in `main.go`
  - the import

A learner ends up inventing all four. The reference repo introduces a small
`Publisher` interface in `internal/scouter` plus `SetPublisher`, so the service
package never imports the pubsub client — worth adopting in the capsule, since
it also keeps Capsule 22's module-boundary test happy.

### RETRACTED — "migration numbers collide across capsules"

I logged this as HIGH and it was wrong. The capsules are consistent:
`001_init.sql` (10), `002_ranks.sql` + `003_processed_events.sql` (19),
`004_outbox.sql` (21), `005_expand_power_level.sql` (24). The `002_indexes.sql`
that collided was one I invented while building the reference repo — Capsule 11
teaches indexes interactively in `psql` and never claims a migration number.
Capsule 20 does give the `daily_fighter_stats` DDL (line ~433); it is simply not
filed under `deploy/sql/`.

What survives, downgraded to minor: **Capsule 11's indexes never become a
migration.** The learner creates them by hand in `psql`, so a `down -v` loses
them, and every later capsule that relies on `idx_readings_fighter_time` is
quietly depending on manual state. Capsule 20's DDL has the same issue. Suggest
folding both into the numbered `deploy/sql/` sequence — the discipline the rest
of the course teaches.

### Minor — two conventions for naming a file in a code block

Most blocks use ``**`path/to/file.go`**`` above the fence. Eight use an in-fence
comment instead (`-- deploy/sql/004_outbox.sql`, `// internal/ranking/service.go`).
Pick one — the bolded-path form, since it survives languages without comments
and is what the web reader highlights. Affected: 19 (x2), 21, 22 (x2), 25 (x2),
B2.

### Capsule 22: the architecture test asserts nothing

Two problems, both caught by building the reference repo:

1. `TestModuleBoundaries` uses `domains := {"readings", "ranking", "notification"}`,
   but 21 capsules have called that package `internal/scouter`. Nothing is ever
   renamed, and the capsule never asks the learner to rename it. Use
   `{"scouter", "ranking", "notification"}` — keeping the name the whole course
   has used is worth more than matching the diagram.
2. The test `continue`s past a missing directory, so with none of the three
   present it walks nothing and **passes**. A learner runs `go test ./internal/`,
   sees green, and believes a boundary is enforced that isn't. Count what was
   checked and `t.Fatal` on zero.

Also: `internal/ranking/service.go` and `contract_test.go` are illustrative
fragments (no package clause, no `Service` type, `handler()` undefined), while
the surrounding prose reads as if they were files to save. Either mark them as
fragments or give the whole file — the reference has a working version of both.

### HIGH — Capsule 25: `internal/obs` does not compile

`logging.go` calls `traceFromHeader(r.Header.Get("traceparent"))`. That function
is defined nowhere in the capsule, nowhere in the repo, and is not from a
library — `go build ./internal/obs` fails with `undefined: traceFromHeader`.
This is the first thing the learner runs in Step 1.

The capsule needs the W3C traceparent parser spelled out (version-traceid-
spanid-flags, 32/16 hex chars), which is a good thing to teach anyway: the
lesson is that a malformed header from an upstream you do not control must
degrade to "no trace", never fail the request. The reference has the function
plus a table test.

Second, smaller bug in the same block: when there is no `traceparent` AND no
inbound `X-Request-Id`, `reqID` stays `""` — so the service logs an empty
`request_id` and echoes `X-Request-Id: ` back. Mint a UUID as the last fallback.

### Capsule 23: `internal/bff/mobile.go` is split across three unlabelled blocks

Only the first carries the `**path**` label; the next two continue the same
file with no indication. Taken alone the first block does not compile — its
import list declares `context`, `encoding/json`, `fmt` and `sync`, none of which
the shown code uses. Label the continuations (`internal/bff/mobile.go`, cont.)
so a learner copying block by block always has a compiling file.

### HIGH — Capsule 25: the metrics checkpoint prints nothing

The capsule builds `obs.Metrics(route string, next http.Handler)` and then only
says "Expose it:" with `mux.Handle("GET /metrics", promhttp.Handler())`. It
never shows `obs.Metrics` being *applied* to any route, so `requests` and
`duration` are registered but never observed.

Verified empirically: a `CounterVec` with zero label combinations emits **no
lines at all** — not even `# HELP` / `# TYPE`. So the capsule's own two checks

    curl -s localhost:8080/metrics | grep -E '^http_requests_total|^http_request_duration'
    curl -s localhost:8080/metrics | grep -c '^http_requests_total'

print nothing and `0`. The learner concludes their build is broken.

The fix is also the lesson. Because `obs.Metrics` takes the route *pattern* as
an argument — deliberately, so the cardinality stays bounded — it has to be
applied at registration time, one route at a time:

    func route(mux *http.ServeMux, pattern string, h http.HandlerFunc) {
        mux.Handle(pattern, obs.Metrics(pattern, h))
    }

Show that helper. It is the concrete answer to "how do I get the pattern and
not the path?", which is the whole point of the low-cardinality section.

### Minor — Capsule 26 rounds a risk in the wrong direction

The failure table says a CDN outage means "6× load on origin". At the stated
85% hit ratio it is `1/0.15 = 6.7×`. Rounding a *risk* down is the one direction
you should not round. Say ~6.7× (or state the origin QPS: ~1,300 → ~8,700).

Everything else in Capsule 26 checks out — every python block was executed and
the documented estimation and cost outputs match exactly.

### HIGH — Capsule 17's breaker silently breaks Capsule 14's cache metrics

Found by running the stack, not by reading it. Capsule 14 classifies the Redis
result with:

    case errors.Is(err, redis.Nil):
        c.misses.Add(1)

Capsule 17 then wraps the `Get` in `breaker.Do(...)` and — correctly — returns
`nil` from inside the closure on `redis.Nil`, so a miss never trips the breaker.
But that also means `err` is now `nil` on a miss, the `redis.Nil` case stops
matching, and **every cache miss falls into `default`**: counted as an error and
logged as

    WARN cache read failed key=scouter:fighter:goku err=null

Observed live: 20 reads produced `{"errors":1,"hits":0,"misses":0}`. The learner's
hit-ratio instrument is silently wrong from Capsule 17 onward, and `err=null` in
a warning log is a genuinely confusing thing to debug.

The fix is also clearer than the original — track the miss explicitly instead of
inferring it from an error that a wrapper is allowed to rewrite:

    var raw []byte
    var miss bool
    err := c.breaker.Do(func() error {
        b, gerr := c.rdb.Get(ctx, key).Bytes()
        if errors.Is(gerr, redis.Nil) { miss = true; return nil }
        raw = b
        return gerr
    })
    if errors.Is(err, ErrCircuitOpen) { miss = true; err = nil }
    switch {
    case err == nil && !miss:  /* hit */
    case miss:                 c.misses.Add(1)
    default:                   c.errs.Add(1); c.log.Warn(...)
    }

This is worth teaching in its own right: *a sentinel error is part of a
function's contract, and wrapping that function can erase it.*

### Capsule 17: the breaker guards one of three Redis call sites

Verified with Redis stopped. `Latest`'s read is protected; the cache write-back
(`rdb.Set`, both the positive and the `"null"` negative-cache path) and the whole
of `Leaderboard` still call Redis directly. They share the read's 500 ms context
budget, so behaviour is bounded rather than broken — but the capsule reads as if
adding the breaker protected "the cache".

Measured, Redis down, distinct keys so the local cache can't absorb them:

    requests 1-8   ~505 ms each   (paying the Redis timeout; errors climb to 5)
    requests 9-16  ~100 ms each   (breaker OPEN, straight to Postgres)
    all 16         HTTP 200       (cache failure is not request failure ✅)

Worth one honest paragraph: "you have protected the read path. `Leaderboard` and
the write-back are still exposed — wrap them the same way, or say why you didn't."

### HIGH — Capsule 18: every publish fails as written

Caught by running it, not reading it. `NewPublisher` sets an `OrderingKey` on
each message but never sets `topic.EnableMessageOrdering = true` on the
publisher client. Every `Publish` returns:

    publish: Topic.EnableMessageOrdering=false, but an OrderingKey was set in
    Message. Please remove the OrderingKey or turn on Topic.EnableMessageOrdering

This is nastier than a normal broken lab, because Capsule 18 *deliberately*
logs-and-continues when a publish fails (to set up the dual-write problem that
Capsule 21 solves). So the API still returns **201**, the learner sees success,
and the ranker in Step 3 receives nothing at all with no visible cause.

The capsule already has a Senzu row naming the exact fix — but the code above it
doesn't apply it, so 100% of learners hit it. Enabling ordering on the *topic
resource* is not enough; it is a publisher-client setting.

Fixed in the capsule (EN + ES) and the reference. Verified after the fix: three
POSTs produced three messages on the subscription with the right ordering keys
and `event_type`/`version` attributes.

### Capsule 06's scale lab stops working after Capsule 10

`deploy/docker-compose.scale.yml` is written at Capsule 06, when the service is
still in-memory, so it has no `DATABASE_URL`. Capsule 10 makes that variable
**required** — the service now exits at boot with

    ERROR invalid configuration err="DATABASE_URL is required"

and nginx then dies too (`host not found in upstream "scouter:8080"`), which
sends you chasing an nginx problem that isn't one.

Nobody hits this on the first pass, because you do 06 before 10. You hit it when
you go *back* to re-run the horizontal-scaling lab — which is exactly what the
review command now encourages. Add a line to Capsule 10 Step 4: "if you kept
`docker-compose.scale.yml` from Capsule 06, add `DATABASE_URL` to it too, or it
will stop booting."

Verified after adding it: 30 requests split 11/11/11 across three replicas.

### Capsule 11 points at a plan line Postgres 16 does not emit

Step 3 says of the reversed index: *"Look at `Rows Removed by Filter` — that
number is the cost of the wrong order."* There is no such line. Verified on
Postgres 16.14 over 200k rows: both the right and the wrong index produce
`Index Scan` with `Index Cond: (fighter_id = 42)`, because the check happens
inside the index rather than against the heap.

The learner looks for a line that isn't there and concludes they set the lab up
wrong. The real evidence is `BUFFERS`:

| Index | Cost | Buffers | Time |
|---|---|---|---|
| `(fighter_id, recorded_at DESC)` right | 390 | 16 | 0.077 ms |
| `(recorded_at DESC, fighter_id)` wrong | 4973 | 90 | 0.290 ms |
| no usable index | 13676 | — | 7.6 ms |

Corrected in both languages, and it makes a better point than the original:
when two plans look structurally identical, `BUFFERS` is what distinguishes
them — which is the argument for defaulting to `EXPLAIN (ANALYZE, BUFFERS)`.

Also note the capsule's headline claim of "**100–1000× improvement**" — measured
here it is **80×** (7.6 ms → 0.094 ms) against a table with an unrelated index
still present. Worth softening to "often 10–100×, and it grows with table size".

## Docker verification coverage

**Verified live against real containers** (21): 01, 02, 03, 06, 08, 10, 11, 12,
13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25.

Highlights of what was actually exercised, not just started:
- 08 — backend receives `X-Caller: web` and **neither** `X-Api-Key` nor
  `Authorization`; 401 on missing/bad key; rate limit shed 11 of 40 at 30/s
- 11 — index right vs wrong column order vs none: 16 / 90 / — buffers
- 12 — 40 writes split 26/26 across shards; reads route correctly; scatter-gather
  leaderboard merges both
- 13 — replication, read-only enforcement, pause-replay divergence, failover
- 16 — MISS→HIT, and 20 concurrent cold requests coalesced to 1 origin fetch
- 17 — breaker opens after 5 failures: 505 ms → 100 ms, all requests still 200
- 18/19 — events published with ordering keys; 3 replays of a processed
  event_id changed nothing (idempotency holds)
- 21 — outbox relay drained 5 unpublished rows to 0
- 25 — RED metrics populated with route *patterns*; all four correlation-id
  paths incl. malformed traceparent

**Go code compiled, vetted and unit-tested** but not exercised as a live lab:
B3 and B5 only — both are pure Go with no infrastructure, so their test suites
*are* the lab. B10's lab was run end to end against a real toolchain
including the deliberate data race.

**Not run** (and why): 04 and 26 are paper/concept capsules with no local stack.
05, 07 and 09 are performance labs whose numbers are hardware-dependent — these
were recalibrated rather than pinned to my machine's timings. B1, B2, B4, B6, B7
are concept capsules with short self-contained snippets.

## Second pass — the four capsules I had skipped

Ran 20, 22, 23 and 24 as live labs rather than trusting `go test`. One real bug.

### HIGH — Capsule 24: `weight=0` makes nginx refuse to start

`deploy/nginx-bluegreen.conf` opens with:

    server blue:8080  weight=100;
    server green:8080 weight=0;

nginx rejects this outright:

    [emerg] invalid parameter "weight=0" in /etc/nginx/nginx.conf:7

Weights must be >= 1. The container exits, and the learner's very first step of
the blue-green lab fails. "No traffic" is expressed with `down`:

    server green:8080 down;

Verified after the fix: `down` → 10/10 requests to blue; switching to
`weight=80` / `weight=20` → 4 of 20 to green, exactly 20%. Fixed in both
languages and the reference.

### A suspicion of mine that was wrong

I expected `canary-watch.sh` to exit early under `set -e`, because
`[ "$code" -ge 500 ] && errors=$((errors + 1))` returns non-zero on every
healthy response. It does not — bash's errexit exempts a non-final command in
an `&&` list. Tested both paths: a healthy run reports `0/20 (0%) → healthy`,
and a deliberately-broken canary at 20% reports `20/100 (20%) → ABORT` with
exit 1. The script is correct as written.

### Minor — Capsule 23's BFF ignores `PORT`

`cmd/mobile-bff/main.go` hardcodes `Addr: ":9000"` while every other binary in
the course reads `PORT` from the environment. Not wrong, but inconsistent, and
it silently ignores a variable a learner will reasonably try to set.

### Verified behaviour

- **20** — 5,000 readings rolled to 50 rows; two extra reruns of the same day
  left `(50 rows, 5000 readings)` unchanged. Idempotent as claimed.
- **22** — with the ranking service killed: `/leaderboard` returns **200 +
  `X-Degraded: true` + `[]`**, and writes still return **201**. Fault isolation
  exactly as the capsule claims.
- **23** — all four states: full screen; ranking down → 200 + `degraded:
  ["ranking"]`; ranking+social down → 200 + both listed; **readings (critical)
  down → 503**, not a half-rendered screen. Two hanging dependencies cost
  **1.5 s, not 4 s** — the fan-out really is parallel.
- **24** — blue/green split verified above; `canary-watch.sh` aborts correctly;
  25% flag rollout measured **24.9% over 10,000 users**, sticky per user, with
  0% and 100% absolute.

## Web reader — Battle drill rendering (reported by the user)

### HIGH — `display: flex` on `<summary>` mangles every question with code spans

`.doc summary` had `display: flex; gap: 9px; align-items: baseline`. In flex
layout **every inline element and every text node becomes its own flex item**,
and `flex-wrap` defaults to `nowrap`. So a Battle drill question containing
several `<code>` spans was laid out as squeezed vertical columns, breaking
identifiers mid-token:

    "A function returns | *MyErr / or | as its declared type, and returns |
     ni / l | . The caller's | if err != / nil | is true. Why?"

This explains why only *some* capsules looked broken: severity scales with the
number of inline elements in the question. B10's questions carry 3–4 `<code>`
spans each and were unreadable; Capsule 01's carry one or two and merely looked
loose.

Fixed by dropping flex entirely and using a positioned marker
(`position: absolute` + `padding-left`), so the question flows as ordinary
wrapping text. Verified before/after in the browser, on B10 and Capsule 01, and
across themes.

Improvements made at the same time, since the ask was "easy to read for humans":
- hover and `:focus-visible` states, so the question reads as clickable
- a dashed separator between question and answer when open
- answers indented to align under the question text, not under the marker
- `overflow-wrap: anywhere` on code inside a summary, so a long identifier
  wraps instead of forcing a horizontal scrollbar
- `overflow: hidden` on the card so children respect the rounded corners

### Two smaller things found while in there

- **Stale hero count.** `web/app.js` said "27 capsules · 7 bonus" in both
  languages. Now 10.
- **`.scouter/reviews` was not gitignored.** I added the reviews file for
  spaced repetition but only `.scouter/progress` was ignored, so a learner's
  review history would have been committed. Added.

### Unexplained

While browsing, `.scouter/progress` gained `done` markers for capsules 01–04
with timestamps from that minute. The only code path that writes progress is an
explicit `#btn-done` click, which I did not make. I cleared the file but could
not reproduce or explain it. Worth watching — if a learner's progress changes on
its own, that is a trust-destroying bug.

### Task #7 — unexplained progress writes: investigated, not reproduced

Traced every path that can write `.scouter/progress`:

- `bin/serve`'s `read_progress()` is pure; `write_progress()` only writes what
  it is given, and is reachable **only** from `POST /api/progress`.
- In `web/app.js`, `setStatus()` has exactly two call sites: the `#btn-done` and
  `#btn-wip` click handlers. Sidebar rows call `go(id)` (navigation only) and
  `wireDoc()` only rewrites links and wires copy buttons.
- The keyboard handler binds `/`, `j`, `k`, arrows and Escape — no status keys.

Verified empirically: replayed a full browsing session as pure GETs (`/`,
`/api/state`, the assets, and four capsule docs) with stack-trace instrumentation
on `write_progress`. **Zero writes.** A real POST logs and writes correctly, so
the instrumentation was working.

Could not reproduce. Rather than leave it silent, `write_progress` now echoes
every write to the server console:

    12:12:44  capsule 14 -> done

GETs produce no line. So if it recurs, there is a timestamped record, and a
learner who sees a line they didn't cause knows immediately that it's a bug.
Closing as contained: the file is local, gitignored, and `./bin/scouter reset`
fixes it.

### HIGH — Capsule 07 Step 2/3: the least_conn comparison does not reproduce

Ran the lab live for the first time. Two separate problems.

**1. The slow requests were never slow.** Step 2 uses `rounds=3000000`, and my
own correction told learners to multiply their calibrated ROUNDS by ~15 (=30M).
But `/train` caps `rounds` and silently falls back to the default when the value
is over the cap. At the `capsule-07` tag the cap is still the ORIGINAL
5,000,000 — so `rounds=30000000` produced a **21 ms** request, not a slow one.
Nothing was ever pinned and Step 2 measured nothing.

After applying the corrected Capsule 05 handler (cap 50M, default 1M), the same
call takes **5.9 s** at `cpus: 0.5`. So the Capsule 05 fix was necessary — but
note the silent-fallback behaviour is itself a trap: exceed the cap and you get
the default with no error. Worth an explicit line in Capsule 05.

**2. `least_conn` shows no reproducible improvement.** With genuinely slow
requests, four configurations, 3 backends at `cpus: 0.5`, 30M-round chains:

| Setup | round-robin max | least_conn max | verdict |
|---|---|---|---|
| 6 slow (lands 2/2/2, even) | 85.6 ms | 88.5 ms | no difference |
| 2 slow (backends unsaturated) | 1.8 ms | 1.8 ms | no difference |
| 4 slow (lands 2/1/1, uneven) | 60.0 ms | 122.2 ms | least_conn **worse** |
| 4 slow, no keepalive | 2.0 ms | 61.6 ms | least_conn **worse** |

And a keepalive-only A/B with round-robin fixed gave 16.1 ms median with
keepalive vs 42.2 ms without — the **opposite** of an earlier identical run
(33 ms vs 1.2 ms). Run-to-run variance exceeds the effect.

The capsule currently promises: *"It should be visibly better."* It is not, and
telling a learner to expect a difference that isn't there teaches them to see
signal in noise — the precise opposite of what a load-testing capsule should
teach.

Contributing reasons, all worth teaching:
- **6 slow requests over 3 backends is 2/2/2 — perfectly even.** That is
  round-robin's *best* case; there is no imbalance for least_conn to fix. The
  lab picked the one configuration where the effect cannot appear.
- **`least_conn` counts connections, not CPU work.** With `keepalive 32` the
  connection count stops tracking in-flight work at all.
- **Go preempts CPU-bound goroutines**, so a "busy" Go backend still answers a
  trivial request in ~2 ms until genuinely saturated — unlike the
  thread-per-request model the lab's intuition assumes.

Fix applied: Step 3 is rewritten to be an honest measurement with repetition,
and to state plainly that no visible difference is a normal and correct outcome
at this scale, with the conditions under which least_conn actually wins.

### HIGH — Capsule 09: `--cpus=1` is too generous, so there is no knee to find

Ran the k6 labs for the first time (via the `grafana/k6` image, no host install).

**Step 1 (smoke) passes cleanly:** 109k requests, 0 failures, p95 232µs against
the 200ms threshold.

**Step 2 (find the knee) finds nothing as written.** The capsule says to run the
service at `--cpus=1 --memory=512m` and ramp to 1600 rps. Measured on an 8-core
M-series Mac:

| Service limit | p95 | peak VUs | dropped iterations |
|---|---|---|---|
| `--cpus=1` (as written) | **1.16 ms** | 3 | 0 |
| `--cpus=0.25` | **30–68 ms** | 45–151 | 219–332 |

At `--cpus=1` latency is flat all the way to the top of the ramp and k6 never
needs more than 3 concurrent VUs — an in-memory Go service is simply far faster
than this ramp. The learner would conclude the service scales infinitely, which
is precisely the error the capsule exists to prevent. It also strands Step 3
(Little's Law), which needs a row below a knee that never appears.

Fixed to `--cpus=0.25` in both languages, with the measured table and an
explicit instruction to lower the limit further on a fast machine — choosing a
scale where the dynamics are observable is a legitimate part of load testing,
not cheating.

Also recorded: the two `--cpus=0.25` runs gave p95 68ms and 30ms (peak VUs 151
and 45). The capsule now says so, and contrasts it with Capsule 07: a 26–60×
effect against that spread is a real finding; Capsule 07's sub-noise difference
is not. The two capsules now teach the same discipline from both directions.

**Note on the runner:** k6 was not installed and I did not install it. The whole
lab runs fine via `docker run --rm -i --network host -v <scripts>:/s:ro
grafana/k6 run -e BASE=... /s/smoke.js`. Worth adding to the capsule as an
alternative to `brew install k6` for people who don't want another binary.

### Reference tags rebuilt (was: "stale tags")

The per-capsule tags were snapshots taken before the capsule bugs were found, so
`git diff capsule-NN` — the entire reason that repo exists — compared against
code the corrected capsules no longer teach.

Fixed by rewriting history with an idempotent `filter-branch` tree filter. Being
pattern-based, it touched only the commits where each bug actually existed and
was a no-op elsewhere. Four fixes backfilled:

| Fix | Tags corrected |
|---|---|
| `/train` cap 5M -> 50M (Capsule 05) | `capsule-05` … `capsule-26` (19) |
| Cache miss counted as an error (17) | `capsule-17` … `capsule-26` (6) |
| `EnableMessageOrdering` (18) | `capsule-18` … `capsule-26` (5) |
| nginx `weight=0` -> `down` (24) | `capsule-25`, `capsule-26` (2) |

Verified from a **fresh clone of GitHub**: every tag from `capsule-01` on passes
`go build ./...` and `go test ./...`. (`capsule-00` has no Go code — scaffold
only.) `main`'s tree is byte-identical to before the rewrite.

**Correction to an earlier finding:** I had claimed `capsule-25` was missing
`traceFromHeader` and did not compile. That was wrong — it has both
`traceFromHeader` and the `route()` helper, and it built fine. The README said
so too and has been corrected. Only four patterns were ever broken, not five.

**Process note:** the first `--force-with-lease` was correctly rejected. My
"backup" branch had itself been rewritten, because I ran `filter-branch -- --all`
which includes every ref. The genuine pre-rewrite state survived only on the
remote. Lesson: a backup ref taken *before* a `filter-branch --all` is not a
backup. Take it after, from the remote, or exclude it from the rewrite.
