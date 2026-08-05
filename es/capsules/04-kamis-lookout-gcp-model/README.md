# Cápsula 04 · El Templo de Kami — El modelo mental de GCP

> *El Templo está por encima del planeta. Desde ahí podés verlo entero — que es
> una habilidad completamente distinta a pelear en él.*

| Power level | Tiempo | Prerrequisitos | Modo |
|---|---|---|---|
| 4 | 65 min | Cápsulas 00–03 | Local + ☁️ opcional |

---

## Por qué existe esta cápsula

GCP tiene más de 200 productos. Nadie los aprende hojeando el catálogo. Lo que
realmente necesitás es un **mapa**: cómo está estructurada la cuenta, dónde están
las fronteras, y cómo responder "¿cuál de estas cinco cosas debería usar?".

Al final de esta cápsula vas a poder mirar cualquier servicio de GCP y ubicarlo:
en qué capa vive, contra qué compite, y más o menos cuánto sale. Esa habilidad
sobrevive a cualquier producto específico.

**Leé [`docs/gcp-safety.md`](../../docs/gcp-safety.md) antes de correr cualquier
comando de nube de esta cápsula.** Es corto y es la diferencia entre una
educación gratis y una factura.

---

## El concepto

### 1. La jerarquía de recursos

```
Organization            (your company; tied to a Cloud Identity/Workspace domain)
 └── Folder             (department / team / environment — optional, nestable)
      └── Project       ★ THE UNIT THAT MATTERS
           └── Resources (a Cloud Run service, a bucket, a database…)
```

**El project es el átomo de GCP.** Es simultáneamente:

- la unidad de **facturación** (el gasto se atribuye por project)
- la frontera de **IAM** (los roles se otorgan normalmente acá)
- la frontera de **cuotas**
- el ámbito de **nombres** (los nombres de recursos son únicos dentro de él)
- la unidad de **borrado** — borrá el project y muere todo lo que hay adentro

Dos consecuencias para internalizar:

- **Los entornos son projects separados.** `myapp-dev`, `myapp-staging`,
  `myapp-prod`. No carpetas en el mismo project, no prefijos de nombre. Es la
  única frontera que realmente evita que un error en dev toque prod.
- **Un project descartable es un radio de explosión gratis.** Crear uno no cuesta
  nada y borrarlo es el único teardown que nunca se olvida de nada.

Las políticas puestas en una carpeta o en la organización se **heredan hacia
abajo**. Así decís "ningún bucket público en ninguna parte de esta empresa" una
vez (Org Policy) en lugar de auditar cada project para siempre.

> Si estás en una cuenta personal no tenés organización — los projects cuelgan
> directo de tu cuenta. Todo lo demás funciona igual.

### 2. IAM: quién puede hacer qué sobre qué

```
    PRINCIPAL           ROLE                    RESOURCE
    (who)               (bundle of permissions) (on what)

    user:pato@…         roles/run.developer     project myapp-dev
    serviceAccount:…    roles/pubsub.publisher  topic power-readings
    group:eng@…         roles/viewer            folder engineering
```

Tres niveles de roles, y deberías saber por qué el primero es una trampa:

| Nivel | Ejemplo | Veredicto |
|---|---|---|
| **Básicos** | `roles/owner`, `roles/editor`, `roles/viewer` | Legado. `editor` otorga ~2.000 permisos en todos los servicios. Nunca lo otorgues en algo real. |
| **Predefinidos** | `roles/run.invoker`, `roles/storage.objectViewer` | La opción por defecto. Google los mantiene por servicio. |
| **Custom** | tu propia lista de permisos | Cuando predefinido es genuinamente demasiado amplio y lo vas a mantener. |

Las **service accounts** son el concepto que más se malinterpreta. Una service
account es una identidad para *código*, no para una persona. Tu servicio de Cloud
Run corre *como* una service account, y así consigue permiso para publicar en
Pub/Sub sin ninguna credencial en tu código ni en tu configuración.

> **La regla de seguridad más importante de GCP:** nunca crees ni descargues una
> JSON key de service account salvo que hayas agotado todas las alternativas. Las
> keys son de larga vida, se filtran, y las keys filtradas son cómo se toman
> cuentas de nube y se convierten en mineras de cripto. Usá **service accounts
> adjuntas** (Cloud Run, GCE), **Workload Identity Federation** (desde GitHub
> Actions u otra nube), y `gcloud auth application-default login` (en local). Las
> tres te dan credenciales de corta vida y rotadas automáticamente.

### 3. Geografía: regiones y zonas

- **Zona** (`us-central1-a`) — más o menos un datacenter. Un solo dominio de
  falla.
- **Región** (`us-central1`) — 3+ zonas, cerca entre sí, a ~1 ms.
- **Multi-región** (`US`, `EU`) — un concepto de almacenamiento que abarca varias
  regiones.

Las reglas que se siguen de esto:

- **Cualquier cosa con estado debería replicarse en al menos 2 zonas.** Una zona
  puede caerse, y se cae.
- **El tráfico entre regiones cuesta plata y suma 30–150 ms.** Mantené tu cómputo
  en la misma región que tu base de datos. Esta única decisión afecta más la
  latencia p99 que la mayoría del código que vas a escribir.
- **El egress a internet cuesta; el ingress es gratis.** El tráfico entre zonas de
  una región cuesta un poco. Dentro de una zona es gratis. Tu diagrama de
  arquitectura también es un diagrama de facturación.
- **La residencia de datos es una restricción legal**, no una preferencia. "Los
  datos de usuarios de la UE se quedan en la UE" es una elección de región.

### 4. El espectro de cómputo

El modelo mental más útil de GCP. Izquierda = más control, más trabajo. Derecha =
menos control, menos trabajo.

```
 MORE CONTROL                                                    LESS WORK
 ◄──────────────────────────────────────────────────────────────────────►

 Compute Engine    GKE            Cloud Run        Cloud Functions
 (VMs)             (Kubernetes)   (containers)     (single function)
   │                 │               │                  │
 you manage:       you manage:    you manage:        you manage:
 OS, patching,     workloads,     a container        a function body
 scaling, LB       autoscaling,   image
                   node pools
```

**Cómo elegir de verdad:**

| Usá | Cuando |
|---|---|
| **Cloud Run** | Por defecto para un servicio HTTP sin estado o un consumidor de eventos. Escala a cero, facturación por request, un comando para deployar, sin cluster. |
| **GKE** | Necesitás Kubernetes específicamente: networking complejo, operators, StatefulSets, un equipo de plataforma, o muchos equipos compartiendo infraestructura. |
| **Compute Engine** | Necesitás un kernel específico, GPUs con drivers raros, software licenciado, o un lift-and-shift. |
| **Cloud Functions** | Un solo handler de eventos chico. (Cloud Functions v2 es Cloud Run por debajo — así que ante la duda, usá Cloud Run.) |

**Usamos Cloud Run para todo en este repo**, porque saca de encima la distracción
de gestionar clusters y deja que cada cápsula sea sobre el concepto real. Cuando
Kubernetes sea la respuesta correcta, todo lo que aprendas acá se transfiere — un
container es un container.

### 5. El espectro de datos

La otra decisión que te van a pedir justificar constantemente:

| Producto | Modelo | Usalo cuando |
|---|---|---|
| **Cloud SQL** | Postgres/MySQL gestionado | Por defecto. Querés SQL, joins, transacciones, y estás por debajo de unos pocos TB. |
| **AlloyDB** | Compatible con Postgres, más rápido | Cloud SQL es muy lento y no podés dejar Postgres. |
| **Spanner** | SQL distribuido global, consistencia fuerte | Genuinamente necesitás escalado horizontal de escrituras *y* transacciones. Caro; casi nunca es la respuesta para una startup. |
| **Firestore** | Base de documentos, tiempo real, sync offline | Apps mobile/web con documentos por usuario. |
| **Bigtable** | Wide-column, acceso por clave única, enorme | Series temporales, IoT, > 10 TB, > 100k QPS. Sin joins, sin transacciones entre filas. |
| **BigQuery** | Warehouse analítico | Agregar miles de millones de filas. *Nunca* tu almacén transaccional. |
| **Memorystore** | Redis/Memcached gestionado | Caching (Cápsula 14). |
| **Cloud Storage** | Almacenamiento de objetos | Archivos, backups, assets estáticos, zona de aterrizaje de un data lake. |

El instinto correcto: **empezá con Cloud SQL (Postgres)**, y movete solo cuando
tengas una razón medida. Las Sagas 2 y 3 son en gran parte sobre desarrollar el
criterio para saber qué razón tenés.

### 6. Networking, en un dibujo

```
  VPC (a software-defined private network, global in GCP — unusual and useful)
   ├── Subnet (regional, an IP range)
   │    └── your VMs / GKE nodes / Cloud Run with a VPC connector
   ├── Firewall rules      — allow/deny by tag or service account, default-deny in
   ├── Cloud NAT           — outbound internet for instances with no public IP
   └── Private Service Connect / VPC peering — reach Cloud SQL etc. privately
```

Lo que vale la pena recordar: **las VPCs de GCP son globales**, a diferencia de
AWS. Una VPC puede abarcar todas las regiones, con subredes regionales adentro.
Eso simplifica bastante las arquitecturas multi-región.

---

## Lab

### Parte A — instalá y orientate (sin necesidad de facturación)

```bash
brew install --cask google-cloud-sdk
gcloud version
gcloud auth login
```

Explorá la estructura de la CLI — es `gcloud <grupo> <subgrupo> <verbo>`, y es lo
bastante consistente como para que puedas adivinar:

```bash
gcloud --help | head -40
gcloud run --help
gcloud projects list
gcloud config list
```

Tres flags que vale la pena aprender ahora, porque convierten a `gcloud` de una
interfaz en una herramienta scripteable:

```bash
gcloud projects list --format=json
gcloud projects list --format="table(projectId, name, lifecycleState)"
gcloud projects list --format="value(projectId)"   # bare values, for pipes
gcloud run services list --filter="metadata.name~scouter"
```

> `--format` y `--filter` funcionan en **todos** los comandos de gcloud.
> Aprender estos dos vale más que memorizar cincuenta comandos.

### Parte B — el camino ☁️ opcional: deployá el Scouter a Cloud Run

> **Elegible para el free tier.** Cloud Run da 2M requests/mes gratis y escala a
> cero, así que un servicio ocioso no cuesta nada. Costo realista total de esta
> sección: **menos de USD 0,05.** El teardown está al final y lleva diez segundos.
>
> **Salteala entera y completás igual la cápsula.** Todo desde la Cápsula 05
> corre en local.

**1. Project y barreras** — hacé primero
[`docs/gcp-safety.md`](../../docs/gcp-safety.md) (project dedicado, alerta de
presupuesto de USD 5, región por defecto). Después:

```bash
export PROJECT_ID=$(cat ~/.gravity-project)
export REGION=us-central1
gcloud config set project "$PROJECT_ID"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com
```

**2. Un registro de imágenes**

```bash
gcloud artifacts repositories create gravity \
  --repository-format=docker \
  --location="$REGION" \
  --description="Gravity Chamber images"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

**3. Construí para la arquitectura correcta y pusheá**

Acordate de la Cápsula 02: tu Mac construye `arm64`, Cloud Run quiere `amd64`.

```bash
cd ~/repos/pato/gravity-chamber
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/gravity/scouter:$(git rev-parse --short HEAD)"

docker build --platform linux/amd64 -f deploy/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

(Lento bajo emulación. Por eso los pipelines reales construyen en runners amd64.)

**4. Deployá**

```bash
gcloud run deploy scouter \
  --image="$IMAGE" \
  --region="$REGION" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=3 \
  --cpu=1 --memory=512Mi \
  --set-env-vars=LOG_LEVEL=info
```

Leé los flags — cada uno es una lección de una cápsula posterior.
`--min-instances=0` es scale-to-zero (gratis cuando está ocioso, al costo de cold
starts — Cápsula 06). `--max-instances=3` es un techo de gasto tanto como de
capacidad. `--allow-unauthenticated` lo hace público; sin eso necesitarías un
identity token, que es la Cápsula B3 y la Cápsula 08.

**5. Usalo**

```bash
URL=$(gcloud run services describe scouter --region="$REGION" --format='value(status.url)')
echo "$URL"

curl -s "$URL/healthz" | jq
curl -s -XPOST "$URL/readings" -d '{"fighter":"frieza","power":530000}' | jq
curl -s "$URL/leaderboard" | jq
```

**Tu servicio está en internet, detrás de TLS, con un certificado real,
autoescalando, y no escribiste nada de infraestructura.** Para eso está Cloud Run.

**6. Mirá los logs que juntó gratis**

```bash
gcloud run services logs read scouter --region="$REGION" --limit=20

# structured querying — this works because Capsule 01 logged JSON to stdout
gcloud logging read \
  'resource.type=cloud_run_revision AND jsonPayload.status>=400' \
  --limit=10 --format=json | jq '.[].jsonPayload'
```

Esos campos JSON son consultables **porque** usaste `slog` con un handler JSON.
Logs en prosa habrían necesitado regexes.

**7. Mirá el modelo de costos**

```bash
gcloud run services describe scouter --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].resources, spec.template.metadata.annotations)"
```

Cloud Run factura vCPU-segundos y GiB-segundos *mientras hay un request en
vuelo* (más una tarifa por request). Sin tráfico → sin instancias → sin cargo. Ese
modelo de facturación es exactamente por qué vale la pena diseñar para "sin estado
y de arranque rápido".

**8. HACÉ EL TEARDOWN — el mismo día, sin excepciones**

```bash
gcloud run services delete scouter --region="$REGION" --quiet
gcloud artifacts repositories delete gravity --location="$REGION" --quiet

# verify nothing is left
gcloud run services list
gcloud artifacts repositories list
```

---

## Checkpoint

Camino local (todos):

```bash
gcloud version
gcloud projects list --format="value(projectId)" | head
gcloud run --help >/dev/null && echo "cli ok"
```

Contestá esto de memoria antes de seguir — escribilo en `NOTES.md`:

1. ¿Cuál es la unidad de facturación, IAM y borrado en GCP?
2. ¿Cuál es la diferencia entre una zona y una región, y por qué importa para una
   base de datos?
3. ¿Cuándo elegirías GKE sobre Cloud Run? Dame una razón que no sea "es más
   poderoso".
4. ¿Por qué una JSON key descargada es mala idea, y qué la reemplaza en cada uno
   de estos: Cloud Run, GitHub Actions, tu laptop?

---

## Llevátelo al trabajo

- **Projects separados por entorno.** Si tu empresa tiene dev y prod en un solo
  project, eso es un hallazgo que vale la pena plantear.
- **Roles predefinidos, nunca `roles/editor`.** Preguntá "¿cuál es el rol más
  angosto que funciona?" en cada pedido de acceso.
- **Service accounts adjuntas y Workload Identity Federation.** Las keys
  descargadas son lo que encuentra un auditor y lo que usa un atacante.
- **`--format` y `--filter`** convierten gcloud en algo que podés scriptear y
  poner en CI.
- **La misma región para cómputo y datos**, y sabé que el egress cuesta. Una
  cantidad sorprendente de "¿por qué es tan alta la factura?" es charla entre
  regiones.
- **Alertas de presupuesto en todos los projects**, incluidos los sandboxes.
  Especialmente los sandboxes.

---

## Battle drill

<details>
<summary><b>1.</b> Tu equipo quiere dev y prod en un solo project, separados por prefijos de nombre. Argumentá en contra.</summary>

IAM no los puede separar limpiamente — cualquiera con `run.developer` puede
deployar a ambos. Las cuotas se comparten, así que un job descontrolado de dev
puede agotar la cuota de prod. La facturación no se puede atribuir sin un
etiquetado meticuloso. Un comando `gcloud` mal dirigido con el prefijo equivocado
pega en producción. Y borrar dev significa elegir recursos a mano en vez de borrar
un project.

Los projects separados no cuestan nada extra y te dan todas esas fronteras gratis.
</details>

<details>
<summary><b>2.</b> Un servicio necesita leer de Cloud Storage. Recorré cómo darle acceso sin un archivo de key.</summary>

Creá una service account dedicada para el servicio. Otorgale
`roles/storage.objectViewer` **en ese bucket específico** (no a nivel project).
Adjuntala en el deploy (`--service-account=…`). La librería cliente de Google
levanta las credenciales del metadata server automáticamente — Application
Default Credentials.

No existe ninguna key, así que ninguna key se puede filtrar, y el token que sí
obtiene es de corta vida y se rota solo. En local, `gcloud auth
application-default login` hace que el mismo código funcione con *tu* identidad.
</details>

<details>
<summary><b>3.</b> ¿Cloud Run o GKE para un equipo de cuatro que shippea una app web?</summary>

Cloud Run, cómodamente. GKE significa hacerse cargo de upgrades del cluster, node
pools, network policy, ingress controllers y un autoscaler — un trabajo de
plataforma. Con cuatro personas eso es una persona que no tenés.

Movete a GKE cuando tengas una necesidad concreta: service mesh basado en
sidecars, StatefulSets, scheduling de GPUs, operators, network policy estricta a
nivel pod, o muchos equipos necesitando una plataforma compartida. "Va a escalar
mejor" no es una razón — Cloud Run escala a miles de instancias.
</details>

<details>
<summary><b>4.</b> ¿Cuáles son los trade-offs de <code>--min-instances=0</code>?</summary>

**A favor:** costo cero cuando está ocioso. Ideal para dev, herramientas internas
y cargas irregulares.

**En contra:** cold starts. El primer request después de un rato de inactividad
espera un pull del container, el arranque del proceso y cualquier calentamiento —
decenas de milisegundos para un binario Go chico, varios segundos para una JVM o
una app Python grande con imports pesados. Eso es un pico de p99 que correlaciona
exactamente con tus endpoints menos queridos y de menor tráfico.

`--min-instances=1` mantiene una caliente y te factura una instancia siempre
prendida. El binario Go que construiste es chico y arranca rápido, que es
precisamente por qué la elección de lenguaje afecta tus opciones de arquitectura.
</details>

<details>
<summary><b>5.</b> ¿Por qué importa que GCP tenga VPCs globales?</summary>

En AWS, una VPC es regional, así que multi-región significa múltiples VPCs más
peering o un transit gateway más planificar CIDRs que no se solapen. En GCP una
sola VPC abarca todas las regiones con subredes regionales adentro, así que
instancias en `us-central1` y `europe-west1` están en la misma red privada sin
peering.

Simplifica bastante las arquitecturas multi-región. (El tráfico entre ellas sigue
costando plata y sigue tardando 100 ms — global no significa gratis ni rápido.)
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `gcloud: command not found` después de brew | Reiniciá el shell, o `source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"`. |
| `PERMISSION_DENIED` en cualquier API | La API no está habilitada: `gcloud services enable <nombre>.googleapis.com`. |
| `denied: Permission "artifactregistry.repositories.uploadArtifacts"` | Corré `gcloud auth configure-docker <región>-docker.pkg.dev`. |
| El container no arranca en Cloud Run | Normalmente (a) arquitectura equivocada — reconstruí con `--platform linux/amd64`; (b) no escucha en `$PORT`; (c) bindeado a `127.0.0.1` en vez de `:8080`. |
| `Cloud Run error: container failed to start and listen on port` | Mirá `gcloud run services logs read scouter` — el error real siempre está ahí. |
| Pide billing account | Cloud Run necesita facturación vinculada incluso para usar el free tier. Configurá primero la alerta de USD 5. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "docs(gcp): notes on the GCP resource and compute model

Capsule 04. Project as the billing/IAM/deletion boundary, compute spectrum,
data spectrum, region strategy. Deployed scouter to Cloud Run and tore it down."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 04
```

**Siguiente:** [Cápsula 05 · Kaio-ken — Vertical scaling y su precio](../05-kaio-ken-vertical-scaling/README.md)
