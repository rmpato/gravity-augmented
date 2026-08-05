# Cápsula B7 · El Registro de Kami — IAM, service accounts y Workload Identity

> *Kami tampoco pelea. Lleva el registro: quién puede entrar al Templo, quién puede
> tomar el Agua Ultra Divina, quién tiene permitido invocar a Shenron. Cada desastre
> de la serie empieza con la persona equivocada consiguiendo acceso a algo que no
> debería haber tenido.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 75 min | Cápsula 04 · opcional [B3](../B3-fortuneteller-baba-auth/README.md) | Cápsula 04 |

---

## Por qué existe esta cápsula

**Una JSON key de service account descargada es la forma más común en que se
compromete una cuenta de Google Cloud.** Se filtra en un repo de git, en una capa de
imagen de Docker, en un log de CI, en un mensaje de Slack — y es una credencial de
larga vida sin expiración que alguien va a encontrar con un scanner automatizado en
cuestión de horas.

Cada alternativa de esta cápsula es gratis, mejor y normalmente menos trabajo. La
única razón por la que la gente usa keys es que nadie le mostró las alternativas.

También es el tema de GCP con más probabilidad de aparecer en un trabajo real, porque
"¿cómo consigue este servicio permiso para hacer aquello?" es una pregunta que vas a
responder todas las semanas.

---

## El modelo de IAM

```
   WHO             CAN DO WHAT              ON WHAT
   ──────────      ────────────────────     ──────────────────────
   principal   +   role (permissions)   +   resource        = a binding

   user:pato@x.com         roles/run.developer      project my-app-dev
   serviceAccount:api@…    roles/pubsub.publisher   topic power-readings
   group:eng@x.com         roles/viewer             folder engineering
   principalSet://…        roles/run.invoker        service scouter
```

**Principales:**

| Tipo | Ejemplo | Notas |
|---|---|---|
| Cuenta de Google | `user:pato@example.com` | una persona |
| Service account | `serviceAccount:api@proj.iam.gserviceaccount.com` | **una identidad para código** |
| Grupo | `group:engineers@example.com` | **otorgá a grupos, no a personas** |
| Dominio | `domain:example.com` | todos en la organización |
| `allUsers` | — | ⚠️ internet público |
| `allAuthenticatedUsers` | — | ⚠️ **cualquiera con cualquier cuenta de Google**, no solo la tuya |
| Pool de Workload Identity | `principalSet://iam.googleapis.com/...` | workloads externos (GitHub, AWS) |

> **`allAuthenticatedUsers` no significa "gente de mi empresa".** Significa cualquiera
> en la Tierra con una dirección de Gmail. Es una mala configuración frecuente y seria.

**Los roles** vienen en tres niveles (Cápsula 04), y el resumen es: usá roles
**predefinidos**, nunca `roles/editor`, y usá custom solo cuando predefinido es
genuinamente demasiado amplio *y* lo vas a mantener.

**La herencia fluye hacia abajo**: Organización → Carpeta → Project → Recurso. Un rol
otorgado a nivel project aplica a cada recurso adentro. **No hay "denegación por
herencia" por defecto** — no podés quitar en un nivel más bajo lo que se otorgó más
arriba, salvo con una **deny policy** explícita (un mecanismo separado y más nuevo que
se evalúa antes que allow).

---

## Service accounts, bien entendidas

Una service account es **una identidad para código**, y es simultáneamente dos cosas,
que es la parte que confunde:

1. **Un principal** — le otorgás roles, como a un usuario.
2. **Un recurso** — le otorgás a *otros* principales roles *sobre ella* (como
   `roles/iam.serviceAccountUser`, que permite actuar como ella).

Esa dualidad es por qué las service accounts aparecen de los dos lados de los bindings
de IAM, y por qué la escalada de privilegios vía service accounts es un riesgo real:
si puedo *actuar como* una service account poderosa, tengo sus poderes sin importar los
míos.

```bash
gcloud iam service-accounts create scouter-api \
  --display-name="Scouter API service"

# grant the SA a role ON A SPECIFIC RESOURCE, not the whole project
gcloud pubsub topics add-iam-policy-binding power-readings \
  --member="serviceAccount:scouter-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

# attach it at deploy time — the service now RUNS AS this identity
gcloud run deploy scouter \
  --service-account="scouter-api@${PROJECT_ID}.iam.gserviceaccount.com"
```

**La service account por defecto es una trampa.** Compute Engine y Cloud Run usan una
SA por defecto que históricamente tiene `roles/editor` sobre todo el project — más o
menos 2.000 permisos. Cualquier cosa que corra ahí puede hacer casi cualquier cosa.
Siempre creá una service account dedicada por servicio.

---

## Cómo obtiene credenciales el código, en orden de preferencia

### 1. Service account adjunta (la mejor) — Cloud Run, GKE, GCE

La plataforma provee credenciales a través del **metadata server**. Tu código las pide
vía Application Default Credentials y nunca ve un secreto.

```go
// The client library finds credentials automatically. This EXACT code works:
//   - locally, using YOUR identity from `gcloud auth application-default login`
//   - on Cloud Run, using the ATTACHED service account
//   - in GKE, using Workload Identity
// No branching, no config, no key file.
client, err := pubsub.NewClient(ctx, projectID)
```

Podés ver el mecanismo directamente:

```bash
# from inside a Cloud Run container or a GCE VM
curl -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
```

De vida corta (~1 hora), rotadas automáticamente, nunca en disco.

### 2. Workload Identity Federation — para cualquier cosa fuera de GCP

La respuesta para GitHub Actions, GitLab CI, AWS, Azure u on-prem. **Sin key.**

```
  GitHub Actions gets an OIDC token from GitHub
        ↓
  exchanges it with GCP's STS for a short-lived Google access token
        ↓
  which is bound to a service account with narrow permissions
```

```bash
gcloud iam workload-identity-pools create github --location=global

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"

# CRITICAL: bind to a SPECIFIC repository. Without this attribute condition,
# ANY GitHub repository in the world can assume this service account.
gcloud iam service-accounts add-iam-policy-binding \
  "deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUM}/locations/global/workloadIdentityPools/github/attribute.repository/myorg/gravity-chamber"
```

```yaml
# .github/workflows/deploy.yml
permissions:
  contents: read
  id-token: write          # required to request the OIDC token

steps:
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: projects/123/locations/global/workloadIdentityPools/github/providers/github-provider
      service_account: deployer@my-project.iam.gserviceaccount.com
  - run: gcloud run deploy scouter --image=...
```

**Sin secreto en GitHub. Nada que rotar. Nada que filtrar.**

> La condición `attribute.repository` es la frontera de seguridad. Atá al *pool* en vez
> de a un repositorio específico y creaste una service account que cualquier repo de
> GitHub en internet puede asumir. Esta mala configuración se encontró en el mundo real
> repetidamente.

### 3. Impersonación — para humanos y para acotar privilegio

```bash
# run a command as a service account without any key
gcloud storage ls --impersonate-service-account=reader@proj.iam.gserviceaccount.com

# make the client libraries do it too
gcloud auth application-default login \
  --impersonate-service-account=reader@proj.iam.gserviceaccount.com
```

Necesita `roles/iam.serviceAccountTokenCreator` sobre la SA destino. Esta es la forma
correcta de testear "¿qué puede hacer realmente este servicio?" — y de darle a un
humano acceso elevado temporal y auditado.

### 4. Una JSON key descargada (último recurso)

```bash
# Only when there is genuinely no alternative. And then:
gcloud iam service-accounts keys create key.json --iam-account=...
```

**Si tenés que hacerlo:** guardala en Secret Manager (nunca en git, nunca en una
imagen), rotala periódicamente, restringila con una org policy para que solo se puedan
crear keys donde esté explícitamente permitido, y monitoreá su uso en Cloud Audit Logs.

**Bloqueá la creación de keys a nivel organización** — una org policy que elimina una
categoría entera de incidente:

```bash
gcloud resource-manager org-policies enable-enforce \
  iam.disableServiceAccountKeyCreation --organization=$ORG_ID
```

---

## Autenticación servicio-a-servicio

El patrón para que un servicio de Cloud Run llame a otro. **Sin keys, sin secretos
compartidos, ~10 líneas.**

```bash
# make the callee private
gcloud run deploy ranker --no-allow-unauthenticated

# let ONLY the caller's service account invoke it
gcloud run services add-iam-policy-binding ranker \
  --member="serviceAccount:scouter-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

```go
import "google.golang.org/api/idtoken"

// NewServiceClient returns an HTTP client that automatically attaches a
// Google-signed OIDC identity token for `audience` to every request.
//
// audience MUST be the target service's URL. The receiver verifies the
// audience claim (B3), which is what prevents a token minted for service A
// from being replayed against service B.
func NewServiceClient(ctx context.Context, audience string) (*http.Client, error) {
	return idtoken.NewClient(ctx, audience)
}
```

```go
client, err := NewServiceClient(ctx, "https://ranker-xyz.run.app")
if err != nil {
    return err
}
resp, err := client.Get("https://ranker-xyz.run.app/leaderboard")
```

Cloud Run verifica el token **antes de invocar tu container** — un request no
autenticado nunca llega a tu código.

**En GKE, el equivalente es Workload Identity**: atás una service account de Kubernetes
a una de Google, y los pods obtienen credenciales de GCP sin keys:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "scouter-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[default/scouter-ksa]"

kubectl annotate serviceaccount scouter-ksa \
  iam.gke.io/gcp-service-account="scouter-api@${PROJECT_ID}.iam.gserviceaccount.com"
```

---

## Mínimo privilegio en la práctica

**Otorgá sobre el recurso más angosto que funcione:**

```bash
# ❌ project-wide: this SA can read and write EVERY bucket
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:app@..." --role="roles/storage.admin"

# ✅ one bucket, read only
gcloud storage buckets add-iam-policy-binding gs://scouter-uploads \
  --member="serviceAccount:app@..." --role="roles/storage.objectViewer"
```

**Averiguá qué usó realmente un servicio** — la herramienta que la mayoría no sabe que
existe:

```bash
# IAM Recommender analyses 90 days of usage and proposes narrower roles
gcloud recommender recommendations list \
  --project=$PROJECT_ID \
  --recommender=google.iam.policy.Recommender \
  --location=global \
  --format="table(content.overview.member, content.overview.removedRole)"
```

**Policy Troubleshooter** — para "¿por qué esta cosa no puede hacer aquello?", que de
otro modo cuesta una hora:

```bash
gcloud policy-troubleshoot iam \
  //run.googleapis.com/projects/$PROJECT_ID/locations/us-central1/services/ranker \
  --principal-email=scouter-api@${PROJECT_ID}.iam.gserviceaccount.com \
  --permission=run.routes.invoke
```

**IAM Conditions** — otorgamientos acotados en el tiempo o por atributos:

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="user:oncall@example.com" \
  --role="roles/cloudsql.admin" \
  --condition='expression=request.time < timestamp("2026-08-06T00:00:00Z"),title=incident-4821'
```

Un acceso de emergencia que expira solo es enormemente mejor que uno que alguien tiene
que acordarse de revocar.

---

## Lab

### Paso 1 — inspeccioná lo que realmente tenés

```bash
export PROJECT_ID=$(gcloud config get-value project)

# every binding in the project
gcloud projects get-iam-policy $PROJECT_ID --format=json | jq '.bindings'

# the alarming query: who has owner or editor?
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/owner OR bindings.role:roles/editor" \
  --format="table(bindings.role, bindings.members)"

# every service account, and whether any have downloaded keys
gcloud iam service-accounts list
for sa in $(gcloud iam service-accounts list --format="value(email)"); do
  n=$(gcloud iam service-accounts keys list --iam-account="$sa" \
        --managed-by=user --format="value(name)" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && echo "⚠️  $sa has $n USER-MANAGED KEY(S)"
done
```

Cualquier salida de ese último loop es un hallazgo. `--managed-by=user` es el flag
importante — las keys gestionadas por Google están bien y rotan solas; las gestionadas
por usuario son los archivos JSON descargados.

### Paso 2 — una service account de mínimo privilegio

```bash
gcloud iam service-accounts create scouter-lab \
  --display-name="Capsule B7 lab"

SA="scouter-lab@${PROJECT_ID}.iam.gserviceaccount.com"

# grant it NOTHING at project level. Only what it needs, where it needs it.
gcloud pubsub topics create b7-lab-topic
gcloud pubsub topics add-iam-policy-binding b7-lab-topic \
  --member="serviceAccount:${SA}" --role="roles/pubsub.publisher"

# prove the boundary: publishing works…
gcloud pubsub topics publish b7-lab-topic --message="hello" \
  --impersonate-service-account="$SA"

# …and reading does not
gcloud pubsub subscriptions list --impersonate-service-account="$SA"
# PERMISSION_DENIED — exactly as intended
```

> Si la impersonación falla, otorgate `roles/iam.serviceAccountTokenCreator` sobre esa
> SA. Fijate que necesitaste un permiso explícito para *actuar como* otra identidad —
> ese es el control de escalada funcionando.

### Paso 3 — auth servicio-a-servicio de punta a punta

```bash
# a private service
gcloud run deploy ranker \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/gravity/ranker:v1" \
  --no-allow-unauthenticated \
  --service-account="ranker-sa@${PROJECT_ID}.iam.gserviceaccount.com"

RANKER_URL=$(gcloud run services describe ranker --format='value(status.url)')

# unauthenticated: rejected before your container is even invoked
curl -si "$RANKER_URL/leaderboard" | head -1
# HTTP/2 403

# with YOUR identity token
curl -si -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "$RANKER_URL/leaderboard" | head -1
# HTTP/2 200

# grant the caller permission and deploy it
gcloud run services add-iam-policy-binding ranker \
  --member="serviceAccount:scouter-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

**Decodificá el identity token** y mirá los claims de B3:

```bash
gcloud auth print-identity-token | cut -d. -f2 | base64 -d 2>/dev/null | jq
```

```json
{
  "iss": "https://accounts.google.com",
  "aud": "...",
  "sub": "...",
  "email": "you@example.com",
  "email_verified": true,
  "exp": 1767225600
}
```

La misma estructura de JWT, firmado por Google, de vida corta, verificado por Cloud Run
contra el JWKS público de Google. **Vos no escribiste nada de eso.**

### Paso 4 — Workload Identity Federation para CI

```bash
PROJECT_NUM=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

gcloud iam workload-identity-pools create github --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository_owner == 'YOUR_GITHUB_ORG'"

gcloud iam service-accounts create gh-deployer
gcloud iam service-accounts add-iam-policy-binding \
  "gh-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUM}/locations/global/workloadIdentityPools/github/attribute.repository/YOUR_ORG/gravity-chamber"
```

Fijate en las **dos** guardas: `--attribute-condition` en el provider (solo tu
organización) y el `attribute.repository` en el member (solo ese repo). Cinturón y
tiradores, porque el modo de falla es "cualquiera en GitHub puede deployar a tu
project".

### Paso 5 — audit logs

```bash
# who did what, recently
gcloud logging read \
  'protoPayload.@type="type.googleapis.com/google.cloud.audit.AuditLog"
   AND protoPayload.methodName:"SetIamPolicy"' \
  --limit=20 \
  --format="table(timestamp, protoPayload.authenticationInfo.principalEmail, protoPayload.methodName, protoPayload.resourceName)"

# every use of a service account key — the query to alert on
gcloud logging read \
  'protoPayload.authenticationInfo.serviceAccountKeyName!=""' \
  --limit=20 --format=json | jq '.[].protoPayload.authenticationInfo'
```

**Los Admin Activity logs son gratis y siempre están prendidos.** Los Data Access logs
son opt-in y pueden ser caros a volumen — habilitalos selectivamente en recursos
sensibles.

Una alerta sobre `SetIamPolicy` para `roles/owner` es una de las alertas de seguridad
de más valor que podés crear, y lleva dos minutos.

### Paso 6 — limpieza

```bash
gcloud pubsub topics delete b7-lab-topic --quiet
gcloud iam service-accounts delete "scouter-lab@${PROJECT_ID}.iam.gserviceaccount.com" --quiet
gcloud run services delete ranker --quiet 2>/dev/null || true
```

---

## Llevátelo al trabajo

- **Nunca crees una key descargada de service account.** Imponelo con una org policy
  para que nadie pueda.
- **Una service account dedicada por servicio.** Nunca la SA por defecto, nunca una SA
  compartida para todo.
- **Otorgá sobre el recurso más angosto**, no sobre el project.
- **Otorgá a grupos, no a individuos** — dar de baja a alguien se vuelve un cambio de
  membresía en vez de una auditoría.
- **SA adjunta → Workload Identity Federation → impersonación → key.** En ese orden, y
  casi nunca deberías llegar a la última.
- **Configurá el `audience`** en los identity tokens (B3).
- **Corré IAM Recommender trimestralmente** y actuá sobre él.
- **`allUsers` y `allAuthenticatedUsers` necesitan una justificación escrita.**
- **Alertá sobre `SetIamPolicy` para owner/editor**, y sobre cualquier uso de key de
  service account.
- **IAM Conditions para accesos de emergencia** para que el acceso elevado expire solo.

---

## Battle drill

<details>
<summary><b>1.</b> Se commiteó una key de service account a un repo público. Recorré la respuesta.</summary>

**Asumí que está comprometida.** Los scanners automatizados encuentran keys públicas en
minutos, y hay bots que no hacen otra cosa.

1. **Deshabilitá la key de inmediato** —
   `gcloud iam service-accounts keys delete <KEY_ID> --iam-account=<SA>`. Hacé esto
   antes que nada, incluida la limpieza de git.
2. **Evaluá el radio de explosión** — ¿qué roles tenía esa SA, sobre qué recursos? Por
   esto importa el mínimo privilegio *antes* del incidente.
3. **Auditá su uso** — consultá Cloud Audit Logs por
   `protoPayload.authenticationInfo.serviceAccountKeyName` con esa key. Buscá IPs
   desconocidas, regiones inusuales, creación de recursos (la minería de cripto es el
   payload habitual), y lecturas de datos.
4. **Buscá persistencia** — service accounts nuevas, keys nuevas, bindings de IAM
   nuevos, VMs nuevas, reglas de firewall modificadas. Los atacantes establecen una
   base antes de monetizar.
5. **Rotá todo lo que la key podía alcanzar** — secretos que podía leer, bases de datos
   a las que podía acceder.
6. **Después** limpiá el repo, y entendé que reescribir el historial es limpieza, no
   remediación (Cápsula 00).
7. **Prevení la repetición**: habilitá
   `iam.disableServiceAccountKeyCreation` a nivel organización, migrá a Workload
   Identity Federation, y agregá escaneo de secretos en CI.

La lección de una frase: la *razón* por la que esto es sobrevivible es que la SA tenía
permisos angostos. Si hubiera tenido `roles/editor`, esto es un compromiso total de la
cuenta.
</details>

<details>
<summary><b>2.</b> Explicale Workload Identity Federation a alguien que usa archivos de key.</summary>

Hoy: descargás una JSON key, la pegás en GitHub Secrets, y ahora existe una credencial
permanente y sin expiración en al menos dos lugares para siempre. Si se filtra,
cualquiera la puede usar desde cualquier lado, indefinidamente.

Con federation: GitHub ya prueba quién es. Cada corrida de workflow recibe un token
OIDC de vida corta de GitHub que dice "este es el repo `myorg/myapp`, workflow
`deploy`, branch `main`". Configurás GCP para que *confíe* en el emisor de GitHub y
para mapear esa identidad a una service account.

En tiempo de ejecución la action intercambia el token de GitHub por un access token de
Google válido por alrededor de una hora, acotado a la service account, atado a ese
repositorio específico.

**No se guarda nada. Nada expira-en-2027. Nada que rotar. Nada que filtrar** — un token
robado es inútil en una hora y solo funcionaba para un repo.

El setup son unos diez minutos y es el mismo patrón para AWS, Azure, GitLab y
Kubernetes on-prem. Lo único que hay que hacer bien: atar al repositorio específico, no
al pool entero.
</details>

<details>
<summary><b>3.</b> ¿Qué tiene de malo otorgar <code>roles/editor</code> a una service account?</summary>

`roles/editor` es un rol *básico* de legado que carga alrededor de 2.000 permisos en
cada servicio del project. Un compromiso de ese servicio — un RCE, una key filtrada —
se convierte en: crear VMs (minería de cripto), leer todos los buckets, modificar todas
las bases de datos, borrar recursos, y leer Secret Manager.

También destruye tu capacidad de razonar sobre cualquier cosa. No podés responder "¿qué
puede hacer este servicio?" porque la respuesta es "casi todo", y no podés responder
"¿quién pudo haber borrado esto?" durante un incidente.

Y viola el principio que hace útil a IAM: **el conjunto de permisos debería documentar
lo que hace el servicio.** Una service account con
`pubsub.publisher` + `cloudsql.client` le dice a quien lea para qué es el servicio.

La solución: creá una SA dedicada, otorgá roles predefinidos sobre recursos
específicos, y usá IAM Recommender después de 90 días para recortar lo que no se usó.
Empezá angosto y agregá ante fallas — lleva minutos y las fallas son explícitas.
</details>

<details>
<summary><b>4.</b> El servicio A tiene que llamar al servicio B. Diseñá la auth sin secretos compartidos.</summary>

**En Cloud Run:**
1. B se deploya con `--no-allow-unauthenticated`, así que el front end de Google
   rechaza los requests no autenticados antes de invocar el container de B.
2. A corre como una service account dedicada, adjuntada en el deploy.
3. Otorgale a la SA de A `roles/run.invoker` **sobre el servicio B específicamente** —
   no a nivel project.
4. A usa `idtoken.NewClient(ctx, B_URL)`, que trae un token OIDC firmado por Google del
   metadata server con `aud` = la URL de B y lo adjunta.
5. Cloud Run verifica firma, expiración y audience contra el JWKS de Google.

No existe ningún secreto en ningún momento. Los tokens viven ~1 hora y se refrescan
solos.

**En GKE:** la misma idea con Workload Identity atando una SA de Kubernetes a una de
Google, más mTLS del mesh si tenés uno (Cápsula 08).

**Defensa en profundidad:** poné además `--ingress=internal` para que B no sea
alcanzable desde internet en absoluto, y hacé que B ejecute su propia autorización para
decisiones a nivel recurso (B3) en vez de confiar en que cualquiera que llegó tiene
permiso.
</details>

<details>
<summary><b>5.</b> ¿Cómo auditarías un project de GCP que acabás de heredar?</summary>

Más o menos en este orden, porque va de lo más barato primero y los pasos tempranos a
menudo encuentran el problema:

1. **¿Quién tiene owner/editor?** `get-iam-policy` filtrado por roles básicos. Humanos
   con owner y service accounts con editor son los hallazgos principales.
2. **Keys de service account gestionadas por usuario.** Cualquiera que exista es un
   hallazgo; el loop del Paso 1 de este lab las enumera.
3. **Acceso público** — `allUsers` / `allAuthenticatedUsers` en cualquier binding,
   especialmente buckets y servicios de Cloud Run.
4. **¿Qué está corriendo y cuánto sale?** `gcloud run services list`,
   `sql instances list`, `compute instances list`, más el reporte de facturación por
   SKU. Los recursos huérfanos son costo y superficie de ataque.
5. **Org policies** — ¿están restringidas la creación de keys, las IPs públicas y los
   buckets públicos?
6. **IAM Recommender** — 90 días de datos de uso proponiendo roles más angostos, gratis.
7. **Audit logs** — ¿está prendido el logging de Data Access donde importa? ¿Se exportan
   los logs a un bucket que los propios admins del project no puedan borrar?
8. **Networking** — reglas de firewall permitiendo `0.0.0.0/0`, VMs con IP pública,
   bases de datos con IP pública y redes autorizadas amplias.
9. **Manejo de secretos** — cualquier cosa en variables de entorno que debería estar en
   Secret Manager.

Escribilo como hallazgos con severidad y esfuerzo. Después arreglá primero el acceso
público y las keys — son las que tienen un camino de explotación activo.
</details>

---

## Registralo

```bash
cd ~/repos/pato/gravity-augmented && ./bin/scouter done B7
./bin/scouter status
```
