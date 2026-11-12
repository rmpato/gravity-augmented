// Saga 3 · Frieza Saga — Latency. Recaps for capsules 14–17.
// Source of truth: capsules/14-*/README.md … capsules/17-*/README.md.

GA.recap({
  id: "14",
  tagline: "A cache is a second copy of the truth. Every cache is a consistency problem you chose to accept, so the work is deciding where staleness is harmless.",
  built: "You put Redis in the stack, wrapped the fighter repository in a <b>cache-aside decorator</b>, measured hit ratio <em>and</em> real database load with k6, killed Redis mid-run to prove the service degrades instead of breaking, and tried a Redis <b>sorted set</b> as a leaderboard that maintains itself.",
  story: [
    "Caching is the biggest single lever you have on latency, and the quickest way to add bugs you can't reproduce. Once data lives in two places, the two copies can disagree. Choosing a strategy, a TTL and an eviction policy is really choosing <b>how wrong you are allowed to be, and for how long</b>.",
    "The default is <b>cache-aside</b>. On a read, ask the cache first; on a miss, read the database and fill the cache. On a write, update the database and then <b>delete</b> the key instead of updating it. If the cache dies, the service gets slower but it keeps working.",
    "The number people get wrong is <b>hit ratio vs load reduction</b>. The cache holds the popular, cheap queries, and the misses are the expensive long tail. So a 90% hit ratio can still leave most of the database's real work in place. Measure the database, not the cache.",
    "The deeper lesson from the lab: the best cache is often not a copy of a query result at all, but a <b>different data structure that keeps the answer current as writes arrive</b>, like a sorted set for a leaderboard.",
  ],
  diagrams: [
    {
      title: "Cache-aside: a read that misses",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Sequence: client asks service, service asks Redis and misses, reads Postgres, writes Redis with a TTL, returns to client">
  <rect class="box" x="20" y="10" width="120" height="40" rx="10"/><text x="80" y="30">Client</text>
  <rect class="box hot" x="190" y="10" width="120" height="40" rx="10"/><text x="250" y="30">Scouter</text>
  <rect class="box cool" x="360" y="10" width="120" height="40" rx="10"/><text x="420" y="30">Redis</text>
  <rect class="box energy" x="510" y="10" width="120" height="40" rx="10"/><text x="570" y="30">Postgres</text>
  <line class="wire none soft" x1="80" y1="50" x2="80" y2="292" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="250" y1="50" x2="250" y2="292" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="420" y1="50" x2="420" y2="292" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="570" y1="50" x2="570" y2="292" stroke-dasharray="3 5"/>
  <line class="wire" x1="82" y1="84" x2="246" y2="84"/><text class="sm" x="165" y="72">GET /fighters/goku</text>
  <line class="wire" x1="252" y1="118" x2="416" y2="118"/><text class="sm" x="335" y="106">① GET fighter:goku</text>
  <line class="wire dash bad" x1="418" y1="150" x2="254" y2="150"/><text class="sm bad" x="335" y="138">(nil): miss</text>
  <line class="wire" x1="252" y1="182" x2="566" y2="182"/><text class="sm halo" x="410" y="170">② SELECT … WHERE name = 'goku'</text>
  <line class="wire dash" x1="568" y1="212" x2="254" y2="212"/><text class="sm" x="410" y="200">row</text>
  <line class="wire" x1="252" y1="244" x2="416" y2="244"/><text class="sm" x="335" y="232">③ SET … EX 60 + jitter</text>
  <line class="wire good" x1="248" y1="276" x2="84" y2="276"/><text class="sm good" x="165" y="264">200 OK</text>
</svg>`,
      caption: "On a hit, the flow stops at ①. On a write you update Postgres first, then <code>DEL fighter:goku</code>, and the next read refills the key from the source of truth. If Redis errors or times out, the service skips straight to ② and is slower, not down.",
    },
    {
      title: "Hit ratio is not load reduction",
      svg: `<svg class="dg" viewBox="0 0 640 230" role="img" aria-label="Two bars: 90 percent of requests are cache hits, but the 10 percent of misses carry about 60 percent of the database cost">
  <text class="b start" x="20" y="24">Requests (10,000 / s)</text>
  <rect class="box ok" x="20" y="40" width="540" height="44" rx="8"/>
  <rect class="box warn" x="560" y="40" width="60" height="44" rx="8"/>
  <text x="290" y="62">9,000 hits · served by Redis</text>
  <text class="sm" x="590" y="62">10%</text>
  <text class="b start" x="20" y="124">Database cost those requests represent</text>
  <rect class="box ok" x="20" y="140" width="240" height="44" rx="8"/>
  <rect class="box warn" x="260" y="140" width="360" height="44" rx="8"/>
  <text class="sm" x="140" y="162">popular, cheap: ~40%</text>
  <text x="440" y="162">long-tail misses: ~60%</text>
  <line class="wire bad" x1="590" y1="88" x2="440" y2="136"/>
  <text class="sm mute start" x="20" y="212">90% hit ratio, yet most of the database's real work still reaches the database.</text>
</svg>`,
      caption: "The split is illustrative; the shape is what you measured in Step 4. Cached keys are the hot, well-indexed reads. Misses are rare, complex queries. Compare <code>xact_commit</code> before and after, not just the hit counter.",
    },
    {
      title: "Why you delete on write instead of updating",
      svg: `<svg class="dg" viewBox="0 0 640 270" role="img" aria-label="Two concurrent writers: updating the cache can leave the older value cached forever; deleting the key cannot">
  <rect class="zone" x="8" y="8" width="304" height="254" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="254" rx="12"/>
  <text class="b" x="160" y="30">Update the cache</text>
  <text class="b" x="480" y="30">Delete the key</text>
  <g>
    <rect class="box" x="24" y="48" width="272" height="30" rx="8"/><text class="sm" x="160" y="63">W1 writes DB = 10</text>
    <rect class="box" x="24" y="84" width="272" height="30" rx="8"/><text class="sm" x="160" y="99">W2 writes DB = 20</text>
    <rect class="box" x="24" y="120" width="272" height="30" rx="8"/><text class="sm" x="160" y="135">W2 sets cache = 20</text>
    <rect class="box warn" x="24" y="156" width="272" height="30" rx="8"/><text class="sm" x="160" y="171">W1 sets cache = 10  (late)</text>
    <text class="b bad" x="160" y="212">DB 20 · cache 10</text>
    <text class="sm bad" x="160" y="236">stale until the TTL expires</text>
  </g>
  <g>
    <rect class="box" x="344" y="48" width="272" height="30" rx="8"/><text class="sm" x="480" y="63">W1 writes DB = 10</text>
    <rect class="box" x="344" y="84" width="272" height="30" rx="8"/><text class="sm" x="480" y="99">W2 writes DB = 20</text>
    <rect class="box" x="344" y="120" width="272" height="30" rx="8"/><text class="sm" x="480" y="135">W2 deletes key</text>
    <rect class="box ok" x="344" y="156" width="272" height="30" rx="8"/><text class="sm" x="480" y="171">W1 deletes key  (late: harmless)</text>
    <text class="b good" x="480" y="212">next read: miss → loads 20</text>
    <text class="sm good" x="480" y="236">worst case is one extra miss</text>
  </g>
</svg>`,
      caption: "Delete is idempotent, so the order doesn't matter. Update is not, and the last writer to touch the cache wins even when it carries the older value.",
    },
  ],
  concepts: [
    { term: "Cache-aside (lazy loading)", plain: "Your code checks the cache, falls back to the database on a miss, then fills the cache. Writes go to the database and delete the key.", why: "It only caches what's actually requested, and a cache outage makes the service slower instead of taking it down. It's the default for a reason." },
    { term: "Write-through / write-behind", plain: "Write-through writes the cache and the database together. Write-behind writes the cache and flushes to the database later.", why: "Write-through is never stale but makes writes slower. Write-behind is fast but <b>loses data</b> if the cache dies before it flushes, so use it only for things like view counts." },
    { term: "TTL is a correctness decision", plain: "A TTL is your answer to \"how stale may this be?\" It's a product question dressed up as an ops setting. Always add jitter: <code>base + rand(0, base×0.1)</code>.", why: "Keys created together expire together. Without jitter you schedule your own stampede, which is Capsule 15's opening act." },
    { term: "Eviction policy", plain: "When memory fills up, something has to go. LRU is the usual default, and LFU resists one big scan wiping out your hot set.", why: "Redis ships with <code>noeviction</code>: when it's full it starts <b>rejecting writes</b>. Set <code>allkeys-lru</code> explicitly." },
    { term: "Cache layers", plain: "In-process map (~50 ns, one per replica), Redis (~1 ms, shared), CDN edge (~10 ms, HTTP only), and the database's own buffer pool, which is free and already running.", why: "An in-process cache brings back the Capsule 06 bug: each replica gives a different answer. Keep it for data that never changes." },
    { term: "Data structure over a copied result", plain: "A Redis sorted set (<code>ZADD</code>, <code>ZREVRANGE</code>, <code>ZREVRANK</code>) keeps the ranking current on every write.", why: "There's nothing to invalidate or recompute, and \"what's my rank?\" goes from expensive SQL to O(log n)." },
  ],
  numbers: [
    { value: "10,000 × 10%", label: "= 1,000 req/s still reach the DB", note: "A 90% hit ratio doesn't help if the DB can only take 800." },
    { value: "~50 ns vs ~1 ms", label: "In-process vs Redis", note: "About 20,000× apart. That's the whole reason in-process caches tempt people." },
    { value: "100–500 ms", label: "Cache client timeout", note: "A hung Redis must never be slower than the database it's meant to protect." },
    { value: "~$25–35 / mo", label: "Smallest Memorystore", note: "No free tier. That's why the labs use Docker Redis." },
  ],
  traps: [
    { myth: "\"We have a 95% hit ratio, so the database is fine.\"", truth: "Hit ratio counts requests, not cost. The 5% that miss are the expensive tail. Use <code>pg_stat_statements</code> to see what the database actually spends time on." },
    { myth: "Caching a personalised page under the URL as the key.", truth: "User A gets served user B's data. That's a security incident, not a performance bug. Put the user id in the key, or don't cache it." },
    { myth: "If Redis is down, return an error.", truth: "Then you've turned an optimisation into a dependency. Catch the error, log it, fall through to the database, and keep serving." },
    { myth: "Redis's default eviction is fine.", truth: "The default is <code>noeviction</code>, so a full cache turns into write errors. Set <code>allkeys-lru</code> deliberately." },
    { myth: "Cache everything, it's free speed.", truth: "Don't cache cheap indexed lookups (0.2 ms doesn't need a network hop), data with near-zero hit ratio, or anything that must be right <em>this instant</em>, like a balance during a transfer." },
  ],
  gcp: [
    { service: "Memorystore for Redis", role: "Managed Redis. Basic tier is a single node and loses data on failure; Standard adds a replica and automatic failover. It's VPC-only, so Cloud Run needs a <b>Serverless VPC Access connector</b> to reach it." },
    { service: "Memorystore for Memcached", role: "Simpler and multi-threaded, with no persistence or data structures. Pick Redis unless you specifically want that simplicity." },
    { service: "Cloud SQL buffer pool", role: "Postgres already keeps hot pages in RAM. If your working set fits in <code>shared_buffers</code>, adding Redis may buy less than you'd think." },
    { service: "Cloud CDN · BigQuery", role: "The rest of the cache ladder: HTTP responses at the edge (Capsule 16), and BigQuery re-serves identical query results for 24 h at no charge." },
  ],
  takeaways: [
    "Cache-aside is the default. Delete the key on write; never update it.",
    "A cache failure must degrade the service, not fail it: short timeouts, fall through, log, keep serving.",
    "Measure database load reduction, not hit ratio.",
    "Always add jitter to TTLs.",
    "Set the eviction policy explicitly.",
    "Never cache personalised data under a shared key.",
    "Namespace and version keys (<code>svc:v2:entity:id</code>) so a schema change is just a prefix bump.",
    "Before caching a query result, ask whether a different data structure could keep the answer current.",
  ],
  drill: [
    { q: "95% hit ratio, and the database is still at 100% CPU. Explain.", a: [
      "Hit ratio counts <em>requests</em>, not <em>cost</em>. The 5% that miss are the expensive tail: unindexed queries, big scans, rare heavy reports. The cached 95% were cheap and were never the problem.",
      "Other possibilities: total traffic grew, writes (never cached) are the real load, or invalidation is so aggressive that hot keys keep getting recomputed. Check <code>pg_stat_statements</code> ordered by <code>total_exec_time</code>.",
    ] },
    { q: "Why delete the cache key on write instead of updating it?", a: [
      "Two concurrent writers can interleave so that the <em>older</em> value is written to the cache last and stays there until the TTL expires. Deletion is idempotent: the worst case is one extra miss, after which the next read loads the true value.",
    ] },
    { q: "When is an in-process cache the right call?", a: [
      "When the data is effectively immutable: config loaded at startup, compiled templates, reference data that only changes on deploy. For anything mutable and user-visible, each replica holds its own copy, invalidation doesn't reach the others, and users see different answers. The middle ground is a tiny in-process cache with a 1–5 s TTL in front of Redis, to soak up hot keys.",
    ] },
    { q: "Redis is down. What should the service do, and what has to be true for that to be safe?", a: [
      "Serve from the database, slower. That needs short cache timeouts, a circuit breaker so you stop paying the timeout on every request (Capsule 17), and enough database headroom to take 100% of traffic. If the database can't take it, the cache is load-bearing: you need Redis HA and a load-shedding plan.",
      "Alert on hit ratio collapsing too, not just on Redis being unreachable. A cache that's up but evicting everything is the sneakier failure.",
    ] },
    { q: "Design the cache key and TTL for a per-user feed.", a: [
      "<code>feed:v1:user:{id}:page:{cursor}</code>. The user <b>must</b> be in the key. Use a short TTL (30–60 s) and invalidate on the user's own actions so read-your-writes holds. Cache only the first page, store ids rather than full objects, and cache the objects separately so feeds share them. At real scale, precompute feeds on write (fan-out-on-write, Capsule 20).",
    ] },
  ],
  connects: {
    back: "Capsules 10–13 gave you a real database, indexes and replicas, so you can now tell when a cache actually helps. Capsule 06's \"state hides in each replica\" is why in-process caches are a trap, and Capsule 13's read-your-writes comes back as the per-user feed problem.",
    forward: "Capsule 15 shows how this cache betrays you under load: stampedes, hot keys, invalidation at scale. Capsule 16 moves caching to the edge with HTTP headers, and Capsule 17's circuit breaker is what lets you stop calling a dead Redis.",
  },
});

GA.recap({
  id: "15",
  tagline: "Cache failures only show up under load. Each one has a name, a mechanism and a specific fix, and knowing the name is most of the battle.",
  built: "You added a deliberately slow leaderboard query (<code>pg_sleep(0.3)</code>), fired 200 concurrent requests at the moment its 5 s key expired and watched the identical queries pile up in <code>pg_stat_activity</code>. Then you collapsed them with <b>singleflight</b>, added <b>negative caching</b> for ids that don't exist, absorbed a k6 <b>hot key</b> with a 1-second in-process cache, and wrote a <b>consistent hash ring</b> with a test that measures how many keys move when a node dies.",
  story: [
    "Capsule 14's cache works perfectly in dev, in staging and in production, right up until the moment it matters most. The failures in this capsule share one property: <b>they only appear under load</b>. Without a name for them, the symptom (\"the database fell over at exactly 14:00:00\") is baffling.",
    "The headline failure is the <b>stampede</b>. A popular key expires, every concurrent request misses at once, and they all send the same expensive query to the database. The fix with the biggest payoff is about twenty lines: <b>singleflight</b>. The first miss for a key does the work; everyone else waits for it and shares the result.",
    "The others are close relatives. <b>Penetration</b> is requests for keys that exist nowhere, so the cache never helps. A <b>hot key</b> is one key that saturates the single Redis node holding it. An <b>avalanche</b> is everything expiring at once. Each fix moves the answer earlier: a cached \"null\", a local copy for one second, jittered TTLs.",
    "Under all of it sits invalidation, the genuinely hard part. Explicit deletes only work if you find every write path, and you won't. Versioned keys, a TTL backstop and, later, change events (Capsule 21) are how real systems cope.",
  ],
  diagrams: [
    {
      title: "Stampede vs singleflight",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Left: 200 requests miss together and each sends a query to Postgres. Right: the same 200 requests go through singleflight and only one query reaches Postgres">
  <rect class="zone" x="8" y="8" width="304" height="274" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="274" rx="12"/>
  <text class="b" x="160" y="30">No coalescing</text>
  <text class="b" x="480" y="30">Singleflight</text>
  <rect class="box" x="24" y="52" width="62" height="26" rx="8"/><text class="sm" x="55" y="65">req 1</text>
  <rect class="box" x="24" y="88" width="62" height="26" rx="8"/><text class="sm" x="55" y="101">req 2</text>
  <rect class="box" x="24" y="124" width="62" height="26" rx="8"/><text class="sm" x="55" y="137">req 3</text>
  <text class="b mute" x="55" y="164">…</text>
  <rect class="box" x="24" y="178" width="62" height="26" rx="8"/><text class="sm" x="55" y="191">req 200</text>
  <rect class="box warn" x="186" y="100" width="110" height="64" rx="10"/>
  <text x="241" y="122">Postgres</text><text class="sm" x="241" y="144">200 queries</text>
  <line class="wire bad" x1="88" y1="65" x2="182" y2="110"/>
  <line class="wire bad" x1="88" y1="101" x2="182" y2="124"/>
  <line class="wire bad" x1="88" y1="137" x2="182" y2="138"/>
  <line class="wire bad" x1="88" y1="191" x2="182" y2="154"/>
  <text class="b bad" x="160" y="238">200 identical queries</text>
  <text class="sm bad" x="160" y="262">same answer, computed 200 times</text>
  <rect class="box" x="344" y="52" width="62" height="26" rx="8"/><text class="sm" x="375" y="65">req 1</text>
  <rect class="box" x="344" y="88" width="62" height="26" rx="8"/><text class="sm" x="375" y="101">req 2</text>
  <rect class="box" x="344" y="124" width="62" height="26" rx="8"/><text class="sm" x="375" y="137">req 3</text>
  <text class="b mute" x="375" y="164">…</text>
  <rect class="box" x="344" y="178" width="62" height="26" rx="8"/><text class="sm" x="375" y="191">req 200</text>
  <rect class="box cool" x="438" y="104" width="76" height="56" rx="10"/>
  <text x="476" y="124">sf.Do</text><text class="xs" x="476" y="144">per key</text>
  <line class="wire" x1="408" y1="65" x2="435" y2="114"/>
  <line class="wire" x1="408" y1="101" x2="435" y2="124"/>
  <line class="wire" x1="408" y1="137" x2="435" y2="138"/>
  <line class="wire" x1="408" y1="191" x2="435" y2="152"/>
  <rect class="box ok" x="542" y="104" width="78" height="56" rx="10"/>
  <text class="sm" x="581" y="124">Postgres</text><text class="sm" x="581" y="144">1 query</text>
  <line class="wire good" x1="516" y1="132" x2="538" y2="132"/>
  <text class="b good" x="480" y="238">1 query runs</text>
  <text class="sm good" x="480" y="262">the other 199 share its result</text>
</svg>`,
      caption: "The key is the <b>cache key</b>, and <code>Do</code> wraps the load, not the cache write. Singleflight is per process: with 10 replicas you get 10 queries, still a 20× improvement. For global coalescing you need a distributed lock (<code>SET key val NX PX 5000</code>).",
    },
    {
      title: "Consistent hashing: losing a node moves only its keys",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="A hash ring with four cache nodes. Removing cache-c moves only the keys it owned to the next node clockwise. Bars: modulo hashing moved 74.9 percent of keys, the ring moved 25.8 percent">
  <circle class="axis" cx="160" cy="150" r="100"/>
  <rect class="box hot" x="124" y="37" width="72" height="26" rx="8"/><text class="sm" x="160" y="50">cache-a</text>
  <rect class="box hot" x="224" y="137" width="72" height="26" rx="8"/><text class="sm" x="260" y="150">cache-b</text>
  <rect class="box dim" x="124" y="237" width="72" height="26" rx="8"/><text class="sm mute" x="160" y="250">cache-c</text>
  <rect class="box hot" x="24" y="137" width="72" height="26" rx="8"/><text class="sm" x="60" y="150">cache-d</text>
  <text class="xs bad" x="160" y="280">removed</text>
  <circle class="dot good" cx="210" cy="63" r="5"/>
  <circle class="dot good" cx="73" cy="100" r="5"/>
  <circle class="dot bad" cx="242" cy="207" r="5"/>
  <circle class="dot bad" cx="213" cy="235" r="5"/>
  <text class="xs" x="160" y="136">a key belongs to the</text>
  <text class="xs" x="160" y="152">next node clockwise</text>
  <path class="wire dash bad" d="M 120 252 Q 66 240 60 168"/>
  <text class="xs bad" x="142" y="214">c's keys go to d</text>
  <text class="b start" x="330" y="56">Keys moved when 1 of 4 nodes goes</text>
  <text class="sm start" x="330" y="92">hash(key) % N, going 4 → 3</text>
  <rect class="box warn" x="330" y="104" width="210" height="30" rx="8"/>
  <text class="b start" x="550" y="119">74.9%</text>
  <text class="sm start" x="330" y="166">ring, 150 virtual nodes each</text>
  <rect class="box ok" x="330" y="178" width="72" height="30" rx="8"/>
  <text class="b start" x="412" y="193">25.8%</text>
  <text class="xs mute start" x="330" y="240">go test -run 'Ring|Modulo', 100,000 keys</text>
  <text class="xs mute start" x="330" y="260">the ring loses only the dead node's quarter</text>
</svg>`,
      caption: "Green keys stay put; only the red ones, owned by the dead node, move. The real ring places each node at ~150 positions, so its keys spread across all survivors instead of landing on one neighbour. The two percentages are what the reference test printed; the capsule says to expect roughly 26% vs ~75%.",
    },
    {
      title: "Penetration and hot keys: answer before the database",
      svg: `<svg class="dg" viewBox="0 0 640 286" role="img" aria-label="Three flows. A random id misses Redis and Postgres and nothing is cached. With negative caching the repeat gets a cached null from Redis. A hot key is served from a one-second in-process cache and rarely reaches Redis">
  <text class="sm mute start" x="20" y="22">Cache penetration, no negative cache</text>
  <rect class="box" x="20" y="34" width="130" height="36" rx="8"/><text class="sm" x="85" y="52">random id</text>
  <rect class="box warn" x="180" y="34" width="130" height="36" rx="8"/><text class="sm" x="245" y="52">Redis: miss</text>
  <rect class="box warn" x="340" y="34" width="150" height="36" rx="8"/><text class="sm" x="415" y="52">Postgres: no row</text>
  <line class="wire" x1="152" y1="52" x2="176" y2="52"/>
  <line class="wire" x1="312" y1="52" x2="336" y2="52"/>
  <text class="sm bad" x="565" y="44">nothing cached;</text>
  <text class="sm bad" x="565" y="62">next one repeats it</text>
  <text class="sm mute start" x="20" y="112">Same id again, with a 30 s negative cache</text>
  <rect class="box" x="20" y="124" width="130" height="36" rx="8"/><text class="sm" x="85" y="142">same id</text>
  <rect class="box ok" x="180" y="124" width="130" height="36" rx="8"/><text class="sm" x="245" y="142">Redis: "null"</text>
  <rect class="box ok" x="340" y="124" width="150" height="36" rx="8"/><text class="sm" x="415" y="142">not found, fast</text>
  <line class="wire" x1="152" y1="142" x2="176" y2="142"/>
  <line class="wire good" x1="312" y1="142" x2="336" y2="142"/>
  <text class="sm good" x="565" y="142">Postgres untouched</text>
  <text class="sm mute start" x="20" y="202">Hot key: 90% of traffic is goku</text>
  <rect class="box" x="20" y="214" width="130" height="36" rx="8"/><text class="sm" x="85" y="232">goku</text>
  <rect class="box cool" x="180" y="214" width="150" height="36" rx="8"/><text class="sm" x="255" y="232">local map, 1 s TTL</text>
  <rect class="box dim" x="380" y="214" width="110" height="36" rx="8"/><text class="sm mute" x="435" y="232">Redis</text>
  <line class="wire" x1="152" y1="232" x2="176" y2="232"/>
  <line class="wire dash soft" x1="332" y1="232" x2="376" y2="232"/>
  <text class="xs mute" x="354" y="268">once a second</text>
  <text class="sm good" x="565" y="232">stays in process</text>
</svg>`,
      caption: "Each fix stops the request one layer earlier. The negative entry's trade-off: a fighter created right after being looked up stays invisible for up to 30 s, so keep that TTL short and delete the key on create. The 1-second local cache is safe only because its staleness is tiny and explicit.",
    },
  ],
  concepts: [
    { term: "Stampede (thundering herd)", plain: "A popular key expires and every concurrent request misses at once, sending the same expensive query to the database. Timeouts and client retries then double the load.", why: "The database goes from 10 QPS to 1,000 at the worst moment, and they are the <em>expensive</em> uncached queries." },
    { term: "Singleflight (request coalescing)", plain: "Only the first miss for a key runs the loader. Concurrent callers block briefly and share its result; the <code>shared</code> flag tells you who rode along.", why: "One query instead of hundreds, in about twenty lines. Per process only, so N replicas still make N queries." },
    { term: "XFetch and stale-while-revalidate", plain: "XFetch: each request has a small, rising chance of refreshing a key before its TTL ends. Stale-while-revalidate: serve the old value now and refresh in the background.", why: "Both spread or hide the refresh so nobody waits on it. You want more than one stampede fix." },
    { term: "Cache penetration", plain: "Requests for keys that exist nowhere. Each misses, finds nothing and caches nothing, so the next identical request does it all again.", why: "It's a cheap amplification attack. Cache the negative result briefly, or put a <b>Bloom filter</b> of existing keys in front (\"definitely not present\" in constant time)." },
    { term: "Hot key", plain: "One key gets a huge share of traffic, and that key lives on one Redis node.", why: "Adding cluster nodes doesn't help. A 1–5 s in-process cache, or splitting the key into <code>key:goku:0..9</code>, spreads or removes the load." },
    { term: "Consistent hashing", plain: "Nodes and keys sit on a ring; each key belongs to the next node clockwise. Virtual nodes (~150 per node) keep it even.", why: "With <code>hash % N</code>, losing a node remaps nearly everything, invalidating your cache just as a node dies. The ring moves only <code>1/N</code>." },
    { term: "Versioned keys", plain: "Bump a version in the key (<code>user:{id}:v{n}</code>) instead of deleting. Old entries become unreachable and expire on their own.", why: "No delete and no race, and it works across several caches and CDN layers at once." },
  ],
  numbers: [
    { value: "200 → 1", label: "Queries for one expired key", note: "Singleflight in Step 2, in one process." },
    { value: "10 replicas", label: "= 10 queries, not 1", note: "Still a 20× improvement over 200." },
    { value: "~26% vs ~75%", label: "Keys moved losing 1 of 4 nodes", note: "Ring vs modulo. The reference test printed 25.8% and 74.9%." },
    { value: "30 s", label: "Negative-cache TTL", note: "Short, so a newly created record appears quickly." },
    { value: "1–5 s", label: "Hot-key local cache", note: "Bounded, explicit staleness in exchange for no network hop." },
  ],
  traps: [
    { myth: "It worked in staging, so the cache is fine.", truth: "Stampedes, hot keys and avalanches only appear under concurrency and peak load. Test cache behaviour with parallel requests, not a single-threaded test." },
    { myth: "Singleflight solves the stampede everywhere.", truth: "It's per process. With 50 replicas, 50,000 misses become 50 queries. Usually enough; if not, add a distributed lock with a TTL, stale-while-revalidate, or proactive refresh." },
    { myth: "A miss for a missing record is harmless.", truth: "Uncached misses are exactly how an attacker bypasses the cache: random ids, every one reaching the database. Negative-cache them, and validate impossible id formats." },
    { myth: "A hot key is solved by adding Redis nodes.", truth: "The key still lives on one node. Absorb it in process, or split it across several keys." },
    { myth: "We invalidate explicitly on every write, so we're never stale.", truth: "Batch jobs, admin tools, migrations and another team's service bypass your invalidation. It's also racy: a reader can repopulate the old value between the write and the delete." },
  ],
  gcp: [
    { service: "Memorystore Redis Cluster", role: "Shards with consistent hashing internally, so you get the property without writing a ring. A hot key still lives on one shard." },
    { service: "Cloud CDN request coalescing", role: "Collapses concurrent misses for the same object into one origin fetch: singleflight, one layer up (Capsule 16)." },
    { service: "Cloud Armor rate limiting", role: "The defence against deliberate penetration: random-id probing is rate-limited before it reaches your origin." },
    { service: "<code>stale-while-revalidate</code> on Cloud CDN", role: "A standard <code>Cache-Control</code> directive Cloud CDN honours. The HTTP version of serving stale while refreshing, for free." },
  ],
  takeaways: [
    "Singleflight every expensive cache miss.",
    "Jitter every TTL. No exceptions.",
    "Negative-cache misses with a short TTL. It's also a security control.",
    "Know your hot keys, and put a 1-second local cache in front of them.",
    "Use consistent hashing for any client-side sharding.",
    "Version cache keys so a schema change is a prefix bump.",
    "Serve stale rather than fail for read-heavy public data.",
  ],
  drill: [
    { q: "Every day at exactly 14:00 the database CPU hits 100% for 90 seconds. Why?", a: [
      "Synchronised expiry. Something fills a large set of keys at the same moment every day (a batch job, a warm-up, a deploy) with an identical TTL. They expire together and the stampede lands as one spike. Confirm by correlating the spike with the miss rate and with whatever runs at 14:00 minus the TTL.",
      "Fix in layers: jitter the TTLs, singleflight concurrent misses, stale-while-revalidate so users never wait, and refresh proactively before expiry.",
    ] },
    { q: "Singleflight works per process and you have 50 replicas. What now?", a: [
      "It already turns 50,000 concurrent misses into 50, a 1000× win. Ship it and measure first.",
      "If 50 is still too many: a distributed lock (<code>SET lock:{key} {id} NX PX 5000</code>, which must have a TTL or a crashed holder blocks forever); soft and hard TTLs so one instance refreshes while everyone else gets stale instantly; or a background job that keeps known-hot keys warm, the most robust option for a small set.",
    ] },
    { q: "What is cache penetration and why is it a security issue?", a: [
      "Requests for keys that exist nowhere: each misses, queries the database, finds nothing and caches nothing. An attacker requesting <code>/users/{random}</code> bypasses the cache by construction and turns 100 database QPS into 10,000.",
      "Defences: negative caching with a short TTL, a Bloom filter of valid ids, rejecting impossible id formats, and per-client rate limiting (Capsule 17).",
    ] },
    { q: "Compare TTL-only, explicit invalidation and versioned keys.", a: [
      "TTL-only is simple and always eventually correct, but stale up to the TTL. Fine more often than people think. Explicit invalidation is fresh immediately but only if you find every write path, and it races. Versioned keys avoid deletes and races and work across layers, at the cost of storing the version somewhere fast.",
      "Real systems combine them: versioned keys with a TTL backstop, plus event-driven invalidation (CDC, Capsule 21) for writers you don't control.",
    ] },
    { q: "A live scoreboard: 1M concurrent viewers, scores change every ~30 s. Where do you cache?", a: [
      "One hot key, huge read fan-out, tiny write rate, so solve it at the edge: a CDN with a 5 s TTL and <code>stale-while-revalidate</code> does nearly all the work. Add a 1 s in-process cache on each origin, Redis holding the rendered payload updated on score change, and singleflight plus a lock so a CDN flush can't stampede.",
      "Push rather than poll for the last mile, and state the 5-second staleness budget explicitly.",
    ] },
  ],
  connects: {
    back: "Capsule 14 built the cache-aside decorator this capsule stress-tests, and its TTL jitter is the first avalanche defence. The 1-second local cache is Capsule 06's per-replica state trap, made safe by a tiny, explicit TTL.",
    forward: "Capsule 16 does the same coalescing and stale-serving at the edge with HTTP headers and nginx. Capsule 17 adds rate limiting against deliberate penetration and wraps this cache in a circuit breaker. Capsule 21's change events are the strongest invalidation strategy listed here.",
  },
});

GA.recap({
  id: "16",
  tagline: "Most of the latency a distant user feels is the speed of light, not your handler. A CDN removes the trip, and <code>Cache-Control</code> is how you tell it what it may keep.",
  built: "You gave <code>/leaderboard</code> a strong <b>ETag</b> and a full <code>Cache-Control</code> header and watched curl get a bodyless <b>304</b>. Then you ran nginx as a local CDN edge: MISS then HIT, an artificial 150 ms origin delay that only the miss pays, stale responses while the origin was <b>down</b>, 50 cold concurrent requests coalesced by <code>proxy_cache_lock</code>, and the <code>$uri</code> vs <code>$request_uri</code> cache-key bug serving the wrong response.",
  story: [
    "Every optimisation so far made the server faster. None of them touched the speed of light. A round trip from Sydney to <code>us-central1</code> is ~160 ms, and a page needs several. Shave 40 ms off your handler and that user won't notice.",
    "A CDN is a set of caching reverse proxies near your users. A hit never reaches your origin. Even a miss gains, because TCP and TLS terminate at the nearby POP and the long haul runs on the provider's backbone. That's why a CDN helps <b>even for content you can't cache</b>.",
    "The CDN only does what your headers allow. <code>public</code>, <code>s-maxage</code> and <code>stale-while-revalidate</code> make expiry invisible; <code>stale-if-error</code> makes an origin outage invisible; an <b>ETag</b> turns a re-download into a headers-only 304. Content-hashed filenames make invalidation unnecessary.",
    "The danger is the <b>cache key</b>. Anything that changes the response but not the key gets served to the wrong user. When the difference is a user id, that isn't a slow page; it's a data breach.",
  ],
  diagrams: [
    {
      title: "Where the time goes: a miss vs a hit",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="A Sydney user reaches a Sydney POP in 2 ms. On a miss the POP calls the us-central1 origin, 160 ms away. Stacked bars: a miss totals 315 ms, a hit 35 ms">
  <rect class="box" x="20" y="16" width="120" height="40" rx="10"/><text x="80" y="36">Sydney user</text>
  <rect class="box hot" x="230" y="16" width="130" height="40" rx="10"/><text x="295" y="36">Sydney POP</text>
  <rect class="box energy" x="470" y="16" width="150" height="40" rx="10"/><text class="sm" x="545" y="36">us-central1 origin</text>
  <line class="wire" x1="142" y1="36" x2="226" y2="36"/><text class="sm" x="184" y="24">2 ms</text>
  <line class="wire dash" x1="362" y1="36" x2="466" y2="36"/><text class="sm" x="414" y="24">MISS: 160 ms</text>
  <text class="sm good" x="295" y="74">HIT: answered here</text>
  <text class="b start" x="20" y="110">MISS · 315 ms</text>
  <rect class="box cool" x="20" y="122" width="142" height="34" rx="8"/><text class="sm" x="91" y="139">setup 80</text>
  <rect class="box dim" x="162" y="122" width="9" height="34" rx="3"/>
  <rect class="box warn" x="171" y="122" width="284" height="34" rx="8"/><text class="sm" x="313" y="139">CDN → origin 160</text>
  <rect class="box hot" x="455" y="122" width="71" height="34" rx="8"/><text class="sm" x="490" y="139">app 40</text>
  <rect class="box ok" x="526" y="122" width="54" height="34" rx="8"/><text class="sm" x="553" y="139">30</text>
  <text class="b start" x="20" y="196">HIT · 35 ms</text>
  <rect class="box dim" x="20" y="208" width="9" height="34" rx="3"/>
  <rect class="box ok" x="29" y="208" width="54" height="34" rx="8"/><text class="sm" x="56" y="225">30</text>
  <text class="sm good start" x="96" y="225">about 9× faster than any origin response</text>
  <text class="xs mute start" x="20" y="268">ms · setup = DNS 20 + TCP 30 + TLS 30, done at the POP with a CDN · thin bar = 5 ms to the CDN · 30 = transfer</text>
</svg>`,
      caption: "The capsule's latency budget, drawn to scale. No backend optimisation competes with not making the 160 ms trip. Connection setup moving to the POP is also why uncacheable requests get faster through a CDN.",
    },
    {
      title: "ETag revalidation: a 304 has no body",
      svg: `<svg class="dg" viewBox="0 0 640 280" role="img" aria-label="Sequence: client GETs leaderboard, origin returns 200 with an ETag and the body. After max-age passes the client sends If-None-Match with the ETag and gets 304 Not Modified with no body">
  <rect class="box" x="40" y="10" width="150" height="40" rx="10"/><text x="115" y="30">Client or edge</text>
  <rect class="box energy" x="400" y="10" width="140" height="40" rx="10"/><text x="470" y="30">Origin</text>
  <line class="wire none soft" x1="115" y1="50" x2="115" y2="272" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="470" y1="50" x2="470" y2="272" stroke-dasharray="3 5"/>
  <line class="wire" x1="117" y1="88" x2="466" y2="88"/><text class="sm" x="292" y="76">GET /leaderboard</text>
  <line class="wire dash" x1="468" y1="124" x2="119" y2="124"/><text class="sm" x="292" y="112">200 OK · ETag: "a1b2c3" · full body</text>
  <text class="sm mute" x="292" y="158">… max-age passes; the copy is stale …</text>
  <line class="wire" x1="117" y1="200" x2="466" y2="200"/><text class="sm mono" x="292" y="188">If-None-Match: "a1b2c3"</text>
  <line class="wire good dash" x1="468" y1="240" x2="119" y2="240"/><text class="sm good" x="292" y="228">304 Not Modified · headers only</text>
  <text class="xs mute start" x="482" y="124">hash of the body</text>
  <text class="xs mute start" x="482" y="232">body still built</text>
  <text class="xs mute start" x="482" y="248">to hash, not sent</text>
</svg>`,
      caption: "For a 500 KB JSON payload, every revalidation saves 500 KB. The lab's handler builds and hashes the body before comparing, so a 304 saves the transfer, not the origin's work. Don't put a timestamp in the ETag, or it never matches.",
    },
    {
      title: "One header, three windows at the edge",
      svg: `<svg class="dg" viewBox="0 0 640 230" role="img" aria-label="Timeline for the CDN copy of leaderboard: fresh for 30 seconds, then served stale while revalidating until 90 seconds, then served stale only if the origin errors until 330 seconds">
  <text class="sm mono start" x="20" y="22">public, max-age=10, s-maxage=30, stale-while-revalidate=60, stale-if-error=300</text>
  <text class="sm start" x="20" y="65">CDN</text>
  <rect class="box ok" x="80" y="46" width="130" height="38" rx="8"/><text class="sm" x="145" y="65">fresh: HIT</text>
  <rect class="box hot" x="210" y="46" width="180" height="38" rx="8"/><text class="sm" x="300" y="58">stale served now,</text><text class="xs" x="300" y="75">refreshed in background</text>
  <rect class="box dim" x="390" y="46" width="230" height="38" rx="8"/><text class="sm" x="505" y="65">stale only if origin errors</text>
  <text class="sm start" x="20" y="131">Browser</text>
  <rect class="box ok" x="80" y="112" width="60" height="38" rx="8"/><text class="sm" x="110" y="131">fresh</text>
  <text class="sm start" x="150" y="131">then asks again with its ETag: ideally a 304</text>
  <line class="axis" x1="80" y1="176" x2="620" y2="176"/>
  <line class="axis" x1="80" y1="170" x2="80" y2="182"/><text class="xs" x="80" y="196">0 s</text>
  <line class="axis" x1="140" y1="170" x2="140" y2="182"/><text class="xs" x="140" y="196">10</text>
  <line class="axis" x1="210" y1="170" x2="210" y2="182"/><text class="xs" x="210" y="196">30</text>
  <line class="axis" x1="390" y1="170" x2="390" y2="182"/><text class="xs" x="390" y="196">90</text>
  <line class="axis" x1="620" y1="170" x2="620" y2="182"/><text class="xs" x="620" y="196">330</text>
  <text class="xs mute" x="350" y="220">seconds since the response was cached · not to scale</text>
</svg>`,
      caption: "<code>s-maxage</code> overrides <code>max-age</code> at the shared cache, because the CDN serves many users. Inside the stale-while-revalidate window nobody waits for a refresh. In Step 4 you killed the origin and the edge still answered 200.",
    },
    {
      title: "The cache-key bug: $uri drops the query string",
      svg: `<svg class="dg" viewBox="0 0 640 240" role="img" aria-label="Left: with request_uri, limit=3 and limit=50 get separate cache entries and correct results. Right: with uri, both share one entry and limit=50 gets 3 rows">
  <rect class="zone" x="8" y="8" width="304" height="224" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="224" rx="12"/>
  <text class="b mono" x="160" y="30">$request_uri</text>
  <text class="b mono bad" x="480" y="30">$uri</text>
  <rect class="box" x="24" y="50" width="128" height="32" rx="8"/><text class="sm mono" x="88" y="66">?limit=3</text>
  <rect class="box" x="168" y="50" width="128" height="32" rx="8"/><text class="sm mono" x="232" y="66">?limit=50</text>
  <rect class="box cool" x="24" y="124" width="128" height="32" rx="8"/><text class="xs mono" x="88" y="140">…board?limit=3</text>
  <rect class="box cool" x="168" y="124" width="128" height="32" rx="8"/><text class="xs mono" x="232" y="140">…board?limit=50</text>
  <line class="wire" x1="88" y1="84" x2="88" y2="120"/>
  <line class="wire" x1="232" y1="84" x2="232" y2="120"/>
  <text class="sm mute" x="160" y="104">two keys</text>
  <text class="b good" x="88" y="186">3 rows</text>
  <text class="b good" x="232" y="186">50 rows</text>
  <rect class="box" x="344" y="50" width="128" height="32" rx="8"/><text class="sm mono" x="408" y="66">?limit=3</text>
  <rect class="box" x="488" y="50" width="128" height="32" rx="8"/><text class="sm mono" x="552" y="66">?limit=50</text>
  <rect class="box warn" x="400" y="124" width="160" height="32" rx="8"/><text class="sm mono" x="480" y="140">/leaderboard</text>
  <line class="wire" x1="408" y1="84" x2="450" y2="120"/>
  <line class="wire bad" x1="552" y1="84" x2="510" y2="120"/>
  <text class="sm mute" x="480" y="104">one key</text>
  <text class="b good" x="408" y="186">3 rows</text>
  <text class="b bad" x="552" y="186">3 rows</text>
  <text class="sm bad" x="480" y="212">two requests, one cache entry</text>
</svg>`,
      caption: "One character in the nginx config. Now imagine the difference was <code>?user_id=</code> instead of <code>?limit=</code>: that's how a CDN misconfiguration becomes a breach. Keep cookies and auth headers out of the key, and mark anything personalised <code>private</code> or <code>no-store</code>.",
    },
  ],
  concepts: [
    { term: "CDN / POP", plain: "A globally distributed set of caching reverse proxies (points of presence) between your users and your origin.", why: "Hits skip the origin entirely (~5 ms instead of ~160 ms). It also absorbs DDoS traffic at the edge." },
    { term: "Cache-Control directives", plain: "<code>public</code>: any cache may store it. <code>private</code>: browser only. <code>no-store</code>: never store. <code>no-cache</code>: store, but always revalidate. <code>s-maxage</code>: freshness for shared caches only.", why: "No header means every cache guesses, and their guesses differ. <code>no-cache</code> is badly named; it doesn't mean \"don't cache\"." },
    { term: "stale-while-revalidate / stale-if-error", plain: "Serve the stale copy past expiry while refreshing in the background; serve it while the origin is failing.", why: "The first makes expiry invisible to users, Capsule 15's pattern as one header. The second turns an origin outage into something users can't see." },
    { term: "ETag and 304", plain: "A validator, usually a hash of the body. The client sends <code>If-None-Match</code>; if it matches, the origin answers 304 with no body.", why: "Revalidation costs headers only. <code>Last-Modified</code> has one-second granularity, so prefer ETag." },
    { term: "Immutable assets", plain: "Put a content hash in the filename (<code>app.a1b2c3d4.js</code>) and cache it for a year with <code>immutable</code>. Keep the HTML short-lived.", why: "The URL is the version, so invalidation becomes unnecessary. A deploy is a new filename." },
    { term: "Cache key and Vary", plain: "By default the key is the full URL. <code>Vary</code> adds headers to it. Anything else that changes the response gets served to the wrong user.", why: "<code>Vary: Cookie</code> makes one entry per cookie, so hit ratio goes to zero. Strip <code>utm_source</code>/<code>fbclid</code> from the key." },
    { term: "Version, don't purge", plain: "Purging is slow (seconds to minutes), rate-limited, sometimes expensive and eventually consistent across hundreds of POPs.", why: "Rename instead. Keep purges for emergencies: a leaked document, wrong pricing, a legal takedown." },
  ],
  numbers: [
    { value: "~160 ms", label: "Sydney → us-central1 round trip", note: "Several of these per page, before your code runs." },
    { value: "315 vs 35 ms", label: "Miss vs hit, end to end", note: "About 9×. The 80 ms connection setup happens at the POP." },
    { value: "500 KB", label: "Saved per 304", note: "For a 500 KB JSON payload; a 304 is headers only." },
    { value: "31536000", label: "max-age for hashed assets", note: "One year, plus <code>immutable</code>." },
    { value: "~$18 / mo", label: "Global external Application LB", note: "Cloud CDN needs one, so the GCP part is concept only." },
  ],
  traps: [
    { myth: "A CDN only helps cacheable content.", truth: "TCP and TLS terminate at the POP (2 ms round trips instead of 80+), and the origin fetch runs on the provider's backbone with pooled connections. Dynamic content gets faster too." },
    { myth: "<code>no-cache</code> means don't cache.", truth: "It means store but always revalidate. <code>no-store</code> is \"never store\"." },
    { myth: "Purge the CDN after every deploy.", truth: "Purges are slow, rate-limited and eventually consistent. Use hashed filenames and versioned URLs; keep purging for emergencies." },
    { myth: "<code>FORCE_CACHE_ALL</code> will boost the hit ratio.", truth: "It caches everything regardless of headers, including authenticated responses. Use <code>USE_ORIGIN_HEADERS</code> so policy lives in the code that knows what the data means." },
    { myth: "A low hit ratio means the CDN is broken.", truth: "Look for key fragmentation (tracking params, session ids), <code>Vary: Cookie</code>, TTLs shorter than the request interval, or <code>private</code> applied too broadly. Some content is genuinely personalised; then cache the shell." },
  ],
  gcp: [
    { service: "Cloud CDN", role: "<code>enable_cdn = true</code> on a backend service behind a global external Application Load Balancer. <code>cache_mode = USE_ORIGIN_HEADERS</code> obeys your <code>Cache-Control</code>; <code>serve_while_stale</code> is stale-if-error; <code>negative_caching</code> caches 404s briefly." },
    { service: "Cloud CDN cache key policy", role: "Include only the query params that change the response (<code>query_string_whitelist = [\"limit\", \"page\"]</code>) so tracking params don't fragment the cache." },
    { service: "Cloud Storage + Cloud CDN", role: "Static assets with hashed filenames and <code>public, max-age=31536000, immutable</code>." },
    { service: "Cloud Armor", role: "WAF, DDoS protection, geo/IP rules and edge rate limiting (Capsule 17), attached to the same backend service." },
    { service: "Media CDN", role: "A separate, higher-scale product for video streaming." },
    { service: "<code>gcloud compute url-maps invalidate-cdn-cache</code>", role: "Purges a path. Takes minutes, is rate-limited, and is a last resort. Version instead." },
  ],
  takeaways: [
    "Set <code>Cache-Control</code> deliberately on every response.",
    "Put <code>stale-while-revalidate</code> and <code>stale-if-error</code> on all public GETs.",
    "Hash static asset filenames and cache them for a year, <code>immutable</code>.",
    "Add ETags to JSON endpoints; 304s are nearly free.",
    "Audit the cache key: whitelist query params, never include cookies, never cache authenticated responses under a shared key.",
    "Anything personalised is <code>private</code> or <code>no-store</code>. When unsure, don't cache.",
    "Version, don't purge. Measure origin offload.",
  ],
  drill: [
    { q: "Users report seeing other users' data the day after the CDN went live. What happened?", a: [
      "A personalised response was cached under a shared key: it lacked <code>private</code>, the key omitted the session cookie, auth header or user id, or the CDN was on <code>FORCE_CACHE_ALL</code>.",
      "Purge everything, switch to <code>USE_ORIGIN_HEADERS</code>, add <code>private, no-store</code> to authenticated responses, and verify by curling as two users through the CDN. It's a security incident with disclosure implications. Prevent it by defaulting to <code>no-store</code> and opting in per endpoint, with an integration test that fetches as two users.",
    ] },
    { q: "Your CDN hit ratio is 12%. Where do you look?", a: [
      "Key fragmentation from tracking params and session ids, <code>Vary: Cookie</code>, TTLs too short for how often a URL is requested, <code>private</code>/<code>no-store</code> applied too broadly, genuinely personalised content, or a long tail of rare URLs.",
      "Group CDN logs by cache status and by URL pattern. The answer is almost always concentrated in one or two patterns.",
    ] },
    { q: "Why does a CDN help even for content that can't be cached?", a: [
      "Connection setup is 2–3 round trips. At 80 ms per RTT that's ~240 ms; at 2 ms to the POP it's ~6 ms. Then the origin fetch runs on the provider's private backbone with warm, pooled connections. You also get modern TLS, DDoS absorption and WAF filtering at the edge.",
    ] },
    { q: "Explain <code>stale-while-revalidate</code> to a PM.", a: [
      "Without it, the first user after expiry waits for the full origin trip, so a few random users get a slow page. With it, they get the slightly old version instantly and the refresh happens in the background.",
      "The cost is staleness of up to N seconds. The question back to the PM is the right one: \"how stale is acceptable here?\" That's a product decision with a number.",
    ] },
    { q: "Cache a news site: articles rarely change, the homepage changes often, some content is paywalled.", a: [
      "Segment by type. Hashed static assets: a year, <code>immutable</code>. Articles: <code>public, s-maxage=3600, stale-while-revalidate=86400</code>. Homepage: <code>public, s-maxage=60, stale-while-revalidate=300</code>.",
      "Paywalled content: cache the article shell publicly and fetch the body with the user's credentials. Load \"for you\" sections client-side. Split the page into a cacheable shell and personalised fragments rather than making the whole page uncacheable.",
    ] },
  ],
  connects: {
    back: "Capsule 14's \"never cache personalised data under a shared key\" is the CDN's worst failure. Capsule 15's singleflight and stale-while-revalidate come back as <code>proxy_cache_lock</code> and one <code>Cache-Control</code> directive.",
    forward: "Capsule 17 moves from faster to surviving: Cloud Armor's edge rate limiting attaches to the same backend service, and <code>Retry-After</code> joins the headers clients must respect.",
  },
});

GA.recap({
  id: "17",
  tagline: "Systems rarely fail by being slow. They fail by cascading. Timeouts, breakers, rate limits and shedding all exist to break that chain, and slow is worse than down.",
  built: "You added a per-caller <b>token bucket</b> (<code>NewLimiter(50, 100)</code>) that answers 429 with <code>Retry-After</code>, a <code>/slow</code> endpoint that abandons work when <code>curl -m 1</code> gives up, a <b>circuit breaker</b> with tests, wrapped around the Redis read in <code>latestFromRedisOrDB</code>, a <b>retry</b> helper with full jitter that stops at the caller's deadline, and a <b>shedder</b> that rejects with 503 past a fixed number of in-flight requests. Then you paused Postgres under k6 to watch a cascade.",
  story: [
    "Everything so far made the system faster. This capsule makes it <b>survive</b>. Failure usually spreads: one slow dependency fills a connection pool, its callers slow down and fill theirs, until nothing works and no single part looks broken.",
    "The first rule is that <b>slow is worse than down</b>. An instant error is fine: fail fast, return a fallback. A 30-second wait holds a goroutine, a connection and memory, and you die of exhaustion doing no work. So timeouts come first, and they must be inherited from the caller's deadline.",
    "On top sit the mechanisms that bound the pattern. A circuit breaker stops you paying the timeout on every call to something clearly dead. Retries need full jitter, a budget and idempotency, or they multiply load at the worst moment. A token bucket allows a short burst and caps sustained load per caller.",
    "When you still can't keep up, you queue (bounded only), shed or degrade. Shedding isn't defeat. A service that serves what it can and rejects the rest quickly is healthy; one that accepts everything and times out on all of it serves nobody.",
  ],
  diagrams: [
    {
      title: "Token bucket: a burst, then the sustained rate",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Tokens in one caller's bucket over time. Starts at 100, drains as 120 rapid requests arrive, sits near zero returning 429s, refills at 50 per second during a 2 second sleep, caps at 100, then 20 more requests all pass">
  <text class="b start" x="20" y="20">Tokens in one caller's bucket · NewLimiter(50, 100)</text>
  <line class="axis" x1="70" y1="240" x2="620" y2="240"/>
  <line class="axis" x1="70" y1="40" x2="70" y2="240"/>
  <text class="xs end" x="62" y="50">100</text>
  <text class="xs end" x="62" y="236">0</text>
  <line class="wire none soft dash" x1="70" y1="50" x2="620" y2="50"/>
  <polyline class="line" points="74,50 180,236 250,236 450,50 510,50 535,87 620,87"/>
  <text class="xs" x="125" y="258">~100 pass (burst)</text>
  <text class="xs bad" x="215" y="222">429s</text>
  <text class="xs" x="350" y="258">sleep 2 s: +50 / s</text>
  <text class="xs" x="480" y="38">capped at 100</text>
  <text class="xs good" x="575" y="258">20 more: all 200</text>
  <text class="xs mute" x="345" y="280">time · shape illustrative</text>
</svg>`,
      caption: "Burst is how much slack a caller gets; rate is the sustained limit. Step 1's 120 back-to-back requests: about 100 pass, then roughly 50 a second, the rest 429. After 2 s the bucket is full again. Every 429 carries <code>Retry-After</code> so clients know when to come back.",
    },
    {
      title: "Deadlines shrink at every hop",
      svg: `<svg class="dg" viewBox="0 0 640 320" role="img" aria-label="Budget bars: gateway 5 seconds, service A 4, service B 2, database 1. Below: a handler that respects the context stops at 1 second when the client leaves; one that ignores it works until 3 seconds">
  <text class="sm start" x="20" y="45">gateway</text>
  <rect class="box cool" x="140" y="32" width="440" height="26" rx="8"/><text class="sm" x="360" y="45">5 s</text>
  <text class="sm start" x="20" y="81">service A</text>
  <rect class="box cool" x="140" y="68" width="352" height="26" rx="8"/><text class="sm" x="316" y="81">4 s</text>
  <text class="sm start" x="20" y="117">service B</text>
  <rect class="box cool" x="140" y="104" width="176" height="26" rx="8"/><text class="sm" x="228" y="117">2 s</text>
  <text class="sm start" x="20" y="153">database</text>
  <rect class="box cool" x="140" y="140" width="88" height="26" rx="8"/><text class="sm" x="184" y="153">1 s</text>
  <text class="xs mute start" x="340" y="153">budget gone? don't start the next call</text>
  <text class="b start" x="20" y="204">curl -m 1 /slow (the work takes 3 s)</text>
  <text class="sm start" x="20" y="237">ignores ctx</text>
  <rect class="box warn" x="140" y="224" width="264" height="26" rx="8"/><text class="sm" x="316" y="237">work for nobody</text>
  <text class="sm start" x="20" y="277">respects ctx</text>
  <rect class="box ok" x="140" y="264" width="88" height="26" rx="8"/><text class="xs" x="184" y="277">1 s, stop</text>
  <line class="wire none bad dash" x1="228" y1="214" x2="228" y2="300"/>
  <text class="xs bad halo" x="228" y="310">client gives up</text>
  <text class="xs good start" x="240" y="277">r.Context().Done() fired: abandon work</text>
</svg>`,
      caption: "Each hop gets less than its caller, and in Go that budget travels in <code>context.Context</code>. The anti-pattern is a fixed timeout per service: the client gave up long ago and you're still querying for it. Under load, that wasted work is what kills you.",
    },
    {
      title: "Retries without jitter arrive in waves",
      svg: `<svg class="dg" viewBox="0 0 640 256" role="img" aria-label="Two timelines of the same retries. Without jitter they stack at the same instants, 1, 3 and 7 seconds after the failure. With full jitter they are scattered across the whole period">
  <text class="b start" x="20" y="78">no jitter</text>
  <text class="b start" x="20" y="172">full jitter</text>
  <circle class="dot bad" cx="191" cy="50" r="4"/><circle class="dot bad" cx="191" cy="62" r="4"/><circle class="dot bad" cx="191" cy="74" r="4"/><circle class="dot bad" cx="191" cy="86" r="4"/><circle class="dot bad" cx="191" cy="98" r="4"/><circle class="dot bad" cx="191" cy="110" r="4"/>
  <circle class="dot bad" cx="314" cy="50" r="4"/><circle class="dot bad" cx="314" cy="62" r="4"/><circle class="dot bad" cx="314" cy="74" r="4"/><circle class="dot bad" cx="314" cy="86" r="4"/><circle class="dot bad" cx="314" cy="98" r="4"/><circle class="dot bad" cx="314" cy="110" r="4"/>
  <circle class="dot bad" cx="559" cy="50" r="4"/><circle class="dot bad" cx="559" cy="62" r="4"/><circle class="dot bad" cx="559" cy="74" r="4"/><circle class="dot bad" cx="559" cy="86" r="4"/><circle class="dot bad" cx="559" cy="98" r="4"/><circle class="dot bad" cx="559" cy="110" r="4"/>
  <text class="xs bad" x="191" y="34">+1 s</text><text class="xs bad" x="314" y="34">+2 s</text><text class="xs bad" x="559" y="34">+4 s</text>
  <text class="xs bad" x="436" y="80">every client at once</text>
  <circle class="dot good" cx="142" cy="160" r="4"/><circle class="dot good" cx="161" cy="185" r="4"/><circle class="dot good" cx="179" cy="172" r="4"/>
  <circle class="dot good" cx="197" cy="158" r="4"/><circle class="dot good" cx="216" cy="190" r="4"/><circle class="dot good" cx="234" cy="168" r="4"/>
  <circle class="dot good" cx="259" cy="182" r="4"/><circle class="dot good" cx="289" cy="160" r="4"/><circle class="dot good" cx="314" cy="176" r="4"/>
  <circle class="dot good" cx="332" cy="190" r="4"/><circle class="dot good" cx="369" cy="164" r="4"/><circle class="dot good" cx="400" cy="184" r="4"/>
  <circle class="dot good" cx="424" cy="158" r="4"/><circle class="dot good" cx="455" cy="178" r="4"/><circle class="dot good" cx="491" cy="166" r="4"/>
  <circle class="dot good" cx="522" cy="188" r="4"/><circle class="dot good" cx="553" cy="162" r="4"/><circle class="dot good" cx="590" cy="180" r="4"/>
  <line class="axis" x1="130" y1="214" x2="620" y2="214"/>
  <text class="xs mute" x="130" y="230">0</text><text class="xs mute" x="191" y="230">1</text><text class="xs mute" x="314" y="230">3</text><text class="xs mute" x="559" y="230">7 s</text>
  <text class="xs mute" x="375" y="250">time after a shared failure · 6 clients, 3 retries each</text>
</svg>`,
      caption: "Same clients, same number of retries. Exponential backoff alone (1 s, 2 s, 4 s) keeps them in lockstep, a self-inflicted DDoS just as the dependency tries to recover. Full jitter sleeps <code>rand(0, base·2^n)</code>, capped by <code>MaxDelay</code>, and stops when the caller's context is done.",
    },
    {
      title: "Circuit breaker states",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="State machine: closed goes to open after threshold consecutive failures; open goes to half-open after the cooldown; half-open closes after 3 consecutive successes or re-opens on any failure">
  <rect class="box ok" x="30" y="40" width="170" height="70" rx="10"/>
  <text class="b" x="115" y="64">CLOSED</text><text class="sm" x="115" y="88">calls go through</text>
  <rect class="box warn" x="440" y="40" width="170" height="70" rx="10"/>
  <text class="b" x="525" y="64">OPEN</text><text class="sm" x="525" y="88">fail instantly</text>
  <rect class="box cool" x="235" y="200" width="170" height="70" rx="10"/>
  <text class="b" x="320" y="224">HALF-OPEN</text><text class="sm" x="320" y="248">probe the dependency</text>
  <line class="wire bad" x1="202" y1="62" x2="436" y2="62"/>
  <text class="sm bad" x="319" y="50">threshold failures in a row</text>
  <text class="xs mute" x="319" y="80">a cache miss is not a failure</text>
  <line class="wire" x1="560" y1="112" x2="410" y2="222"/>
  <text class="sm start" x="500" y="176">cooldown passes</text>
  <line class="wire bad dash" x1="390" y1="198" x2="492" y2="114"/>
  <text class="sm bad end" x="428" y="146">any failure</text>
  <line class="wire good" x1="232" y1="222" x2="118" y2="114"/>
  <text class="sm good end" x="172" y="186">3 successes in a row</text>
  <text class="xs mute" x="320" y="292">open → ErrCircuitOpen with no timeout paid → treated as a cache miss → read Postgres</text>
</svg>`,
      caption: "The breaker protects <em>you</em>: an open circuit means no goroutines waiting on something that won't answer. Two catches from the lab. Count only real failures, or a cold cache trips it. And it guards only the Redis read; <code>Leaderboard</code> and the cache write-back still call Redis directly.",
    },
  ],
  concepts: [
    { term: "Slow is worse than down", plain: "An instant error lets you fail fast. A dependency that takes 30 s holds a goroutine, a connection and memory for every waiting request.", why: "Your pools fill with waiting work and you die of exhaustion. That's why timeouts are the foundation." },
    { term: "Deadline propagation", plain: "Every network call has a deadline inherited from its caller, each hop getting less. In Go it's <code>context.Context</code>, the first parameter of anything that does I/O.", why: "Without it you keep working for clients that already left. Respecting <code>r.Context().Done()</code> is most of what backpressure is." },
    { term: "Retries: jitter, budget, idempotency", plain: "Exponential backoff with full jitter; total retries capped (say 10% of requests); only idempotent operations; never a 4xx.", why: "Retries are a load multiplier applied at the worst moment. Without a budget, a service at 50% failure doubles its own load: a retry storm." },
    { term: "Circuit breaker", plain: "Closed counts failures; open fails immediately with a fallback; after a cooldown, half-open lets calls through to probe. Success closes it, failure re-opens it.", why: "A timeout bounds one request. A breaker bounds the pattern, so a dead dependency stops costing a full timeout on every call." },
    { term: "Token bucket", plain: "Tokens refill at rate R up to capacity B; each request takes one. <code>rate</code> sets the sustained limit, <code>burst</code> the slack.", why: "Real traffic is bursty and users expect a short burst to work. Fixed windows allow 2× at the boundary (Capsule 08)." },
    { term: "Queue, shed, degrade", plain: "Bound every queue; reject fast with 429/503 and <code>Retry-After</code>; or return a cheaper answer such as stale cache or fewer results.", why: "An unbounded queue is an out-of-memory crash with a delay. Drop background and retry traffic first, and never shed health checks." },
    { term: "Bulkheads", plain: "Separate pools per kind of work: reports=20, checkout=50, admin=10, spare=20.", why: "A slow endpoint saturates only its own share. With one shared pool, it takes checkout down too." },
  ],
  numbers: [
    { value: "50 / s, burst 100", label: "The lab's limiter", note: "120 back-to-back requests: ~100 pass, then ~50/s." },
    { value: "~10%", label: "Retry budget", note: "Retries must be a small, bounded fraction of traffic, never a multiplier." },
    { value: "50 ms → 5 s", label: "= 100× more in flight", note: "Same request rate, 100× the concurrent work (Little's Law)." },
    { value: "1,000 rps × 2 s", label: "= 2,000 doomed requests in flight", note: "Timeouts alone against a dead dependency. The breaker removes them." },
    { value: "300 s → ≤30 s", label: "Cloud Run request timeout", note: "Default vs what a user-facing service should use. Longer work belongs in an async job." },
  ],
  traps: [
    { myth: "A fixed timeout per service is enough.", truth: "Each hop must get less than its caller's remaining budget. Otherwise you keep querying for a client that gave up seconds ago." },
    { myth: "Retry failures and things will recover.", truth: "Without jitter, a budget and idempotency, retries keep a struggling dependency down: a metastable failure that outlives its trigger." },
    { myth: "Count every non-success as a breaker failure.", truth: "Count a cache miss and the breaker opens the first time the cache is cold. In the lab, <code>redis.Nil</code> returns <code>nil</code> inside <code>Do</code>, and you then track the miss explicitly so Capsule 14's counters stay right." },
    { myth: "Ten replicas, each limited to 100/s, means a 100/s limit.", truth: "It means 1,000/s. Use a shared counter in Redis for anything exact (billing, quotas), or accept and size the approximation." },
    { myth: "Rejecting requests at capacity is failure.", truth: "Accepting more doesn't complete more; it queues more, and everyone's latency climbs. Total successful requests is usually higher with shedding." },
  ],
  gcp: [
    { service: "Cloud Armor", role: "Rate limiting at the edge per IP, region or header (<code>rate_limit_options</code>, <code>enforce_on_key</code>). The cheapest place to shed abusive load." },
    { service: "API Gateway / Apigee", role: "Per-API-key quotas, the product-level version (Capsule 08)." },
    { service: "Cloud Run <code>--max-instances</code>", role: "Backpressure: past it, requests queue and then 429. It protects your database from your own autoscaler." },
    { service: "Cloud Run request timeout", role: "The outermost deadline (default 300 s, max 60 min). Set it to 30 s or less for user-facing services." },
    { service: "Cloud Tasks", role: "Managed retries with backoff, rate limiting and concurrency control." },
    { service: "GCP client libraries", role: "Built-in retry with backoff. Know the defaults: stacked retry layers multiply." },
  ],
  takeaways: [
    "A timeout on every network call, derived from the caller's deadline.",
    "Full jitter on every retry, plus a retry budget, plus idempotency. Never retry a 4xx.",
    "A circuit breaker on every external dependency, especially optional ones like caches.",
    "Bound every queue.",
    "Shed load deliberately, return <code>Retry-After</code>, and never shed health checks.",
    "Bulkhead your pools.",
    "Chaos-test it. An untested breaker is a hypothesis.",
  ],
  drill: [
    { q: "A downstream service slows from 50 ms to 5 s. Your service, which mostly doesn't use it, goes down. Explain the chain.", a: [
      "Requests that touch it hold their goroutine and connection 100× longer, so in-flight work grows 100× at the same rate. They exhaust a <em>shared</em> pool. Requests that don't touch the dependency now queue for that pool, so everything is slow. Health checks time out, the load balancer removes instances, the rest fail faster, and client retries double the load.",
      "Fixes: aggressive timeouts, a breaker, <b>bulkheads</b> (the shared pool is the critical link), load shedding, and liveness checks that don't depend on it.",
    ] },
    { q: "Why does a retry storm happen, and what stops it?", a: [
      "A dependency fails 30% of requests, every client retries, and offered load hits 130% just as capacity drops. More failures, more retries, and it stays broken after the trigger is gone.",
      "Retry budgets, circuit breakers, full jitter, server-side <code>Retry-After</code>, and fast rejection at the server. Retries must be a small, bounded fraction of traffic.",
    ] },
    { q: "Circuit breaker or timeout: why both?", a: [
      "A timeout bounds one request; a breaker bounds the pattern. With only timeouts, a dead dependency at 1,000 rps and a 2 s timeout keeps 2,000 doomed requests in flight forever. The breaker fails instantly, returns a fallback, and stops hammering a recovering dependency. Timeouts detect individual slowness; the breaker reacts to the aggregate.",
    ] },
    { q: "Design rate limiting for a public API with free and paid tiers.", a: [
      "A token bucket per API key with rate and burst from the plan, enforced in Redis rather than per replica. Layer per-key, per-endpoint and global limits; a request must pass all three. Return <code>X-RateLimit-*</code> and <code>Retry-After</code>, and push abusive anonymous traffic to Cloud Armor.",
      "Decide what happens when the limiter fails: fail open unless the limit is a hard billing constraint, then fail closed. Write it down.",
    ] },
    { q: "Your service is at 100% capacity. Argue for rejecting requests.", a: [
      "Past capacity, more accepted work just means more queued work: latency climbs for everyone, clients time out and retry, and you compute answers nobody receives. Rejecting immediately keeps accepted requests within SLO, tells rejected clients in 1 ms instead of 30 s, keeps memory flat and health checks passing.",
      "Shed retries and background work first, keep interactive requests, and never shed health checks.",
    ] },
  ],
  connects: {
    back: "Capsule 08's fixed-window limiter and gateway <code>X-Caller</code> header feed the token bucket. Capsule 14 promised a breaker so a dead Redis stops costing a timeout per request, and Capsule 15's split of <code>Latest</code> is why the breaker belongs in <code>latestFromRedisOrDB</code>.",
    forward: "Capsule 19 makes operations idempotent with a key, which is what makes retries safe. Capsule 20 turns work too long for a request timeout into async jobs. Capsule 18 starts the move from synchronous calls to messages.",
  },
});

GA.thread(3, [
  "The Frieza Saga is about latency, and it starts with the biggest lever: a cache. Capsule 14 gives you cache-aside and the lesson that matters most, that hit ratio isn't load reduction. Then Capsule 15 shows the cache turning on you under load: a stampede when a hot key expires, penetration by keys that don't exist, a hot key pinned to one node, and a cluster that loses nearly everything when one node dies. Each failure has a name and a specific fix: singleflight, negative caching, a one-second local cache, a consistent hash ring.",
  "Capsule 16 moves the cache to where most of the latency actually lives: the distance between the user and your origin. The same ideas come back as HTTP: <code>stale-while-revalidate</code> is serving stale, <code>proxy_cache_lock</code> is singleflight, an ETag makes revalidation nearly free. The cache key gains a new failure mode too, a breach rather than a slow page.",
  "Capsule 17 accepts that something will still be slow, and makes sure it can't take everything down with it. Deadlines that shrink at every hop, retries with jitter and a budget, a breaker that stops paying a timeout per request, and a shedder that rejects quickly instead of queueing. You leave the saga able to make a service fast, and keep it standing when a dependency isn't.",
]);
