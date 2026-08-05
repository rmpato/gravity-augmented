# Setup — outfitting the fighter

> *Bulma didn't get stronger. She built the things that made everyone else stronger.*

macOS, Linux, or Windows via WSL2. Every tool below is explained — you should
never install something you can't justify.

Run `./bin/doctor` at any point; it tells you exactly what's missing and the
command to fix it, adapted to your platform.

> **This page is the short path** — what Capsule 00 needs, and why.
> [`docs/tools.md`](tools.md) is the full reference: per-distro equivalents,
> WSL2 setup, Oh My Zsh, terminal config, and the quality-of-life tools.

---

## The package manager

**macOS — Homebrew**

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Linux** — use your distro's package manager. Homebrew on Linux also works and
gives you the same command names as the macOS instructions in every capsule.

**Windows** — install WSL2 first, then follow the Linux instructions from inside
it:

```powershell
wsl --install -d Ubuntu-24.04     # admin PowerShell, then reboot
```

Everything in every capsule then works unchanged. Two things to get right
immediately, both covered in [`docs/tools.md`](tools.md#windows-use-wsl2):
keep your repos in the **Linux** filesystem (`~/repos`, never `/mnt/c/...`), and
set `git config --global core.autocrlf input`.

---

## Required before Capsule 01

### Go (1.22 or newer)

The labs are written in Go. It compiles to a single static binary, which makes
containers trivially small and cold starts fast — that is precisely why so much
cloud infrastructure is written in it. You will learn the Go you need as you go;
no prior Go required.

```bash
brew install go
go version    # want 1.22+
```

> If you already have an old Go (1.19 or similar) from a `.pkg` install or a
> tarball in `/usr/local/go`, Homebrew's version may lose the PATH fight. Check
> with `which -a go`. Remove the old one (`sudo rm -rf /usr/local/go`) or put
> `/opt/homebrew/bin` ahead of `/usr/local/go/bin` in your `PATH`.

### A container runtime

You need Docker's CLI and a daemon behind it.

```bash
brew install --cask orbstack       # recommended on macOS
# or
brew install --cask docker         # Docker Desktop
```

**Why OrbStack over Docker Desktop on a Mac:** it starts in a couple of seconds
instead of a minute, uses noticeably less RAM and battery, and exposes the same
`docker` and `docker compose` commands. Nothing in this repo depends on which
one you pick. On Linux, install `docker-ce` + the `docker-compose-plugin` from
your distro and add yourself to the `docker` group.

Verify:

```bash
docker info | head -5
docker compose version
```

### make, git, curl

```bash
xcode-select --install     # macOS: gives you git, make, curl
```

---

## Strongly recommended

### Ghostty — your terminal

```bash
brew install --cask ghostty
```

A GPU-accelerated, native terminal that is fast enough that you stop noticing
it. The reason it matters here: you will spend these capsules with several
things running at once — a service, a database, a log tail, a load test — and a
terminal with good splits and instant redraw removes real friction.

Minimum useful config, `~/.config/ghostty/config`:

```
theme = catppuccin-mocha
font-family = JetBrains Mono
font-size = 13
window-padding-x = 8
window-padding-y = 8
copy-on-select = true
scrollback-limit = 100000
keybind = cmd+d=new_split:right
keybind = cmd+shift+d=new_split:down
```

```bash
brew install --cask font-jetbrains-mono
```

### lazydocker — a TUI for containers

```bash
brew install lazydocker
```

`docker ps`, `docker logs -f`, `docker stats`, `docker exec` and `docker compose
down` are five commands you will otherwise type a thousand times. `lazydocker`
is one command that shows all of it at once: containers, live logs, CPU/memory
graphs per container, and single-key restart/shell/remove.

From Capsule 02 onward, the instruction "watch what happens in lazydocker" is a
real part of the lab — the memory graph *is* the lesson in Capsule 05, and the
restart counter *is* the lesson in Capsule 16.

Keys worth knowing: `[`/`]` switch panels, `enter` inspect, `d` remove,
`r` restart, `E` exec a shell, `x` open the menu of everything else.

### direnv — per-directory environment

```bash
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc     # bash: direnv hook bash
```

Lets you put `export DATABASE_URL=...` in a `.envrc` inside your project and
have it loaded only while you're in that directory. This is how you keep
per-project config out of your global shell profile — a habit that scales
directly to real work, where you juggle several projects with conflicting
credentials.

---

## Installed later, when a capsule asks

Don't install these now. Each is introduced by the capsule that needs it, with
the reason.

| Tool | Capsule | Purpose |
|---|---|---|
| `jq` | 01 | Read JSON in the terminal without crying |
| `terraform` | 03 | Declarative infrastructure |
| `gcloud` | 04 | The Google Cloud CLI |
| `k6` | 08 | Load generation and latency percentiles |
| `psql` (`libpq`) | 09 | Talk to Postgres |
| `redis-cli` | 13 | Talk to Redis / Memorystore |
| `grpcurl` | 21 | Poke gRPC services |

---

## Optional quality-of-life

```bash
brew install fzf ripgrep bat htop watch httpie
```

- `fzf` — fuzzy finder; `Ctrl-R` over your shell history becomes genuinely good
- `ripgrep` (`rg`) — grep that is fast on large repos
- `bat` — `cat` with syntax highlighting and line numbers
- `htop` — process viewer, useful when you're deliberately saturating your CPU
- `watch` — re-run a command every N seconds; used in several load labs
- `httpie` (`http`) — friendlier `curl` for hand-testing APIs

---

## Shell setup

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
# Go binaries you install with `go install`
export PATH="$HOME/go/bin:$PATH"

# gravity-augmented shortcuts (adjust the path)
export GRAVITY="$HOME/repos/pato/gravity-augmented"
alias sc='"$GRAVITY"/bin/scouter'
alias lzd='lazydocker'
```

Then `sc status` from anywhere tells you where you are in the arc.

---

## Verify

```bash
cd "$GRAVITY"
./bin/doctor
```

Green on everything under **REQUIRED** means you're ready.
Anything under **NEEDED LATER** can stay red — the capsule will tell you.

---

Next: [`capsules/00-kame-house-setup/README.md`](../capsules/00-kame-house-setup/README.md)
