# Cápsula 03 · Los planos de Bulma — Entornos reproducibles e IaC

> *Bulma nunca construye la misma máquina dos veces de memoria. Guarda los planos.
> Esa es la razón entera por la que Capsule Corp puede producir una cámara de
> gravedad, dejar que Vegeta la destruya, y producirla de nuevo para el viernes.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 4 | 65 min | Cápsulas 00–02 | Local |

---

## Por qué existe esta cápsula

Hay dos formas en que la infraestructura empieza a existir:

1. Alguien clickea por una consola. Funciona. Nadie sabe qué clickeó.
2. Alguien escribe un archivo, lo commitea, otra persona lo revisa, una
   herramienta lo aplica.

La primera es más rápida hoy y catastrófica en dieciocho meses. El conocimiento
vive en la cabeza de una persona; nada se puede recrear; el entorno de staging se
desvió calladamente de producción; y lo que se rompe a las 3 de la mañana es una
configuración que nadie se acuerda de haber hecho.

Esta cápsula cubre las dos mitades de la reproducibilidad:

- **En local** — `docker compose`, para que todo tu stack (pronto: Postgres,
  Redis, el emulador de Pub/Sub) arranque con un comando y sea idéntico para
  todos.
- **En la nube** — **Terraform**, para que la infraestructura sea un archivo
  revisable.

Vas a aprender Terraform en serio acá **sin gastar un centavo y sin cuenta de
GCP**, usando providers locales. La mecánica — state, plan, apply, drift, grafos
de dependencias — es idéntica sin importar a qué provider lo apuntes.

---

## Parte 1 — docker compose

### El concepto

Compose declara un conjunto de containers, su configuración, su red y sus
volúmenes en un archivo YAML. El punto no es "evitar comandos `docker run`
largos" — es que **el archivo es el entorno**, versionado al lado del código que
lo necesita. Alguien nuevo corre un comando y tiene exactamente tu stack.

Tres cosas que te da y que importan:

- **Una red compartida con DNS por nombre de servicio.** Desde adentro de
  `scouter`, el hostname `postgres` resuelve al container de la base de datos.
  Nunca IPs.
- **Volúmenes nombrados** — persistencia que sobrevive a `down` pero que podés
  borrar a propósito con `down -v`.
- **`depends_on` + healthchecks** — orden de arranque que realmente espera a
  *listo*, no solo a *arrancado*. (Un `depends_on` pelado sin `condition` solo
  espera a que el proceso se lance, que es el clásico bug de "la app crasheó
  porque Postgres todavía no aceptaba conexiones".)

### Lab

**`deploy/docker-compose.yml`** en `gravity-chamber`:

```yaml
name: gravity-chamber

services:
  scouter:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    image: scouter:dev
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      LOG_LEVEL: "${LOG_LEVEL:-info}"   # from your shell, with a default
    restart: unless-stopped
    healthcheck:
      # distroless has no shell and no curl, so we use the binary's own
      # ability to... not do this. See the note below — this is why the
      # healthcheck lives outside the container in compose.
      test: ["CMD", "/scouter", "-health"]
      interval: 10s
      timeout: 2s
      retries: 3
      start_period: 5s

  # A stand-in load generator. Capsule 09 replaces it with k6.
  pinger:
    image: alpine:3.20
    depends_on:
      - scouter
    command: >
      sh -c "apk add --no-cache curl >/dev/null &&
             while true; do
               curl -s -o /dev/null http://scouter:8080/healthz;
               sleep 2;
             done"
    profiles: ["load"]      # only starts with: --profile load
```

> **El problema del healthcheck en distroless.** Un `HEALTHCHECK` corre *adentro*
> del container, pero distroless no tiene `curl` ni shell. Tres opciones reales:
> (a) darle a tu binario un flag `-health` que haga una llamada HTTP a sí mismo y
> salga con 0/1 — barato y autocontenido; (b) sacar el healthcheck del container y
> dejar que el orquestador sondee `/readyz` por HTTP, que es lo que hacen Cloud
> Run, Kubernetes y los load balancers de todos modos; (c) usar `alpine` como base
> de runtime y perder los beneficios de distroless.
>
> **En producción, (b) es la respuesta correcta** — la plataforma sondea por red.
> Igual vamos a implementar (a) más abajo, porque son cinco líneas y hace que
> compose se porte bien.

Agregá el flag de salud a **`cmd/scouter/main.go`**, justo al principio de
`main()`:

```go
func main() {
	// A self-check mode so container healthchecks work on a distroless image
	// with no shell and no curl. Exits 0 if the service answers, 1 otherwise.
	if len(os.Args) > 1 && os.Args[1] == "-health" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		resp, err := http.Get("http://127.0.0.1:" + port + "/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	cfg, err := scouter.LoadConfig()
	// … rest unchanged
```

Corrélo:

```bash
cd deploy
docker compose up --build -d
docker compose ps                    # STATUS should become "healthy"
curl -s localhost:8080/healthz | jq

docker compose --profile load up -d  # add the pinger
lazydocker                           # watch two containers, one talking to the other

docker compose logs -f scouter
docker compose down                  # stop; -v also removes volumes
```

Agregá al Makefile:

```makefile
## up: start the local stack
up:
	docker compose -f deploy/docker-compose.yml up --build -d

## down: stop the local stack
down:
	docker compose -f deploy/docker-compose.yml down

## logs: tail the stack
logs:
	docker compose -f deploy/docker-compose.yml logs -f
```

---

> ### ⏸ Punto natural para cortar
>
> La Parte 1 (compose) y la Parte 2 (Terraform) son independientes. Commiteá lo
> de compose y volvé después por Terraform — no perdés nada partiendo acá.

## Parte 2 — Terraform

```bash
brew install terraform
terraform version
```

### El concepto

Declarás el **estado deseado** del mundo. Terraform lo compara con el **estado
registrado** y el **estado real**, y produce un plan con los cambios mínimos
necesarios. Es *declarativo* y *convergente*: correrlo dos veces no cambia nada la
segunda.

```
  your .tf files          terraform.tfstate           the real world
  "I want 3 of X"   vs    "last time: 2 of X"   vs   "actually: 2 of X"
                    │
                    └──> plan: + 1 to add
```

Cuatro ideas hacen casi todo el trabajo:

**1. El state son las joyas de la corona.** `terraform.tfstate` mapea los nombres
de tus recursos a IDs reales de la nube. Perdelo y Terraform ya no sabe que es
dueño de nada — va a intentar crear todo otra vez. Corrompelo y puede borrar lo
que no era. Por lo tanto: **state remoto en un bucket versionado, con locking,
nunca en git.** El state también contiene atributos de recursos, incluidos
secretos en texto plano, que es la segunda razón por la que nunca va a git.

**2. `plan` es el artefacto de revisión.** `terraform plan` muestra altas, cambios
y **bajas** antes de que pase nada. En un equipo real, `plan` corre en CI en cada
PR y su salida es lo que lee quien revisa. Un plan con un `- destroy` inesperado o
un `-/+ must be replaced` es un PR bloqueado — así agarrás "cambiar este campo
recrea silenciosamente la base de datos".

**3. El grafo de dependencias es implícito.** Cuando el recurso B referencia
`resource_a.id`, Terraform infiere el orden y paraleliza todo lo demás. Casi nunca
necesitás orden explícito.

**4. Los módulos son funciones.** Entradas (variables), un cuerpo (recursos),
salidas. El mismo módulo con distintos `.tfvars` te da dev y prod desde una sola
definición — que es cómo evitás que los entornos se desvíen.

### Lab — Terraform sin cuenta de nube

Vamos a usar los providers `local` y `random`. Costo cero, credenciales cero, y el
flujo de trabajo es idéntico al de GCP.

**`deploy/terraform/main.tf`**

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    local  = { source = "hashicorp/local", version = "~> 2.5" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # In real projects, state goes here. Commented out until Capsule 04.
  # backend "gcs" {
  #   bucket = "gravity-chamber-tfstate"
  #   prefix = "scouter"
  # }
}

variable "environment" {
  description = "Which environment this config describes"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "replica_count" {
  description = "How many scouter replicas this environment runs"
  type        = number
  default     = 1
}

# A stand-in for "a resource with a server-generated ID you cannot predict".
resource "random_pet" "deployment" {
  length = 2

  # Changing the environment forces a NEW name — this is how you will
  # see a "must be replaced" plan without touching a real cloud.
  keepers = {
    environment = var.environment
  }
}

resource "local_file" "manifest" {
  filename        = "${path.module}/generated/${var.environment}.env"
  file_permission = "0644"

  content = <<-EOT
    # GENERATED BY TERRAFORM — DO NOT EDIT
    DEPLOYMENT=${random_pet.deployment.id}
    ENVIRONMENT=${var.environment}
    REPLICAS=${var.replica_count}
    LOG_LEVEL=${var.environment == "prod" ? "info" : "debug"}
  EOT
}

output "deployment_name" {
  value = random_pet.deployment.id
}

output "manifest_path" {
  value = local_file.manifest.filename
}
```

Ahora recorré el ciclo de vida completo. Leé cada salida; el punto es el *flujo*.

```bash
cd deploy/terraform

terraform init          # downloads providers, creates .terraform.lock.hcl
terraform fmt           # canonical formatting — run this in CI
terraform validate      # syntax and type checking, no cloud calls

terraform plan          # "2 to add, 0 to change, 0 to destroy"
terraform apply         # type: yes
cat generated/dev.env

terraform plan          # "No changes." <- convergence. Run it a hundred times.
```

**Ahora ponelo interesante.**

```bash
# 1. A change that looks like an in-place update
terraform plan -var 'replica_count=3'
#    => NOT "1 to change". You get "local_file.manifest must be replaced",
#    "-/+", "# forces replacement" on content, and
#    "1 to add, 0 to change, 1 to destroy". local_file cannot edit a file
#    in place: any content change is delete-and-recreate.

# 2. A destructive change
terraform plan -var 'environment=prod'
#    => "2 to add, 0 to change, 2 to destroy": random_pet is replaced
#    ("forces replacement" on keepers), and the manifest is replaced with it.
#    This is exactly the signal that would tell you a config tweak is about
#    to recreate a production database. LOOK FOR IT IN EVERY PLAN.

# 3. Drift — someone edits the real world by hand
echo "HACKED=true" >> generated/dev.env
terraform plan
#    => "local_file.manifest will be created", "1 to add". The provider
#    sees the file no longer matches, drops it from state, and plans to
#    write it again. This is "click-ops drift", caught automatically.

terraform apply -auto-approve   # convergence: the manual edit is reverted

# 4. Read the state — and see why it never goes in git
terraform show
terraform state list

# 5. Clean up
terraform destroy
```

El paso 1 es la lección escondida en este lab. Cambiar un número *parece* un
update, pero si un cambio es `~ update in-place` o `-/+ replace` no lo decidís
vos: lo decide el provider, atributo por atributo. `local_file` no tiene una
operación de "editar", así que cualquier cambio de contenido es un reemplazo.
Para un archivo no cuesta nada. En una nube real, muchos atributos (un label,
los límites de escalado de un servicio de Cloud Run) sí se actualizan in-place
y muestran `~`, pero algunos que parecen inocentes fuerzan un reemplazo. El plan
te dice cuáles, en la línea marcada `# forces replacement`. Por eso leés cada
plan en vez de adivinar.

**`deploy/terraform/.gitignore`**

```gitignore
.terraform/
*.tfstate
*.tfstate.*
*.tfvars
!example.tfvars
generated/
crash.log
```

El `.terraform.lock.hcl` **sí** se commitea — fija versiones y checksums de
providers para que todos y CI resuelvan igual. El mismo rol que `go.sum`.

### Cómo se ve la versión de GCP

Esto lo vas a correr en la Cápsula 04. Leelo ahora para que no te resulte nuevo
después:

```hcl
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
  backend "gcs" {
    bucket = "gravity-chamber-tfstate"   # versioning ON, created once by hand
    prefix = "scouter"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_cloud_run_v2_service" "scouter" {
  name     = "scouter"
  location = var.region

  template {
    containers {
      image = var.image          # tagged with a git SHA, never :latest
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
      env {
        name  = "LOG_LEVEL"
        value = var.environment == "prod" ? "info" : "debug"
      }
    }
    scaling {
      min_instance_count = 0     # scale to zero: free when idle
      max_instance_count = 10    # a spending ceiling as much as a capacity one
    }
  }
}
```

Las mismas cuatro ideas. Distintos sustantivos.

> **El problema del huevo y la gallina en el bootstrap:** el bucket de GCS que
> guarda el state no puede ser creado por el Terraform que lo usa. Todo el mundo
> crea ese único bucket a mano (o con una config aparte minúscula), le prende el
> **versionado de objetos**, y no lo toca más. El versionado es tu botón de
> deshacer cuando un archivo de state se corrompe.

---

## Checkpoint

```bash
cd ~/repos/pato/gravity-chamber

# compose brings the stack up healthy
make up && sleep 8
docker compose -f deploy/docker-compose.yml ps | grep -q healthy && echo "compose ok"
curl -sf localhost:8080/healthz >/dev/null && echo "service ok"
make down

# terraform converges
cd deploy/terraform
terraform apply -auto-approve >/dev/null
terraform plan -detailed-exitcode >/dev/null && echo "convergence ok (exit 0 = no changes)"
terraform destroy -auto-approve >/dev/null && echo "destroy ok"

# state is not tracked — must print nothing
cd ~/repos/pato/gravity-chamber
git status --porcelain | grep -E 'tfstate|\.terraform/' && echo "!! state IS tracked" || echo "gitignore ok"
```

> `terraform plan -detailed-exitcode` devuelve **0** si no hay cambios, **2** si
> hay cambios pendientes, **1** si hay error. Ese es el código de salida sobre el
> que ponés el gate en CI.

---

## Llevátelo al trabajo

- **`terraform plan` en CI en cada PR, publicado como comentario.** Revisar diffs
  de infraestructura es el punto entero; un plan que nadie lee es teatro.
- **Leé los planes buscando la palabra "replace".** Los updates in-place son
  baratos. El reemplazo destruye y recrea — en una base de datos, eso es una tarde
  que te va a definir la carrera.
- **State remoto, bucket versionado, locking prendido.** Dos personas aplicando a
  la vez sin lock corrompen el state.
- **Commiteá el lock file** (`.terraform.lock.hcl`), ignorá el state.
- **`terraform fmt -check` y `validate` en CI.** Gratis, instantáneo, y evita
  categorías enteras de ruido en las revisiones.
- **Nunca hagas `terraform apply` desde una laptop contra producción.** Corre en
  CI con una service account cuyos permisos son más angostos que los tuyos.
- **El archivo de compose en el repo, un `make up` para arrancar todo.** El tiempo
  de onboarding baja de un día a un café.

---

## Battle drill

<details>
<summary><b>1.</b> Un compañero borra <code>terraform.tfstate</code> y corre <code>apply</code>. ¿Qué pasa?</summary>

Terraform cree que no gestiona nada, así que planea **crear todo desde cero**.
Contra una nube real eso significa recursos duplicados o errores por nombres que
ya existen — y los recursos preexistentes quedan *huérfanos*: reales, facturando,
y sin gestionar.

Recuperarse es `terraform import` para cada recurso, uno por uno, emparejando IDs
reales con direcciones. Es lento y miserable. Por eso el state remoto vive en un
bucket con **versionado de objetos** — restaurás la versión anterior y seguís.
</details>

<details>
<summary><b>2.</b> ¿Por qué <code>depends_on: [postgres]</code> en compose no alcanza?</summary>

Espera a que el container *arranque*, no a que Postgres *acepte conexiones*.
Postgres tarda varios segundos en inicializar, así que tu app se conecta, falla y
sale — una carrera de arranque que aparece como "anda al segundo intento".

La solución: un `healthcheck` en la dependencia más
`depends_on: { postgres: { condition: service_healthy } }`.

La mejor solución, y la que importa en producción: hacer que la app **reintente
sus dependencias con backoff al arrancar** y reporte not-ready mientras tanto. Los
orquestadores no garantizan orden de arranque en absoluto, así que una app que lo
requiere es frágil en todos lados, no solo en compose.
</details>

<details>
<summary><b>3.</b> Alguien cambia una configuración en la consola de GCP. ¿Qué hace Terraform en la próxima corrida?</summary>

`plan` refresca el estado real, ve la diferencia y propone revertirla — esto es
**detección de drift**, y es una de las propiedades más valiosas de Terraform. El
cambio manual desaparece silenciosamente en el próximo apply, lo cual es
correcto: si debería existir, debería estar en el código.

Los equipos maduros corren `plan` en un schedule (de noche) puramente para alertar
sobre drift, y tratan cualquier drift como un incidente o como un cambio de código
faltante.
</details>

<details>
<summary><b>4.</b> ¿Terraform vs Cloud Deployment Manager vs Pulumi vs clickear?</summary>

- **Terraform / OpenTofu** — el estándar de facto, multi-nube, ecosistema enorme
  de providers, HCL declarativo. La opción por defecto, y la que piden los avisos
  de trabajo.
- **Pulumi / CDK** — lenguajes de programación reales. Mejor abstracción y
  testing, al costo de que es mucho más fácil escribir algo ingenioso que nadie
  puede revisar. Usalo cuando genuinamente necesitás loops y lógica.
- **Config Connector / Crossplane** — infraestructura como recursos de Kubernetes.
  Genial si ya vivís en Kubernetes, acoplamiento innecesario si no.
- **Clickear** — está bien para *explorar*. Nunca para algo que tiene que existir
  mañana. Un compromiso útil: clickeá para explorar, después
  `gcloud … --format=export` o Terraformer para generar la config, y commiteala.
</details>

<details>
<summary><b>5.</b> ¿Por qué el state de Terraform contiene secretos, y qué hacés al respecto?</summary>

El state guarda los atributos completos de cada recurso, incluidas contraseñas
generadas, claves y connection strings, en **JSON de texto plano**. Marcar una
variable como `sensitive = true` solo la esconde de la salida de la CLI — sigue
estando en el state.

Mitigaciones: state remoto en un bucket con cifrado en reposo e IAM bien acotado
(muy pocas personas deberían tener acceso de lectura); nunca commitear el state;
y preferir recursos que referencien un almacén de secretos (Secret Manager) antes
que los que generan y guardan el secreto ellos mismos.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `Error acquiring the state lock` | Una corrida anterior murió. Confirmá que nadie esté aplicando, después `terraform force-unlock <ID>`. |
| Compose no llega a `scouter` por nombre | Los containers tienen que compartir red (compose lo hace por defecto) y tenés que usar el **nombre del servicio**, no `localhost`. |
| `port is already allocated` | Algo más tiene el 8080. `lsof -i :8080` o cambiá el lado host del mapeo. |
| El healthcheck siempre da unhealthy | Distroless no tiene shell — el `test` tiene que ser forma exec apuntando a un binario real. Verificá que agregaste la rama `-health`. |
| `terraform plan` quiere recrear todo | Workspace equivocado, state faltante, o una config de `backend` cambiada. Mirá `terraform workspace show` y que `init` haya tomado el backend correcto. |
| Drift de versiones de provider entre máquinas | No commiteaste `.terraform.lock.hcl`. Commitealo. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(deploy): docker compose stack and terraform foundations

Capsule 03. Compose for the local stack with a working healthcheck on a
distroless image. Terraform lifecycle practised with local providers:
plan/apply/drift/destroy, state gitignored, lock file committed."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 03
```

**Siguiente:** [Cápsula 04 · El Templo de Kami — El modelo mental de GCP](../04-kamis-lookout-gcp-model/README.md)
