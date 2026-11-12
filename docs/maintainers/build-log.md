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

### The reader's heading anchors never worked (found 2026-08-09)

Writing B11 I wanted a "jump to the cheatsheet" link — the capsule is half
reference, so it needs one. It worked on GitHub and did nothing in the reader.
Two independent bugs, both invisible to every check we had.

**1. The slug didn't match GitHub.** `web/md.js` built heading ids with

```js
.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")
```

`\w` is ASCII-only, so accented letters were **deleted**: `línea` became `lnea`,
`cápsula` became `cpsula`. And `\s+` collapsed the two spaces an em-dashed
heading leaves behind, so `Lab — one module` slugged to `lab-one-module` where
GitHub emits `lab--one-module`.

Measured against GitHub's own renderer (`gh api ... -H "Accept:
application/vnd.github.html"`) over B11's 55 headings per language: **21 of 55
wrong in English, 29 of 55 in Spanish.** The Spanish half was worse because
nearly every heading carries an accent. 453 headings repo-wide contain an em
dash, so this was close to total.

**2. Even a correct slug went nowhere.** `route()` treats every hash as a route,
so `#the-cheatsheet` became `renderCapsule("the-cheatsheet")`, which finds no
capsule and falls through to `renderHome()`. Clicking a table-of-contents link
threw you out of the capsule you were reading.

Both are fixed: the slug now matches github-slugger (letters/digits/marks/
connectors survive, each space becomes one hyphen), and `route()` falls back to
scrolling to a matching element before giving up and going home.

**Why it was invisible.** `validate.py` check 5 explicitly skips `#` targets, so
no anchor was ever checked. And the one place anchors were already in use —
`docs/maintainers/runbooks.md`, with nine of them — is a *maintainer* doc that
renders correctly on GitHub, which is where we always read it. All nine were
dead in the reader and nobody had looked.

**The trap for whoever touches this next:** the reader is now a second
implementation of GitHub's slug rule. `validate.py` check 5b is a third, in
Python. All three must agree or anchors rot again — the check exists precisely
so they can't drift silently. Both implementations were verified to produce
byte-identical output to GitHub across 110 real headings in two languages.

**Process note.** Verifying the scroll in an automated browser tab looked like a
failure: `scrollIntoView()` moved nothing and `window.scrollY` stayed 0. The
cause was the app's `scroll-behavior: smooth`, which animates via
`requestAnimationFrame` — throttled in a tab that isn't foregrounded. Forcing
`{behavior: "instant"}` scrolled exactly as intended. The fix was right and the
measurement was lying; worth remembering before "fixing" a working scroll.

---

## Fixes from writing the arc recap (2026-11-11)

Writing a one-page recap for every capsule (`site/recap/`) meant reading each
README against itself end to end. That turned up contradictions and missing
pieces, and every one was reproduced before it was fixed, and executed after.
The parallel runs shared one machine, so load-test numbers are shape-only (see
09). Reference-repo follow-ups are listed at the end.

### MEDIUM — Capsule 03: three Part 2 plan comments did not match what Terraform prints

"A safe in-place change" (`replica_count=3`) promised "1 to change" and a `~`.
Terraform 1.15 with local 2.9 prints `local_file.manifest must be replaced`,
`-/+`, `# forces replacement` on `content`, and "1 to add, 0 to change, 1 to
destroy". `local_file` cannot edit a file, so every content change is a
replacement. The first plan is "2 to add", not 3 (there are two resources). The
prod plan is "2 to add, 2 to destroy", and the drift step prints "will be
created". `terraform fmt` also rewrote the file because of an extra alignment
space in the provider block.

**Why it was invisible.** Every comment matched what Terraform usually does on
cloud resources. Nobody had run this `main.tf` against these two providers.

**Fix.** The code is kept, because a learner on `main` has probably already
written this `main.tf`. The prose now teaches what actually happens: the
provider decides `~` versus `-/+` per attribute, so read the
`# forces replacement` line. Verified by extracting `main.tf` from the README
and running the whole lifecycle before and after. The reference's `capsule-03`
has the same `fmt` space.

### Minor — Capsule 05: Senzu `/train` numbers predated the recalibration

The table said the cap was 5,000,000 and the default 200,000. The code in the
same capsule (and in reference `capsule-05`) says 50,000,000 and 1,000,000. The
handler had been fixed and the table hadn't. The row now also mentions the
silent fallback to the default when you go over the cap.

### HIGH — Capsule 05 Step 4: the GOMAXPROCS trap curled nothing, and could hide the trap

`docker run --rm --cpus=1 scouter:latest &` published no port. Step 3 stops its
container, so the curl got connection refused (exit 7). It now runs detached
with `-p 8080:8080 --name trap` and cleans up before Step 5.

Running it showed a second problem. A module whose `go.mod` says `go 1.25` or
later, built with the course's `golang:1.25-alpine`, reports `gomaxprocs: 2`
under `--cpus=1`: the 1.25 runtime is cgroup-aware and never goes below 2. With
`go 1.23` it reports 8 of 8, and `GODEBUG=containermaxprocs=0` brings the trap
back. The capsule now says this. The concept note's "the 1.23 in these
capsules" had gone stale when Capsule 02 moved to 1.25.

**Why it was invisible.** The `&` looks like it starts a server. Whether the
trap appears depends on the learner's `go.mod`, not on the Dockerfile.
Verified with both images: the trap shows p50 1.59 s against 0.80 s with the
fix.

### HIGH — Capsule 08: `UpstreamWait` was configured and never used

The `Config` field was set to 10 s in `main.go` and never read. A hung backend
held each gateway request until the server's 30 s `WriteTimeout` dropped the
connection; against a 15 s upstream the gateway returned `200 in 15.0s`.
`route()` now wraps the request in `context.WithTimeout`, and `ErrorHandler`
maps `DeadlineExceeded` to 504 (other errors stay 502). After the fix: a 1 s
upstream gives 200, 15 s gives `504 in 10.0s`, and a dead backend gives 502.

**Why it was invisible.** The field is named, commented and set, and `go vet`
doesn't flag unused struct fields. The reference has the same defect in every
tag from `capsule-08` to `capsule-26`.

### MEDIUM — Capsule 07: the honest least_conn finding was contradicted elsewhere in the capsule

The earlier fix (above: "Capsule 07 Step 2/3: the least_conn comparison does
not reproduce") rewrote Step 3 but left the old promise around it. Step 2 still
said "some fast requests took far longer than they should have", and then Step
3 explained why Go keeps `/healthz` at ~2 ms. The Senzu row blamed "no visible
difference" on uniform request cost, which is the opposite of Step 3's reasons.
The commit message had the learner write "difference shows only in the tail".
The Step 1 heading ("see the algorithms differ") and the Step 2 `rounds` note
("slow enough to *watch* the imbalance") made the same promise.

**Why it was invisible.** Each sentence is fine on its own. The contradiction
only shows when you read Step 2 against Step 3, and the earlier fix was scoped
to Step 3.

**Fix.** Step 2 now asks for a baseline without predicting it. The `rounds`
note gives the real reason 3M rounds fails: it finishes during the `sleep 1`
(303 ms measured). The Senzu row says "expected, see Step 3" and keeps the
check for the silent fall back to the default. The commit message says "no
difference above run-to-run noise at this scale".

Verified on the `capsule-07` tag with the compose file as written (no CPU
limit), 3 runs per case, worst of 20 fast `/healthz` requests. With 6 slow
30M-round requests: round robin 3.9–5.3 ms, `least_conn` 3.7–4.2 ms. With 4
slow: round robin 1.6–1.7 ms, `least_conn` 1.56–1.75 ms. The machine was
shared and contended; the no-difference conclusion survives that.

**Still open.** Step 3's table says it was measured at `cpus: 0.5`, but nothing
in the learner's compose sets that limit, so learners will see single-digit ms
rather than 60–122 ms.

### MEDIUM — Capsule 09 Step 5: the cpus sweep straddled a knee the capsule says isn't there

The earlier fix moved Step 2 to `--cpus=0.25` because `--cpus=1` has no knee.
But Step 5 still looped over `0.5 1 2` to "watch the knee move", and the commit
message said "found the knee at N RPS on 1 vCPU". Measured: 0.5 is already flat
(p95 1–3 ms, 0–4 dropped, ≤4 VUs) and 1 is flatter, so the learner would watch
nothing move.

**Why it was invisible.** Step 5 was never re-run after Step 2's limit changed;
the two steps were edited separately.

**Fix.** The loop is now `0.125 0.25 0.5`, and it greps `dropped_iterations`
and `vus_max` too. The prose describes the three shapes, says a flat run is a
lower bound and not a capacity number, says to take RPS per vCPU only from a
run whose knee lands inside the ramp, and to halve or double all three values
if every run looks the same. The commit message now says `--cpus=0.25`.

Verified twice on the `capsule-09` tag with `grafana/k6` via docker. At 0.125:
p95 3.5 s and 5.2 s, 30–36k iterations dropped, VUs at the 800 cap. At 0.25:
p95 179 and 254 ms, 1.2–1.4k dropped. At 0.5: p95 3.5 and 1.2 ms, 4 and 0
dropped. Taken under contention from parallel work (load average ~3–4 on 8
cores), so only the shape is claimed. Absolute values need a re-run on a quiet
machine; the 0.25 p95 is worse than this log's earlier 30–68 ms.

### MEDIUM — Capsule 11 quoted 200k-row numbers on a 2M-row table

Step 1 loads 2,000,000 readings, but Step 3's prose and table were measured on
an earlier 200k-row table (7.6 ms → 0.094 ms, 16 and 90 buffers). Step 2
promised 100–400 ms, and the commit message said ~200 ms. Re-run on Postgres 16
with Step 1 verbatim: no index is a `Parallel Seq Scan` under `Gather Merge`,
`shared hit=14780`, ~29 ms; right index 13 buffers, 0.040 ms (~700×); wrong
index 83 buffers, 0.148 ms. Step 2 also told the learner to look for
`shared read=`, but right after the load every buffer is a `hit`.

Step 4 said `power > 1000` returns "~90%", and that a seq scan beats "1.8
million random page fetches". With power uniform over 0–10M it is 99.99%
(1,999,801 rows), and the forced plan does no random heap fetches. Once
autovacuum has run it is an `Index Only Scan` (76 ms against 68 ms for the seq
scan); before that it is a `Bitmap Heap Scan` (180 ms against 72 ms).

**Why it was invisible.** Each number was plausible on its own. Nothing looked
wrong until the lab was run at the size it actually loads. Corrected in both
languages and in the commit message. The reference's `capsule-11` commit
message has the same "~200ms".

### LOW — Capsule 15's commit message contradicted its own test

The "Log it" message said "~65% for modulo"; the prose and the test say ~75%.
The reference's `capsule-15` ring tests print 25.8% vs 74.9%. Fixed in both
languages.

### MEDIUM — Capsule 16's "simulate distance" command added no delay, and the obvious completion teaches the wrong lesson

Step 3 offered `apk add --no-cache iproute2` inside the edge as a way to add
150 ms. It only installs a package; `tc qdisc show` still lists `noqueue`.
Completing it with `--cap-add NET_ADMIN` and `tc qdisc add dev eth0 root netem
delay 150ms` does work, but it delays every packet leaving the edge, including
the HIT on its way back to curl. Measured: MISS 0.62 s, HITs ~0.30 s, the
opposite of "the MISS pays, the HIT doesn't". The `tc` route is removed and the
`time.Sleep` route is now the step, with the reason in a callout.

Running the sleep route found a second trap. If the edge already holds the
entry, it serves it `STALE` while refreshing in the background
(`proxy_cache_background_update` plus `use_stale updating`), so the slow MISS
never appears. The step now says to `docker stop edge` first. Verified: origin
~155 ms on every request; edge MISS 156 ms, then HITs at 1.2–1.6 ms.

### HIGH — Capsule 17's half-open breaker admitted everyone

`allow()` moved open → halfOpen and returned true, but halfOpen then fell into
`default: return true`, so every caller after the cooldown hit the dependency.
The comment said "let one through to probe" and the prose said "a trickle".

**Why it was invisible.** The sequential recovery test passes either way.

**Fix.** A `probing` flag allows one probe in flight; everyone else gets
`ErrCircuitOpen`. `TestBreakerHalfOpenAdmitsOneProbe` fails on the old code
(`called=true`) and passes on the new one under `-race -count=20`. The
reference's `capsule-17` has the same bug.

In the same capsule, the `latestFromRedisOrDB` fragment assigned `miss` without
declaring it (`undefined: miss`); only the warning callout declared it. It is
now declared and set on `redis.Nil`, and compiles inside the reference's
`capsule-17` `cached.go`.

### MEDIUM — Capsule 17 Step 6 promised a breaker the lab doesn't have

Step 6 claimed "with breaker + shedder: requests fail in ~0 ms" with Postgres
paused, but the breaker wraps Redis only. Its `ALTER SYSTEM SET
default_transaction_isolation='serializable'; SELECT pg_reload_conf();` errors
("cannot run inside a transaction block"), and when applied properly it slows
nothing: k6 latencies matched the baseline.

What actually happens with Postgres paused and 100 VUs: writes wait the 3 s
timeout; leaderboard reads served by Redis stay at ~9 ms p50 (5 s p99 when they
fall through); `/healthz` stays at ~2.6 ms; and 99.7% of requests get a 429 in
~2 ms from Step 1's per-IP limiter, because k6 runs from a single IP. There
were no 503s, so the shedder never engaged. The step now says what really
happens: bounded cost rather than fast failure, and a second `Breaker` for the
database if you want that too. The confusing "Breaker never opens" Senzu row
was rewritten.

**Found, not fixed.** In the reference's `capsule-17`, `POST /readings`
returns 201 even after the write times out, because `Store.Record` has no
error return. `/readyz` returned 200 while Postgres was paused; not
investigated.

### HIGH — Capsule 19: the dead-letter path acked before it copied, and discarded the copy's error

The Step 4 callback did `m.Ack()` and then `_ = dlq.Publish(ctx, m)`. If the
DLQ publish failed, the original was already acked and the copy never existed:
the message was gone, and the logs only said "dead-lettering".

**Why it was invisible.** When the DLQ topic exists, the happy path works
perfectly; the bug only shows when the publish fails. In the emulator, with the
DLQ topic missing, the original code left 0 messages on `ranker`, none
anywhere else, and no error in the logs.

**Fix.** Publish, `res.Get(ctx)`, ack on success, nack on failure, and carry
the error in an attribute. With the fix the message lands in `dlq-inspector`
with `attributes.error`; with no DLQ topic it is nacked and kept (`NotFound` is
logged). The extracted block compiles against pubsub v1.51.0.

### Minor — Capsule 19: `total_power` stopped being a total, and Step 1's event couldn't drive the version check

`HandleVersioned` sets `total_power = EXCLUDED.total_power`. That is correct,
because version checks are for set-to-state updates (drill 5), but the column
name says otherwise: against Postgres a real event leaves `total_power=12000
reading_count=1`. Separately, the hand-written Step 1 event has no
`recorded_at`. Go decodes the zero time, `UnixNano()` returns
`-6795364578871345152`, and against Step 2's row (`last_version=0`) the update
silently matches nothing and returns a nil error. Its `"version":1` is the
schema version, not the one being checked, which makes the trap easier to fall
into.

**Why it was invisible.** The step's only test is a pure comparison table.
Fixed with two prose paragraphs; no code change. The `recorded_at` workaround
they give was run and applies.

### HIGH — Capsule 20: `FlushBatch` copied into a table nothing creates

`reading_events` appears only in `FlushBatch`: in no other capsule and in no
reference tag. Every flush fails with `relation "reading_events" does not exist
(SQLSTATE 42P01)`. The DDL is now in the capsule, deliberately without a
primary key: with one, a batch containing a single already-copied event fails
with 23505 and loses the whole batch. Verified with 5000 events through the
capsule's `Batcher` in batches of 500: all 5000 rows landed.

### Minor — Capsule 20: the code didn't use the `ZADD GT` its comment promised

The comment and "Bring it to work" both rely on `ZADD GT`, but the code called
plain `ZAdd`, so a lower or older score overwrote a higher one. Against Redis,
applying 9001, 150 and 8000 in turn ended at 8000. Switched to `ZAddGT`
(go-redis v9.22.0). With the fix, 9001 then 150 stays 9001, and 12000 then 8000
stays 12000.

### Minor — Capsule 23: `social` is always degraded, and the prose didn't say so

The course never builds a social service, so `SOCIAL_URL`'s default `:8082` is
refused on every request. Verified with the reference BFF: `["social"]` with
everything running; both names with ranking killed, in either order because
goroutines append as they finish; 503 with readings killed. The Step 5 sample
JSON was right, but the prose described only ranking failing. Steps 4 and 5 now
say what the learner will see. The earlier "verified" line (`ranking down →
["ranking"]`) must have used a social stub.

### Minor — stale bonus-capsule count

`README.md`, `es/README.md` and Capsule 26 (EN and ES) said seven bonus
capsules; there are ten. A grep for other stale counts and derived totals
found nothing else.

### Reference repo follow-ups (not done)

- `capsule-08`…`capsule-26`: `UpstreamWait` is unused, the same defect as Capsule 08.
- `capsule-17`: the half-open breaker admits everyone; `POST /readings` returns 201 after a write times out.
- Commit messages of `capsule-07`, `capsule-09` and `capsule-11` still carry the old claims (fixing them means rewriting tags, Runbook 6).
- There are no `capsule-19`, `-20`, `-23` or `-24` tags: 19–21 are batched into `capsule-21`, and 23–25 into `capsule-25`. CLAUDE.md says every capsule has one.
