# Recommended tools — macOS, Linux, Windows

> *Bulma's contribution to every arc is that she brings the right equipment.
> Nobody remembers her winning a fight; everyone would have died several times
> without her.*

Every tool here is justified — you should never install something you can't
explain. Nothing is mandatory except the **Required** section; the rest is
comfort, and comfort compounds over a two-month arc.

Run `./bin/doctor` at any point to see what you have and what's missing.

---

## Package managers

| OS | Manager | Install |
|---|---|---|
| **macOS** | Homebrew | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| **Debian/Ubuntu** | apt (+ Homebrew for newer versions) | built in |
| **Fedora/RHEL** | dnf | built in |
| **Arch** | pacman / yay | built in |
| **Windows** | winget or Scoop — **inside WSL2, use apt** | `winget` ships with Windows 11 |

> **Homebrew works on Linux too** (`/home/linuxbrew/.linuxbrew`), which means
> every `brew install` in these capsules works on Linux verbatim. If you'd rather
> use your distro's packages, the table below gives you both.

---

## Windows: use WSL2

This repo assumes a Unix shell. On Windows, **WSL2 is not a compromise — it's a
real Linux kernel**, and it's how most professional development on Windows now
happens.

```powershell
# in an ADMIN PowerShell
wsl --install -d Ubuntu-24.04
wsl --set-default-version 2
# reboot, then set your Linux username/password when Ubuntu launches
```

Then **everything in every capsule works unchanged** — you're in Ubuntu.

### The five things Windows users must know

**1. Keep your code in the Linux filesystem.**

```bash
# ✅ FAST — native ext4
~/repos/pato/gravity-chamber

# ❌ SLOW — every file access crosses the 9p protocol boundary.
#    Builds can be 10-20x slower. This is the #1 WSL2 mistake.
/mnt/c/Users/you/repos/gravity-chamber
```

**2. Docker Desktop with the WSL2 backend**, or install Docker directly inside
WSL2:

```bash
# inside WSL2 — no Docker Desktop needed, and lighter
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# then: wsl --shutdown  (from PowerShell) and reopen
```

Docker Desktop is fine and integrates with Windows; installing directly in WSL2
avoids the licence question for larger companies and uses less memory.

**3. Cap WSL2's memory.** By default it will take most of your RAM.
Create `C:\Users\<you>\.wslconfig`:

```ini
[wsl2]
memory=8GB
processors=4
swap=2GB
localhostForwarding=true
```

Then `wsl --shutdown` from PowerShell.

**4. `localhost` works both ways.** A service on `:8080` inside WSL2 is
reachable at `http://localhost:8080` from a Windows browser. This is why the
capsules' `curl localhost:8080` instructions work as written.

**5. Line endings.** Configure git once, or `.sh` scripts fail with
`bad interpreter: /bin/bash^M`:

```bash
git config --global core.autocrlf input
```

### Windows-native, without WSL2

Possible but not supported here. Go, Docker Desktop and gcloud all have native
Windows builds, and PowerShell can run most single commands. What breaks: the
`bin/scouter` and `bin/doctor` bash scripts, heredocs, `make`, and the shell
loops in most labs.

If you must: use **Git Bash** for the scripts, or **PowerShell 7** plus
`winget install GnuWin32.Make`. Expect to translate.

**The web reader works natively on Windows** — `python bin/serve` needs only
Python 3, so you can read capsules in a Windows browser regardless.

---

## Required (Capsule 00)

| Tool | macOS | Debian/Ubuntu | Fedora | Arch | Why |
|---|---|---|---|---|---|
| **Go 1.22+** | `brew install go` | `sudo apt install golang-go`¹ | `sudo dnf install golang` | `sudo pacman -S go` | Every lab is Go |
| **Docker** | `brew install --cask orbstack` | `curl -fsSL https://get.docker.com \| sh` | same | `sudo pacman -S docker docker-compose` | Containers, Postgres, Redis, emulators |
| **git** | `xcode-select --install` | `sudo apt install git` | `sudo dnf install git` | `sudo pacman -S git` | — |
| **make** | `xcode-select --install` | `sudo apt install build-essential` | `sudo dnf install make` | `sudo pacman -S base-devel` | Every project's front door |
| **curl, jq** | `brew install jq` | `sudo apt install curl jq` | `sudo dnf install curl jq` | `sudo pacman -S curl jq` | Hitting and reading APIs |
| **Python 3** | preinstalled | `sudo apt install python3` | preinstalled | `sudo pacman -S python` | The web reader, estimation scripts |

¹ Ubuntu's `golang-go` is often behind. For a current Go:
```bash
sudo rm -rf /usr/local/go
curl -fsSL https://go.dev/dl/go1.23.5.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc
```

---

## Terminal

| | macOS | Linux | Windows |
|---|---|---|---|
| **First choice** | **Ghostty** | **Ghostty** | **Windows Terminal** (built in) |
| Also excellent | WezTerm, Kitty, iTerm2 | WezTerm, Kitty, Alacritty | WezTerm |

```bash
brew install --cask ghostty                 # macOS
# Linux: package available for most distros, or build from source
# Windows: Windows Terminal is already installed and is genuinely good
```

**Why a fast terminal matters here specifically:** several capsules have you
running a service, a database, a log tail and a load test simultaneously. Splits
that open instantly and a renderer that doesn't stutter under a firehose of JSON
logs removes real friction from a two-month arc.

**Ghostty config** — `~/.config/ghostty/config`:

```
theme = catppuccin-mocha
font-family = JetBrains Mono
font-size = 13
window-padding-x = 8
window-padding-y = 8
copy-on-select = true
scrollback-limit = 100000
confirm-close-surface = false

keybind = cmd+d=new_split:right
keybind = cmd+shift+d=new_split:down
keybind = cmd+shift+enter=toggle_split_zoom
```

**Windows Terminal** — the equivalent settings live in Settings → JSON:
`"defaultProfile"` set to your WSL distro, `"font": {"face": "JetBrains Mono"}`,
and `alt+shift+d` splits by default.

**A font with ligatures and good glyph coverage** (the capsules use box-drawing
characters heavily in diagrams):

```bash
brew install --cask font-jetbrains-mono     # macOS
sudo apt install fonts-jetbrains-mono       # Debian/Ubuntu
# Windows: winget install JetBrains.Mono, or download a Nerd Font
```

Use a **Nerd Font** variant if you want icons in your prompt.

---

## Shell

**zsh** is the default on macOS and available everywhere. **fish** is friendlier
out of the box. **bash** is fine — the capsules' scripts target bash 3.2+ so they
work on stock macOS.

### Oh My Zsh

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

Honest assessment: Oh My Zsh's value is the **plugin ecosystem and sane
defaults**, not the themes. It can noticeably slow shell startup if you enable
twenty plugins. A lean config is better than a maximal one.

**A config that earns its keep** — `~/.zshrc`:

```bash
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"           # fast. Use powerlevel10k if you want more

plugins=(
  git                    # gst, gco, gcm, glog… learn 5 and you'll use them daily
  docker                 # completions for docker and compose
  docker-compose
  gcloud                 # completions for gcloud
  golang
  kubectl
  zsh-autosuggestions    # ghost-text completion from history. The best one
  zsh-syntax-highlighting # commands turn red BEFORE you run them
  fzf                    # ctrl-r becomes fuzzy history search
)

source $ZSH/oh-my-zsh.sh
```

The two plugins that aren't bundled:

```bash
git clone https://github.com/zsh-users/zsh-autosuggestions \
  ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting \
  ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
```

> **`zsh-autosuggestions` and `zsh-syntax-highlighting` are the two that
> genuinely change how you work.** Autosuggestions surfaces your own history as
> you type; syntax highlighting shows a command in red before you press enter.
> If you install nothing else, install those.

### Alternatives to Oh My Zsh

- **Starship** — a cross-shell prompt, very fast, works with zsh/bash/fish/
  PowerShell: `brew install starship`, then `eval "$(starship init zsh)"`.
  Pairs well with a *minimal* zsh config and no framework.
- **Zinit / antidote** — plugin managers with lazy loading if OMZ startup time
  bothers you.
- **fish** — excellent defaults with no framework at all. Not POSIX, so scripts
  need `bash script.sh`.

### Shell additions for this repo

```bash
export GRAVITY="$HOME/repos/pato/gravity-augmented"
alias sc='"$GRAVITY"/bin/scouter'
alias garead='"$GRAVITY"/bin/serve'
alias lzd='lazydocker'
alias dc='docker compose'
export PATH="$HOME/go/bin:$PATH"
```

---

## Container tooling

### lazydocker — the one to install

```bash
brew install lazydocker                                   # macOS / Linuxbrew
# or: curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash
```

Replaces `docker ps`, `docker logs -f`, `docker stats`, `docker exec` and
`docker compose down` with one screen. From Capsule 02 onward, "watch it in
lazydocker" is a real instruction — the **Stats** panel *is* the lesson in
Capsule 05, and the restart counter *is* the lesson in Capsule 17.

Keys: `[` `]` panels · `enter` inspect · `E` shell · `r` restart · `d` remove ·
`x` menu.

### Runtime

| Platform | Recommended | Alternative |
|---|---|---|
| macOS | **OrbStack** (fast, light, low battery) | Docker Desktop, Colima, Podman |
| Linux | **docker-ce** (native, no VM) | Podman (daemonless, rootless) |
| Windows | **Docker Desktop + WSL2 backend** | docker-ce inside WSL2 |

**Colima** is a good middle ground on macOS if you want a CLI-only, open-source
option: `brew install colima && colima start`.

---

## Installed later, when a capsule asks

Don't install these now — each capsule introduces its tool with the reason.

| Tool | Capsule | macOS | Linux |
|---|---|---|---|
| `terraform` | 03 | `brew install terraform` | HashiCorp apt/dnf repo |
| `gcloud` | 04 | `brew install --cask google-cloud-sdk` | `curl https://sdk.cloud.google.com \| bash` |
| `k6` | 09 | `brew install k6` | Grafana apt/dnf repo |
| `psql` | 10 | `brew install libpq` | `sudo apt install postgresql-client` |
| `redis-cli` | 14 | `brew install redis` | `sudo apt install redis-tools` |
| `grpcurl` | 22 | `brew install grpcurl` | `go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest` |

`go install` works identically on every platform and is often the simplest route
for Go-based tools.

---

## Quality of life

```bash
brew install fzf ripgrep bat eza fd zoxide htop watch httpie direnv delta gh
```

| Tool | Replaces | Why |
|---|---|---|
| **fzf** | `Ctrl-R` | Fuzzy history and file search. Probably the highest-value install here |
| **ripgrep** (`rg`) | `grep -r` | Fast on large repos, respects `.gitignore` |
| **bat** | `cat` | Syntax highlighting, line numbers, paging |
| **eza** | `ls` | Colours, git status, tree view |
| **fd** | `find` | A sane interface to a famously unfriendly command |
| **zoxide** | `cd` | `z gravity` jumps to the directory you use most |
| **htop** | `top` | Readable, and you'll saturate CPUs in Capsule 05 |
| **watch** | — | `watch -n1 'curl -s localhost:8080/cache-stats \| jq'` |
| **httpie** (`http`) | `curl` | Friendlier for hand-testing APIs |
| **direnv** | — | Per-directory env vars. Keeps project credentials out of your global shell |
| **delta** | `git diff` | Genuinely readable diffs, side by side |
| **gh** | — | GitHub from the terminal: `gh pr create`, `gh repo view` |

**direnv setup** — worth doing, it's used from Capsule 03:

```bash
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc     # bash: direnv hook bash
```

Then in `gravity-chamber/.envrc` (already gitignored):

```bash
export DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable"
export REDIS_ADDR="localhost:6379"
export PUBSUB_EMULATOR_HOST="localhost:8085"
export LOG_LEVEL="debug"
```

`direnv allow` once, and those exist only inside that directory. This is a real
work habit — it's how you juggle three projects with conflicting credentials
without polluting your profile.

---

## Editor

Anything you already know. If you want a recommendation:

- **VS Code** + the official **Go** extension (`gopls`), **Docker**, **Even
  Better TOML**, **HashiCorp Terraform**. On Windows, install the **WSL**
  extension and open the folder *inside* WSL — this is important, it runs the
  language server on the Linux side.
- **Neovim** + `nvim-lspconfig` with `gopls`, or a distribution like LazyVim.
- **GoLand** if you want everything configured for you.

**Enable format-on-save with `gofmt`/`goimports`.** Go has one canonical format;
arguing about it is time you won't get back.

---

## The five-minute version

```bash
# macOS
brew install go jq lazydocker direnv fzf ripgrep bat
brew install --cask orbstack ghostty font-jetbrains-mono

# Debian / Ubuntu (incl. WSL2)
sudo apt update && sudo apt install -y build-essential git curl jq python3 fzf ripgrep bat direnv
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
curl -fsSL https://go.dev/dl/go1.23.5.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc

# then, on any platform
cd gravity-augmented && ./bin/doctor
```
