# GCP safety — do this before any cloud command

> *Krillin has died more times than anyone in the series, and every time it was
> avoidable.*

Nothing in this repo requires you to spend money. But the moment you run your
first `gcloud` command, you own a live account that can bill you. Twenty minutes
of setup now removes that entire class of anxiety.

**Do all six steps once. Then never think about it again.**

---

## 0. Understand what's actually free

There are two different things people call "free" and confusing them is how
people get surprised:

| | What it is | Expires? |
|---|---|---|
| **Free trial** | $300 in credits for 90 days on a new account | Yes — 90 days |
| **Free tier** | A permanent monthly allowance on ~20 specific products | No |

The always-free tier that matters for these capsules:

- **Cloud Run** — 2M requests/month, 180k vCPU-seconds, 360k GiB-seconds
- **Pub/Sub** — 10 GiB of message throughput/month
- **Cloud Build** — 2,500 build-minutes/month
- **Artifact Registry** — 0.5 GB storage
- **Cloud Storage** — 5 GB-months standard, US regions
- **Firestore** — 1 GiB storage, 50k reads / 20k writes per day
- **Cloud Logging** — 50 GiB ingestion/month
- **BigQuery** — 1 TiB queries/month, 10 GiB storage

**Not free, and the usual source of a surprise bill:**

- **Cloud SQL** — no free tier. The smallest instance is roughly **$8–10/month**,
  billed while it exists whether or not you use it. Capsules 09–12 run Postgres
  in Docker for exactly this reason.
- **Memorystore (Redis)** — no free tier, ~$25/month minimum. Capsules 13–14 run
  Redis in Docker.
- **Global external Application Load Balancer** — ~$18/month just to exist,
  before any traffic. Capsule 07 teaches it, and does not ask you to run it.
- **Static external IPs, NAT gateways, idle GKE control planes** — all bill hourly
  while idle.

The pattern: **stateless request-serving and messaging are cheap or free;
anything that reserves capacity for you 24/7 is not.**

---

## 1. A dedicated project (a blast radius)

Never train inside a project that holds anything you care about.

```bash
gcloud auth login

PROJECT_ID="gravity-chamber-$(whoami)-$RANDOM"
gcloud projects create "$PROJECT_ID" --name="Gravity Chamber"
gcloud config set project "$PROJECT_ID"

echo "$PROJECT_ID" > ~/.gravity-project   # remember it
```

A separate project gives you two things: the IAM blast radius is contained, and
deleting the project deletes *everything* — the only teardown that never misses.

## 2. Attach billing, then cap it

Link the project to a billing account in the console
(**Billing → Link a billing account**), then immediately:

**Billing → Budgets & alerts → Create budget**

- Scope: this project only
- Amount: **$5/month** (yes, five)
- Alerts at **50%, 90%, 100%** of actual spend
- Also alert on **forecasted** spend

> A budget **alert does not stop spending.** It emails you. There is no
> "hard stop" switch in the console. If you want a real kill switch, wire the
> budget's Pub/Sub topic to a Cloud Function that calls
> `projects.updateBillingInfo` with an empty billing account — Google documents
> this pattern under "Cap disable billing". Overkill for training; important
> to know it's the only true cap.

## 3. Set a default region and stick to it

```bash
gcloud config set run/region us-central1
gcloud config set compute/region us-central1
gcloud config set artifacts/location us-central1
```

Cross-region traffic costs money and adds latency. More practically: resources
you forget about are usually the ones you created in a region you don't check.
One region = one place to look during teardown.

## 4. Enable only the APIs a capsule asks for

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com
```

Enabling an API is free; it just makes the product reachable. Enable them one
capsule at a time so `gcloud services list --enabled` stays an accurate
inventory of what you've touched.

## 5. The teardown habit

**Every capsule with a ☁️ cloud section ends with a teardown block. Run it the
same day.** Not "when I'm done experimenting" — the same day.

Weekly sweep, from a normal Sunday:

```bash
gcloud run services list                     # should be empty or expected
gcloud sql instances list                    # should ALWAYS be empty
gcloud redis instances list --region=us-central1   # should ALWAYS be empty
gcloud compute addresses list                # reserved IPs bill while idle
gcloud compute forwarding-rules list         # load balancers
gcloud container clusters list               # GKE control planes bill hourly
gcloud artifacts repositories list
```

Check actual spend:

```bash
gcloud billing accounts list
# then: console → Billing → Reports, group by SKU, last 30 days
```

The nuclear option, and the one you should be comfortable using:

```bash
gcloud projects delete "$PROJECT_ID"
```

Recoverable for 30 days, then gone. Make a new project next time — it takes
fifteen seconds.

## 6. Credentials hygiene

- **Never create a service-account JSON key** unless a capsule explicitly says
  so. Use `gcloud auth application-default login` locally, and attached service
  accounts / Workload Identity on the cloud side. A leaked long-lived key is the
  single most common way cloud accounts get taken over and turned into crypto
  miners.
- **Never commit** `.env`, `*.json` credentials, or a `terraform.tfstate`
  containing secrets. Your `gravity-chamber` `.gitignore` covers these from
  Capsule 00.
- Grant the **narrowest role that works**. `roles/owner` on a service account is
  a smell in every real code review you will ever be in.

---

## The five-line summary

1. Separate project, always.
2. $5 budget with alerts at 50/90/100%, actual **and** forecasted.
3. One region.
4. Never leave Cloud SQL, Memorystore, a load balancer, a static IP, or a GKE
   cluster running overnight.
5. Teardown the same day, or delete the project.

Do this and the worst realistic outcome of this entire repo is a few cents.
