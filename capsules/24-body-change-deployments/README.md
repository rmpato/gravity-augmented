# Capsule 24 · Ginyu's Body Change — Safe Deployments

> *Captain Ginyu swaps bodies with Goku mid-fight. Same mind, entirely different
> vessel, and the swap happens instantly with no downtime. It also goes badly
> wrong twice — once he ends up in a frog — which is why you always keep the old
> body available and rehearse the way back.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 8 | 80 min | Capsules 02, 07, 22 | Local + ☁️ optional |

---

## Why this capsule exists

Everything in this repo is worthless if you can't ship it safely. Deployment is
where most production incidents originate — not because the code was wrong, but
because the *transition* was.

The teams that deploy twenty times a day with confidence aren't braver. They
have made deployment **boring**: small changes, instant rollback, and a release
step separate from the deploy step.

---

## The concept

### Deploy ≠ release

The most important idea here.

- **Deploy** — the new code is running on servers.
- **Release** — users are getting it.

Separating them is what makes everything else possible: you deploy at 10am with
zero user impact, then release to 1% at 11am and watch. If it's bad, you release
back to 0% in seconds — no rebuild, no rollback pipeline, no git revert.

The mechanisms are **traffic splitting** (infrastructure) and **feature flags**
(application).

### The strategies

**Rolling** — replace instances a few at a time.

```
  [v1][v1][v1][v1] → [v2][v1][v1][v1] → [v2][v2][v1][v1] → [v2][v2][v2][v2]
```
Default in Kubernetes. No extra capacity cost. But both versions serve
simultaneously (so they must be compatible), and rollback is another slow roll.

**Blue/green** — two full environments, switch all traffic at once.

```
  blue (v1) ←── 100% traffic
  green (v2) ←─ 0%, warm and tested
                     ↓ switch
  blue (v1) ←── 0%
  green (v2) ←─ 100%
```
Instant rollback (switch back). Costs 2× capacity during the transition, and
every user moves at once — so a bad release hits everyone.

**Canary** — a small percentage first, then increase.

```
  v1: 95% ──► v1: 90% ──► v1: 50% ──► v1: 0%
  v2:  5%     v2: 10%     v2: 50%     v2: 100%
       ↑ watch error rate and latency at each step
```
Best blast-radius control. Needs good metrics and patience. **This is the
default you should want.**

**Shadow / dark launch** — send a copy of production traffic to v2 and discard
its responses. Tests real traffic patterns with zero user risk. Careful: the
shadow must not cause side effects (no writes, no emails, no charges).

### Expand → migrate → contract

**You cannot deploy code and schema at the same instant**, because during a
rolling deploy both versions run simultaneously. So never write a migration that
requires it.

Renaming `power` to `power_level`, done safely:

```
  1. EXPAND    ALTER TABLE readings ADD COLUMN power_level BIGINT;
               Old code unaffected. Deploy this alone.

  2. MIGRATE   Deploy code that WRITES BOTH and READS power_level
               with a fallback to power. Backfill in batches.

  3. CONTRACT  Once nothing reads `power`: ALTER TABLE DROP COLUMN power;
               A separate deploy, often days later.
```

Three deploys instead of one, and every intermediate state works with both
versions running. **Every migration must be runnable while the old version is
still serving.**

The rules that follow:

- **Additive changes are safe** (new nullable column, new table, new index
  `CONCURRENTLY`).
- **Destructive changes need a full expand/contract cycle** (drop, rename, type
  change, adding `NOT NULL`).
- **Never make a migration and a code change depend on each other.**
- **Backfill in batches** with a delay — a single `UPDATE` over 50M rows locks
  the table and takes the site down.

### Feature flags

Flags decouple release from deploy *inside* the application:

```go
if flags.Enabled(ctx, "new-ranking-algorithm", userID) {
    return newRanking(ctx)
}
return oldRanking(ctx)
```

- **Release flags** — temporary, for rollout. **Delete them within weeks.**
- **Ops flags** (kill switches) — permanent, to disable an expensive feature
  under load.
- **Experiment flags** — A/B tests, removed when the experiment ends.

**Flag debt is real.** Every flag doubles a code path; ten flags is 1,024
theoretical combinations. Set an expiry date on release flags and enforce it.

### What to watch during a rollout

Compare **canary vs baseline**, not canary vs its own history:

- **Error rate** — the primary signal. Any increase aborts.
- **Latency p95/p99** — a canary is often faster with a small share of traffic;
  compare like for like.
- **Saturation** — memory and CPU per request, which catches leaks.
- **Business metrics** — checkout completion, sign-ups. A technically healthy
  release that halves conversions is a failed release.

**Automate the abort.** A human watching a dashboard is not a rollback strategy;
they go to lunch.

### Rollback discipline

> **Know your rollback command before you deploy.** Write it in the PR.

- **Rolling back code** is easy if artifacts are immutable and tagged with a
  git SHA (Capsule 02).
- **Rolling back schema is usually impossible** — you can't un-drop a column
  with data in it. This is why expand/contract exists.
- **Rolling back data** written by the bad version may need a separate repair.
- **Forward-fix vs rollback**: rollback by default, because it's the known-good
  state. Forward-fix only when rollback is genuinely impossible (an irreversible
  migration already ran) — and then you're in an incident, not a deploy.

---

## Lab

### Step 1 — a version endpoint you can watch

```go
// Set at build time: -ldflags "-X main.version=$(git rev-parse --short HEAD)"
var version = "dev"

	mux.HandleFunc("GET /version", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"version":  version,
			"instance": hostname,
		})
	})
```

```makefile
VERSION ?= $(shell git rev-parse --short HEAD)

docker-build:
	docker build -f deploy/Dockerfile \
	  --build-arg VERSION=$(VERSION) \
	  -t $(IMAGE):$(VERSION) .
```

Note there's **no `:latest` tag** here. An immutable tag per build is what makes
rollback a one-word change instead of a rebuild.

### Step 2 — blue/green locally

```bash
make docker-build VERSION=v1
# make a visible change, then:
make docker-build VERSION=v2
```

**`deploy/nginx-bluegreen.conf`**

```nginx
events {}
http {
  upstream app {
    # Weighted traffic split. This is what a canary IS — everything else
    # is tooling around this one idea.
    server blue:8080  weight=100;
    # NOT weight=0 — nginx rejects that outright:
    #   [emerg] invalid parameter "weight=0"
    # Weights must be >= 1, so "no traffic" is expressed with `down`.
    server green:8080 down;
  }

  server {
    listen 80;
    location / {
      proxy_pass http://app;
      add_header X-Served-By $upstream_addr always;
    }
  }
}
```

> **`down`, not `weight=0`.** nginx refuses to start on `weight=0` — weights
> must be at least 1. `down` marks the server administratively unavailable,
> which is what you actually mean at 0%. To start the canary you replace `down`
> with a real weight:
>
> ```nginx
> server blue:8080  weight=80;
> server green:8080 weight=20;
> ```
>
> Verified: with `down`, 10/10 requests went to blue. At 80/20, 4 of 20 went to
> green — exactly 20%.

```bash
docker network create deploy-lab 2>/dev/null
docker run -d --rm --network deploy-lab --name blue  scouter:v1
docker run -d --rm --network deploy-lab --name green scouter:v2
docker run -d --rm --network deploy-lab --name lb -p 8080:80 \
  -v "$PWD/deploy/nginx-bluegreen.conf:/etc/nginx/nginx.conf:ro" nginx:alpine

for i in $(seq 1 20); do curl -s localhost:8080/version | jq -r .version; done | sort | uniq -c
# 20 v1
```

### Step 3 — canary, step by step

```bash
canary() {   # canary <blue_weight> <green_weight>
  sed -i.bak "s/server blue:8080  weight=[0-9]*/server blue:8080  weight=$1/;
              s/server green:8080 weight=[0-9]*/server green:8080 weight=$2/" \
      deploy/nginx-bluegreen.conf
  docker exec lb nginx -s reload 2>/dev/null
  sleep 1
  echo "--- blue=$1 green=$2 ---"
  for i in $(seq 1 100); do curl -s localhost:8080/version | jq -r .version; done \
    | sort | uniq -c
}

canary 95 5      # 5% canary
canary 90 10
canary 50 50
canary 0 100     # full release
canary 100 0     # INSTANT ROLLBACK
```

That last line takes about a second. **That's the whole point of separating
deploy from release** — the rollback isn't a pipeline, it's a weight.

### Step 4 — make the canary fail, and catch it

Build a deliberately broken v3:

```go
	mux.HandleFunc("GET /leaderboard", func(w http.ResponseWriter, r *http.Request) {
		if version == "v3" && rand.Float64() < 0.3 {
			http.Error(w, "boom", http.StatusInternalServerError) // 30% failure
			return
		}
		s.handleLeaderboard(w, r)
	})
```

```bash
make docker-build VERSION=v3
docker rm -f green; docker run -d --rm --network deploy-lab --name green scouter:v3
canary 90 10
```

Now automate the decision — this script is the deliverable of the capsule:

**`scripts/canary-watch.sh`**

```bash
#!/usr/bin/env bash
# Watch a canary and abort automatically if its error rate exceeds a threshold.
# A human watching a dashboard is not a rollback strategy.
set -euo pipefail

URL="${URL:-http://localhost:8080/leaderboard}"
SAMPLES="${SAMPLES:-200}"
MAX_ERROR_PCT="${MAX_ERROR_PCT:-2}"

errors=0
for i in $(seq 1 "$SAMPLES"); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
  [ "$code" -ge 500 ] && errors=$((errors + 1))
done

pct=$(( errors * 100 / SAMPLES ))
echo "errors: $errors/$SAMPLES (${pct}%)  threshold: ${MAX_ERROR_PCT}%"

if [ "$pct" -gt "$MAX_ERROR_PCT" ]; then
  echo "ABORT — rolling back"
  exit 1
fi
echo "healthy — proceeding"
```

```bash
chmod +x scripts/canary-watch.sh
./scripts/canary-watch.sh   # ~3% errors at 10% canary of a 30%-broken build
# ABORT — rolling back
canary 100 0
```

**A 30% failure rate showed up as ~3% of total traffic** because the canary was
only 10%. That's blast-radius control expressed as arithmetic, and it's the
reason canaries are worth the ceremony.

### Step 5 — expand / migrate / contract, for real

Rename `power` to `power_level` without downtime.

**Migration 1 — expand** (`deploy/sql/005_expand_power_level.sql`):

```sql
-- Additive only. Old code is completely unaffected by this.
ALTER TABLE readings ADD COLUMN power_level BIGINT;

-- CONCURRENTLY: does not lock writes. Cannot run inside a transaction,
-- and may leave an INVALID index if it fails (drop and retry).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_readings_power_level
    ON readings (power_level);
```

**Code v2 — write both, read new with fallback:**

```go
// TRANSITION CODE. Writes both columns; reads the new one, falling back to
// the old for rows not yet backfilled. Delete this after the contract step —
// and put the deletion in your backlog now, not later.
const insertBoth = `
	INSERT INTO readings (fighter_id, power, power_level, recorded_at)
	VALUES ($1, $2, $2, $3)`

const selectWithFallback = `
	SELECT COALESCE(power_level, power) AS power, recorded_at
	FROM readings WHERE fighter_id = $1
	ORDER BY recorded_at DESC LIMIT 1`
```

**Backfill — in batches, throttled:**

```sql
-- Never a single UPDATE over the whole table: it takes a lock, generates
-- enormous WAL, and blocks everyone. Batch, and sleep between batches.
DO $$
DECLARE
    rows_updated INT;
BEGIN
    LOOP
        UPDATE readings
        SET power_level = power
        WHERE id IN (
            SELECT id FROM readings
            WHERE power_level IS NULL
            LIMIT 10000
        );
        GET DIAGNOSTICS rows_updated = ROW_COUNT;
        EXIT WHEN rows_updated = 0;
        RAISE NOTICE 'backfilled % rows', rows_updated;
        COMMIT;
        PERFORM pg_sleep(0.1);   -- let replicas keep up (Capsule 13)
    END LOOP;
END $$;
```

**Verify before contracting** — this query must return 0:

```sql
SELECT count(*) FROM readings WHERE power_level IS NULL;
```

**Code v3 — read and write only the new column.** Deploy. Wait. Confirm nothing
references `power` (grep the codebase, check query logs).

**Migration 2 — contract**, days later:

```sql
ALTER TABLE readings DROP COLUMN power;
```

Do the whole cycle in your local database and note how many *deploys* it took.
Three. That's the correct number, and the reason people ship broken migrations
is that they wanted it to be one.

### Step 6 — feature flags

**`internal/flags/flags.go`**

```go
// Package flags separates RELEASE from DEPLOY inside the application.
package flags

import (
	"hash/fnv"
	"os"
	"strconv"
	"strings"
	"sync"
)

type Flags struct {
	mu    sync.RWMutex
	rules map[string]int // flag -> rollout percentage 0..100
}

// New reads flags from the environment: FLAGS="new-ranking=25,dark-mode=100"
// In production this comes from a config service or LaunchDarkly/Unleash, so
// it can change WITHOUT a deploy — which is the entire point.
func New() *Flags {
	f := &Flags{rules: map[string]int{}}
	for _, pair := range strings.Split(os.Getenv("FLAGS"), ",") {
		name, pct, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		if n, err := strconv.Atoi(pct); err == nil {
			f.rules[strings.TrimSpace(name)] = n
		}
	}
	return f
}

// Enabled is STICKY per subject: the same user always gets the same answer
// for a given flag. Random per-request would flip users between code paths
// mid-session, which is how you get bug reports nobody can reproduce.
func (f *Flags) Enabled(flag, subject string) bool {
	f.mu.RLock()
	pct, ok := f.rules[flag]
	f.mu.RUnlock()
	if !ok || pct <= 0 {
		return false
	}
	if pct >= 100 {
		return true
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(flag + ":" + subject))
	return int(h.Sum32()%100) < pct
}

// SetPercent allows runtime changes — the kill switch.
func (f *Flags) SetPercent(flag string, pct int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rules[flag] = pct
}
```

**`internal/flags/flags_test.go`**

```go
package flags

import (
	"fmt"
	"testing"
)

func TestStickiness(t *testing.T) {
	f := &Flags{rules: map[string]int{"exp": 50}}
	first := f.Enabled("exp", "user-42")
	for i := 0; i < 100; i++ {
		if f.Enabled("exp", "user-42") != first {
			t.Fatal("flag is not sticky for the same subject")
		}
	}
}

func TestDistribution(t *testing.T) {
	f := &Flags{rules: map[string]int{"exp": 25}}
	on := 0
	const n = 10000
	for i := 0; i < n; i++ {
		if f.Enabled("exp", fmt.Sprintf("user-%d", i)) {
			on++
		}
	}
	pct := on * 100 / n
	t.Logf("25%% rollout produced %d%%", pct)
	if pct < 22 || pct > 28 {
		t.Errorf("distribution = %d%%, want ~25%%", pct)
	}
}
```

```bash
go test ./internal/flags/ -v
FLAGS="new-ranking=25" make run
```

```bash
docker rm -f blue green lb; docker network rm deploy-lab
```

---

## In GCP

> ### ☁️ Optional: Cloud Run traffic splitting
> Free tier eligible. Cloud Run has revision-based traffic splitting built in,
> which makes this the easiest canary system you will ever use.

```bash
# deploy WITHOUT taking traffic — this is "deploy", not "release"
gcloud run deploy scouter \
  --image="$IMAGE:v2" \
  --no-traffic \
  --tag=v2 \
  --region=us-central1

# the tagged revision gets its own URL for smoke testing
# https://v2---scouter-xyz.run.app
curl -s "https://v2---scouter-xyz.run.app/version"

# release to 5%
gcloud run services update-traffic scouter --to-tags=v2=5 --region=us-central1

# watch, then ramp
gcloud run services update-traffic scouter --to-tags=v2=25 --region=us-central1
gcloud run services update-traffic scouter --to-tags=v2=100 --region=us-central1

# INSTANT ROLLBACK to the previous revision
gcloud run services update-traffic scouter --to-revisions=scouter-00042-abc=100 \
  --region=us-central1
```

`--no-traffic --tag` is the cleanest deploy/release separation available in any
platform: the revision is live, addressable and testable, with zero production
traffic.

Other pieces:

- **`gcloud run revisions list`** — every past revision is retained and instantly
  re-targetable. Rollback is one command with no rebuild.
- **Cloud Deploy** — delivery pipelines with approval gates across
  dev → staging → prod, including multi-service rollouts.
- **Cloud Build triggers** — build and deploy on push, with substitutions for the
  git SHA.
- **Cloud Monitoring alerting policies** can watch a canary; wire the notification
  to a Cloud Function that calls `update-traffic` to abort automatically.
- **GKE**: `Deployment` with `maxSurge`/`maxUnavailable` for rolling, plus Argo
  Rollouts or Flagger for real canary analysis.
- **Binary Authorization** can require that only images signed by your pipeline
  are deployable.

---

## Bring it to work

- **Deploy and release are separate events.** Build the capability before you
  need it.
- **Immutable, SHA-tagged artifacts.** Never deploy `:latest`.
- **Write the rollback command in the PR description.**
- **Expand → migrate → contract for every destructive schema change.** No
  exceptions, and it's three deploys.
- **Backfill in batches with a sleep.** Watch replication lag while it runs.
- **Automate canary abort.** Humans go to lunch.
- **Compare canary against a concurrent baseline**, never against yesterday.
- **Give release flags an expiry date** and clean them up. Flag debt compounds.
- **Practise rollbacks.** A rollback path you have never exercised is a
  hypothesis.

---

## Battle drill

<details>
<summary><b>1.</b> Walk through renaming a column on a 500M-row table with zero downtime.</summary>

**Expand:** `ADD COLUMN new_name` (nullable, no default — a default with a value
rewrites the table on older Postgres). Add any index `CONCURRENTLY`. Deploy this
migration alone; old code is untouched.

**Migrate (code):** deploy a version that writes both columns and reads
`COALESCE(new_name, old_name)`. Now both old and new instances are correct during
a rolling deploy.

**Backfill:** batches of ~10k with a short sleep, monitoring replication lag and
disk (WAL). On 500M rows this is hours to days, and that's fine — nothing is
blocked.

**Verify:** `SELECT count(*) WHERE new_name IS NULL` must be 0. Then deploy code
that uses only `new_name`.

**Contract:** days later, once you're certain nothing reads it,
`DROP COLUMN old_name`.

Total: 3 deploys, 2 migrations, one backfill. Every intermediate state is safe
with both code versions running — which is the actual requirement, and the reason
it can't be compressed.
</details>

<details>
<summary><b>2.</b> Blue/green or canary?</summary>

**Canary** is the better default. It limits blast radius (5% of users see a bad
release, not 100%), gives you real production signal at low risk, and lets you
abort cheaply. Cost: it takes longer, needs good per-version metrics, and both
versions run simultaneously so they must be compatible.

**Blue/green** is right when versions *cannot* coexist — an incompatible schema
or protocol change — or when you need a completely clean environment to validate
against, or when the switch must be atomic for correctness. Cost: 2× capacity
during the transition, and everyone moves at once.

Note that blue/green doesn't remove the compatibility problem, it just moves it
to the database, which is shared by both environments anyway. That's why
expand/contract is required regardless of strategy.

In practice: canary for application changes, blue/green for infrastructure or
platform changes, and expand/contract for schema always.
</details>

<details>
<summary><b>3.</b> Your canary shows 0.1% more errors than baseline. Ship or abort?</summary>

**Abort, then investigate.** The cost asymmetry is decisive: aborting costs an
hour of investigation; shipping a real regression costs an incident, and possibly
data.

But first check whether the signal is real:
- **Is it statistically meaningful?** At 5% traffic over 2 minutes you may have
  200 requests; 0.1% of that is noise, not signal. Compute a confidence interval
  or extend the observation window.
- **Is it the *same* errors?** A new error type is far more alarming than a
  slight increase in a pre-existing one.
- **Is the baseline concurrent?** Comparing the canary now against yesterday
  confounds the version with time-of-day, traffic mix and dependency health.
- **Is it caused by the canary itself?** A cold cache, an empty connection pool
  or a JIT warm-up phase can produce transient errors in any new instance.

If it persists after a longer window with a concurrent baseline, abort. "It's
only 0.1%" is how you find out later that 0.1% was one whole customer.
</details>

<details>
<summary><b>4.</b> You deployed 30 minutes ago and errors are climbing. Rollback or forward-fix?</summary>

**Roll back first, diagnose after.** The old version is a known-good state; a
forward fix is unverified code written under pressure by someone stressed. Stop
the bleeding, then think.

Rollback is *not* available when:
- An irreversible migration already ran (you dropped a column) — which is exactly
  what expand/contract prevents.
- The new version wrote data the old version can't read.
- An external system already received something you can't retract.

In those cases you're in an incident, not a deploy, and forward-fix is the only
path — with a much higher bar for testing before shipping.

**Afterwards, the postmortem question isn't "why was the code wrong?" but "why
didn't the canary catch it?"** Thirty minutes of climbing errors means either
there was no canary, the observation window was too short, or nobody was
watching. Fix that.
</details>

<details>
<summary><b>5.</b> A colleague wants to keep a feature flag "just in case, indefinitely". Respond.</summary>

Distinguish two things.

**Ops flags / kill switches are legitimately permanent** — "disable
recommendations under load", "turn off the expensive report". They're operational
controls with a clear owner and a documented purpose.

**Release flags must die.** Every one doubles a code path. Ten flags is 1,024
theoretical combinations, and you test maybe three of them. The untested paths are
where bugs live, and eventually someone flips an old flag and discovers the code
behind it stopped working eight months ago.

So: what is this flag *for*? If it's "in case the new code is bad", the answer is
that you determine that during the canary, not indefinitely. If it's a genuine
operational control, name it as one, document it, and give it an owner.

Practical policy: release flags get an expiry date in the code
(`// EXPIRES: 2026-10-01`), a lint rule fails the build past it, and the ticket
to remove it is created when the flag is created — not "later".
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| nginx reload doesn't change the split | `docker exec lb nginx -t` first — a syntax error means the old config stays loaded. |
| Both versions report the same version string | `-ldflags -X main.version` requires the variable to be a package-level `var` in `main`, not a const. |
| `CREATE INDEX CONCURRENTLY` fails | It cannot run inside a transaction. If it fails it leaves an INVALID index — drop it and retry. |
| Backfill causes replica lag alerts | Batches too large or no sleep. Reduce both and watch `pg_stat_replication`. |
| Users flip between versions mid-session | Flag evaluation isn't sticky, or the LB isn't consistent. Hash on a stable subject id. |
| Rollback fails: image not found | You only tagged `:latest`. Tag with the git SHA and keep the artifacts. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(deploy): canary tooling, expand/migrate/contract, feature flags

Capsule 24. /version endpoint and SHA-tagged images. Weighted canary via
nginx with an automated abort script — a 30%-broken build showed as 3% of
traffic at a 10% canary. Full expand/migrate/contract column rename with a
batched, throttled backfill. Sticky percentage-based feature flags."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 24
```

**Next:** [Capsule 25 · Scouter Mk. II — Observability & SLOs](../25-scouter-mk2-observability/README.md)
