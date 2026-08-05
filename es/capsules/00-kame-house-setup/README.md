# Cápsula 00 · Kame House — Setup, herramientas y tu propio repo

> *Nadie empieza en el Templo de Kami. Todos empiezan repartiendo leche para el
> Maestro Roshi y preguntándose qué tiene que ver eso con pelear.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 1 (entrenamiento básico) | 45 min | git, una terminal | Local |

---

## Por qué existe esta cápsula

El motivo más común por el que alguien abandona tres semanas después de empezar a
aprender infraestructura no es la dificultad — es la fricción. Una versión de Go
equivocada, un daemon de Docker que no está corriendo, un repo que nunca se creó
y entonces no hay dónde poner el trabajo.

Sacamos todo eso ahora, de una vez. Después, cada cápsula que queda es sobre
ideas.

También creás **`gravity-chamber`** — tu propio repositorio. Ese repo es el
resultado real de este arco. En dos meses va a ser un sistema multi-servicio con
un historial de commits que muestra exactamente cómo llegó ahí. Ese historial
vale más en una entrevista que cualquier certificado.

---

## El lore

El entrenamiento de Goku arranca en Kame House sin nada de combate: nadar,
cultivar el campo, correr con un caparazón de tortuga en la espalda. Cuando Roshi
finalmente le saca el caparazón, Goku se mueve a una velocidad que jamás habría
alcanzado practicando piñas.

Esta cápsula es el caparazón. Parece que no es el punto. Es el punto.

---

## Parte 1 — El toolchain

Corré el doctor:

```bash
cd ~/repos/pato/gravity-augmented     # donde hayas clonado esto
./bin/doctor
```

Trabajá sobre su lista de **REQUIRED** hasta que esté toda en verde. La
explicación completa de cada herramienta y *por qué* está ahí:
[`docs/setup.md`](../../docs/setup.md), y la referencia larga con equivalentes
para Linux y Windows/WSL2 en [`docs/tools.md`](../../docs/tools.md).

La versión corta:

```bash
brew install go jq                       # Go 1.22+, y jq para leer JSON
brew install --cask orbstack             # runtime de containers (o Docker Desktop)
brew install --cask ghostty              # terminal
brew install lazydocker                  # TUI de containers
brew install direnv                      # variables de entorno por directorio
```

### La trampa de la versión de Go

```bash
go version
which -a go
```

Si ves 1.19 o más viejo, o dos binarios `go`, arreglalo ahora — varias cápsulas
usan `log/slog` (Go 1.21+) y `for range N` (1.22+). Si `/usr/local/go/bin/go`
tapa al de Homebrew, sacá la instalación vieja (`sudo rm -rf /usr/local/go`) o
poné `/opt/homebrew/bin` primero en el `PATH`.

### Confirmá que Docker esté realmente corriendo

```bash
docker run --rm hello-world
```

Un error acá es un daemon que no arrancó, no una instalación rota. Abrí
OrbStack/Docker Desktop.

---

## Parte 2 — Conocé lazydocker

Te van a decir "mirá qué pasa en lazydocker" una docena de veces desde la Cápsula
02. Familiarizate ahora.

```bash
docker run -d --name kame-house --rm nginx:alpine
lazydocker
```

Probá:

| Tecla | Hace |
|---|---|
| `[` `]` | moverse entre paneles (Containers / Images / Volumes / Logs / Stats) |
| `↑ ↓` | seleccionar un container |
| `enter` | inspeccionarlo |
| `E` | abrir un shell adentro |
| `r` | reiniciar |
| `d` | eliminar |
| `q` | salir |

Seleccioná `kame-house` y mirá los paneles de **Logs** y **Stats**. Esos dos
paneles reemplazan unas cuarenta invocaciones de `docker logs -f` / `docker
stats` por semana. Salí y limpiá:

```bash
docker stop kame-house
```

---

## Parte 3 — Creá la Cámara de Gravedad

Este es tu repo. Todo lo que construyas de acá en adelante vive ahí.

```bash
mkdir -p ~/repos/pato/gravity-chamber
cd ~/repos/pato/gravity-chamber
git init
```

Creá la estructura:

```bash
mkdir -p cmd/scouter internal docs/adr deploy scripts
```

| Ruta | Qué contiene |
|---|---|
| `cmd/<nombre>/` | un directorio por binario — la convención de Go. `main.go` y nada más |
| `internal/` | tu código real. Go le prohíbe a otros módulos importar `internal/`, lo que la convierte en una frontera real, no en una convención de nombres |
| `docs/adr/` | Architecture Decision Records — el *por qué* detrás de cada elección |
| `deploy/` | Dockerfiles, archivos de compose, Terraform |
| `scripts/` | cualquier cosa que si no volverías a tipear |

Ahora los archivos:

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

Mi campo de entrenamiento para [Gravity Augmented](https://github.com/…) — GCP y
diseño de sistemas a escala.

Construyendo **Scouter**: un servicio que registra lecturas de nivel de pelea y
las rankea. Empieza como un binario de Go con un map en memoria y termina como un
sistema multi-servicio con base de datos, cache, CDN, message bus y SLOs.

## Correrlo

    make run

## Registro de cápsulas

| Cápsula | Qué cambió |
|---|---|
| 00 | Andamiaje del repo |
```

**`NOTES.md`**
```markdown
# Notas

Tres líneas por cápsula: qué aprendí, qué me sorprendió, qué sigo sin entender.
La línea de "me sorprendió" es la valiosa — la sorpresa marca dónde estaba mal mi
modelo mental.

## Cápsula 00 — Kame House
- 
- Me sorprendió: 
- Pregunta abierta: 
```

**`Makefile`** — todo proyecto tiene uno. Es la respuesta a "¿cómo corro esto?"
que sobrevive a que te vayas del equipo.

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

> **Ojo:** las recetas de un Makefile requieren un **tab**, no espacios. Si te
> sale `Makefile:5: *** missing separator. Stop.`, eso fue lo que pasó.

Inicializá el módulo de Go:

```bash
go mod init github.com/<tu-usuario>/gravity-chamber
```

---

## Parte 4 — Commiteá como si importara

Tu historial es un documento. De acá en adelante, usá conventional commits:

```
<tipo>(<alcance>): <qué cambió, en imperativo>
```

Tipos que vas a usar: `feat` `fix` `perf` `refactor` `docs` `test` `chore`.

```bash
git add -A
git commit -m "chore(repo): scaffold gravity-chamber

Capsule 00. Go module, cmd/internal layout, Makefile, gitignore
covering secrets and terraform state."
```

Pushealo a GitHub si querés — un `gravity-chamber` público con 60 commits bien
escritos es un artefacto genuinamente bueno para mostrar.

---

## Checkpoint

```bash
cd ~/repos/pato/gravity-chamber

# 1. El módulo de Go existe y el toolchain está actualizado
go version | grep -Eq 'go1\.(2[2-9]|[3-9][0-9])' && echo "go ok"
test -f go.mod && echo "module ok"

# 2. La estructura está bien
ls cmd/scouter internal docs/adr deploy scripts >/dev/null && echo "layout ok"

# 3. Los secretos están ignorados — esto NO tiene que imprimir nada
echo "SECRET=hunter2" > .env
git status --porcelain | grep '\.env' && echo "!! .env NOT ignored" || echo "gitignore ok"
rm .env

# 4. make funciona
make help

# 5. Existe un commit
git log --oneline
```

Todo imprimiendo `ok` y un commit en el log = terminado.

---

## Llevátelo al trabajo

- **Un `Makefile` (o `justfile`) en la raíz del repo** es el documento de
  onboarding más barato que existe. `make help` debería responder "¿cómo corro
  esto?" para alguien que entró hoy.
- **El `.gitignore` que cubre secretos va en el primer commit**, no después. Una
  vez que una credencial se commitea, ya fue clonada; lo único que arregla eso es
  rotarla.
- **`internal/`** es la única frontera de módulo que Go impone en el compilador.
  Usala — una frontera que un linter aplica vale diez que describe un wiki.
- **Conventional commits** no cuestan nada y hacen que
  `git log --oneline --grep=perf` sea una query genuinamente útil dos años
  después.

---

## Battle drill

<details>
<summary><b>1.</b> ¿Por qué existe <code>cmd/scouter/main.go</code> en vez de un <code>main.go</code> en la raíz?</summary>

Porque un repo termina teniendo más de un binario. Para la Cápsula 22 vas a tener
`cmd/scouter`, `cmd/ranker` y `cmd/notifier` compartiendo código en `internal/`.
El layout que soporta tres binarios no cuesta nada cuando tenés uno, y meterlo
después significa mover todos los import paths.
</details>

<details>
<summary><b>2.</b> Un compañero commitea una API key, se da cuenta y hace force-push con el historial reescrito. ¿Estás a salvo?</summary>

No. Asumí que ya fue clonada, cacheada por el forge o levantada por un scanner en
segundos — GitHub mantiene alcanzables por API los objetos de un force-push, y
los repos públicos se escanean permanentemente. **Rotá la credencial.** Reescribir
el historial es limpieza, no remediación. Tratá "¿estuvo expuesta?" como un sí
siempre.
</details>

<details>
<summary><b>3.</b> ¿Por qué tener <code>NOTES.md</code> en el repo y no en una app de notas?</summary>

Porque es diffeable, grepeable, y vive al lado del código que describe. Y
`git log -p NOTES.md` se vuelve un registro de cómo cambió tu entendimiento — la
misma razón por la que los ADRs (Cápsula 22) son archivos de texto en el repo y
no páginas de wiki que nadie encuentra.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `go: command not found` | `brew install go`, después reiniciá el shell. Verificá que `echo $PATH` incluya `/opt/homebrew/bin`. |
| El Go viejo gana la pelea del PATH | `which -a go`. Sacá `/usr/local/go` o reordená el PATH en `~/.zshrc`. |
| `Cannot connect to the Docker daemon` | El daemon no está corriendo. Abrí OrbStack / Docker Desktop. |
| `Makefile: missing separator` | Las líneas de receta empiezan con un tab literal. Tu editor lo convirtió en espacios. |
| `go mod init` se queja del path | Cualquier string funciona en local, pero usá `github.com/<vos>/gravity-chamber` para que siga siendo válido si lo pusheás. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done 00
```

**Siguiente:** [Cápsula 01 · Scouter — Tu primer servicio](../01-scouter-first-service/README.md)
