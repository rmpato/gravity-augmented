# Capsule 00 · Kame House — Setup, Tools & Your Own Repo

> *Nobody starts at Kami's Lookout. Everybody starts by delivering milk for
> Master Roshi and wondering what it has to do with fighting.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 1 (basic training) | 45 min | git, a terminal | Local |

---

## Why this capsule exists

The single most common reason people stall three weeks into learning
infrastructure is not difficulty — it's friction. A Go version that's wrong, a
Docker daemon that isn't running, a repo that was never created so there's
nowhere to put the work.

We remove all of it now, once. Then every remaining capsule is about ideas.

You also create **`gravity-chamber`** — your own repository. That repo is the
real output of this arc. In two months it will be a multi-service system with a
commit history that shows exactly how it got there. That history is worth more
in an interview than any certificate.

---

## The lore

Goku's training starts at Kame House with no combat at all: swimming, farming,
running with a turtle shell strapped to his back. When Roshi finally removes the
shell, Goku moves at a speed he could never have reached by practising punches.

This capsule is the shell. It looks like it isn't the point. It's the point.

---

## Part 1 — The toolchain

Run the doctor:

```bash
cd ~/repos/pato/gravity-augmented     # wherever you cloned this
./bin/doctor
```

Work down its **REQUIRED** list until it's green. Full explanations of every
tool and *why* it's there: [`docs/setup.md`](../../docs/setup.md), and the long
reference with Linux and Windows/WSL2 equivalents in
[`docs/tools.md`](../../docs/tools.md).

The short version:

```bash
brew install go jq                       # Go 1.22+, and jq for reading JSON
brew install --cask orbstack             # container runtime (or Docker Desktop)
brew install --cask ghostty              # terminal
brew install lazydocker                  # container TUI
brew install direnv                      # per-directory env vars
```

### The Go version trap

```bash
go version
which -a go
```

If you see 1.19 or older, or two `go` binaries, fix it now — several capsules
use `log/slog` (Go 1.21+) and `for range N` (1.22+). If `/usr/local/go/bin/go`
shadows Homebrew's, either remove the old install (`sudo rm -rf /usr/local/go`)
or put `/opt/homebrew/bin` first in `PATH`.

### Confirm Docker is actually running

```bash
docker run --rm hello-world
```

An error here is a daemon that isn't started, not a broken install. Open
OrbStack/Docker Desktop.

---

## Part 2 — Meet lazydocker

You'll be told to "watch it in lazydocker" a dozen times from Capsule 02 on.
Get familiar now.

```bash
docker run -d --name kame-house --rm nginx:alpine
lazydocker
```

Try:

| Key | Does |
|---|---|
| `[` `]` | move between panels (Containers / Images / Volumes / Logs / Stats) |
| `↑ ↓` | select a container |
| `enter` | inspect it |
| `E` | shell into it |
| `r` | restart |
| `d` | remove |
| `q` | quit |

Select `kame-house` and look at the **Logs** and **Stats** panels. Those two
panels replace roughly forty `docker logs -f` / `docker stats` invocations per
week. Quit and clean up:

```bash
docker stop kame-house
```

---

## Part 3 — Create the Gravity Chamber

This is your repo. Everything you build from here lives in it.

```bash
mkdir -p ~/repos/pato/gravity-chamber
cd ~/repos/pato/gravity-chamber
git init
```

Create the structure:

```bash
mkdir -p cmd/scouter internal docs/adr deploy scripts
```

| Path | Holds |
|---|---|
| `cmd/<name>/` | one directory per binary — the Go convention. `main.go` and nothing else |
| `internal/` | your actual code. Go refuses to let other modules import `internal/`, which makes it a real boundary, not a naming convention |
| `docs/adr/` | Architecture Decision Records — the *why* behind each choice |
| `deploy/` | Dockerfiles, compose files, Terraform |
| `scripts/` | anything you'd otherwise retype |

Now the files:

**`.gitignore`**
```gitignore
# secrets — never, ever
.env
.envrc
*.key
*-credentials.json
service-account*.json

# build output
/bin/
/dist/
*.exe

# terraform
.terraform/
*.tfstate
*.tfstate.*
*.tfvars

# local data
/data/
*.db

.DS_Store
```

**`README.md`**
```markdown
# gravity-chamber

My training ground for [Gravity Augmented](https://github.com/…) — GCP and
system design at scale.

Building **Scouter**: a service that records fighter power-level readings and
ranks them. It starts as one Go binary with a map in memory and ends as a
multi-service system with a database, cache, CDN, message bus and SLOs.

## Run it

    make run

## Capsule log

| Capsule | What changed |
|---|---|
| 00 | Repo scaffold |
```

**`NOTES.md`**
```markdown
# Notes

Three lines per capsule: what I learned, what surprised me, what I still don't get.
The "surprised me" line is the valuable one — surprise marks where my mental
model was wrong.

## Capsule 00 — Kame House
- 
- Surprised me: 
- Open question: 
```

**`Makefile`** — every project gets one. It's the answer to "how do I run this?"
that survives you leaving the team.

```makefile
.DEFAULT_GOAL := help

## run: run the service locally
run:
	go run ./cmd/scouter

## build: compile to ./bin
build:
	go build -o bin/scouter ./cmd/scouter

## test: run all tests
test:
	go test ./... -race -count=1

## fmt: format and tidy
fmt:
	go fmt ./...
	go mod tidy

## help: list targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | awk -F': ' '{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

.PHONY: run build test fmt help
```

> **Careful:** Makefile recipes require a **tab**, not spaces. If you get
> `Makefile:5: *** missing separator. Stop.`, that's what happened.

Initialise the Go module:

```bash
go mod init github.com/<your-username>/gravity-chamber
```

---

## Part 4 — Commit like it matters

Your history is a document. From now on, use conventional commits:

```
<type>(<scope>): <what changed, imperative mood>
```

Types you'll use: `feat` `fix` `perf` `refactor` `docs` `test` `chore`.

```bash
git add -A
git commit -m "chore(repo): scaffold gravity-chamber

Capsule 00. Go module, cmd/internal layout, Makefile, gitignore
covering secrets and terraform state."
```

Push it to GitHub if you like — a public `gravity-chamber` with 60 well-written
commits is a genuinely good artefact to point at.

---

## Checkpoint

```bash
cd ~/repos/pato/gravity-chamber

# 1. Go module exists and toolchain is modern
go version | grep -Eq 'go1\.(2[2-9]|[3-9][0-9])' && echo "go ok"
test -f go.mod && echo "module ok"

# 2. Structure is right
ls cmd/scouter internal docs/adr deploy scripts >/dev/null && echo "layout ok"

# 3. Secrets are ignored — this must print nothing
echo "SECRET=hunter2" > .env
git status --porcelain | grep '\.env' && echo "!! .env NOT ignored" || echo "gitignore ok"
rm .env

# 4. Make works
make help

# 5. One commit exists
git log --oneline
```

Everything printing `ok` and a commit in the log = done.

---

## Bring it to work

- **A `Makefile` (or `justfile`) at the repo root** is the cheapest onboarding
  document that exists. `make help` should answer "how do I run this?" for
  someone who joined today.
- **`.gitignore` covering secrets goes in the first commit**, not later. Once a
  credential is committed it has been cloned; the only real fix is rotating it.
- **`internal/`** is Go's one compiler-enforced module boundary. Use it — a
  boundary a linter enforces is worth ten a wiki describes.
- **Conventional commits** cost nothing and make `git log --oneline --grep=perf`
  a genuinely useful query two years later.

---

## Battle drill

<details>
<summary><b>1.</b> Why does <code>cmd/scouter/main.go</code> exist instead of just <code>main.go</code> at the root?</summary>

Because a repo grows more than one binary. By Capsule 22 you'll have
`cmd/scouter`, `cmd/ranker` and `cmd/notifier` sharing code in `internal/`. The
layout that supports three binaries costs nothing when you have one, and
retrofitting it later means moving every import path.
</details>

<details>
<summary><b>2.</b> A teammate commits an API key, notices, and force-pushes a rewritten history. Are you safe?</summary>

No. Assume it was cloned, cached by the forge, or picked up by a scanner within
seconds — GitHub keeps force-pushed objects reachable via the API, and public
repos are scraped continuously. **Rotate the credential.** History rewriting is
cleanup, not remediation. Treat "was it exposed?" as always yes.
</details>

<details>
<summary><b>3.</b> Why keep `NOTES.md` in the repo rather than a notes app?</summary>

Because it's diffable, greppable, and lives next to the code it describes. And
`git log -p NOTES.md` becomes a record of how your understanding changed — the
same reason ADRs (Capsule 22) are text files in the repo instead of wiki pages
nobody can find.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `go: command not found` | `brew install go`, then restart the shell. Check `echo $PATH` includes `/opt/homebrew/bin`. |
| Old Go wins the PATH fight | `which -a go`. Remove `/usr/local/go` or reorder PATH in `~/.zshrc`. |
| `Cannot connect to the Docker daemon` | The daemon isn't running. Launch OrbStack / Docker Desktop. |
| `Makefile: missing separator` | Recipe lines must start with a literal tab. Your editor converted it to spaces. |
| `go mod init` complains about the path | Any string works locally, but use `github.com/<you>/gravity-chamber` so it stays valid if you push. |

---

## Log it

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done 00
```

**Next:** [Capsule 01 · Scouter — Your First Service](../01-scouter-first-service/README.md)
