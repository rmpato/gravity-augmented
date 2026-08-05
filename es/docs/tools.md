# Herramientas recomendadas — macOS, Linux, Windows

> *El aporte de Bulma en cada arco es que trae el equipo correcto. Nadie se
> acuerda de que haya ganado una pelea; sin ella se habrían muerto todos varias
> veces.*

Cada herramienta acá está justificada — nunca deberías instalar algo que no
podés explicar. Nada es obligatorio salvo la sección **Requerido**; el resto es
comodidad, y la comodidad se acumula a lo largo de un arco de dos meses.

Corré `./bin/doctor` en cualquier momento para ver qué tenés y qué falta.

---

## Gestores de paquetes

| SO | Gestor | Instalación |
|---|---|---|
| **macOS** | Homebrew | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| **Debian/Ubuntu** | apt (+ Homebrew para versiones nuevas) | ya viene |
| **Fedora/RHEL** | dnf | ya viene |
| **Arch** | pacman / yay | ya viene |
| **Windows** | winget o Scoop — **dentro de WSL2, usá apt** | `winget` viene con Windows 11 |

> **Homebrew también funciona en Linux** (`/home/linuxbrew/.linuxbrew`), lo que
> significa que cada `brew install` de las cápsulas anda igual en Linux. Si
> preferís los paquetes de tu distro, la tabla de abajo te da los dos.

---

## Windows: usá WSL2

Este repo asume un shell Unix. En Windows, **WSL2 no es un parche — es un kernel
Linux real**, y es como se hace hoy la mayor parte del desarrollo profesional en
Windows.

```powershell
# en un PowerShell como ADMINISTRADOR
wsl --install -d Ubuntu-24.04
wsl --set-default-version 2
# reiniciá, después poné tu usuario/contraseña de Linux cuando arranque Ubuntu
```

Y ahí **todo en cada cápsula funciona sin cambios** — estás en Ubuntu.

### Las cinco cosas que un usuario de Windows tiene que saber

**1. Guardá tu código en el filesystem de Linux.**

```bash
# ✅ RÁPIDO — ext4 nativo
~/repos/pato/gravity-chamber

# ❌ LENTO — cada acceso a archivo cruza el protocolo 9p.
#    Los builds pueden ser 10-20x más lentos. Este es el error #1 de WSL2.
/mnt/c/Users/vos/repos/gravity-chamber
```

**2. Docker Desktop con backend WSL2**, o instalá Docker directamente adentro de
WSL2:

```bash
# dentro de WSL2 — sin Docker Desktop, y más liviano
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# después: wsl --shutdown  (desde PowerShell) y volvé a abrir
```

Docker Desktop está bien y se integra con Windows; instalarlo directo en WSL2
evita la cuestión de licencia para empresas grandes y usa menos memoria.

**3. Limitá la memoria de WSL2.** Por defecto se toma casi toda tu RAM.
Creá `C:\Users\<vos>\.wslconfig`:

```ini
[wsl2]
memory=8GB
processors=4
swap=2GB
localhostForwarding=true
```

Después `wsl --shutdown` desde PowerShell.

**4. `localhost` funciona en los dos sentidos.** Un servicio en `:8080` adentro
de WSL2 se ve en `http://localhost:8080` desde un navegador de Windows. Por eso
las instrucciones `curl localhost:8080` de las cápsulas funcionan tal cual.

**5. Finales de línea.** Configurá git una vez, o los scripts `.sh` van a fallar
con `bad interpreter: /bin/bash^M`:

```bash
git config --global core.autocrlf input
```

### Windows nativo, sin WSL2

Es posible pero no está soportado acá. Go, Docker Desktop y gcloud tienen builds
nativos de Windows, y PowerShell puede correr la mayoría de los comandos sueltos.
Lo que se rompe: los scripts bash `bin/scouter` y `bin/doctor`, los heredocs,
`make`, y los loops de shell de casi todos los labs.

Si no te queda otra: usá **Git Bash** para los scripts, o **PowerShell 7** más
`winget install GnuWin32.Make`. Esperá tener que traducir cosas.

**El lector web sí funciona nativo en Windows** — `python bin/serve` solo
necesita Python 3, así que podés leer las cápsulas en un navegador de Windows sin
importar nada de lo anterior.

---

## Requerido (Cápsula 00)

| Herramienta | macOS | Debian/Ubuntu | Fedora | Arch | Por qué |
|---|---|---|---|---|---|
| **Go 1.22+** | `brew install go` | `sudo apt install golang-go`¹ | `sudo dnf install golang` | `sudo pacman -S go` | Todos los labs son en Go |
| **Docker** | `brew install --cask orbstack` | `curl -fsSL https://get.docker.com \| sh` | igual | `sudo pacman -S docker docker-compose` | Containers, Postgres, Redis, emuladores |
| **git** | `xcode-select --install` | `sudo apt install git` | `sudo dnf install git` | `sudo pacman -S git` | — |
| **make** | `xcode-select --install` | `sudo apt install build-essential` | `sudo dnf install make` | `sudo pacman -S base-devel` | La puerta de entrada de todo proyecto |
| **curl, jq** | `brew install jq` | `sudo apt install curl jq` | `sudo dnf install curl jq` | `sudo pacman -S curl jq` | Pegarle a APIs y leerlas |
| **Python 3** | ya viene | `sudo apt install python3` | ya viene | `sudo pacman -S python` | El lector web, los scripts de estimación |

¹ El `golang-go` de Ubuntu suele estar atrasado. Para un Go actual:
```bash
sudo rm -rf /usr/local/go
curl -fsSL https://go.dev/dl/go1.23.5.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc
```

---

## Terminal

| | macOS | Linux | Windows |
|---|---|---|---|
| **Primera opción** | **Ghostty** | **Ghostty** | **Windows Terminal** (ya viene) |
| También excelentes | WezTerm, Kitty, iTerm2 | WezTerm, Kitty, Alacritty | WezTerm |

```bash
brew install --cask ghostty                 # macOS
# Linux: hay paquete para la mayoría de las distros, o compilá desde fuente
# Windows: Windows Terminal ya está instalado y es genuinamente bueno
```

**Por qué importa una terminal rápida acá específicamente:** varias cápsulas te
hacen correr un servicio, una base de datos, un tail de logs y un load test al
mismo tiempo. Splits que abren al instante y un renderer que no se traba con una
manguera de logs JSON eliminan fricción real en un arco de dos meses.

**Config de Ghostty** — `~/.config/ghostty/config`:

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

**Windows Terminal** — los equivalentes están en Settings → JSON:
`"defaultProfile"` apuntando a tu distro de WSL, `"font": {"face": "JetBrains
Mono"}`, y `alt+shift+d` para dividir (viene por defecto).

**Una tipografía con ligaduras y buena cobertura de glifos** (las cápsulas usan
mucho carácter de dibujo de cajas en los diagramas):

```bash
brew install --cask font-jetbrains-mono     # macOS
sudo apt install fonts-jetbrains-mono       # Debian/Ubuntu
# Windows: winget install JetBrains.Mono, o bajate una Nerd Font
```

Usá una variante **Nerd Font** si querés íconos en el prompt.

---

## Shell

**zsh** es el default en macOS y está disponible en todos lados. **fish** es más
amigable de fábrica. **bash** está bien — los scripts de las cápsulas apuntan a
bash 3.2+ así que funcionan con el bash de macOS.

### Oh My Zsh

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

Evaluación honesta: el valor de Oh My Zsh es el **ecosistema de plugins y los
defaults sensatos**, no los themes. Puede hacer notablemente más lento el
arranque del shell si habilitás veinte plugins. Una config flaca es mejor que una
máxima.

**Una config que se gana el lugar** — `~/.zshrc`:

```bash
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"           # rápido. Usá powerlevel10k si querés más

plugins=(
  git                    # gst, gco, gcm, glog… aprendé 5 y los usás todos los días
  docker                 # autocompletado de docker y compose
  docker-compose
  gcloud                 # autocompletado de gcloud
  golang
  kubectl
  zsh-autosuggestions    # completado fantasma desde tu historial. El mejor
  zsh-syntax-highlighting # los comandos se ponen rojos ANTES de ejecutarlos
  fzf                    # ctrl-r se convierte en búsqueda difusa del historial
)

source $ZSH/oh-my-zsh.sh
```

Los dos plugins que no vienen incluidos:

```bash
git clone https://github.com/zsh-users/zsh-autosuggestions \
  ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting \
  ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
```

> **`zsh-autosuggestions` y `zsh-syntax-highlighting` son los dos que
> genuinamente cambian cómo trabajás.** El primero te muestra tu propio historial
> mientras escribís; el segundo te pinta un comando de rojo antes de que aprietes
> enter. Si no instalás nada más, instalá esos dos.

### Alternativas a Oh My Zsh

- **Starship** — un prompt multi-shell, muy rápido, funciona con
  zsh/bash/fish/PowerShell: `brew install starship`, después
  `eval "$(starship init zsh)"`. Combina bien con un zsh *mínimo* y sin framework.
- **Zinit / antidote** — gestores de plugins con carga diferida si te molesta el
  tiempo de arranque de OMZ.
- **fish** — excelentes defaults sin ningún framework. No es POSIX, así que los
  scripts necesitan `bash script.sh`.

### Agregados de shell para este repo

```bash
export GRAVITY="$HOME/repos/pato/gravity-augmented"
alias sc='"$GRAVITY"/bin/scouter'
alias garead='"$GRAVITY"/bin/serve'
alias lzd='lazydocker'
alias dc='docker compose'
export PATH="$HOME/go/bin:$PATH"
```

---

## Tooling de containers

### lazydocker — el que sí hay que instalar

```bash
brew install lazydocker                                   # macOS / Linuxbrew
# o: curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash
```

Reemplaza `docker ps`, `docker logs -f`, `docker stats`, `docker exec` y
`docker compose down` con una sola pantalla. Desde la Cápsula 02, "mirá qué pasa
en lazydocker" es una instrucción real — el panel de **Stats** *es* la lección de
la Cápsula 05, y el contador de restarts *es* la lección de la Cápsula 17.

Teclas: `[` `]` paneles · `enter` inspeccionar · `E` shell · `r` reiniciar ·
`d` eliminar · `x` menú.

### Runtime

| Plataforma | Recomendado | Alternativa |
|---|---|---|
| macOS | **OrbStack** (rápido, liviano, poca batería) | Docker Desktop, Colima, Podman |
| Linux | **docker-ce** (nativo, sin VM) | Podman (sin daemon, rootless) |
| Windows | **Docker Desktop + backend WSL2** | docker-ce dentro de WSL2 |

**Colima** es un buen término medio en macOS si querés algo solo-CLI y open
source: `brew install colima && colima start`.

---

## Se instalan después, cuando una cápsula lo pida

No los instales ahora — cada cápsula presenta su herramienta con el motivo.

| Herramienta | Cápsula | macOS | Linux |
|---|---|---|---|
| `terraform` | 03 | `brew install terraform` | repo apt/dnf de HashiCorp |
| `gcloud` | 04 | `brew install --cask google-cloud-sdk` | `curl https://sdk.cloud.google.com \| bash` |
| `k6` | 09 | `brew install k6` | repo apt/dnf de Grafana |
| `psql` | 10 | `brew install libpq` | `sudo apt install postgresql-client` |
| `redis-cli` | 14 | `brew install redis` | `sudo apt install redis-tools` |
| `grpcurl` | 22 | `brew install grpcurl` | `go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest` |

`go install` funciona igual en todas las plataformas y suele ser el camino más
simple para herramientas escritas en Go.

---

## Calidad de vida

```bash
brew install fzf ripgrep bat eza fd zoxide htop watch httpie direnv delta gh
```

| Herramienta | Reemplaza | Por qué |
|---|---|---|
| **fzf** | `Ctrl-R` | Búsqueda difusa de historial y archivos. Probablemente lo de mayor valor de esta lista |
| **ripgrep** (`rg`) | `grep -r` | Rápido en repos grandes, respeta `.gitignore` |
| **bat** | `cat` | Syntax highlighting, números de línea, paginado |
| **eza** | `ls` | Colores, estado de git, vista de árbol |
| **fd** | `find` | Una interfaz sensata para un comando famosamente hostil |
| **zoxide** | `cd` | `z gravity` te lleva al directorio que más usás |
| **htop** | `top` | Legible, y vas a saturar CPUs en la Cápsula 05 |
| **watch** | — | `watch -n1 'curl -s localhost:8080/cache-stats \| jq'` |
| **httpie** (`http`) | `curl` | Más amigable para probar APIs a mano |
| **direnv** | — | Variables de entorno por directorio. Mantiene las credenciales del proyecto fuera de tu shell global |
| **delta** | `git diff` | Diffs genuinamente legibles, lado a lado |
| **gh** | — | GitHub desde la terminal: `gh pr create`, `gh repo view` |

**Setup de direnv** — vale la pena, se usa desde la Cápsula 03:

```bash
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc     # bash: direnv hook bash
```

Después, en `gravity-chamber/.envrc` (ya está en el gitignore):

```bash
export DATABASE_URL="postgres://scouter:kamehameha@localhost:5432/scouter?sslmode=disable"
export REDIS_ADDR="localhost:6379"
export PUBSUB_EMULATOR_HOST="localhost:8085"
export LOG_LEVEL="debug"
```

`direnv allow` una vez, y esas variables existen solo dentro de ese directorio.
Este es un hábito real de trabajo — es cómo manejás tres proyectos con
credenciales que se pisan sin ensuciar tu perfil.

---

## Editor

El que ya sepas usar. Si querés una recomendación:

- **VS Code** + la extensión oficial de **Go** (`gopls`), **Docker**, **Even
  Better TOML**, **HashiCorp Terraform**. En Windows, instalá la extensión
  **WSL** y abrí la carpeta *dentro* de WSL — esto es importante, hace que el
  language server corra del lado de Linux.
- **Neovim** + `nvim-lspconfig` con `gopls`, o una distribución tipo LazyVim.
- **GoLand** si querés todo configurado de fábrica.

**Activá format-on-save con `gofmt`/`goimports`.** Go tiene un único formato
canónico; discutirlo es tiempo que no recuperás.

---

## La versión de cinco minutos

```bash
# macOS
brew install go jq lazydocker direnv fzf ripgrep bat
brew install --cask orbstack ghostty font-jetbrains-mono

# Debian / Ubuntu (incluido WSL2)
sudo apt update && sudo apt install -y build-essential git curl jq python3 fzf ripgrep bat direnv
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
curl -fsSL https://go.dev/dl/go1.23.5.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc

# después, en cualquier plataforma
cd gravity-augmented && ./bin/doctor
```
