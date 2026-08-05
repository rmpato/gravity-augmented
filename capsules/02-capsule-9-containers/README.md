# Capsule 02 · Capsule #9 — Containers

> *Bulma throws a capsule on the ground and a fully-equipped aircraft appears.
> It was never smaller in there. It was packaged so it could be carried, and it
> unpacks identically every single time.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 3 | 65 min | Capsules 00–01 | Local |

---

## Why this capsule exists

"Works on my machine" is not a joke; it's the single largest source of wasted
engineering time before containers existed. A container is an answer to one
question: **how do I move this program, and everything it needs to run,
somewhere else, and be certain it behaves the same?**

Every deploy target in the rest of this repo — Cloud Run, GKE, Compute Engine
with a container-optimised OS — takes a container image. Not a zip, not a repo.
An image. So this is the packaging format for the remaining 24 capsules.

You will also learn why a naive Dockerfile produces a **1.2 GB image with a root
user and a shell**, and how to get to **under 15 MB with no shell at all** —
which is simultaneously faster to deploy, cheaper to store, and dramatically
smaller as an attack surface.

---

## The concept

### What a container actually is

Not a virtual machine. There is no guest kernel. A container is a normal Linux
process that the kernel has been told to lie to:

- **namespaces** — the process sees its own PID space, its own filesystem mount
  tree, its own network interfaces, its own hostname. `ps` inside shows *your*
  process as PID 1 and nothing else.
- **cgroups** — the kernel enforces limits on CPU, memory, and I/O. This is the
  mechanism behind everything in Capsule 05.
- **a union filesystem** — the image is a stack of read-only layers with one
  thin writable layer on top. Layers are content-addressed and shared between
  images, which is why pulling your second image from the same base is nearly
  instant.

**The consequence that matters:** a container starts in milliseconds because
there is no OS to boot. That's what makes scale-to-zero and per-request
autoscaling (Capsule 06) possible at all.

**On a Mac**, there is no Linux kernel, so OrbStack/Docker Desktop runs a small
Linux VM and your containers live inside it. This is why file I/O across the
mount boundary is slower than native, and why an `arm64` Mac produces `arm64`
images that will not run on an `amd64` cloud VM unless you say so.

### Image vs container

```
Dockerfile  --build-->  Image  --run-->  Container
 (recipe)              (class)          (instance)
```

Images are immutable and tagged. Containers are disposable instances. If you
find yourself `docker exec`-ing into a container to fix something, you have
built a pet, and the fix will vanish on the next deploy.

### Layers and the cache

Each instruction produces a layer. Docker reuses a cached layer if that
instruction *and every layer before it* are unchanged.

This gives you the single most important Dockerfile rule:

> **Order instructions from least-likely-to-change to most-likely-to-change.**

Dependencies change weekly; your source changes every commit. So copy the
dependency manifest and download dependencies *before* copying the source. Get
this backwards and every one-line code change re-downloads your entire module
cache.

### Multi-stage builds

The tools needed to *build* software have nothing to do with running it. The Go
compiler is ~500 MB; the binary it produces is ~10 MB. Multi-stage builds let
you use a fat image to build and copy only the artifact into a tiny one.

```
FROM golang:1.23 AS build     ← compiler, module cache, git — thrown away
FROM gcr.io/distroless/static ← ~2 MB: no shell, no package manager, no libc
COPY --from=build /bin/app /app
```

### Choosing a base image

| Base | Size | Has a shell? | Use when |
|---|---|---|---|
| `ubuntu` / `debian` | ~80 MB | yes | you genuinely need system packages |
| `alpine` | ~7 MB | yes (`ash`) | you want small *and* a shell to debug |
| `gcr.io/distroless/static` | ~2 MB | **no** | static Go/Rust binaries — the default here |
| `scratch` | 0 B | no | absolutely nothing but your binary; you supply CA certs and timezone data yourself |

**Why distroless is the right default for a Go service:** an attacker who
achieves RCE in your process finds no `sh`, no `curl`, no `apt`, no package
manager to pull tools with. It removes an entire category of post-exploitation.
The cost is that you cannot `docker exec -it … sh` to poke around — which is a
habit worth losing anyway, and Capsule 25 gives you the observability that
replaces it.

> A note on Alpine: it uses musl libc instead of glibc. For pure-Go static
> binaries that's irrelevant. For anything using cgo (some database drivers,
> image libraries), musl can produce subtle runtime differences. Know this
> before you casually "just use alpine" on a Python or Node service.

### Run as non-root

By default, the process inside a container runs as **root**. Combined with a
container-escape vulnerability, that is root on the host. Every image you ship
should declare a non-root `USER`. Distroless has `nonroot` (UID 65532) built in.

---

## Lab — package the Scouter

In `~/repos/pato/gravity-chamber`.

### Step 1 — the naive version, so you can measure the improvement

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

Note the size. It's around **1.2 GB**, it contains the entire Go toolchain and
your source code, and it runs as root.

### Step 2 — the real one

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

**`.dockerignore`** — as important as the Dockerfile:

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

Without it, `COPY . .` ships your entire `.git` history (often larger than the
source), invalidates the cache on any file change at all, and — the part that
actually bites people — can copy a `.env` full of credentials into a layer where
`docker history` will happily show it.

### Step 3 — build and compare

```bash
docker build -f deploy/Dockerfile -t scouter:v1 --build-arg VERSION=v1 .
docker images | grep scouter
```

Expect roughly:

```
scouter   naive   1.2GB
scouter   v1      13MB
```

Roughly **90× smaller**. That's 90× less to push, pull on every cold start, and
store in Artifact Registry, plus a runtime with no shell for an attacker to use.

### Step 4 — run it

```bash
docker run --rm -p 8080:8080 --name scouter -e LOG_LEVEL=debug scouter:v1
```

Second pane:

```bash
curl -s localhost:8080/healthz | jq
curl -s -XPOST localhost:8080/readings -d '{"fighter":"nappa","power":4000}' | jq
```

### Step 5 — prove the SIGTERM path still works

This is the thing everyone breaks and nobody notices until deploys start
throwing 502s.

```bash
docker stop scouter      # sends SIGTERM, waits 10s, then SIGKILL
```

Watch the logs: you should see `shutdown signal received, draining` →
`scouter offline`, and `docker stop` should return in ~2 seconds, not 10.

Now break it deliberately. Change the last line to shell form:

```dockerfile
ENTRYPOINT /scouter
```

Rebuild, run, `docker stop`. It now takes the **full 10 seconds** and you never
see the shutdown logs — because `/bin/sh` is PID 1 and doesn't forward the
signal to your binary, so Docker eventually SIGKILLs the whole thing. Every
in-flight request dies.

Put the exec form back. Remember this one; it is a genuinely common production
bug.

### Step 6 — inspect what you built

```bash
# every layer and the command that made it — check nothing secret is in here
docker history scouter:v1

# where the time actually went
docker build -f deploy/Dockerfile -t scouter:v1 . --progress=plain --no-cache 2>&1 | tail -30

# prove the cache works: touch a source file, rebuild, watch which layers are CACHED
touch internal/scouter/server.go
docker build -f deploy/Dockerfile -t scouter:v1 . 2>&1 | grep -E 'CACHED|=>' | head
```

The `go mod download` layer must say **CACHED**. If it doesn't, your COPY order
is wrong.

### Step 7 — lazydocker

```bash
docker run -d --rm -p 8080:8080 --name scouter scouter:v1
lazydocker
```

- **Containers** panel → `scouter` → **Stats**: live CPU and memory. That graph
  is the entire subject of Capsule 05.
- **Logs**: your JSON lines, streaming.
- **Images** panel: `scouter:naive` and `scouter:v1` side by side. Press `d` and
  delete `naive` — you've made your point.

### Step 8 — a build target in the Makefile

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

Add `docker-build docker-run` to `.PHONY`.

> **Tag with the git SHA, never only `latest`.** `latest` is mutable — two
> people pulling `latest` an hour apart get different software, and "which
> version is in production?" becomes unanswerable. Capsule 24 depends on
> immutable tags to make rollback instant.

---

## In GCP

- **Artifact Registry** is where images live. (Container Registry / `gcr.io` is
  deprecated.) 0.5 GB free — your 13 MB image is comfortably inside it, the
  1.2 GB one is not.
- **Cloud Run** deploys an image directly; nothing else is required.
- **Cloud Build** can build the image in the cloud from a `cloudbuild.yaml`.
- **Architecture matters.** On an Apple Silicon Mac you build `linux/arm64` by
  default and Cloud Run expects `linux/amd64`. You will hit this in Capsule 04.
  The fix, for later:

  ```bash
  docker build --platform linux/amd64 -f deploy/Dockerfile -t scouter:v1 .
  ```

  Build times roughly triple under emulation. In real pipelines you build on an
  amd64 CI runner instead.
- **Binary Authorization** (worth knowing the name of) can require images to be
  signed by your pipeline before Cloud Run or GKE will run them.

---

## Bring it to work

- **`.dockerignore` before the Dockerfile.** It prevents secret leakage into
  layers and it's the difference between a 3-second and a 60-second build.
- **Dependencies before source, always.** The single highest-leverage line
  ordering in the file.
- **Non-root `USER` in every image.** It's one line and it's the first thing a
  security review looks for.
- **Exec-form `ENTRYPOINT`.** Shell form silently breaks signal handling.
- **Tag with an immutable identifier** (git SHA or semver), and treat `latest`
  as a convenience alias only.
- **Pin base image tags.** `golang:1.25-alpine` is better than `golang:latest`;
  a digest (`golang@sha256:…`) is better still for anything you must reproduce.
- **Keep the builder tag >= your `go` directive.** This is the one pin that
  rots on its own: a routine `go get` can raise the `go` line in `go.mod`, and
  because the official golang images set `GOTOOLCHAIN=local` while your laptop
  defaults to `auto`, the build keeps working locally and breaks only in CI.
  Every Go team hits this exactly once.

---

## Battle drill

<details>
<summary><b>1.</b> Your CI takes 8 minutes and 7 of them are <code>go mod download</code> on every build. What's wrong?</summary>

`COPY . .` appears before `go mod download`. Any source change invalidates the
COPY layer, which invalidates every layer after it, including the download.

Fix: copy `go.mod`/`go.sum` alone, run `go mod download`, *then* copy the source.
The same principle applies verbatim to `package.json` + `npm ci`,
`requirements.txt` + `pip install`, and `Gemfile` + `bundle install`.
</details>

<details>
<summary><b>2.</b> Why is a shell-form <code>ENTRYPOINT</code> dangerous in production?</summary>

It runs your command via `/bin/sh -c`, so the shell is PID 1. The shell does not
forward `SIGTERM` to its child. Your app never learns it's being shut down, so
graceful drain never happens; after the grace period the platform `SIGKILL`s
everything and every in-flight request is severed. On a busy service, that's a
burst of 502s on every single deploy.
</details>

<details>
<summary><b>3.</b> You deleted a secret file in a later Dockerfile layer. Is it gone from the image?</summary>

**No.** Layers are additive; a delete just adds a whiteout entry in a *later*
layer while the file remains in the earlier one. Anyone with the image can pull
that layer and read it. `docker history` will often point straight at it.

The fixes: never let it into a layer (`.dockerignore`), use BuildKit secret
mounts (`RUN --mount=type=secret,...`) which never persist, or inject secrets at
runtime via environment/Secret Manager. And regardless: **rotate the secret**.
</details>

<details>
<summary><b>4.</b> Distroless has no shell. How do you debug a misbehaving container?</summary>

You don't shell in — you make the container tell you. Structured logs (Capsule
01), metrics and traces (Capsule 25). If you genuinely must inspect a live
container, `kubectl debug` / ephemeral debug containers attach a *separate*
image with tooling into the same namespaces without changing the running one.

Being unable to shell in is a feature: it forces the observability that makes
you able to debug the ten instances you *can't* reach anyway.
</details>

<details>
<summary><b>5.</b> Is a container a security boundary?</summary>

A weak one. It shares the host kernel, so a kernel vulnerability can be a
container escape. Treat it as isolation for *correctness* and as defence in
depth for security — not as a sandbox for untrusted code. For genuinely hostile
workloads you want VM-level isolation (gVisor, Firecracker, Cloud Run's second
generation execution environment). Non-root, read-only root filesystem, and
dropped capabilities are what you do in the meantime.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `exec format error` when running | Architecture mismatch. `docker build --platform linux/amd64 …`. |
| `no such file or directory` on start, but the binary exists | You built with cgo against glibc and ran on distroless/static. Set `CGO_ENABLED=0`. |
| Build can't find `go.sum` | You have no dependencies yet. `COPY go.mod go.sum* ./` (note the `*`) tolerates that. |
| `docker stop` always takes 10 seconds | Shell-form ENTRYPOINT, or your app ignores SIGTERM. |
| Image still huge after multi-stage | You're tagging the build stage. Ensure the final `FROM` is the runtime one and you `COPY --from=build`. |
| `permission denied` writing a file | `USER nonroot` can't write to `/`. Write to `/tmp` or mount a volume — and prefer not writing to disk at all (Capsule 06). |
| `go: go.mod requires go >= 1.25.0 (running go 1.23.12; GOTOOLCHAIN=local)` — **but it builds fine locally** | A `go get` raised the `go` directive in your go.mod above your builder image. Locally `GOTOOLCHAIN=auto` downloads the newer toolchain silently; the golang images set `GOTOOLCHAIN=local` and refuse. Bump the `FROM golang:` tag to match. Check with `head -3 go.mod`. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
rm deploy/Dockerfile.naive          # it served its purpose
git add -A
git commit -m "build(docker): multi-stage distroless image for scouter

Capsule 02. 1.2GB -> 13MB. Non-root, static binary, exec-form entrypoint
so SIGTERM still reaches the process. Deps copied before source for cache."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 02
```

**Next:** [Capsule 03 · Bulma's Blueprints — Reproducible Environments & IaC](../03-bulma-blueprints-iac/README.md)
