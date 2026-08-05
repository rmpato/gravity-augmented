# Cápsula 02 · Cápsula #9 — Containers

> *Bulma tira una cápsula al piso y aparece una aeronave completamente equipada.
> Nunca fue más chica adentro. Fue empaquetada para poder transportarse, y se
> desempaqueta idéntica todas y cada una de las veces.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 3 | 65 min | Cápsulas 00–01 | Local |

---

## Por qué existe esta cápsula

"Anda en mi máquina" no es un chiste; es la mayor fuente de tiempo de ingeniería
desperdiciado que existió antes de los containers. Un container es la respuesta a
una sola pregunta: **¿cómo muevo este programa, y todo lo que necesita para
correr, a otro lado, y estoy seguro de que se va a comportar igual?**

Todos los destinos de deploy del resto de este repo — Cloud Run, GKE, Compute
Engine con un SO optimizado para containers — reciben una container image. No un
zip, no un repo. Una imagen. Así que este es el formato de empaquetado de las 24
cápsulas que quedan.

También vas a aprender por qué un Dockerfile ingenuo produce una **imagen de 1,2
GB con usuario root y un shell**, y cómo bajar a **menos de 15 MB sin ningún
shell** — que es simultáneamente más rápido de deployar, más barato de almacenar,
y muchísimo menos superficie de ataque.

---

## El concepto

### Qué es realmente un container

No es una máquina virtual. No hay kernel invitado. Un container es un proceso
Linux normal al que el kernel le miente:

- **namespaces** — el proceso ve su propio espacio de PIDs, su propio árbol de
  montajes, sus propias interfaces de red, su propio hostname. `ps` adentro
  muestra *tu* proceso como PID 1 y nada más.
- **cgroups** — el kernel impone límites de CPU, memoria y E/S. Este es el
  mecanismo detrás de todo lo de la Cápsula 05.
- **un filesystem de unión** — la imagen es una pila de capas de solo lectura con
  una capa escribible fina arriba. Las capas se direccionan por contenido y se
  comparten entre imágenes, que es por qué bajar tu segunda imagen con la misma
  base es casi instantáneo.

**La consecuencia que importa:** un container arranca en milisegundos porque no
hay un SO que bootear. Eso es lo que hace posibles el scale-to-zero y el
autoscaling por request (Cápsula 06).

**En una Mac** no hay kernel de Linux, así que OrbStack/Docker Desktop corren una
VM Linux chica y tus containers viven adentro. Por eso la E/S de archivos a través
del límite de montaje es más lenta que nativa, y por eso una Mac `arm64` produce
imágenes `arm64` que no van a correr en una VM `amd64` de la nube salvo que lo
digas explícitamente.

### Imagen vs container

```
Dockerfile  --build-->  Image  --run-->  Container
 (recipe)              (class)          (instance)
```

Las imágenes son inmutables y tienen tag. Los containers son instancias
descartables. Si te encontrás haciendo `docker exec` para arreglar algo adentro
de un container, construiste una mascota, y el arreglo se va a evaporar en el
próximo deploy.

### Capas y el cache

Cada instrucción produce una capa. Docker reutiliza una capa cacheada si esa
instrucción *y todas las capas anteriores* no cambiaron.

Esto te da la regla más importante de un Dockerfile:

> **Ordená las instrucciones de menos-probable-a-cambiar a
> más-probable-a-cambiar.**

Las dependencias cambian semanalmente; tu código fuente cambia en cada commit. Así
que copiá el manifiesto de dependencias y bajá las dependencias *antes* de copiar
el código. Hacelo al revés y cada cambio de una línea vuelve a descargar todo tu
módulo cache.

### Multi-stage builds

Las herramientas para *construir* software no tienen nada que ver con las de
ejecutarlo. El compilador de Go pesa ~500 MB; el binario que produce pesa ~10 MB.
Los multi-stage builds te dejan usar una imagen gorda para compilar y copiar solo
el artefacto a una minúscula.

```
FROM golang:1.23 AS build     ← compiler, module cache, git — thrown away
FROM gcr.io/distroless/static ← ~2 MB: no shell, no package manager, no libc
COPY --from=build /bin/app /app
```

### Elegir una imagen base

| Base | Tamaño | ¿Tiene shell? | Usala cuando |
|---|---|---|---|
| `ubuntu` / `debian` | ~80 MB | sí | necesitás paquetes de sistema de verdad |
| `alpine` | ~7 MB | sí (`ash`) | querés chico *y* un shell para debuggear |
| `gcr.io/distroless/static` | ~2 MB | **no** | binarios estáticos de Go/Rust — el default acá |
| `scratch` | 0 B | no | absolutamente nada más que tu binario; los certificados CA y los datos de zona horaria los ponés vos |

**Por qué distroless es el default correcto para un servicio Go:** un atacante que
logra RCE en tu proceso no encuentra `sh`, ni `curl`, ni `apt`, ni ningún gestor
de paquetes con el que bajar herramientas. Elimina una categoría entera de
post-explotación. El costo es que no podés hacer `docker exec -it … sh` para
mirar — que es un hábito que conviene perder igual, y la Cápsula 25 te da la
observabilidad que lo reemplaza.

> Una nota sobre Alpine: usa musl libc en vez de glibc. Para binarios de Go
> estáticos puros eso es irrelevante. Para cualquier cosa que use cgo (algunos
> drivers de base de datos, librerías de imágenes), musl puede producir
> diferencias sutiles en runtime. Sabelo antes de "usar alpine nomás" en un
> servicio Python o Node.

### Corré como no-root

Por defecto, el proceso adentro de un container corre como **root**. Combinado con
una vulnerabilidad de escape de container, eso es root en el host. Toda imagen que
publiques debería declarar un `USER` no-root. Distroless tiene `nonroot`
(UID 65532) incorporado.

---

## Lab — empaquetá el Scouter

En `~/repos/pato/gravity-chamber`.

### Paso 1 — la versión ingenua, para poder medir la mejora

**`deploy/Dockerfile.naive`**

```dockerfile
FROM golang:1.23
WORKDIR /src
COPY . .
RUN go build -o /bin/scouter ./cmd/scouter
CMD ["/bin/scouter"]
```

```bash
docker build -f deploy/Dockerfile.naive -t scouter:naive .
docker images scouter:naive
```

Anotá el tamaño. Anda por los **1,2 GB**, contiene todo el toolchain de Go y tu
código fuente, y corre como root.

### Paso 2 — la posta

**`deploy/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ---- build stage ------------------------------------------------------------
# This tag must stay >= the `go` directive in your go.mod. `go get` can raise
# that directive under you — and the official golang images set
# GOTOOLCHAIN=local, so it builds on your laptop and fails only here.
FROM golang:1.25-alpine AS build
WORKDIR /src

# Dependencies first: these layers survive every source-only change.
COPY go.mod go.sum* ./
RUN go mod download

# Now the source. This layer is invalidated on every commit — which is fine,
# because everything expensive already happened above it.
COPY . .

# CGO_ENABLED=0 produces a fully static binary with no libc dependency,
# which is what lets it run on distroless/static (and on scratch).
#   -trimpath   strips local filesystem paths from the binary (reproducibility)
#   -ldflags -s -w  drops the symbol table and DWARF info (~25% smaller)
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath \
      -ldflags="-s -w -X main.version=${VERSION}" \
      -o /bin/scouter ./cmd/scouter

# ---- runtime stage ----------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot

# distroless/static ships CA certificates and tzdata already — you need both
# the moment you call any HTTPS API or format a timestamp in a named zone.
COPY --from=build /bin/scouter /scouter

USER nonroot:nonroot
EXPOSE 8080

# Exec form (a JSON array), never shell form. Shell form wraps your process in
# /bin/sh, which then becomes PID 1 and does NOT forward SIGTERM — silently
# destroying the graceful shutdown you built in Capsule 01.
ENTRYPOINT ["/scouter"]
```

**`.dockerignore`** — tan importante como el Dockerfile:

```
.git
.github
bin/
dist/
*.md
.env
.envrc
data/
*.tfstate*
.terraform/
```

Sin esto, `COPY . .` se lleva todo tu historial `.git` (a menudo más grande que el
código), invalida el cache ante cualquier cambio de archivo, y — la parte que
realmente muerde — puede copiar un `.env` lleno de credenciales a una capa donde
`docker history` te la va a mostrar con gusto.

### Paso 3 — construí y compará

```bash
docker build -f deploy/Dockerfile -t scouter:v1 --build-arg VERSION=v1 .
docker images | grep scouter
```

Esperá más o menos:

```
scouter   naive   1.2GB
scouter   v1      13MB
```

Alrededor de **90× más chica**. Eso es 90× menos para pushear, para bajar en cada
cold start y para almacenar en Artifact Registry, más un runtime sin shell que un
atacante pueda usar.

### Paso 4 — corrélo

```bash
docker run --rm -p 8080:8080 --name scouter -e LOG_LEVEL=debug scouter:v1
```

Segundo panel:

```bash
curl -s localhost:8080/healthz | jq
curl -s -XPOST localhost:8080/readings -d '{"fighter":"nappa","power":4000}' | jq
```

### Paso 5 — probá que el camino de SIGTERM sigue funcionando

Esto es lo que todos rompen y nadie nota hasta que los deploys empiezan a tirar
502.

```bash
docker stop scouter      # sends SIGTERM, waits 10s, then SIGKILL
```

Mirá los logs: deberías ver `shutdown signal received, draining` →
`scouter offline`, y `docker stop` debería volver en ~2 segundos, no en 10.

Ahora rompelo a propósito. Cambiá la última línea a forma shell:

```dockerfile
ENTRYPOINT /scouter
```

Reconstruí, corré, `docker stop`. Ahora tarda los **10 segundos completos** y
nunca ves los logs de shutdown — porque `/bin/sh` es el PID 1 y no reenvía la
señal a tu binario, así que Docker eventualmente le manda SIGKILL a todo. Todos
los requests en vuelo mueren.

Volvé a la forma exec. Acordate de esta; es un bug de producción genuinamente
común.

### Paso 6 — inspeccioná lo que construiste

```bash
# every layer and the command that made it — check nothing secret is in here
docker history scouter:v1

# where the time actually went
docker build -f deploy/Dockerfile -t scouter:v1 . --progress=plain --no-cache 2>&1 | tail -30

# prove the cache works: touch a source file, rebuild, watch which layers are CACHED
touch internal/scouter/server.go
docker build -f deploy/Dockerfile -t scouter:v1 . 2>&1 | grep -E 'CACHED|=>' | head
```

La capa de `go mod download` tiene que decir **CACHED**. Si no lo dice, tu orden
de COPY está mal.

### Paso 7 — lazydocker

```bash
docker run -d --rm -p 8080:8080 --name scouter scouter:v1
lazydocker
```

- Panel **Containers** → `scouter` → **Stats**: CPU y memoria en vivo. Ese
  gráfico es el tema entero de la Cápsula 05.
- **Logs**: tus líneas JSON, en streaming.
- Panel **Images**: `scouter:naive` y `scouter:v1` lado a lado. Apretá `d` y
  borrá `naive` — ya dejaste tu punto claro.

### Paso 8 — un target de build en el Makefile

```makefile
IMAGE   ?= scouter
VERSION ?= $(shell git rev-parse --short HEAD)

## docker-build: build the container image tagged with the git SHA
docker-build:
	docker build -f deploy/Dockerfile -t $(IMAGE):$(VERSION) -t $(IMAGE):latest \
	  --build-arg VERSION=$(VERSION) .

## docker-run: run the image locally
docker-run:
	docker run --rm -p 8080:8080 -e LOG_LEVEL=debug $(IMAGE):latest
```

Agregá `docker-build docker-run` a `.PHONY`.

> **Etiquetá con el SHA de git, nunca solo con `latest`.** `latest` es mutable —
> dos personas bajando `latest` con una hora de diferencia obtienen software
> distinto, y "¿qué versión está en producción?" se vuelve incontestable. La
> Cápsula 24 depende de tags inmutables para que el rollback sea instantáneo.

---

## En GCP

- **Artifact Registry** es donde viven las imágenes. (Container Registry /
  `gcr.io` está deprecado.) 0,5 GB gratis — tu imagen de 13 MB entra cómoda, la de
  1,2 GB no.
- **Cloud Run** deploya una imagen directamente; no hace falta nada más.
- **Cloud Build** puede construir la imagen en la nube desde un `cloudbuild.yaml`.
- **La arquitectura importa.** En una Mac con Apple Silicon construís `linux/arm64`
  por defecto y Cloud Run espera `linux/amd64`. Te lo vas a cruzar en la Cápsula
  04. La solución, para después:

  ```bash
  docker build --platform linux/amd64 -f deploy/Dockerfile -t scouter:v1 .
  ```

  Los tiempos de build se triplican bajo emulación. En pipelines reales construís
  en un runner amd64.
- **Binary Authorization** (vale la pena saber el nombre) puede exigir que las
  imágenes estén firmadas por tu pipeline antes de que Cloud Run o GKE las corran.

---

## Llevátelo al trabajo

- **`.dockerignore` antes del Dockerfile.** Previene filtrar secretos en capas y
  es la diferencia entre un build de 3 segundos y uno de 60.
- **Dependencias antes que el código, siempre.** El ordenamiento de líneas de
  mayor apalancamiento del archivo.
- **`USER` no-root en toda imagen.** Es una línea y es lo primero que mira una
  revisión de seguridad.
- **`ENTRYPOINT` en forma exec.** La forma shell rompe el manejo de señales en
  silencio.
- **Etiquetá con un identificador inmutable** (SHA de git o semver), y tratá
  `latest` solo como un alias de comodidad.
- **Fijá los tags de la imagen base.** `golang:1.25-alpine` es mejor que
  `golang:latest`; un digest (`golang@sha256:…`) es mejor todavía para cualquier
  cosa que tengas que reproducir.
- **Mantené el tag del builder >= tu directiva `go`.** Este es el pin que se
  pudre solo: un `go get` de rutina puede subir la línea `go` de tu `go.mod`, y
  como las imágenes oficiales de golang setean `GOTOOLCHAIN=local` mientras que
  tu máquina usa `auto` por defecto, el build sigue funcionando local y se rompe
  solo en CI. Todo equipo de Go se come esta exactamente una vez.

---

## Battle drill

<details>
<summary><b>1.</b> Tu CI tarda 8 minutos y 7 son <code>go mod download</code> en cada build. ¿Qué está mal?</summary>

`COPY . .` aparece antes de `go mod download`. Cualquier cambio de código
invalida la capa del COPY, lo que invalida todas las capas posteriores, incluida
la descarga.

Solución: copiá `go.mod`/`go.sum` solos, corré `go mod download`, *después* copiá
el código. El mismo principio aplica textualmente a `package.json` + `npm ci`,
`requirements.txt` + `pip install`, y `Gemfile` + `bundle install`.
</details>

<details>
<summary><b>2.</b> ¿Por qué un <code>ENTRYPOINT</code> en forma shell es peligroso en producción?</summary>

Ejecuta tu comando vía `/bin/sh -c`, así que el shell es el PID 1. El shell no
reenvía `SIGTERM` a su hijo. Tu app nunca se entera de que la están apagando, así
que el drenado limpio nunca ocurre; después del período de gracia la plataforma
le manda `SIGKILL` a todo y cada request en vuelo se corta. En un servicio con
tráfico, eso es una ráfaga de 502 en cada deploy.
</details>

<details>
<summary><b>3.</b> Borraste un archivo secreto en una capa posterior del Dockerfile. ¿Se fue de la imagen?</summary>

**No.** Las capas son aditivas; un borrado solo agrega una entrada de whiteout en
una capa *posterior* mientras el archivo sigue en la anterior. Cualquiera con la
imagen puede bajar esa capa y leerlo. `docker history` a menudo te apunta
directo.

Las soluciones: nunca dejar que entre a una capa (`.dockerignore`), usar secret
mounts de BuildKit (`RUN --mount=type=secret,...`) que nunca persisten, o
inyectar secretos en runtime vía entorno/Secret Manager. Y de todos modos:
**rotá el secreto**.
</details>

<details>
<summary><b>4.</b> Distroless no tiene shell. ¿Cómo debuggeás un container que se porta mal?</summary>

No entrás con un shell — hacés que el container te cuente. Logs estructurados
(Cápsula 01), métricas y traces (Cápsula 25). Si genuinamente necesitás
inspeccionar un container vivo, `kubectl debug` / los ephemeral debug containers
adjuntan una imagen *aparte* con herramientas dentro de los mismos namespaces sin
tocar el que está corriendo.

No poder entrar con un shell es una feature: te fuerza a la observabilidad que te
hace capaz de debuggear las diez instancias a las que igual *no podés* entrar.
</details>

<details>
<summary><b>5.</b> ¿Un container es una frontera de seguridad?</summary>

Una débil. Comparte el kernel del host, así que una vulnerabilidad del kernel
puede ser un escape de container. Tratalo como aislamiento para la *corrección* y
como defensa en profundidad para la seguridad — no como un sandbox para código
hostil. Para cargas genuinamente hostiles querés aislamiento a nivel VM (gVisor,
Firecracker, el entorno de ejecución de segunda generación de Cloud Run). No-root,
filesystem raíz de solo lectura y capabilities descartadas es lo que hacés
mientras tanto.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `exec format error` al correr | Arquitectura equivocada. `docker build --platform linux/amd64 …`. |
| `no such file or directory` al arrancar, pero el binario existe | Compilaste con cgo contra glibc y corriste en distroless/static. Poné `CGO_ENABLED=0`. |
| El build no encuentra `go.sum` | Todavía no tenés dependencias. `COPY go.mod go.sum* ./` (ojo el `*`) lo tolera. |
| `docker stop` siempre tarda 10 segundos | ENTRYPOINT en forma shell, o tu app ignora SIGTERM. |
| La imagen sigue enorme después del multi-stage | Estás etiquetando la etapa de build. Asegurate de que el último `FROM` sea el de runtime y de hacer `COPY --from=build`. |
| `permission denied` al escribir un archivo | `USER nonroot` no puede escribir en `/`. Escribí en `/tmp` o montá un volumen — y mejor todavía, no escribas a disco (Cápsula 06). |
| `go: go.mod requires go >= 1.25.0 (running go 1.23.12; GOTOOLCHAIN=local)` — **pero compila bien en local** | Un `go get` subió la directiva `go` de tu go.mod por encima de tu imagen builder. En local `GOTOOLCHAIN=auto` se baja el toolchain nuevo en silencio; las imágenes de golang setean `GOTOOLCHAIN=local` y se niegan. Subí el tag de `FROM golang:` para que coincida. Verificalo con `head -3 go.mod`. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
rm deploy/Dockerfile.naive          # it served its purpose
git add -A
git commit -m "build(docker): multi-stage distroless image for scouter

Capsule 02. 1.2GB -> 13MB. Non-root, static binary, exec-form entrypoint
so SIGTERM still reaches the process. Deps copied before source for cache."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 02
```

**Siguiente:** [Cápsula 03 · Los planos de Bulma — Entornos reproducibles e IaC](../03-bulma-blueprints-iac/README.md)
