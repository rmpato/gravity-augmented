# Capsule 13 · Namekian Fusion — Replication & Consistency

> *Nail merges with Piccolo. Two beings, one mind — except for a moment during
> the fusion, they are not yet the same. Everything hard about replication lives
> in that moment: how long is it, what can you observe during it, and who wins
> when they disagree?*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 8 | 80 min | Capsules 10–12 | Local |

---

## Why this capsule exists

You have a single database. It is a single point of failure and a read
bottleneck. Replication fixes both — and introduces the hardest concept in
distributed systems: **things can be true in one place and not yet true in
another.**

This capsule is where "eventual consistency" stops being a phrase you nod at and
becomes a specific bug you have reproduced with your own hands, plus the four
patterns that fix it.

---

## The concept

### Leader/follower replication

```
              writes
                │
                ▼
        ┌───────────────┐
        │    LEADER     │  accepts all writes, streams its WAL
        └───┬───────┬───┘
            │       │
      ┌─────▼──┐ ┌──▼─────┐
      │follower│ │follower│   read-only, applies the log
      └────────┘ └────────┘
            ▲       ▲
          reads   reads
```

The leader writes to its **write-ahead log** (WAL) and ships it to followers,
who replay it. That log is the whole mechanism, and it's the same mechanism
behind point-in-time recovery, change data capture (Capsule 21) and most
cross-region replication.

### Synchronous vs asynchronous

| | Sync | Async |
|---|---|---|
| Commit returns | after a follower confirms | as soon as the leader has it |
| Write latency | leader + network + follower | leader only |
| Data loss on leader failure | none | **whatever hadn't shipped yet** |
| If a follower is slow | writes block | nothing |

Postgres offers a middle ground: `synchronous_commit = on` with
`synchronous_standby_names` set to `ANY 1 (s1, s2, s3)` — wait for *any one* of
three, so one slow follower doesn't stall you.

**The practical position most teams land on:** one synchronous standby for
durability and failover (this is what Cloud SQL HA gives you), plus asynchronous
read replicas for scale.

### Replication lag, and the four bugs it causes

Lag is normally milliseconds. It becomes seconds or minutes during bulk loads,
long-running follower queries, network trouble, or a follower on weak hardware.

**1. Read-your-writes.** User updates their profile, is redirected to it, reads
from a lagging replica, and sees the old value. They conclude your app is
broken. They're not wrong.

**2. Monotonic reads.** Two consecutive reads hit different replicas with
different lag, so the user sees data move *backwards in time*.

**3. Consistent prefix.** Replicas apply events out of order relative to each
other, so an answer appears before its question.

**4. Cross-entity invariants.** You read A from a fresh replica and B from a
stale one; together they're a state that never existed.

### The four fixes

| Pattern | How | Cost |
|---|---|---|
| **Read from leader after write** | for N seconds after a user's write, pin *that user* to the leader | leader load; needs per-user tracking |
| **Sticky replica** | one user always reads the same replica | fixes monotonic reads only; uneven load |
| **Wait for LSN** | client remembers the write's log position, replica waits to catch up | correct and precise; needs support |
| **Design it away** | after a write, render the value you already have; don't re-read | free. Usually the right answer |

The last one deserves emphasis. Most read-your-writes bugs are self-inflicted:
the write already returned the new state. Displaying that instead of re-fetching
removes the problem entirely, costs nothing, and is faster.

### CAP, honestly

**CAP:** when the network *partitions*, you must choose between **C**onsistency
and **A**vailability. That's it. CAP says nothing about normal operation, and
"CP vs AP" as a product label is mostly marketing.

**PACELC** is the more useful formulation:

> **if P**artition, choose **A**vailability or **C**onsistency;
> **E**lse (normal operation), choose **L**atency or **C**onsistency.

The "else" branch is the one you live in 99.99% of the time. Strong consistency
costs latency *every single day*, not just during partitions — because it means
coordination, and coordination means round trips.

### Consistency models, from strong to weak

```
  Linearizable ──► Sequential ──► Causal ──► Eventual
  (single global    (agreed        (cause      (converges
   order, real-      order)         before      someday)
   time)                            effect)

  slower, more coordination  ────────────►  faster, more anomalies
```

Most systems want **causal consistency** and settle for **eventual** with
targeted fixes at the few places users would notice.

### Quorums

For leaderless/multi-leader systems (Cassandra, DynamoDB):

```
  N = replicas,  W = replicas that must ack a write,  R = replicas read from

  W + R > N  →  read and write sets overlap  →  you read the latest write
```

`N=3, W=2, R=2` is the classic: survives one node down, still strongly
consistent for reads. `W=1, R=1` is fast and gives you nothing.

Quorums alone don't order concurrent writes — that needs version vectors, last-
write-wins (which silently loses data), or CRDTs.

### Spanner and TrueTime

Spanner achieves **globally linearizable** transactions, which sounds
impossible. The trick: GPS and atomic clocks in every datacentre give a bounded
clock uncertainty ε (a few ms). On commit, Spanner **deliberately waits out ε**
so timestamp ordering is guaranteed.

Google bought consistency with **hardware and latency**. It's real, it works,
and the reason not to use it is cost — not correctness.

---

## Lab

### Step 1 — a real streaming replica

Postgres physical replication, in compose.

**`deploy/docker-compose.replica.yml`**

```yaml
name: gravity-chamber-replica

services:
  primary:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: scouter
      POSTGRES_PASSWORD: kamehameha
      POSTGRES_DB: scouter
    # initdb's default pg_hba.conf allows replication from localhost ONLY, so
    # without this the standby's pg_basebackup is refused. See Senzu.
    volumes:
      - ./sql-replication:/docker-entrypoint-initdb.d:ro
    command: >
      postgres
      -c wal_level=replica
      -c max_wal_senders=5
      -c max_replication_slots=5
      -c hot_standby=on
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scouter"]
      interval: 3s
      retries: 15

  replica:
    image: postgres:16-alpine
    depends_on:
      primary:
        condition: service_healthy
    environment:
      PGPASSWORD: kamehameha
    ports: ["5435:5432"]
    user: postgres
    # pg_basebackup clones the primary, then we start as a hot standby.
    command: >
      bash -c '
        if [ ! -s /var/lib/postgresql/data/PG_VERSION ]; then
          pg_basebackup -h primary -U scouter -D /var/lib/postgresql/data -Fp -Xs -P -R
        fi
        chmod 0700 /var/lib/postgresql/data
        exec postgres -c hot_standby=on'
```

The primary needs one more thing before the standby can clone it:

**`deploy/sql-replication/00_allow_replication.sh`**

```bash
#!/bin/sh
# initdb writes a pg_hba.conf that permits replication connections from
# localhost only. A standby in another container is not localhost, so
# pg_basebackup gets "no pg_hba.conf entry for replication connection".
#
# `all` for the source address is fine on a compose network you control and
# nowhere else — in production this is a specific CIDR and a dedicated role
# with the REPLICATION attribute and nothing more.
set -e
echo "host replication all all scram-sha-256" >> "$PGDATA/pg_hba.conf"
```

```bash
chmod +x deploy/sql-replication/00_allow_replication.sh
```


```bash
cd ~/repos/pato/gravity-chamber/deploy
docker compose -f docker-compose.replica.yml up -d
sleep 15
docker compose -f docker-compose.replica.yml logs replica | tail -5
```

Verify the topology:

```bash
# on the primary: who's connected?
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter -c \
  "SELECT client_addr, state, sync_state, replay_lag FROM pg_stat_replication;"

# on the replica: am I in recovery?
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_is_in_recovery();"     -- must be t
```

### Step 2 — see replication work, then see it fail

```bash
# schema + a row on the primary
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter <<'SQL'
CREATE TABLE IF NOT EXISTS fighters (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  race TEXT NOT NULL DEFAULT 'unknown');
INSERT INTO fighters (name, race) VALUES ('goku','saiyan') ON CONFLICT DO NOTHING;
SQL

# it's on the replica within milliseconds
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT * FROM fighters;"

# and the replica is READ ONLY
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "INSERT INTO fighters (name) VALUES ('vegeta');"
# ERROR: cannot execute INSERT in a read-only transaction
```

That error is the contract. Your application must know which connection is
which — which is the next step.

### Step 3 — reproduce a read-your-writes bug

Create lag on purpose by pausing replay on the replica:

```bash
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_wal_replay_pause();"

# write to the primary
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter -c \
  "INSERT INTO fighters (name, race) VALUES ('trunks','half-saiyan');"

echo "--- primary ---"
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter -tAc \
  "SELECT count(*) FROM fighters;"
echo "--- replica ---"
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -tAc \
  "SELECT count(*) FROM fighters;"
```

Different answers, same instant. **This is the bug your users report as "I saved
it and it disappeared."** Now measure the lag:

```bash
PGPASSWORD=kamehameha psql -h localhost -p 5432 -U scouter -d scouter -c \
  "SELECT client_addr, replay_lag, sent_lsn, replay_lsn FROM pg_stat_replication;"
```

Resume and watch it converge:

```bash
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_wal_replay_resume();"
sleep 1
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -tAc \
  "SELECT count(*) FROM fighters;"
```

### Step 4 — read/write splitting in the app

**`internal/scouter/replicated.go`**

```go
package scouter

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// ReplicatedStore sends writes to the primary and reads to replicas,
// with read-your-writes protection: for a short window after a fighter is
// written, that fighter's reads are pinned to the primary.
type ReplicatedStore struct {
	primary  *PostgresStore
	replicas []*PostgresStore
	next     atomic.Uint64

	// recentWrites: fighter -> deadline until which reads must hit the primary.
	// A per-key map is a deliberate choice: pinning ALL reads to the primary
	// after ANY write would defeat the purpose of having replicas.
	mu           sync.RWMutex
	recentWrites map[string]time.Time
	window       time.Duration
}

var _ Store = (*ReplicatedStore)(nil)

func NewReplicatedStore(primary *PostgresStore, replicas []*PostgresStore, window time.Duration) *ReplicatedStore {
	s := &ReplicatedStore{
		primary:      primary,
		replicas:     replicas,
		recentWrites: make(map[string]time.Time),
		window:       window,
	}
	go s.reap()
	return s
}

// readFor picks primary or a replica, round-robin.
func (s *ReplicatedStore) readFor(fighter string) *PostgresStore {
	if len(s.replicas) == 0 {
		return s.primary
	}
	s.mu.RLock()
	until, pinned := s.recentWrites[fighter]
	s.mu.RUnlock()
	if pinned && time.Now().Before(until) {
		return s.primary // read-your-writes
	}
	i := s.next.Add(1)
	return s.replicas[int(i)%len(s.replicas)]
}

func (s *ReplicatedStore) Record(r Reading) {
	s.primary.Record(r)
	s.mu.Lock()
	s.recentWrites[r.Fighter] = time.Now().Add(s.window)
	s.mu.Unlock()
}

func (s *ReplicatedStore) Latest(fighter string) (Reading, bool) {
	return s.readFor(fighter).Latest(fighter)
}

// Leaderboard is not tied to one fighter, so it always reads a replica.
// That is a deliberate consistency trade: a leaderboard may be a second
// stale, and nobody will ever notice.
func (s *ReplicatedStore) Leaderboard(n int) []Reading {
	if len(s.replicas) == 0 {
		return s.primary.Leaderboard(n)
	}
	i := s.next.Add(1)
	return s.replicas[int(i)%len(s.replicas)].Leaderboard(n)
}

func (s *ReplicatedStore) Ping(ctx context.Context) error { return s.primary.Ping(ctx) }

func (s *ReplicatedStore) reap() {
	t := time.NewTicker(time.Minute)
	for range t.C {
		now := time.Now()
		s.mu.Lock()
		for k, v := range s.recentWrites {
			if now.After(v) {
				delete(s.recentWrites, k)
			}
		}
		s.mu.Unlock()
	}
}
```

Wire it in `main.go` behind `REPLICA_URLS`:

```go
	// in cmd/scouter/main.go, right after the primary pool is opened.
	// Unlike the shard case, you keep the primary AND the replicas: writes and
	// read-your-writes go to `pg`, everything else can be served stale.
	if urls := os.Getenv("REPLICA_URLS"); urls != "" {
		var replicas []*scouter.PostgresStore
		for _, dsn := range strings.Split(urls, ",") {
			r, err := scouter.NewPostgresStore(context.Background(), dsn)
			if err != nil {
				log.Error("replica unavailable", "err", err)
				os.Exit(1)
			}
			defer r.Close()
			replicas = append(replicas, r)
		}
		store = scouter.NewReplicatedStore(pg, replicas, 5*time.Second)
		log.Info("replicated store", "replicas", len(replicas))
	}
```

That `5*time.Second` is the read-your-writes window: how long after a write we
keep sending *that* fighter's reads to the primary. Too short and users see
their own write vanish; too long and the replicas stop earning their cost.
Measure your actual replication lag and set it well above the p99.

```bash
REPLICA_URLS="postgres://scouter:kamehameha@localhost:5435/scouter?sslmode=disable" \
DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable" \
  make run
```

Now repeat the pause-replay experiment while hitting your API:

```bash
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_wal_replay_pause();"

curl -s -XPOST localhost:8080/readings -d '{"fighter":"broly","power":1400000}' | jq
curl -s localhost:8080/fighters/broly | jq     # ✅ found — pinned to primary
curl -s localhost:8080/leaderboard | jq        # ⚠️ broly missing — replica is stale

PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_wal_replay_resume();"
```

**Both behaviours are correct**, and being able to say *why* each one is
acceptable is the actual skill. Write the reasoning in `NOTES.md`.

### Step 5 — failover, and what it costs

```bash
docker compose -f docker-compose.replica.yml stop primary

# reads still work
curl -s localhost:8080/leaderboard | jq 'length'

# writes do not
curl -s -XPOST localhost:8080/readings -d '{"fighter":"cell","power":900000}' | jq
```

Promote the replica:

```bash
docker compose -f docker-compose.replica.yml exec replica \
  psql -U scouter -d scouter -c "SELECT pg_promote();"

sleep 3
PGPASSWORD=kamehameha psql -h localhost -p 5435 -U scouter -d scouter -c \
  "SELECT pg_is_in_recovery();"   -- now f
```

Note what just happened, because it is the real lesson:

- Any writes that hadn't shipped before the primary died are **gone**. With
  async replication, failover means accepting data loss.
- The old primary can't just come back — it has diverged. It must be rebuilt
  (`pg_rewind` or a fresh basebackup). **Two primaries accepting writes is
  split-brain**, and it corrupts data in ways that are extremely painful to
  untangle.
- Something must decide *when* to promote. Promoting on a network blip when the
  old primary is alive is how you get split-brain, which is why real setups use
  a consensus-based manager (Patroni, or a managed service).

```bash
docker compose -f docker-compose.replica.yml down -v
```

---

## In GCP

**Cloud SQL HA** — a synchronous standby in another zone, automatic failover in
roughly 60 seconds, no data loss on failover. Roughly doubles the cost. Assume
it is required for anything production.

**Cloud SQL read replicas** — asynchronous, up to 10, can live in other regions,
and can be promoted for disaster recovery. Lag is exposed as
`replica_lag` in Cloud Monitoring. **Alert on it** — a replica quietly hours
behind is worse than no replica.

**AlloyDB** — one primary with read pools that scale independently; better for
mixed analytical/transactional workloads.

**Spanner** — synchronous multi-region replication via Paxos, externally
consistent, no failover to manage. From ~$65/month for the smallest production
instance.

**Firestore / Bigtable** — replicated automatically; Firestore offers strong
consistency for document reads and eventual for some query types. Read the
specific guarantees; they are not uniform.

**Multi-region is a decision about failure domains, not speed.** It costs
latency (~100 ms cross-continent), money (egress), and complexity. Do it when a
regional outage is genuinely unacceptable, not by default.

---

## Bring it to work

- **Alert on replication lag**, with a threshold tied to what your app tolerates.
- **Route explicitly.** A read/write split that "usually works" fails at the
  worst time. Make it a deliberate, visible decision per query.
- **Prefer designing away read-your-writes** — render the value you already have
  rather than re-reading.
- **Know your failover RPO.** "How much data do we lose if the primary dies right
  now?" should have a number, not a shrug.
- **Never allow two primaries.** Fencing and consensus, not heuristics.
- **Long queries on a replica delay replay.** A 10-minute analytics query can
  create 10 minutes of lag (or get cancelled by
  `max_standby_streaming_delay`). Know which you've configured.
- **Test failover before you need it.** A failover you've never rehearsed is a
  hypothesis.

---

## Battle drill

<details>
<summary><b>1.</b> Users report "I saved it but it's not there." How do you diagnose and fix it?</summary>

**Diagnose:** correlate reports with replication lag metrics. Check whether the
read path uses a replica. Reproduce by pausing replay (Step 3). Look for the
pattern "fails right after a write, succeeds 2 seconds later" — that's the
signature.

**Fix, cheapest first:**
1. **Don't re-read.** The write returned the new state; render it. Free.
2. **Pin that user's reads to the primary** for a few seconds after their write.
3. **LSN-based wait** — client keeps the write's log position; the replica waits
   to catch up. Precise but needs plumbing.
4. **Read from the primary** for that endpoint. Simple, costs leader capacity.

**Prevent:** decide per endpoint whether it tolerates staleness, and write it
down. "Leaderboard may be 5 s stale; a user's own profile may not" is a design
decision, not an accident.
</details>

<details>
<summary><b>2.</b> When is synchronous replication worth the latency?</summary>

When losing committed data is unacceptable: payments, ledgers, order placement,
anything with legal or financial consequence.

The cost is real — every commit waits for a network round trip plus the
follower's fsync, so write latency roughly doubles within a region and becomes
prohibitive across regions.

The middle grounds worth knowing: `synchronous_commit = on` with
`ANY 1 (s1, s2, s3)` so one slow follower doesn't stall writes; or *per-
transaction* settings, so the payment path is synchronous and the analytics
write isn't. That last one is usually the right answer — consistency is a
property you choose per operation, not per database.
</details>

<details>
<summary><b>3.</b> Explain PACELC to someone who "knows CAP".</summary>

CAP only describes behaviour *during a network partition*, which is rare. It
tells you nothing about the 99.99% of the time the network is fine, which is
where you actually live.

PACELC adds that branch: **if P**artitioned, choose **A** or **C**; **E**lse,
choose **L**atency or **C**onsistency.

That "else" is the real trade-off. Strong consistency requires coordination;
coordination requires round trips; round trips are latency you pay on every
request, every day. DynamoDB is PA/EL — available under partition, low latency
normally. Spanner is PC/EC — consistent always, and it pays latency for it.

The insight: **you're choosing latency-vs-consistency constantly, not just
during outages.**
</details>

<details>
<summary><b>4.</b> Your leaderboard is 30 seconds stale. Is that a bug?</summary>

It depends entirely on the *contract*, which is why the contract has to exist.

Ask: does anyone act on it in a way that matters? Is money or a prize involved?
Does the user see their own submission missing from it — because *that* is a
read-your-writes problem and will generate support tickets even if the ranking
itself is fine?

If 30 s is acceptable, say so explicitly, cache it aggressively (Capsule 14) and
**show the freshness in the UI** ("updated 12 seconds ago"). Surfacing staleness
converts a bug report into a feature.

If it isn't acceptable, that's a real requirement with real cost: read from the
primary, or maintain the ranking incrementally in Redis on every write.

The failure mode is having no answer — which means it's a bug the day someone
decides it is.
</details>

<details>
<summary><b>5.</b> What is split-brain and how do systems prevent it?</summary>

Two nodes both believe they're the primary and both accept writes. When they
reconcile, you have conflicting histories and no correct merge — this is one of
the few genuinely unrecoverable data-loss scenarios.

It happens when a *network* partition is mistaken for a *node* failure: the
follower can't reach the primary, assumes it's dead, promotes itself, while the
primary is happily serving another set of clients.

Prevention:
- **Quorum/consensus** — promotion requires a majority (Raft, Paxos). A minority
  partition mathematically cannot elect a leader.
- **Fencing / STONITH** — forcibly disable the old primary (revoke its storage
  lease, kill the VM) before promoting.
- **Leases with expiry** — leadership is time-bounded and must be renewed, so a
  partitioned leader stops accepting writes on its own.

This is precisely why you use a managed service or a consensus-based manager
rather than a shell script that pings the primary and promotes on failure.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Replica won't start | `pg_basebackup` needs `wal_level=replica` and a reachable primary. Check the replica logs first. |
| `FATAL: no pg_hba.conf entry for replication connection from host "172.x.x.x"` | The primary is refusing the clone. initdb's default `pg_hba.conf` allows replication from localhost only — that's what `sql-replication/00_allow_replication.sh` fixes. If you created the primary's volume before adding the script, `docker compose -f docker-compose.replica.yml down -v` and start again: `docker-entrypoint-initdb.d` runs **only** on an empty data directory. |
| `FATAL: data directory "/var/lib/postgresql/data" has invalid permissions` / `Permissions should be u=rwx (0700)` | Docker created the mount point `0755` and Postgres refuses to start on a group- or world-readable data directory. Hence `chmod 0700` after `pg_basebackup`. This is not a container quirk — it is the same check that bites a hand-rolled standby on a real host. |
| `cannot execute INSERT in a read-only transaction` | You routed a write to a replica. That's the guardrail working. |
| Lag grows without bound | A long query on the replica, insufficient replica resources, or a huge write burst. Check `pg_stat_activity` on the replica. |
| Replica queries cancelled | `max_standby_streaming_delay` exceeded — replay conflicts with your query. Raise it (more lag) or use `hot_standby_feedback` (bloat on the primary). |
| Promoted replica won't rejoin as a standby | It diverged. `pg_rewind` or a fresh basebackup. Never just restart it. |
| Both nodes accept writes | Split-brain. Stop everything, pick a survivor, rebuild the other. Then find out why promotion happened. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(store): read/write split with read-your-writes pinning

Capsule 13. Real streaming replica in compose. Reproduced stale reads by
pausing WAL replay. ReplicatedStore pins a fighter's reads to the primary
for a window after their write; leaderboard deliberately tolerates staleness.
Rehearsed failover and confirmed async replication means data loss."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 13
```

**Next:** [Capsule 14 · Senzu Bean — Caching Fundamentals](../14-senzu-bean-caching/README.md)
