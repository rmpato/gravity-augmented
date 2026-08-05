# Capsule B8 · Namek's Five Minutes — Incident Response & Postmortems

> *"Namek will explode in five minutes."* Namek then took **ten episodes** to
> explode. This is the most accurate depiction of incident response ever
> broadcast: the ETA is wrong, everyone is shouting, and the people who actually
> help are the ones who stop panicking and start doing one useful thing at a time.

| Power level | Time | Prereqs | Best taken after |
|---|---|---|---|
| Bonus · 150 | 75 min | Capsules 13, 17, 25 | Capsule 25 |

---

## Why this capsule exists

Everything in the main arc makes your system *less likely* to break. None of it
makes your system unbreakable, and the difference between a good engineer and a
great one is mostly visible during the thirty minutes when it *is* broken.

That skill is almost never taught. People learn it by being on-call and being
scared, which produces the two most common failure modes:

- **The hero** — dives into the database, fixes it alone, tells nobody, and the
  organisation learns nothing.
- **The rabbit** — spends 40 minutes finding the *root cause* while users are
  still down, because diagnosing feels like progress.

Both are the same mistake: confusing "understanding the problem" with "ending
the impact". This capsule is about the second one.

---

## The lore

Namek's five minutes is a running joke, but look at what actually happens on
that planet. Goku doesn't investigate the core instability. He doesn't ask why.
He gets everyone off the planet, and *then* deals with Frieza.

**Evacuate first. Understand later.** That's the whole capsule.

---

## The one rule

> **Mitigate before you diagnose.**

If you take nothing else: when the pager goes off, your job is not to find out
what's wrong. Your job is to make the impact stop. Those are different jobs and
they often have different answers.

| Diagnosis | Mitigation |
|---|---|
| "The new query plan flipped after the stats update" | roll back the deploy |
| "There's a goroutine leak in the retry path" | restart the pods, then cap concurrency |
| "The cache is thrashing because the TTL is jittered wrong" | raise the TTL, or bypass the cache |
| "A customer is sending 40k QPS from one key" | rate-limit that key |

The right-hand column is usually **faster, safer and reversible**. The
left-hand column is what you write up tomorrow.

The corollary people resist: **you are allowed to fix an incident without ever
finding out what caused it.** You are not allowed to *close* it that way — but
ending impact at 03:10 and understanding it at 11:00 is a good night.

---

## Severity, and why it isn't a feeling

Severity decides who gets woken up. If it's a judgement call, it will be argued
about at 3am by people who are bad at arguing at 3am. Write it down instead.

| Sev | Meaning | Response | Example |
|---|---|---|---|
| **1** | Total outage, or data loss/corruption | Page immediately, all hands, exec comms | Writes failing globally; leaderboard serving another user's data |
| **2** | Major degradation, SLO burning fast | Page the on-call | p99 5× normal; one region down; error budget will be gone in a day |
| **3** | Minor or workaround exists | Next business day | One non-critical endpoint degraded; a replica lagging |
| **4** | Cosmetic, no user impact | Backlog | A dashboard is wrong |

Two rules that save arguments:

- **Data loss or a security issue is a Sev 1 regardless of how few users it
  touches.** Volume is the wrong axis for those.
- **Anyone can raise severity; only the incident commander lowers it.**
  Otherwise nobody escalates, because raising a false alarm feels worse than
  being quietly wrong.

---

## Roles — even when it's just you

At 3am with one person, "roles" sounds like bureaucracy. It isn't; it's a
checklist of jobs that all still need doing.

| Role | Owns | The failure if it's missing |
|---|---|---|
| **Incident Commander** | decisions, severity, who does what | five people investigating the same theory, nobody mitigating |
| **Ops / hands-on-keyboard** | actually running commands | the IC gets absorbed in a terminal and stops coordinating |
| **Comms** | status updates, stakeholders | an exec joins the call and re-asks everything, losing 10 minutes |
| **Scribe** | timeline in the channel | the postmortem is written from memory, and memory is fiction |

**The IC does not type.** The moment the commander is in a terminal, there is no
commander. If you are alone, you are all four — and the practical form of that
is: narrate what you're doing in the incident channel as you do it. That single
habit gives you comms and scribe for free, and it's how someone joining at
minute 12 gets up to speed without interrupting you.

---

## The first five minutes

In order. Do not skip ahead because you think you know what it is.

```
1. DECLARE.   Open a channel. Say "I am IC for <thing>." Even alone. Even if
              you're not sure it's real. Un-declaring is cheap.

2. ASSESS.    Who is affected, how badly, since when? One sentence.
              Check: is it all users, one region, one endpoint, one customer?

3. STABILISE. Is there a rollback? Take it. Was there a deploy or a config
              change in the last hour? That's your first suspect, always.
              Feature flag off > rollback > scale up > everything else.

4. COMMUNICATE. First update within 5 minutes, even with nothing to report.
              "Investigating elevated errors on X, next update in 15 min"
              is a complete and useful status update.

5. THEN diagnose.
```

Step 3 deserves emphasis. **The last change is the first suspect** — not because
engineers are careless, but because it's the only variable that moved. A system
that ran fine for six weeks and broke four minutes after a deploy is not a
coincidence, and "but that change was unrelated" is the single most expensive
sentence in incident response.

### Writing a status update when you know nothing

The most common comms failure is silence while you wait to have something worth
saying. You never will. A good update has four parts and takes 20 seconds:

```
IMPACT   Leaderboard reads are failing for ~30% of users since 14:05 UTC.
         Writes are unaffected.
STATUS   Investigating. We rolled back deploy #4412 at 14:12; no improvement yet.
NEXT     Checking Redis connection saturation.
ETA      Next update by 14:35.
```

Note there is no ETA *for resolution*. Never give one — you don't have it, and
a missed one costs more trust than silence. Commit to the next **update**
instead. That's a promise you can always keep.

---

## Lab — run an actual incident

Reading about this does nothing. You need the small adrenaline spike of a
system that is broken while a timer runs.

### Step 1 — the chaos script

**`scripts/chaos.sh`**

```bash
#!/usr/bin/env bash
# Picks one failure at random and applies it. Do NOT read the case statement
# before you run it — the whole point is that you don't know what you did.
#
#   ./scripts/chaos.sh          break something
#   ./scripts/chaos.sh reset    put everything back
set -euo pipefail
cd "$(dirname "$0")/../deploy"

if [ "${1:-}" = "reset" ]; then
  # ALTER SYSTEM persists in postgresql.auto.conf, so undo it explicitly before
  # recreating — `up --force-recreate` alone keeps the volume and the setting.
  docker compose start postgres >/dev/null 2>&1 || true
  sleep 3
  docker compose exec -T postgres psql -U scouter -d scouter \
    -c "ALTER SYSTEM RESET max_connections;" >/dev/null 2>&1 || true
  docker compose start redis >/dev/null 2>&1 || true
  docker compose exec -T redis redis-cli CONFIG SET maxmemory 0 >/dev/null 2>&1 || true
  docker compose up -d --force-recreate >/dev/null 2>&1 || true
  echo "restored."
  exit 0
fi

# Every branch ends in `|| true`. Without it, `set -e` kills the script the
# moment a command touches a container a PREVIOUS run already stopped — so the
# script would exit silently having done nothing, which is a confusing way to
# start an incident drill.
case $((RANDOM % 5)) in
  0) docker compose stop redis >/dev/null 2>&1 || true ;;
  1) docker compose exec -T postgres psql -U scouter -d scouter \
       -c "ALTER SYSTEM SET max_connections = 3;" >/dev/null 2>&1 || true
     docker compose restart postgres >/dev/null 2>&1 || true ;;
  2) docker compose exec -T redis redis-cli CONFIG SET maxmemory 1mb >/dev/null 2>&1 || true ;;
  3) docker compose stop postgres >/dev/null 2>&1 || true ;;
  4) : ;;   # nothing is wrong. This case exists on purpose — see Step 4.
esac
echo "chaos applied at $(date -u +%H:%M:%S)Z"
```

```bash
chmod +x scripts/chaos.sh
```

### Step 2 — set up, then break it

```bash
cd ~/repos/pato/gravity-chamber
docker compose -f deploy/docker-compose.yml up -d
sleep 10

# generate steady traffic in one terminal and LEAVE IT RUNNING
while true; do
  curl -s -o /dev/null -w "%{http_code} %{time_total}\n" localhost:8080/fighters/goku
  sleep 0.5
done
```

In a second terminal:

```bash
./scripts/chaos.sh
```

### Step 3 — run the drill, out loud, on the clock

Start a timer. Open `NOTES.md` and write as you go — this is your scribe log.
The rule: **you may not run a command until you have written why.**

```
T+0    DECLARE   I am IC. Symptom:
T+?    ASSESS    Impact:                    Scope:
T+?    STABILISE Tried:                     Result:
T+?    UPDATE    (write the 4-line status block)
T+?    MITIGATED Impact ended at:
T+?    CAUSE     (only now)
```

Two things to notice about yourself:

- How long before you wrote an impact statement? If you started running
  commands first, you did the normal thing and the wrong thing.
- Did you reach for `docker compose logs`, or for `/metrics` and `/readyz`?
  Capsule 25 exists so that the second is faster. If it wasn't, your
  instrumentation isn't good enough yet — that's a finding.

Then:

```bash
./scripts/chaos.sh reset
```

Run it three more times. The failures repeat, which is fine: the second time
you meet the same failure you should be *much* faster, and noticing that is the
point.

### Step 4 — the case where nothing is wrong

One of the five outcomes breaks nothing at all.

If you "found" a cause during that run, you just experienced the most dangerous
thing in incident response: **a system under scrutiny always looks guilty.**
Every service has a scary-looking log line, a spiky graph, a slow query. Under
pressure your brain will happily promote one to villain.

The defence is one question, asked out loud, before you act on any theory:

> **Does this explain the symptom, the timing, and the scope?**

A Redis warning that has appeared hourly for three weeks does not explain
something that started at 14:05. Timing is the cheapest test you have and it
kills most false leads for free.

---

## The postmortem

Write one for every Sev 1 and Sev 2, within 48 hours while memory is still
usable. Put it in the repo: `docs/incidents/YYYY-MM-DD-short-name.md`.

**`docs/incidents/2026-08-05-leaderboard-outage.md`**

```markdown
# 2026-08-05 · Leaderboard reads failing

**Severity:** 2 · **Duration:** 14:05–14:41 UTC (36 min) · **Author:** you
**Status:** action items open

## Impact
~30% of leaderboard reads returned 500 for 36 minutes. Writes unaffected.
No data lost. 41 minutes of error budget consumed (of 43/month).

## Timeline (UTC)
| Time | Event |
|---|---|
| 14:02 | Deploy #4412 (cache TTL change) reaches 100% |
| 14:05 | Error rate crosses 5%. **Nobody paged — see AI-2** |
| 14:14 | Reported by a user in #support |
| 14:16 | Incident declared, Sev 2 |
| 14:22 | Rolled back #4412. No improvement — cache already cold |
| 14:33 | Raised Redis maxmemory; errors began falling |
| 14:41 | Error rate normal. Impact ends |
| 15:20 | Root cause confirmed |

## What happened
The TTL change reduced effective cache lifetime by ~90%, raising Redis memory
churn past `maxmemory`. Evictions caused a stampede onto Postgres, which
saturated its connection pool, which failed leaderboard reads.

## Why it wasn't caught
Staging has 1/1000th of the key volume, so the memory ceiling was never
approached there.

## What went well
- The circuit breaker (Capsule 17) kept `/fighters/{name}` serving throughout.
  Only the leaderboard was affected — the blast radius held.

## What went badly
- **9 minutes of undetected impact.** A user told us, not the alert.
- The rollback was assumed to be the fix. It wasn't, and we waited 11 minutes
  on it before trying anything else.

## Contributing factors
1. No alert on Redis eviction rate.
2. Staging is not representative in the one dimension that mattered.
3. Rollback was treated as a diagnosis rather than a hypothesis to test.

## Action items
| # | Action | Owner | Due | Status |
|---|---|---|---|---|
| AI-1 | Alert on `redis_evicted_keys_total > 0` | you | 2026-08-12 | open |
| AI-2 | Page on error rate > 2% for 2 min | you | 2026-08-08 | open |
| AI-3 | Load staging to 10% of prod key volume | you | 2026-08-30 | open |
```

### The three rules of a postmortem

**1. Blameless — and be precise about what that means.** It does not mean "no
names". It means the question is never *who* but *what made this the reasonable
thing to do*. "Ana deployed without checking staging memory" is blame. "Our
deploy checklist doesn't mention memory headroom, and staging couldn't have
shown it anyway" is a finding you can fix. The test: could a competent, careful
person have made this mistake? If yes — and it's almost always yes — the system
is the problem.

**2. "Contributing factors", not "root cause".** Singular root cause is a
comforting fiction. The outage above needed a TTL change *and* a low memory
ceiling *and* an unrepresentative staging *and* a missing alert. Remove any one
and there's no incident. Picking one to be The Cause means you fix one of four
holes and feel finished.

**3. An action item with no owner and no date is a wish.** Cap yourself at 3–5.
Ten action items means zero get done and everyone learns that postmortems are
theatre. Fewer, real, tracked.

---

## On-call, sustainably

- **A pager that fires for things you can't act on will be ignored**, including
  when it's right. Every alert needs a documented action; if the action is
  "look at it and see", it's a dashboard, not an alert.
- **Alert on symptoms, not causes** (Capsule 25). "Error rate > 2%" survives
  re-architecture. "Redis CPU > 80%" is stale the day you switch to
  Memorystore, and it fires when nothing is wrong.
- **Every page should have a runbook link in the alert itself.** At 3am your
  reasoning is measurably worse; a link beats a memory.
- **Track the pages that produced no action.** A rota where half the pages were
  noise is a rota people quit.
- **Whoever was paged overnight is off the next day.** Not a favour — recovery.

---

## Bring it to work

- **The first status update is the highest-leverage thing you'll do**, and you
  can send it before you understand anything. Impact / status / next / next-update.
- **"What changed?" answers most incidents.** Make deploys and config changes
  visible on the same timeline as your metrics and you get this for free.
- **Ask "does this explain the symptom, timing, AND scope?"** out loud. It kills
  false leads for free and it is contagious in a good way.
- **A postmortem nobody reads is worth writing anyway** — but a postmortem with
  three owned, dated action items is worth ten of those.

---

## Battle drill

<details>
<summary><b>1.</b> You're 25 minutes in, the outage is ongoing, and you have a strong theory but no proof. What do you do?</summary>

Mitigate on the theory if the mitigation is cheap and reversible, and say out
loud that it's a guess. "Restarting the pods; this is a hypothesis, not a
diagnosis" is a legitimate move — it costs 30 seconds and might end the impact.

What you must not do is spend another 20 minutes gathering proof while users are
down. Proof is tomorrow's work. The asymmetry is the point: a wrong cheap
mitigation costs seconds; 20 more minutes of outage costs your error budget.
</details>

<details>
<summary><b>2.</b> Your rollback didn't fix it. What does that tell you?</summary>

Less than people assume. Three possibilities, and you can't yet distinguish them:

1. The deploy wasn't the cause.
2. The deploy *was* the cause but the damage persists — a poisoned cache, a
   corrupted row, a full queue, a cold cache that now can't warm.
3. The rollback didn't fully take (a partially-drained fleet, a cached config).

The instinct — "rollback failed, so the deploy is exonerated" — is wrong often
enough to be dangerous. Verify the rollback actually landed (`/version`,
Capsule 24), then keep the deploy on the suspect list.
</details>

<details>
<summary><b>3.</b> Why does the incident commander not touch the keyboard?</summary>

Because typing is absorbing. The moment you're in a terminal you stop tracking
who's doing what, you stop noticing that comms haven't gone out in 20 minutes,
and you stop hearing the person who has the answer.

Alone you can't avoid it — so narrate instead. Writing "trying X because Y" in
the channel before each command keeps the coordinating half of your brain awake,
and it writes your postmortem timeline for you.
</details>

<details>
<summary><b>4.</b> A postmortem has 14 action items. What's wrong?</summary>

None of them will be done. Fourteen is a wish list produced by a room trying to
prove it took the incident seriously.

Pick the 3 that would actually have prevented or shortened *this* incident, give
each an owner and a date, and put the rest in the backlog where they belong. The
credibility of the whole practice depends on action items being real, because the
first time a team sees last quarter's items still open, postmortems become
paperwork.
</details>

<details>
<summary><b>5.</b> Nothing is broken, but your dashboard has a red panel and a scary log line. Is this an incident?</summary>

Not yet. An incident is defined by **user impact**, not by a red thing.

The trap is the reverse of the usual one: under scrutiny every system looks
guilty, and if you go looking for a villain you'll find one. Ask whether it
explains a symptom users are actually experiencing. If there's no symptom,
you have a monitoring finding, not an incident — file it, tune the alert, and
go back to bed.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `chaos.sh` seems to do nothing | One of five outcomes is deliberately harmless. That's Step 4. |
| Can't reset cleanly | `docker compose down -v && docker compose up -d`. `ALTER SYSTEM` persists in `postgresql.auto.conf`, so `-v` is the sure fix. |
| `max_connections` change didn't apply | It needs a restart, not a reload. The script restarts; if you ran it by hand, `docker compose restart postgres`. |
| Traffic loop shows `000` | curl couldn't connect at all — the service is down, not slow. That distinction is itself a diagnostic. |
| You can't tell when impact started | That's the finding. You need the RED metrics from Capsule 25 and a deploy marker on the same timeline. |

---

## Log it

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done B8
```

**Next:** [B9 · Babidi's Spell — Security Beyond Auth](../B9-babidis-spell-security/README.md)
