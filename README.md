# Gravity Augmented

**A hands-on training arc for Google Cloud and system design at scale.**

> *"The gravity in here is 100 times Earth's normal. If you can move under this, you can move anywhere."*
> — Vegeta, training in the Gravity Chamber

Real systems get heavy. Traffic multiplies, data outgrows one machine, one slow
dependency takes down five services. This repo turns that weight up slowly and
deliberately, one **Capsule** at a time, until load that would have crushed you
at the start feels like normal gravity.

You will finish with:

- **GCP: essentials → solid intermediate.** Projects, IAM, Cloud Run, Cloud SQL,
  Memorystore, Pub/Sub, Cloud Load Balancing, Cloud CDN, Cloud Monitoring,
  Artifact Registry, Terraform — and the judgement to pick between them.
- **System design: at least intermediate.** Caching, sharding, replication,
  consistency, queues and delivery semantics, backpressure, service boundaries,
  deploys, observability, and how to defend a design out loud.
- **A real system you built yourself,** in your own repo, commit by commit.

---

## The shape of the training

There are **27 Capsules**. Each one is a self-contained sitting of **45–95 minutes**
— the later ones are longer, and the eight longest carry a marked ⏸ stopping
point so you can split them across two evenings without leaving anything broken:
read the concept, do the lab, verify with a checkpoint, log it, close the laptop.
Nothing requires you to hold the previous week in your head.

Capsules are grouped into **Sagas**. You go in order — later capsules break things
that earlier capsules built, on purpose.

| Saga | Capsules | What you walk out with |
|---|---|---|
| **0 · Kame House** — Foundations | 00–04 | A running Go service, containerized, reproducible, and a correct mental model of GCP |
| **1 · Saiyan Saga** — Scaling & the edge | 05–09 | Vertical vs horizontal scaling, load balancers, reverse proxies and API gateways, and how to measure capacity |
| **2 · Namek Saga** — Data | 10–13 | Relational modelling, indexes, sharding, replication, consistency trade-offs |
| **3 · Frieza Saga** — Latency | 14–17 | Caching that survives contact with production, CDNs, rate limiting, backpressure |
| **4 · Cell Saga** — Async | 18–21 | Pub/Sub, delivery semantics, idempotency, fan-out, event-driven architecture |
| **5 · Buu Saga** — Operating it | 22–26 | Service boundaries, BFFs, safe deploys, observability, and a full capstone design |

### The Filler Arc (optional)

Seven extra capsules covering the fundamentals the main arc leans on. Every DBZ
fan knows the filler episodes aren't required viewing — but the ones where
somebody actually trains are worth it.

| # | Capsule | Do this one if… | Best before |
|---|---|---|---|
| B1 | **Kame House Rules** — REST API design essentials | you've built APIs by instinct and want the actual rules | 01 |
| B2 | **Snake Way** — HTTP & networking essentials | TLS, HTTP/2, keep-alive or DNS are fuzzy | 07 |
| B3 | **Fortuneteller Baba** — identity, auth & JWT | you're unsure when to use a JWT vs a session, or what OIDC actually is | 08 |
| B4 | **Ancient Namekian** — SQL essentials | your SQL stops at `SELECT … WHERE` | 10 |
| B5 | **Afterimage Technique** — concurrency in Go | goroutines, channels and `context` aren't second nature | 17 |
| B6 | **Reading Power Levels** — back-of-the-envelope estimation | "how many servers do we need?" makes you freeze | 26 |
| B7 | **Kami's Ledger** — GCP IAM, service accounts & Workload Identity | you can't yet explain what a service account *is* | 04 |
| B8 | **Namek's Five Minutes** — incident response & postmortems | you've never been on-call, or you have and it was awful | 25 |
| B9 | **Babidi's Spell** — security beyond auth | you know what a JWT is but not what SSRF is | 23 |
| B10 | **Instant Kamehameha** — Go for people who already program | you write another language and Go's syntax is in your way | 01 |
| B11 | **Turtle School** — Go basics & the daily toolchain | Go is one of your first languages, and `go vet` is a mystery | 01 |

They're worth **150** each. The main arc tops out at exactly 9000 — the Filler
Arc is literally how you get **over 9000**.

**Full capsule list:** [`docs/saga-map.md`](docs/saga-map.md)

---

## Three repos: this one teaches, yours trains, one is the answer key

```
gravity-augmented/            ← this repo. Read-only for you. The curriculum.
gravity-chamber/              ← YOUR repo. You create it in Capsule 00.
                                Every lab adds a commit here. By Capsule 25 it
                                is a multi-service system you can put on a CV.
gravity-chamber-reference/    ← a working build of the above, tagged per capsule.
                                For when you're stuck at 11pm — not before.
```

The reference has a `capsule-NN` tag for each capsule, so
`git diff capsule-13 capsule-14` shows you exactly what a capsule asks for,
without the prose. **Reach for it after you've been stuck properly**, not
instead of getting stuck — the struggle is where the learning is.

You are not going to copy-paste a finished app. You will build **Scouter** — a
service that records power-level readings and ranks fighters — starting as one
Go binary with an in-memory map, and ending as a set of services with a
database, a cache, a CDN, a message bus, traffic-split deploys and SLOs.

Every capsule tells you exactly which files to touch in `gravity-chamber`.

---

---

## Status: first release

You may well be the first person to run this end to end. The code is verified —
every Go snippet compiles, every embedded calculation was executed, and 21 of
the capsule labs were run against real containers rather than just written. What
has **not** been tested is the teaching: whether an explanation is clear to
someone who doesn't already know the answer.

That's the part you can see and the author can't. If a step assumes something it
never told you, or a lab leaves you stuck for the wrong reason, that's a bug —
please say so. It's the most useful thing you can send back.

## Start here

```bash
# 1. Check your machine has what it needs (it will tell you what's missing)
./bin/doctor

# 2. Read in the browser — sidebar, search, progress, six themes
./bin/serve

# …or stay in the terminal
./bin/scouter status
```

Either way, start with
[`capsules/00-kame-house-setup/README.md`](capsules/00-kame-house-setup/README.md).

---

## The reader

```bash
./bin/serve            # http://localhost:8420, opens your browser
./bin/serve 9000       # different port
./bin/serve --no-open  # don't launch a browser
```

Python 3 standard library only — no `pip install`, no `npm install`, no build
step. It serves the capsules as a small app: sidebar navigation, search (`/`),
`j`/`k` to move between capsules, copy buttons on every code block, and the six
Capsule Corp themes (Capsule, Goku, Piccolo, Bulma, Buu, Popo).

**Progress is the same file the CLI uses.** Mark a capsule complete in the
browser and `./bin/scouter status` shows the new power level immediately, and
vice versa. Nothing is stored in the browser except your theme choice.

---

## The Scouter (your progress tracker)

Power level is not a joke here — it is the progress bar. Capsules are worth
**340** each, the capstone **500**, and the whole arc is exactly **9000**.

```bash
./bin/scouter status              # power level + saga progress
./bin/scouter next                # what to do now, and where the file is
./bin/scouter start 03            # mark a capsule in progress
./bin/scouter done 03             # mark it complete, award power level
./bin/scouter list                # every capsule, with state
./bin/scouter review              # what you're about to forget — see below
./bin/scouter reset 03            # redo one
```

Progress lives in `.scouter/progress` (plain text, gitignored). No dependencies
beyond a POSIX shell.

### `scouter review` — the part that makes it stick

Finishing a capsule is not learning it. Without retrieval you lose most of it
inside a week, and rereading barely helps — it *feels* productive because the
text is familiar, which is exactly the illusion.

So `scouter` tracks when you completed each capsule and asks you to recall it
again at **3, 7 and 21 days**:

```bash
./bin/scouter review          # everything due, one drill question each
./bin/scouter review 03       # the full drill for that capsule, and log it
```

Answer out loud *before* you open anything. A wrong answer you committed to
teaches you more than a right one you read — you now know exactly which part of
your model was broken. `scouter status` tells you when something is due.

---

## Cost: this will not surprise you with a bill

Every lab runs **locally first** — Docker, Postgres, Redis, the Pub/Sub emulator,
the Firestore emulator. That is the default path and it costs nothing.

Where a capsule can teach something local tooling genuinely cannot, it adds a
clearly fenced optional section:

> ### ☁️ Optional: on real GCP
> Free-tier eligible. Teardown at the end. Skip this and you still complete the capsule.

Before you run a single `gcloud` command, do [`docs/gcp-safety.md`](docs/gcp-safety.md).
It sets up a budget alert, a hard-scoped project, and a teardown habit. Non-negotiable.

---

## What you need to know already

- **Git**: branch, commit, push. That's enough.
- **Terminal**: `cd`, pipes, editing a file. That's enough.
- Everything else — Go, Docker, SQL, Terraform, gcloud — is taught from zero
  *as it becomes necessary*, never as a prerequisite wall.

**Platforms:** macOS, Linux, and **Windows via WSL2** — inside WSL2 every command
in every capsule works verbatim, because you're in Ubuntu. See
[`docs/tools.md`](docs/tools.md) for the WSL2 setup and the five things Windows
users need to know (the big one: keep your code in the Linux filesystem, not
`/mnt/c`).

---

## Docs

| File | What it's for |
|---|---|
| [`docs/setup.md`](docs/setup.md) | The short path: install what Capsule 00 needs and verify it. |
| [`docs/tools.md`](docs/tools.md) | Every recommended tool, with macOS / Linux / Windows-WSL2 equivalents. Ghostty, lazydocker, Oh My Zsh, direnv, fzf, and why each one. |
| [`docs/saga-map.md`](docs/saga-map.md) | All 38 capsules, one line each. The map. |
| [`docs/scouter-codex.md`](docs/scouter-codex.md) | DBZ codename → real engineering term. Read this if a name confuses you. |
| [`docs/gcp-safety.md`](docs/gcp-safety.md) | Billing guardrails, free tier, teardown discipline. Do this before any cloud work. |
| [`docs/engineering-standards.md`](docs/engineering-standards.md) | The practices threaded through every capsule, in one place. Take these to work. |
| [`docs/how-this-works.md`](docs/how-this-works.md) | How to actually study this so it sticks. Read once, it's short. |

---

## Ground rules

1. **Do the lab.** Reading a capsule is not completing a capsule. The Scouter
   does not care what you have read.
2. **Break it on purpose.** Several capsules end by telling you to kill a
   container or fire 10× the traffic. That failure *is* the lesson.
3. **Commit in your own repo every capsule.** The message format is in
   `docs/engineering-standards.md`. The history is the proof of work.
4. **If a capsule runs 50% past its stated time, stop and open an issue against
   yourself in `gravity-chamber`.** Then move on. Ambiguity you can name is
   progress; ambiguity you sit in is not. Longer capsules carry a ⏸ marker —
   stopping there is finishing, not quitting.

---

*Dragon Ball Z is © Toei Animation / Shueisha / Akira Toriyama. This repository
is an unaffiliated, non-commercial educational project that borrows its
vocabulary out of pure affection.*
