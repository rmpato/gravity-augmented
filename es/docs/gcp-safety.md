# Seguridad en GCP — hacé esto antes de cualquier comando de nube

> *Krilin murió más veces que nadie en la serie, y todas fueron evitables.*

Nada en este repo te obliga a gastar plata. Pero en el momento en que corrés tu
primer comando `gcloud`, sos dueño de una cuenta viva que te puede facturar.
Veinte minutos de setup ahora eliminan toda esa categoría de ansiedad.

**Hacé los seis pasos una vez. Después no pensés más en el tema.**

---

## 0. Entendé qué es gratis de verdad

Hay dos cosas distintas que la gente llama "gratis", y confundirlas es como te
llevás una sorpresa:

| | Qué es | ¿Vence? |
|---|---|---|
| **Free trial** | USD 300 en créditos por 90 días en una cuenta nueva | Sí — 90 días |
| **Free tier** | Un cupo mensual permanente en ~20 productos específicos | No |

El free tier permanente que importa para estas cápsulas:

- **Cloud Run** — 2M requests/mes, 180k vCPU-segundos, 360k GiB-segundos
- **Pub/Sub** — 10 GiB de throughput de mensajes/mes
- **Cloud Build** — 2.500 minutos de build/mes
- **Artifact Registry** — 0,5 GB de storage
- **Cloud Storage** — 5 GB-mes standard, regiones de EE.UU.
- **Firestore** — 1 GiB de storage, 50k lecturas / 20k escrituras por día
- **Cloud Logging** — 50 GiB de ingesta/mes
- **BigQuery** — 1 TiB de queries/mes, 10 GiB de storage

**Lo que NO es gratis, y es la fuente habitual de una factura sorpresa:**

- **Cloud SQL** — sin free tier. La instancia más chica sale más o menos
  **USD 8–10/mes**, facturados mientras exista, la uses o no. Las cápsulas 10–13
  corren Postgres en Docker justamente por eso.
- **Memorystore (Redis)** — sin free tier, ~USD 25/mes mínimo. Las cápsulas 14–15
  corren Redis en Docker.
- **Global external Application Load Balancer** — ~USD 18/mes solo por existir,
  antes de cualquier tráfico. La Cápsula 07 lo enseña y no te pide que lo
  levantes.
- **IPs estáticas externas, NAT gateways, control planes de GKE ociosos** — todos
  facturan por hora mientras están ahí.

El patrón: **servir requests sin estado y mensajería es barato o gratis;
cualquier cosa que te reserve capacidad 24/7 no lo es.**

---

## 1. Un project dedicado (un radio de explosión)

Nunca entrenes dentro de un project que tenga algo que te importe.

```bash
gcloud auth login

PROJECT_ID="gravity-chamber-$(whoami)-$RANDOM"
gcloud projects create "$PROJECT_ID" --name="Gravity Chamber"
gcloud config set project "$PROJECT_ID"

echo "$PROJECT_ID" > ~/.gravity-project   # acordate cuál era
```

Un project separado te da dos cosas: el radio de explosión de IAM queda
contenido, y borrar el project borra *todo* — el único teardown que nunca se
olvida de nada.

## 2. Vinculá facturación y ponele techo

Vinculá el project a una billing account desde la consola
(**Billing → Link a billing account**), y enseguida:

**Billing → Budgets & alerts → Create budget**

- Alcance: solo este project
- Monto: **USD 5/mes** (sí, cinco)
- Alertas al **50%, 90% y 100%** del gasto real
- Alertá también sobre el gasto **proyectado**

> Una alerta de presupuesto **no frena el gasto.** Te manda un mail. No existe un
> interruptor de "corte duro" en la consola. Si querés un kill switch real,
> conectá el topic de Pub/Sub del budget a una Cloud Function que llame a
> `projects.updateBillingInfo` con una billing account vacía — Google documenta
> este patrón como "Cap disable billing". Es exagerado para entrenar; importante
> saber que es el único techo real.

## 3. Fijá una región por defecto y quedate ahí

```bash
gcloud config set run/region us-central1
gcloud config set compute/region us-central1
gcloud config set artifacts/location us-central1
```

El tráfico entre regiones cuesta plata y suma latencia. Más práctico todavía:
los recursos que te olvidás suelen ser los que creaste en una región que no
mirás. Una región = un solo lugar donde buscar al hacer teardown.

## 4. Habilitá solo las APIs que pide cada cápsula

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com
```

Habilitar una API es gratis; solo hace alcanzable el producto. Habilitalas de a
una cápsula por vez para que `gcloud services list --enabled` siga siendo un
inventario preciso de lo que tocaste.

## 5. El hábito del teardown

**Toda cápsula con una sección ☁️ termina con un bloque de teardown. Corrélo el
mismo día.** No "cuando termine de experimentar" — el mismo día.

Barrido semanal, un domingo cualquiera:

```bash
gcloud run services list                     # vacío o lo esperado
gcloud sql instances list                    # SIEMPRE vacío
gcloud redis instances list --region=us-central1   # SIEMPRE vacío
gcloud compute addresses list                # las IPs reservadas facturan ociosas
gcloud compute forwarding-rules list         # load balancers
gcloud container clusters list               # los control planes de GKE facturan por hora
gcloud artifacts repositories list
```

Mirá el gasto real:

```bash
gcloud billing accounts list
# después: consola → Billing → Reports, agrupá por SKU, últimos 30 días
```

La opción nuclear, y con la que deberías sentirte cómodo:

```bash
gcloud projects delete "$PROJECT_ID"
```

Recuperable por 30 días, después desaparece. Creá uno nuevo la próxima vez —
tarda quince segundos.

## 6. Higiene de credenciales

- **Nunca crees una JSON key de service account** salvo que una cápsula lo diga
  explícitamente. Usá `gcloud auth application-default login` en local, y
  service accounts adjuntas / Workload Identity del lado de la nube. Una key de
  larga vida filtrada es la forma más común de que te tomen la cuenta de nube y
  la conviertan en una minera de cripto.
- **Nunca commitees** `.env`, credenciales `*.json`, ni un `terraform.tfstate`
  con secretos adentro. El `.gitignore` de tu `gravity-chamber` los cubre desde
  la Cápsula 00.
- Otorgá **el rol más angosto que funcione**. `roles/owner` en una service
  account es un olor en cualquier code review real en el que vayas a estar.

---

## El resumen en cinco líneas

1. Project separado, siempre.
2. Presupuesto de USD 5 con alertas al 50/90/100%, real **y** proyectado.
3. Una sola región.
4. Nunca dejes prendidos de un día para otro: Cloud SQL, Memorystore, un load
   balancer, una IP estática o un cluster de GKE.
5. Teardown el mismo día, o borrá el project.

Hacé esto y el peor resultado realista de todo este repo son unos centavos.
