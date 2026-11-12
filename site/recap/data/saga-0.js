// Saga 0 · Kame House — Foundations. Recaps for capsules 00–04.
// Source of truth: capsules/00-*/README.md … capsules/04-*/README.md.

GA.thread(0, [
  "Saga 0 has no scale in it, on purpose. Scale multiplies whatever you already have, including the problems. So before anything gets a second replica, you remove the friction (00), build <b>one service properly</b> (01), package it so it runs the same everywhere (02), make the environment and the infrastructure files you can review (03), and learn the map of the cloud it will live on (04).",
  "Each capsule carries the last one forward, and each can silently undo it. The graceful shutdown from 01 dies if 02's <code>ENTRYPOINT</code> is in shell form. The image from 02 has no shell, which is why 03's healthcheck needs a <code>-health</code> flag. The JSON logs from 01 are what make 04's <code>gcloud logging read</code> queries work. Nothing here is decoration; the parts depend on each other.",
  "What the saga leaves you with: a well-behaved Go service in a 13 MB distroless image, a compose stack, a Terraform workflow you have practised, and a mental model of GCP. And one deliberate flaw. The readings live in a <code>MemStore</code> inside the process, so the service is <b>stateful</b> and can't scale horizontally. Saga 1 walks you straight into that wall.",
]);

// ---------------------------------------------------------------------------

GA.recap({
  id: "00",
  tagline: "Friction, not difficulty, is what makes people stall. Remove it once, up front, and create the repo that will hold everything you build.",
  built: "You ran <code>./bin/doctor</code> until the required list was green, fixed the Go version trap, confirmed Docker runs, met lazydocker, and scaffolded <b>gravity-chamber</b>: a Go module with a <code>cmd/</code> + <code>internal/</code> layout, a <code>.gitignore</code> that covers secrets and Terraform state, a self-documenting <code>Makefile</code>, <code>NOTES.md</code>, and a first conventional commit.",
  story: [
    "Three weeks into learning infrastructure, most people don't quit because it's hard. They quit because of friction: the wrong Go version, a Docker daemon that isn't running, no repo to put the work in. This capsule removes all of it, so every later capsule can be about ideas.",
    "The toolchain has one real trap. Several capsules use <code>log/slog</code> (Go 1.21+) and <code>for range N</code> (Go 1.22+). If an old install in <code>/usr/local/go</code> sits earlier on your <code>PATH</code> than Homebrew's, <code>go version</code> says 1.19 and code that is correct won't compile. <code>which -a go</code> shows you every <code>go</code> on the path; the first one wins.",
    "The repo layout is cheap now and expensive later. <code>cmd/&lt;name&gt;/</code> holds one <code>main.go</code> per binary. <code>internal/</code> holds the real code, and Go's compiler refuses to let other modules import it, so it's a boundary the tooling enforces, not a naming habit. By Capsule 22 you'll have three binaries sharing that code.",
    "Your commit history is a document. <code>gravity-chamber</code> is the real output of the course: in two months its log should show exactly how a single binary became a multi-service system. Conventional commits (<code>feat</code>, <code>fix</code>, <code>perf</code>…) make that history something you can query.",
  ],
  diagrams: [
    {
      title: "The repo you scaffold, and the one boundary the compiler enforces",
      svg: `<svg class="dg" viewBox="0 0 640 280" role="img" aria-label="gravity-chamber layout: binaries under cmd import shared code from internal; another module cannot import internal">
  <rect class="zone" x="8" y="8" width="624" height="264" rx="12"/>
  <text class="mono start" x="24" y="26">gravity-chamber/</text>
  <rect class="box hot" x="24" y="44" width="128" height="40" rx="8"/><text class="mono" x="88" y="64">cmd/scouter</text>
  <rect class="box dim" x="170" y="44" width="128" height="40" rx="8"/><text class="mono" x="234" y="64">cmd/ranker</text>
  <rect class="box dim" x="316" y="44" width="128" height="40" rx="8"/><text class="mono" x="380" y="64">cmd/notifier</text>
  <text class="sm mute start" x="462" y="56">ranker, notifier:</text>
  <text class="sm mute start" x="462" y="74">added in Capsule 22</text>
  <line class="wire" x1="88" y1="86" x2="88" y2="126"/>
  <line class="wire soft" x1="234" y1="86" x2="234" y2="126"/>
  <line class="wire soft" x1="380" y1="86" x2="380" y2="126"/>
  <rect class="box cool" x="24" y="130" width="420" height="50" rx="8"/>
  <text x="234" y="148">internal/</text>
  <text class="xs" x="234" y="167">your actual code, shared by every binary</text>
  <rect class="box warn" x="500" y="130" width="120" height="50" rx="8"/><text class="sm" x="560" y="155">other module</text>
  <line class="wire bad" x1="498" y1="155" x2="448" y2="155"/>
  <text class="b bad" x="473" y="140">✗</text>
  <text class="xs bad" x="560" y="198">refused by compiler</text>
  <rect class="box" x="24" y="216" width="132" height="44" rx="8"/><text class="mono sm" x="90" y="231">deploy/</text><text class="xs mute" x="90" y="249">Docker, compose, TF</text>
  <rect class="box" x="170" y="216" width="132" height="44" rx="8"/><text class="mono sm" x="236" y="231">docs/adr/</text><text class="xs mute" x="236" y="249">why, per decision</text>
  <rect class="box" x="316" y="216" width="128" height="44" rx="8"/><text class="mono sm" x="380" y="231">scripts/</text><text class="xs mute" x="380" y="249">what you'd retype</text>
  <rect class="box energy" x="460" y="216" width="160" height="44" rx="8"/><text class="xs" x="540" y="231">Makefile, .gitignore</text><text class="xs" x="540" y="249">README, NOTES.md</text>
</svg>`,
      caption: "<code>cmd/scouter/main.go</code> is only wiring. The layout that supports three binaries costs nothing when you have one; retrofitting it later means moving every import path.",
    },
    {
      title: "The Go version trap: the first go on PATH wins",
      svg: `<svg class="dg" viewBox="0 0 640 240" role="img" aria-label="PATH lists /usr/local/go/bin before /opt/homebrew/bin, so the shell runs the old Go 1.19 and Homebrew's newer Go is never reached">
  <text class="b start" x="20" y="20">which -a go: the shell scans PATH left to right</text>
  <rect class="box warn" x="20" y="40" width="190" height="56" rx="8"/><text class="mono" x="115" y="60">/usr/local/go/bin</text><text class="sm" x="115" y="80">go 1.19 · old install</text>
  <rect class="box ok" x="225" y="40" width="190" height="56" rx="8"/><text class="mono" x="320" y="60">/opt/homebrew/bin</text><text class="sm" x="320" y="80">go 1.22+ · Homebrew</text>
  <rect class="box dim" x="430" y="40" width="190" height="56" rx="8"/><text class="mono" x="525" y="60">/usr/bin</text><text class="sm mute" x="525" y="80">no go here</text>
  <text class="xs mute" x="320" y="112">never reached</text>
  <line class="wire bad" x1="115" y1="98" x2="115" y2="132"/>
  <rect class="box warn" x="20" y="136" width="600" height="36" rx="8"/>
  <text class="sm" x="320" y="154">go version → 1.19: no log/slog, no for range N, correct code won't compile</text>
  <text class="b good start" x="20" y="200">Fix: remove /usr/local/go, or put /opt/homebrew/bin first</text>
  <text class="sm mute start" x="20" y="224">Then go version must say 1.22 or newer. ./bin/doctor flags it if not.</text>
</svg>`,
      caption: "Two <code>go</code> binaries is the common case on a Mac that once had Go installed by hand. Fix the environment; never \"fix\" the code to match the old toolchain.",
    },
    {
      title: "A committed secret: why rewriting history doesn't save you",
      svg: `<svg class="dg" viewBox="0 0 640 250" role="img" aria-label="Timeline: key committed and pushed, scraped within seconds, history force-pushed, old objects still reachable, so the only fix is rotating the credential">
  <text class="sm good start" x="20" y="24">Prevent: .gitignore covers .env, *.key and *-credentials.json in the very first commit</text>
  <rect class="box warn" x="20" y="50" width="135" height="50" rx="8"/><text class="sm" x="87" y="67">key committed</text><text class="sm" x="87" y="85">and pushed</text>
  <rect class="box warn" x="175" y="50" width="135" height="50" rx="8"/><text class="sm" x="242" y="67">cloned, cached,</text><text class="sm" x="242" y="85">scraped: seconds</text>
  <rect class="box" x="330" y="50" width="135" height="50" rx="8"/><text class="sm" x="397" y="67">history</text><text class="sm" x="397" y="85">force-pushed</text>
  <rect class="box warn" x="485" y="50" width="135" height="50" rx="8"/><text class="sm" x="552" y="67">old objects</text><text class="sm" x="552" y="85">still reachable</text>
  <line class="wire" x1="157" y1="75" x2="171" y2="75"/>
  <line class="wire" x1="312" y1="75" x2="326" y2="75"/>
  <line class="wire" x1="467" y1="75" x2="481" y2="75"/>
  <text class="xs mute" x="397" y="116">cleanup, not remediation</text>
  <path class="wire good" d="M552 102 V205 H474"/>
  <rect class="box ok" x="170" y="180" width="300" height="50" rx="8"/>
  <text class="b" x="320" y="198">Rotate the credential</text>
  <text class="xs" x="320" y="217">treat \"was it exposed?\" as always yes</text>
</svg>`,
      caption: "GitHub keeps force-pushed objects reachable via the API, and public repos are scraped continuously. That is why the secrets rules go in the first commit, and why the checkpoint proves a fake <code>.env</code> doesn't show up in <code>git status</code>.",
    },
  ],
  concepts: [
    { term: "./bin/doctor", plain: "A script in the course repo that checks every tool you need and lists what's missing under REQUIRED.", why: "Environment problems found now cost minutes. Found in Capsule 09, mid-load-test, they cost an evening." },
    { term: "cmd/ + internal/", plain: "One directory per binary under <code>cmd/</code>, holding only <code>main.go</code>. The real code lives in <code>internal/</code>.", why: "Go refuses to let other modules import <code>internal/</code>. A boundary the compiler enforces is worth ten that a wiki describes." },
    { term: "Makefile as onboarding", plain: "Every project gets <code>make run</code>, <code>build</code>, <code>test</code>, <code>fmt</code>, and a <code>make help</code> that lists them from <code>## </code> comments.", why: "It answers \"how do I run this?\" for someone who joined today, and keeps answering after you leave. Recipes need a literal <b>tab</b>." },
    { term: ".gitignore in the first commit", plain: "Secrets (<code>.env</code>, <code>*.key</code>, service-account JSON), build output, Terraform state and local data are ignored before anything else is committed.", why: "Once a credential is committed, it has been cloned. The only real fix is rotating it." },
    { term: "Conventional commits", plain: "<code>&lt;type&gt;(&lt;scope&gt;): &lt;what changed&gt;</code>, in the imperative, with types like <code>feat</code>, <code>fix</code>, <code>perf</code>, <code>refactor</code>, <code>docs</code>, <code>test</code>, <code>chore</code>.", why: "It costs nothing, and <code>git log --oneline --grep=perf</code> becomes a useful query two years later." },
    { term: "NOTES.md", plain: "Three lines per capsule: what you learned, what surprised you, what you still don't get.", why: "The \"surprised me\" line marks where your mental model was wrong. In the repo it's diffable and greppable, and <code>git log -p NOTES.md</code> shows how your understanding changed." },
  ],
  numbers: [
    { value: "Go 1.22+", label: "Minimum toolchain", note: "<code>log/slog</code> needs 1.21; <code>for range N</code> and the method-aware mux need 1.22." },
    { value: "seconds", label: "Time for a pushed secret to be scraped", note: "Assume it was copied before you noticed." },
  ],
  traps: [
    { myth: "My Go is installed, so the version is fine.", truth: "Check <code>which -a go</code>. An old <code>/usr/local/go</code> can shadow Homebrew's, and you'll get 1.19 while believing you have 1.22." },
    { myth: "<code>docker run</code> errors, so Docker is broken.", truth: "Usually the daemon just isn't running. Open OrbStack or Docker Desktop." },
    { myth: "A force-push removed the leaked key, so we're safe.", truth: "Force-pushed objects stay reachable via the API, and scanners got there first. History rewriting is cleanup. <b>Rotate the credential.</b>" },
    { myth: "<code>Makefile:5: *** missing separator</code> means the Makefile is wrong.", truth: "Your editor turned the recipe's tab into spaces. Make requires a literal tab." },
    { myth: "Layout can wait until there's more than one binary.", truth: "By then every import path has to move. <code>cmd/scouter</code> costs nothing today." },
  ],
  takeaways: [
    "Get <code>./bin/doctor</code> green before anything else.",
    "Fix the toolchain; never bend the code to an old one.",
    "<code>cmd/&lt;name&gt;/main.go</code> for wiring, <code>internal/</code> for code. Let the compiler enforce the boundary.",
    "Secrets go in <code>.gitignore</code> in the first commit. A committed secret gets rotated, not rewritten.",
    "A Makefile with <code>make help</code> is the cheapest onboarding document there is.",
    "Write commits as if someone will read the log. Someone will: you, in an interview.",
  ],
  drill: [
    { q: "Why <code>cmd/scouter/main.go</code> instead of <code>main.go</code> at the root?", a: [
      "Because a repo grows more than one binary. By Capsule 22 you'll have <code>cmd/scouter</code>, <code>cmd/ranker</code> and <code>cmd/notifier</code> sharing code in <code>internal/</code>. The layout costs nothing with one binary, and retrofitting it later means moving every import path.",
    ] },
    { q: "A teammate commits an API key, notices, and force-pushes a rewritten history. Are you safe?", a: [
      "No. Assume it was cloned, cached by the forge, or picked up by a scanner within seconds. GitHub keeps force-pushed objects reachable via the API, and public repos are scraped continuously.",
      "<b>Rotate the credential.</b> History rewriting is cleanup, not remediation. Treat \"was it exposed?\" as always yes.",
    ] },
    { q: "Why keep <code>NOTES.md</code> in the repo rather than in a notes app?", a: [
      "It's diffable, greppable, and lives next to the code it describes. <code>git log -p NOTES.md</code> becomes a record of how your understanding changed. It's the same reason ADRs (Capsule 22) are text files in the repo instead of wiki pages nobody can find.",
    ] },
    { q: "How does the checkpoint prove your <code>.gitignore</code> works?", a: [
      "It writes a fake <code>SECRET=hunter2</code> into <code>.env</code> and runs <code>git status --porcelain</code>. If <code>.env</code> shows up, it isn't ignored. A rule you've tested beats a rule you believe you wrote.",
    ] },
  ],
  connects: {
    back: "This is the start. The only prerequisites are git and a terminal.",
    forward: "Capsule 01 fills <code>cmd/scouter</code> and <code>internal/scouter</code> with a real service. lazydocker comes back from Capsule 02 on, and <code>docs/adr/</code> starts earning its place in Capsule 22.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "01",
  tagline: "Scale multiplies whatever you already have, including the problems. So build one service properly first: config from the environment, fail fast, separate liveness from readiness, structured logs, graceful shutdown.",
  built: "You wrote the Scouter in Go: an in-memory <code>MemStore</code> guarded by a mutex, five routes on the Go 1.22 mux (<code>/healthz</code>, <code>/readyz</code>, <code>POST /readings</code>, <code>/fighters/{name}</code>, <code>/leaderboard</code>), JSON logs via <code>log/slog</code> with one line per request, server timeouts, and a drain-then-shutdown sequence. Then you broke it on purpose: <code>PORT=over9000</code> exits at boot, and a slow request survives Ctrl-C with <code>Shutdown()</code> but dies with <code>Close()</code>.",
  story: [
    "Every system in this course is made of services. If the unit is sloppy (config baked in, no health checks, logs you can't query, a shutdown that drops requests), no load balancer or cache will save you. The five properties are the same at 10 requests a day or 10 million.",
    "Config comes from the environment, so the <b>same binary</b> runs on your laptop, in CI and in production. Values with a safe default get one (<code>PORT</code>, <code>LOG_LEVEL</code>). Values where a wrong guess would be quiet, like a database URL, get no default: the service refuses to start. A process that won't boot is something a deploy system understands. A process that boots and is quietly useless is an incident ten minutes later.",
    "<b>Liveness is not readiness.</b> <code>/healthz</code> asks \"is this process wedged?\" and answers from memory. <code>/readyz</code> asks \"should I get traffic right now?\" and may check dependencies. Failing readiness pulls you from the pool; failing liveness gets you killed. Put a database ping in liveness and a 30-second blip kills every replica at once.",
    "On a deploy, the platform sends <code>SIGTERM</code>, waits, then <code>SIGKILL</code>. The order matters: fail readiness first, wait for the load balancer to notice, then stop accepting and let in-flight requests finish. Skip the first step and the gap where the LB still thinks you're healthy fills with 502s.",
  ],
  diagrams: [
    {
      title: "A database ping in /healthz turns a blip into an outage",
      svg: `<svg class="dg" viewBox="0 0 640 280" role="img" aria-label="Left: liveness checks the database, every replica is killed during a 30 second blip and they cold-start into a connection storm. Right: readiness checks it, replicas are pulled from the pool and return when it recovers">
  <rect class="zone" x="8" y="8" width="304" height="264" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="264" rx="12"/>
  <text class="b" x="160" y="30">Ping the DB in /healthz</text>
  <text class="b" x="480" y="30">Ping the DB in /readyz</text>
  <rect class="box" x="24" y="48" width="272" height="30" rx="8"/><text class="sm" x="160" y="63">DB blips for 30 s</text>
  <rect class="box" x="24" y="84" width="272" height="30" rx="8"/><text class="sm" x="160" y="99">every replica fails liveness</text>
  <rect class="box warn" x="24" y="120" width="272" height="30" rx="8"/><text class="sm" x="160" y="135">orchestrator kills all of them</text>
  <rect class="box warn" x="24" y="156" width="272" height="30" rx="8"/><text class="sm" x="160" y="171">zero replicas, all cold-start at once</text>
  <rect class="box warn" x="24" y="192" width="272" height="30" rx="8"/><text class="sm" x="160" y="207">connection storm on a recovering DB</text>
  <text class="b bad" x="160" y="244">30 s blip → multi-minute outage</text>
  <rect class="box" x="344" y="48" width="272" height="30" rx="8"/><text class="sm" x="480" y="63">DB blips for 30 s</text>
  <rect class="box" x="344" y="84" width="272" height="30" rx="8"/><text class="sm" x="480" y="99">replicas fail readiness</text>
  <rect class="box ok" x="344" y="120" width="272" height="30" rx="8"/><text class="sm" x="480" y="135">pulled from the LB pool, not killed</text>
  <rect class="box ok" x="344" y="156" width="272" height="30" rx="8"/><text class="sm" x="480" y="171">DB recovers, readiness passes</text>
  <rect class="box ok" x="344" y="192" width="272" height="30" rx="8"/><text class="sm" x="480" y="207">warm replicas take traffic again</text>
  <text class="b good" x="480" y="244">a degradation, not an outage</text>
</svg>`,
      caption: "Same dependency check, different endpoint. Liveness failing means \"kill me\"; readiness failing means \"don't send me traffic\". The Scouter's <code>/healthz</code> never touches a dependency, and a test (<code>TestLivenessIgnoresDependencies</code>) keeps it that way.",
    },
    {
      title: "Graceful shutdown: fail readiness first, then drain",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Timeline after SIGTERM: readyz turns 503, load balancer stops sending after the 2 second drain delay, Shutdown waits for the 5 second request to finish, exit 0. With Close the request is severed at 2 seconds">
  <line class="wire none soft" x1="200" y1="32" x2="200" y2="252" stroke-dasharray="3 5"/>
  <text class="sm start" x="20" y="55">/readyz</text>
  <rect class="box ok" x="148" y="40" width="52" height="30" rx="8"/><text class="xs" x="174" y="55">200</text>
  <rect class="box warn" x="200" y="40" width="416" height="30" rx="8"/><text class="sm" x="408" y="55">503 · draining</text>
  <text class="sm start" x="20" y="95">load balancer</text>
  <rect class="box" x="148" y="80" width="156" height="30" rx="8"/><text class="xs" x="226" y="95">still sends traffic</text>
  <rect class="box dim" x="304" y="80" width="312" height="30" rx="8"/><text class="xs" x="460" y="95">has noticed: no new requests</text>
  <text class="sm start" x="20" y="135">curl /slow</text>
  <rect class="box hot" x="200" y="120" width="260" height="30" rx="8"/><text class="xs" x="330" y="135">in flight: sleeps 5 s</text>
  <text class="sm good start" x="470" y="135">\"finished\"</text>
  <text class="sm start" x="20" y="175">process</text>
  <rect class="box energy" x="200" y="160" width="104" height="30" rx="8"/><text class="xs" x="252" y="175">drain delay 2 s</text>
  <rect class="box cool" x="304" y="160" width="156" height="30" rx="8"/><text class="xs" x="382" y="175">Shutdown() waits</text>
  <text class="sm good start" x="470" y="175">exit 0</text>
  <text class="sm bad start" x="20" y="220">with Close()</text>
  <rect class="box hot" x="200" y="205" width="104" height="30" rx="8"/><text class="xs" x="252" y="220">in flight</text>
  <text class="b bad" x="314" y="220">✗</text>
  <text class="sm bad start" x="328" y="220">severed mid-request: a 502 on every deploy</text>
  <line class="axis" x1="148" y1="252" x2="616" y2="252"/>
  <text class="xs" x="200" y="270">SIGTERM</text>
  <text class="xs mute" x="304" y="270">+2 s</text>
  <text class="xs mute" x="460" y="270">+5 s</text>
</svg>`,
      caption: "This is the lab's Step 6 with the defaults: <code>DRAIN_DELAY</code> 2 s, then <code>Shutdown()</code> with a <code>SHUTDOWN_TIMEOUT</code> budget of 15 s. <code>Shutdown()</code> returns as soon as in-flight requests finish, so the process exits at about 5 s, not 15.",
    },
    {
      title: "One binary, every environment",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="One build fans out to laptop, staging and prod, differing only in environment variables. Below, the rule: default where a wrong guess is loud, refuse to start where it is quiet">
  <rect class="box hot" x="20" y="44" width="160" height="56" rx="10"/><text class="b" x="100" y="64">scouter</text><text class="sm" x="100" y="84">built once</text>
  <rect class="box" x="260" y="16" width="360" height="34" rx="8"/><text class="sm b start" x="274" y="33">laptop</text><text class="mono xs start" x="380" y="33">LOG_LEVEL=debug</text>
  <rect class="box" x="260" y="56" width="360" height="34" rx="8"/><text class="sm b start" x="274" y="73">CI</text><text class="mono xs start" x="380" y="73">PORT=8080</text>
  <rect class="box" x="260" y="96" width="360" height="34" rx="8"/><text class="sm b start" x="274" y="113">production</text><text class="mono xs start" x="380" y="113">LOG_LEVEL=info</text>
  <line class="wire" x1="182" y1="64" x2="256" y2="35"/>
  <line class="wire" x1="182" y1="72" x2="256" y2="73"/>
  <line class="wire" x1="182" y1="80" x2="256" y2="110"/>
  <rect class="box ok" x="20" y="156" width="290" height="116" rx="10"/>
  <text class="b" x="165" y="178">Has a safe default</text>
  <text class="sm" x="165" y="202">PORT, LOG_LEVEL, timeouts</text>
  <text class="sm mute" x="165" y="224">a wrong guess fails loudly</text>
  <text class="mono xs" x="165" y="250">PORT=over9000 → exit 1 at boot</text>
  <rect class="box warn" x="330" y="156" width="290" height="116" rx="10"/>
  <text class="b" x="475" y="178">No default: refuse to start</text>
  <text class="sm" x="475" y="202">DATABASE_URL, credentials</text>
  <text class="sm mute" x="475" y="224">a wrong guess fails quietly</text>
  <text class="xs" x="475" y="250">validate at startup, exit non-zero</text>
</svg>`,
      caption: "If config were baked into the binary you'd rebuild per environment, and the thing you tested would not be the thing you shipped. <code>DATABASE_URL</code> doesn't exist yet in Capsule 01; the rule is ready for when it does (Capsule 10).",
    },
  ],
  concepts: [
    { term: "12-factor config", plain: "Everything that varies between environments comes from environment variables, read once at startup by <code>LoadConfig()</code>.", why: "It's what makes \"promote the artifact that passed testing\" possible. Bake config in and you ship something you never tested." },
    { term: "Fail fast", plain: "Validate config at startup and exit non-zero with a clear error.", why: "A config typo becomes a refused deploy instead of a 500 ten minutes later in a different part of the stack." },
    { term: "Liveness vs readiness", plain: "<code>/healthz</code>: is the process wedged? Memory only. <code>/readyz</code>: should I get traffic now? May check dependencies, and flips to 503 while draining.", why: "Failing readiness means \"pull me from the pool\". Failing liveness means \"kill me\". Mixing them up turns a dependency blip into a fleet-wide restart." },
    { term: "Structured logs", plain: "<code>slog.Info(\"reading recorded\", \"fighter\", id)</code> emits JSON with fields, not prose. One line per request with method, path, status and duration.", why: "Log systems index fields. <code>fighter_id=\"vegeta\"</code> only works as a query if it's a field. Those per-request lines become RED metrics in Capsule 25." },
    { term: "Graceful shutdown", plain: "On <code>SIGTERM</code>: fail readiness, sleep <code>DRAIN_DELAY</code>, call <code>httpSrv.Shutdown()</code> with a deadline, then exit 0.", why: "There's a window (often 5–15 s) where the LB still routes to you. Fail readiness first, then drain." },
    { term: "Shared mutable state", plain: "Go serves each request on its own goroutine, so the <code>MemStore</code> map needs a <code>sync.RWMutex</code>.", why: "Without it, concurrent writes don't just corrupt data: the runtime panics the whole process with <code>fatal error: concurrent map writes</code>. <code>make test</code> runs <code>-race</code> to catch it." },
  ],
  numbers: [
    { value: "2 s / 15 s", label: "DRAIN_DELAY / SHUTDOWN_TIMEOUT", note: "Defaults in <code>config.go</code>. Cloud Run expects you to handle <code>SIGTERM</code> within 10 s." },
    { value: "5–15 s", label: "LB still thinks you're healthy", note: "The window where 502s live if you don't fail readiness first." },
    { value: "5 s", label: "ReadHeaderTimeout", note: "Go's zero value is no timeout at all, which is the Slowloris attack." },
    { value: "1 MiB", label: "Request body cap", note: "<code>http.MaxBytesReader(w, r.Body, 1&lt;&lt;20)</code>. Without it one client can post 4 GB and OOM you." },
  ],
  traps: [
    { myth: "Health checks should verify the database is reachable.", truth: "Not in liveness. A database blip then fails every replica at once and the orchestrator kills them all. Dependency checks go in <code>/readyz</code>." },
    { myth: "Handling <code>SIGTERM</code> means calling <code>Shutdown()</code>.", truth: "Fail readiness <b>first</b> and give the LB a check interval to notice. Otherwise new requests keep arriving at a server that's closing." },
    { myth: "Tests pass without the mutex, so it's fine.", truth: "Races are non-deterministic and a single-threaded test won't trigger one. <code>go test -race</code> will. In production the runtime panics on concurrent map writes." },
    { myth: "Defaults make a service easier to run, so default everything.", truth: "Default only where a wrong guess is loud. A defaulted database URL can silently point at localhost or the wrong environment." },
    { myth: "<code>http.Server{}</code> with no timeouts is a fine start.", truth: "The zero value has no timeouts. A client that opens a connection and sends nothing holds a slot forever. Set <code>ReadHeaderTimeout</code> on every server." },
  ],
  gcp: [
    { service: "Cloud Run", role: "Already compatible: it requires listening on <code>$PORT</code> on all interfaces, handling <code>SIGTERM</code> within 10 s, and JSON logs on stdout. The one thing missing is statelessness, which is Capsule 06's problem." },
    { service: "Cloud Logging", role: "Parses JSON on stdout automatically and turns your fields into queryable structure. Using the key <code>severity</code> instead of slog's <code>level</code> makes it colour and filter correctly (Capsule 25)." },
  ],
  takeaways: [
    "Same binary everywhere; only environment variables differ.",
    "Default only where a wrong guess is loud. Where it's quiet, refuse to start.",
    "<code>/healthz</code> never touches a dependency.",
    "Fail readiness before you drain.",
    "<code>ReadHeaderTimeout</code> on every <code>http.Server</code>, <code>MaxBytesReader</code> on every body.",
    "One structured log line per request: method, path, status, duration.",
    "Run tests with <code>-race</code>.",
  ],
  drill: [
    { q: "Your <code>/healthz</code> pings Postgres. Postgres has a 30-second blip. Walk through what happens.", a: [
      "Every replica fails liveness at the same moment, the orchestrator restarts all of them, and capacity drops to zero. They cold-start together and open connections at once, so the recovering database gets a connection storm and the outage runs well past the original blip.",
      "Dependency checks belong in readiness, where failing means \"don't send me traffic\" rather than \"kill me\".",
    ] },
    { q: "Why does <code>PORT</code> get a default but <code>DATABASE_URL</code> must not?", a: [
      "A wrong port fails immediately and visibly: nothing can connect. A defaulted database URL fails invisibly and dangerously: it might point at localhost, or at the wrong environment. Default only where a wrong guess is loud.",
    ] },
    { q: "You remove the mutex from <code>MemStore</code> and the tests still pass. Why is it still a bug?", a: [
      "Data races are non-deterministic, so a single-threaded test won't trigger one. <code>go test -race</code> instruments memory access and catches it, which is why <code>-race</code> is in the Makefile. In production, concurrent map writes make the Go runtime panic the whole process. It's unrecoverable.",
    ] },
    { q: "In the lab, what changes when you replace <code>Shutdown()</code> with <code>Close()</code>?", a: [
      "With <code>Shutdown()</code>, the in-flight <code>curl /slow</code> completes and the logs show <code>draining</code> then <code>scouter offline</code>. With <code>Close()</code>, the request dies mid-flight. That's the difference between a clean deploy and a burst of 502s every time you ship.",
    ] },
    { q: "What breaks if you run three copies behind a load balancer?", a: [
      "Each has its own <code>MemStore</code>. A reading written to replica A is invisible to B and C, so <code>/fighters/goku</code> depends on which replica you hit, and <code>/leaderboard</code> is wrong on all three. The service is stateful, so it can't scale horizontally. Capsule 06 walks you into this; Capsule 10 fixes it with a database.",
    ] },
  ],
  connects: {
    back: "Capsule 00 gave you the repo, the <code>cmd/</code> + <code>internal/</code> layout and the Makefile this service plugs into.",
    forward: "Capsule 02 packages it into an image, and is the first place the graceful shutdown can silently break. Capsule 06 makes the <code>MemStore</code> hurt, Capsule 10 replaces it, and Capsule 25 builds metrics on the request log line.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "02",
  tagline: "A container is a normal Linux process the kernel has been told to lie to, packaged as an immutable image. Built well, it's 13 MB, non-root and has no shell.",
  built: "You built a naive single-stage image (~1.2 GB, toolchain and source included, running as root), then a multi-stage one: dependencies before source, a static <code>CGO_ENABLED=0</code> binary, copied onto <code>distroless/static:nonroot</code> (~13 MB). You added a <code>.dockerignore</code>, proved <code>docker stop</code> drains in ~2 s, switched to shell-form <code>ENTRYPOINT</code> to watch it take the full 10 s, checked the <code>go mod download</code> layer stays CACHED, and added <code>make docker-build</code> tagged with the git SHA.",
  story: [
    "A container is not a virtual machine. There's no guest kernel. It's a process with <b>namespaces</b> (its own PID space, filesystem, network and hostname), <b>cgroups</b> (CPU and memory limits, the subject of Capsule 05), and a <b>union filesystem</b> of read-only layers. No OS boots, so it starts in milliseconds, which is what makes scale-to-zero possible at all.",
    "Each Dockerfile instruction makes a layer, and Docker reuses a cached layer only if it and everything before it are unchanged. So order instructions from least to most likely to change: copy <code>go.mod</code> and download dependencies <em>before</em> copying source. Get it backwards and every one-line edit re-downloads your modules.",
    "Building needs a compiler; running needs only the binary. A multi-stage build compiles in a fat image and copies the artifact into <b>distroless</b>, which has no shell and no package manager. An attacker who gets code execution finds no <code>sh</code>, no <code>curl</code>, no <code>apt</code>. You lose <code>docker exec … sh</code>, which is a habit worth losing.",
    "The bug that bites everyone: shell-form <code>ENTRYPOINT /scouter</code> makes <code>/bin/sh</code> PID 1, and the shell doesn't forward <code>SIGTERM</code>. The graceful shutdown you built in Capsule 01 never runs, and every deploy ends in <code>SIGKILL</code>.",
  ],
  diagrams: [
    {
      title: "Layer cache after touching one source file",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Left: COPY . . before go mod download, so a source edit invalidates the download and every later layer. Right: go.mod copied first, so the download layer stays cached">
  <rect class="zone" x="8" y="8" width="304" height="274" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="274" rx="12"/>
  <text class="b" x="160" y="30">COPY . . first</text>
  <text class="b" x="480" y="30">go.mod first (the real one)</text>
  <rect class="box ok" x="24" y="52" width="272" height="30" rx="8"/><text class="mono xs start" x="36" y="67">FROM golang</text><text class="xs good end" x="284" y="67">CACHED</text>
  <rect class="box warn" x="24" y="88" width="272" height="30" rx="8"/><text class="mono xs start" x="36" y="103">COPY . .</text><text class="xs bad end" x="284" y="103">changed</text>
  <rect class="box warn" x="24" y="124" width="272" height="30" rx="8"/><text class="mono xs start" x="36" y="139">RUN go mod download</text><text class="xs bad end" x="284" y="139">re-runs</text>
  <rect class="box warn" x="24" y="160" width="272" height="30" rx="8"/><text class="mono xs start" x="36" y="175">RUN go build</text><text class="xs bad end" x="284" y="175">re-runs</text>
  <text class="sm bad" x="160" y="236">every edit re-downloads modules</text>
  <rect class="box ok" x="344" y="52" width="272" height="30" rx="8"/><text class="mono xs start" x="356" y="67">FROM golang:1.25-alpine</text><text class="xs good end" x="604" y="67">CACHED</text>
  <rect class="box ok" x="344" y="88" width="272" height="30" rx="8"/><text class="mono xs start" x="356" y="103">COPY go.mod go.sum* ./</text><text class="xs good end" x="604" y="103">CACHED</text>
  <rect class="box ok" x="344" y="124" width="272" height="30" rx="8"/><text class="mono xs start" x="356" y="139">RUN go mod download</text><text class="xs good end" x="604" y="139">CACHED</text>
  <rect class="box warn" x="344" y="160" width="272" height="30" rx="8"/><text class="mono xs start" x="356" y="175">COPY . .</text><text class="xs bad end" x="604" y="175">changed</text>
  <rect class="box warn" x="344" y="196" width="272" height="30" rx="8"/><text class="mono xs start" x="356" y="211">RUN go build</text><text class="xs bad end" x="604" y="211">re-runs</text>
  <text class="sm good" x="480" y="252">the download stays cached</text>
</svg>`,
      caption: "A changed layer invalidates every layer after it. Step 6 checks this: <code>touch internal/scouter/server.go</code>, rebuild, and <code>go mod download</code> must say CACHED. The same rule applies to <code>package.json</code> + <code>npm ci</code> and <code>requirements.txt</code> + <code>pip install</code>.",
    },
    {
      title: "Multi-stage: build fat, ship thin",
      svg: `<svg class="dg" viewBox="0 0 640 240" role="img" aria-label="Build stage has the Go compiler and source and produces a static binary; only the binary is copied into a distroless nonroot image. 1.2 GB naive versus 13 MB">
  <rect class="zone" x="8" y="8" width="270" height="146" rx="12"/>
  <rect class="zone" x="362" y="8" width="270" height="146" rx="12"/>
  <text class="sm b" x="143" y="28">build: golang:1.25-alpine</text>
  <text class="sm b" x="497" y="28">run: distroless/static:nonroot</text>
  <rect class="box dim" x="24" y="44" width="238" height="28" rx="8"/><text class="sm" x="143" y="58">Go compiler (~500 MB)</text>
  <rect class="box dim" x="24" y="78" width="238" height="28" rx="8"/><text class="sm" x="143" y="92">module cache + source</text>
  <rect class="box hot" x="24" y="112" width="238" height="28" rx="8"/><text class="sm" x="143" y="126">/bin/scouter, static</text>
  <rect class="box" x="378" y="44" width="238" height="28" rx="8"/><text class="sm" x="497" y="58">CA certs + tzdata</text>
  <rect class="box" x="378" y="78" width="238" height="28" rx="8"/><text class="sm" x="497" y="92">USER nonroot · no shell</text>
  <rect class="box hot" x="378" y="112" width="238" height="28" rx="8"/><text class="sm" x="497" y="126">/scouter</text>
  <line class="wire" x1="264" y1="126" x2="374" y2="126"/>
  <text class="mono xs halo" x="320" y="112">COPY --from</text>
  <text class="sm start" x="20" y="186">naive</text>
  <rect class="box warn" x="90" y="174" width="530" height="24" rx="6"/><text class="sm" x="355" y="186">1.2 GB · whole toolchain, your source, runs as root</text>
  <text class="sm start" x="20" y="220">v1</text>
  <rect class="box ok" x="90" y="208" width="6" height="24" rx="2"/><text class="sm start" x="106" y="220">13 MB · roughly 90× smaller to push, pull and store</text>
</svg>`,
      caption: "Everything in the left box is thrown away. <code>CGO_ENABLED=0</code> is what makes the binary static enough to run with no libc. The bar lengths are to scale: 13 MB is about 1% of 1.2 GB.",
    },
    {
      title: "Exec form vs shell form: who is PID 1",
      svg: `<svg class="dg" viewBox="0 0 640 270" role="img" aria-label="Exec form: SIGTERM reaches /scouter as PID 1, it drains and docker stop returns in about 2 seconds. Shell form: /bin/sh is PID 1, does not forward SIGTERM, Docker waits 10 seconds and SIGKILLs">
  <text class="mono sm start" x="20" y="22">ENTRYPOINT [\"/scouter\"]</text>
  <rect class="box" x="20" y="40" width="110" height="44" rx="8"/><text class="sm" x="75" y="62">docker stop</text>
  <line class="wire" x1="132" y1="62" x2="186" y2="62"/><text class="xs" x="159" y="50">SIGTERM</text>
  <rect class="box hot" x="190" y="40" width="170" height="44" rx="8"/><text x="275" y="62">PID 1: /scouter</text>
  <line class="wire good" x1="362" y1="62" x2="406" y2="62"/>
  <rect class="box ok" x="410" y="40" width="210" height="44" rx="8"/><text class="sm" x="515" y="54">drains, logs, exits 0</text><text class="sm good" x="515" y="72">stop returns in ~2 s</text>
  <text class="mono sm start" x="20" y="132">ENTRYPOINT /scouter</text>
  <rect class="box" x="20" y="150" width="110" height="44" rx="8"/><text class="sm" x="75" y="172">docker stop</text>
  <line class="wire" x1="132" y1="172" x2="186" y2="172"/><text class="xs" x="159" y="160">SIGTERM</text>
  <rect class="box warn" x="190" y="150" width="170" height="44" rx="8"/><text x="275" y="172">PID 1: /bin/sh -c</text>
  <line class="wire dash bad" x1="275" y1="196" x2="275" y2="218"/>
  <text class="xs bad start" x="286" y="208">✗ not forwarded</text>
  <rect class="box dim" x="190" y="222" width="170" height="36" rx="8"/><text class="sm" x="275" y="240">/scouter, never told</text>
  <line class="wire bad" x1="362" y1="172" x2="406" y2="172"/>
  <rect class="box warn" x="410" y="150" width="210" height="44" rx="8"/><text class="sm" x="515" y="164">10 s grace, then SIGKILL</text><text class="sm bad" x="515" y="182">in-flight requests die</text>
</svg>`,
      caption: "In the lab, the shell-form build takes the full 10 seconds and you never see the shutdown logs. Exec form is a JSON array. It's one line, and it's what keeps Capsule 01's drain alive in production.",
    },
  ],
  concepts: [
    { term: "Namespaces, cgroups, layers", plain: "Namespaces give the process its own view of PIDs, mounts, network and hostname. Cgroups cap CPU, memory and I/O. The image is a stack of read-only, content-addressed layers with a thin writable one on top.", why: "No kernel to boot means millisecond starts, which is what makes scale-to-zero and per-request autoscaling possible." },
    { term: "Image vs container", plain: "Dockerfile → image (immutable, tagged, like a class) → container (a disposable instance).", why: "If you <code>docker exec</code> in to fix something, you've built a pet, and the fix vanishes on the next deploy." },
    { term: "Layer cache order", plain: "Docker reuses a layer only if it and every layer before it are unchanged. Put what changes least at the top.", why: "<code>go.mod</code> + <code>go mod download</code> before <code>COPY . .</code> is the single highest-leverage ordering in the file." },
    { term: "Distroless + non-root", plain: "<code>gcr.io/distroless/static</code> is about 2 MB with CA certs and tzdata, but no shell, no package manager and no libc. Its <code>nonroot</code> user is UID 65532.", why: "Root in a container plus an escape bug is root on the host. And no shell removes a whole category of post-exploitation." },
    { term: ".dockerignore", plain: "Keeps <code>.git</code>, build output, <code>.env</code> and Terraform state out of the build context.", why: "Without it, <code>COPY . .</code> can copy a <code>.env</code> into a layer where <code>docker history</code> shows it, and any file change busts the cache." },
    { term: "Immutable tags", plain: "Tag with the git SHA (<code>make docker-build</code> does). Treat <code>latest</code> as a convenience alias only.", why: "<code>latest</code> moves. Two people pulling it an hour apart get different software. Capsule 24's instant rollback depends on immutable tags." },
  ],
  numbers: [
    { value: "1.2 GB → 13 MB", label: "Naive vs multi-stage", note: "Roughly 90× less to push, pull on every cold start, and store." },
    { value: "~500 MB vs ~10 MB", label: "Go compiler vs the binary it makes", note: "Why the build tools never ship." },
    { value: "10 s vs ~2 s", label: "docker stop: shell form vs exec form", note: "10 s is Docker's grace period before <code>SIGKILL</code>; 2 s is the Scouter's drain delay." },
    { value: "~25%", label: "Smaller with -ldflags=\"-s -w\"", note: "Drops the symbol table and DWARF debug info." },
    { value: "0.5 GB", label: "Artifact Registry free tier", note: "13 MB fits comfortably. 1.2 GB does not." },
  ],
  traps: [
    { myth: "A container is a lightweight VM.", truth: "There's no guest kernel. It shares the host's, which is why it starts in milliseconds and why it's only a weak security boundary." },
    { myth: "I deleted the secret in a later layer, so it's gone.", truth: "Layers are additive. The delete is a whiteout in a later layer; the file is still in the earlier one. Keep it out with <code>.dockerignore</code> or BuildKit secret mounts, and <b>rotate it</b>." },
    { myth: "<code>ENTRYPOINT /scouter</code> and <code>[\"/scouter\"]</code> are the same.", truth: "Shell form makes <code>/bin/sh</code> PID 1 and it doesn't forward <code>SIGTERM</code>. Your app never drains." },
    { myth: "Just use alpine, it's small.", truth: "It's musl, not glibc. Irrelevant for a static Go binary, but cgo-based libraries (some database drivers, image libraries) can behave subtly differently." },
    { myth: "My laptop builds the image, so CI will too.", truth: "Locally <code>GOTOOLCHAIN=auto</code> quietly downloads a newer Go when <code>go.mod</code> asks. The official golang images set <code>GOTOOLCHAIN=local</code> and refuse. Keep the builder tag ≥ your <code>go</code> directive." },
  ],
  gcp: [
    { service: "Artifact Registry", role: "Where images live. Container Registry (<code>gcr.io</code>) is deprecated. 0.5 GB free." },
    { service: "Cloud Run", role: "Deploys an image directly; nothing else needed. It expects <code>linux/amd64</code>, so on an Apple Silicon Mac you build with <code>--platform linux/amd64</code> (Capsule 04)." },
    { service: "Cloud Build", role: "Builds the image in the cloud from a <code>cloudbuild.yaml</code>, on amd64, without emulation." },
    { service: "Binary Authorization", role: "Worth knowing by name: it can require images to be signed by your pipeline before Cloud Run or GKE will run them." },
  ],
  takeaways: [
    "<code>.dockerignore</code> before the Dockerfile.",
    "Dependencies before source, always.",
    "Multi-stage onto distroless for static binaries; <code>CGO_ENABLED=0</code>.",
    "Non-root <code>USER</code> in every image.",
    "Exec-form <code>ENTRYPOINT</code>, or graceful shutdown silently dies.",
    "Tag with the git SHA; <code>latest</code> is only an alias.",
    "Pin base images, and keep the builder tag ≥ the <code>go</code> directive in <code>go.mod</code>.",
  ],
  drill: [
    { q: "CI takes 8 minutes and 7 of them are <code>go mod download</code> on every build. What's wrong?", a: [
      "<code>COPY . .</code> comes before <code>go mod download</code>. Any source change invalidates the COPY layer and every layer after it, including the download.",
      "Copy <code>go.mod</code>/<code>go.sum</code> alone, run <code>go mod download</code>, then copy the source. The same fix applies to npm, pip and bundler.",
    ] },
    { q: "Why is a shell-form <code>ENTRYPOINT</code> dangerous in production?", a: [
      "It runs your command via <code>/bin/sh -c</code>, so the shell is PID 1 and doesn't forward <code>SIGTERM</code>. Your app never learns it's shutting down, the platform <code>SIGKILL</code>s it after the grace period, and every in-flight request is severed. On a busy service that's a burst of 502s on every deploy.",
    ] },
    { q: "You deleted a secret file in a later layer. Is it gone from the image?", a: [
      "No. Layers are additive; the delete adds a whiteout in a later layer while the file stays in the earlier one. Anyone with the image can read it.",
      "Never let it in (<code>.dockerignore</code>), use BuildKit secret mounts (<code>RUN --mount=type=secret,…</code>), or inject secrets at runtime. And rotate the secret regardless.",
    ] },
    { q: "Distroless has no shell. How do you debug?", a: [
      "You make the container tell you: structured logs (Capsule 01), metrics and traces (Capsule 25). If you must inspect a live container, <code>kubectl debug</code> attaches a separate image with tools into the same namespaces without changing the running one.",
      "It forces the observability you need anyway for the ten instances you can't reach.",
    ] },
    { q: "Is a container a security boundary?", a: [
      "A weak one. It shares the host kernel, so a kernel bug can be an escape. Treat it as isolation for correctness and defence in depth for security. For hostile workloads you want VM-level isolation (gVisor, Firecracker, Cloud Run's second-generation environment). Non-root, a read-only root filesystem and dropped capabilities are what you do meanwhile.",
    ] },
  ],
  connects: {
    back: "Capsule 01's graceful shutdown is what Step 5 protects, and its JSON logs are what you watch in lazydocker (Capsule 00).",
    forward: "Capsule 03 runs this image in compose and has to work around distroless having no shell for its healthcheck. Capsule 04 pushes it to Artifact Registry with <code>--platform linux/amd64</code>. Capsule 05 is about the cgroup limits you saw in the Stats panel.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "03",
  tagline: "If it was clicked, nobody knows how to make it again. Reproducibility means the environment is a file: compose for the local stack, Terraform for infrastructure.",
  built: "You wrote <code>deploy/docker-compose.yml</code> with the Scouter and a <code>pinger</code> behind <code>--profile load</code>, added a <code>-health</code> flag so a healthcheck works on a shell-less distroless image, and added <code>make up</code>/<code>down</code>/<code>logs</code>. Then you walked the full Terraform lifecycle with the <code>local</code> and <code>random</code> providers, no cloud account: <code>init</code>, <code>fmt</code>, <code>validate</code>, <code>plan</code>, <code>apply</code>, a second plan showing no changes, a replacement, hand-made drift reverted, and <code>destroy</code>.",
  story: [
    "Infrastructure comes into existence in one of two ways. Someone clicks through a console, and it works, and nobody knows what they clicked. Or someone writes a file, another person reviews it, and a tool applies it. The first is faster today and catastrophic in eighteen months.",
    "Locally, <b>the compose file is the environment</b>. It gives you a shared network where the service name is the hostname, named volumes, and start ordering. Plain <code>depends_on</code> only waits for a container to <em>start</em>, not to be <em>ready</em>; you need a healthcheck and <code>condition: service_healthy</code>, and really an app that retries its dependencies.",
    "Terraform is <b>declarative and convergent</b>. You declare the desired state; it compares that with the recorded state and the real world, and plans the minimum change. Run it twice and the second run changes nothing. That second, empty plan is the property everything else rests on.",
    "Four ideas do most of the work. State is the crown jewels: lose it and Terraform forgets it owns anything. The plan is the review artifact, and the word to hunt for is <b>replace</b>. The dependency graph comes from references. Modules are functions, so dev and prod come from one definition with different inputs.",
  ],
  diagrams: [
    {
      title: "Terraform compares three things, then converges",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Your .tf files, the state file and the real world feed terraform plan, which proposes the difference; apply makes reality match and a second plan shows no changes">
  <rect class="box hot" x="20" y="20" width="180" height="66" rx="10"/><text class="b" x="110" y="38">your .tf files</text><text class="xs mute" x="110" y="56">desired</text><text class="mono xs" x="110" y="73">I want 3 of X</text>
  <rect class="box energy" x="230" y="20" width="180" height="66" rx="10"/><text class="b" x="320" y="38">terraform.tfstate</text><text class="xs mute" x="320" y="56">recorded</text><text class="mono xs" x="320" y="73">last time: 2 of X</text>
  <rect class="box cool" x="440" y="20" width="180" height="66" rx="10"/><text class="b" x="530" y="38">the real world</text><text class="xs mute" x="530" y="56">actual</text><text class="mono xs" x="530" y="73">actually: 2 of X</text>
  <line class="wire" x1="110" y1="88" x2="252" y2="128"/>
  <line class="wire" x1="320" y1="88" x2="320" y2="126"/>
  <line class="wire" x1="530" y1="88" x2="388" y2="128"/>
  <rect class="box warn" x="230" y="130" width="180" height="50" rx="10"/><text class="b" x="320" y="146">terraform plan</text><text class="mono sm" x="320" y="166">+ 1 to add</text>
  <line class="wire" x1="320" y1="182" x2="320" y2="210"/>
  <rect class="box ok" x="130" y="214" width="380" height="36" rx="10"/><text class="sm" x="320" y="232">apply: make reality match, record it in state</text>
  <text class="sm good" x="320" y="274">plan again → \"No changes.\" That is convergence.</text>
</svg>`,
      caption: "State maps your resource names to real IDs. That's why losing it makes Terraform try to create everything again, and why it lives in a versioned bucket with locking, never in git. It also holds secrets in plaintext.",
    },
    {
      title: "Reading the plans you ran in the lab",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Four lab commands and what plan printed: no changes; local_file must be replaced; random_pet and local_file must be replaced; local_file will be created after a manual edit">
  <text class="xs mute start" x="20" y="22">YOU RAN</text>
  <text class="xs mute start" x="230" y="22">PLAN SAID</text>
  <text class="xs mute start" x="460" y="22">WHY</text>
  <rect class="box ok" x="20" y="34" width="600" height="44" rx="8"/>
  <text class="mono xs start" x="32" y="56">terraform plan (again)</text>
  <text class="mono xs start" x="230" y="56">No changes.</text>
  <text class="sm start" x="460" y="56">converged</text>
  <rect class="box energy" x="20" y="86" width="600" height="44" rx="8"/>
  <text class="mono xs start" x="32" y="108">-var 'replica_count=3'</text>
  <text class="mono xs start" x="230" y="108">-/+ local_file replaced</text>
  <text class="xs start" x="460" y="100">content changed; a file</text>
  <text class="xs start" x="460" y="116">can't be edited in place</text>
  <rect class="box warn" x="20" y="138" width="600" height="44" rx="8"/>
  <text class="mono xs start" x="32" y="160">-var 'environment=prod'</text>
  <text class="mono xs start" x="230" y="152">-/+ random_pet replaced</text>
  <text class="mono xs start" x="230" y="168">-/+ local_file replaced</text>
  <text class="xs start" x="460" y="152">keepers changed:</text>
  <text class="xs start" x="460" y="168">forces replacement</text>
  <rect class="box cool" x="20" y="190" width="600" height="44" rx="8"/>
  <text class="mono xs start" x="32" y="212">echo HACKED=true >> dev.env</text>
  <text class="mono xs start" x="230" y="212">+ local_file created</text>
  <text class="xs start" x="460" y="204">drift caught; apply</text>
  <text class="xs start" x="460" y="220">rewrites the file</text>
  <text class="mono sm start" x="20" y="264">~ update in place</text><text class="mono sm start" x="190" y="264">-/+ destroy and recreate</text><text class="mono sm start" x="410" y="264">+ create</text><text class="mono sm start" x="510" y="264">- destroy</text>
</svg>`,
      caption: "This is what the plans print when the lab is run (Terraform 1.15, local provider 2.5). The capsule's comment expects <code>replica_count=3</code> to show <code>~</code> update in place; the local provider can't update a file in place, so it shows <code>-/+</code> as well. The lesson holds: <code>-/+</code> on a database would be the blocked PR.",
    },
    {
      title: "The compose stack: service names are hostnames",
      svg: `<svg class="dg" viewBox="0 0 640 280" role="img" aria-label="Inside the compose network, pinger curls http://scouter:8080/healthz every 2 seconds; scouter's healthcheck runs /scouter -health against 127.0.0.1; your laptop reaches it through the 8080 port mapping">
  <rect class="zone" x="8" y="30" width="624" height="170" rx="12"/>
  <text class="sm b start" x="24" y="50">compose network</text>
  <rect class="box dim" x="24" y="80" width="150" height="60" rx="10"/><text class="b" x="99" y="100">pinger</text><text class="mono xs" x="99" y="122">--profile load</text>
  <line class="wire" x1="176" y1="110" x2="396" y2="110"/>
  <text class="mono xs" x="286" y="98">http://scouter:8080/healthz</text>
  <text class="xs mute" x="286" y="124">every 2 s</text>
  <rect class="box hot" x="400" y="44" width="220" height="140" rx="10"/>
  <text class="b" x="510" y="62">scouter</text>
  <text class="mono xs" x="510" y="80">image scouter:dev</text>
  <rect class="box cool" x="414" y="96" width="192" height="76" rx="8"/>
  <text class="xs" x="510" y="112">healthcheck, every 10 s</text>
  <text class="mono xs" x="510" y="132">/scouter -health</text>
  <text class="mono xs" x="510" y="152">→ 127.0.0.1:8080/healthz</text>
  <rect class="box" x="400" y="232" width="220" height="36" rx="8"/><text class="mono xs" x="510" y="250">you: curl localhost:8080</text>
  <line class="wire" x1="510" y1="230" x2="510" y2="188"/>
  <text class="xs halo start" x="518" y="212">ports 8080:8080</text>
  <text class="sm start" x="24" y="226">The service name is the hostname. No IPs.</text>
  <text class="sm start" x="24" y="246">Plain depends_on waits for started, not ready.</text>
  <text class="sm mute start" x="24" y="266">Add condition: service_healthy, and retry.</text>
</svg>`,
      caption: "A healthcheck runs inside the container, and distroless has no shell or curl, so the binary checks itself. In production the right answer is that the platform probes <code>/readyz</code> over the network; the <code>-health</code> flag is five lines that make compose behave.",
    },
  ],
  concepts: [
    { term: "Compose file as environment", plain: "One YAML file declares the containers, their config, network and volumes, versioned next to the code.", why: "A new teammate runs <code>make up</code> and has exactly your stack. Onboarding drops from a day to a coffee." },
    { term: "depends_on vs readiness", plain: "Plain <code>depends_on</code> waits for the process to launch. <code>condition: service_healthy</code> waits for its healthcheck.", why: "The classic \"crashed because Postgres wasn't accepting connections yet\". Better still, the app retries with backoff, because orchestrators don't guarantee start order at all." },
    { term: "Declarative and convergent", plain: "You describe the end state. Terraform plans the minimum change to get there, and a second run changes nothing.", why: "<code>plan -detailed-exitcode</code> returns 0 for no changes, 2 for pending, 1 for error. That's what CI gates on." },
    { term: "State", plain: "<code>terraform.tfstate</code> maps resource names to real IDs and stores full attributes, secrets included, in plaintext.", why: "Lose it and Terraform plans to create everything again; existing resources are orphaned. So: remote, versioned, locked, never in git." },
    { term: "Plan as the review artifact", plain: "<code>plan</code> shows adds, in-place changes (<code>~</code>) and replacements (<code>-/+</code>) before anything happens.", why: "An unexpected <code>forces replacement</code> is how you catch \"this one field silently recreates the database\"." },
    { term: "Drift", plain: "Someone changes the real world by hand. The next <code>plan</code> refreshes, sees the difference, and proposes reverting it.", why: "If a change should exist, it should be in the code. Mature teams run <code>plan</code> nightly just to alert on drift." },
  ],
  numbers: [
    { value: "0 / 2 / 1", label: "plan -detailed-exitcode", note: "No changes / changes pending / error." },
    { value: "$0", label: "Cost of this lab", note: "<code>local</code> and <code>random</code> providers: no credentials, no account, same workflow." },
  ],
  traps: [
    { myth: "<code>depends_on: [postgres]</code> means Postgres is ready.", truth: "It means the container started. Postgres takes seconds to accept connections. Use a healthcheck with <code>service_healthy</code>, and make the app retry." },
    { myth: "State is a cache; we can regenerate it.", truth: "Delete it and Terraform believes it manages nothing. Recovery is <code>terraform import</code>, one resource at a time. Object versioning on the state bucket is your undo button." },
    { myth: "<code>sensitive = true</code> keeps secrets out of state.", truth: "It only hides them from CLI output. They're still in state, in plaintext." },
    { myth: "Commit the lock file? It's generated, so ignore it.", truth: "Commit <code>.terraform.lock.hcl</code>; it pins provider versions and checksums, like <code>go.sum</code>. Ignore <code>*.tfstate</code> and <code>*.tfvars</code>." },
    { myth: "Hand-fixing something in the console is fine; Terraform will keep it.", truth: "The next apply reverts it. Put it in code or lose it." },
  ],
  gcp: [
    { service: "Cloud Storage (gcs backend)", role: "Where real state goes: a bucket with <b>object versioning</b> on, created once by hand because the Terraform that uses it can't create it." },
    { service: "google_cloud_run_v2_service", role: "The resource you'll apply in Capsule 04: image tagged with a git SHA, CPU and memory limits, <code>min_instance_count = 0</code> for scale to zero, <code>max_instance_count = 10</code> as a spending ceiling." },
    { service: "Config Connector", role: "Infrastructure as Kubernetes resources. Great if you already live in Kubernetes, needless coupling if you don't." },
  ],
  takeaways: [
    "The compose file is the environment; <code>make up</code> starts everything.",
    "Readiness, not start order: healthchecks, <code>service_healthy</code>, and retries in the app.",
    "<code>plan</code> in CI on every PR. A plan nobody reads is theatre.",
    "Read every plan for the word <b>replace</b>.",
    "Remote state, versioned bucket, locking on. Commit the lock file, ignore the state.",
    "<code>fmt -check</code> and <code>validate</code> in CI.",
    "Never <code>apply</code> to production from a laptop.",
  ],
  drill: [
    { q: "A colleague deletes <code>terraform.tfstate</code> and runs <code>apply</code>. What happens?", a: [
      "Terraform thinks it manages nothing and plans to create everything. Against a real cloud you get duplicates or name-conflict errors, and the existing resources are orphaned: real, billing and unmanaged.",
      "Recovery is <code>terraform import</code> for each resource. That's why state lives in a bucket with object versioning: you restore the previous version and move on.",
    ] },
    { q: "Why is <code>depends_on: [postgres]</code> in compose not enough?", a: [
      "It waits for the container to start, not for Postgres to accept connections, so the app connects too early, fails and exits: \"works on the second try\".",
      "Add a healthcheck and <code>condition: service_healthy</code>. Better, make the app retry its dependencies with backoff and report not-ready meanwhile, because orchestrators don't guarantee start order.",
    ] },
    { q: "Someone changes a setting in the GCP console. What does Terraform do next run?", a: [
      "<code>plan</code> refreshes real state, sees the difference and proposes reverting it. That's drift detection. You saw it in the lab when the hand-edited <code>dev.env</code> was rewritten on the next apply.",
    ] },
    { q: "Why does Terraform state contain secrets, and what do you do about it?", a: [
      "State stores every resource's full attributes, including generated passwords and connection strings, in plaintext JSON. <code>sensitive = true</code> only hides them from CLI output.",
      "Keep state remote, encrypted at rest, with tightly scoped IAM, never in git, and prefer resources that reference Secret Manager over ones that generate and hold the secret.",
    ] },
    { q: "Terraform, Pulumi, Config Connector or clicking?", a: [
      "Terraform/OpenTofu is the default: multi-cloud, declarative, and what job listings ask for. Pulumi/CDK give you real languages, and make it easier to write something clever nobody can review. Config Connector/Crossplane fit if you already live in Kubernetes.",
      "Clicking is fine for exploring, never for anything that must exist tomorrow. Click to learn, then export the config and commit it.",
    ] },
  ],
  connects: {
    back: "Capsule 02's image is what compose runs, and its lack of a shell is why the <code>-health</code> flag exists. Capsule 01's <code>/healthz</code> is what both the pinger and the healthcheck call.",
    forward: "Capsule 04 is where the GCP version of this Terraform would run, and where a state bucket would matter. The compose file grows Postgres in Capsule 10, Redis in 14 and the Pub/Sub emulator in 18; Capsule 09 replaces the pinger with k6.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "04",
  tagline: "Nobody learns 200 products from the catalogue. Learn the map instead: the project is the unit that matters, geography is a cost and latency decision, and compute and data are spectrums you place every service on.",
  built: "You installed <code>gcloud</code>, learned its <code>&lt;group&gt; &lt;subgroup&gt; &lt;verb&gt;</code> shape and the <code>--format</code>/<code>--filter</code> flags that work on every command. On the optional ☁️ path you created an Artifact Registry repo, built the image for <code>linux/amd64</code>, deployed the Scouter to Cloud Run with scale to zero and a 3-instance ceiling, queried its JSON logs, read its cost model, and tore everything down the same day.",
  story: [
    "GCP has more than 200 products, and the skill that outlasts all of them is placing a service on a map: which layer it sits in, what it competes with, roughly what it costs. This capsule is that map, and it's mostly reading. The deploy is optional; skip it and you still complete the capsule.",
    "<b>The project is the atom of GCP.</b> It's the billing unit, the IAM boundary, the quota boundary, the naming scope and the deletion unit. So environments are separate projects, not prefixes, and a throwaway project is a free blast radius: deleting it is the only teardown that never misses anything. Policies set higher up, on a folder or the organization, inherit downward.",
    "Geography is a cost and latency decision. A zone is roughly one datacenter and one failure domain; a region is 3+ zones about 1 ms apart. Replicate anything stateful across at least two zones, keep compute in the same region as its data, and remember that egress and cross-region traffic cost money. Your architecture diagram is also a billing diagram.",
    "Compute is a spectrum from more control to less work: Compute Engine, GKE, Cloud Run, Cloud Functions. The course uses Cloud Run for everything, because it removes cluster management and lets each capsule be about the concept. For data, start with Cloud SQL (Postgres) and move only when you've measured a specific reason.",
  ],
  diagrams: [
    {
      title: "The resource hierarchy: the project is the unit that matters",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Organization contains folders, folders contain projects such as myapp-dev, myapp-staging and myapp-prod, projects contain resources. Org Policy inherits downward">
  <text class="sm start" x="20" y="24">The project is the unit of:</text>
  <text class="xs mute start" x="20" y="44">billing · IAM · quota</text>
  <text class="xs mute start" x="20" y="60">naming · deletion</text>
  <rect class="box" x="230" y="12" width="180" height="44" rx="10"/><text x="320" y="28">Organization</text><text class="xs mute" x="320" y="45">company domain</text>
  <rect class="box" x="230" y="78" width="180" height="44" rx="10"/><text x="320" y="94">Folder</text><text class="xs mute" x="320" y="111">team, dept · optional</text>
  <line class="wire" x1="320" y1="58" x2="320" y2="74"/>
  <rect class="box hot" x="40" y="152" width="170" height="52" rx="10"/><text class="mono" x="125" y="170">myapp-dev</text><text class="xs" x="125" y="190">project</text>
  <rect class="box hot" x="235" y="152" width="170" height="52" rx="10"/><text class="mono" x="320" y="170">myapp-staging</text><text class="xs" x="320" y="190">project</text>
  <rect class="box hot" x="430" y="152" width="170" height="52" rx="10"/><text class="mono" x="515" y="170">myapp-prod</text><text class="xs" x="515" y="190">project</text>
  <line class="wire" x1="300" y1="124" x2="140" y2="148"/>
  <line class="wire" x1="320" y1="124" x2="320" y2="148"/>
  <line class="wire" x1="340" y1="124" x2="500" y2="148"/>
  <rect class="box dim" x="50" y="234" width="150" height="36" rx="8"/><text class="xs" x="125" y="252">Cloud Run · bucket · DB</text>
  <rect class="box dim" x="245" y="234" width="150" height="36" rx="8"/><text class="xs" x="320" y="252">Cloud Run · bucket · DB</text>
  <rect class="box dim" x="440" y="234" width="150" height="36" rx="8"/><text class="xs" x="515" y="252">Cloud Run · bucket · DB</text>
  <line class="wire" x1="125" y1="206" x2="125" y2="230"/>
  <line class="wire" x1="320" y1="206" x2="320" y2="230"/>
  <line class="wire" x1="515" y1="206" x2="515" y2="230"/>
  <line class="wire soft" x1="616" y1="24" x2="616" y2="144"/>
  <text class="sm end" x="604" y="60">Org Policy set once</text>
  <text class="xs mute end" x="604" y="78">inherits downward</text>
</svg>`,
      caption: "Environments are separate projects. It's the only boundary that reliably stops a dev mistake from touching prod. On a personal account there's no organization; projects sit directly under your account, and everything else works the same.",
    },
    {
      title: "Zones, regions, and what crossing them costs",
      svg: `<svg class="dg" viewBox="0 0 640 310" role="img" aria-label="Region us-central1 has three zones about 1 ms apart; the database primary and replica sit in different zones. A second region is 30 to 150 ms away and billed. Ingress from the internet is free, egress is billed">
  <rect class="zone" x="8" y="30" width="400" height="186" rx="12"/>
  <text class="sm b start" x="24" y="50">region us-central1 · 3+ zones</text>
  <rect class="box" x="24" y="66" width="112" height="128" rx="8"/><text class="mono xs" x="80" y="82">us-central1-a</text>
  <rect class="box" x="152" y="66" width="112" height="128" rx="8"/><text class="mono xs" x="208" y="82">us-central1-b</text>
  <rect class="box" x="280" y="66" width="112" height="128" rx="8"/><text class="mono xs" x="336" y="82">us-central1-c</text>
  <rect class="box hot" x="36" y="96" width="88" height="28" rx="6"/><text class="sm" x="80" y="110">app</text>
  <rect class="box hot" x="164" y="96" width="88" height="28" rx="6"/><text class="sm" x="208" y="110">app</text>
  <rect class="box hot" x="292" y="96" width="88" height="28" rx="6"/><text class="sm" x="336" y="110">app</text>
  <rect class="box energy" x="36" y="146" width="88" height="28" rx="6"/><text class="sm" x="80" y="160">DB primary</text>
  <rect class="box energy" x="164" y="146" width="88" height="28" rx="6"/><text class="sm" x="208" y="160">DB replica</text>
  <line class="wire" x1="126" y1="160" x2="160" y2="160"/>
  <text class="xs halo" x="143" y="140">~1 ms</text>
  <rect class="zone" x="440" y="30" width="192" height="186" rx="12"/>
  <text class="sm b start" x="456" y="50">region europe-west1</text>
  <rect class="box" x="456" y="66" width="160" height="128" rx="8"/><text class="mono xs" x="536" y="82">a zone</text>
  <rect class="box hot" x="472" y="96" width="128" height="28" rx="6"/><text class="sm" x="536" y="110">app</text>
  <line class="wire bad" x1="382" y1="110" x2="468" y2="110"/>
  <text class="xs bad halo" x="424" y="96">~30–150 ms</text>
  <text class="xs bad halo" x="424" y="124">billed</text>
  <rect class="box" x="200" y="262" width="240" height="34" rx="8"/><text class="sm" x="320" y="279">the internet</text>
  <line class="wire good" x1="270" y1="258" x2="270" y2="220"/>
  <text class="xs good end" x="262" y="240">ingress: free</text>
  <line class="wire bad" x1="370" y1="220" x2="370" y2="258"/>
  <text class="xs bad start" x="378" y="240">egress: billed</text>
</svg>`,
      caption: "A zone can and does go down, so stateful things span at least two. Traffic within a zone is free, between zones in a region costs a little, across regions costs more and adds 30–150 ms. Keeping compute in the database's region does more for p99 than most code you'll write.",
    },
    {
      title: "The compute spectrum",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Compute Engine, GKE, Cloud Run and Cloud Functions ordered from more control to less work, with what you manage and when to choose each">
  <text class="sm b accent start" x="20" y="24">more control</text>
  <text class="sm b accent end" x="620" y="24">less work</text>
  <line class="wire soft" x1="320" y1="24" x2="128" y2="24"/>
  <line class="wire soft" x1="320" y1="24" x2="536" y2="24"/>
  <rect class="box" x="20" y="40" width="140" height="50" rx="10"/><text x="90" y="58">Compute Engine</text><text class="xs mute" x="90" y="76">VMs</text>
  <rect class="box" x="173" y="40" width="140" height="50" rx="10"/><text x="243" y="58">GKE</text><text class="xs mute" x="243" y="76">Kubernetes</text>
  <rect class="box hot" x="327" y="40" width="140" height="50" rx="10"/><text x="397" y="58">Cloud Run</text><text class="xs" x="397" y="76">containers</text>
  <rect class="box" x="480" y="40" width="140" height="50" rx="10"/><text x="550" y="58">Cloud Functions</text><text class="xs mute" x="550" y="76">one function</text>
  <text class="xs mute start" x="20" y="110">YOU MANAGE</text>
  <text class="xs" x="90" y="128">OS, patching,</text><text class="xs" x="90" y="144">scaling, LB</text>
  <text class="xs" x="243" y="128">workloads,</text><text class="xs" x="243" y="144">autoscaling,</text><text class="xs" x="243" y="160">node pools</text>
  <text class="xs" x="397" y="128">a container</text><text class="xs" x="397" y="144">image</text>
  <text class="xs" x="550" y="128">a function body</text>
  <text class="xs mute start" x="20" y="184">CHOOSE IT WHEN</text>
  <rect class="box dim" x="20" y="194" width="140" height="64" rx="8"/><text class="xs" x="90" y="210">specific kernel,</text><text class="xs" x="90" y="226">odd GPU drivers,</text><text class="xs" x="90" y="242">lift-and-shift</text>
  <rect class="box dim" x="173" y="194" width="140" height="64" rx="8"/><text class="xs" x="243" y="210">you need Kubernetes</text><text class="xs" x="243" y="226">itself: operators,</text><text class="xs" x="243" y="242">StatefulSets</text>
  <rect class="box ok" x="327" y="194" width="140" height="64" rx="8"/><text class="xs" x="397" y="210">default: stateless</text><text class="xs" x="397" y="226">HTTP or events,</text><text class="xs" x="397" y="242">scales to zero</text>
  <rect class="box dim" x="480" y="194" width="140" height="64" rx="8"/><text class="xs" x="550" y="210">one small handler</text><text class="xs" x="550" y="226">(v2 is Cloud Run</text><text class="xs" x="550" y="242">underneath)</text>
  <text class="xs accent" x="397" y="276">used for every capsule</text>
</svg>`,
      caption: "\"It's more powerful\" is never the reason to move left. GKE means owning cluster upgrades, node pools and ingress, which is a platform job. Everything you learn on Cloud Run transfers, because a container is a container.",
    },
    {
      title: "Giving code access without a key file",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="An IAM binding grants the service's own service account a predefined role on one bucket. Cloud Run runs as that account, the metadata server hands out a short-lived token, and the client library finds it. A downloaded JSON key is the thing to avoid">
  <text class="xs mute" x="115" y="20">PRINCIPAL (who)</text>
  <text class="xs mute" x="320" y="20">ROLE (what)</text>
  <text class="xs mute" x="525" y="20">RESOURCE (on what)</text>
  <rect class="box cool" x="20" y="32" width="190" height="44" rx="8"/><text class="sm" x="115" y="54">the service's own SA</text>
  <rect class="box" x="225" y="32" width="190" height="44" rx="8"/><text class="mono xs" x="320" y="54">roles/storage.objectViewer</text>
  <rect class="box" x="430" y="32" width="190" height="44" rx="8"/><text class="sm" x="525" y="54">one bucket, not the project</text>
  <line class="wire dash" x1="105" y1="78" x2="105" y2="126"/>
  <text class="mono xs start" x="114" y="102">--service-account=…</text>
  <rect class="box hot" x="20" y="130" width="170" height="56" rx="10"/><text x="105" y="149">Cloud Run</text><text class="xs" x="105" y="169">runs as the SA</text>
  <line class="wire" x1="192" y1="158" x2="231" y2="158"/>
  <rect class="box energy" x="235" y="130" width="170" height="56" rx="10"/><text x="320" y="149">metadata server</text><text class="xs" x="320" y="169">short-lived token</text>
  <line class="wire" x1="407" y1="158" x2="446" y2="158"/>
  <rect class="box ok" x="450" y="130" width="170" height="56" rx="10"/><text x="535" y="149">client library</text><text class="xs" x="535" y="169">ADC finds it, reads</text>
  <rect class="box warn" x="20" y="212" width="600" height="38" rx="8"/>
  <text class="sm" x="320" y="231">✗ Downloaded JSON key: long-lived, it leaks, and leaked keys become crypto miners</text>
  <text class="xs mute" x="320" y="272">Locally: gcloud auth application-default login · From GitHub Actions: Workload Identity Federation</text>
</svg>`,
      caption: "No key exists, so none can leak, and the token is short-lived and rotated automatically. The same code path works on your laptop with <em>your</em> identity. Use a predefined role on the narrowest resource; never <code>roles/editor</code>.",
    },
  ],
  concepts: [
    { term: "Project", plain: "The container every resource lives in: unit of billing, IAM, quota, naming and deletion.", why: "Separate projects per environment give you all five boundaries for free. Delete the project and everything inside is gone, which makes it the cleanest teardown there is." },
    { term: "IAM binding", plain: "Principal (user, group, service account) + role (a bundle of permissions) + resource. Prefer predefined roles; basic roles like <code>roles/editor</code> are legacy.", why: "<code>editor</code> grants about 2,000 permissions across every service. Ask for the narrowest role that works in every access request." },
    { term: "Service account", plain: "An identity for code, not a person. Cloud Run runs <em>as</em> one, which is how it gets permissions without credentials in code or config.", why: "Attached service accounts, Workload Identity Federation and <code>application-default login</code> all give short-lived credentials. Downloaded keys are what auditors find and attackers use." },
    { term: "Zone / region / multi-region", plain: "Zone: roughly one datacenter, one failure domain. Region: 3+ zones about 1 ms apart. Multi-region (<code>US</code>, <code>EU</code>): a storage concept spanning regions.", why: "Stateful things span 2+ zones. Compute sits in its data's region. \"EU data stays in the EU\" is a legal region choice, not a preference." },
    { term: "Data spectrum", plain: "Cloud SQL is the default. AlloyDB when Cloud SQL is too slow and you can't leave Postgres. Spanner for horizontal writes <em>and</em> transactions. Firestore, Bigtable, BigQuery, Memorystore and Cloud Storage each fit one shape.", why: "Start with Cloud SQL and move only for a measured reason. BigQuery is never your transactional store; Spanner is almost never the startup answer." },
    { term: "Global VPC", plain: "A GCP VPC spans every region, with regional subnets inside it. Firewall rules, Cloud NAT and Private Service Connect hang off it.", why: "Unlike AWS, multi-region doesn't need peering between VPCs. Traffic between regions still costs money and still takes ~100 ms." },
  ],
  numbers: [
    { value: "200+", label: "GCP products", note: "Why you learn the map, not the catalogue." },
    { value: "~2,000", label: "Permissions in roles/editor", note: "Across every service. Never grant it in anything real." },
    { value: "~1 ms vs ~30–150 ms", label: "Between zones vs between regions", note: "Region choice moves p99 more than most code." },
    { value: "2M / month", label: "Free Cloud Run requests", note: "The whole optional deploy costs under $0.05, behind a $5 budget alert." },
  ],
  traps: [
    { myth: "Dev and prod in one project, separated by name prefixes.", truth: "IAM can't cleanly separate them, quotas are shared, billing can't be attributed, and one wrong prefix hits production. Separate projects cost nothing." },
    { myth: "A service-account JSON key is the easy way to give code access.", truth: "Keys are long-lived and they leak. Attach a service account (Cloud Run, GCE), use Workload Identity Federation (CI), and <code>application-default login</code> locally." },
    { myth: "GKE, because it'll scale better.", truth: "Cloud Run scales to thousands of instances. Move to GKE for a concrete need: StatefulSets, operators, a service mesh, GPU scheduling, a shared platform." },
    { myth: "A global VPC means cross-region traffic is free and fast.", truth: "It means no peering. Traffic between regions still costs money and still takes around 100 ms." },
    { myth: "<code>--min-instances=0</code> is free, so always use it.", truth: "It's free when idle, and you pay in cold starts: tens of ms for a small Go binary, seconds for a JVM. <code>--min-instances=1</code> keeps one warm and bills you for it." },
  ],
  gcp: [
    { service: "Cloud Run", role: "The course's compute. <code>gcloud run deploy</code> gave you TLS, a real certificate and autoscaling with no infrastructure written. It bills vCPU- and GiB-seconds while requests are in flight, plus a per-request fee." },
    { service: "GKE · Compute Engine · Cloud Functions", role: "The rest of the compute spectrum. Cloud Functions v2 is Cloud Run underneath." },
    { service: "Artifact Registry", role: "Your <code>gravity</code> Docker repo in the region; <code>gcloud auth configure-docker</code> lets you push." },
    { service: "Cloud Logging", role: "Collected the Scouter's logs for free. <code>jsonPayload.status&gt;=400</code> works because Capsule 01 logged JSON." },
    { service: "IAM · Org Policy · Workload Identity Federation", role: "Who can do what on which resource; company-wide rules set once and inherited; keyless auth from GitHub Actions or another cloud." },
    { service: "Cloud SQL · AlloyDB · Spanner · Firestore · Bigtable · BigQuery · Memorystore · Cloud Storage", role: "The data spectrum. Cloud SQL (Postgres) is the default; Sagas 2 and 3 build the judgement to know when to leave it." },
  ],
  takeaways: [
    "The project is the unit of billing, IAM, quota, naming and deletion. One per environment.",
    "Predefined roles on the narrowest resource; never <code>roles/editor</code>.",
    "No downloaded keys: attached service accounts, Workload Identity Federation, <code>application-default login</code>.",
    "Same region for compute and data. Egress and cross-region traffic cost money.",
    "Stateful things span at least two zones.",
    "Cloud Run by default; GKE only for a concrete need.",
    "<code>--format</code> and <code>--filter</code> work on every gcloud command.",
    "Budget alerts on every project, especially sandboxes. Tear down the same day.",
  ],
  drill: [
    { q: "Your team wants dev and prod in one project, separated by name prefixes. Argue against it.", a: [
      "IAM can't cleanly separate them: anyone with <code>run.developer</code> can deploy to both. Quotas are shared, so a runaway dev job can exhaust prod's. Billing can't be attributed without meticulous labelling. A command with the wrong prefix hits production. And deleting dev means picking resources by hand.",
      "Separate projects cost nothing extra and give you all of those boundaries.",
    ] },
    { q: "A service needs to read from Cloud Storage. Grant access without a key file.", a: [
      "Create a dedicated service account. Grant it <code>roles/storage.objectViewer</code> on that specific bucket, not project-wide. Attach it at deploy time with <code>--service-account</code>. The client library picks up credentials from the metadata server automatically (Application Default Credentials).",
      "No key exists, so none can leak, and the token is short-lived. Locally, <code>gcloud auth application-default login</code> makes the same code work with your identity.",
    ] },
    { q: "Cloud Run or GKE for a team of four shipping one web app?", a: [
      "Cloud Run, comfortably. GKE means owning cluster upgrades, node pools, network policy, ingress and an autoscaler: a platform job, and a person you don't have. Move when there's a concrete need, not because \"it'll scale better\".",
    ] },
    { q: "What are the trade-offs of <code>--min-instances=0</code>?", a: [
      "For: zero cost when idle, ideal for dev, internal tools and spiky workloads. Against: cold starts. The first request after idle waits for a container pull, process start and warm-up. That's a p99 spike on your lowest-traffic endpoints.",
      "A small Go binary starts in tens of milliseconds, a JVM or heavy Python app in seconds, which is why language choice affects your architecture options.",
    ] },
    { q: "Why does it matter that GCP VPCs are global?", a: [
      "In AWS a VPC is regional, so multi-region means several VPCs, peering or a transit gateway, and careful CIDR planning. In GCP one VPC spans all regions with regional subnets, so instances in <code>us-central1</code> and <code>europe-west1</code> share a private network without peering. Traffic between them still costs money and takes ~100 ms.",
    ] },
  ],
  connects: {
    back: "Everything before this made the deploy a single command. Capsule 01's <code>$PORT</code> and JSON logs, Capsule 02's image (built for <code>linux/amd64</code>) and Capsule 03's Terraform shape are exactly what Cloud Run needs.",
    forward: "Saga 1 starts scaling. Capsule 05 resizes one instance, Capsule 06 adds replicas and hits the <code>MemStore</code> wall, and cold starts from <code>--min-instances=0</code> come back there. <code>--allow-unauthenticated</code> is revisited in Capsules 08 and B3.",
  },
});
