# Capsule 03 · Bulma's Blueprints — Reproducible Environments & IaC

> *Bulma never builds the same machine twice from memory. She keeps the
> blueprints. That is the entire reason Capsule Corp can produce a gravity
> chamber, have Vegeta destroy it, and produce it again by Friday.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 4 | 65 min | Capsules 00–02 | Local |

---

## Why this capsule exists

There are two ways infrastructure comes into existence:

1. Someone clicks through a console. It works. Nobody knows what they clicked.
2. Someone writes a file, commits it, another person reviews it, a tool applies it.

The first one is faster today and catastrophic in eighteen months. The knowledge
lives in one person's head; nothing can be recreated; the staging environment
has quietly drifted from production; and the thing that breaks at 3am is a
setting nobody remembers making.

This capsule covers both halves of reproducibility:

- **Locally** — `docker compose`, so your whole stack (soon: Postgres, Redis,
  the Pub/Sub emulator) starts with one command and is identical for everyone.
- **In the cloud** — **Terraform**, so infrastructure is a reviewable file.

You will learn Terraform properly here **without spending a cent and without a
GCP account**, using local providers. The mechanics — state, plan, apply,
drift, dependency graphs — are identical no matter which provider you point it at.

---

## Part 1 — docker compose

### The concept

Compose declares a set of containers, their config, their network and their
volumes in one YAML file. The point is not "avoid long `docker run` commands" —
it's that **the file is the environment**, versioned next to the code that needs
it. A new teammate runs one command and has exactly your stack.

Three things it gives you that matter:

- **A shared network with DNS by service name.** From inside `scouter`, the
  hostname `postgres` resolves to the database container. No IPs, ever.
- **Named volumes** — persistence that survives `down` but that you can wipe
  deliberately with `down -v`.
- **`depends_on` + healthchecks** — start ordering that actually waits for
  *ready*, not just *started*. (Plain `depends_on` without `condition` only
  waits for the process to launch, which is the classic "app crashed because
  Postgres wasn't accepting connections yet" bug.)

### Lab

**`deploy/docker-compose.yml`** in `gravity-chamber`:

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

> **The distroless healthcheck problem.** A `HEALTHCHECK` runs *inside* the
> container, but distroless has no `curl` and no shell. Three real options:
> (a) give your binary a `-health` flag that makes an HTTP call to itself and
> exits 0/1 — cheap and self-contained; (b) drop the container healthcheck and
> let the orchestrator probe `/readyz` over HTTP, which is what Cloud Run,
> Kubernetes and load balancers all do anyway; (c) use `alpine` as the runtime
> base and lose the distroless benefits.
>
> **In production, (b) is the right answer** — the platform probes over the
> network. We'll implement (a) below anyway, because it's five lines and it
> makes compose behave.

Add the health flag to **`cmd/scouter/main.go`**, right at the top of `main()`:

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

Run it:

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

Add to the Makefile:

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

> ### ⏸ Natural stopping point
>
> Part 1 (compose) and Part 2 (Terraform) are independent. Commit the compose
> work and come back for Terraform — you lose nothing by splitting here.

## Part 2 — Terraform

```bash
brew install terraform
terraform version
```

### The concept

You declare the **desired state** of the world. Terraform compares that to the
**recorded state** and the **real state**, and produces a plan of the minimum
changes needed. It is *declarative* and *convergent*: running it twice changes
nothing the second time.

```
  your .tf files          terraform.tfstate           the real world
  "I want 3 of X"   vs    "last time: 2 of X"   vs   "actually: 2 of X"
                    │
                    └──> plan: + 1 to add
```

Four ideas do most of the work:

**1. State is the crown jewels.** `terraform.tfstate` maps your resource names
to real cloud IDs. Lose it and Terraform no longer knows it owns anything — it
will try to create everything again. Corrupt it and it may delete the wrong
thing. Therefore: **remote state in a versioned bucket, with locking, never in
git.** State also contains resource attributes including secrets in plaintext,
which is the second reason it never goes in git.

**2. `plan` is the review artifact.** `terraform plan` shows adds, changes and
**destroys** before anything happens. In a real team, `plan` runs in CI on every
PR and the output is what a reviewer reads. A plan containing an unexpected
`- destroy` or `-/+ must be replaced` is a blocked PR — that's how you catch
"changing this one field silently recreates the database."

**3. The dependency graph is implicit.** When resource B references
`resource_a.id`, Terraform infers the ordering and parallelises everything else.
You almost never need explicit ordering.

**4. Modules are functions.** Inputs (variables), a body (resources), outputs.
The same module with different `.tfvars` gives you dev and prod from one
definition — which is how you stop environments from drifting apart.

### Lab — Terraform with no cloud account

We'll use the `local` and `random` providers. Zero cost, zero credentials, and
the workflow is identical to the GCP one.

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

Now walk the whole lifecycle. Read every output; the point is the *workflow*.

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

**Now make it interesting.**

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

Step 1 is the lesson hiding in this lab. Changing one number *looks* like an
update, but whether a change is `~ update in-place` or `-/+ replace` is not
yours to decide: the provider decides it, attribute by attribute. `local_file`
has no "edit" operation, so every content change is a replacement. For a file
that costs nothing. On a real cloud, many attributes (a label, a Cloud Run
service's scaling limits) do update in place and show `~`, but some
innocent-looking ones force a replacement. The plan tells you which, on the line marked
`# forces replacement`. That is why you read every plan instead of guessing.

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

`.terraform.lock.hcl` **does** get committed — it pins provider versions and
checksums so everyone and CI resolve identically. Same role as `go.sum`.

### What the GCP version looks like

You'll run this in Capsule 04. Read it now so it isn't new then:

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

Same four ideas. Different nouns.

> **The bootstrap chicken-and-egg:** the GCS bucket that holds state cannot
> itself be created by the Terraform that uses it. Everyone creates that one
> bucket by hand (or with a tiny separate config), turns on **object
> versioning**, and never touches it again. Versioning is your undo button when
> a state file gets corrupted.

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

> `terraform plan -detailed-exitcode` returns **0** for no changes, **2** for
> changes pending, **1** for error. That's the exit code you gate CI on.

---

## Bring it to work

- **`terraform plan` in CI on every PR, posted as a comment.** Reviewing
  infrastructure diffs is the entire point; a plan nobody reads is theatre.
- **Read plans for the word "replace".** In-place updates are cheap. Replacement
  destroys and recreates — on a database, that is a career-defining afternoon.
- **Remote state, versioned bucket, locking on.** Two people applying at once
  without a lock will corrupt state.
- **Commit the lock file** (`.terraform.lock.hcl`), gitignore the state.
- **`terraform fmt -check` and `validate` in CI.** Free, instant, prevents
  entire categories of review noise.
- **Never `terraform apply` from a laptop against production.** It runs in CI
  with a service account whose permissions are narrower than yours.
- **Compose file in the repo, one `make up` to start everything.** Onboarding
  time drops from a day to a coffee.

---

## Battle drill

<details>
<summary><b>1.</b> A colleague deletes <code>terraform.tfstate</code> and runs <code>apply</code>. What happens?</summary>

Terraform believes it manages nothing, so it plans to **create everything from
scratch**. Against a real cloud that means either duplicate resources or errors
on names that already exist — and the pre-existing resources are now *orphaned*:
real, billing, and unmanaged.

Recovery is `terraform import` for each resource, one at a time, matching real
IDs to addresses. It is slow and miserable. Which is why remote state lives in a
bucket with **object versioning** — you restore the previous version and move on.
</details>

<details>
<summary><b>2.</b> Why is <code>depends_on: [postgres]</code> in compose not enough?</summary>

It waits for the container to *start*, not for Postgres to *accept connections*.
Postgres takes several seconds to initialise, so your app connects, fails, and
exits — a startup race that shows up as "works on the second try."

The fix: a `healthcheck` on the dependency plus
`depends_on: { postgres: { condition: service_healthy } }`.

The better fix, and the one that matters in production: make the app **retry its
dependencies with backoff at startup** and report not-ready in the meantime.
Orchestrators don't guarantee start order at all, so an app that requires it is
fragile everywhere, not just in compose.
</details>

<details>
<summary><b>3.</b> Someone changes a setting in the GCP console. What does Terraform do next run?</summary>

`plan` refreshes real state, sees the difference, and proposes reverting it —
this is **drift detection**, and it's one of Terraform's most valuable
properties. The manual change silently disappears at the next apply, which is
correct: if it should exist, it should be in the code.

Mature teams run `plan` on a schedule (nightly) purely to alert on drift, and
treat any drift as either an incident or a missing code change.
</details>

<details>
<summary><b>4.</b> Terraform vs. Cloud Deployment Manager vs. Pulumi vs. clicking?</summary>

- **Terraform / OpenTofu** — the de facto standard, multi-cloud, huge provider
  ecosystem, declarative HCL. Default choice, and the one job listings ask for.
- **Pulumi / CDK** — real programming languages. Better abstraction and testing,
  at the cost of it being much easier to write something clever that nobody can
  review. Reach for it when you genuinely need loops and logic.
- **Config Connector / Crossplane** — infrastructure as Kubernetes resources.
  Great if you already live in Kubernetes, needless coupling if you don't.
- **Clicking** — fine for *exploring*. Never for anything that must exist
  tomorrow. A useful compromise: click to explore, then
  `gcloud … --format=export` or Terraformer to generate the config, then commit.
</details>

<details>
<summary><b>5.</b> Why does Terraform state contain secrets, and what do you do about it?</summary>

State stores the full attributes of every resource, including generated
passwords, keys and connection strings, in **plaintext JSON**. Marking a
variable `sensitive = true` only hides it from CLI output — it's still in state.

Mitigations: remote state in a bucket with encryption at rest and tightly scoped
IAM (very few humans should have read access); never commit state; and prefer
resources that reference a secret store (Secret Manager) over ones that generate
and hold the secret themselves.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `Error acquiring the state lock` | A previous run died. Confirm nobody is applying, then `terraform force-unlock <ID>`. |
| Compose can't reach `scouter` by name | Containers must share a network (compose does this by default) and you must use the **service name**, not `localhost`. |
| `port is already allocated` | Something else holds 8080. `lsof -i :8080` or change the host side of the mapping. |
| Healthcheck always unhealthy | Distroless has no shell — the `test` must be exec form pointing at a real binary. Check you added the `-health` branch. |
| `terraform plan` wants to recreate everything | Wrong workspace, missing state, or a changed `backend` config. Check `terraform workspace show` and that `init` picked up the right backend. |
| Provider version drift between machines | You didn't commit `.terraform.lock.hcl`. Commit it. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(deploy): docker compose stack and terraform foundations

Capsule 03. Compose for the local stack with a working healthcheck on a
distroless image. Terraform lifecycle practised with local providers:
plan/apply/drift/destroy, state gitignored, lock file committed."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 03
```

**Next:** [Capsule 04 · Kami's Lookout — The GCP Mental Model](../04-kamis-lookout-gcp-model/README.md)
