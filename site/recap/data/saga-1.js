// Saga 1 · Saiyan Saga — Scaling & the edge. Recaps for capsules 05–09.
// Source of truth: capsules/05-*/README.md … capsules/09-*/README.md.

GA.thread(1, [
  "Saga 1 starts with one box and asks how far it goes. Capsule 05 makes it bigger and finds the price: cost rises faster than vCPUs while Amdahl's law and contention make the benefit grow slower, so vertical scaling always ends. Capsule 06 goes past the ceiling with more boxes and immediately pays a different price: <b>state hiding in each replica</b>. Three Scouters gave three different answers, and every fix in Sagas 2 and 3 exists because of that.",
  "Capsules 07 and 08 build the layer in front of the replicas. The load balancer decides <em>which</em> healthy instance gets each request, and it only knows what its health checks tell it. The gateway decides whether the request should exist at all: it authenticates, rate-limits, tags and strips, and it inspects without computing. Both hold real failure modes: detection windows, draining, and edge auth that is only as strong as the network isolation behind it.",
  "Capsule 09 turns all of it into numbers: percentiles instead of averages, Little's Law, the knee in the latency curve, and an open-model load test that can actually find the cliff. The habit that runs through the saga is honest measurement. Capsule 07's algorithm comparison produced no signal, and the right conclusion was \"no evidence of a difference\". Capsule 09's knee was 26–60× larger than its run-to-run noise, which made it a finding. You leave with stateless-ready replicas behind a balancer and a gateway, a capacity ratio in RPS per vCPU, and one in-memory store that Saga 2 has to replace.",
]);

// ---------------------------------------------------------------------------
GA.recap({
  id: "05",
  tagline: "A bigger machine is the cheapest thing to try and often the right one. But its cost rises faster than its benefit, so you need to know, with numbers, how much time it buys and where the wall is.",
  built: "You added a CPU-burning <code>/train</code> endpoint (a deliberately serial SHA-256 chain), calibrated it to about 200 ms on your own machine, and ran the same load at <code>--cpus</code> 0.25, 0.5, 1, 2 and 4 to table actual speedup against linear. You caught Go reporting <code>gomaxprocs</code> equal to the host's core count inside a 1-CPU container and fixed it with <code>GOMAXPROCS=1</code> and <code>automaxprocs</code>. Then a temporary <code>/bulk</code> allocator got a 256 MB container OOM-killed: empty reply, exit 137, no shutdown logs.",
  story: [
    "When something is slow, the first instinct is a bigger box. It's often correct, and it's always the cheapest thing to try in engineering hours. Under the hood, \"vertical\" is just cgroup limits on CPU, memory, disk I/O and network, the same mechanism as Capsule 02.",
    "It ends because two curves cross. <b>Cost is superlinear</b>: past a point, large and specialised machine types charge more per vCPU. <b>Benefit is sublinear</b>: Amdahl's law caps the speedup by the serial fraction of your work (with 10% serial, infinite cores give 10×), and more threads on shared state add contention. On top of that, the biggest machine exists, one machine is one point of failure, and resizing usually needs a restart, so you can't follow a spike with it.",
    "CPU and memory fail in completely different ways. Run out of CPU quota and the kernel throttles you: you get slower but keep running. Run out of memory and the OOM killer sends SIGKILL, which can't be caught. The graceful shutdown from Capsule 01 never runs and every in-flight request dies. That asymmetry is why memory limits need more headroom than CPU limits.",
    "Don't over-learn the lesson. A primary database, a working set that must live in one place, an early product, or a workload with a large serial fraction are all good reasons to scale up. The rule is <b>scale vertically until it's uncomfortable, then horizontally</b>, and know where the knee is before you buy the bigger box.",
  ],
  diagrams: [
    {
      title: "Amdahl's law: 10% serial work caps you at 10×",
      svg: `<svg class="dg" viewBox="0 0 640 320" role="img" aria-label="Chart of speedup against core count. The linear ideal doubles with each doubling of cores; with 10 percent serial work the real curve flattens toward a ceiling of 10 times">
  <line class="axis" x1="60" y1="280" x2="610" y2="280"/>
  <line class="axis" x1="60" y1="280" x2="60" y2="24"/>
  <text class="xs mute end" x="52" y="280">0</text>
  <text class="xs mute end" x="52" y="205">5×</text>
  <text class="xs mute end" x="52" y="130">10×</text>
  <text class="xs mute end" x="52" y="55">15×</text>
  <line class="wire none soft" x1="60" y1="130" x2="610" y2="130" stroke-dasharray="4 5"/>
  <text class="xs mute end" x="608" y="118">ceiling: 1 / s = 10×</text>
  <text class="xs mute" x="80" y="298">1</text>
  <text class="xs mute" x="160" y="298">2</text>
  <text class="xs mute" x="240" y="298">4</text>
  <text class="xs mute" x="320" y="298">8</text>
  <text class="xs mute" x="400" y="298">16</text>
  <text class="xs mute" x="480" y="298">32</text>
  <text class="xs mute" x="560" y="298">64</text>
  <text class="xs mute" x="335" y="314">cores (each step doubles them)</text>
  <polyline class="line cool" points="80,265 160,250 240,220 320,160 400,40"/>
  <polyline class="line" points="80,265 160,252.7 240,233.8 320,209.4 400,184 480,162.9 560,148.5"/>
  <circle class="dot hot" cx="320" cy="209.4" r="4"/>
  <circle class="dot hot" cx="400" cy="184" r="4"/>
  <text class="sm accent start" x="420" y="200">16 cores: 6.4×</text>
  <text class="sm accent start" x="330" y="230">8 cores: 4.7×</text>
  <text class="sm start" x="410" y="44">linear ideal</text>
  <text class="sm start" x="500" y="172">s = 10%</text>
  <text class="sm bad start" x="90" y="60">8 → 16 cores: 2× the cost, 1.36× the speed</text>
</svg>`,
      caption: "Speedup = <code>1 / (s + (1−s)/N)</code>. Price per vCPU climbs on the largest machine types, while this curve flattens. Where they cross is the number for the design doc. Your <code>--cpus</code> ladder table is the measured version of this chart.",
    },
    {
      title: "CPU pressure slows you down. Memory pressure kills you.",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Two columns: going over the CPU limit leads to throttling and higher latency while the process keeps running; going over the memory limit leads to SIGKILL, lost in-flight requests and exit code 137">
  <rect class="zone" x="8" y="8" width="304" height="274" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="274" rx="12"/>
  <text class="b" x="160" y="30">Over the CPU limit</text>
  <text class="b" x="480" y="30">Over the memory limit</text>
  <rect class="box" x="24" y="50" width="272" height="34" rx="8"/><text class="sm" x="160" y="67">quota spent in each 100 ms period</text>
  <line class="wire" x1="160" y1="84" x2="160" y2="98"/>
  <rect class="box warn" x="24" y="100" width="272" height="34" rx="8"/><text class="sm" x="160" y="117">kernel throttles: process paused</text>
  <line class="wire" x1="160" y1="134" x2="160" y2="148"/>
  <rect class="box warn" x="24" y="150" width="272" height="34" rx="8"/><text class="sm" x="160" y="167">requests queue, latency climbs</text>
  <text class="b good" x="160" y="216">slower, still running</text>
  <text class="sm mute" x="160" y="240">can still shed load or scale out</text>
  <text class="xs mute" x="160" y="262">compressible</text>
  <rect class="box" x="344" y="50" width="272" height="34" rx="8"/><text class="sm" x="480" y="67">allocation crosses --memory</text>
  <line class="wire" x1="480" y1="84" x2="480" y2="98"/>
  <rect class="box hot" x="344" y="100" width="272" height="34" rx="8"/><text class="sm" x="480" y="117">OOM killer sends SIGKILL</text>
  <line class="wire" x1="480" y1="134" x2="480" y2="148"/>
  <rect class="box hot" x="344" y="150" width="272" height="34" rx="8"/><text class="sm" x="480" y="167">no shutdown hook, no draining</text>
  <text class="b bad" x="480" y="216">every in-flight request lost</text>
  <text class="sm bad" x="480" y="240">exit 137 = 128 + SIGKILL (9)</text>
  <text class="xs mute" x="480" y="262">incompressible</text>
</svg>`,
      caption: "This is what Step 5 showed: <code>curl</code> got an empty reply, <code>docker inspect</code> said <code>OOMKilled: true</code>, and the Capsule 01 shutdown logs never appeared. The CPU side is also why a 45% utilisation graph can hide throttling: look at throttled time, not the average.",
    },
    {
      title: "The GOMAXPROCS trap",
      svg: `<svg class="dg" viewBox="0 0 640 280" role="img" aria-label="Left: in a one-CPU container on a ten-core host, Go starts ten threads that all compete for one core of quota. Right: with GOMAXPROCS set to one, a single thread matches the quota">
  <rect class="zone" x="8" y="8" width="304" height="264" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="264" rx="12"/>
  <text class="b" x="160" y="30">Default (go.mod older than 1.25)</text>
  <text class="b" x="480" y="30">GOMAXPROCS=1 / automaxprocs</text>
  <text class="sm mono" x="160" y="56">num_cpu: 10  gomaxprocs: 10</text>
  <text class="sm mono" x="480" y="56">num_cpu: 10  gomaxprocs: 1</text>
  <rect class="box hot" x="31" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="57" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="83" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="109" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="135" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="161" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="187" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="213" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="239" y="76" width="20" height="24" rx="4"/>
  <rect class="box hot" x="265" y="76" width="20" height="24" rx="4"/>
  <text class="xs mute" x="160" y="114">10 OS threads</text>
  <line class="wire soft" x1="41" y1="122" x2="120" y2="164"/>
  <line class="wire soft" x1="100" y1="122" x2="140" y2="164"/>
  <line class="wire soft" x1="160" y1="122" x2="160" y2="164"/>
  <line class="wire soft" x1="220" y1="122" x2="180" y2="164"/>
  <line class="wire soft" x1="279" y1="122" x2="200" y2="164"/>
  <rect class="box warn" x="90" y="168" width="140" height="36" rx="8"/><text class="sm" x="160" y="186">1 CPU of quota</text>
  <text class="sm bad" x="160" y="226">context switching, GC assist storms</text>
  <text class="sm bad" x="160" y="248">p99 spikes, average CPU looks fine</text>
  <rect class="box ok" x="470" y="76" width="20" height="24" rx="4"/>
  <text class="xs mute" x="480" y="114">1 OS thread</text>
  <line class="wire soft" x1="480" y1="122" x2="480" y2="164"/>
  <rect class="box ok" x="410" y="168" width="140" height="36" rx="8"/><text class="sm" x="480" y="186">1 CPU of quota</text>
  <text class="sm good" x="480" y="226">threads match the cgroup limit</text>
  <text class="sm good" x="480" y="248">tail latency stops paying for it</text>
</svg>`,
      caption: "<code>runtime.NumCPU()</code> asks the OS and gets the <em>host's</em> count, not the container's limit, so both numbers stay at 10 on the left. The fix changes only <code>gomaxprocs</code>. Compare the p99 under concurrent load, not the mean. Go 1.25 made this automatic, but only for modules whose <code>go.mod</code> says <code>go 1.25</code> or later, and it never goes below 2. If the lab shows <code>gomaxprocs: 2</code>, that's the fix working; <code>GODEBUG=containermaxprocs=0</code> brings the trap back. The JVM and Node have their own versions of the same bug.",
    },
  ],
  concepts: [
    { term: "Vertical scaling", plain: "Giving one instance more CPU, memory, disk I/O or network. In a container those are cgroup limits such as <code>--cpus=2</code> and <code>--memory=512m</code>.", why: "It's the cheapest fix in engineering hours and often the right one. It just has a ceiling and a cost curve you should be able to state." },
    { term: "Amdahl's law", plain: "If a fraction <em>s</em> of the work is serial, the best speedup on <em>N</em> processors is <code>1 / (s + (1−s)/N)</code>. With 10% serial work, the limit is 10×.", why: "It caps you no matter the budget. Often the higher-leverage move is attacking the serial part: the global lock, the sequential ID generator." },
    { term: "Superlinear cost, sublinear benefit", plain: "Price per vCPU rises on the biggest machine types, while contention and Amdahl make each extra core worth less.", why: "That crossing is why vertical scaling always ends, and why \"the gain from 4→8 was 12%\" is a real capacity argument." },
    { term: "Throttling vs OOM kill", plain: "CPU is compressible: over quota, the kernel pauses you. Memory is incompressible: over the limit, the OOM killer sends SIGKILL.", why: "One degrades gradually, the other kills mid-request with no draining. Give memory more headroom than CPU." },
    { term: "The container CPU trap", plain: "Runtimes that ask \"how many CPUs?\" get the host's count. Go sets <code>GOMAXPROCS</code> to it, so a 1-CPU container on a 10-core host runs 10 threads.", why: "It causes latency spikes while CPU utilisation looks fine. Use <code>automaxprocs</code> on Go &lt; 1.25, <code>UseContainerSupport</code> on the JVM, <code>UV_THREADPOOL_SIZE</code> on Node." },
    { term: "Utilisation is not saturation", plain: "Utilisation is an average of how busy you are. Saturation is how much is waiting: throttled time, queue depth, run-queue length.", why: "Latency can double at 45% CPU. Check <code>container_cpu_cfs_throttled_seconds_total</code>, not the utilisation graph." },
  ],
  numbers: [
    { value: "10×", label: "Max speedup with 10% serial work", note: "8 cores give 4.7×, 16 give 6.4×. Infinite cores give 10, not 100." },
    { value: "137", label: "Exit code for OOMKilled", note: "128 + SIGKILL (9). Memorise it. 139 is SIGSEGV, a real crash." },
    { value: "~200 ms", label: "What to calibrate /train to", note: "Long enough to dominate HTTP overhead. ARM chips need about 5× the rounds of x86." },
    { value: "8 vCPU · 32 GiB", label: "Cloud Run per-instance limit (gen2)", note: "Compute Engine tops out around 224 vCPU / 12 TB with <code>m3-ultramem</code>." },
  ],
  traps: [
    { myth: "\"We're at 80% CPU, let's double the instance.\"", truth: "Ask first: is p99 actually suffering, is it throttling or real work, what's the growth rate, is the service stateless, and what does profiling say? One bad query or N+1 is often worth 10× for free." },
    { myth: "CPU utilisation at 45% means CPU isn't the problem.", truth: "Throttling within each 100 ms period, the GOMAXPROCS trap, or queueing near the knee all hide behind a healthy average. Look at saturation metrics." },
    { myth: "Graceful shutdown will save in-flight requests when memory runs out.", truth: "SIGKILL can't be caught. No logs, no draining, every request on the instance lost. Bound request bodies and paginate unbounded results instead." },
    { myth: "Go inside a container uses the container's CPU limit.", truth: "Before Go 1.25 it used the host's core count. Your <code>/train</code> response showed <code>gomaxprocs: 10</code> under <code>--cpus=1</code>." },
    { myth: "Trust the benchmark number from the README.", truth: "Calibrate on the machine under test. A benchmark you didn't calibrate is measuring the machine, not the change. The <code>/train</code> cap also silently falls back to the default, so check <code>duration_ms</code>." },
  ],
  gcp: [
    { service: "Cloud Run", role: "Up to 8 vCPU / 32 GiB per instance, billed per vCPU-second and GiB-second, so doubling CPU roughly doubles cost. <code>--cpu-boost</code> adds CPU only during startup. Without <code>--no-cpu-throttling</code>, CPU drops to near zero between requests and background goroutines stall." },
    { service: "Compute Engine machine families", role: "<code>e2</code> cheap and bursty, <code>n2</code>/<code>n2d</code> the balanced default, <code>c3</code>/<code>c2</code> high-clock for CPU-bound work, <code>m3</code> for huge memory." },
    { service: "Cloud SQL", role: "Where you'll scale vertically in anger. Changing the machine type restarts the instance (a brief outage, or a failover with HA), which is why database capacity planning matters more than for stateless services." },
  ],
  takeaways: [
    "Measure the knee before buying the bigger box: test 1, 2, 4, 8 vCPU and state the gain.",
    "Scale vertically until it's uncomfortable, then horizontally. Premature distribution is the more expensive mistake.",
    "Always set both requests and limits, and give memory more headroom than CPU.",
    "Know your runtime's container-awareness story.",
    "Exit code 137 means OOMKilled.",
    "Write the ceiling into the design doc: \"this buys us to ~8k RPS, then we need horizontal scaling.\"",
  ],
  drill: [
    { q: "Latency doubled. CPU utilisation reads 45%. What are you looking at?", a: [
      "Utilisation is an average and hides the interesting part. Candidates: CPU <b>throttling</b> (quota used up within each 100 ms period, so the process is stopped for part of every period), the <b>GOMAXPROCS trap</b>, not being CPU-bound at all (locks, disk I/O, a slow dependency, GC pauses), or <b>queueing</b> at the knee of the latency curve.",
      "Utilisation is not saturation. Throttled time, queue depth and run-queue length are what tell you.",
    ] },
    { q: "Your service has 10% inherently serial work. What's the maximum useful core count?", a: [
      "Speedup = 1 / (0.1 + 0.9/N). N=8 gives 4.7×, N=16 gives 6.4×, N=∞ gives 10×. Going from 8 to 16 cores costs 2× and buys 1.36×. That's where vertical scaling stops making economic sense.",
      "The better lever is usually shrinking the serial fraction itself.",
    ] },
    { q: "Why is memory pressure more dangerous than CPU pressure in a container?", a: [
      "CPU is compressible: over quota, you're throttled and keep running, so you can shed load or scale out. Memory is incompressible: over the limit, the OOM killer sends an uncatchable SIGKILL. No draining, no shutdown hooks, every in-flight request lost, exit 137.",
      "So: real headroom on memory limits, know your peak allocation profile, bound request bodies (<code>http.MaxBytesReader</code>), and paginate anything unbounded.",
    ] },
    { q: "Why does vertical scaling stay the right answer for a primary database much longer than for a web tier?", a: [
      "The web tier is stateless, so adding a replica is a config change. A primary database holds state, so \"adding one\" means sharding (Capsule 12) or a distributed SQL system like Spanner. Both are quarters of work. Doubling the instance is an afternoon and a restart.",
      "So you buy time vertically, on purpose, while you build the horizontal answer, and you start before you hit the ceiling.",
    ] },
    { q: "A colleague says \"we're at 80% CPU, let's double the instance size.\" What do you ask?", a: [
      "Is p99 actually hurting, or is 80% just efficient? Is it throttling or real work? What's the growth rate? Doubling buys one doubling, which at 20% a month is under four months. Is the service stateless, so horizontal is cheaper and safer? What does profiling say? And what does one big instance cost against two of the current one?",
    ] },
  ],
  connects: {
    back: "Capsule 02's cgroups are exactly what <code>--cpus</code> and <code>--memory</code> set. Capsule 01's graceful shutdown is what the OOM killer skips, and its <code>http.MaxBytesReader</code> is one of your defences against it.",
    forward: "Capsule 06 goes past the ceiling with more instances. <code>/train</code> comes back as the slow request in Capsule 07 and the load target in Capsule 09, which explains the knee mathematically. Capsule 12 is the sharding project a bigger database box buys you time to build.",
  },
});

// ---------------------------------------------------------------------------
GA.recap({
  id: "06",
  tagline: "More instances only work if any instance can serve any request. That property is statelessness, and the work is finding where state is actually hiding.",
  built: "You ran three Scouter replicas behind nginx with Docker Compose, wrote one reading and watched two out of three reads return 404 while <code>/leaderboard</code> returned different lengths at the same instant. You grepped your service for state (the answer was <code>MemStore</code>), put a <code>Store</code> interface at the persistence boundary so Capsule 10 can swap in Postgres, added the hostname to every log line, and killed a replica mid-traffic to watch nginx recover on its own.",
  story: [
    "Capsule 05 found the ceiling. The way past it is more instances, and that only works if <b>no request-scoped data lives in an instance's memory or disk between requests</b>. Data still exists; it lives somewhere every instance can reach. The test: can you kill any instance mid-traffic and lose nothing but the requests it was serving?",
    "State hides in six places: in-memory maps and counters, in-memory sessions, local files, in-process schedulers, local rate-limit counters, and sticky-session assumptions. Sticky sessions make in-memory state <em>look</em> fine, but new instances sit idle, losing an instance loses its users' state, and every deploy is disruptive. Only long-lived connections like WebSockets are an honest case, and even then it's debt.",
    "Capacity is roughly <b>replicas × per-instance concurrency</b>. Set concurrency too high and requests queue inside the instance, where latency climbs but the autoscaler sees plenty of headroom and adds nothing. Scale up fast and down slow: scaling up late costs an outage, scaling down late costs a few cents.",
    "Horizontal scaling also doesn't remove the bottleneck, it moves it. Ten stateless replicas still talk to one database, now through ten connection pools. And the better reason to run more than one instance isn't capacity, it's not having a single point of failure.",
  ],
  diagrams: [
    {
      title: "Three replicas, one write, two wrong answers",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="A client sends one write and several reads through nginx round robin to three replicas. Only replica 1's private MemStore holds the write, so replicas 2 and 3 return 404">
  <rect class="box" x="16" y="114" width="100" height="44" rx="10"/><text x="66" y="136">curl</text>
  <rect class="box cool" x="166" y="104" width="124" height="64" rx="10"/><text x="228" y="126">nginx</text><text class="xs" x="228" y="148">round robin</text>
  <line class="wire" x1="116" y1="136" x2="162" y2="136"/>
  <text class="xs mute" x="66" y="176">POST goku 9001</text>
  <text class="xs mute" x="66" y="192">then GET ×5</text>
  <rect class="box ok" x="380" y="20" width="244" height="60" rx="10"/>
  <text class="sm" x="502" y="40">replica 1 · MemStore: goku</text>
  <text class="sm good" x="502" y="62">GET /fighters/goku → 200</text>
  <rect class="box warn" x="380" y="106" width="244" height="60" rx="10"/>
  <text class="sm" x="502" y="126">replica 2 · MemStore: empty</text>
  <text class="sm bad" x="502" y="148">GET /fighters/goku → 404</text>
  <rect class="box warn" x="380" y="192" width="244" height="60" rx="10"/>
  <text class="sm" x="502" y="212">replica 3 · MemStore: empty</text>
  <text class="sm bad" x="502" y="234">GET /fighters/goku → 404</text>
  <line class="wire" x1="290" y1="124" x2="376" y2="52"/>
  <line class="wire" x1="290" y1="136" x2="376" y2="136"/>
  <line class="wire" x1="290" y1="148" x2="376" y2="220"/>
  <text class="xs end" x="350" y="60">POST lands here</text>
  <text class="sm mute" x="320" y="276">Same question, same instant: the answer depends on which replica you hit.</text>
</svg>`,
      caption: "Each <code>MemStore</code> is private to its process. This isn't a bug in your code; it's the defining problem of horizontal scaling. The <code>X-Upstream</code> header, and after Step 5 the <code>instance</code> log field, tell you which replica answered.",
    },
    {
      title: "Concurrency set too high hides the queue",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Left: per-instance concurrency matches what one instance can serve, so it fills its target and the autoscaler adds an instance. Right: concurrency is set very high, requests queue inside one instance, and the autoscaler sees low utilisation and adds nothing">
  <rect class="zone" x="8" y="8" width="304" height="274" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="274" rx="12"/>
  <text class="b" x="160" y="30">Target = what it can serve</text>
  <text class="b" x="480" y="30">Target = 1,000</text>
  <rect class="box hot" x="28" y="56" width="120" height="74" rx="10"/>
  <text class="sm" x="88" y="80">instance A</text><text class="xs" x="88" y="104">full: at target</text>
  <rect class="box ok" x="172" y="56" width="120" height="74" rx="10"/>
  <text class="sm" x="232" y="80">instance B</text><text class="xs" x="232" y="104">added</text>
  <line class="wire good" x1="148" y1="93" x2="168" y2="93"/>
  <text class="sm" x="160" y="168">autoscaler: 100% of target</text>
  <text class="sm good" x="160" y="192">→ scales out</text>
  <text class="xs mute" x="160" y="230">excess load waits at the balancer,</text>
  <text class="xs mute" x="160" y="248">where it is visible and can be shed</text>
  <rect class="box" x="348" y="56" width="264" height="74" rx="10"/>
  <text class="sm" x="480" y="74">one instance, all admitted</text>
  <circle class="dot good" cx="372" cy="104" r="6"/><circle class="dot good" cx="390" cy="104" r="6"/><circle class="dot good" cx="408" cy="104" r="6"/>
  <circle class="dot bad" cx="440" cy="104" r="5"/><circle class="dot bad" cx="455" cy="104" r="5"/><circle class="dot bad" cx="470" cy="104" r="5"/><circle class="dot bad" cx="485" cy="104" r="5"/><circle class="dot bad" cx="500" cy="104" r="5"/><circle class="dot bad" cx="515" cy="104" r="5"/><circle class="dot bad" cx="530" cy="104" r="5"/><circle class="dot bad" cx="545" cy="104" r="5"/><circle class="dot bad" cx="560" cy="104" r="5"/><circle class="dot bad" cx="575" cy="104" r="5"/><circle class="dot bad" cx="590" cy="104" r="5"/>
  <text class="sm" x="480" y="168">autoscaler: well under target</text>
  <text class="sm bad" x="480" y="192">→ adds nothing</text>
  <text class="xs mute" x="480" y="230">requests queue inside the process,</text>
  <text class="xs mute" x="480" y="248">invisible and unbounded; latency climbs</text>
</svg>`,
      caption: "Green dots are being served; red dots wait for CPU or a pool connection inside the instance. Cloud Run's default concurrency is 80. For CPU-bound work the capsule suggests 10–20, so the autoscaler adds instances instead of queueing inside one.",
    },
    {
      title: "Horizontal scaling moves the bottleneck",
      svg: `<svg class="dg" viewBox="0 0 640 260" role="img" aria-label="Fifty replicas each open a pool of twenty connections, asking one Postgres for a thousand connections when its default limit is one hundred">
  <rect class="box cool" x="20" y="20" width="150" height="34" rx="8"/><text class="sm" x="95" y="37">replica · pool 20</text>
  <rect class="box cool" x="20" y="64" width="150" height="34" rx="8"/><text class="sm" x="95" y="81">replica · pool 20</text>
  <rect class="box cool" x="20" y="108" width="150" height="34" rx="8"/><text class="sm" x="95" y="125">replica · pool 20</text>
  <text class="b mute" x="95" y="160">⋮</text>
  <rect class="box cool" x="20" y="176" width="150" height="34" rx="8"/><text class="sm" x="95" y="193">replica · pool 20</text>
  <text class="xs mute" x="95" y="230">× 50 replicas</text>
  <line class="wire" x1="170" y1="37" x2="406" y2="112"/>
  <line class="wire" x1="170" y1="81" x2="406" y2="120"/>
  <line class="wire" x1="170" y1="125" x2="406" y2="128"/>
  <line class="wire" x1="170" y1="193" x2="406" y2="140"/>
  <text class="sm" x="515" y="240">asked for 50 × 20 = 1,000</text>
  <rect class="box energy" x="410" y="90" width="210" height="70" rx="10"/>
  <text x="515" y="112">one Postgres</text>
  <text class="sm mono" x="515" y="138">max_connections = 100</text>
  <text class="sm bad" x="515" y="186">time spent context-switching,</text>
  <text class="sm bad" x="515" y="206">not querying</text>
</svg>`,
      caption: "Battle drill 4: scale from 5 to 50 replicas and the database falls over. Fixes, in order: cap <code>max-instances</code>, shrink the per-replica pool, put a pooler (PgBouncer, Cloud SQL Auth Proxy, AlloyDB) in front, then remove load with read replicas or a cache. Capsule 10 runs this lab.",
    },
  ],
  concepts: [
    { term: "Stateless", plain: "No request-scoped data lives in the instance's memory or disk between requests. Data lives in a database, cache or object store every instance can reach.", why: "It's what makes any instance able to serve any request. Test: can you kill any instance right now and lose only its in-flight requests?" },
    { term: "Where state hides", plain: "In-memory maps and counters, in-memory sessions, local files, in-process schedulers like <code>time.Ticker</code>, per-instance rate limiters, and sticky-session assumptions.", why: "A ticker runs N times with N replicas, and a \"100 req/s\" local limiter becomes 300 at three replicas." },
    { term: "Sticky sessions", plain: "Routing each user to the same instance every time, so in-memory state appears to work.", why: "New instances sit idle, losing one loses its users' state, deploys disrupt, load goes uneven. Justified only for long-lived connections, and still debt." },
    { term: "Replicas × concurrency", plain: "Total capacity ≈ replicas × per-instance concurrency. I/O-bound Go can take hundreds at once; CPU-bound work, about the core count.", why: "Too high and the queue hides inside the instance. Too low and you pay for idle instances. Most people know neither number." },
    { term: "Scaling signals", plain: "CPU for CPU-bound work, request concurrency for most HTTP (Cloud Run's default), queue depth for async workers, p95 latency for SLOs.", why: "CPU is useless for I/O-bound services, and latency is laggy: you scale after users hurt. Scale up fast, down slow." },
    { term: "A seam at the boundary", plain: "A <code>Store</code> interface with <code>MemStore</code> behind it, and <code>Server</code> depending on the interface. <code>var _ Store = (*MemStore)(nil)</code> proves it at compile time.", why: "It makes Capsule 10's Postgres swap a small change, not a rewrite. Define the seam when you can see the second implementation coming." },
  ],
  numbers: [
    { value: "2 of 3", label: "Reads that returned 404", note: "One write, three replicas, three private <code>MemStore</code>s." },
    { value: "50 × 20 = 1,000", label: "Connections asked of Postgres", note: "Its default <code>max_connections</code> is 100." },
    { value: "80", label: "Cloud Run default concurrency", note: "Lower it to 10–20 for CPU-bound services." },
    { value: "1,000 × 10", label: "= 10,000 DB connections", note: "Why <code>--max-instances</code> protects downstream as much as your bill." },
  ],
  traps: [
    { myth: "Sticky sessions fix in-memory state.", truth: "They hide it. Scaling doesn't rebalance, a lost instance loses its users' data, and deploys disrupt by definition. Move the state out instead." },
    { myth: "Set concurrency high so each instance does more.", truth: "Requests queue inside the instance where nobody can see or shed them, and the autoscaler sees spare capacity and adds nothing." },
    { myth: "Autoscale on CPU for everything.", truth: "An I/O-bound service is slow at 20% CPU. Use request concurrency for HTTP and queue depth for workers." },
    { myth: "More replicas means more capacity, full stop.", truth: "They all share one database, now with N connection pools. You moved the bottleneck and made it worse." },
    { myth: "A <code>time.Ticker</code> is fine for scheduled jobs.", truth: "With N replicas it runs N times concurrently. Use an external scheduler, a queue, or leader election, and make the job idempotent." },
  ],
  gcp: [
    { service: "Cloud Run", role: "<code>--concurrency</code> is per-instance concurrency (default 80). <code>--max-instances</code> is a cost ceiling and a database guard. <code>--min-instances</code> trades money for cold starts. It autoscales mainly on concurrency utilisation, then CPU." },
    { service: "GKE", role: "Same ideas, different nouns: a <code>Deployment</code> with replicas, a <code>HorizontalPodAutoscaler</code>, a <code>PodDisruptionBudget</code> so node upgrades can't take everything down, and <code>topologySpreadConstraints</code> to spread across zones." },
    { service: "Managed Instance Groups", role: "The VM version on Compute Engine, with autohealing driven by a health check." },
  ],
  takeaways: [
    "\"Can I kill any instance right now?\" should always be yes. If not, name the state and where it should live.",
    "Never let a single instance hold user-visible state.",
    "Log the instance identity on every line once N > 1.",
    "Sticky sessions are debt. Write them down as debt.",
    "Set <code>max-instances</code> deliberately. It stands between a spike and connection exhaustion.",
    "Know both numbers: replicas and per-instance concurrency.",
  ],
  drill: [
    { q: "A service works with 1 replica and breaks intermittently at 3. Where do you look first?", a: [
      "Anything in-process: an in-memory cache or session store, a local file, a ticker job now running three times, or a per-instance rate limiter so 100 req/s became 300.",
      "The smoking gun is failures that correlate with which instance served the request and vanish at one replica. With the instance ID on every log line, that's one query.",
    ] },
    { q: "Why does high per-instance concurrency hide the need to scale?", a: [
      "The autoscaler compares concurrency utilisation to your target. Set it to 1000 and each instance accepts a thousand requests its CPU and pool can't serve, so they queue internally. Latency climbs while utilisation looks well under target.",
      "You moved the queue from the balancer, where it's visible and sheddable, into your process, where it's invisible and unbounded.",
    ] },
    { q: "You scale from 5 to 50 replicas and the database falls over. What happened?", a: [
      "50 replicas × a pool of 20 = 1,000 connections against Postgres's default <code>max_connections = 100</code>. Each connection costs several MB and scheduling overhead, so the database context-switches instead of querying.",
      "Fixes in order: cap <code>max-instances</code>, shrink per-replica pools, add a connection pooler, then remove load with read replicas or caching.",
    ] },
    { q: "When is stickiness genuinely justified?", a: [
      "Long-lived stateful connections (WebSockets, SSE, gRPC streams) where the connection is the state, and some legacy apps on a short timeline. Even then, design for \"the client reconnects and resumes\", so losing an instance is a reconnect and not data loss.",
    ] },
    { q: "How do you run a scheduled job in a horizontally scaled service?", a: [
      "Not with an in-process ticker. Use an external scheduler hitting an endpoint (Cloud Scheduler → Cloud Run, or a Kubernetes <code>CronJob</code>), a queue that one worker picks from, or leader election via a distributed lock. Make the job idempotent either way: schedulers retry.",
    ] },
  ],
  connects: {
    back: "Capsule 05 found the single-box ceiling this capsule goes past. Capsule 02's small, fast-starting image is what keeps cold starts short, and Capsule 01's <code>/readyz</code> is what the balancer will use next.",
    forward: "Capsule 07 replaces the bare nginx upstream with a real load-balancing setup. Capsule 10 swaps in Postgres behind the <code>Store</code> interface and runs the connection-pool lab. Capsule 14 explains why an in-process cache brings this exact bug back, and Capsule 17 handles the N× rate limiter.",
  },
});

// ---------------------------------------------------------------------------
GA.recap({
  id: "07",
  tagline: "A load balancer does far more than pick a backend: health checking, draining, TLS, retries and traffic splitting all live there. And sometimes the honest result of a benchmark is \"no evidence of a difference\".",
  built: "You replaced nginx's config with a real upstream setup (<code>max_fails</code>, <code>keepalive</code>, guarded <code>proxy_next_upstream</code> retries) and confirmed round robin splits about 10/10/10. You mixed slow <code>/train</code> requests with fast <code>/healthz</code> ones, switched to <code>least_conn</code>, and found <b>no difference you could separate from run-to-run noise</b>. You killed a backend and counted the 502s before nginx ejected it, tightened <code>max_fails</code>, and compared <code>docker kill</code> (requests severed) with <code>docker stop -t 30</code> (all three slow requests returned 200).",
  story: [
    "The biggest distinction is what the balancer may read. <b>L4 sees IP and port and balances connections. L7 sees the HTTP request and balances requests.</b> With HTTP/2 or gRPC, one long-lived connection carries thousands of requests, so an L4 balancer pins all of them to one backend. Use L4 for raw TCP and non-HTTP protocols, and L7 for basically all HTTP.",
    "The balancer only knows what its health checks tell it. <b>Detection time ≈ interval × unhealthy threshold</b>, so 10 s × 3 means a dead backend keeps getting traffic for 30 seconds. Probe readiness, not liveness, and beware readiness that pings the database: one blip and every backend fails at once. Draining is the other half: stop new traffic, finish in-flight work, exit, forget the backend. Break any of the four and deploys produce 502s.",
    "The lab's algorithm comparison is the part to remember. Round robin is blind to request cost, so <code>least_conn</code> should help with mixed slow and fast requests. It didn't, measurably. Six slow requests on three backends split 2/2/2, round robin's best case. <code>least_conn</code> counts connections, not CPU work, and <code>keepalive</code> blurs even that. And Go preempts CPU-bound goroutines, so a backend burning a hash chain still answered <code>/healthz</code> in about 2 ms. A busy Go backend is not a blocked one.",
    "So the correct conclusion was \"no evidence of a difference\", not a squinted-at win. <b>Measure the noise before you trust the number.</b> <code>least_conn</code> earns its place with long-lived, genuinely uneven connections: WebSockets, streaming, gRPC channels, or backends that serialise work per connection.",
  ],
  diagrams: [
    {
      title: "L4 balances connections, L7 balances requests",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Left: an L4 balancer pins one HTTP/2 connection carrying many requests to backend A at 90 percent CPU while B and C are idle. Right: an L7 balancer spreads the individual requests across A, B and C">
  <rect class="zone" x="8" y="8" width="304" height="284" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="284" rx="12"/>
  <text class="b" x="160" y="30">L4 (sees IP + port)</text>
  <text class="b" x="480" y="30">L7 (sees each request)</text>
  <rect class="box" x="80" y="48" width="160" height="34" rx="8"/><text class="sm" x="160" y="65">gRPC client</text>
  <line class="wire" x1="160" y1="82" x2="160" y2="110"/>
  <text class="xs start" x="168" y="96">1 HTTP/2 connection</text>
  <rect class="box cool" x="80" y="114" width="160" height="34" rx="8"/><text class="sm" x="160" y="131">L4 balancer</text>
  <line class="wire bad" x1="140" y1="148" x2="66" y2="204"/>
  <text class="xs bad start" x="112" y="182">all requests</text>
  <rect class="box hot" x="24" y="208" width="84" height="40" rx="8"/><text class="sm" x="66" y="228">A</text>
  <rect class="box dim" x="118" y="208" width="84" height="40" rx="8"/><text class="sm" x="160" y="228">B</text>
  <rect class="box dim" x="212" y="208" width="84" height="40" rx="8"/><text class="sm" x="254" y="228">C</text>
  <text class="xs bad" x="66" y="266">90% CPU</text>
  <text class="xs mute" x="160" y="266">idle</text>
  <text class="xs mute" x="254" y="266">idle</text>
  <rect class="box" x="400" y="48" width="160" height="34" rx="8"/><text class="sm" x="480" y="65">gRPC client</text>
  <line class="wire" x1="480" y1="82" x2="480" y2="110"/>
  <text class="xs start" x="488" y="96">1 HTTP/2 connection</text>
  <rect class="box cool" x="400" y="114" width="160" height="34" rx="8"/><text class="sm" x="480" y="131">L7 balancer</text>
  <line class="wire good" x1="450" y1="148" x2="390" y2="204"/>
  <line class="wire good" x1="480" y1="148" x2="480" y2="204"/>
  <line class="wire good" x1="510" y1="148" x2="570" y2="204"/>
  <rect class="box ok" x="344" y="208" width="84" height="40" rx="8"/><text class="sm" x="386" y="228">A</text>
  <rect class="box ok" x="438" y="208" width="84" height="40" rx="8"/><text class="sm" x="480" y="228">B</text>
  <rect class="box ok" x="532" y="208" width="84" height="40" rx="8"/><text class="sm" x="574" y="228">C</text>
  <text class="xs mute" x="480" y="266">requests spread per stream</text>
</svg>`,
      caption: "The classic gRPC-behind-an-L4 imbalance. Fixes: an L7 balancer that understands HTTP/2 streams, client-side load balancing, or <code>MAX_CONNECTION_AGE</code> on the server so clients reconnect and redistribute.",
    },
    {
      title: "Detection time is interval × threshold",
      svg: `<svg class="dg" viewBox="0 0 640 250" role="img" aria-label="Timeline from 0 to 40 seconds: the backend dies just after a passing probe at 0, probes at 10, 20 and 30 seconds fail, and it is ejected at 30 seconds, so users are routed to a dead backend for about 30 seconds">
  <line class="axis" x1="40" y1="150" x2="620" y2="150"/>
  <text class="xs mute" x="60" y="172">0 s</text>
  <text class="xs mute" x="200" y="172">10 s</text>
  <text class="xs mute" x="340" y="172">20 s</text>
  <text class="xs mute" x="480" y="172">30 s</text>
  <text class="xs mute" x="620" y="172">40 s</text>
  <rect class="box warn" x="74" y="92" width="406" height="36" rx="8"/>
  <text class="sm" x="277" y="110">users still routed to a dead backend</text>
  <line class="wire none bad" x1="74" y1="60" x2="74" y2="150"/>
  <text class="sm bad start" x="80" y="56">backend dies</text>
  <circle class="dot good" cx="60" cy="150" r="6"/>
  <circle class="dot bad" cx="200" cy="150" r="6"/>
  <circle class="dot bad" cx="340" cy="150" r="6"/>
  <circle class="dot bad" cx="480" cy="150" r="6"/>
  <text class="xs" x="200" y="190">fail 1</text>
  <text class="xs" x="340" y="190">fail 2</text>
  <text class="sm bad" x="480" y="190">fail 3 → ejected</text>
  <text class="xs good" x="60" y="190">probe ok</text>
  <text class="sm" x="330" y="228">interval 10 s × unhealthy threshold 3 ≈ 30 s of errors</text>
</svg>`,
      caption: "That's your real recovery floor, and most people never do the multiplication. The lab's nginx has no active checks at all: with <code>max_fails=2</code> it learns only by failing two real user requests. Tightening to <code>max_fails=1</code> means fewer errors but a single slow response can eject a healthy backend. That trade-off never goes away.",
    },
    {
      title: "The result that didn't come: round robin vs least_conn",
      svg: `<svg class="dg" viewBox="0 0 640 250" role="img" aria-label="Bar chart of measured maximum latency. With 6 slow requests: round robin 85.6 milliseconds, least_conn 88.5. With 4 slow requests: round robin 60.0, least_conn 122.2. Rerunning the same setup changed numbers by more than these gaps">
  <text class="b start" x="20" y="22">6 slow requests (2 / 2 / 2 across backends)</text>
  <text class="sm end" x="140" y="49">round-robin</text>
  <rect class="fill-cool" x="150" y="38" width="274" height="22" rx="4"/>
  <text class="sm start" x="432" y="49">85.6 ms</text>
  <text class="sm end" x="140" y="77">least_conn</text>
  <rect class="fill-hot" x="150" y="66" width="283" height="22" rx="4"/>
  <text class="sm start" x="441" y="77">88.5 ms</text>
  <text class="b start" x="20" y="118">4 slow requests (uneven)</text>
  <text class="sm end" x="140" y="145">round-robin</text>
  <rect class="fill-cool" x="150" y="134" width="192" height="22" rx="4"/>
  <text class="sm start" x="350" y="145">60.0 ms</text>
  <text class="sm end" x="140" y="173">least_conn</text>
  <rect class="fill-hot" x="150" y="162" width="391" height="22" rx="4"/>
  <text class="sm start" x="549" y="173">122.2 ms</text>
  <line class="axis" x1="150" y1="34" x2="150" y2="92"/>
  <line class="axis" x1="150" y1="130" x2="150" y2="188"/>
  <text class="sm bad" x="320" y="214">Rerunning an identical setup moved the numbers more than these gaps.</text>
  <text class="sm mute" x="320" y="236">The noise floor is larger than the effect: no evidence of a difference.</text>
</svg>`,
      caption: "The capsule's measured maxima, 3 backends at <code>cpus: 0.5</code> with 30M-round chains. <code>least_conn</code> did <em>not</em> win, and in one setup it looked worse, which is just as much noise. The lesson is the reasoning: an even split is round robin's best case, <code>least_conn</code> counts connections rather than work, and Go keeps answering fast requests while busy.",
    },
    {
      title: "Draining: four steps, in order",
      svg: `<svg class="dg" viewBox="0 0 640 230" role="img" aria-label="Four steps of graceful removal: readiness fails and the balancer stops new traffic, the app finishes in-flight requests, the app exits on SIGTERM, the balancer forgets the backend. Below, docker kill severs requests while docker stop drains them">
  <rect class="box cool" x="10" y="14" width="140" height="70" rx="10"/>
  <text class="sm b" x="80" y="34">1 · LB stops</text><text class="xs" x="80" y="54">readiness fails,</text><text class="xs" x="80" y="70">no new requests</text>
  <rect class="box" x="170" y="14" width="140" height="70" rx="10"/>
  <text class="sm b" x="240" y="34">2 · finish</text><text class="xs" x="240" y="54">Server.Shutdown</text><text class="xs" x="240" y="70">drains in-flight</text>
  <rect class="box" x="330" y="14" width="140" height="70" rx="10"/>
  <text class="sm b" x="400" y="34">3 · exit</text><text class="xs" x="400" y="54">exec-form ENTRYPOINT</text><text class="xs" x="400" y="70">so SIGTERM arrives</text>
  <rect class="box cool" x="490" y="14" width="140" height="70" rx="10"/>
  <text class="sm b" x="560" y="34">4 · LB forgets</text><text class="xs" x="560" y="54">backend removed</text><text class="xs" x="560" y="70">from the pool</text>
  <line class="wire" x1="150" y1="49" x2="166" y2="49"/>
  <line class="wire" x1="310" y1="49" x2="326" y2="49"/>
  <line class="wire" x1="470" y1="49" x2="486" y2="49"/>
  <text class="sm mute" x="320" y="108">Break any one of the four and deploys produce 502s.</text>
  <rect class="box warn" x="10" y="130" width="300" height="76" rx="10"/>
  <text class="sm mono" x="160" y="152">docker kill (SIGKILL)</text>
  <text class="sm bad" x="160" y="176">every in-flight request severed</text>
  <text class="xs mute" x="160" y="194">like --force, OOM kill, preemption</text>
  <rect class="box ok" x="330" y="130" width="300" height="76" rx="10"/>
  <text class="sm mono" x="480" y="152">docker stop -t 30 (SIGTERM)</text>
  <text class="sm good" x="480" y="176">all three /train calls return 200</text>
  <text class="xs mute" x="480" y="194">Capsule 01's shutdown drained them</text>
</svg>`,
      caption: "In the lab, nginx can't poll readiness (active checks are an nginx Plus feature), so the 2-second <code>DRAIN_DELAY</code> covers the gap: the instance keeps serving while already reporting not-ready. GCLB, Envoy and Kubernetes poll readiness actively, which is why readiness exists as its own concept.",
    },
  ],
  concepts: [
    { term: "L4 vs L7", plain: "L4 sees IP and port and routes whole TCP connections. L7 sees the HTTP request and routes each one, so it can route by path, retry, terminate TLS and split traffic.", why: "With HTTP/2 or gRPC, an L4 balancer pins thousands of requests to one backend. Use L7 for basically all HTTP." },
    { term: "Balancing algorithms", plain: "Round robin (the default, for uniform requests), least connections, least request, random two-choices (what most meshes use), consistent hashing (cache locality, affinity), weighted (canaries).", why: "Round robin is blind to request cost. Whether a smarter one helps depends on your workload, and you have to measure it above the noise." },
    { term: "Health checks", plain: "Interval, timeout (shorter than the interval) and thresholds. Detection time ≈ interval × unhealthy threshold.", why: "Aggressive detection ejects healthy backends during noise; conservative detection sends users to dead ones. Point the LB at <code>/readyz</code>." },
    { term: "Correlated readiness failure", plain: "If readiness pings the database and the database blips, every backend fails at once and the LB has zero healthy targets.", why: "Some LBs then fail open, some fail closed with 503s. Know which yours does, and have readiness reflect this instance's own ability to serve." },
    { term: "Connection draining", plain: "On removal, stop sending new requests, let in-flight ones finish within a drain timeout, then close what's left.", why: "It's what makes a deploy invisible. Fail readiness first and make the drain delay at least one health-check interval." },
    { term: "Noise floor", plain: "The run-to-run variance of a measurement. An effect smaller than it is not a finding.", why: "Step 3 got no signal and concluded \"no evidence of a difference\" instead of squinting. That instinct is worth more than any algorithm." },
  ],
  numbers: [
    { value: "10 s × 3 = 30 s", label: "Dead backend still taking traffic", note: "Interval × unhealthy threshold is your recovery floor." },
    { value: "85.6 vs 88.5 ms", label: "Round robin vs least_conn, 6 slow", note: "60.0 vs 122.2 ms with 4 slow. Reruns varied more than the gaps." },
    { value: "~2 ms", label: "/healthz from a busy Go backend", note: "The scheduler preempts the hash chain, so busy doesn't mean blocked." },
    { value: "~$18 / mo", label: "Global external ALB, idle", note: "Just to exist, before traffic. Don't create one for practice." },
  ],
  traps: [
    { myth: "<code>least_conn</code> will obviously beat round robin with mixed requests.", truth: "In this lab it didn't, measurably. An even split is round robin's best case, <code>least_conn</code> balances connections not work, and Go preempts CPU-bound work. Reach for it with long-lived, uneven connections." },
    { myth: "A busy backend is a blocked backend.", truth: "That intuition comes from thread-per-request servers with fixed pools. A Go backend mid-hash-chain still answered <code>/healthz</code> in about 2 ms." },
    { myth: "An L4 balancer is fine in front of gRPC.", truth: "It routes connections, and one HTTP/2 connection carries every request. You get one hot backend and the rest idle." },
    { myth: "Readiness should check the database.", truth: "Then a 20-second database blip leaves zero healthy backends. If it's a liveness check, the orchestrator restarts everything into a recovering database." },
    { myth: "Let the LB retry anything that fails.", truth: "Only idempotent requests, only connection-level failures, never 4xx, and with a retry budget. Blind retries pile load on survivors at the worst moment." },
  ],
  gcp: [
    { service: "Global external Application Load Balancer", role: "L7, anycast: one IP announced from every Google edge. Users reach the nearest edge, TLS terminates near them, and traffic crosses Google's backbone. Concept only: about $18/month to exist." },
    { service: "GCLB anatomy", role: "Forwarding rule → target HTTPS proxy (TLS) → URL map (L7 routing) → backend service (algorithm, timeout, CDN, Cloud Armor, health check) → NEG or MIG." },
    { service: "The rest of the menu", role: "Regional external ALB (data stays in-region), internal ALB (service-to-service HTTP), external and internal passthrough Network LBs (L4 TCP/UDP)." },
    { service: "Cloud Run's built-in front end", role: "Managed TLS, HTTP/2-capable L7, health checking, request routing and traffic splitting for free. Add a GCLB only for a custom certificate, Cloud Armor, Cloud CDN or several backends under one hostname." },
  ],
  takeaways: [
    "Point health checks at readiness and do the arithmetic: interval × threshold.",
    "Fail readiness before you stop accepting, and drain for at least one health-check interval.",
    "Don't put an L4 balancer in front of gRPC or HTTP/2.",
    "Measure the tail, and measure the noise before you trust the difference.",
    "Know whether your LB fails open or closed when zero backends are healthy.",
    "LB-level retries need a budget.",
  ],
  drill: [
    { q: "Every deploy produces a burst of 502s. Walk through the causes.", a: [
      "Check the four steps: no pre-stop drain (the instance stops accepting while the LB still thinks it's healthy), SIGTERM not reaching the process (shell-form ENTRYPOINT), a shutdown timeout shorter than the longest request, or new instances marked healthy before they're ready.",
      "The tell between the first two: clean shutdown logs with 502s anyway means no drain; no shutdown logs at all means SIGTERM never arrived.",
    ] },
    { q: "You ran round robin vs least_conn and saw no improvement. What do you conclude, and why might that be correct?", a: [
      "\"No evidence of a difference\", because identical reruns moved the numbers more than the gap. Then explain why: six slow requests on three backends is an even 2/2/2 split, round robin's best case; <code>least_conn</code> counts connections, not CPU work, and <code>keepalive</code> blurs the count further; and Go preempts CPU-bound goroutines, so fast requests still get served.",
      "It earns its place with long-lived, genuinely uneven connections such as WebSockets, streaming and gRPC channels.",
    ] },
    { q: "Your gRPC service has 10 replicas; one is at 90% CPU and the rest are idle. Why?", a: [
      "An L4 balancer, or a client holding one connection. gRPC multiplexes requests over a single HTTP/2 connection, and L4 routes connections. Fix with an L7 balancer that understands streams, client-side load balancing with re-resolution, or <code>MAX_CONNECTION_AGE</code> to force redistribution.",
    ] },
    { q: "Health check interval 10 s, threshold 3, and the app takes 40 s to start. What breaks?", a: [
      "Detection: a dead backend serves errors for up to 30 s. Startup: without a startup probe or initial delay, the checker fails a healthy, still-booting instance three times and may restart it forever in a crash loop. Startup probes exist to pass once before liveness and readiness begin.",
    ] },
    { q: "Should the load balancer retry failed requests?", a: [
      "Only idempotent requests (a retried <code>POST /payments</code> charges twice), only connection-level failures rather than a 500 the backend produced after doing work, never a 4xx, and with a retry budget so a partial failure doesn't cascade. Retries are a load multiplier applied at the worst moment.",
    ] },
  ],
  connects: {
    back: "Capsule 06 gave you the replicas and the first nginx. Capsule 01's <code>/readyz</code>, <code>Shutdown</code> and drain delay, and Capsule 02's exec-form ENTRYPOINT, are steps 1–3 of the drain sequence. Capsule 05's <code>/train</code> is the slow request.",
    forward: "Capsule 08 adds the gateway that decides whether a request should exist at all. Capsule 09 makes \"measure the noise\" rigorous. Capsule 16 is the CDN checkbox on the backend service, Capsule 17 is retry budgets, and Capsule 24 builds safe deploys on draining and weighted traffic.",
  },
});

// ---------------------------------------------------------------------------
GA.recap({
  id: "08",
  tagline: "A load balancer picks which instance. A gateway decides whether the request should exist at all, and what it must look like before your services see it. It may inspect and reject; it should not compute.",
  built: "You wrote a ~150-line API gateway in Go: an <code>X-Request-Id</code> generated or reused and returned to the client, request logging, longest-prefix routing, API-key auth (401), a per-caller fixed-window limit of 30/min (429 with <code>Retry-After</code>), prefix stripping, and a proxy that removes <code>X-Api-Key</code> and <code>Authorization</code> before forwarding. You proved the backend sees the caller but never the key, then bypassed the gateway and impersonated <code>king-kai-himself</code> with one header. Finally you did the same in six lines of nginx and compared.",
  story: [
    "Some concerns would otherwise be implemented separately, and inconsistently, by every service: TLS, authentication, rate limits and quotas, request IDs, routing, schema validation. Centralising them at the edge is right. That's an API gateway, and like everything in this capsule it's a <b>reverse proxy</b> (acts for the server) with more opinions. A forward proxy acts for the client instead.",
    "Keep the layers straight. The load balancer answers \"which healthy instance?\", the gateway \"is this caller allowed and within quota?\", the service mesh \"how do services talk to each other safely?\", and a BFF \"what shape does this client need?\" Gateways own <b>north–south</b> traffic (in and out); meshes own <b>east–west</b> (service to service).",
    "The gateway's failure mode is becoming a distributed monolith's control centre: business logic in config, response aggregation, teams contending on one file, Lua nobody can test. <b>It may inspect and reject. It should not compute.</b>",
    "The mature auth answer is both: the gateway does <b>authentication</b> (who are you), each service does <b>authorization</b> (may this user do this to this resource). And edge auth carries an assumption your lab broke in one curl: if a service is reachable directly, anyone can set the identity header. <b>Edge auth is only as strong as the network isolation behind it.</b>",
  ],
  diagrams: [
    {
      title: "King Yemma's desk: the chain every request walks",
      svg: `<svg class="dg" viewBox="0 0 640 330" role="img" aria-label="Gateway request flow: set request id, match route by longest prefix, check API key, check rate limit, strip prefix and credentials, proxy to scouter. Rejections go right as 404, 401 and 429. Public routes skip the key and limit checks">
  <rect class="box" x="70" y="10" width="300" height="36" rx="8"/><text class="sm" x="220" y="28">GET /api/leaderboard + X-Api-Key</text>
  <line class="wire" x1="220" y1="46" x2="220" y2="58"/>
  <rect class="box" x="70" y="62" width="300" height="36" rx="8"/><text class="sm" x="220" y="80">X-Request-Id: reuse or generate</text>
  <line class="wire" x1="220" y1="98" x2="220" y2="110"/>
  <rect class="box cool" x="70" y="114" width="300" height="36" rx="8"/><text class="sm" x="220" y="132">match route: longest prefix wins</text>
  <line class="wire" x1="220" y1="150" x2="220" y2="162"/>
  <rect class="box cool" x="70" y="166" width="300" height="36" rx="8"/><text class="sm" x="220" y="184">API key known? → set X-Caller</text>
  <line class="wire" x1="220" y1="202" x2="220" y2="214"/>
  <rect class="box cool" x="70" y="218" width="300" height="36" rx="8"/><text class="sm" x="220" y="236">caller under 30 / min?</text>
  <line class="wire" x1="220" y1="254" x2="220" y2="266"/>
  <rect class="box" x="70" y="270" width="300" height="50" rx="8"/><text class="sm" x="220" y="286">strip /api, drop X-Api-Key</text><text class="sm" x="220" y="304">and Authorization, then proxy</text>
  <rect class="box warn" x="430" y="114" width="190" height="36" rx="8"/><text class="sm" x="525" y="132">404 no route</text>
  <rect class="box warn" x="430" y="166" width="190" height="36" rx="8"/><text class="sm" x="525" y="184">401 key required</text>
  <rect class="box warn" x="430" y="218" width="190" height="36" rx="8"/><text class="sm" x="525" y="236">429 + Retry-After: 60</text>
  <rect class="box ok" x="430" y="277" width="190" height="36" rx="8"/><text class="sm" x="525" y="295">scouter :8080</text>
  <line class="wire bad" x1="370" y1="132" x2="426" y2="132"/>
  <line class="wire bad" x1="370" y1="184" x2="426" y2="184"/>
  <line class="wire bad" x1="370" y1="236" x2="426" y2="236"/>
  <line class="wire good" x1="370" y1="295" x2="426" y2="295"/>
  <polyline class="wire dash soft" points="70,140 40,140 40,295 66,295"/>
  <text class="xs mute halo" x="40" y="218">public</text>
</svg>`,
      caption: "Public routes like <code>/healthz</code> skip the key and the limiter. 401 means \"we don't know who you are\"; 403 would mean \"we know, and no\". The limiter keys on the caller, so <code>mobile</code> keeps its own budget when <code>web</code> trips. Every response carries the request ID so a user can quote it.",
    },
    {
      title: "Edge auth is only as strong as the network behind it",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Top path: client sends an API key to the gateway, which forwards X-Caller web to the scouter. Bottom path: someone curls the scouter directly with X-Caller king-kai-himself and is believed. Mitigations: no unauthenticated invocation, internal-only network, or mTLS">
  <rect class="box" x="16" y="40" width="120" height="50" rx="10"/><text x="76" y="65">client</text>
  <rect class="box cool" x="240" y="40" width="140" height="50" rx="10"/><text x="310" y="58">gateway</text><text class="xs mono" x="310" y="76">:9090</text>
  <rect class="box energy" x="470" y="40" width="154" height="160" rx="10"/><text x="547" y="104">scouter</text><text class="xs mono" x="547" y="124">:8080</text><text class="xs" x="547" y="146">trusts X-Caller</text>
  <line class="wire" x1="136" y1="65" x2="236" y2="65"/>
  <text class="xs" x="188" y="54">X-Api-Key</text>
  <line class="wire good" x1="380" y1="65" x2="466" y2="65"/>
  <text class="xs good" x="424" y="54">X-Caller: web</text>
  <rect class="box warn" x="16" y="150" width="120" height="50" rx="10"/><text x="76" y="168">anyone</text><text class="xs mono" x="76" y="186">curl :8080</text>
  <line class="wire bad" x1="136" y1="175" x2="466" y2="175"/>
  <text class="sm bad halo" x="300" y="162">X-Caller: king-kai-himself</text>
  <text class="sm bad" x="300" y="194">believed: the gateway never saw it</text>
  <rect class="zone" x="8" y="222" width="624" height="70" rx="12"/>
  <text class="b start" x="24" y="244">The fix is isolation, not header cleverness</text>
  <text class="sm start" x="24" y="270">Cloud Run --no-allow-unauthenticated · internal-only VPC · mTLS</text>
</svg>`,
      caption: "Step 4 showed <code>api_key_seen</code> empty and <code>caller</code> set: the backend learns identity without handling a credential. Step 5 showed the price. Unless only the gateway can reach the service, edge auth is decoration.",
    },
    {
      title: "Why a fixed window lets a caller burst to 2×",
      svg: `<svg class="dg" viewBox="0 0 640 230" role="img" aria-label="Two one-minute windows meet at 12:00:00. 100 requests at 11:59:59.5 fill the first window and 100 at 12:00:00.5 fill the second, so 200 requests arrive within one second while each window stays within its limit of 100">
  <line class="axis" x1="30" y1="150" x2="610" y2="150"/>
  <line class="wire none soft" x1="320" y1="40" x2="320" y2="170" stroke-dasharray="4 5"/>
  <text class="xs mute" x="320" y="186">12:00:00</text>
  <text class="xs mute" x="40" y="186">11:59:00</text>
  <text class="xs mute" x="600" y="186">12:01:00</text>
  <text class="sm" x="175" y="56">window 1: 100 / 100 ✓</text>
  <text class="sm" x="465" y="56">window 2: 100 / 100 ✓</text>
  <rect class="fill-hot" x="290" y="80" width="26" height="70" rx="3"/>
  <rect class="fill-hot" x="324" y="80" width="26" height="70" rx="3"/>
  <text class="xs end" x="284" y="112">100 at :59.5</text>
  <text class="xs start" x="356" y="112">100 at :00.5</text>
  <text class="b bad" x="320" y="212">200 requests in one second: 2× the intended rate</text>
</svg>`,
      caption: "Not to scale: the two bursts sit half a second either side of the boundary. Your gateway's limiter has this flaw on purpose. Sliding-window counters or a token bucket (Capsule 17) fix it; a token bucket allows a <em>bounded</em> burst by design.",
    },
  ],
  concepts: [
    { term: "Forward vs reverse proxy", plain: "A forward proxy acts for the client (egress control, filtering; Cloud NAT, Secure Web Proxy). A reverse proxy acts for the server (TLS, routing, hiding topology; GCLB, nginx, Envoy).", why: "Same machinery, opposite direction. Everything else in this capsule is a reverse proxy with more opinions." },
    { term: "The layer cake", plain: "Load balancer: which instance. Reverse proxy: how to forward and reshape. API gateway: allowed, within quota, where the API lives. Service mesh: service-to-service safety. BFF: the shape one client needs.", why: "A single product often does several, which is why they get conflated. North–south is gateway territory, east–west is mesh territory." },
    { term: "Inspect and reject, don't compute", plain: "Auth, rate limits, TLS, request IDs and schema validation belong at the gateway. Body-based routing and aggregation do not.", why: "Logic in gateway config can't be unit-tested or debugged. Request shaping for particular clients belongs in a BFF service with tests and an owner." },
    { term: "Authenticate at the edge, authorize in the service", plain: "The gateway rejects anonymous and malformed requests early; each service decides whether this user may do this to this resource.", why: "Only the service knows whether user 42 may edit document 7. Zero-trust setups also keep mTLS between services." },
    { term: "TLS: terminate, re-encrypt, passthrough", plain: "Terminate to read HTTP inside a trusted VPC; re-encrypt for L7 features plus encryption in transit; passthrough when the proxy must never decrypt.", why: "You can't route by URL path and also be unable to read the traffic. Passthrough sees only the SNI hostname." },
    { term: "Sidecars and service mesh", plain: "A proxy beside each service, plus a control plane configuring them: mTLS, retries, timeouts, circuit breaking, traffic splitting and per-hop telemetry without code changes.", why: "It costs a control plane, sidecar memory per pod, an extra hop of ~1–3 ms, and harder debugging. With five services and one team, a shared HTTP client gets most of the value." },
  ],
  numbers: [
    { value: "~150 lines", label: "A real reverse-proxy gateway in Go", note: "nginx and Envoy do the same thing, faster, with more features." },
    { value: "30 / min", label: "Per-caller limit in the lab", note: "Request 31 gets a 429 with <code>Retry-After: 60</code>." },
    { value: "2×", label: "Fixed-window burst at the boundary", note: "100/min allows 200 in one second across the edge of two windows." },
    { value: "~1–3 ms", label: "Extra latency per mesh hop", note: "Plus sidecar memory per pod and a control plane to upgrade." },
  ],
  traps: [
    { myth: "Auth at the gateway means the services are protected.", truth: "Only if they can't be reached directly. One curl with a forged <code>X-Caller</code> proved it. Use authorised invocation, an internal-only network or mTLS." },
    { myth: "Forward the credential so the backend can double-check.", truth: "Strip it. The backend should never receive a raw key or token it didn't validate. Pass the identity the gateway decided instead." },
    { myth: "Put the aggregation logic in the gateway config, it's already there.", truth: "That's the distributed-monolith control centre: untestable Lua or YAML and teams fighting over one file. Aggregation belongs in a BFF." },
    { myth: "\"We should add a service mesh.\"", truth: "Wrong more often than right. Name the specific problem it solves that a shared client library can't: mandatory mTLS, dozens of services, polyglot teams." },
    { myth: "A fixed window of 100/min means at most 100 requests a minute.", truth: "Across a window boundary it allows 200 in a second. Use a sliding-window counter or a token bucket." },
  ],
  gcp: [
    { service: "Cloud Armor", role: "WAF, DDoS and IP/geo rules attached to a backend service, with preconfigured OWASP rules." },
    { service: "IAP (Identity-Aware Proxy)", role: "Google-identity authentication, group-based authorization and audit logs in front of any backend with zero app code. The highest value-per-effort option for internal tools and staging." },
    { service: "API Gateway · Apigee", role: "API Gateway: managed, from an OpenAPI spec, with API keys and JWT validation. Apigee: full API management with portals, monetisation and analytics, for when the API is a product." },
    { service: "Cloud Endpoints / ESPv2 · Cloud Service Mesh", role: "An Envoy-based proxy you deploy yourself, and managed Istio for GKE when you need mTLS everywhere." },
    { service: "Cloud Run auth", role: "<code>--no-allow-unauthenticated</code> so only the gateway's service account can invoke the backend. The small-team default stack needs no gateway at all: Cloud Armor → GCLB (TLS + URL map, Cloud CDN checkbox) → Cloud Run." },
  ],
  takeaways: [
    "Strip credentials at the gateway.",
    "Generate a request ID at the edge, propagate it, and return it to the client.",
    "Authenticate at the edge, authorize in the service.",
    "Edge auth requires network isolation. Otherwise it's a suggestion.",
    "If a routing rule needs the request body, it belongs in a service.",
    "Longest prefix wins for route matching.",
    "Don't add a mesh until you can name what it solves that a shared client can't.",
  ],
  drill: [
    { q: "Gateway or load balancer: where do you put authentication, and what does that assume?", a: [
      "The gateway. Token validation, key lookup and identity-provider calls are policy; an L4 balancer can't read enough, and an L7 LB is the wrong place for policy that changes often.",
      "The assumption: backends aren't directly reachable. Otherwise anyone can set <code>X-User-Id</code>. The mature answer is layered: authentication at the edge, authorization in the service, mTLS for service identity if you have a mesh.",
    ] },
    { q: "Why can't a TLS-passthrough proxy do path-based routing?", a: [
      "The path is inside the encrypted payload. Passthrough works at L4 and never decrypts, so it sees the connection and, through SNI in the <code>ClientHello</code>, the hostname, but never the URL, headers or body. For path routing, terminate TLS; if encryption must reach the backend, terminate and re-encrypt.",
    ] },
    { q: "Your fixed-window limiter allows 100/min. A caller sends 200 requests in one second. How?", a: [
      "100 at 11:59:59.5 fall in one window, 100 at 12:00:00.5 in the next. Both windows are within limit. Fix with a sliding-window log (exact, memory-hungry), a sliding-window counter (the usual production choice), or a token bucket, which allows a bounded burst by design.",
    ] },
    { q: "Client → Gateway → Service A → Service B. A user reports an error. How do you find it?", a: [
      "The gateway generates <code>X-Request-Id</code>, returns it to the client, and forwards it; every service logs and propagates it. Search the ID and you get the whole path. The proper version is distributed tracing with W3C <code>traceparent</code> (Capsule 25). Either way, one service that drops the header breaks the chain.",
    ] },
    { q: "Your gateway config has grown to 3,000 lines with Lua scripts. What went wrong?", a: [
      "Business logic migrated into infrastructure config. Sort what it does into genuinely cross-cutting concerns (auth, rate limits, TLS, CORS, request IDs), which stay, and client-specific shaping and aggregation, which becomes a BFF service with tests and an owner. Then hold the line: inspect and reject, don't compute.",
    ] },
  ],
  connects: {
    back: "Capsule 07's balancer chooses an instance; this layer sits in front and decides whether the request gets that far. Capsule 01's middleware chain and structured logging are the same shape as the gateway's.",
    forward: "Capsule 17 replaces the fixed-window limiter with a token bucket. Capsule 23 is where aggregation belongs (the BFF). Capsule 25 turns request IDs into distributed traces, and Bonus B3 covers tokens and OIDC.",
  },
});

// ---------------------------------------------------------------------------
GA.recap({
  id: "09",
  tagline: "Capacity questions are answered with numbers or with vibes. Percentiles, Little's Law and an open-model load test turn \"it fell over at 3pm\" into a curve you can explain.",
  built: "You wrote a k6 smoke test with pass/fail thresholds and an open-model stress test (<code>ramping-arrival-rate</code>, 20 → 1600 rps, 90% reads and 10% writes) and ran it against a container held to <code>--cpus=0.25</code>, so a knee was visible at all. You tabled target vs achieved RPS with p50/p95/p99, checked Little's Law against k6's VU count, reran it as a closed model to watch the cliff disappear, varied the CPU limit to get a capacity ratio, and wired <code>make loadtest</code> as a CI gate.",
  story: [
    "Averages lie. If 990 requests take 10 ms and 10 take 5 s, the average is 59 ms and only p99.9 tells the truth. Users don't make one request, either: a page with 20 backend calls hits your p99 on about 18% of loads. Report p50, p95 and p99, and never average percentiles across instances or time buckets.",
    "Two pieces of maths explain most capacity surprises. <b>Little's Law</b>, <code>L = λ × W</code>, links concurrency, arrival rate and latency, so you can size instances and spot hard ceilings like a connection pool. And <b>queueing</b> makes latency nonlinear: wait grows as <code>ρ / (1 − ρ)</code>, adding 1× the service time at 50% utilisation, 9× at 90% and 99× at 99%. \"Fine at 65%, fell over at 78%\" is just the knee.",
    "How you generate load decides whether you can see the cliff. A <b>closed model</b> (N users, each waiting for a response) backs off when the server slows, so it hides overload. That's <b>coordinated omission</b>. An <b>open model</b> sends requests at a fixed rate like real traffic, and under overload the queue grows until you see the real cliff.",
    "The lab is also a lesson in honest measurement. At <code>--cpus=1</code> the in-memory service had no knee at all: p95 1.16 ms, flat to 1600 rps. Constraining it to 0.25 CPU made the dynamics visible, which is legitimate as long as you say so. Two runs of that same setup gave p95 of 68 ms and 30 ms, so the exact numbers don't repeat, but the 26–60× gap to the unconstrained run is far bigger than that spread. That's what makes it a finding, unlike Capsule 07's.",
  ],
  diagrams: [
    {
      title: "The latency knee",
      svg: `<svg class="dg" viewBox="0 0 640 320" role="img" aria-label="Chart of queueing delay against utilisation, following rho over one minus rho. It is nearly flat until about 70 percent, then bends sharply upward: 1 times the service time at 50 percent, 9 times at 90 percent, 19 times at 95 percent">
  <rect class="zone" x="382" y="30" width="52" height="250" rx="4"/>
  <text class="xs good" x="408" y="22">plan: 60–70%</text>
  <line class="axis" x1="70" y1="280" x2="610" y2="280"/>
  <line class="axis" x1="70" y1="280" x2="70" y2="24"/>
  <line class="wire none soft" x1="590" y1="280" x2="590" y2="24" stroke-dasharray="4 5"/>
  <text class="xs mute start" x="596" y="34">100%</text>
  <text class="xs mute end" x="62" y="280">0</text>
  <text class="xs mute end" x="62" y="155">10×</text>
  <text class="xs mute end" x="62" y="30">20×</text>
  <text class="xs mute" x="70" y="298">0%</text>
  <text class="xs mute" x="200" y="298">25%</text>
  <text class="xs mute" x="330" y="298">50%</text>
  <text class="xs mute" x="460" y="298">75%</text>
  <text class="xs mute" x="340" y="314">utilisation ρ</text>
  <polyline class="line" points="70,280 96,279.3 122,278.6 148,277.8 174,276.9 200,275.8 226,274.6 252,273.3 278,271.7 304,269.8 330,267.5 356,264.7 382,261.2 408,256.8 434,250.8 460,242.5 486,230 512,209.2 538,167.5 551,125.8 564,42.5"/>
  <circle class="dot hot" cx="330" cy="267.5" r="4"/>
  <circle class="dot hot" cx="538" cy="167.5" r="4"/>
  <circle class="dot bad" cx="564" cy="42.5" r="4"/>
  <text class="sm halo" x="330" y="248">50%: +1×</text>
  <text class="sm halo end" x="528" y="167">90%: +9×</text>
  <text class="sm bad end" x="554" y="44">95%: +19×</text>
  <text class="sm start" x="96" y="60">extra wait ∝ ρ / (1 − ρ)</text>
  <text class="xs mute start" x="96" y="82">in multiples of the service time</text>
</svg>`,
      caption: "At 99% it would be 99×, far off the top. Target 60–70% so a spike lands on the flat part. Saturation signals move before latency does: in the lab, peak VUs and dropped iterations climbed first, then p99, then errors.",
    },
    {
      title: "Little's Law: L = λ × W",
      svg: `<svg class="dg" viewBox="0 0 640 280" role="img" aria-label="Requests arrive at rate lambda, spend W seconds in the system, and L requests are in flight at once. Worked examples: 1000 per second times 0.2 seconds is 200 in flight, so 3 instances at 80 each; a pool of 20 divided by 0.05 seconds caps throughput at 400 queries per second">
  <line class="wire" x1="30" y1="70" x2="196" y2="70"/>
  <text class="sm" x="110" y="56">λ arrivals / s</text>
  <rect class="box cool" x="200" y="30" width="240" height="80" rx="12"/>
  <circle class="dot" cx="236" cy="70" r="6"/><circle class="dot" cx="262" cy="70" r="6"/><circle class="dot" cx="288" cy="70" r="6"/><circle class="dot" cx="314" cy="70" r="6"/><circle class="dot" cx="340" cy="70" r="6"/><circle class="dot" cx="366" cy="70" r="6"/><circle class="dot" cx="392" cy="70" r="6"/>
  <text class="xs" x="320" y="98">L in flight, each for W seconds</text>
  <line class="wire" x1="440" y1="70" x2="606" y2="70"/>
  <text class="sm" x="524" y="56">λ completions / s</text>
  <rect class="box" x="20" y="136" width="600" height="38" rx="8"/>
  <text class="sm start" x="34" y="155">1000 req/s × 0.2 s = 200 in flight  ÷ 80 per instance → 3 instances minimum</text>
  <rect class="box" x="20" y="182" width="600" height="38" rx="8"/>
  <text class="sm start" x="34" y="201">pool 20 ÷ 0.05 s per query = 400 QPS ceiling, however many replicas</text>
  <rect class="box warn" x="20" y="228" width="600" height="38" rx="8"/>
  <text class="sm start" x="34" y="247">lab check: achieved RPS × p50 ≈ k6's vus. If not, the generator was the bottleneck.</text>
</svg>`,
      caption: "Rearranged as <code>λ = L / W</code>, it finds ceilings: the pool, not the web tier, limits that service to 400 QPS. Cutting <code>W</code> to 5 ms with an index gives 4,000. <code>W</code> is usually the cheapest lever and the one people reach for last.",
    },
    {
      title: "Closed vs open load: one hides the cliff",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Two charts over time as the server slows. Closed model: offered load drops as latency rises, so it looks like graceful degradation. Open model: offered load stays fixed, the queue and latency climb without bound, and errors appear">
  <rect class="zone" x="8" y="8" width="304" height="284" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="284" rx="12"/>
  <text class="b" x="160" y="30">Closed: N users wait</text>
  <text class="b" x="480" y="30">Open: fixed arrival rate</text>
  <line class="axis" x1="36" y1="230" x2="296" y2="230"/>
  <line class="axis" x1="36" y1="230" x2="36" y2="50"/>
  <line class="wire none soft" x1="140" y1="56" x2="140" y2="230" stroke-dasharray="3 5"/>
  <text class="xs mute" x="140" y="246">server slows</text>
  <polyline class="line cool" points="36,100 140,100 200,170 296,175"/>
  <polyline class="line bad" points="36,210 140,210 200,140 296,132"/>
  <text class="xs start" x="214" y="186">offered load</text>
  <text class="xs bad start" x="214" y="120">latency</text>
  <text class="sm" x="160" y="268">higher latency, no error cliff</text>
  <line class="axis" x1="356" y1="230" x2="616" y2="230"/>
  <line class="axis" x1="356" y1="230" x2="356" y2="50"/>
  <line class="wire none soft" x1="460" y1="56" x2="460" y2="230" stroke-dasharray="3 5"/>
  <text class="xs mute" x="460" y="246">server slows</text>
  <polyline class="line cool" points="356,100 616,100"/>
  <polyline class="line bad" points="356,210 460,210 520,170 570,110 600,56"/>
  <text class="xs start" x="364" y="88">offered load</text>
  <text class="xs bad start" x="532" y="190">queue + latency</text>
  <text class="sm bad" x="480" y="268">queue grows, errors: the real cliff</text>
</svg>`,
      caption: "Schematic. The closed generator stops sending while the server stalls, so the stall is recorded as a few slow requests instead of everyone who would have queued: coordinated omission. Use a closed model to simulate a fixed set of clients, and an open model (k6's <code>constant-arrival-rate</code> or <code>ramping-arrival-rate</code>) to find limits.",
    },
  ],
  concepts: [
    { term: "Percentiles over averages", plain: "p50, p95, p99 (and p99.9 for user-facing) describe the distribution; the average hides the tail.", why: "A page with 20 calls hits p99 on <code>1 − 0.99²⁰ ≈ 18%</code> of loads, and your heaviest users live in the tail. Store histograms; never average percentiles." },
    { term: "Little's Law", plain: "<code>L = λ × W</code>: in-flight requests equal arrival rate times time in the system.", why: "It sizes instances (200 in flight at 80 each is 3) and exposes ceilings (pool 20 at 50 ms is 400 QPS). In the lab it validates the test itself." },
    { term: "The knee", plain: "Queueing delay grows as <code>ρ / (1 − ρ)</code>: flat at low utilisation, steep past about 70–80%, vertical at 100%.", why: "Plan for 60–70%. It's not conservatism, it's the shape of the function." },
    { term: "Closed vs open model", plain: "Closed: N users each wait for a response, so load drops when the server slows. Open: requests arrive at a fixed rate regardless.", why: "Only an open model finds the breaking point. Hiding overload behind a polite generator is coordinated omission." },
    { term: "Four kinds of test", plain: "Smoke (tiny, 1 min, in CI), load (expected peak, 10–30 min), stress (ramp until it breaks), soak (moderate load for hours).", why: "Soak tests catch what nothing else does: a 1 MB leak per 1000 requests is invisible in 10 minutes and takes production down on day four." },
    { term: "RED, USE and saturation", plain: "RED per service: rate, errors, duration. USE per resource: utilisation, saturation, errors. Saturation is how much is waiting.", why: "Saturation predicts the knee; utilisation only tells you where you are on the curve." },
  ],
  numbers: [
    { value: "≈ 18%", label: "Page loads that hit p99 with 20 calls", note: "Your \"1% slow\" is 1 in 5 page loads." },
    { value: "1× → 9× → 99×", label: "Queueing at 50%, 90%, 99% utilisation", note: "In multiples of the service time." },
    { value: "1.16 vs 68 ms", label: "p95 at --cpus=1 vs 0.25", note: "Measured on an M-series Mac. A second run gave 30 ms. The 26–60× gap is the finding." },
    { value: "20 ÷ 0.05 = 400", label: "QPS ceiling for a pool of 20", note: "At 5 ms per query it's 4,000, for zero infrastructure." },
  ],
  traps: [
    { myth: "\"Average is 45 ms, ship it.\"", truth: "With p99 at 3.2 s, a page making 10 calls is slow for about 1 in 10 users, and your heaviest users hit it every time. Ask what p99.9 is." },
    { myth: "A closed-model test that degrades gracefully means the service does.", truth: "The generator slowed down with the server. Real traffic doesn't wait. A closed-model test cannot find your breaking point." },
    { myth: "Flat latency all the way to 1600 rps means it scales forever.", truth: "At <code>--cpus=1</code> the lab saw exactly that, because the test was too small for the service. Turn the limit down until you can see the cliff, and say that you did." },
    { myth: "Achieved RPS fell short of target, so the service saturated.", truth: "Or <code>maxVUs</code> was too low and the generator was the bottleneck. Check Little's Law against <code>vus</code>; if they disagree, the test is invalid." },
    { myth: "Our load test hit 5,000 RPS, so production will.", truth: "Wrong mix, an empty database, a warm cache, a closed model, a saturated generator or a different environment can each make that number fiction." },
  ],
  gcp: [
    { service: "Cloud Monitoring", role: "Cloud Run latency, instance count and CPU out of the box. Latency is stored as a distribution, so you can chart p50/p95/p99 without instrumenting anything." },
    { service: "Cloud Trace", role: "Samples requests and shows where the time went. Most useful once there are several services (Capsule 25)." },
    { service: "Cloud Run concurrency", role: "Set it from your k6 numbers: if one instance saturates around 60 in-flight requests, use <code>--concurrency=60</code>, not the default 80. Set <code>--max-instances</code> low before any stress test, or it will scale up and bill you." },
  ],
  takeaways: [
    "Never report an average latency. p50, p95, p99, always.",
    "Use an open model to find limits.",
    "Plan for 60–70% utilisation.",
    "Soak test before any big launch.",
    "Put a threshold-gated smoke test in CI.",
    "Test the mix, not one endpoint: writes usually break first.",
    "Record capacity as a ratio (RPS per vCPU) so it survives traffic doubling.",
    "Never load-test someone else's infrastructure.",
  ],
  drill: [
    { q: "Load test: average 45 ms, p99 3.2 s. The team says \"average is fine, ship it.\" Respond.", a: [
      "1% of requests take 3.2 s. If a page makes 10 backend calls, about 10% of page loads include one, so roughly 1 in 10 users suffers, not 1 in 100. Latency also correlates with user weight: your biggest customers hit the slow path every time. And a 3.2 s p99 usually hides a much worse p99.9.",
      "Find the specific cause: a missing index, a cold cache, an N+1, a lock.",
    ] },
    { q: "Latency is flat until 70% CPU, then explodes. Why isn't it linear?", a: [
      "Queueing. Once a resource is busy, new work waits, and the wait scales as <code>ρ / (1 − ρ)</code>: 1× the service time at 50%, 9× at 90%, 99× at 99%, with an asymptote at 100%. That's why you plan for 60–70%, and why 10% more traffic breaks a service already at 85%.",
    ] },
    { q: "Your connection pool is 20 and queries average 50 ms. What's the max throughput, and how do you raise it?", a: [
      "<code>λ = L / W = 20 / 0.05 = 400 QPS</code>, however many web replicas you add. Raise it by making queries faster (5 ms gives 4,000 QPS for free), enlarging the pool (the database has its own limit, and past it you make things worse), caching (Capsule 14) or read replicas (Capsule 13). <code>W</code> is almost always the cheapest lever.",
    ] },
    { q: "Explain coordinated omission in one paragraph.", a: [
      "A closed-model generator sends the next request only after the previous one returns. When the server stalls for 2 s, the generator doesn't send what it would have sent in that window, so those requests are never measured and the stall shows up as one slow request instead of everyone who would have queued. Percentiles come out optimistic. Fix it with an open model or a generator that back-fills the timestamps it should have used.",
    ] },
    { q: "Your load test shows 5,000 RPS. Production falls over at 800. What went wrong?", a: [
      "Usual suspects: the wrong workload mix (one cheap endpoint), no data (100 rows keep every index in memory), a warm cache, a closed-model test, the load generator as the bottleneck, or a test environment unlike production (no TLS, no network hop, different sizes). Fix with a realistic mix, production-sized data, realistic hit rates and open-model arrival.",
    ] },
  ],
  connects: {
    back: "Capsule 05's knee in the <code>--cpus</code> ladder and its \"utilisation is not saturation\" get their maths here. Capsule 06's per-instance concurrency is what Little's Law sizes, and Capsule 07's no-signal comparison is the opposite case to this capsule's knee.",
    forward: "From here on every claim is a number: Capsule 10's connection-pool ceiling is Little's Law, Capsule 14 measures database load instead of hit ratio, and Capsule 26 asks for exactly the RPS-per-vCPU capacity model you just produced.",
  },
});
