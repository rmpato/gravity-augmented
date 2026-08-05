# Setup — equipar al peleador

> *Bulma nunca se hizo más fuerte. Construyó las cosas que hicieron más fuertes a
> todos los demás.*

macOS, Linux, o Windows vía WSL2. Cada herramienta acá abajo está justificada —
nunca deberías instalar algo que no podés explicar.

Corré `./bin/doctor` en cualquier momento; te dice exactamente qué falta y el
comando para arreglarlo, adaptado a tu plataforma.

> **Esta página es el camino corto** — lo que necesita la Cápsula 00, y por qué.
> [`docs/tools.md`](tools.md) es la referencia completa: equivalentes por distro,
> setup de WSL2, Oh My Zsh, config de terminal y las herramientas de comodidad.

---

## El gestor de paquetes

**macOS — Homebrew**

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Linux** — usá el gestor de tu distro. Homebrew en Linux también funciona y te
da los mismos nombres de comando que las instrucciones de macOS en todas las
cápsulas.

**Windows** — instalá WSL2 primero y después seguí las instrucciones de Linux
desde adentro:

```powershell
wsl --install -d Ubuntu-24.04     # PowerShell como admin, después reiniciá
```

A partir de ahí, todo en todas las cápsulas funciona tal cual. Dos cosas para
hacer bien enseguida, ambas explicadas en
[`docs/tools.md`](tools.md#windows-usá-wsl2): guardá tus repos en el filesystem
de **Linux** (`~/repos`, nunca `/mnt/c/...`), y configurá
`git config --global core.autocrlf input`.

---

## Requerido antes de la Cápsula 01

### Go (1.22 o más nuevo)

Los labs están escritos en Go. Compila a un solo binario estático, lo que hace
que los containers sean minúsculos y los cold starts rápidos — que es justamente
por qué tanta infraestructura de nube está escrita en Go. Vas a aprender el Go
que necesitás sobre la marcha; no hace falta saber nada de antes.

```bash
brew install go
go version    # querés 1.22+
```

> Si ya tenés un Go viejo (1.19 o similar) de un `.pkg` o de un tarball en
> `/usr/local/go`, la versión de Homebrew puede perder la pelea del PATH.
> Verificá con `which -a go`. Sacá el viejo (`sudo rm -rf /usr/local/go`) o poné
> `/opt/homebrew/bin` antes de `/usr/local/go/bin` en tu `PATH`.

### Un runtime de containers

Necesitás la CLI de Docker y un daemon detrás.

```bash
brew install --cask orbstack       # recomendado en macOS
# o
brew install --cask docker         # Docker Desktop
```

**Por qué OrbStack sobre Docker Desktop en una Mac:** arranca en un par de
segundos en vez de un minuto, usa bastante menos RAM y batería, y expone los
mismos comandos `docker` y `docker compose`. Nada en este repo depende de cuál
elijas. En Linux, instalá `docker-ce` + el plugin `docker-compose-plugin` de tu
distro y agregate al grupo `docker`.

Verificá:

```bash
docker info | head -5
docker compose version
```

### make, git, curl

```bash
xcode-select --install     # macOS: te da git, make, curl
```

---

## Muy recomendado

### Ghostty — tu terminal

```bash
brew install --cask ghostty
```

Una terminal nativa acelerada por GPU, lo bastante rápida como para que dejes de
notarla. Por qué importa acá: vas a pasar estas cápsulas con varias cosas
corriendo a la vez — un servicio, una base de datos, un tail de logs, un load
test — y una terminal con buenos splits y redibujado instantáneo elimina
fricción real.

Configuración mínima útil, `~/.config/ghostty/config`:

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

En **Windows/WSL2** usá **Windows Terminal**, que ya viene instalado y es
genuinamente bueno. En Linux, Ghostty tiene paquete para la mayoría de las
distros.

### lazydocker — una TUI para containers

```bash
brew install lazydocker
```

`docker ps`, `docker logs -f`, `docker stats`, `docker exec` y
`docker compose down` son cinco comandos que si no vas a tipear mil veces.
`lazydocker` es un solo comando que muestra todo junto: containers, logs en vivo,
gráficos de CPU/memoria por container, y restart/shell/remove con una tecla.

Desde la Cápsula 02 en adelante, "mirá qué pasa en lazydocker" es parte real del
lab — el gráfico de memoria *es* la lección de la Cápsula 05, y el contador de
restarts *es* la lección de la Cápsula 17.

Teclas que vale la pena saber: `[`/`]` cambian de panel, `enter` inspecciona,
`d` elimina, `r` reinicia, `E` abre un shell, `x` abre el menú con todo lo demás.

### direnv — entorno por directorio

```bash
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc     # bash: direnv hook bash
```

Te deja poner `export DATABASE_URL=...` en un `.envrc` dentro del proyecto y que
se cargue solo mientras estás en ese directorio. Así mantenés la config de cada
proyecto fuera de tu perfil global de shell — un hábito que se traslada
directamente al trabajo, donde manejás varios proyectos con credenciales que se
pisan.

---

## Se instalan después, cuando una cápsula lo pida

No instales esto ahora. Cada uno lo introduce la cápsula que lo necesita, con el
motivo.

| Herramienta | Cápsula | Para qué |
|---|---|---|
| `jq` | 01 | Leer JSON en la terminal sin llorar |
| `terraform` | 03 | Infraestructura declarativa |
| `gcloud` | 04 | La CLI de Google Cloud |
| `k6` | 09 | Generación de carga y percentiles de latencia |
| `psql` (`libpq`) | 10 | Hablar con Postgres |
| `redis-cli` | 14 | Hablar con Redis / Memorystore |
| `grpcurl` | 22 | Pinchar servicios gRPC |

---

## Comodidad opcional

```bash
brew install fzf ripgrep bat htop watch httpie
```

- `fzf` — buscador difuso; `Ctrl-R` sobre tu historial se vuelve genuinamente
  bueno
- `ripgrep` (`rg`) — grep rápido en repos grandes
- `bat` — `cat` con syntax highlighting y números de línea
- `htop` — visor de procesos, útil cuando saturás la CPU a propósito
- `watch` — re-ejecuta un comando cada N segundos; se usa en varios labs de carga
- `httpie` (`http`) — un `curl` más amigable para probar APIs a mano

---

## Configuración del shell

Agregá a `~/.zshrc` (o `~/.bashrc`):

```bash
# binarios de Go que instalás con `go install`
export PATH="$HOME/go/bin:$PATH"

# atajos de gravity-augmented (ajustá la ruta)
export GRAVITY="$HOME/repos/pato/gravity-augmented"
alias sc='"$GRAVITY"/bin/scouter'
alias lzd='lazydocker'
```

Después, `sc status` desde cualquier lado te dice dónde estás en el arco.

---

## Verificá

```bash
cd "$GRAVITY"
./bin/doctor
```

Verde en todo lo que está bajo **REQUIRED** significa que estás listo.
Lo que esté bajo **NEEDED LATER** puede quedar en rojo — ya te va a avisar la
cápsula.

---

Siguiente: [`capsules/00-kame-house-setup/README.md`](../capsules/00-kame-house-setup/README.md)
