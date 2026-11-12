// Saga 5 · Buu Saga — Operating it. Recaps for capsules 22–26.
// Source of truth: capsules/22-*/README.md … capsules/26-*/README.md.

GA.thread(5, [
  "Saga 4 left you with services that talk through events. Saga 5 is about running them. Capsule 22 asks where a service boundary is worth its price, and how to spot the distributed monolith that gives you every cost of distribution and none of the benefit. Capsule 23 puts a thin, client-shaped backend in front of those services. Capsule 24 makes changing them boring: deploy without releasing, then move traffic a little at a time. Capsule 25 lets you see inside the whole thing and turns \"is it healthy?\" into a number with a budget.",
  "Every lab in this saga ends with a deliberate break, and the lesson is what happens next. You kill the ranker and reads return an empty board while writes keep returning 201. You kill ranking behind the BFF and the screen renders without a rank. You ship a build that fails 30% of the time and it shows up as about 3% of traffic, and a script aborts it. You pause Postgres and follow metric, then trace, then log, to the failing span. The common thread is <b>degrade instead of failing, and decide in advance</b>. The breaker's fallback, the <code>critical</code> flag, the rollback weight and the error budget policy are all decisions made calmly, before an incident needs them.",
  "Capsule 26 adds nothing new, and that's the point. The PowerLevel.gg design is the whole course in one diagram: a container and the GCP model from Kame House; a load balancer, a gateway and measured capacity from the Saiyan Saga; one Postgres primary, <em>not</em> sharded, with partitions, replicas and read-your-writes from Namek; a sorted set, a CDN and a breaker from Frieza; Pub/Sub, idempotent consumers and an outbox from Cell; BFFs, a separate social service and canaries from this saga. The skill is not any single technique. It's estimating first, so you only use what the numbers ask for, then naming what breaks, what it costs and where the design is weakest. After that the training continues somewhere this repo can't follow: deploy your own system, set an SLO, and watch it break.",
]);

// ─────────────────────────────────────────────────────────────────────────────

GA.recap({
  id: "22",
  tagline: "Microservices buy you independent deployment, and you pay for it in network failures and operational cost. If you don't have the organisational problem they solve, start with a modular monolith and extract a service only when the evidence asks for it.",
  built: "You wrote <b>ADR 001</b> to extract ranking <em>before</em> touching code, made the module boundary real with an <b>import test</b> that fails the build, put <code>/leaderboard</code> behind a <b>strangler-fig proxy</b> with a 2 s timeout, a circuit breaker and an empty fallback, and gave the ranker its own HTTP API on :8081. Then you killed the ranker and watched reads degrade while writes kept returning 201. You also ran the availability arithmetic for sync chains and added a contract test for the leaderboard's response shape.",
  story: [
    "Microservices solve an <b>organisational</b> problem: many teams shipping without waiting on each other. They pay for it with a <b>technical</b> one: network failures, distributed transactions, more things to deploy and page for. Of all the claimed benefits, the one that really matters is <b>independent deployment</b>, and with a single team you can't collect it.",
    "The failure mode is the <b>distributed monolith</b>: services that must ship together, share tables, or call each other five deep. You get the network, the overhead, the distributed debugging <em>and</em> the coupling. It's strictly worse than the monolith you started with.",
    "The right default is a <b>modular monolith</b>: packages with real boundaries, each owning its own data, in one deployable. Extract a service only when a specific pressure justifies it: a component that needs to scale by a large factor, a team that needs its own release cadence, different availability or compliance needs, or a genuinely different runtime. Good module boundaries can be split later in weeks. Bad ones can't be split at all.",
    "The key moment in the lab is killing the ranker. Reads came back <code>200</code> with an empty board and <code>X-Degraded: true</code>, and writes were untouched. That fault isolation came from the <b>breaker and the fallback</b>, not from the split. Splitting alone would have given you a 500.",
  ],
  diagrams: [
    {
      title: "Distributed monolith vs modular monolith",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Left: three services in a sync chain all writing to shared tables, which must deploy together. Right: one deployable containing three packages, each with its own tables, boundaries enforced by a test">
  <rect class="zone" x="8" y="8" width="304" height="284" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="284" rx="12"/>
  <text class="b bad" x="160" y="30">Distributed monolith</text>
  <text class="b good" x="480" y="30">Modular monolith</text>
  <rect class="box warn" x="24" y="52" width="76" height="40" rx="8"/><text class="sm" x="62" y="72">svc A</text>
  <rect class="box warn" x="122" y="52" width="76" height="40" rx="8"/><text class="sm" x="160" y="72">svc B</text>
  <rect class="box warn" x="220" y="52" width="76" height="40" rx="8"/><text class="sm" x="258" y="72">svc C</text>
  <line class="wire" x1="101" y1="72" x2="119" y2="72"/>
  <line class="wire" x1="199" y1="72" x2="217" y2="72"/>
  <line class="wire bad" x1="62" y1="93" x2="62" y2="146"/>
  <line class="wire bad" x1="160" y1="93" x2="160" y2="146"/>
  <line class="wire bad" x1="258" y1="93" x2="258" y2="146"/>
  <rect class="box dim" x="40" y="150" width="240" height="40" rx="8"/><text class="sm" x="160" y="170">one database, shared tables</text>
  <text class="sm" x="160" y="216">change A → ship B and C too</text>
  <text class="sm" x="160" y="238">can't test one without the others</text>
  <text class="sm" x="160" y="260">network failures and the coupling</text>
  <text class="sm bad" x="160" y="282">strictly worse than one monolith</text>
  <rect class="box" x="340" y="46" width="284" height="168" rx="10"/>
  <text class="sm mute" x="482" y="62">one deployable · cmd/server</text>
  <rect class="box cool" x="348" y="76" width="84" height="36" rx="8"/><text class="xs" x="390" y="94">scouter</text>
  <rect class="box cool" x="440" y="76" width="84" height="36" rx="8"/><text class="xs" x="482" y="94">ranking</text>
  <rect class="box cool" x="532" y="76" width="84" height="36" rx="8"/><text class="xs" x="574" y="94">notification</text>
  <line class="wire soft" x1="390" y1="113" x2="390" y2="126"/>
  <line class="wire soft" x1="482" y1="113" x2="482" y2="126"/>
  <line class="wire soft" x1="574" y1="113" x2="574" y2="126"/>
  <rect class="box dim" x="348" y="130" width="84" height="28" rx="8"/><text class="xs" x="390" y="144">own tables</text>
  <rect class="box dim" x="440" y="130" width="84" height="28" rx="8"/><text class="xs" x="482" y="144">own tables</text>
  <rect class="box dim" x="532" y="130" width="84" height="28" rx="8"/><text class="xs" x="574" y="144">own tables</text>
  <text class="xs" x="482" y="180">no cross-imports: a test fails the build</text>
  <text class="xs" x="482" y="198">talk through events, not tables</text>
  <text class="sm" x="480" y="238">one deploy · real transactions</text>
  <text class="sm" x="480" y="260">extract later, on evidence</text>
  <text class="sm good" x="480" y="282">the right default</text>
</svg>`,
      caption: "Both pictures can have the same three domains. What differs is who owns the data and whether the parts can change alone. The quickest test: count how many services change per feature. If it's usually more than one, the boundaries are wrong.",
    },
    {
      title: "Availability multiplies along a sync chain",
      svg: `<svg class="dg" viewBox="0 0 640 250" role="img" aria-label="Bar chart of yearly downtime for a synchronous chain of 99.9 percent services: 1 service 526 minutes, 3 services 1575, 5 services 2623, 10 services 5232">
  <text class="b start" x="20" y="18">Downtime per year, sync chain of 99.9% services</text>
  <text class="start" x="20" y="56">1 service</text>
  <rect class="box warn" x="150" y="40" width="30" height="32" rx="8"/>
  <text class="sm start" x="190" y="56">99.900% · 526 min</text>
  <text class="start" x="20" y="106">3 services</text>
  <rect class="box warn" x="150" y="90" width="90" height="32" rx="8"/>
  <text class="sm start" x="250" y="106">99.700% · 1,575 min</text>
  <text class="start" x="20" y="156">5 services</text>
  <rect class="box warn" x="150" y="140" width="150" height="32" rx="8"/>
  <text class="sm start" x="310" y="156">99.501% · 2,623 min</text>
  <text class="start" x="20" y="206">10 services</text>
  <rect class="box warn" x="150" y="190" width="300" height="32" rx="8"/>
  <text class="sm start" x="460" y="206">99.004% · 5,232 min</text>
  <text class="sm mute start" x="20" y="240">Nobody wrote a bug. The topology did this.</text>
</svg>`,
      caption: "These are the numbers from Step 5. Each service is 99.9% on its own, but a request that needs all of them succeeds only if every one is up, so the probabilities multiply. This is the argument for async between services, and for a degraded fallback when sync can't be avoided.",
    },
    {
      title: "The strangler-fig proxy, and what the client sees",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Client calls scouter's /leaderboard, which proxies to the ranker with a timeout and breaker. Four cases: ranker healthy gives 200 with data; ranker killed gives 200 with empty list and X-Degraded; writes still 201; env var unset means the monolith serves it again">
  <rect class="box" x="10" y="40" width="90" height="40" rx="10"/><text x="55" y="60">client</text>
  <line class="wire" x1="101" y1="60" x2="196" y2="60"/><text class="sm" x="148" y="48">/leaderboard</text>
  <rect class="box hot" x="200" y="30" width="170" height="60" rx="10"/>
  <text x="285" y="48">scouter</text>
  <text class="xs" x="285" y="66">proxy + breaker</text>
  <text class="xs" x="285" y="80">2 s timeout</text>
  <line class="wire" x1="371" y1="60" x2="466" y2="60"/><text class="xs" x="418" y="48">+ X-Request-Id</text>
  <rect class="box cool" x="470" y="40" width="150" height="40" rx="10"/><text x="545" y="60">ranker :8081</text>
  <text class="sm mute start" x="20" y="110">case</text>
  <text class="sm mute start" x="320" y="110">what the client gets</text>
  <rect class="box dim" x="20" y="122" width="240" height="34" rx="8"/><text class="sm" x="140" y="139">ranker healthy</text>
  <line class="wire" x1="261" y1="139" x2="316" y2="139"/>
  <rect class="box ok" x="320" y="122" width="300" height="34" rx="8"/><text class="sm" x="470" y="139">200 · leaderboard from the ranker</text>
  <rect class="box dim" x="20" y="166" width="240" height="34" rx="8"/><text class="sm" x="140" y="183">ranker killed (Ctrl-C)</text>
  <line class="wire" x1="261" y1="183" x2="316" y2="183"/>
  <rect class="box warn" x="320" y="166" width="300" height="34" rx="8"/><text class="sm mono" x="470" y="183">200 · [] · X-Degraded: true</text>
  <rect class="box dim" x="20" y="210" width="240" height="34" rx="8"/><text class="sm" x="140" y="227">POST /readings meanwhile</text>
  <line class="wire" x1="261" y1="227" x2="316" y2="227"/>
  <rect class="box ok" x="320" y="210" width="300" height="34" rx="8"/><text class="sm" x="470" y="227">201 · writes unaffected</text>
  <rect class="box dim" x="20" y="254" width="240" height="34" rx="8"/><text class="sm" x="140" y="271">RANKING_SERVICE_URL unset</text>
  <line class="wire" x1="261" y1="271" x2="316" y2="271"/>
  <rect class="box" x="320" y="254" width="300" height="34" rx="8"/><text class="sm" x="470" y="271">served by the monolith again</text>
</svg>`,
      caption: "The proxy carries Capsule 17's lessons: a timeout, a breaker and a fallback. An empty board beats a 500. The environment variable is the strangler fig: you route traffic to the new service gradually, and you can revert with a config change instead of a rollback.",
    },
  ],
  concepts: [
    { term: "Distributed monolith", plain: "Services that have to be deployed together. Warning signs: coordinated releases, services reading each other's tables, a shared library everyone must upgrade in lockstep, one request crossing five services synchronously.", why: "It has every cost of distribution and none of the benefit. Recovery starts with untangling the data, and being willing to <b>merge services back</b>, which is a normal, healthy move." },
    { term: "A boundary worth drawing", plain: "It owns its data (no other service reads its tables, ever), changes for one reason, matches a team, has a contract you'd publish, and can fail alone.", why: "\"Owns its data\" is the rule people break first, and cross-service table access is what makes a split impossible to undo. The common bad cuts are by technical layer (api/logic/data), by entity when workflows cut across them, and too small." },
    { term: "Modular monolith, enforced", plain: "Domain packages (<code>scouter</code>, <code>ranking</code>, <code>notification</code>) in one binary, plus <code>architecture_test.go</code>, which parses imports and fails if one domain imports another.", why: "A boundary a test enforces is worth ten that a wiki describes. The test also fails if it finds no modules, because a check that passes while asserting nothing is worse than no check." },
    { term: "Sync vs async between services", plain: "Sync (REST/gRPC) when the caller needs the answer to continue. Async (events) otherwise: the only coupling is the schema, and availability stays separate.", why: "Sync availability multiplies: five 99.9% services in a chain is 99.5%, which takes you from 43 minutes of downtime a month to 3.6 hours. <b>Default to async.</b>" },
    { term: "Strangler fig", plain: "Never split in one big bang. The monolith keeps serving the route, then proxies it to the new service behind a flag, then the old route is deleted.", why: "At every step you can revert by changing an environment variable, not by rolling back a release." },
    { term: "ADR with a reversal section", plain: "A short record of context, decision, consequences (good and bad), the alternatives you rejected, and <b>how to undo it</b>. Written before the code.", why: "An ADR that names how to reverse the decision is far more useful than one that only justifies it. Here, ranking folds back by importing <code>internal/ranking</code> again, and keeping the package boundary is what keeps that possible." },
    { term: "Contract test · gRPC inside", plain: "A test in the provider's CI that asserts the shape consumers depend on (<code>fighter</code>, <code>power</code>, <code>recorded_at</code>). Internally, gRPC's generated client is a compile-time contract.", why: "Contract tests are what make independent deployment <em>safe</em> rather than just possible. The real argument for gRPC is the contract, not the speed. REST stays right for public APIs." },
  ],
  numbers: [
    { value: "99.7%", label: "Three 99.9% services in a sync chain", note: "Async services keep their own availability." },
    { value: "99.0%", label: "Ten 99.9% services in a chain", note: "5,232 minutes of downtime a year, ten times worse than one service." },
    { value: "43 min → 3.6 h", label: "Monthly downtime, 1 vs 5 sync services", note: "Purely from the topology." },
    { value: "2 s", label: "Proxy client timeout", note: "Plus a breaker and an empty fallback. Without them, splitting gives you a 500." },
  ],
  traps: [
    { myth: "\"Deploys are scary and the codebase is messy, so let's move to microservices.\"", truth: "You'll get scary distributed deploys and a messy codebase spread across repos. Modularise first: domain boundaries, enforced by tests, each module with its own tables, talking through events." },
    { myth: "Splitting a service out gives you fault isolation.", truth: "Only with timeouts, breakers and fallbacks. Without them you have <em>more</em> failure modes. In the lab, the empty board came from the fallback, not the split." },
    { myth: "Split by layer: <code>api-service</code>, <code>logic-service</code>, <code>data-service</code>.", truth: "Every feature touches all three, so nothing deploys independently. It's the most common bad boundary." },
    { myth: "Two services can share a table for now.", truth: "Then neither can change the schema and there's no owner. Data with two owners has none. Prefer one owner plus an event-built replica in the other service." },
    { myth: "The boundary test passes, so there's no coupling.", truth: "It only checks imports. Shared <em>tables</em> are invisible to it. Enforce those with separate database users and permissions." },
  ],
  gcp: [
    { service: "Cloud Run (one service each)", role: "Each microservice gets its own URL, scaling config, service account and revision history." },
    { service: "Service-to-service auth", role: "Deploy internal services with <code>--no-allow-unauthenticated</code>, grant the caller's service account <code>roles/run.invoker</code>, and attach an OIDC identity token. No shared secrets. <code>--ingress=internal</code> limits a service to your VPC." },
    { service: "Cloud SQL, one database per service", role: "The pragmatic version of \"one database per service\": one instance, a separate database (or at least schema) and a separate user per service. That's where the no-cross-service-reads rule actually holds." },
    { service: "Cloud Service Mesh · Cloud Deploy", role: "A mesh when uniform mTLS and traffic policy justify it (Capsule 08). Cloud Deploy for coordinated multi-service rollouts." },
  ],
  takeaways: [
    "Start with a modular monolith. Extract on evidence, not on principle.",
    "A service owns its data. Cross-service table access is what makes a split impossible to undo.",
    "Enforce boundaries with a test, not a convention.",
    "Prefer async between services, and do the availability arithmetic out loud.",
    "Every sync call needs a timeout, a breaker and a degraded fallback.",
    "Write the ADR before the code, including how to reverse it.",
    "Strangler fig, never big bang. Contract tests in the provider's CI.",
    "If you can't deploy a service independently, it isn't one.",
  ],
  drill: [
    { q: "A team of five with a 200k-line monolith wants to move to microservices. Advise them.", a: [
      "Ask what problem they're solving. If it's \"deploys are scary\" or \"the code is messy\", microservices make both worse. The real triggers are several teams fighting over one pipeline, one component that needs radically different scaling, or a genuine compliance or technology boundary. With five people, those usually don't apply.",
      "So: <b>modularise first</b>. Draw domain boundaries inside the monolith, enforce them with tests, give each module its own tables, communicate through events. That's most of the benefit for a fraction of the cost, and you need it before any split anyway. Then extract <em>one</em> service where there's measurable pressure, live with it for a quarter, and decide with evidence.",
    ] },
    { q: "Two services need the same data. What are your options, best to worst?", a: [
      "1) One owns it and the other asks over a sync API: simple, but adds coupling and multiplies availability. 2) One owns it and the other keeps a <b>replica built from events</b>: async, independent, eventually consistent, and usually right. 3) Reconsider the boundary: if they always need the same data, it may belong to one service. 4) A shared read-only view: a pragmatic transition state, still coupling. 5) Shared tables with both writing: never.",
      "Whichever you pick, name the owner. Data with two owners has none.",
    ] },
    { q: "How do you detect a distributed monolith?", a: [
      "Coordinated releases across services, services reading each other's tables, a shared library everyone upgrades in lockstep, tests that can't run without booting the others, one request crossing five services synchronously, every feature touching three repos.",
      "Measure it: count how many services change per feature. Recovery: find the real domain boundaries (often fewer, bigger services), break the data coupling first, replace sync chains with events, and be willing to merge services back.",
    ] },
    { q: "Why did the leaderboard stay up when you killed the ranker?", a: [
      "Because the proxy wraps the call in a 2 s timeout and a circuit breaker, and on failure returns <code>200</code> with <code>[]</code> and <code>X-Degraded: true</code>. Writes go to the monolith's own tables and never touch the ranker, so they kept returning 201.",
      "The split by itself didn't do this. Without the breaker and fallback, a dead ranker would have meant a 500 on <code>/leaderboard</code>.",
    ] },
    { q: "When should a service be merged back in?", a: [
      "When it isn't earning its keep: it's always deployed with another service, its instance count moves in lockstep with a neighbour's, one team owns both, most endpoints have exactly one caller, its outages always cause or are caused by its neighbour's, or debugging always means reading both services' logs.",
      "It's straightforward if you kept the module boundary: import the package, register the routes, delete the network hop. That's why the package boundary stays intact after extraction.",
    ] },
  ],
  connects: {
    back: "Capsule 17's timeout, breaker and fallback are what make the proxy safe. Capsule 18 had already moved ranking onto Pub/Sub, so the coupling was a schema, not a function call, which is why ranking was the obvious first extraction. Capsule 21's outbox is how you reconcile ranking data that drifts.",
    forward: "Capsule 23 puts a client-shaped façade in front of these services. Capsule 24 is how you deploy them independently and safely. The ADR's own consequence, \"cross-service debugging needs distributed tracing\", is Capsule 25. Capsule 26's design splits off a social service for the same reasons: a different scale profile and a different team.",
  },
});

// ─────────────────────────────────────────────────────────────────────────────

GA.recap({
  id: "23",
  tagline: "Once you have several services and more than one kind of client, give each client type a thin backend of its own. It fans out in parallel, shapes the response for one screen, and is owned by that client's team.",
  built: "You built <code>internal/bff</code> and <code>cmd/mobile-bff</code> on :9000. One endpoint, <code>GET /screens/fighter/{name}</code>, calls readings, ranking and social <b>in parallel</b> under a 1.5 s budget. Readings is marked <b>critical</b>; ranking and social are optional. The BFF formats numbers and downsamples history to 12 sparkline points on the server, and sends <code>Cache-Control: private</code>. You compared it with three client-side calls, killed ranking to get a degraded screen, killed readings to get a 503, and wrote up the alternatives in <code>NOTES.md</code>.",
  story: [
    "A mobile screen needs data from three services. The app can call all three itself: three round trips over a mobile network, a client that knows your whole topology, and 60-field responses when it draws four. Or one backend service can aggregate for it, and slowly become a monolith serving two masters. Or you add a <b>BFF</b>: a thin service that exists <em>for that client</em>.",
    "It wins three ways. <b>Latency</b>: one request instead of N, which at 100 ms RTT beats any backend optimisation you'll make. <b>Payload</b>: exactly what the screen renders. <b>Decoupling</b>: backends refactor freely and the BFF absorbs the change, so the client contract stays stable.",
    "Make <b>one BFF per client type</b> (web, mobile, partner), not per platform, and have <b>the frontend team own it</b>. If a backend team owns it, every screen change becomes a cross-team ticket, which is the problem the pattern exists to remove. A BFF orchestrates and transforms. It never owns domain rules or data. It sits behind the gateway, not in place of it: <code>client → gateway (auth, quotas) → BFF (shape) → services</code>.",
    "Two details make it work. Fan out <b>in parallel</b>, because a BFF calling services one after another is slower than the client doing it. And decide <b>per dependency</b> whether its failure is fatal. On localhost the timing gain was small. The ~3× in Step 4 is arithmetic with a 100 ms mobile RTT, and it comes from geography: the BFF sits next to the services, so its fan-out is cheap.",
  ],
  diagrams: [
    {
      title: "Three round trips, or one",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Left: the mobile app calls readings, ranking and social directly over the mobile network. Right: the app makes one call to a mobile BFF in the same region as the services, which fans out to all three">
  <rect class="zone" x="8" y="8" width="304" height="284" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="284" rx="12"/>
  <text class="b" x="160" y="30">Without a BFF</text>
  <text class="b" x="480" y="30">With a BFF</text>
  <rect class="box" x="24" y="130" width="70" height="40" rx="10"/><text x="59" y="150">app</text>
  <rect class="box cool" x="196" y="60" width="100" height="40" rx="8"/><text class="sm" x="246" y="80">readings</text>
  <rect class="box cool" x="196" y="130" width="100" height="40" rx="8"/><text class="sm" x="246" y="150">ranking</text>
  <rect class="box cool" x="196" y="200" width="100" height="40" rx="8"/><text class="sm" x="246" y="220">social</text>
  <line class="wire bad" x1="95" y1="144" x2="192" y2="84"/>
  <line class="wire bad" x1="95" y1="150" x2="192" y2="150"/>
  <line class="wire bad" x1="95" y1="156" x2="192" y2="216"/>
  <text class="sm" x="160" y="264">3 round trips over the mobile network</text>
  <text class="sm bad" x="160" y="284">client knows the topology</text>
  <rect class="box" x="340" y="126" width="60" height="40" rx="10"/><text x="370" y="146">app</text>
  <rect class="zone" x="430" y="48" width="196" height="196" rx="10"/>
  <text class="xs mute" x="528" y="60">same region</text>
  <line class="wire good" x1="401" y1="146" x2="436" y2="146"/>
  <rect class="box hot" x="440" y="121" width="80" height="50" rx="10"/><text class="sm" x="480" y="139">mobile</text><text class="sm" x="480" y="155">BFF</text>
  <rect class="box cool" x="554" y="72" width="66" height="36" rx="8"/><text class="xs" x="587" y="90">readings</text>
  <rect class="box cool" x="554" y="128" width="66" height="36" rx="8"/><text class="xs" x="587" y="146">ranking</text>
  <rect class="box cool" x="554" y="184" width="66" height="36" rx="8"/><text class="xs" x="587" y="202">social</text>
  <line class="wire" x1="521" y1="138" x2="550" y2="94"/>
  <line class="wire" x1="521" y1="146" x2="550" y2="146"/>
  <line class="wire" x1="521" y1="154" x2="550" y2="198"/>
  <text class="sm" x="480" y="264">1 round trip, screen-shaped JSON</text>
  <text class="sm good" x="480" y="284">fan-out is parallel and close by</text>
</svg>`,
      caption: "The red arrows each pay the mobile network's round trip. On the right, only one call crosses it. The three short calls happen inside one region, which is why Cloud Run BFFs should be deployed next to the services they call.",
    },
    {
      title: "Where the time goes: sequential client vs BFF",
      svg: `<svg class="dg" viewBox="0 0 640 240" role="img" aria-label="Timeline: client-side calls take 120, 115 and 110 milliseconds one after another, 345 total. The BFF pays one round trip split around a parallel fan-out of 20, 15 and 10 milliseconds, 122 total">
  <text class="b start" x="20" y="54">client-side</text>
  <text class="sm bad start" x="20" y="72">345 ms</text>
  <rect class="box warn" x="130" y="44" width="168" height="34" rx="8"/><text class="sm" x="214" y="61">readings · 120</text>
  <rect class="box warn" x="298" y="44" width="161" height="34" rx="8"/><text class="sm" x="378" y="61">ranking · 115</text>
  <rect class="box warn" x="459" y="44" width="154" height="34" rx="8"/><text class="sm" x="536" y="61">social · 110</text>
  <text class="b start" x="20" y="124">BFF</text>
  <text class="sm good start" x="20" y="142">122 ms</text>
  <rect class="box ok" x="130" y="112" width="70" height="34" rx="8"/><text class="sm" x="165" y="129">½ RTT</text>
  <rect class="fill-cool" x="201" y="108" width="28" height="10" rx="3"/>
  <rect class="fill-cool" x="201" y="124" width="21" height="10" rx="3"/>
  <rect class="fill-cool" x="201" y="140" width="14" height="10" rx="3"/>
  <rect class="box ok" x="231" y="112" width="70" height="34" rx="8"/><text class="sm" x="266" y="129">½ RTT</text>
  <text class="xs start" x="312" y="129">fan-out: 20 · 15 · 10 ms, in parallel</text>
  <line class="axis" x1="130" y1="176" x2="613" y2="176"/>
  <line class="axis" x1="130" y1="172" x2="130" y2="180"/><text class="xs mute" x="130" y="192">0</text>
  <line class="axis" x1="270" y1="172" x2="270" y2="180"/><text class="xs mute" x="270" y="192">100 ms</text>
  <line class="axis" x1="410" y1="172" x2="410" y2="180"/><text class="xs mute" x="410" y="192">200 ms</text>
  <line class="axis" x1="550" y1="172" x2="550" y2="180"/><text class="xs mute" x="550" y="192">300 ms</text>
  <text class="sm mute start" x="20" y="224">Step 4's arithmetic with a 100 ms RTT. On localhost the gap is small.</text>
</svg>`,
      caption: "Each client-side call costs a full RTT plus the service's work, one after another. The BFF pays one RTT, and its fan-out costs only the slowest dependency. If the BFF called the services in sequence too, you'd only have moved the chattiness one hop.",
    },
    {
      title: "Critical or optional, decided in code",
      svg: `<svg class="dg" viewBox="0 0 640 250" role="img" aria-label="Table: all up gives 200 with a full screen; ranking down gives 200 with degraded ranking; ranking and social down gives 200 with both degraded; readings down gives 503">
  <text class="b" x="215" y="20">readings</text><text class="xs accent" x="215" y="38">critical</text>
  <text class="b" x="290" y="20">ranking</text><text class="xs mute" x="290" y="38">optional</text>
  <text class="b" x="365" y="20">social</text><text class="xs mute" x="365" y="38">optional</text>
  <text class="b" x="524" y="20">response</text>
  <text class="sm start" x="20" y="81">all up</text>
  <rect class="box ok" x="183" y="64" width="64" height="34" rx="8"/><text class="sm" x="215" y="81">up</text>
  <rect class="box ok" x="258" y="64" width="64" height="34" rx="8"/><text class="sm" x="290" y="81">up</text>
  <rect class="box ok" x="333" y="64" width="64" height="34" rx="8"/><text class="sm" x="365" y="81">up</text>
  <rect class="box ok" x="414" y="64" width="220" height="34" rx="8"/><text class="sm" x="524" y="81">200 · full screen</text>
  <text class="sm start" x="20" y="129">ranking down</text>
  <rect class="box ok" x="183" y="112" width="64" height="34" rx="8"/><text class="sm" x="215" y="129">up</text>
  <rect class="box warn" x="258" y="112" width="64" height="34" rx="8"/><text class="sm" x="290" y="129">down</text>
  <rect class="box ok" x="333" y="112" width="64" height="34" rx="8"/><text class="sm" x="365" y="129">up</text>
  <rect class="box energy" x="414" y="112" width="220" height="34" rx="8"/><text class="sm" x="524" y="129">200 · degraded: ranking</text>
  <text class="sm start" x="20" y="177">ranking + social down</text>
  <rect class="box ok" x="183" y="160" width="64" height="34" rx="8"/><text class="sm" x="215" y="177">up</text>
  <rect class="box warn" x="258" y="160" width="64" height="34" rx="8"/><text class="sm" x="290" y="177">down</text>
  <rect class="box warn" x="333" y="160" width="64" height="34" rx="8"/><text class="sm" x="365" y="177">down</text>
  <rect class="box energy" x="414" y="160" width="220" height="34" rx="8"/><text class="sm" x="524" y="177">200 · degraded: ranking, social</text>
  <text class="sm start" x="20" y="225">readings down</text>
  <rect class="box warn" x="183" y="208" width="64" height="34" rx="8"/><text class="sm" x="215" y="225">down</text>
  <rect class="box ok" x="258" y="208" width="64" height="34" rx="8"/><text class="sm" x="290" y="225">up</text>
  <rect class="box ok" x="333" y="208" width="64" height="34" rx="8"/><text class="sm" x="365" y="225">up</text>
  <rect class="box warn" x="414" y="208" width="220" height="34" rx="8"/><text class="sm" x="524" y="225">503 · no screen</text>
</svg>`,
      caption: "The <code>critical</code> flag encodes a product decision: no readings means no screen, but a missing rank just hides one widget. The <code>degraded</code> list tells the client exactly what's missing, so it can hide it instead of showing a wrong value. The lab has no real social service on :8082, so when you kill ranking you'll most likely see both listed, as in the capsule's sample output.",
    },
  ],
  concepts: [
    { term: "Backend for Frontend (BFF)", plain: "A thin service that exists for one kind of client. It calls the services that client needs and returns exactly what the screen draws.", why: "It removes round trips, shrinks payloads and keeps backend refactors from breaking the app. It's almost always right once you have more than one kind of client, and often missing from design answers." },
    { term: "One per client type, owned by its team", plain: "<code>web-bff</code>, <code>mobile-bff</code>, <code>partner-api-bff</code>. Not <code>ios-bff</code> and <code>android-bff</code>, which usually render the same screens. Not one BFF for everything, which is just a gateway again.", why: "<b>Ownership is the pattern.</b> The signal for a new BFF is a genuinely different way of consuming the data, not a different platform." },
    { term: "BFF vs API gateway", plain: "The gateway covers all traffic: authn, rate limits, TLS, routing, owned by the platform team, with no business logic. A BFF covers one client: aggregation and shaping, owned by the frontend team.", why: "They coexist. Confusing them is the most common mistake, and putting shaping logic in the gateway is the usual symptom." },
    { term: "Parallel fan-out with a budget", plain: "One goroutine per dependency, a <code>WaitGroup</code>, a mutex around the shared struct, and a 1.5 s context deadline that every upstream call inherits.", why: "Sequential: 120 + 80 + 200 + 50 = 450 ms. Parallel: the slowest one, 200 ms. The budget means one slow service can't make the client wait longer than it's willing to." },
    { term: "Critical vs optional dependencies", plain: "Each dependency is marked. A critical failure fails the screen (503). An optional one is recorded in <code>degraded</code> and the screen renders anyway.", why: "Degrade rather than fail, and tell the client what's missing. Most implementations skip this part, and it's where the product decision belongs." },
    { term: "Shape for the screen", plain: "Formatting (<code>9,001</code>, <code>#3 of 2,041</code>) and downsampling (12 sparkline points, not 5,000 readings) happen in the BFF, because they're presentation.", why: "That's the payload win that justifies the hop. Domain rules do <em>not</em> belong here: if the BFF validates a business invariant, it now lives in two places." },
    { term: "GraphQL as the alternative", plain: "Clients ask for exactly the fields they want from one schema, instead of N BFFs.", why: "It costs resolvers, an N+1 problem that needs DataLoader, depth and complexity limits, per-field authorisation, and HTTP caching, since every query is a POST with a unique body. A few known clients → BFFs. Many or unknown clients → GraphQL." },
  ],
  numbers: [
    { value: "345 → 122 ms", label: "Client-side vs BFF, at 100 ms RTT", note: "Arithmetic from Step 4, not a localhost measurement. Roughly 3×." },
    { value: "450 → 200 ms", label: "Sequential vs parallel fan-out", note: "Parallel costs only the slowest dependency." },
    { value: "12, not 5,000", label: "Sparkline points sent to the phone", note: "Downsampled on the server." },
    { value: "2 → 32", label: "MaxIdleConnsPerHost", note: "Go's default of 2 runs out under a fan-out-heavy load." },
    { value: "100–250", label: "Cloud Run concurrency for a BFF", note: "It's I/O-bound, mostly waiting on other services. The opposite of a CPU-bound service." },
  ],
  traps: [
    { myth: "Web and mobile are similar enough to share one BFF.", truth: "They diverge, the shared BFF collects flags, and nobody dares change it. Duplication between BFFs is acceptable and often correct; they serve different masters." },
    { myth: "The BFF can validate this business rule, it's convenient.", truth: "Then the invariant lives in two places. A BFF orchestrates and transforms. Domain rules and data stay in the owning service." },
    { myth: "A backend team should own the BFF; they know backends.", truth: "Then every screen change is a cross-team ticket. Support the frontend team's ownership with a paved-road template, their own language, pairing and shared on-call at first." },
    { myth: "The screen response can be cached like any other.", truth: "Screens are per-user. Without <code>Cache-Control: private</code>, or with a cache key that lacks the user id, you serve one user's data to another. That's an incident, not a bug." },
    { myth: "Twelve backend calls per screen is fine, it's all server-side.", truth: "Only if they're parallel and fast. Sequential calls are 12× the latency, and waiting on 12 things samples the tail 12 times. It may also mean a boundary is wrong." },
    { myth: "Keep the BFF even though it only proxies.", truth: "A hop with no value is a hop with only cost. If it only proxies, delete it." },
  ],
  gcp: [
    { service: "Cloud Run (the BFF)", role: "Just another service. Deploy it in the <b>same region</b> as the services it calls; cross-region fan-out destroys the latency benefit. Set a high <code>--concurrency</code>." },
    { service: "Internal backends", role: "<code>--ingress=internal</code> and <code>--no-allow-unauthenticated</code> on readings, ranking and social. The BFF's service account gets <code>roles/run.invoker</code> on each and attaches an OIDC identity token (Google's <code>idtoken</code> package)." },
    { service: "Cloud Trace", role: "Shows the fan-out as parallel spans and reveals which upstream is slow (Capsule 25)." },
    { service: "Apigee / API Gateway", role: "In front of the BFF, for auth and quotas. Shaping stays in the BFF." },
  ],
  takeaways: [
    "One BFF per client type, owned by that client's team.",
    "A BFF orchestrates and transforms. It never owns domain rules or data.",
    "Always fan out in parallel, under a total budget inherited from the request.",
    "Mark each dependency critical or optional. Degrade, and tell the client what's missing.",
    "Shape for the screen, including formatting and downsampling.",
    "<code>Cache-Control: private</code> on anything per-user. Always.",
    "Propagate the correlation id on every upstream call.",
    "If the BFF only proxies, delete it.",
  ],
  drill: [
    { q: "Your BFF makes 12 backend calls per screen. Is that a problem?", a: [
      "It depends on what kind of 12. Twelve parallel, fast calls cost about as much as the slowest and save the client 11 round trips. Twelve <em>sequential</em> calls, because one's output feeds the next, are 12× the latency.",
      "Even in parallel, waiting on 12 things samples the tail 12 times (Capsule 12), and it suggests a boundary problem. Fixes: parallelise everything that isn't truly dependent, batch (one call with 10 ids), cache the stable parts, mark most calls optional, and ask whether some services should be one.",
    ] },
    { q: "Web and mobile both want a new field. Where does it go?", a: [
      "Existing data in a new shape: each BFF adds it on its own, no backend change, both teams ship today. New data the services don't have: the owning service adds it once, then each BFF exposes it. Purely presentational, like a formatted label: the BFF, every time.",
      "The anti-pattern is a <em>shared</em> BFF \"since both need it\". In three months web wants it paginated and mobile wants it truncated, and now you have flags.",
    ] },
    { q: "Why did killing readings return 503, while killing ranking returned 200?", a: [
      "Readings is marked <code>critical: true</code>: without power and history there's no screen, so the BFF returns 503 rather than a half-rendered one. Ranking is optional: its failure is appended to <code>degraded</code> and the rest of the screen still renders.",
      "That flag is a product decision written in code, which is where it belongs.",
    ] },
    { q: "Should the BFF cache?", a: [
      "Yes, carefully. Shared, non-personalised upstream responses (the leaderboard, public stats) are safe and valuable: short TTL, in Redis, shared across instances. Assembled per-user screens are possible only with the user id in the key, a short TTL and <code>Cache-Control: private</code>.",
      "Don't cache anything that must reflect the user's own action right away; read-your-writes (Capsule 13) is very visible here. The best approach is usually partial: cache the stable parts, fetch the volatile ones live, assemble each time.",
    ] },
    { q: "GraphQL instead of three BFFs: argue both sides.", a: [
      "For: one schema to maintain, clients change their queries without a backend deploy, strong typing and introspection, better with many or unknown clients. Against: the aggregation work moves into resolvers, N+1 needs DataLoader, HTTP caching is largely lost, deep queries need limits, and authorisation must be enforced per field.",
      "Decide on how many clients you have and how predictable they are. They also compose: a BFF can speak GraphQL to clients and REST to services.",
    ] },
  ],
  connects: {
    back: "Capsule 08's gateway still does auth and passes <code>X-User-Id</code>; the BFF sits behind it. Capsule 22 gave you the services to aggregate. Capsule 17's timeouts and degradation apply to every upstream call, Capsule 16 is why per-user screens are <code>private</code>, and Capsule 12's tail amplification is why fan-out width matters.",
    forward: "Capsule 24 lets each BFF and service ship on its own cadence. Capsule 25's trace shows the fan-out as parallel spans with one slow culprit. Capsule 26's design has two BFFs, because mobile needs a small sparkline payload and web needs the full history.",
  },
});

// ─────────────────────────────────────────────────────────────────────────────

GA.recap({
  id: "24",
  tagline: "Deploy and release are different events. Put new code on servers with no users on it, then move traffic a little at a time, so that rolling back means changing a weight, not rebuilding.",
  built: "You added a <code>/version</code> endpoint and SHA-tagged images (no <code>:latest</code>), ran blue and green containers behind an nginx weighted split, stepped a canary from 5% to 100% and rolled it back in about a second, built a v3 that fails 30% of <code>/leaderboard</code> calls and caught it with <code>scripts/canary-watch.sh</code>, renamed <code>power</code> to <code>power_level</code> with expand/migrate/contract and a batched backfill, and wrote sticky percentage-based feature flags with tests.",
  story: [
    "Most production incidents come from the <em>transition</em>, not from wrong code. Teams that deploy twenty times a day aren't braver. They've made deployment boring: small changes, instant rollback, and a release step separate from the deploy step.",
    "<b>Deploy</b> means the new code is running. <b>Release</b> means users are getting it. You split them with traffic splitting (infrastructure) and feature flags (application). Rolling updates replace instances a few at a time. Blue/green switches everyone at once. <b>Canary</b> sends a small share first and watches, which gives the best control over blast radius and is the default you should want.",
    "Schema is the hard part. During a rolling or canary deploy both versions run at the same time, so you can't change code and schema at the same instant. <b>Expand → migrate → contract</b> turns one dangerous change into three safe deploys, each of which works with both versions running. It exists because rolling back schema is usually impossible: you can't un-drop a column.",
    "Watch the canary against a <b>concurrent baseline</b>, with error rate as the main signal, and automate the abort, because a human watching a dashboard goes to lunch. In the lab, a build that failed 30% of requests showed up as about 3% of all traffic at a 10% canary. That's blast radius expressed as arithmetic.",
  ],
  diagrams: [
    {
      title: "Blue/green vs canary",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Left: blue/green moves 100 percent of traffic from blue v1 to green v2 in one switch. Right: canary moves v2 from 5 to 10 to 50 to 100 percent, watching at each step">
  <rect class="zone" x="8" y="8" width="304" height="284" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="284" rx="12"/>
  <text class="b" x="160" y="30">Blue/green</text>
  <text class="b" x="480" y="30">Canary (v2 share)</text>
  <rect class="box cool" x="40" y="52" width="240" height="28" rx="8"/><text class="sm" x="160" y="66">blue v1 ← 100%</text>
  <rect class="box dim" x="40" y="86" width="240" height="28" rx="8"/><text class="sm" x="160" y="100">green v2 · 0%, warm, tested</text>
  <line class="wire" x1="160" y1="120" x2="160" y2="150"/><text class="sm start" x="172" y="135">switch all</text>
  <rect class="box dim" x="40" y="156" width="240" height="28" rx="8"/><text class="sm" x="160" y="170">blue v1 · 0%</text>
  <rect class="box hot" x="40" y="190" width="240" height="28" rx="8"/><text class="sm" x="160" y="204">green v2 ← 100%</text>
  <text class="sm" x="160" y="240">rollback: switch back</text>
  <text class="sm" x="160" y="262">2× capacity during the transition</text>
  <text class="sm bad" x="160" y="284">a bad release hits everyone</text>
  <text class="sm end" x="372" y="66">5%</text>
  <rect class="box cool" x="380" y="52" width="224" height="28" rx="8"/><rect class="box hot" x="604" y="52" width="12" height="28" rx="4"/>
  <text class="sm" x="492" y="66">v1 95%</text>
  <text class="sm end" x="372" y="106">10%</text>
  <rect class="box cool" x="380" y="92" width="212" height="28" rx="8"/><rect class="box hot" x="592" y="92" width="24" height="28" rx="6"/>
  <text class="sm" x="486" y="106">v1 90%</text>
  <text class="sm end" x="372" y="146">50%</text>
  <rect class="box cool" x="380" y="132" width="118" height="28" rx="8"/><rect class="box hot" x="498" y="132" width="118" height="28" rx="8"/>
  <text class="sm" x="439" y="146">v1 50%</text><text class="sm" x="557" y="146">v2 50%</text>
  <text class="sm end" x="372" y="186">100%</text>
  <rect class="box hot" x="380" y="172" width="236" height="28" rx="8"/>
  <text class="sm" x="498" y="186">v2 100%</text>
  <text class="sm" x="480" y="240">rollback: set the weight back, ~1 s</text>
  <text class="sm" x="480" y="262">both versions serve: must be compatible</text>
  <text class="sm good" x="480" y="284">blast radius = the canary share</text>
</svg>`,
      caption: "Between canary steps you watch error rate, latency and saturation against v1. Blue/green earns its place when versions <em>can't</em> coexist. Even then the database is shared by both environments, which is why expand/contract is needed whichever strategy you pick.",
    },
    {
      title: "Blast radius as arithmetic",
      svg: `<svg class="dg" viewBox="0 0 640 230" role="img" aria-label="All traffic bar: 90 percent to healthy v1, 10 percent to canary v3. Zoomed canary: 30 percent of it fails. Result: 3 percent of all requests fail, over the 2 percent threshold, so abort">
  <text class="b start" x="20" y="22">All traffic</text>
  <rect class="box cool" x="20" y="36" width="540" height="40" rx="8"/><text x="290" y="56">90% → v1, healthy</text>
  <rect class="box hot" x="560" y="36" width="60" height="40" rx="8"/><text class="sm" x="590" y="56">10%</text>
  <line class="wire none soft" x1="560" y1="78" x2="320" y2="122" stroke-dasharray="3 4"/>
  <line class="wire none soft" x1="620" y1="78" x2="620" y2="122" stroke-dasharray="3 4"/>
  <rect class="box warn" x="320" y="124" width="90" height="40" rx="8"/><text class="sm" x="365" y="144">30% fail</text>
  <rect class="box ok" x="410" y="124" width="210" height="40" rx="8"/><text class="sm" x="515" y="144">70% fine · the v3 canary</text>
  <text class="b start" x="20" y="134">10% canary × 30% broken</text>
  <text class="b bad start" x="20" y="158">= ~3% of all requests</text>
  <text class="sm start" x="20" y="200">canary-watch.sh: 3% &gt; 2% threshold → ABORT → canary 100 0</text>
</svg>`,
      caption: "Released to everyone, this build would fail about 30% of all requests. At a 10% canary it fails about 3%: enough for the script to see over 200 samples, small enough that most users never hit it. The rollback is a weight change, so it takes about a second.",
    },
    {
      title: "Expand → migrate → contract: renaming a column",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Three phases. Expand: add nullable power_level column, old code unaffected. Migrate: code writes both and reads new with fallback, backfill in batches until no nulls remain. Contract: code uses only power_level, then drop the old column days later">
  <rect class="box energy" x="20" y="16" width="196" height="36" rx="8"/><text x="118" y="34">1 · EXPAND</text>
  <rect class="box energy" x="222" y="16" width="196" height="36" rx="8"/><text x="320" y="34">2 · MIGRATE</text>
  <rect class="box energy" x="424" y="16" width="196" height="36" rx="8"/><text x="522" y="34">3 · CONTRACT</text>
  <rect class="box" x="20" y="64" width="196" height="54" rx="8"/><text class="xs mute" x="118" y="78">schema</text><text class="xs mono" x="118" y="98">ADD COLUMN power_level</text>
  <rect class="box" x="222" y="64" width="196" height="54" rx="8"/><text class="xs mute" x="320" y="78">schema</text><text class="xs" x="320" y="98">both columns exist</text>
  <rect class="box warn" x="424" y="64" width="196" height="54" rx="8"/><text class="xs mute" x="522" y="78">schema, days later</text><text class="xs mono" x="522" y="98">DROP COLUMN power</text>
  <rect class="box cool" x="20" y="128" width="196" height="54" rx="8"/><text class="xs mute" x="118" y="142">code</text><text class="xs" x="118" y="162">v1 unchanged: power only</text>
  <rect class="box cool" x="222" y="128" width="196" height="54" rx="8"/><text class="xs mute" x="320" y="142">code v2</text><text class="xs" x="320" y="158">writes both, reads new</text><text class="xs" x="320" y="172">with fallback to old</text>
  <rect class="box cool" x="424" y="128" width="196" height="54" rx="8"/><text class="xs mute" x="522" y="142">code v3, deployed first</text><text class="xs" x="522" y="162">power_level only</text>
  <rect class="box dim" x="20" y="192" width="196" height="46" rx="8"/><text class="xs" x="118" y="215">index CONCURRENTLY</text>
  <rect class="box dim" x="222" y="192" width="196" height="46" rx="8"/><text class="xs" x="320" y="208">backfill 10k rows, sleep, repeat</text><text class="xs" x="320" y="224">until NULL count = 0</text>
  <rect class="box dim" x="424" y="192" width="196" height="46" rx="8"/><text class="xs" x="522" y="215">grep + query logs: no reads</text>
  <line class="wire" x1="20" y1="262" x2="616" y2="262"/>
  <text class="sm start" x="20" y="286">every state in between works with old and new code running at once</text>
</svg>`,
      caption: "Three deploys instead of one, and that's the correct number. Each step is safe on its own. The only irreversible step, the drop, comes last, after you've proven nothing reads the old column. A single <code>UPDATE</code> over the whole table would lock it and take the site down, which is why the backfill runs in batches with a sleep.",
    },
  ],
  concepts: [
    { term: "Deploy ≠ release", plain: "Deploy at 10am with zero user impact, release to 1% at 11am and watch. If it's bad, release back to 0% in seconds: no rebuild, no rollback pipeline, no git revert.", why: "This one separation makes everything else in the capsule possible." },
    { term: "Rolling · blue/green · canary · shadow", plain: "Rolling replaces instances a few at a time. Blue/green keeps two full environments and switches. Canary ramps a small share. Shadow sends a copy of real traffic to v2 and throws its responses away.", why: "Canary is the default. Blue/green is for versions that can't coexist or platform changes. Shadow is zero-risk only if v2 causes no side effects: no writes, emails or charges." },
    { term: "Expand → migrate → contract", plain: "Add the new thing, run code that handles both and backfill, then remove the old thing in a later deploy.", why: "Additive changes are safe. Drops, renames, type changes and adding <code>NOT NULL</code> need the full cycle. Never make a migration and a code change depend on each other." },
    { term: "Feature flags", plain: "Release flags (temporary, delete within weeks), ops flags or kill switches (permanent), experiment flags (removed when the test ends). The lab's flags hash <code>flag:subject</code>, so each user always gets the same answer.", why: "Random per-request evaluation flips users between code paths mid-session. And every flag doubles a code path: ten flags is 1,024 combinations. Give release flags an expiry." },
    { term: "Canary analysis", plain: "Compare the canary against a baseline running <em>at the same time</em>: error rate first, then p95/p99 like for like, saturation per request, and business metrics like sign-ups.", why: "Comparing to yesterday mixes the version up with time of day and traffic mix. A technically healthy release that halves conversions is still a failed release." },
    { term: "Rollback discipline", plain: "Know your rollback command before you deploy, and write it in the PR. Immutable, SHA-tagged images make it a one-word change.", why: "Roll back by default: the old version is the known-good state. Forward-fix only when rollback is impossible, and then you're in an incident, not a deploy." },
  ],
  numbers: [
    { value: "10% × 30% ≈ 3%", label: "Broken canary's share of all traffic", note: "Caught by a 2% threshold over 200 samples." },
    { value: "~1 s", label: "Rollback by weight", note: "<code>canary 100 0</code>: an nginx reload, not a pipeline." },
    { value: "3", label: "Deploys for a column rename", note: "People ship broken migrations because they wanted it to be one." },
    { value: "10,000 rows", label: "Per backfill batch, with a 0.1 s sleep", note: "So replicas keep up (Capsule 13)." },
    { value: "2¹⁰ = 1,024", label: "Code paths from ten flags", note: "You test maybe three of them." },
  ],
  traps: [
    { myth: "Express \"no traffic\" in nginx as <code>weight=0</code>.", truth: "nginx refuses to start: weights must be at least 1. Use <code>down</code> for 0%, then replace it with a real weight to start the canary." },
    { myth: "Backfill the new column with one <code>UPDATE</code>.", truth: "Over millions of rows it takes a lock, generates huge WAL and blocks everyone. Batch it, sleep between batches, watch replication lag." },
    { myth: "Tag images <code>:latest</code>.", truth: "Then a rollback means a rebuild, or fails with \"image not found\". Tag every build with the git SHA and keep the artifacts." },
    { myth: "\"The canary is only 0.1% worse, ship it.\"", truth: "Check the signal is real first (enough requests, same error type, concurrent baseline, not warm-up). If it persists, abort. Aborting costs an hour; a real regression costs an incident." },
    { myth: "Keep a release flag \"just in case\", forever.", truth: "Kill switches can be permanent, with an owner and a purpose. Release flags must die. Their untested paths rot, and someone eventually flips one." },
  ],
  gcp: [
    { service: "Cloud Run traffic splitting", role: "<code>gcloud run deploy --no-traffic --tag=v2</code> deploys a live, addressable revision with zero production traffic. <code>update-traffic --to-tags=v2=5</code> releases it. <code>--to-revisions=…=100</code> rolls back. The cleanest deploy/release split on any platform." },
    { service: "Revisions", role: "<code>gcloud run revisions list</code>: every past revision is kept and can be re-targeted instantly, with no rebuild." },
    { service: "Cloud Deploy · Cloud Build", role: "Delivery pipelines with approval gates from dev to staging to prod. Build triggers on push, with the git SHA as a substitution." },
    { service: "Cloud Monitoring alerting", role: "Watch a canary and wire the notification to a Cloud Function that calls <code>update-traffic</code>, so the abort is automatic." },
    { service: "GKE · Binary Authorization", role: "<code>maxSurge</code>/<code>maxUnavailable</code> for rolling updates, Argo Rollouts or Flagger for canary analysis. Binary Authorization allows only images your pipeline signed." },
  ],
  takeaways: [
    "Deploy and release are separate events. Build that capability before you need it.",
    "Immutable, SHA-tagged artifacts. Never deploy <code>:latest</code>.",
    "Write the rollback command in the PR description.",
    "Expand → migrate → contract for every destructive schema change. It's three deploys.",
    "Backfill in batches with a sleep, and watch replication lag.",
    "Automate the canary abort, and compare against a concurrent baseline.",
    "Give release flags an expiry date.",
    "Practise rollbacks. A rollback you've never exercised is a hypothesis.",
  ],
  drill: [
    { q: "Rename a column on a 500M-row table with zero downtime.", a: [
      "<b>Expand:</b> add the new column, nullable, no default, and any index <code>CONCURRENTLY</code>. Deploy that alone. <b>Migrate:</b> deploy code that writes both and reads <code>COALESCE(new, old)</code>, so old and new instances are both correct. <b>Backfill</b> in ~10k batches with a sleep, watching replication lag and WAL. On 500M rows that's hours to days, and nothing is blocked.",
      "<b>Verify</b> the count of NULLs is 0, then deploy code that uses only the new column. <b>Contract</b> days later: drop the old one. Three deploys, two migrations, one backfill, and every state in between is safe with both versions running.",
    ] },
    { q: "Blue/green or canary?", a: [
      "Canary by default: 5% of users see a bad release instead of 100%, you get real production signal at low risk, and aborting is cheap. It takes longer, needs per-version metrics, and both versions must be compatible.",
      "Blue/green when versions <em>cannot</em> coexist, when you need a clean environment to validate, or when the switch must be atomic. It costs 2× capacity and moves everyone at once. It doesn't remove the compatibility problem either; it moves it to the shared database, which is why expand/contract is needed regardless.",
    ] },
    { q: "Why did a 30%-broken build show up as only ~3% errors?", a: [
      "Because only 10% of traffic went to it: 10% × 30% ≈ 3% of all requests. That was over <code>canary-watch.sh</code>'s 2% threshold, so it printed ABORT and exited 1, and <code>canary 100 0</code> sent everyone back to blue in about a second.",
      "That's the whole case for canaries: the same bug at 100% would have failed almost a third of all requests.",
    ] },
    { q: "You deployed 30 minutes ago and errors are climbing. Roll back or forward-fix?", a: [
      "Roll back first, diagnose after. The old version is known-good; a forward fix is untested code written under pressure. Rollback isn't available if an irreversible migration already ran, the new version wrote data the old one can't read, or an external system already received something. Then you're in an incident.",
      "In the postmortem, ask \"why didn't the canary catch it?\" Thirty minutes of climbing errors means no canary, too short a window, or nobody watching.",
    ] },
    { q: "Why must feature flag evaluation be sticky?", a: [
      "If each request rolls the dice, a user flips between old and new code paths mid-session, and you get bug reports nobody can reproduce. The lab hashes <code>flag + \":\" + subject</code> with FNV, so the same user always gets the same answer, and a 25% rollout lands close to 25% across many users (the test accepts 22–28%).",
    ] },
  ],
  connects: {
    back: "Capsule 02's immutable images are what make rollback a one-word change. Capsule 07's load balancer weights are what a canary <em>is</em>. Capsule 22's services can now ship on their own, and Capsule 13's replication lag is what you watch during a backfill.",
    forward: "A canary is only as good as the metrics you compare, which is Capsule 25: RED per version, and an error budget policy that requires canaries once the budget drops below half. In Capsule 26's failure table, a bad deploy is \"limited to the canary %\".",
  },
});

// ─────────────────────────────────────────────────────────────────────────────

GA.recap({
  id: "25",
  tagline: "Monitoring tells you that something is wrong; observability lets you ask why. An SLO with an error budget turns \"is it healthy?\" from an opinion into a number that engineering and product agreed on in advance.",
  built: "You added a request-scoped logger that stamps every line with <code>request_id</code> and the trace id, RED metrics in Prometheus labelled with the route <b>pattern</b> (after making the per-path mistake once and watching 500+ series appear), OpenTelemetry tracing with the W3C propagator across scouter and ranker, and <code>docs/slo.md</code> with three SLOs, a budget policy and the PromQL for burn-rate alerts. You ran Prometheus and Grafana in Docker, then paused Postgres and followed metric → trace → log to the failing span.",
  story: [
    "You have a gateway, a monolith, a ranker, a BFF, a database, a cache and a message bus. When a user says \"it's slow\", you need to find <em>where</em>. The three signals do different jobs. <b>Metrics</b> say how many, how fast, how full; they're cheap, and their labels must stay few. <b>Logs</b> say exactly what happened in one case. <b>Traces</b> say where the time went across services. You use them in that order: an alert fires, you find the slow trace, you read its logs.",
    "Measure <b>RED</b> (rate, errors, duration) on every request path and <b>USE</b> (utilisation, saturation, errors) on every resource. Saturation predicts trouble, and most dashboards don't have it, so you add it deliberately. Keep labels bounded: <code>/fighters/{name}</code>, never <code>/fighters/goku</code>. Record latency as a <b>histogram</b>, because you can't average percentiles across instances, but you can sum histogram buckets.",
    "A trace is one request's journey and a span is one step in it. The whole mechanism is <b>context propagation</b>: the <code>traceparent</code> header passed from hop to hop. One service that drops it breaks the chain from there on, so the propagator is the line to get right first.",
    "An <b>SLO</b> is a target over a window, like 99.9% over 28 days. The <b>error budget</b> is what's left: 40 minutes. Budget remaining means ship freely; budget gone means reliability work only. Because it's a policy agreed before anyone is angry, it ends the recurring \"move fast vs be stable\" argument. Page on symptoms users feel, using multi-window burn rates, not on CPU.",
  ],
  diagrams: [
    {
      title: "One trace, read at a glance",
      svg: `<svg class="dg" viewBox="0 0 640 260" role="img" aria-label="Trace waterfall: gateway 240 ms contains bff 225 ms, which contains readings 40 ms, ranking 195 ms with a 190 ms database query inside, and social 20 ms, running in parallel">
  <text class="sm mono start" x="20" y="16">trace_id: abc123 · one request, one id, many services</text>
  <text class="sm start" x="20" y="52">gateway</text>
  <rect class="box dim" x="200" y="40" width="360" height="24" rx="8"/><text class="sm start" x="568" y="52">240 ms</text>
  <text class="sm start" x="34" y="84">bff</text>
  <rect class="box dim" x="210" y="72" width="338" height="24" rx="8"/><text class="sm start" x="556" y="84">225 ms</text>
  <text class="sm start" x="48" y="116">readings</text>
  <rect class="box ok" x="218" y="104" width="60" height="24" rx="8"/><text class="sm start" x="286" y="116">40 ms</text>
  <text class="sm bad start" x="48" y="148">ranking</text>
  <rect class="box warn" x="221" y="136" width="293" height="24" rx="8"/><text class="sm start" x="522" y="148">195 ms</text>
  <text class="sm bad start" x="62" y="180">db query</text>
  <rect class="box warn" x="226" y="168" width="285" height="24" rx="8"/><text class="sm start" x="519" y="180">190 ms</text>
  <text class="sm start" x="48" y="212">social</text>
  <rect class="box ok" x="218" y="200" width="30" height="24" rx="8"/><text class="sm start" x="256" y="212">20 ms</text>
  <text class="sm mute start" x="20" y="246">Ranking is slow, it's the database not the service, and the three calls ran in parallel.</text>
</svg>`,
      caption: "This is the waterfall from the capsule. Indentation is the parent/child relationship carried by <code>traceparent</code>. Without a propagator you'd get six separate fragments and no way to see that the 190 ms query is the real cause.",
    },
    {
      title: "Follow the signals in order",
      svg: `<svg class="dg" viewBox="0 0 640 230" role="img" aria-label="Metric tells you something is wrong, trace tells you where the time went, log tells you exactly what happened. Example from pausing Postgres">
  <rect class="box hot" x="20" y="30" width="180" height="76" rx="10"/>
  <text class="b" x="110" y="50">Metric</text><text class="sm" x="110" y="72">that it's wrong</text><text class="xs mute" x="110" y="92">cheap · low cardinality</text>
  <rect class="box cool" x="230" y="30" width="180" height="76" rx="10"/>
  <text class="b" x="320" y="50">Trace</text><text class="sm" x="320" y="72">where the time went</text><text class="xs mute" x="320" y="92">sampled · high cardinality</text>
  <rect class="box energy" x="440" y="30" width="180" height="76" rx="10"/>
  <text class="b" x="530" y="50">Log</text><text class="sm" x="530" y="72">exactly what happened</text><text class="xs mute" x="530" y="92">per request · unlimited</text>
  <line class="wire" x1="201" y1="68" x2="226" y2="68"/>
  <line class="wire" x1="411" y1="68" x2="436" y2="68"/>
  <text class="sm mute" x="320" y="128">docker compose pause postgres</text>
  <text class="sm" x="110" y="152">error rate spikes,</text><text class="sm" x="110" y="170">in-flight climbs</text>
  <text class="sm" x="320" y="152">store.Leaderboard span</text><text class="sm" x="320" y="170">shows the timeout</text>
  <text class="sm" x="530" y="152">search the trace id:</text><text class="sm" x="530" y="170">exact error + params</text>
  <text class="sm bad" x="320" y="212">Without the propagator: guess the service, grep logs by timestamp, hope.</text>
</svg>`,
      caption: "The log middleware writes the trace id into <code>logging.googleapis.com/trace</code>, which is what lets you jump from a span to its log lines. Step 6 has you do this drill twice, once with tracing and once without, so you feel the difference you're paying for.",
    },
    {
      title: "An error budget, and how fast you burn it",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Error budget remaining over a 28-day window. At a 1x burn the budget lasts exactly 28 days. At a 14x burn it is gone in 2 days. Policy lines at 50 percent and 25 percent">
  <text class="sm mute start" x="20" y="22">budget left</text>
  <text class="sm end" x="600" y="22">99.9% over 28 days = 40.3 min</text>
  <line class="axis" x1="80" y1="36" x2="80" y2="240"/>
  <line class="axis" x1="80" y1="240" x2="604" y2="240"/>
  <text class="xs mute end" x="72" y="40">100%</text>
  <text class="xs mute end" x="72" y="140">50%</text>
  <text class="xs mute end" x="72" y="190">25%</text>
  <text class="xs mute end" x="72" y="240">0</text>
  <line class="wire none soft dash" x1="80" y1="140" x2="600" y2="140"/>
  <line class="wire none soft dash" x1="80" y1="190" x2="600" y2="190"/>
  <text class="xs halo start" x="140" y="130">&lt; 50%: canaries required</text>
  <text class="xs halo start" x="140" y="180">&lt; 25%: feature freeze</text>
  <line class="line cool" x1="80" y1="40" x2="600" y2="240"/>
  <line class="line bad" x1="80" y1="40" x2="117" y2="240"/>
  <text class="sm start" x="300" y="108">1× burn: lasts the full 28 days</text>
  <text class="sm bad start" x="126" y="226">14× burn (page): gone in 2 days</text>
  <text class="xs mute" x="80" y="256">day 0</text>
  <text class="xs mute" x="210" y="256">7</text>
  <text class="xs mute" x="340" y="256">14</text>
  <text class="xs mute" x="470" y="256">21</text>
  <text class="xs mute" x="600" y="256">28</text>
  <text class="sm mute" x="340" y="284">days into the rolling window</text>
</svg>`,
      caption: "Burn rate is how many times faster than \"exactly on budget\" you're failing. The capsule pages on 14× over 1 h <em>and</em> 5 m, so a 30-second blip doesn't wake anyone, and raises a ticket on 3× over 6 h for the slow leak. The policy lines come from <code>docs/slo.md</code>; once it's exhausted, everything freezes until a postmortem.",
    },
  ],
  concepts: [
    { term: "Metrics, logs, traces", plain: "Metrics: how many, how fast, how full; cheap; labels must be few. Logs: what happened in this case; unlimited detail. Traces: where the time went across services; sampled.", why: "They're complementary. The workflow is alert → trace → logs for that trace id." },
    { term: "RED and USE", plain: "RED for anything request-driven: Rate, Errors, Duration. USE for any resource: Utilisation, Saturation (work waiting), Errors.", why: "Saturation predicts trouble, and most dashboards ship without it. Add queue depth, pool wait time and throttled CPU seconds on purpose." },
    { term: "Cardinality", plain: "The number of unique label combinations. Each one is a separate series that's stored, indexed and billed.", why: "Never put a user id, request id, trace id, email, full path or raw error message in a label. That detail belongs in logs and traces. This is the most common way teams spend more on monitoring than on compute." },
    { term: "Histograms, not averages", plain: "Each instance reports bucket counts. You sum the buckets across instances, then compute the percentile: <code>histogram_quantile(0.99, sum(rate(…)) by (le))</code>.", why: "Averaging ten p99s gives a number with no meaning. Sums, counts, mins and maxes merge; percentiles don't." },
    { term: "Spans and propagation", plain: "A trace is one request; spans are its steps. OpenTelemetry's propagator reads and writes the W3C <code>traceparent</code> header. The server wrapper extracts it, the client transport injects it.", why: "Miss either side on one hop and the trace stops there. Use OTel rather than a vendor SDK so you can change backends without touching instrumented code." },
    { term: "Head vs tail sampling", plain: "Head-based decides at the start (say 1%). Tail-based buffers the whole trace and decides afterwards: keep every error and slow request, plus 1% of the rest.", why: "Head-based is cheap but can miss exactly the requests you care about. Tail-based is more useful and needs more infrastructure." },
    { term: "SLI, SLO, SLA, error budget", plain: "SLI: a measurement. SLO: a target over a window. SLA: an SLO with financial penalties, always looser. Error budget: 100% − SLO.", why: "The budget converts reliability into arithmetic and a pre-agreed policy. 100% is the wrong target: pick the lowest number your users won't notice." },
  ],
  numbers: [
    { value: "2,500 vs 2.5 B", label: "Series with and without a user_id label", note: "5 methods × 10 statuses × 50 endpoints, then × 1,000,000 users." },
    { value: "40.3 min", label: "Budget at 99.9% over 28 days", note: "99%: 403 min. 99.99%: 4 min, less than one bad deploy." },
    { value: "14× · 1 h + 5 m", label: "Page threshold", note: "Budget gone in 2 days. Both windows must agree." },
    { value: "3× · 6 h", label: "Ticket threshold", note: "Catches the slow leak without paging." },
    { value: "50 GiB · 2.5 M", label: "Free per month: Cloud Logging · Cloud Trace spans", note: "The lab fits comfortably." },
  ],
  traps: [
    { myth: "Page when CPU is over 80%.", truth: "Maybe it's just efficient. Page on symptoms users feel: error rate, p99, budget burn. Every page must be actionable and urgent, or people stop reading them." },
    { myth: "Label metrics with the request path, it's more detail.", truth: "One series per fighter. You reproduced it: 500 requests made 500+ series from one endpoint. Label with the route pattern." },
    { myth: "Average the p99 across instances for the dashboard.", truth: "Nine idle instances at 10 ms and one at 5,000 ms average to 509 ms, which is nobody's p99. Merge histograms instead." },
    { myth: "\"The metrics endpoint prints nothing, so the build is broken.\"", truth: "A <code>CounterVec</code> with no observed label combinations emits nothing, not even its <code>HELP</code> line. Register handlers through the <code>route</code> helper and send a request first." },
    { myth: "Log everything at DEBUG, including health checks.", truth: "Logging is the line item that surprises people. Set the level per environment and exclude health checks: most of your volume and none of your value." },
    { myth: "Aim for 100% uptime.", truth: "It's impossible, and chasing it means never shipping. 99.99% is 4 minutes a month and usually means multi-region." },
  ],
  gcp: [
    { service: "Cloud Logging", role: "JSON on stdout is parsed automatically. Use <code>severity</code> (the lab's <code>GCPHandler</code> renames slog's <code>level</code>) and <code>logging.googleapis.com/trace</code> to link logs to traces. Log-based metrics exist, but watch their cardinality too." },
    { service: "Cloud Trace", role: "Accepts OTLP. Swap the stdout exporter for <code>texporter</code> or point OTLP at a collector. Same waterfall you built by hand." },
    { service: "Cloud Monitoring SLOs", role: "A first-class object: <code>gcloud alpha monitoring slos create … --goal=0.999 --rolling-period=28d</code> gives you burn-rate alerts and a budget graph without building them." },
    { service: "Managed Service for Prometheus", role: "GCP runs Prometheus for you and keeps PromQL." },
    { service: "Error Reporting", role: "Groups stack traces and notifies on new error types. The cheapest useful alert you can turn on." },
  ],
  takeaways: [
    "Generate a correlation id at the edge, propagate it everywhere, return it to the client.",
    "RED on every service, USE on every resource.",
    "Never put unbounded values in metric labels. Route patterns, not paths.",
    "Histograms for latency, always. Percentiles don't average.",
    "OpenTelemetry, not a vendor SDK. Get the propagator right first.",
    "Write SLOs down and agree the error budget policy in advance.",
    "Alert on symptoms with multi-window burn rates. Every page must be actionable.",
    "Instrument business metrics too. A healthy service that stopped recording readings is still broken.",
  ],
  drill: [
    { q: "Your monitoring bill is bigger than your compute bill. What happened?", a: [
      "Almost certainly <b>cardinality</b>, then <b>log volume</b>. One label with unbounded values (user id, request id, full path, raw error) on a busy metric makes millions of series. Find it with <code>topk(20, count by (__name__)({__name__=~\".+\"}))</code>.",
      "On the log side: DEBUG in production, health checks logged (often most of the lines and none of the value), full request bodies. Fix by bucketing labels, moving detail to logs and traces, sampling traces, excluding health checks, and setting retention on purpose.",
    ] },
    { q: "Why can't you average p99s across ten instances?", a: [
      "Percentiles aren't linear. Nine instances at 10 ms and one at 5,000 ms average to 509 ms, but the true combined p99 could be anywhere from 10 ms to 5,000 ms depending on where the traffic went.",
      "Use histograms: each instance reports bucket counts, the buckets are summed, and the percentile comes from the merged histogram. That's what the <code>by (le)</code> is for.",
    ] },
    { q: "Which of these should page at 3am: CPU 90%, disk 75%, error rate 0.5%, p99 4 s, one pod restarting?", a: [
      "CPU: no. Disk: a ticket; page on projected time-to-full instead. Error rate 0.5%: depends on the SLO. Against 99.9% it's a 5× burn, so page if the multi-window burn confirms it; against 99% it's within budget. p99 4 s: page if it breaches the latency SLO and is sustained. One pod restarting: no, that's self-healing; page on a crash loop.",
      "The rule: page on user-visible symptoms with an actionable response, and link every page to a runbook.",
    ] },
    { q: "Design SLOs for a checkout service.", a: [
      "Start from user journeys, not endpoints. Place order: 99.95% available, 99% under 2 s. Browse catalogue: 99.9%, degrading to a cached catalogue. <b>Correctness</b>: 99.999% of successful payments produce exactly one order, the SLI most teams never define. Freshness: 99% of orders in history within 30 s.",
      "Measure from the user's side (RUM or the load balancer, not your handler), and write the budget policy alongside, because an SLO without a policy is a number nobody acts on.",
    ] },
    { q: "A product manager wants 100% uptime. Explain error budgets.", a: [
      "100% is impossible, and chasing it means never shipping, because every change is a risk. The real question is how much unreliability users won't notice. That's usually 99.9%, or 40 minutes a month. 99.99% is 4 minutes and typically means multi-region, more on-call and slower delivery.",
      "The budget makes the trade-off shared: spend it on shipping fast; if it's left over, ship more aggressively; if it's gone, stop feature work until reliability recovers. Because it's agreed in advance, it's a rule, not an argument during an incident.",
    ] },
  ],
  connects: {
    back: "You've carried <code>X-Request-Id</code> since Capsule 08, and now every log line inherits it. Watching p99 climb under k6 is Capsule 09's latency knee, live. Saturation is Capsule 05's lesson as a metric. The freshness SLO measures the staleness Capsule 18 accepted, and Capsule 24's canary needs exactly these per-version signals.",
    forward: "Capsule 26's failure analysis is written in these terms: alert on oldest-unacked-age, page on symptoms. One of its rehearsal questions is \"It's 3am and p99 is 8 seconds: walk me through the first ten minutes.\" And its first next step is to deploy your system for real and set an SLO.",
  },
});

// ─────────────────────────────────────────────────────────────────────────────

GA.recap({
  id: "26",
  tagline: "No new material. The twenty-six things become one skill: looking at a problem and knowing which of them applies. Pin down the requirements, estimate before you draw, start simple, then break it, price it and defend it.",
  built: "There's no stack to run; the Python estimates are the lab. You designed <b>PowerLevel.gg</b> in <code>docs/design/powerlevel-gg.md</code>: requirements and non-goals, the estimate done <em>before</em> reading the worked answer, API and access patterns, an architecture where every box names the capsule that justifies it, key decisions with the alternatives you rejected, a failure table, a cost model, and what breaks at 10× and 100×. Then three timed 45-minute designs (URL shortener, rate limiter, notifications), a recorded 20-minute rehearsal, and an honest self-assessment against every capsule.",
  story: [
    "Nobody will ask you to implement a consistent hash ring. They'll ask why the checkout page is slow, and you'll need to know whether the answer is an index, a cache, a queue, or a boundary in the wrong place. That's what a system design interview tests, and what senior engineering is.",
    "The method is the same every time. <b>Requirements</b> first, functional and non-functional, and ask about <b>consistency</b> early, because it eliminates the most options. <b>Estimate</b> out loud and round aggressively. Write the <b>API, data model and access patterns</b>: access patterns decide the indexes, which decide the sharding key. Draw the <b>simplest design that could work</b>, and add a component only when you've found the bottleneck that needs it. Go <b>deep</b> on the riskiest part. Then <b>scale, fail and cost</b>.",
    "The estimate is what protects you. PowerLevel.gg sounds big: 50 million users. But it works out to about 2,900 writes/s at peak, which one Postgres primary handles, so <b>you don't shard</b>. 8,700 reads/s is a caching problem, not a database problem. Three application instances would do; you run ten for redundancy. The most common capstone failure is designing for a scale nobody asked for.",
    "Then you break it, price it and defend it. For each component, say what users see when it dies, and <b>name the risk you're accepting</b>: a CDN outage means 6.7× origin load. Price it at $2,238 a month and say what the biggest line is. In rehearsal, answer \"what's the weakest part of this design?\" Naming your own weak point is far more convincing than defending everything.",
  ],
  diagrams: [
    {
      title: "The method, in order",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Six steps with time budgets: requirements 5 min, estimate 5 min, API and data 10 min, high-level design 15 min, deep dive 15 min, scale fail and cost 10 min. Then write it up with rejected alternatives, and defend it by naming the weakest point">
  <rect class="box hot" x="20" y="30" width="186" height="64" rx="10"/>
  <text class="b" x="113" y="48">1 · Requirements</text><text class="xs mute" x="113" y="66">5 min</text><text class="xs" x="113" y="82">ask consistency early</text>
  <rect class="box hot" x="227" y="30" width="186" height="64" rx="10"/>
  <text class="b" x="320" y="48">2 · Estimate</text><text class="xs mute" x="320" y="66">5 min</text><text class="xs" x="320" y="82">QPS, storage, instances</text>
  <rect class="box hot" x="434" y="30" width="186" height="64" rx="10"/>
  <text class="b" x="527" y="48">3 · API + data</text><text class="xs mute" x="527" y="66">10 min</text><text class="xs" x="527" y="82">access patterns → indexes</text>
  <line class="wire" x1="207" y1="62" x2="223" y2="62"/>
  <line class="wire" x1="414" y1="62" x2="430" y2="62"/>
  <path class="wire" d="M527 95 L527 110 L113 110 L113 125"/>
  <rect class="box cool" x="20" y="130" width="186" height="64" rx="10"/>
  <text class="b" x="113" y="148">4 · High-level</text><text class="xs mute" x="113" y="166">15 min</text><text class="xs" x="113" y="182">simplest thing first</text>
  <rect class="box cool" x="227" y="130" width="186" height="64" rx="10"/>
  <text class="b" x="320" y="148">5 · Deep dive</text><text class="xs mute" x="320" y="166">15 min</text><text class="xs" x="320" y="182">the riskiest part, for real</text>
  <rect class="box cool" x="434" y="130" width="186" height="64" rx="10"/>
  <text class="b" x="527" y="148">6 · Scale, fail, cost</text><text class="xs mute" x="527" y="166">10 min</text><text class="xs" x="527" y="182">10×, each death, $/month</text>
  <line class="wire" x1="207" y1="162" x2="223" y2="162"/>
  <line class="wire" x1="414" y1="162" x2="430" y2="162"/>
  <path class="wire" d="M527 195 L527 210 L165 210 L165 225"/>
  <rect class="box energy" x="20" y="230" width="290" height="56" rx="10"/>
  <text class="b" x="165" y="250">Write it up</text><text class="xs" x="165" y="270">each decision + the alternative you rejected</text>
  <rect class="box ok" x="330" y="230" width="290" height="56" rx="10"/>
  <text class="b" x="475" y="250">Defend it</text><text class="xs" x="475" y="270">out loud, and name the weakest point</text>
  <line class="wire" x1="311" y1="258" x2="326" y2="258"/>
</svg>`,
      caption: "The time budgets are the capsule's, for a 60-minute interview. Notice where the drawing starts: step 4, after the numbers. Writing each decision down with the alternative you rejected is the ADR habit from Capsule 22, applied to a whole system.",
    },
    {
      title: "Estimate before you design",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Estimation chains: reads 1,736 per second average, 8,681 peak, a caching problem. Writes 579 average, 2,894 peak, one primary, no sharding. Storage 3.2 GB a day, 1.17 TB a year, fits one instance. Concurrency 231 in flight, 3 instances, run 10">
  <rect class="box" x="16" y="20" width="150" height="48" rx="8"/><text class="xs mute" x="91" y="34">reads</text><text class="sm" x="91" y="52">5M DAU × 30</text>
  <rect class="box" x="186" y="20" width="120" height="48" rx="8"/><text class="xs mute" x="246" y="34">avg</text><text class="sm" x="246" y="52">1,736 /s</text>
  <rect class="box hot" x="326" y="20" width="120" height="48" rx="8"/><text class="xs mute" x="386" y="34">× 5 peak</text><text class="sm" x="386" y="52">8,681 /s</text>
  <rect class="box ok" x="466" y="20" width="158" height="48" rx="8"/><text class="sm" x="545" y="36">a caching problem</text><text class="xs" x="545" y="54">~1,300/s past the CDN</text>
  <rect class="box" x="16" y="88" width="150" height="48" rx="8"/><text class="xs mute" x="91" y="102">writes</text><text class="sm" x="91" y="120">5M DAU × 10</text>
  <rect class="box" x="186" y="88" width="120" height="48" rx="8"/><text class="xs mute" x="246" y="102">avg</text><text class="sm" x="246" y="120">579 /s</text>
  <rect class="box hot" x="326" y="88" width="120" height="48" rx="8"/><text class="xs mute" x="386" y="102">× 5 peak</text><text class="sm" x="386" y="120">2,894 /s</text>
  <rect class="box ok" x="466" y="88" width="158" height="48" rx="8"/><text class="sm" x="545" y="104">one Postgres primary</text><text class="xs" x="545" y="122">no sharding needed</text>
  <rect class="box" x="16" y="156" width="150" height="48" rx="8"/><text class="xs mute" x="91" y="170">storage</text><text class="sm" x="91" y="188">50M rows × 64 B</text>
  <rect class="box" x="186" y="156" width="120" height="48" rx="8"/><text class="xs mute" x="246" y="170">per day</text><text class="sm" x="246" y="188">3.2 GB</text>
  <rect class="box hot" x="326" y="156" width="120" height="48" rx="8"/><text class="xs mute" x="386" y="170">per year</text><text class="sm" x="386" y="188">1.17 TB</text>
  <rect class="box ok" x="466" y="156" width="158" height="48" rx="8"/><text class="sm" x="545" y="172">fits one instance</text><text class="xs" x="545" y="190">partition for retention</text>
  <rect class="box" x="16" y="224" width="150" height="48" rx="8"/><text class="xs mute" x="91" y="238">Little's Law</text><text class="sm" x="91" y="256">peak QPS × 20 ms</text>
  <rect class="box" x="186" y="224" width="120" height="48" rx="8"/><text class="xs mute" x="246" y="238">in flight</text><text class="sm" x="246" y="256">231</text>
  <rect class="box hot" x="326" y="224" width="120" height="48" rx="8"/><text class="xs mute" x="386" y="238">÷ 80 each</text><text class="sm" x="386" y="256">3 instances</text>
  <rect class="box ok" x="466" y="224" width="158" height="48" rx="8"/><text class="sm" x="545" y="240">run 10 anyway</text><text class="xs" x="545" y="258">for redundancy, not need</text>
  <line class="wire" x1="167" y1="44" x2="182" y2="44"/><line class="wire" x1="307" y1="44" x2="322" y2="44"/><line class="wire" x1="447" y1="44" x2="462" y2="44"/>
  <line class="wire" x1="167" y1="112" x2="182" y2="112"/><line class="wire" x1="307" y1="112" x2="322" y2="112"/><line class="wire" x1="447" y1="112" x2="462" y2="112"/>
  <line class="wire" x1="167" y1="180" x2="182" y2="180"/><line class="wire" x1="307" y1="180" x2="322" y2="180"/><line class="wire" x1="447" y1="180" x2="462" y2="180"/>
  <line class="wire" x1="167" y1="248" x2="182" y2="248"/><line class="wire" x1="307" y1="248" x2="322" y2="248"/><line class="wire" x1="447" y1="248" x2="462" y2="248"/>
</svg>`,
      caption: "These are the worksheet's outputs. \"50 million users\" suggests sharding and dozens of servers; the arithmetic says one primary, a CDN and a handful of instances. Saying \"you don't need to shard\" out loud, with the number, is a strong signal. Partitioning by month is for retention and index size, not write scale.",
    },
    {
      title: "Name the risk you're accepting",
      svg: `<svg class="dg" viewBox="0 30 640 210" role="img" aria-label="Origin read load: about 1,300 per second normally, capacity sized for 2x, about 2,600, about 8,700 per second if the CDN fails, which is 6.7 times normal">
  <text class="sm start" x="20" y="61">normal day</text>
  <rect class="box ok" x="170" y="46" width="66" height="30" rx="8"/><text class="sm start" x="246" y="61">~1,300 reads/s</text>
  <text class="sm start" x="20" y="111">sized for 2×</text>
  <rect class="box cool" x="170" y="96" width="131" height="30" rx="8"/><text class="sm start" x="311" y="111">~2,600 reads/s</text>
  <text class="sm start" x="20" y="161">CDN down</text>
  <rect class="box warn" x="170" y="146" width="440" height="30" rx="8"/><text class="sm" x="390" y="161">~8,700 reads/s · 6.7×</text>
  <text class="sm start" x="20" y="208">The answer isn't \"the CDN never fails\". It's: we shed load and</text>
  <text class="sm start" x="20" y="228">serve a degraded leaderboard, and we chose to accept that.</text>
</svg>`,
      caption: "The CDN absorbs about 85% of reads, so losing it multiplies origin load by 1/0.15 ≈ 6.7×. The capsule's model answer has the origin sized for 2×. That gap is the honest risk in the failure table, and saying so beats pretending it doesn't exist.",
    },
  ],
  concepts: [
    { term: "Non-functional requirements drive the design", plain: "Users and DAU, read:write ratio, p99 target, consistency, availability, retention, traffic shape. Also write down what you're <em>not</em> building.", why: "Each one forks the design: 100:1 reads means caching and replicas; 99.9% vs 99.99% is single-region vs multi-region; a 100× spike at 8pm changes autoscaling. Consistency eliminates the most options, so ask it first." },
    { term: "Back-of-the-envelope estimation", plain: "DAU × actions ÷ 86,400 = average QPS; × 3–10 = peak; QPS × payload = bandwidth; records × size × retention = storage; QPS × latency = concurrency, then instances.", why: "Round aggressively (86,400 ≈ 100,000). You're choosing between one server and a thousand, not between 40 and 45." },
    { term: "Access patterns", plain: "After the endpoints and the schema, list how the data is actually read and written.", why: "This is the step people skip. Access patterns decide the indexes, which decide the sharding key, which decides whether the design works at all." },
    { term: "Start simple, evolve under pressure", plain: "Begin with one service and one database. Add each component because you named the bottleneck it fixes, and say why.", why: "A first diagram full of Kafka and sharded caches signals memorisation. Starting simple and evolving it signals engineering." },
    { term: "Decisions with rejected alternatives", plain: "For each key decision: why, the capsule behind it, and what you rejected. CDN in front of leaderboards. Sorted set for ranks. One primary, not sharded. Outbox, because dual-write isn't acceptable. Two BFFs. Social split by team and scale, not by layer.", why: "This is how a design becomes reviewable. It's the ADR from Capsule 22, done for every load-bearing choice." },
    { term: "Failure analysis and cost", plain: "For every component: what fails, what users see, the mitigation. Then a cost model to one significant figure, and the CFO's question: what's the biggest line?", why: "Cost is the section almost nobody does, and it's what makes a design credible to whoever approves it. Here the biggest line is CDN egress, and three of the four fixes are engineering decisions." },
    { term: "Defending it", plain: "Explain one design out loud for 20 minutes and record it. Then answer: why not Kafka? what if consistency had to be strong? halve the cost. p99 is 8 s at 3am. What's the weakest part?", why: "Watching it back shows the filler, the jumps to solutions, and the vague spots where you don't really know. Senior engineers know where the weak points are in their own systems." },
  ],
  numbers: [
    { value: "2,894 /s", label: "Peak writes", note: "Comfortably one well-tuned Postgres primary. No sharding." },
    { value: "8,681 /s", label: "Peak reads (3:1)", note: "~85% absorbed by the CDN at <code>s-maxage=10</code>." },
    { value: "1.17 TB / yr", label: "Storage", note: "5.8 TB after five years. Fits one instance for years." },
    { value: "231 → 3", label: "Concurrent requests → instances", note: "At 80 per instance. Run ten for redundancy." },
    { value: "$2,238 / mo", label: "Whole design", note: "$0.00045 per DAU per month. Biggest line: CDN egress, $640." },
    { value: "6.7×", label: "Origin load if the CDN fails", note: "~1,300 → ~8,700 reads/s. The honest risk." },
  ],
  traps: [
    { myth: "50 million users, so shard the database from day one.", truth: "The estimate says 2,900 writes/s at peak, which one primary handles. Sharding buys nothing and costs a quarter. Designing for a scale nobody asked for is the most common capstone failure." },
    { myth: "Jump straight to the boxes.", truth: "Requirements and estimate come first. Candidates who ask about consistency late end up redesigning." },
    { myth: "Lead with Kafka, sharded caches and a service mesh.", truth: "That signals memorisation. Start with one service and one database, and add each component because of a bottleneck you named." },
    { myth: "Skip the cost section, it's not engineering.", truth: "Three of the four ways to cut the biggest line (compression, smaller BFF payloads, longer TTLs) are engineering decisions. That's why cost belongs in a design review." },
    { myth: "Defend every part of the design.", truth: "Name your own weakest point. A CDN outage means 6.7× origin load against 2× sizing; saying that, and what you'd do, is more convincing than pretending it can't happen." },
  ],
  gcp: [
    { service: "Cloud CDN + Cloud Armor", role: "In front of leaderboards with <code>s-maxage=10, stale-while-revalidate=60</code>. The biggest single win, from one header (Capsules 16, 08)." },
    { service: "Global external L7 LB", role: "TLS, anycast and health checks in front of the BFFs (Capsule 07)." },
    { service: "Cloud Run", role: "Web and mobile BFFs, plus readings, ranking and social services. About ten instances on average, ~$260/month." },
    { service: "Cloud SQL", role: "HA primary plus two read replicas for readings, partitioned by month; a separate database for social. Primary failover means writes fail for ~60 s." },
    { service: "Memorystore Redis", role: "Standard tier: the sorted set for ranks and a cache. If it dies, ranks are recomputed from Postgres behind a breaker." },
    { service: "Pub/Sub · BigQuery", role: "Outbox relay to Pub/Sub, feeding the ranker and notifier with idempotent consumers. BigQuery for analytics and cold data past 90 days." },
  ],
  takeaways: [
    "Requirements first, and ask about consistency early.",
    "Estimate before you design, out loud, rounding aggressively.",
    "Access patterns decide indexes, which decide the sharding key.",
    "Start with the simplest design. Add components only for bottlenecks you've named.",
    "Write each decision with the alternative you rejected.",
    "For every component, say what users see when it dies. Name the risk you're accepting.",
    "Price it, and know your biggest line and what you'd do about it.",
    "Name your own design's weakest point before anyone else does.",
  ],
  drill: [
    { q: "Does PowerLevel.gg need a sharded database?", a: [
      "No. 5M DAU × 10 readings ÷ 86,400 ≈ 579 writes/s, × 5 for tournaments ≈ 2,900/s at peak, which is comfortably within one well-tuned Postgres primary. Storage is ~1.2 TB a year, which fits one instance for years.",
      "Partition by month for retention (drop a partition) and index size, not for write scale. Reads at ~8,700/s are a caching problem: CDN, Redis and replicas.",
    ] },
    { q: "The brief says leaderboards can be 10 s stale, but a user must always see their own reading immediately. How does the design honour both?", a: [
      "Leaderboards go through the CDN with <code>s-maxage=10</code> and are served from the Redis sorted set and read replicas, where staleness is acceptable. A user's own readings use <b>read-your-writes pinning</b> (Capsule 13), which is the one hard consistency requirement in the brief.",
    ] },
    { q: "This costs about $2,200 a month. What's the biggest line, and what would you do?", a: [
      "CDN egress, at ~$640 for ~8 TB a month. Options: better compression, smaller payloads from the BFF, longer TTLs, or an egress commitment discount.",
      "Three of those four are engineering decisions, which is the point: cost belongs in the design review, not just the finance one.",
    ] },
    { q: "What happens when the CDN goes down?", a: [
      "The CDN absorbs ~85% of reads, so origin load jumps 6.7×, from ~1,300 to ~8,700 reads/s. The design is sized for 2×, so the origin can't take it all.",
      "Say so, and say what you'd do: shed load (Capsule 17) and serve a degraded leaderboard. Naming the risk you're accepting beats pretending the CDN never fails.",
    ] },
    { q: "URL shortener: 301 or 302 redirect?", a: [
      "A 301 is cached by browsers forever, so you lose your analytics <em>and</em> the ability to change where the short link points. That trade-off is why it's a watch-for in Part B.",
      "The rest of that design hinges on the 100:1 read:write ratio (caching and CDN), treating it as a key-value problem rather than a relational one, and how keys are generated: a random hash needs collision handling.",
    ] },
  ],
  connects: {
    back: "Everything. The worked design's decision table cites Capsules 07, 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23 and 24, and the failure table adds 06. Bonus capsule B6 has the estimation numbers worth memorising. The self-assessment lists one line per capsule; anything you score under 3 gets a re-read.",
    forward: "The repo ends here; the training doesn't. Deploy <code>gravity-chamber</code> for real, set an SLO and watch it break. Write a postmortem. Go three levels deeper on one capsule. Teach one to a colleague. The Filler Arc's bonus capsules are the way past 9000.",
  },
});
