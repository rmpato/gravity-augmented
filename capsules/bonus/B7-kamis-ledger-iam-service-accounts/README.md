# Capsule B7 · Kami's Ledger — GCP IAM, Service Accounts & Workload Identity

> *Kami doesn't fight either. He keeps the ledger: who may enter the Lookout,
> who may drink the Ultra Divine Water, who is permitted to summon Shenron.
> Every disaster in the series starts with the wrong person getting access to
> something they should not have had.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 75 min | Capsule 04 · optional [B3](../B3-fortuneteller-baba-auth/README.md) | Capsule 04 |

---

## Why this capsule exists

**A downloaded service-account key is the single most common way a Google Cloud
account gets compromised.** It leaks into a git repo, a Docker image layer, a CI
log, a Slack message — and it's a long-lived credential with no expiry that
someone will find with an automated scanner within hours.

Every alternative in this capsule is free, better, and usually less work. The
only reason people use keys is that nobody showed them the alternatives.

This is also the GCP topic most likely to come up in a real job, because
"how does this service get permission to do that?" is a question you'll answer
every week.

---

## The IAM model

```
   WHO             CAN DO WHAT              ON WHAT
   ──────────      ────────────────────     ──────────────────────
   principal   +   role (permissions)   +   resource        = a binding

   user:pato@x.com         roles/run.developer      project my-app-dev
   serviceAccount:api@…    roles/pubsub.publisher   topic power-readings
   group:eng@x.com         roles/viewer             folder engineering
   principalSet://…        roles/run.invoker        service scouter
```

**Principals:**

| Type | Example | Notes |
|---|---|---|
| Google account | `user:pato@example.com` | a human |
| Service account | `serviceAccount:api@proj.iam.gserviceaccount.com` | **an identity for code** |
| Group | `group:engineers@example.com` | **grant to groups, not people** |
| Domain | `domain:example.com` | everyone in the org |
| `allUsers` | — | ⚠️ the public internet |
| `allAuthenticatedUsers` | — | ⚠️ **anyone with any Google account**, not just yours |
| Workload Identity pool | `principalSet://iam.googleapis.com/...` | external workloads (GitHub, AWS) |

> **`allAuthenticatedUsers` does not mean "people in my company".** It means
> anyone on Earth with a Gmail address. It's a frequent and serious
> misconfiguration.

**Roles** come in three tiers (Capsule 04), and the summary is:
use **predefined** roles, never `roles/editor`, and reach for custom only when
predefined is genuinely too broad *and* you'll maintain it.

**Inheritance flows down**: Organization → Folder → Project → Resource. A role
granted at the project level applies to every resource in it. **There is no
"deny by inheritance" by default** — you can't take away at a lower level what
was granted higher up, except with an explicit **deny policy** (a separate,
newer mechanism that is evaluated before allow).

---

## Service accounts, properly understood

A service account is **an identity for code**, and it is simultaneously two
things, which is the part that confuses people:

1. **A principal** — you grant it roles, like a user.
2. **A resource** — you grant *other* principals roles *on it* (like
   `roles/iam.serviceAccountUser`, which permits acting as it).

That duality is why service accounts appear on both sides of IAM bindings, and
why privilege escalation via service accounts is a real risk: if I can *act as*
a powerful service account, I have its powers regardless of my own.

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

**The default service account is a trap.** Compute Engine and Cloud Run use a
default SA that historically has `roles/editor` on the whole project — roughly
2,000 permissions. Anything running there can do almost anything. Always create
a dedicated service account per service.

---

## How code gets credentials, in order of preference

### 1. Attached service account (best) — Cloud Run, GKE, GCE

The platform provides credentials through the **metadata server**. Your code asks
for them via Application Default Credentials and never sees a secret.

```go
// The client library finds credentials automatically. This EXACT code works:
//   - locally, using YOUR identity from `gcloud auth application-default login`
//   - on Cloud Run, using the ATTACHED service account
//   - in GKE, using Workload Identity
// No branching, no config, no key file.
client, err := pubsub.NewClient(ctx, projectID)
```

You can see the mechanism directly:

```bash
# from inside a Cloud Run container or a GCE VM
curl -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
```

Short-lived (~1 hour), auto-rotated, never on disk.

### 2. Workload Identity Federation — for anything outside GCP

The answer for GitHub Actions, GitLab CI, AWS, Azure, or on-prem. **No key
required.**

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

**No secret in GitHub. Nothing to rotate. Nothing to leak.**

> The `attribute.repository` condition is the security boundary. Bind to the
> *pool* rather than a specific repository and you have created a service account
> that any GitHub repo on the internet can assume. This misconfiguration has been
> found in the wild repeatedly.

### 3. Impersonation — for humans and for narrowing privilege

```bash
# run a command as a service account without any key
gcloud storage ls --impersonate-service-account=reader@proj.iam.gserviceaccount.com

# make the client libraries do it too
gcloud auth application-default login \
  --impersonate-service-account=reader@proj.iam.gserviceaccount.com
```

Needs `roles/iam.serviceAccountTokenCreator` on the target SA. This is the right
way to test "what can this service actually do?" — and to give a human temporary,
audited elevated access.

### 4. A downloaded JSON key (last resort)

```bash
# Only when there is genuinely no alternative. And then:
gcloud iam service-accounts keys create key.json --iam-account=...
```

**If you must:** store it in Secret Manager (never in git, never in an image),
rotate it on a schedule, restrict it with an org policy so keys can only be
created where explicitly allowed, and monitor its usage in Cloud Audit Logs.

**Block key creation org-wide** — one org policy that removes an entire class of
incident:

```bash
gcloud resource-manager org-policies enable-enforce \
  iam.disableServiceAccountKeyCreation --organization=$ORG_ID
```

---

## Service-to-service authentication

The pattern for one Cloud Run service calling another. **No keys, no shared
secrets, ~10 lines.**

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

Cloud Run verifies the token **before your container is invoked** — an
unauthenticated request never reaches your code at all.

**On GKE, the equivalent is Workload Identity**: bind a Kubernetes service
account to a Google service account, and pods get GCP credentials with no keys:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "scouter-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[default/scouter-ksa]"

kubectl annotate serviceaccount scouter-ksa \
  iam.gke.io/gcp-service-account="scouter-api@${PROJECT_ID}.iam.gserviceaccount.com"
```

---

## Least privilege in practice

**Grant on the narrowest resource that works:**

```bash
# ❌ project-wide: this SA can read and write EVERY bucket
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:app@..." --role="roles/storage.admin"

# ✅ one bucket, read only
gcloud storage buckets add-iam-policy-binding gs://scouter-uploads \
  --member="serviceAccount:app@..." --role="roles/storage.objectViewer"
```

**Find out what a service actually used** — the tool most people don't know
exists:

```bash
# IAM Recommender analyses 90 days of usage and proposes narrower roles
gcloud recommender recommendations list \
  --project=$PROJECT_ID \
  --recommender=google.iam.policy.Recommender \
  --location=global \
  --format="table(content.overview.member, content.overview.removedRole)"
```

**Policy Troubleshooter** — for "why can't this thing do that?", which otherwise
costs an hour:

```bash
gcloud policy-troubleshoot iam \
  //run.googleapis.com/projects/$PROJECT_ID/locations/us-central1/services/ranker \
  --principal-email=scouter-api@${PROJECT_ID}.iam.gserviceaccount.com \
  --permission=run.routes.invoke
```

**IAM Conditions** — time-bounded or attribute-based grants:

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="user:oncall@example.com" \
  --role="roles/cloudsql.admin" \
  --condition='expression=request.time < timestamp("2026-08-06T00:00:00Z"),title=incident-4821'
```

Break-glass access that expires by itself is enormously better than break-glass
access somebody has to remember to revoke.

---

## Lab

### Step 1 — inspect what you actually have

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

Any output from that last loop is a finding. `--managed-by=user` is the
important flag — Google-managed keys are fine and rotate automatically;
user-managed keys are the downloaded JSON files.

### Step 2 — a least-privilege service account

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

> If impersonation fails, grant yourself
> `roles/iam.serviceAccountTokenCreator` on that SA. Note that you needed an
> explicit permission to *act as* another identity — that's the escalation
> control working.

### Step 3 — service-to-service auth end to end

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

**Decode the identity token** and see the claims from B3:

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

Same JWT structure, Google-signed, short-lived, verified by Cloud Run against
Google's public JWKS. **You wrote none of that.**

### Step 4 — Workload Identity Federation for CI

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

Note **both** guards: `--attribute-condition` on the provider (only your org) and
the `attribute.repository` in the member (only that repo). Belt and braces,
because the failure mode is "anyone on GitHub can deploy to your project".

### Step 5 — audit logs

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

**Admin Activity logs are free and always on.** Data Access logs are opt-in and
can be expensive at volume — enable them selectively on sensitive resources.

An alert on `SetIamPolicy` for `roles/owner` is one of the highest-value security
alerts you can create, and it takes two minutes.

### Step 6 — clean up

```bash
gcloud pubsub topics delete b7-lab-topic --quiet
gcloud iam service-accounts delete "scouter-lab@${PROJECT_ID}.iam.gserviceaccount.com" --quiet
gcloud run services delete ranker --quiet 2>/dev/null || true
```

---

## Bring it to work

- **Never create a downloaded service-account key.** Enforce it with an org
  policy so nobody can.
- **A dedicated service account per service.** Never the default SA, never one
  shared SA for everything.
- **Grant on the narrowest resource**, not the project.
- **Grant to groups, not individuals** — offboarding becomes a group membership
  change instead of an audit.
- **Attached SA → Workload Identity Federation → impersonation → key.** In that
  order, and you should almost never reach the last one.
- **Set the `audience`** on identity tokens (B3).
- **Run IAM Recommender quarterly** and act on it.
- **`allUsers` and `allAuthenticatedUsers` need a written justification.**
- **Alert on `SetIamPolicy` for owner/editor**, and on any service-account key
  usage.
- **IAM Conditions for break-glass** so elevated access expires on its own.

---

## Battle drill

<details>
<summary><b>1.</b> A service-account key was committed to a public repo. Walk through the response.</summary>

**Assume it's compromised.** Automated scanners find public keys within minutes,
and there are bots that do nothing else.

1. **Disable the key immediately** —
   `gcloud iam service-accounts keys delete <KEY_ID> --iam-account=<SA>`. Do this
   before anything else, including the git cleanup.
2. **Assess the blast radius** — what roles did that SA hold, on what resources?
   This is why least privilege matters *before* the incident.
3. **Audit its usage** — query Cloud Audit Logs for
   `protoPayload.authenticationInfo.serviceAccountKeyName` matching that key.
   Look for unfamiliar IPs, unusual regions, resource creation (crypto mining is
   the usual payload), and data reads.
4. **Check for persistence** — new service accounts, new keys, new IAM bindings,
   new VMs, modified firewall rules. Attackers establish a foothold before they
   monetise.
5. **Rotate anything the key could reach** — secrets it could read, databases it
   could access.
6. **Then** clean the repo, and understand that history rewriting is cleanup, not
   remediation (Capsule 00).
7. **Prevent recurrence**: enable
   `iam.disableServiceAccountKeyCreation` org-wide, migrate to Workload Identity
   Federation, and add secret scanning to CI.

The one-sentence lesson: the *reason* this is survivable at all is that the SA
had narrow permissions. If it had `roles/editor`, this is a full account
compromise.
</details>

<details>
<summary><b>2.</b> Explain Workload Identity Federation to someone who uses key files.</summary>

Today: you download a JSON key, paste it into GitHub Secrets, and now a
permanent, non-expiring credential exists in at least two places forever. If it
leaks, anyone can use it from anywhere, indefinitely.

With federation: GitHub already proves who it is. Every workflow run gets a
short-lived OIDC token from GitHub saying "this is repo `myorg/myapp`, workflow
`deploy`, branch `main`". You configure GCP to *trust* GitHub's issuer and to map
that identity onto a service account.

At runtime the action exchanges GitHub's token for a Google access token valid
for about an hour, scoped to the service account, bound to that specific
repository.

**Nothing is stored. Nothing expires-in-2027. Nothing to rotate. Nothing to
leak** — a stolen token is useless in an hour and only ever worked for one repo.

Setup is about ten minutes and it's the same pattern for AWS, Azure, GitLab and
on-prem Kubernetes. The one thing to get right: bind to the specific repository,
not the whole pool.
</details>

<details>
<summary><b>3.</b> What's wrong with granting <code>roles/editor</code> to a service account?</summary>

`roles/editor` is a legacy *basic* role carrying roughly 2,000 permissions across
every service in the project. A compromise of that service — one RCE, one leaked
key — becomes: create VMs (crypto mining), read every bucket, modify every
database, delete resources, and read Secret Manager.

It also destroys your ability to reason about anything. You cannot answer "what
can this service do?" because the answer is "nearly everything", and you cannot
answer "who could have deleted this?" during an incident.

And it violates the principle that makes IAM useful: **the permission set should
document what the service does.** A service account with
`pubsub.publisher` + `cloudsql.client` tells a reader what the service is for.

The fix: create a dedicated SA, grant predefined roles on specific resources,
and use IAM Recommender after 90 days to trim what went unused. Start narrow and
add on failure — it takes minutes and the failures are explicit.
</details>

<details>
<summary><b>4.</b> Service A must call service B. Design the auth with no shared secrets.</summary>

**On Cloud Run:**
1. B is deployed `--no-allow-unauthenticated`, so Google's front end rejects
   unauthenticated requests before B's container is invoked.
2. A runs as a dedicated service account, attached at deploy time.
3. Grant A's SA `roles/run.invoker` **on service B specifically** — not
   project-wide.
4. A uses `idtoken.NewClient(ctx, B_URL)`, which fetches a Google-signed OIDC
   token from the metadata server with `aud` = B's URL and attaches it.
5. Cloud Run verifies signature, expiry and audience against Google's JWKS.

No secret exists at any point. Tokens live ~1 hour and are auto-refreshed.

**On GKE:** the same idea with Workload Identity binding a Kubernetes SA to a
Google SA, plus mTLS from the mesh if you have one (Capsule 08).

**Defence in depth:** also set `--ingress=internal` so B isn't reachable from the
internet at all, and have B perform its own authorization for resource-level
decisions (B3) rather than trusting that anyone who reached it is allowed.
</details>

<details>
<summary><b>5.</b> How would you audit a GCP project you just inherited?</summary>

In roughly this order, because it's cheapest-first and the early steps often find
the problem:

1. **Who has owner/editor?** `get-iam-policy` filtered on basic roles. Humans with
   owner, and service accounts with editor, are the top findings.
2. **User-managed service account keys.** Any that exist are a finding; the loop
   in Step 1 of this lab enumerates them.
3. **Public access** — `allUsers` / `allAuthenticatedUsers` on any binding,
   especially buckets and Cloud Run services.
4. **What's running and what does it cost?** `gcloud run services list`,
   `sql instances list`, `compute instances list`, plus the billing report by SKU.
   Orphaned resources are both cost and attack surface.
5. **Org policies** — are key creation, public IPs and public buckets restricted?
6. **IAM Recommender** — 90 days of usage data proposing narrower roles, for free.
7. **Audit logs** — is Data Access logging on where it matters? Are logs exported
   to a bucket the project's own admins can't delete?
8. **Networking** — firewall rules allowing `0.0.0.0/0`, VMs with public IPs,
   databases with public IPs and broad authorised networks.
9. **Secret handling** — anything in environment variables that should be in
   Secret Manager.

Write it up as findings with severity and effort. Then fix the public access and
the keys first — they're the ones with an active exploit path.
</details>

---

## Log it

```bash
cd ~/repos/pato/gravity-augmented && ./bin/scouter done B7
./bin/scouter status
```
