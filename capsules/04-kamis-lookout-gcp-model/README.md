# Capsule 04 · Kami's Lookout — The GCP Mental Model

> *The Lookout sits above the planet. From there you can see the whole thing at
> once — which is a completely different skill from fighting on it.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 4 | 65 min | Capsules 00–03 | Local + ☁️ optional |

---

## Why this capsule exists

GCP has more than 200 products. Nobody learns them by browsing the catalogue.
What you actually need is a **map**: how the account is structured, where the
boundaries are, and how to answer "which of these five things should I use?"

By the end of this capsule you'll be able to look at any GCP service and place
it: what layer it sits in, what it's competing with, and roughly what it costs.
That skill outlives every specific product.

**Read [`docs/gcp-safety.md`](../../docs/gcp-safety.md) before running any
cloud commands in this capsule.** It is short and it is the difference between
a free education and a bill.

---

## The concept

### 1. The resource hierarchy

```
Organization            (your company; tied to a Cloud Identity/Workspace domain)
 └── Folder             (department / team / environment — optional, nestable)
      └── Project       ★ THE UNIT THAT MATTERS
           └── Resources (a Cloud Run service, a bucket, a database…)
```

**The project is the atom of GCP.** It is simultaneously:

- the **billing** unit (spend is attributed per project)
- the **IAM** boundary (roles are usually granted here)
- the **quota** boundary
- the **naming** scope (resource names must be unique within it)
- the **deletion** unit — delete the project, everything inside dies

Two consequences you should internalise:

- **Environments are separate projects.** `myapp-dev`, `myapp-staging`,
  `myapp-prod`. Not folders in the same project, not name prefixes. It's the
  only boundary that reliably stops a dev mistake from touching prod.
- **A throwaway project is a free blast radius.** Making one costs nothing and
  deleting it is the only teardown that never misses anything.

Policies set on a folder or org are **inherited downward**. That's how you say
"no public buckets anywhere in this company" once (Org Policy) rather than
auditing every project forever.

> If you're on a personal account you have no organization — projects sit
> directly under your account. Everything else works the same.

### 2. IAM: who can do what on which resource

```
    PRINCIPAL           ROLE                    RESOURCE
    (who)               (bundle of permissions) (on what)

    user:pato@…         roles/run.developer     project myapp-dev
    serviceAccount:…    roles/pubsub.publisher  topic power-readings
    group:eng@…         roles/viewer            folder engineering
```

Three role tiers, and you should know why the first one is a trap:

| Tier | Example | Verdict |
|---|---|---|
| **Basic** | `roles/owner`, `roles/editor`, `roles/viewer` | Legacy. `editor` grants ~2,000 permissions across every service. Never grant it in anything real. |
| **Predefined** | `roles/run.invoker`, `roles/storage.objectViewer` | The default choice. Google maintains them per-service. |
| **Custom** | your own list of permissions | When predefined is genuinely too broad and you'll maintain it. |

**Service accounts** are the concept people get wrong most often. A service
account is an identity for *code*, not a person. Your Cloud Run service runs
*as* a service account, and that's how it gets permission to publish to Pub/Sub
without any credentials in your code or config.

> **The single most important security rule in GCP:** never create and download
> a service-account JSON key unless you have exhausted every alternative. Keys
> are long-lived, they leak, and leaked keys are how cloud accounts get turned
> into crypto miners. Use **attached service accounts** (Cloud Run, GCE),
> **Workload Identity Federation** (from GitHub Actions or another cloud), and
> `gcloud auth application-default login` (locally). All three give short-lived,
> automatically-rotated credentials.

### 3. Geography: regions and zones

- **Zone** (`us-central1-a`) — roughly one datacenter. A single failure domain.
- **Region** (`us-central1`) — 3+ zones, close together, ~1 ms apart.
- **Multi-region** (`US`, `EU`) — a storage concept spanning regions.

The rules that follow from this:

- **Anything stateful should be replicated across at least 2 zones.** A zone
  can and does go down.
- **Cross-region traffic costs money and adds ~30–150 ms.** Keep your compute in
  the same region as your database. This one decision has more effect on p99
  latency than most code you'll write.
- **Egress to the internet costs money; ingress is free.** Traffic between zones
  in a region costs a little. Traffic within a zone is free. Your architecture
  diagram is also a billing diagram.
- **Data residency is a legal constraint**, not a preference. "EU user data
  stays in the EU" is a region choice.

### 4. The compute spectrum

The single most useful mental model in GCP. Left = more control, more work.
Right = less control, less work.

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

**How to actually choose:**

| Use | When |
|---|---|
| **Cloud Run** | Default for a stateless HTTP service or an event consumer. Scales to zero, per-request billing, one command to deploy, no cluster. |
| **GKE** | You need Kubernetes specifically: complex networking, operators, StatefulSets, a platform team, or many teams sharing infrastructure. |
| **Compute Engine** | You need a specific kernel, GPUs with unusual drivers, licensed software, or a lift-and-shift. |
| **Cloud Functions** | A single small event handler. (Cloud Functions v2 is Cloud Run underneath — so if in doubt, just use Cloud Run.) |

**We use Cloud Run for everything in this repo**, because it removes the
distraction of cluster management and lets each capsule be about the actual
concept. When Kubernetes is the right answer, everything you learn here
transfers — a container is a container.

### 5. The data spectrum

The other decision you'll be asked to justify constantly:

| Product | Model | Reach for it when |
|---|---|---|
| **Cloud SQL** | Managed Postgres/MySQL | Default. You want SQL, joins, transactions, and you're under a few TB. |
| **AlloyDB** | Postgres-compatible, faster | Cloud SQL is too slow and you can't leave Postgres. |
| **Spanner** | Globally distributed SQL, strong consistency | You genuinely need horizontal write scaling *and* transactions. Expensive; almost never the answer for a startup. |
| **Firestore** | Document DB, realtime, offline sync | Mobile/web apps with per-user documents. |
| **Bigtable** | Wide-column, single-key access, huge | Time series, IoT, > 10 TB, > 100k QPS. No joins, no transactions across rows. |
| **BigQuery** | Analytical warehouse | Aggregating billions of rows. *Never* your transactional store. |
| **Memorystore** | Managed Redis/Memcached | Caching (Capsule 14). |
| **Cloud Storage** | Object storage | Files, backups, static assets, data-lake landing zone. |

The right instinct: **start with Cloud SQL (Postgres)**, and only move when you
have measured a specific reason. Sagas 2 and 3 are largely about developing the
judgement to know which reason you have.

### 6. Networking, in one picture

```
  VPC (a software-defined private network, global in GCP — unusual and useful)
   ├── Subnet (regional, an IP range)
   │    └── your VMs / GKE nodes / Cloud Run with a VPC connector
   ├── Firewall rules      — allow/deny by tag or service account, default-deny in
   ├── Cloud NAT           — outbound internet for instances with no public IP
   └── Private Service Connect / VPC peering — reach Cloud SQL etc. privately
```

The thing worth remembering: **GCP VPCs are global**, unlike AWS. One VPC can
span every region, with regional subnets inside it. That simplifies multi-region
architectures considerably.

---

## Lab

### Part A — install and orient (no billing needed)

```bash
brew install --cask google-cloud-sdk
gcloud version
gcloud auth login
```

Explore the CLI's structure — it's `gcloud <group> <subgroup> <verb>`, and it's
consistent enough that you can guess:

```bash
gcloud --help | head -40
gcloud run --help
gcloud projects list
gcloud config list
```

Three flags worth learning now, because they turn `gcloud` from a UI into a
scriptable tool:

```bash
gcloud projects list --format=json
gcloud projects list --format="table(projectId, name, lifecycleState)"
gcloud projects list --format="value(projectId)"   # bare values, for pipes
gcloud run services list --filter="metadata.name~scouter"
```

> `--format` and `--filter` work on **every** gcloud command. Learning these two
> is worth more than memorising fifty commands.

### Part B — the ☁️ optional path: deploy the Scouter to Cloud Run

> **Free-tier eligible.** Cloud Run gives 2M requests/month free and scales to
> zero, so an idle service costs nothing. Total realistic cost of this section:
> **under $0.05.** Teardown is at the end and takes ten seconds.
>
> **Skip this entirely and you still complete the capsule.** Everything from
> Capsule 05 on runs locally.

**1. Project and guardrails** — follow [`docs/gcp-safety.md`](../../docs/gcp-safety.md)
first (dedicated project, $5 budget alert, default region). Then:

```bash
export PROJECT_ID=$(cat ~/.gravity-project)
export REGION=us-central1
gcloud config set project "$PROJECT_ID"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com
```

**2. An image registry**

```bash
gcloud artifacts repositories create gravity \
  --repository-format=docker \
  --location="$REGION" \
  --description="Gravity Chamber images"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

**3. Build for the right architecture and push**

Remember Capsule 02: your Mac builds `arm64`, Cloud Run wants `amd64`.

```bash
cd ~/repos/pato/gravity-chamber
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/gravity/scouter:$(git rev-parse --short HEAD)"

docker build --platform linux/amd64 -f deploy/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

(Slow under emulation. That's why real pipelines build on amd64 runners.)

**4. Deploy**

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

Read the flags — every one is a lesson from a later capsule:
`--min-instances=0` is scale-to-zero (free when idle, at the cost of cold
starts — Capsule 06). `--max-instances=3` is a spending ceiling as much as a
capacity one. `--allow-unauthenticated` makes it public; without it you'd need
an identity token, which is Capsule B3 and Capsule 08.

**5. Use it**

```bash
URL=$(gcloud run services describe scouter --region="$REGION" --format='value(status.url)')
echo "$URL"

curl -s "$URL/healthz" | jq
curl -s -XPOST "$URL/readings" -d '{"fighter":"frieza","power":530000}' | jq
curl -s "$URL/leaderboard" | jq
```

**Your service is on the internet, behind TLS, with a real certificate,
autoscaling, and you wrote no infrastructure.** That is what Cloud Run is for.

**6. Look at the logs it collected for free**

```bash
gcloud run services logs read scouter --region="$REGION" --limit=20

# structured querying — this works because Capsule 01 logged JSON to stdout
gcloud logging read \
  'resource.type=cloud_run_revision AND jsonPayload.status>=400' \
  --limit=10 --format=json | jq '.[].jsonPayload'
```

Those JSON fields are queryable **because** you used `slog` with a JSON handler.
Prose logs would have needed regexes.

**7. See the cost model**

```bash
gcloud run services describe scouter --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].resources, spec.template.metadata.annotations)"
```

Cloud Run bills for vCPU-seconds and GiB-seconds *while a request is in flight*
(plus a per-request fee). No traffic → no instances → no charge. That billing
model is exactly why "stateless and fast to start" is worth engineering for.

**8. TEAR IT DOWN — same day, no exceptions**

```bash
gcloud run services delete scouter --region="$REGION" --quiet
gcloud artifacts repositories delete gravity --location="$REGION" --quiet

# verify nothing is left
gcloud run services list
gcloud artifacts repositories list
```

---

## Checkpoint

Local path (everyone):

```bash
gcloud version
gcloud projects list --format="value(projectId)" | head
gcloud run --help >/dev/null && echo "cli ok"
```

Answer these from memory before continuing — write them in `NOTES.md`:

1. What is the unit of billing, IAM and deletion in GCP?
2. What's the difference between a zone and a region, and why does it matter for
   a database?
3. When would you choose GKE over Cloud Run? Give a reason that isn't "it's more
   powerful."
4. Why is a downloaded service-account key a bad idea, and what replaces it in
   each of: Cloud Run, GitHub Actions, your laptop?

---

## Bring it to work

- **Separate projects per environment.** If your company has dev and prod in one
  project, that's a finding worth raising.
- **Predefined roles, never `roles/editor`.** Ask "what's the narrowest role
  that works?" in every access request.
- **Attached service accounts and Workload Identity Federation.** Downloaded
  keys are the thing an auditor finds and the thing an attacker uses.
- **`--format` and `--filter`** turn gcloud into something you can script and
  put in CI.
- **Same region for compute and data**, and know that egress costs money. A
  surprising amount of "why is our bill so high" is cross-region chatter.
- **Budget alerts on every project**, including sandboxes. Especially sandboxes.

---

## Battle drill

<details>
<summary><b>1.</b> Your team wants dev and prod in one project, separated by resource name prefixes. Argue against it.</summary>

IAM can't cleanly separate them — anyone with `run.developer` can deploy to
both. Quotas are shared, so a runaway dev job can exhaust prod's quota. Billing
can't be attributed without meticulous labelling. A misdirected `gcloud` command
with the wrong prefix hits production. And deleting dev means picking resources
by hand rather than deleting a project.

Separate projects cost nothing extra and give you all of those boundaries for
free.
</details>

<details>
<summary><b>2.</b> A service needs to read from Cloud Storage. Walk through granting access without a key file.</summary>

Create a dedicated service account for the service. Grant it
`roles/storage.objectViewer` **on that specific bucket** (not project-wide).
Attach it at deploy time (`--service-account=…`). The Google client library
picks up credentials from the metadata server automatically — Application
Default Credentials.

No key exists, so no key can leak, and the token it does get is short-lived and
auto-rotated. Locally, `gcloud auth application-default login` makes the same
code path work with *your* identity.
</details>

<details>
<summary><b>3.</b> Cloud Run vs GKE for a team of four shipping one web app?</summary>

Cloud Run, comfortably. GKE means owning cluster upgrades, node pools, network
policy, ingress controllers and an autoscaler — a platform job. With four people
that's a person you don't have.

Move to GKE when you have a concrete need: sidecar-based service mesh,
StatefulSets, GPU scheduling, operators, tight pod-level network policy, or many
teams needing a shared platform. "It'll scale better" is not a reason —
Cloud Run scales to thousands of instances.
</details>

<details>
<summary><b>4.</b> What are the trade-offs of <code>--min-instances=0</code>?</summary>

**For:** zero cost when idle. Ideal for dev, internal tools, spiky workloads.

**Against:** cold starts. The first request after idle waits for a container
pull, process start and any warm-up — tens of milliseconds for a small Go binary,
several seconds for a JVM or a large Python app with heavy imports. That's a p99
spike that correlates exactly with your least-loved, lowest-traffic endpoints.

`--min-instances=1` keeps one warm and bills you for an always-on instance.
The Go binary you built is small and starts fast, which is precisely why
language choice affects your architecture options.
</details>

<details>
<summary><b>5.</b> Why does GCP having global VPCs matter?</summary>

In AWS, a VPC is regional, so multi-region means multiple VPCs plus peering or a
transit gateway plus non-overlapping CIDR planning. In GCP one VPC spans all
regions with regional subnets inside it, so instances in `us-central1` and
`europe-west1` are on the same private network with no peering.

It makes multi-region architectures meaningfully simpler. (Traffic between them
still costs money and still takes 100 ms — global doesn't mean free or fast.)
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `gcloud: command not found` after brew | Restart the shell, or `source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"`. |
| `PERMISSION_DENIED` on any API | The API isn't enabled: `gcloud services enable <name>.googleapis.com`. |
| `denied: Permission "artifactregistry.repositories.uploadArtifacts"` | Run `gcloud auth configure-docker <region>-docker.pkg.dev`. |
| Container fails to start on Cloud Run | Usually (a) wrong architecture — rebuild `--platform linux/amd64`; (b) not listening on `$PORT`; (c) bound to `127.0.0.1` instead of `:8080`. |
| `Cloud Run error: container failed to start and listen on port` | Check `gcloud run services logs read scouter` — the real error is always there. |
| Billing account required | Cloud Run needs billing linked even to use the free tier. Set the $5 budget alert first. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "docs(gcp): notes on the GCP resource and compute model

Capsule 04. Project as the billing/IAM/deletion boundary, compute spectrum,
data spectrum, region strategy. Deployed scouter to Cloud Run and tore it down."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 04
```

**Next:** [Capsule 05 · Kaio-ken — Vertical Scaling and Its Price](../05-kaio-ken-vertical-scaling/README.md)
