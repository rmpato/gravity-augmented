// Saga 2 · Namek Saga — Data. Recaps for capsules 10–13.
// Source of truth: capsules/10-*/README.md … capsules/13-*/README.md.

GA.thread(2, [
  "Saga 1 ended with a service that scaled out but couldn't keep state: each replica remembered its own version of the truth. Capsule 10 moves that state into Postgres, and the service is stateless again. That is where the hard part starts. Data has to be correct, durable, consistent and available at once, and those goals pull against each other. The first things to break are not the database itself but how you talk to it: a connection pool that runs dry while Postgres sits idle, and an N+1 loop that turns one query into fifty-one.",
  "Then the database gets bigger. Capsule 11 shows that most \"the database is slow\" problems are a missing or misordered index, and that <code>EXPLAIN (ANALYZE, BUFFERS)</code> tells you which. Capsules 12 and 13 cover what's left once a single primary really is the limit. Partitioning and sharding split the data, and any query without the key has to touch every piece. Replication copies the data, and a copy can be behind. Each fix brings its own failure: hotspots and scatter-gather from sharding, stale reads and split-brain from replication.",
  "What the saga leaves you with is an order of operations: index, cache, add read replicas, scale up and partition, and only then shard. It also leaves you a habit. For every read, decide out loud how stale it is allowed to be. Saga 3 builds on exactly that: a cache is one more copy of the truth, with its own lag.",
]);

// ---------------------------------------------------------------------------

GA.recap({
  id: "10",
  tagline: "Moving state into a real database fixes the scaling bug, and it's where the hard problems start. The first two to bite are an exhausted connection pool and the N+1 query.",
  built: "You added Postgres 16 to compose with a health check, wrote a schema with real constraints and a <code>(fighter_id, recorded_at DESC)</code> index, and replaced <code>MemStore</code> with a <b>pgx-backed <code>PostgresStore</code></b> behind the same <code>Store</code> interface, so no handler changed. Readiness now pings the database. You scaled to 3 replicas and saw every replica see every write. Then you built a deliberate <b>N+1 leaderboard</b> and counted queries in the Postgres log (~51 vs ~1), and ran k6 with 100 VUs against a 10-connection pool to watch <b>pool exhaustion</b> happen.",
  story: [
    "Capsule 06 proved the Scouter was stateful and so couldn't scale. The fix is to move the state out of the process. Compute is easy: stateless, interchangeable, disposable. <b>Data is where the difficulty lives</b>, and every later capsule depends on decisions made here.",
    "Relational is the right default. You get schemas that catch bugs at write time, ACID transactions, joins, a query planner you'll rarely beat, and forty years of operational knowledge. \"SQL doesn't scale\" really means one primary doesn't scale writes past a point. That's real, and it's Capsules 12 and 13. Move off relational when you have a measurement, not a feeling.",
    "Isolation is the part of ACID you have to actually understand. Postgres defaults to <b>Read Committed</b>, so the same query inside one transaction can return different results if someone else commits in between. \"Read the balance, then write based on it\" is a lost update waiting to happen, and wrapping it in a transaction doesn't stop it.",
    "Most \"the site is slow\" incidents come from how you talk to the database. A Postgres connection is a whole OS process, so <b>fewer connections often means more throughput</b>, and <code>replicas × pool size</code> must stay well under <code>max_connections</code>. And an ORM's lazy loading quietly turns one query into N+1. You won't notice it locally, where a round trip is 0.1 ms, and it hurts in production, where it's 2 ms.",
  ],
  diagrams: [
    {
      title: "N+1: one query per row, in a loop",
      svg: `<svg class="dg" viewBox="0 0 640 262" role="img" aria-label="Left: the naive leaderboard makes one query for fighters and then one query per fighter, 51 round trips. Right: one JOIN with DISTINCT ON returns the same data in one round trip">
  <rect class="zone" x="8" y="8" width="304" height="246" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="246" rx="12"/>
  <text class="b" x="160" y="26">LeaderboardNaive</text>
  <text class="b" x="480" y="26">Leaderboard</text>
  <rect class="box hot" x="24" y="40" width="90" height="34" rx="8"/><text x="69" y="57">App</text>
  <rect class="box energy" x="200" y="40" width="100" height="34" rx="8"/><text x="250" y="57">Postgres</text>
  <line class="wire none soft" x1="69" y1="74" x2="69" y2="200" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="250" y1="74" x2="250" y2="200" stroke-dasharray="3 5"/>
  <line class="wire" x1="71" y1="96" x2="246" y2="96"/><text class="sm" x="160" y="86">① fighters LIMIT 50</text>
  <line class="wire dash" x1="248" y1="110" x2="73" y2="110"/>
  <line class="wire bad" x1="71" y1="128" x2="246" y2="128"/>
  <line class="wire bad" x1="71" y1="140" x2="246" y2="140"/>
  <line class="wire bad" x1="71" y1="152" x2="246" y2="152"/>
  <line class="wire bad" x1="71" y1="164" x2="246" y2="164"/>
  <text class="sm bad" x="160" y="186">② × 50, one per fighter</text>
  <text class="b bad" x="160" y="222">~51 round trips</text>
  <text class="sm" x="160" y="242">at 2 ms each ≈ 100 ms of waiting</text>
  <rect class="box hot" x="355" y="40" width="90" height="34" rx="8"/><text x="400" y="57">App</text>
  <rect class="box energy" x="520" y="40" width="100" height="34" rx="8"/><text x="570" y="57">Postgres</text>
  <line class="wire none soft" x1="400" y1="74" x2="400" y2="200" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="570" y1="74" x2="570" y2="200" stroke-dasharray="3 5"/>
  <line class="wire" x1="402" y1="96" x2="566" y2="96"/><text class="sm" x="485" y="86">① JOIN + DISTINCT ON</text>
  <line class="wire dash good" x1="568" y1="122" x2="404" y2="122"/><text class="sm good" x="485" y="136">all 50 rows</text>
  <text class="b good" x="480" y="222">~1 round trip</text>
  <text class="sm" x="480" y="242">same data, one query</text>
</svg>`,
      caption: "What you counted in Step 6, with <code>log_statement = 'all'</code>: about 51 <code>SELECT</code>s against about 1. On a laptop the gap is ~20 ms. Over a real network it's ~100 ms per request. The fix is a <code>JOIN</code>, one <code>WHERE id = ANY($1)</code>, or <code>DISTINCT ON</code> for \"top per group\".",
    },
    {
      title: "Pool exhaustion: slow app, bored database",
      svg: `<svg class="dg" viewBox="0 0 640 232" role="img" aria-label="k6 sends 100 concurrent users to the Scouter; requests queue inside the app waiting for one of 10 pooled connections; Postgres sees only 10 connections and low CPU">
  <rect class="box" x="10" y="80" width="100" height="60" rx="10"/><text x="60" y="102">k6</text><text class="sm" x="60" y="122">100 VUs</text>
  <line class="wire" x1="112" y1="110" x2="150" y2="110"/>
  <rect class="zone" x="156" y="20" width="294" height="176" rx="12"/>
  <text class="b" x="303" y="40">Scouter · pgxpool</text>
  <text class="sm" x="232" y="78">requests waiting</text>
  <rect class="box warn" x="168" y="96" width="12" height="30" rx="3"/>
  <rect class="box warn" x="184" y="96" width="12" height="30" rx="3"/>
  <rect class="box warn" x="200" y="96" width="12" height="30" rx="3"/>
  <rect class="box warn" x="216" y="96" width="12" height="30" rx="3"/>
  <rect class="box warn" x="232" y="96" width="12" height="30" rx="3"/>
  <rect class="box warn" x="248" y="96" width="12" height="30" rx="3"/>
  <rect class="box warn" x="264" y="96" width="12" height="30" rx="3"/>
  <rect class="box warn" x="280" y="96" width="12" height="30" rx="3"/>
  <text class="sm bad" x="232" y="150">latency builds here</text>
  <rect class="box ok" x="316" y="70" width="120" height="80" rx="10"/>
  <text x="376" y="100">pool 10/10</text><text class="sm" x="376" y="122">all checked out</text>
  <line class="wire" x1="438" y1="96" x2="496" y2="96"/>
  <line class="wire" x1="438" y1="110" x2="496" y2="110"/>
  <line class="wire" x1="438" y1="124" x2="496" y2="124"/>
  <rect class="box energy" x="500" y="70" width="130" height="80" rx="10"/>
  <text x="565" y="100">Postgres</text><text class="sm" x="565" y="122">CPU low</text>
  <text class="sm mute" x="565" y="168">10 connections</text>
  <text class="sm mute" x="320" y="220">High app latency + low database CPU = the pool is the bottleneck, not the database.</text>
</svg>`,
      caption: "In Step 7, <code>pg_stat_activity</code> shows connections pinned at <code>MaxConns</code> while requests queue in the app. The fix is never a huge pool. It's faster queries, timeouts so connections come back, a pooler, or fewer replicas.",
    },
    {
      title: "A lost update under Read Committed",
      svg: `<svg class="dg" viewBox="0 0 640 282" role="img" aria-label="Two requests both read balance 100, both write 70; the stored balance is 70 instead of 40">
  <text class="b" x="120" y="24">Request A</text>
  <text class="b" x="310" y="24">Request B</text>
  <text class="b" x="510" y="24">Stored balance</text>
  <line class="wire soft" x1="14" y1="44" x2="14" y2="200"/><text class="xs mute start" x="20" y="208">time</text>
  <rect class="box" x="30" y="44" width="180" height="30" rx="8"/><text class="sm" x="120" y="59">read balance → 100</text>
  <rect class="box dim" x="440" y="44" width="140" height="30" rx="8"/><text class="sm" x="510" y="59">100</text>
  <rect class="box" x="220" y="84" width="180" height="30" rx="8"/><text class="sm" x="310" y="99">read balance → 100</text>
  <rect class="box dim" x="440" y="84" width="140" height="30" rx="8"/><text class="sm" x="510" y="99">100</text>
  <rect class="box" x="30" y="124" width="180" height="30" rx="8"/><text class="sm" x="120" y="139">write 100 − 30 = 70</text>
  <rect class="box" x="440" y="124" width="140" height="30" rx="8"/><text class="sm" x="510" y="139">70</text>
  <rect class="box warn" x="220" y="164" width="180" height="30" rx="8"/><text class="sm" x="310" y="179">write 100 − 30 = 70</text>
  <rect class="box warn" x="440" y="164" width="140" height="30" rx="8"/><text class="sm" x="510" y="179">70</text>
  <text class="b bad" x="320" y="226">Should be 40. One update is lost.</text>
  <text class="xs mono" x="320" y="256">UPDATE accounts SET balance = balance - 30 WHERE id = $1 AND balance >= 30</text>
</svg>`,
      caption: "Both requests act on a value that is already out of date. The single atomic <code>UPDATE</code> at the bottom is the simplest fix. <code>SELECT … FOR UPDATE</code> or a <code>version</code> column also work. \"Just use a transaction\" does not: at Read Committed this still happens.",
    },
  ],
  concepts: [
    { term: "Isolation levels", plain: "A dial between correctness and throughput. Read Committed (the Postgres default) stops dirty reads only. Repeatable Read adds stable re-reads. Serializable prevents every anomaly but aborts transactions that you must retry.", why: "Under the default, two reads in one transaction can disagree. Read-modify-write needs <code>FOR UPDATE</code>, Serializable plus a retry loop, or one atomic statement." },
    { term: "Connections are processes", plain: "Each Postgres connection is a separate OS process with several MB of memory. Opening one costs 5–50 ms (TCP + TLS + auth). <code>max_connections</code> defaults to 100.", why: "Past roughly <code>2 × cores</code>, more connections mean context switching, not more work. Keep pools small (5–10 per replica) and queue in the app, where you can see the queue." },
    { term: "Pool arithmetic", plain: "<code>replicas × pool size</code> must stay well under <code>max_connections</code>. Cap <code>max-instances</code> to keep it true. Past a few hundred clients, put PgBouncer in transaction mode in front.", why: "10 replicas × 20 connections = 200 against a limit of 100, and half your replicas can't connect, all at once, under load." },
    { term: "N+1 query", plain: "One query for the parents, then one more per child in a loop, usually from ORM lazy loading.", why: "It's invisible at 0.1 ms local round trips and costly at 2 ms in production. The test is always the same: <b>count queries per request</b>." },
    { term: "Schema as last line of defence", plain: "Identity primary keys, <code>TIMESTAMPTZ</code>, <code>NOT NULL</code> by default, foreign keys with explicit <code>ON DELETE</code>, <code>NUMERIC</code> for money, <code>CHECK</code> for invariants.", why: "Application validation has bugs, and other writers exist. UUIDv4 as a primary key wrecks index locality; use identity or UUIDv7." },
    { term: "Readiness vs liveness", plain: "Readiness pings the database. Liveness never does. Startup fails fast if <code>DATABASE_URL</code> is missing or the first ping fails.", why: "Readiness decides whether a replica gets traffic, so it should fail while the database is unreachable. Liveness must never call the database (Capsule 01). And a loud failure at startup beats guessing a database URL." },
  ],
  numbers: [
    { value: "200 vs 100", label: "10 replicas × 20 conns vs <code>max_connections</code>", note: "Half the replicas can't connect. Do this arithmetic in the PR, and on a <code>db-f1-micro</code> the limit is ~25." },
    { value: "~51 vs ~1", label: "queries per leaderboard request", note: "N+1 vs a JOIN, counted in the Postgres log in Step 6." },
    { value: "5–50 ms", label: "to open one connection", note: "TCP + TLS + auth. Why pools keep a few warm (<code>MinConns = 2</code>)." },
    { value: "~$8–10", label: "a month for the smallest Cloud SQL instance", note: "No free tier, billed while it exists. That's why the lab uses Docker." },
  ],
  traps: [
    { myth: "\"Latency is high, so the database must be overloaded.\"", truth: "High app latency with low database CPU is the signature of <b>pool exhaustion</b>: requests are waiting for a connection, not for Postgres. Check <code>pool.Stat()</code> and <code>pg_stat_activity</code>." },
    { myth: "Raise <code>MaxConns</code> until the errors stop.", truth: "A bigger pool is often slower. It's the <em>last</em> option. First find the slow query, add timeouts so connections are returned, then consider a pooler." },
    { myth: "Wrap the read-then-write in a transaction and it's safe.", truth: "At Read Committed both transactions still read 100 and both write 70. You need an atomic statement, a row lock, an optimistic version check, or Serializable with retries." },
    { myth: "It's fast on my laptop, so the ORM code is fine.", truth: "Local round trips are 0.1 ms, so 51 queries look free. Count queries per request, and assert a query budget in an integration test." },
    { myth: "SQL doesn't scale, so start with NoSQL.", truth: "One primary doesn't scale writes past a point. Everything else about relational is a strong default. Leave it on a measured trigger, knowing you give up joins, ad-hoc queries and multi-row transactions." },
  ],
  gcp: [
    { service: "Cloud SQL for PostgreSQL", role: "Managed Postgres: automated backups and point-in-time recovery, HA with a synchronous standby in another zone (failover ~60 s, roughly double the cost), read replicas, maintenance windows, IAM database auth." },
    { service: "Cloud SQL Auth Proxy", role: "The default way to connect: handles TLS, IAM auth and rotation. Next best is private IP via a VPC connector from Cloud Run. Avoid public IP with authorised networks." },
    { service: "AlloyDB", role: "Postgres-compatible, much faster analytics, built-in connection pooling. More expensive." },
    { service: "Spanner · Firestore", role: "Spanner only when you truly need horizontal writes with strong consistency and can pay. Firestore suits per-user documents and realtime sync, and is bad at joins and aggregates." },
  ],
  takeaways: [
    "Relational is the default. Leave it on a measurement.",
    "Small pools, and <code>replicas × pool size &lt; max_connections</code> with margin, written in the PR.",
    "High app latency with an idle database means pool exhaustion.",
    "Always put <code>context.WithTimeout</code> on queries. An unbounded query holds a connection forever.",
    "Count queries per request. N+1 is invisible locally.",
    "Read-modify-write needs an atomic statement or a lock, not just a transaction.",
    "Readiness pings the database; liveness never does. Fail startup when <code>DATABASE_URL</code> is missing.",
    "Put real constraints in the schema.",
  ],
  drill: [
    { q: "App latency is 3 s. Database CPU is 8%. What is happening?", a: [
      "Almost certainly <b>connection pool exhaustion</b>. Requests queue inside the app waiting for a connection, and the database is idle because the work isn't reaching it. Confirm with <code>pool.Stat()</code> (<code>AcquireDuration</code>, <code>EmptyAcquireCount</code>) and <code>pg_stat_activity</code>.",
      "Likely causes: a slow query holding connections, a missing timeout, a leaked connection (rows not closed), too many replicas for the budget, or a pool that really is too small. Fix the slow query first. Raising <code>MaxConns</code> comes last and often makes it worse.",
    ] },
    { q: "Two requests read a balance of 100 and each subtract 30. What's stored, and how do you fix it?", a: [
      "Under Read Committed both read 100 and both write 70. You lost an update; it should be 40.",
      "Fixes: an atomic <code>UPDATE … SET balance = balance - 30 WHERE id = $1 AND balance &gt;= 30</code>; <code>SELECT … FOR UPDATE</code> so the second reader blocks; or a <code>version</code> column and retry when zero rows change. Serializable works too but needs a retry loop. A transaction alone does not fix it.",
    ] },
    { q: "Why is a bigger connection pool often slower?", a: [
      "Each connection is a backend process with its own memory. Beyond roughly <code>2 × cores</code>, extra connections add context switching, lock contention and cache pressure without adding parallelism. Throughput falls and per-query latency rises.",
      "The queue has to live somewhere. In your app you can see it, bound it and shed it. Inside the database it slows everyone down. That's why PgBouncer in transaction mode works so well.",
    ] },
    { q: "Your ORM generates 200 queries for one page. Walk through fixing it.", a: [
      "Measure first, with query logging or an APM. The pattern is almost always one parent query plus N lazy-loaded children. Fix in order: eager-load the association, batch ids into one <code>WHERE id = ANY($1)</code>, use <code>DISTINCT ON</code> or a window function for top-N-per-group, and only then denormalise or cache.",
      "Prevent it with a query-count budget asserted in an integration test, so the build fails instead of production.",
    ] },
    { q: "When is it genuinely right to reach for a non-relational database?", a: [
      "On a concrete trigger: Bigtable for &gt;10 TB of single-key access with write throughput beyond one primary; Firestore for per-user documents, realtime sync and fully known access patterns; Elasticsearch for full-text relevance; Redis for caching and ephemeral state; BigQuery for analytics <em>alongside</em> the transactional store.",
      "You give up joins, ad-hoc queries, multi-row transactions and decades of tooling, so the trigger should be a measurement.",
    ] },
  ],
  connects: {
    back: "Capsule 06 found the bug, state hiding inside each replica, and its <code>Store</code> interface is why swapping in Postgres changed no handlers. Capsule 06's <code>max-instances</code> cap is what keeps the pool arithmetic true, and Capsule 09's k6 drove the pool to exhaustion.",
    forward: "Capsule 11 makes the queries fast, which is the first fix for pool exhaustion. Capsules 12 and 13 deal with the one primary that can't scale writes, Capsule 14 caches in front of it, and Capsule 19 reuses the <code>ON CONFLICT</code> idempotent upsert.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "11",
  tagline: "A 4-second query and a 3-millisecond query are often the same query on the same data, one line of DDL apart. <code>EXPLAIN (ANALYZE, BUFFERS)</code> is how you stop guessing which line.",
  built: "On a table loaded with millions of readings, you ran <code>EXPLAIN (ANALYZE, BUFFERS)</code> with no index (Seq Scan plus a Sort), added <code>(fighter_id, recorded_at DESC)</code> (Index Scan, no Sort), and compared the reversed column order by its <b>buffer count</b>. You watched the planner correctly ignore an index on an unselective query and get slower when you forced it, turned a lookup into an <b>Index Only Scan</b> with <code>INCLUDE</code>, timed <code>OFFSET</code> against keyset pagination at depth, learned the <code>pg_stat_statements</code> and unused-index queries, and measured how extra indexes slow inserts.",
  story: [
    "A B-tree index is a sorted, balanced tree of key → row location. Finding one row takes 3–4 page reads instead of reading the whole table. Everything else follows from \"it's sorted\": equality and ranges work, <code>ORDER BY</code> can be free, <code>LIKE 'goku%'</code> works and <code>LIKE '%goku'</code> doesn't, and every write has to update every index.",
    "Composite indexes are sorted by the first column, then the second within it, and so on. A query can only use a <b>left prefix</b>. The rule that's right nearly every time: <b>equality columns first, the range or sort column last</b>. <code>WHERE fighter_id = ? ORDER BY recorded_at DESC</code> wants <code>(fighter_id, recorded_at DESC)</code>. Reverse it and the database walks far more of the index.",
    "The planner is not stupid. If a query returns more than about 5–10% of a table, a sequential scan beats thousands of random page reads, so the planner ignores your index, and it's right to. <b>A Seq Scan in a plan is not automatically a bug.</b> When a plan does go wrong, compare estimated <code>rows=</code> with <code>actual rows=</code>. A big gap means stale statistics, and the fix is <code>ANALYZE</code>, not another index.",
    "Two more patterns pay off again and again. A <b>covering index</b> (<code>INCLUDE</code>) lets Postgres answer from the index alone. <b>Keyset pagination</b> replaces <code>OFFSET</code>, which has to produce and throw away every skipped row. And indexes are a trade: each one makes every write slower, forever.",
  ],
  diagrams: [
    {
      title: "Why column order decides how much you read",
      svg: `<svg class="dg" viewBox="0 0 640 286" role="img" aria-label="Left: index sorted by fighter then time keeps fighter 42's entries together and already in time order. Right: index sorted by time then fighter scatters fighter 42's entries, so most entries are checked and skipped">
  <rect class="zone" x="8" y="8" width="304" height="270" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="270" rx="12"/>
  <text class="mono" x="160" y="28">(fighter_id, recorded_at DESC)</text>
  <text class="mono" x="480" y="28">(recorded_at DESC, fighter_id)</text>
  <rect class="box dim" x="28" y="46" width="150" height="24" rx="8"/><text class="sm mono" x="103" y="58">41 · 09:12</text>
  <rect class="box ok" x="28" y="74" width="150" height="24" rx="8"/><text class="sm mono" x="103" y="86">42 · 10:05</text>
  <rect class="box ok" x="28" y="102" width="150" height="24" rx="8"/><text class="sm mono" x="103" y="114">42 · 10:01</text>
  <rect class="box ok" x="28" y="130" width="150" height="24" rx="8"/><text class="sm mono" x="103" y="142">42 · 09:58</text>
  <rect class="box ok" x="28" y="158" width="150" height="24" rx="8"/><text class="sm mono" x="103" y="170">42 · 09:40</text>
  <rect class="box dim" x="28" y="186" width="150" height="24" rx="8"/><text class="sm mono" x="103" y="198">43 · 10:07</text>
  <rect class="box dim" x="28" y="214" width="150" height="24" rx="8"/><text class="sm mono" x="103" y="226">43 · 08:30</text>
  <text class="sm start" x="190" y="112">one run,</text>
  <text class="sm start" x="190" y="130">already in</text>
  <text class="sm start" x="190" y="148">time order</text>
  <rect class="box dim" x="348" y="46" width="150" height="24" rx="8"/><text class="sm mono" x="423" y="58">10:07 · 43</text>
  <rect class="box ok" x="348" y="74" width="150" height="24" rx="8"/><text class="sm mono" x="423" y="86">10:05 · 42</text>
  <rect class="box dim" x="348" y="102" width="150" height="24" rx="8"/><text class="sm mono" x="423" y="114">10:04 · 7</text>
  <rect class="box ok" x="348" y="130" width="150" height="24" rx="8"/><text class="sm mono" x="423" y="142">10:01 · 42</text>
  <rect class="box dim" x="348" y="158" width="150" height="24" rx="8"/><text class="sm mono" x="423" y="170">10:00 · 311</text>
  <rect class="box ok" x="348" y="186" width="150" height="24" rx="8"/><text class="sm mono" x="423" y="198">09:58 · 42</text>
  <rect class="box dim" x="348" y="214" width="150" height="24" rx="8"/><text class="sm mono" x="423" y="226">09:57 · 1290</text>
  <text class="sm start" x="510" y="112">every entry</text>
  <text class="sm start" x="510" y="130">checked,</text>
  <text class="sm start" x="510" y="148">most skipped</text>
  <text class="b good" x="160" y="260">13 buffers · 0.040 ms</text>
  <text class="b bad" x="480" y="260">83 buffers · 0.148 ms</text>
</svg>`,
      caption: "Query: <code>WHERE fighter_id = 42 ORDER BY recorded_at DESC LIMIT 10</code>. On Postgres 16 both plans say <code>Index Scan</code> with <code>Index Cond: (fighter_id = 42)</code>; only the <code>Buffers</code> line shows the extra work. Numbers are the capsule's measurement on the 2 million rows Step 1 loads. With no usable index it was about 29 ms. Your exact numbers will differ, but not the shape.",
    },
    {
      title: "OFFSET vs keyset at page 25,000",
      svg: `<svg class="dg" viewBox="0 0 640 222" role="img" aria-label="OFFSET 500000 produces and discards half a million rows before returning 20; keyset pagination seeks straight to the cursor through the index and reads 20">
  <text class="sm mono start" x="20" y="22">ORDER BY recorded_at DESC, id DESC LIMIT 20 OFFSET 500000</text>
  <rect class="box dim" x="20" y="36" width="556" height="38" rx="8"/>
  <text x="298" y="55">produced, then thrown away: 500,000 rows</text>
  <rect class="box ok" x="582" y="36" width="40" height="38" rx="8"/><text class="sm" x="602" y="55">20</text>
  <text class="sm mono start" x="20" y="104">WHERE (recorded_at, id) &lt; ($1, $2) … LIMIT 20</text>
  <line class="axis" x1="20" y1="160" x2="576" y2="160"/>
  <path class="wire good" d="M24 158 Q300 112 576 150"/>
  <rect class="box ok" x="582" y="141" width="40" height="38" rx="8"/><text class="sm" x="602" y="160">20</text>
  <text class="sm" x="300" y="180">index seek to the cursor: a few page reads, at any depth</text>
  <text class="sm mute" x="320" y="210">OFFSET gets slower with every page. Keyset costs the same on page 1 and page 25,000.</text>
</svg>`,
      caption: "The cursor is the last row of the previous page. The unique <code>id</code> tiebreaker keeps it correct when timestamps collide, and it needs the <code>(recorded_at DESC, id DESC)</code> index. Rows inserted mid-paging shift offsets, causing duplicates and skips; keyset is stable. The cost: no jumping to \"page 500\".",
    },
    {
      title: "Selectivity: when the planner rightly skips your index",
      svg: `<svg class="dg" viewBox="0 0 640 262" role="img" aria-label="Cost against share of table returned: index scan cost climbs steeply because each row is a random page read; sequential scan cost is flat; they cross around 5 to 10 percent">
  <line class="axis" x1="60" y1="220" x2="612" y2="220"/>
  <line class="axis" x1="60" y1="220" x2="60" y2="26"/>
  <text class="sm mute end" x="52" y="32">cost</text>
  <path class="line cool" d="M60 150 L610 150"/>
  <path class="line" d="M60 214 C 80 202, 92 172, 100 150 S 128 64, 146 28"/>
  <circle class="dot hot" cx="100" cy="150" r="5"/>
  <text class="sm start" x="160" y="52">Index Scan: one random page read per matching row</text>
  <text class="sm start" x="330" y="136">Seq Scan: read the table once, in order</text>
  <circle class="dot good" cx="64" cy="212" r="5"/>
  <line class="wire soft" x1="176" y1="198" x2="72" y2="210"/>
  <text class="sm start" x="180" y="196">power &gt; 9999000 → index (tiny result)</text>
  <circle class="dot cool" cx="606" cy="150" r="5"/>
  <text class="sm end" x="604" y="174">power &gt; 1000 → Seq Scan; forcing the index is slower</text>
  <text class="xs mute" x="60" y="236">0%</text>
  <text class="xs accent" x="104" y="236">~5–10%</text>
  <text class="xs mute" x="606" y="236">100%</text>
  <text class="sm mute" x="336" y="254">share of the table the query returns</text>
</svg>`,
      caption: "The shape is illustrative; the two queries are Step 4. With <code>SET enable_seqscan = off</code> you forced the index on the broad query and it got slower. Low-cardinality columns earn their place as the trailing column of a composite index, or through a partial index.",
    },
  ],
  concepts: [
    { term: "B-tree", plain: "A sorted, balanced tree of key → row pointers. Finding a row in 10M takes about 4 page reads instead of 10M.", why: "Because it's sorted, ranges and <code>ORDER BY</code> come almost free and prefix <code>LIKE</code> works. Suffix <code>LIKE</code> and a function on the column (<code>lower(name)</code>) don't, unless you index the expression." },
    { term: "Left-prefix rule", plain: "<code>INDEX (a, b, c)</code> serves <code>a</code>, <code>a,b</code> and <code>a,b,c</code>. It can't serve <code>b</code> alone. A range on <code>a</code> stops <code>b</code> being useful.", why: "Equality first, range or sort last. Get it backwards and you either sort or walk far more of the index." },
    { term: "Selectivity", plain: "How small a slice of the table a predicate returns. Above ~5–10%, a sequential scan is usually cheaper.", why: "That's why an index on <code>is_active</code> is nearly useless on its own, and why the planner ignoring an index isn't automatically a bug." },
    { term: "Covering index", plain: "<code>INCLUDE (power)</code> stores extra columns in the index leaves without making them part of the sort key. You get an <b>Index Only Scan</b> with <code>Heap Fetches: 0</code>.", why: "It can be a 5–10× win on a hot path. Postgres needs a current visibility map, so a table that hasn't been vacuumed may still visit the heap." },
    { term: "Keyset pagination", plain: "<code>WHERE (recorded_at, id) &lt; ($1, $2) ORDER BY … LIMIT 20</code>, using the last row as the cursor.", why: "Constant time at any depth and stable under concurrent inserts. <code>OFFSET</code> is linear in depth and shows duplicates and skips." },
    { term: "Reading a plan", plain: "<code>EXPLAIN</code> estimates. <code>ANALYZE</code> actually runs the query, writes included, so wrap writes in <code>BEGIN … ROLLBACK</code>. <code>BUFFERS</code> shows pages from cache vs disk.", why: "Check estimated vs actual rows first. When two plans look structurally the same, <code>BUFFERS</code> is what tells them apart." },
  ],
  numbers: [
    { value: "~4 reads", label: "to find one row in 10M, vs 10,000,000", note: "Index O(log n) vs Seq Scan O(n)." },
    { value: "~700×", label: "29 ms → 0.040 ms", note: "One line of DDL, measured on 2 million rows. The gap widens as the table grows." },
    { value: "13 vs 83", label: "buffers, right vs reversed column order", note: "Same ten rows, over 6× the pages read." },
    { value: "~5–10%", label: "of the table: where Seq Scan wins", note: "Rough rule for when the planner should ignore your index." },
  ],
  traps: [
    { myth: "A Seq Scan in the plan means a missing index.", truth: "On a small table or a broad query it's the right plan. Step 4 showed forcing the index made a 90%-of-table query slower." },
    { myth: "The query got slow overnight, so add an index.", truth: "No code or volume change usually means <b>stale statistics</b> and a plan flip. Compare <code>rows=</code> with <code>actual rows=</code>; a 100× gap is the signature. Run <code>ANALYZE</code>." },
    { myth: "Indexes are free speed.", truth: "Every index taxes every <code>INSERT</code>, <code>UPDATE</code> and <code>DELETE</code>, forever. Step 8 measured it. Audit unused indexes with <code>pg_stat_user_indexes</code>." },
    { myth: "Order <code>pg_stat_statements</code> by mean time to find the worst query.", truth: "Order by <code>total_exec_time</code>. A 5 ms query called 500,000 times costs far more than a 2 s query called twice." },
    { myth: "Run <code>CREATE INDEX</code> in production like you did locally.", truth: "A plain <code>CREATE INDEX</code> blocks writes for its duration. Use <code>CONCURRENTLY</code>: slower, not inside a transaction, and if it fails, drop the <code>INVALID</code> index and retry." },
  ],
  gcp: [
    { service: "Cloud SQL Query Insights", role: "<code>pg_stat_statements</code> with a UI, plus per-query plans and load by query. Free, on by default, and the first place to look when Postgres is slow." },
    { service: "Autovacuum / <code>ANALYZE</code>", role: "Autovacuum keeps statistics fresh. After a bulk load, run <code>ANALYZE</code> yourself; the planner is only as good as its statistics." },
    { service: "Bigtable · Firestore", role: "No query planner. You design the key and the access pattern <em>is</em> the schema. That's Capsule 12, and it shows how much a relational planner does for you." },
  ],
  takeaways: [
    "<code>EXPLAIN (ANALYZE, BUFFERS)</code> before and after every index. Numbers, not hope.",
    "Equality columns first, range or sort column last.",
    "Estimated vs actual rows far apart means stale statistics. No index fixes that.",
    "A Seq Scan is not automatically a bug.",
    "Keyset pagination for anything deep or infinite-scrolling.",
    "Order <code>pg_stat_statements</code> by total time, not mean.",
    "Every index taxes every write. Audit unused ones.",
    "<code>CREATE INDEX CONCURRENTLY</code> in production. Always.",
  ],
  drill: [
    { q: "You have <code>INDEX (tenant_id, created_at)</code>. Which use it: (a) <code>tenant_id = 5</code>, (b) <code>tenant_id = 5 AND created_at &gt; …</code>, (c) <code>created_at &gt; …</code>, (d) <code>tenant_id = 5 ORDER BY created_at DESC</code>?", a: [
      "(a) Yes, leading column. (b) Yes, fully: equality then range is the ideal shape. (c) No: it skips the leading column. (d) Yes, the best case. The index gives both the filter and the order, so there's no Sort node.",
      "For (c) you'd need an index on <code>created_at</code>, but first ask whether a cross-tenant scan should exist at all.",
    ] },
    { q: "A query got slow overnight. No code changed, no data volume change. What happened?", a: [
      "Most likely <b>stale statistics</b> causing a plan flip. A bulk load or big delete changed the distribution and the planner picked badly, say a nested loop instead of a hash join. Diagnose with <code>EXPLAIN ANALYZE</code>: estimated vs actual rows. Fix with <code>ANALYZE</code>; if it recurs, raise <code>default_statistics_target</code> or add <code>CREATE STATISTICS</code>.",
      "Other candidates: a bloated or dropped index, autovacuum falling behind, parameter sniffing on a prepared statement, or a <code>work_mem</code> change making a sort spill to disk.",
    ] },
    { q: "When would you deliberately NOT add an index that would speed up a query?", a: [
      "When the table is write-heavy and the query is rare; when selectivity is low and the planner would ignore it; when an existing composite already covers it as a prefix (<code>(a, b)</code> serves <code>WHERE a = ?</code>); when the index wouldn't fit in RAM; or when the query itself should be fixed instead (an N+1, a missing <code>LIMIT</code>, a <code>SELECT *</code> dragging a large JSONB column).",
    ] },
    { q: "Explain to a product manager why \"go to page 500\" got removed.", a: [
      "<code>OFFSET</code> makes the database generate and throw away every skipped row, so deep pages get linearly slower and hold connections everyone else is waiting for. Pages also shift as new rows arrive, so users see duplicates and miss items.",
      "\"Load more\" with a cursor costs the same at any depth and stays stable under writes. Almost nobody goes past page 3, and the people who do are better served by search or a filter.",
    ] },
    { q: "<code>EXPLAIN</code> says 12 ms but production says 800 ms. Where's the difference?", a: [
      "Cold cache (<code>shared read</code> vs <code>shared hit</code> in <code>BUFFERS</code>); network round trips (Capsule 10's N+1); concurrency, meaning lock contention and the latency knee (Capsule 09); different parameters (a tenant with 5M rows instead of 100); connection pool wait time; or serialising and transferring a huge result set.",
    ] },
  ],
  connects: {
    back: "Capsule 10's schema already created <code>(fighter_id, recorded_at DESC)</code> with a comment saying column order matters. This capsule is why. Faster queries are also the first fix for Capsule 10's pool exhaustion.",
    forward: "Capsule 12 lists \"index properly\" as step one before sharding, because a missing index looks exactly like \"we need to shard\". Capsule 12's partitioning applies the same idea, prune what you don't need to read, at table level. Capsule 14's caching comes after you've fixed the query, not instead of it.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "12",
  tagline: "Splitting data is cheap when one database still knows about every piece (partitioning) and expensive when only your code does (sharding). Either way, a query that includes the key is cheap and one that doesn't touches everything.",
  built: "You range-partitioned a copy of <code>readings</code> by month, used <code>EXPLAIN</code> to watch <b>partition pruning</b> scan one partition for a date range and every partition for a query without the key, and dropped a whole month instantly. Then you ran two independent Postgres shards and wrote a <b><code>ShardedStore</code></b> that routes by <code>fnv(fighter) % N</code> and scatter-gathers the leaderboard in parallel. You sent 500 writes for <code>goku</code> to build a hotspot on purpose, and computed that going from 2 to 3 shards with modulo hashing moves about two thirds of the keys.",
  story: [
    "Eventually one database can't hold your data or absorb your writes. Sharding is the answer, and it's one of the most expensive architectural decisions you can make. The goal of this capsule is judgement, not enthusiasm. In order, try indexes, caching, read replicas, then vertical scale plus partitioning. Most teams never need step five.",
    "<b>Partitioning</b> splits one table inside one database. Transactions and joins still work. You get smaller indexes, pruning at query time and instant retention by dropping a partition, but no extra write throughput. <b>Sharding</b> spreads rows across separate databases that know nothing about each other, so <em>your code</em> routes. You gain horizontal writes and lose cross-shard transactions, cross-shard joins and easy resharding.",
    "The shard key is the whole decision, and it's very hard to change. A good key has high cardinality, even access and appears in most queries. Hash spreads data evenly but makes range queries hit every shard. Range keeps ranges on one shard but creates hotspots. The lesson you build by hand: <b>even data distribution does not mean even load</b>.",
    "Any query without the key is a <b>scatter-gather</b>. You ask every shard, wait for the slowest one, then merge. Top-N merges correctly only if each shard returns the full N. Medians and distinct counts don't merge at all without sketches. And with naive modulo hashing, changing the shard count moves most of your data, which is why consistent hashing exists.",
  ],
  diagrams: [
    {
      title: "Partition pruning: the key in the WHERE clause decides the work",
      svg: `<svg class="dg" viewBox="0 0 640 252" role="img" aria-label="A query filtered on recorded_at scans only the February partition; a query on power scans every partition">
  <text class="sm mono start" x="20" y="22">WHERE recorded_at &gt;= '2026-02-01' AND recorded_at &lt; '2026-03-01'</text>
  <rect class="box dim" x="20" y="36" width="140" height="48" rx="10"/><text class="sm mono" x="90" y="53">2026_01</text><text class="xs mute" x="90" y="72">pruned</text>
  <rect class="box ok" x="175" y="36" width="140" height="48" rx="10"/><text class="sm mono" x="245" y="53">2026_02</text><text class="xs" x="245" y="72">scanned</text>
  <rect class="box dim" x="330" y="36" width="140" height="48" rx="10"/><text class="sm mono" x="400" y="53">2026_03</text><text class="xs mute" x="400" y="72">pruned</text>
  <rect class="box dim" x="485" y="36" width="140" height="48" rx="10"/><text class="sm mono" x="555" y="53">default</text><text class="xs mute" x="555" y="72">pruned</text>
  <text class="sm mono start" x="20" y="120">WHERE power &gt; 9000000      -- no partition key</text>
  <rect class="box warn" x="20" y="134" width="140" height="48" rx="10"/><text class="sm mono" x="90" y="151">2026_01</text><text class="xs" x="90" y="170">scanned</text>
  <rect class="box warn" x="175" y="134" width="140" height="48" rx="10"/><text class="sm mono" x="245" y="151">2026_02</text><text class="xs" x="245" y="170">scanned</text>
  <rect class="box warn" x="330" y="134" width="140" height="48" rx="10"/><text class="sm mono" x="400" y="151">2026_03</text><text class="xs" x="400" y="170">scanned</text>
  <rect class="box warn" x="485" y="134" width="140" height="48" rx="10"/><text class="sm mono" x="555" y="151">default</text><text class="xs" x="555" y="170">scanned</text>
  <text class="sm" x="320" y="212">Key in the predicate → one partition. Key missing → every partition.</text>
  <text class="sm mute" x="320" y="236">The same rule governs sharding, where \"every partition\" means every database.</text>
</svg>`,
      caption: "Look for <code>Partitions removed: 3</code> in the first plan. Retention is the killer feature: <code>DROP TABLE readings_2026_01</code> deletes a month instantly, with no dead tuples and no vacuum debt, where <code>DELETE … WHERE recorded_at &lt; …</code> takes minutes. A function or cast on the key disables pruning.",
    },
    {
      title: "Where the load lands",
      svg: `<svg class="dg" viewBox="0 0 640 252" role="img" aria-label="Three panels: hash sharding spreads load evenly; range sharding by date sends all of today's writes to the newest shard; hash sharding by fighter still sends every write for one hot key to a single shard">
  <rect class="zone" x="8" y="8" width="200" height="236" rx="12"/>
  <rect class="zone" x="220" y="8" width="200" height="236" rx="12"/>
  <rect class="zone" x="432" y="8" width="200" height="236" rx="12"/>
  <text class="sm b" x="108" y="28">hash(user_id) % 4</text>
  <text class="sm b" x="320" y="28">range by created_at</text>
  <text class="sm b" x="532" y="28">hash(fighter), 2 shards</text>
  <line class="axis" x1="22" y1="200" x2="194" y2="200"/>
  <rect class="box ok" x="27" y="130" width="30" height="70" rx="4"/>
  <rect class="box ok" x="71" y="130" width="30" height="70" rx="4"/>
  <rect class="box ok" x="115" y="130" width="30" height="70" rx="4"/>
  <rect class="box ok" x="159" y="130" width="30" height="70" rx="4"/>
  <text class="xs mute" x="42" y="212">s0</text><text class="xs mute" x="86" y="212">s1</text><text class="xs mute" x="130" y="212">s2</text><text class="xs mute" x="174" y="212">s3</text>
  <text class="sm good" x="108" y="232">even load</text>
  <line class="axis" x1="234" y1="200" x2="406" y2="200"/>
  <rect class="box dim" x="239" y="188" width="30" height="12" rx="4"/>
  <rect class="box dim" x="283" y="188" width="30" height="12" rx="4"/>
  <rect class="box dim" x="327" y="188" width="30" height="12" rx="4"/>
  <rect class="box warn" x="371" y="62" width="30" height="138" rx="4"/>
  <text class="xs" x="386" y="50">today</text>
  <text class="xs mute" x="254" y="212">Jan</text><text class="xs mute" x="298" y="212">Feb</text><text class="xs mute" x="342" y="212">Mar</text><text class="xs mute" x="386" y="212">Apr</text>
  <text class="sm bad" x="320" y="232">newest shard melts</text>
  <line class="axis" x1="446" y1="200" x2="618" y2="200"/>
  <rect class="box ok" x="472" y="182" width="50" height="18" rx="4"/>
  <rect class="box warn" x="552" y="58" width="50" height="142" rx="4"/>
  <text class="xs" x="577" y="46">goku × 500</text>
  <text class="xs mute" x="497" y="212">shard0</text><text class="xs mute" x="577" y="212">shard1</text>
  <text class="sm bad" x="532" y="232">one key, one shard</text>
</svg>`,
      caption: "Bars are load, not row counts, and the heights are illustrative. The right panel is Step 3: the fighters were spread roughly half and half, but 500 writes for one fighter all went to one shard. Fixes: a composite key (<code>fighter_id + time_bucket</code>), a random salt on hot keys merged on read, or a dedicated path for celebrities.",
    },
    {
      title: "Scatter-gather waits for the slowest shard",
      svg: `<svg class="dg" viewBox="0 0 640 236" role="img" aria-label="A leaderboard query without the shard key fans out to four shards in parallel; three answer fast, one is slow, and the merge can only start when the slowest returns">
  <rect class="box hot" x="10" y="88" width="130" height="58" rx="10"/><text x="75" y="108">Leaderboard</text><text class="sm" x="75" y="128">no shard key</text>
  <line class="wire" x1="142" y1="104" x2="206" y2="46"/>
  <line class="wire" x1="142" y1="112" x2="206" y2="94"/>
  <line class="wire" x1="142" y1="122" x2="206" y2="140"/>
  <line class="wire" x1="142" y1="130" x2="206" y2="186"/>
  <rect class="box ok" x="210" y="33" width="60" height="26" rx="6"/><text class="sm start" x="278" y="46">shard 0</text>
  <rect class="box ok" x="210" y="81" width="80" height="26" rx="6"/><text class="sm start" x="298" y="94">shard 1</text>
  <rect class="box ok" x="210" y="127" width="70" height="26" rx="6"/><text class="sm start" x="288" y="140">shard 2</text>
  <rect class="box warn" x="210" y="173" width="330" height="26" rx="6"/><text class="sm" x="375" y="186">shard 3 · slow this time</text>
  <line class="wire none soft" x1="546" y1="22" x2="546" y2="206" stroke-dasharray="4 4"/>
  <text class="sm" x="590" y="96">merge,</text><text class="sm" x="590" y="114">re-sort,</text><text class="sm" x="590" y="132">take n</text>
  <text class="sm mute" x="320" y="224">Each shard returns its full top n. The request finishes when the last one does.</text>
</svg>`,
      caption: "Bar lengths are illustrative. This is <b>tail amplification</b>: with 20 shards each slow 1% of the time, <code>1 − 0.99²⁰ ≈ 18%</code> of requests hit at least one slow shard, so your p99 is built from the shards' p95s. Taking <code>n/shards</code> from each would be wrong, since one shard may hold all the strongest fighters.",
    },
    {
      title: "Modulo resharding moves most keys",
      svg: `<svg class="dg" viewBox="0 0 640 214" role="img" aria-label="Twelve keys with hashes 0 to 11; hash mod 2 versus hash mod 3; eight of twelve change shard">
  <text class="sm end" x="118" y="40">hash(key)</text>
  <text class="sm end" x="118" y="80">% 2 shards</text>
  <text class="sm end" x="118" y="120">% 3 shards</text>
  <text class="sm mono" x="147" y="40">0</text><text class="sm mono" x="187" y="40">1</text><text class="sm mono" x="227" y="40">2</text><text class="sm mono" x="267" y="40">3</text><text class="sm mono" x="307" y="40">4</text><text class="sm mono" x="347" y="40">5</text><text class="sm mono" x="387" y="40">6</text><text class="sm mono" x="427" y="40">7</text><text class="sm mono" x="467" y="40">8</text><text class="sm mono" x="507" y="40">9</text><text class="sm mono" x="547" y="40">10</text><text class="sm mono" x="587" y="40">11</text>
  <rect class="box" x="130" y="66" width="34" height="28" rx="6"/><text class="sm" x="147" y="80">0</text>
  <rect class="box" x="170" y="66" width="34" height="28" rx="6"/><text class="sm" x="187" y="80">1</text>
  <rect class="box" x="210" y="66" width="34" height="28" rx="6"/><text class="sm" x="227" y="80">0</text>
  <rect class="box" x="250" y="66" width="34" height="28" rx="6"/><text class="sm" x="267" y="80">1</text>
  <rect class="box" x="290" y="66" width="34" height="28" rx="6"/><text class="sm" x="307" y="80">0</text>
  <rect class="box" x="330" y="66" width="34" height="28" rx="6"/><text class="sm" x="347" y="80">1</text>
  <rect class="box" x="370" y="66" width="34" height="28" rx="6"/><text class="sm" x="387" y="80">0</text>
  <rect class="box" x="410" y="66" width="34" height="28" rx="6"/><text class="sm" x="427" y="80">1</text>
  <rect class="box" x="450" y="66" width="34" height="28" rx="6"/><text class="sm" x="467" y="80">0</text>
  <rect class="box" x="490" y="66" width="34" height="28" rx="6"/><text class="sm" x="507" y="80">1</text>
  <rect class="box" x="530" y="66" width="34" height="28" rx="6"/><text class="sm" x="547" y="80">0</text>
  <rect class="box" x="570" y="66" width="34" height="28" rx="6"/><text class="sm" x="587" y="80">1</text>
  <rect class="box ok" x="130" y="106" width="34" height="28" rx="6"/><text class="sm" x="147" y="120">0</text>
  <rect class="box ok" x="170" y="106" width="34" height="28" rx="6"/><text class="sm" x="187" y="120">1</text>
  <rect class="box warn" x="210" y="106" width="34" height="28" rx="6"/><text class="sm" x="227" y="120">2</text>
  <rect class="box warn" x="250" y="106" width="34" height="28" rx="6"/><text class="sm" x="267" y="120">0</text>
  <rect class="box warn" x="290" y="106" width="34" height="28" rx="6"/><text class="sm" x="307" y="120">1</text>
  <rect class="box warn" x="330" y="106" width="34" height="28" rx="6"/><text class="sm" x="347" y="120">2</text>
  <rect class="box ok" x="370" y="106" width="34" height="28" rx="6"/><text class="sm" x="387" y="120">0</text>
  <rect class="box ok" x="410" y="106" width="34" height="28" rx="6"/><text class="sm" x="427" y="120">1</text>
  <rect class="box warn" x="450" y="106" width="34" height="28" rx="6"/><text class="sm" x="467" y="120">2</text>
  <rect class="box warn" x="490" y="106" width="34" height="28" rx="6"/><text class="sm" x="507" y="120">0</text>
  <rect class="box warn" x="530" y="106" width="34" height="28" rx="6"/><text class="sm" x="547" y="120">1</text>
  <rect class="box warn" x="570" y="106" width="34" height="28" rx="6"/><text class="sm" x="587" y="120">2</text>
  <text class="b bad" x="367" y="164">8 of 12 keys change shard: about two thirds of the data moves</text>
  <text class="sm mute" x="367" y="192">With consistent hashing, adding a shard moves only ~1/N of the keys.</text>
</svg>`,
      caption: "Red cells are keys whose shard changes when you add a third shard to two. Step 4's script shows the same thing on 100,000 keys: roughly two thirds move, and the move has to happen online, with dual-write, backfill, verification and cutover. Going from 4 to 5 shards moves about 80%.",
    },
  ],
  concepts: [
    { term: "Partitioning vs sharding", plain: "Partitioning splits a table inside one database, which still knows every piece. Sharding spreads rows across databases that don't know about each other, so your code routes.", why: "Partitioning is cheap and often enough, but adds no write throughput. Sharding adds throughput and costs you transactions, joins and easy resharding. It's a project." },
    { term: "Shard key", plain: "The field that decides where a row lives. It needs high cardinality, even access, and to appear in most queries.", why: "It's a one-way door. <code>country</code> is a bad key; <code>user_id</code> is a good one, until a celebrity melts their shard." },
    { term: "Hash, range, directory, geo", plain: "Hash: even, but ranges hit every shard. Range: ranges stay local, but recent or popular keys hotspot. Directory: a lookup table that's flexible but a bottleneck. Geo: residency and latency, with uneven populations.", why: "Multi-tenant SaaS usually ends up on a directory, because it's the only one that lets you move a single whale tenant." },
    { term: "Scatter-gather", plain: "A query without the shard key asks every shard and merges the answers.", why: "Latency is the slowest shard. Top-N needs the full N from each. Medians and <code>COUNT(DISTINCT)</code> don't merge without sketches (HyperLogLog, t-digest). <code>OFFSET</code> stops meaning anything." },
    { term: "Consistent hashing", plain: "Shards and keys sit on a ring, so adding a shard moves only about 1/N of the keys. Virtual nodes keep the spread even.", why: "Modulo hashing moves most of the data on every resize. Many logical shards on few servers (say 1024 on 4) gives you the same freedom more simply." },
    { term: "Partition pruning", plain: "With the partition key in the predicate, Postgres skips partitions that can't match. <code>DROP</code>ping a partition is instant retention.", why: "It's the sharding lesson at zero operational cost. Most \"we need to shard\" problems are really \"this table is too big to vacuum and delete from\"." },
  ],
  numbers: [
    { value: "~2/3", label: "of keys move going from 2 → 3 shards", note: "Modulo hashing, from Step 4's script." },
    { value: "~80%", label: "of data moves going from 4 → 5 shards", note: "Consistent hashing moves about 1/N instead." },
    { value: "≈ 18%", label: "of requests hit a slow shard", note: "<code>1 − 0.99²⁰</code>: 20-way scatter-gather, each shard slow 1% of the time." },
    { value: "~$65", label: "a month for the smallest production Spanner", note: "Excellent, and almost never the right answer for a startup." },
  ],
  traps: [
    { myth: "\"We're slow, so we need to shard.\"", truth: "A missing index looks exactly like that. Go through indexes, caching, read replicas and vertical scale plus partitioning first, and write down what each one bought you." },
    { myth: "Our data is evenly distributed, so load will be too.", truth: "Data distribution and traffic distribution are different things. Step 3 spread fighters evenly and still sent every <code>goku</code> write to one shard." },
    { myth: "Shard by timestamp so range queries stay local.", truth: "Then all of today's writes hit one shard while the rest idle. In Bigtable and Spanner, a monotonic leading key is the classic hotspot; reverse it, hash-prefix it, or bit-reverse the sequence." },
    { myth: "For a global top 10 across 2 shards, take the top 5 from each.", truth: "One shard may hold all ten of the strongest. Take the full <code>n</code> from every shard and merge." },
    { myth: "We can always add shards later.", truth: "With modulo hashing that moves most of your data, online, over weeks. Design for it from day one with consistent hashing or many logical shards." },
  ],
  gcp: [
    { service: "Cloud SQL", role: "No built-in sharding; you shard in the app, as the lab did. Use it while one primary is still enough." },
    { service: "Spanner", role: "Shards automatically by primary key ranges, splitting and rebalancing itself. Use it when you need horizontal writes <b>and</b> strong consistency and can pay. Never lead the primary key with a monotonically increasing value." },
    { service: "Bigtable", role: "Shards automatically by row-key ranges. Key design is the whole game: <code>user_id + reverse_timestamp</code> or a hash prefix, never a bare timestamp." },
    { service: "Firestore · AlloyDB", role: "Firestore shards automatically by document and suits per-user data and realtime. AlloyDB has one primary with many read pools, for when reads are the problem, not writes." },
  ],
  takeaways: [
    "Try indexes, caching, read replicas, then vertical scale plus partitioning. Shard last.",
    "Prefer native partitioning. <code>DROP</code> a partition for instant retention.",
    "The shard key is a one-way door. Document the reasoning in an ADR.",
    "Plan for traffic hotspots, not just even row counts.",
    "Assume you'll reshard: consistent hashing, or many logical shards on few servers.",
    "Keep the list of scatter-gather queries short. Each one amplifies tail latency.",
    "Sums, counts, min and max merge across shards. Medians, percentiles and distinct counts don't.",
  ],
  drill: [
    { q: "Shard a multi-tenant SaaS app. What's your key, and what breaks?", a: [
      "<code>tenant_id</code>: nearly every query is tenant-scoped, so almost everything is single-shard, and you get tenant isolation for free.",
      "What breaks: whale tenants melt their shard (give them a dedicated one, which is the directory strategy); cross-tenant analytics become scatter-gather (push them to BigQuery); and moving a tenant between shards is a project to design on day one. That's why the usual answer is a directory, not pure hashing.",
    ] },
    { q: "Why can't you just <code>COUNT(DISTINCT user_id)</code> across shards?", a: [
      "A user can appear on several shards, and per-shard distinct counts don't add up to the distinct count of the union. Options: pull every distinct id to one place, merge per-shard <b>HyperLogLog</b> sketches (about 2% error in kilobytes), or maintain the count as writes happen.",
    ] },
    { q: "A user transfers money to another user on a different shard. How?", a: [
      "Not with one ACID transaction; that's the price of sharding. 2PC is correct but blocks if the coordinator dies. A <b>saga</b> runs local transactions with compensations (<code>debit(A)</code> → <code>credit(B)</code>, refund on failure), each step idempotent, made reliable by a transactional outbox.",
      "Or avoid the problem: co-locate related entities so the common case is single-shard, or use a database that does distributed transactions properly, like Spanner.",
    ] },
    { q: "How do you reshard from 4 to 8 with no downtime?", a: [
      "Dual-write to old and new while reading from old; backfill in throttled batches; verify counts and checksums per key range; flip reads gradually behind a flag; then stop dual-writing and drop the old data. Every step is reversible until the last. It takes weeks.",
      "The cheap version is having planned for it: 1024 logical shards on 4 servers means moving logical shards, not rehashing keys. Hours, not weeks.",
    ] },
    { q: "You scatter-gather to 20 shards. p50 is 8 ms, p99 is 400 ms. Why?", a: [
      "<b>Tail amplification.</b> Each request waits for the slowest of 20 responses. At 1% slowness per shard, <code>1 − 0.99²⁰ ≈ 18%</code> of requests hit one.",
      "Mitigations: hedged requests to a replica after p95; per-shard timeouts with partial results; less fan-out through a better key or a cached aggregate; or precompute the aggregate asynchronously.",
    ] },
  ],
  connects: {
    back: "Capsule 11's indexes are step one of the \"before sharding\" list, and pruning is the same idea one level up. The <code>Store</code> interface from Capsules 06 and 10 is why <code>ShardedStore</code> slots in behind an env var.",
    forward: "Capsule 13 adds read replicas, step three of the list. Capsule 15 replaces the modulo <code>shardFor</code> with a consistent hash ring for cache clusters. Sagas and idempotency return in Capsules 19 and 21, and precomputed aggregates in Capsule 20.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "13",
  tagline: "Replication gives you failover and read scale, and brings in the hardest idea in distributed systems: something can be true in one place and not yet true in another.",
  built: "You ran a real Postgres <b>streaming replica</b> in compose (<code>pg_basebackup</code>, plus a <code>pg_hba.conf</code> entry so the clone isn't refused), confirmed it's read-only, then <b>paused WAL replay</b> to reproduce \"I saved it and it disappeared\": different counts from primary and replica at the same instant. You wrote a <b><code>ReplicatedStore</code></b> that sends writes to the primary, pins a fighter's reads to the primary for 5 s after a write, and serves the leaderboard from a replica. Finally you stopped the primary, saw reads keep working and writes fail, and promoted the replica with <code>pg_promote()</code>.",
  story: [
    "A single database is a single point of failure and a read bottleneck. Leader/follower replication fixes both. The leader writes its <b>write-ahead log</b> and ships it; followers replay it and serve reads. That log is the whole mechanism, and the same one behind point-in-time recovery and change data capture.",
    "Synchronous or asynchronous is a trade. Sync commits wait for a follower: no data loss, slower writes. Async returns as soon as the leader has it: fast, but whatever hadn't shipped is lost if the leader dies. Most teams land on one synchronous standby for failover plus asynchronous read replicas for scale.",
    "Lag is usually milliseconds and sometimes minutes, and it causes four bugs: read-your-writes, non-monotonic reads, inconsistent prefix, and broken cross-entity invariants. The fixes are pinning a user to the leader after a write, sticky replicas, waiting for an LSN, or the cheapest one: <b>design it away</b> by rendering the value the write already returned instead of reading it back.",
    "On consistency theory: CAP only describes what happens during a partition. <b>PACELC</b> adds the branch you live in every day: <em>else</em>, choose latency or consistency. Strong consistency means coordination, and coordination means round trips. Quorums (<code>W + R &gt; N</code>) and Spanner's TrueTime are ways of paying for it. And failover has its own price: async loses unshipped writes, and two primaries is split-brain.",
  ],
  diagrams: [
    {
      title: "Read-your-writes: saved, then gone",
      svg: `<svg class="dg" viewBox="0 0 640 312" role="img" aria-label="Sequence: the user saves, the app writes to the leader and gets a commit; the WAL reaches the replica late; the user's next read goes to the replica and returns the old value">
  <rect class="box" x="20" y="10" width="100" height="40" rx="10"/><text x="70" y="30">User</text>
  <rect class="box hot" x="180" y="10" width="100" height="40" rx="10"/><text x="230" y="30">App</text>
  <rect class="box energy" x="350" y="10" width="100" height="40" rx="10"/><text x="400" y="30">Leader</text>
  <rect class="box cool" x="510" y="10" width="100" height="40" rx="10"/><text x="560" y="30">Replica</text>
  <line class="wire none soft" x1="70" y1="50" x2="70" y2="300" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="230" y1="50" x2="230" y2="300" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="400" y1="50" x2="400" y2="300" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="560" y1="50" x2="560" y2="300" stroke-dasharray="3 5"/>
  <line class="wire" x1="72" y1="80" x2="226" y2="80"/><text class="sm" x="150" y="70">① save profile</text>
  <line class="wire" x1="232" y1="104" x2="396" y2="104"/><text class="sm" x="315" y="94">UPDATE</text>
  <line class="wire dash" x1="398" y1="126" x2="234" y2="126"/><text class="sm" x="315" y="140">commit</text>
  <line class="wire good" x1="228" y1="150" x2="74" y2="150"/><text class="sm good" x="150" y="140">saved</text>
  <line class="wire dash soft" x1="402" y1="130" x2="556" y2="262"/>
  <text class="sm start" x="466" y="134">WAL ships</text><text class="sm start" x="466" y="150">late (lag)</text>
  <line class="wire" x1="72" y1="182" x2="226" y2="182"/><text class="sm" x="150" y="172">② view profile</text>
  <line class="wire" x1="232" y1="204" x2="556" y2="204"/><text class="sm halo" x="315" y="194">SELECT</text>
  <line class="wire dash bad" x1="558" y1="228" x2="234" y2="228"/><text class="sm bad halo" x="315" y="242">old value</text>
  <line class="wire bad" x1="228" y1="256" x2="74" y2="256"/><text class="sm bad" x="150" y="246">\"it disappeared\"</text>
  <text class="sm good halo" x="560" y="284">③ replays: new value</text>
</svg>`,
      caption: "What Step 3 reproduced with <code>pg_wal_replay_pause()</code>: the primary and the replica gave different counts at the same instant, and the replica caught up after <code>pg_wal_replay_resume()</code>. The cheapest fix skips ② entirely: the write already returned the new state, so render that.",
    },
    {
      title: "ReplicatedStore: route each read on purpose",
      svg: `<svg class="dg" viewBox="0 0 640 292" role="img" aria-label="Record goes to the primary and pins the fighter for 5 seconds; Latest for a pinned fighter reads the primary; Latest for other fighters and Leaderboard read the replica">
  <rect class="box" x="10" y="26" width="160" height="36" rx="8"/><text class="sm mono" x="90" y="44">Record(broly)</text>
  <rect class="box" x="10" y="110" width="160" height="36" rx="8"/><text class="sm mono" x="90" y="128">Latest(broly)</text>
  <rect class="box" x="10" y="170" width="160" height="36" rx="8"/><text class="sm mono" x="90" y="188">Latest(goku)</text>
  <rect class="box" x="10" y="240" width="160" height="36" rx="8"/><text class="sm mono" x="90" y="258">Leaderboard()</text>
  <rect class="box energy" x="250" y="112" width="150" height="70" rx="10"/>
  <text class="sm mono" x="325" y="134">recentWrites</text><text class="sm mono" x="325" y="160">broly → now+5s</text>
  <rect class="box hot" x="490" y="30" width="140" height="70" rx="10"/><text x="560" y="56">Primary</text><text class="sm" x="560" y="78">writes + pinned</text>
  <rect class="box cool" x="490" y="196" width="140" height="70" rx="10"/><text x="560" y="222">Replica</text><text class="sm" x="560" y="244">may be stale</text>
  <line class="wire" x1="172" y1="42" x2="486" y2="56"/><text class="sm halo" x="330" y="40">write</text>
  <line class="wire dash" x1="150" y1="64" x2="270" y2="108"/><text class="sm halo" x="226" y="80">pin</text>
  <line class="wire" x1="172" y1="128" x2="246" y2="136"/>
  <line class="wire" x1="172" y1="188" x2="246" y2="168"/>
  <line class="wire good" x1="402" y1="130" x2="486" y2="84"/><text class="sm good halo" x="446" y="96">pinned</text>
  <line class="wire" x1="402" y1="164" x2="486" y2="214"/><text class="sm halo" x="462" y="180">not pinned</text>
  <line class="wire" x1="172" y1="258" x2="486" y2="244"/><text class="sm" x="330" y="274">always: a stale leaderboard is fine</text>
</svg>`,
      caption: "With replay paused, Step 4 found <code>broly</code> via <code>/fighters/broly</code> (pinned to the primary) but missing from <code>/leaderboard</code> (replica). <b>Both are correct.</b> The pin is per key on purpose: pinning every read after any write would defeat the replicas. Set the 5 s window well above your measured p99 lag.",
    },
    {
      title: "Quorums: why W + R > N reads the latest write",
      svg: `<svg class="dg" viewBox="0 0 640 228" role="img" aria-label="Left: N=3, W=2, R=2, the write set and read set overlap on node B, which has version 2. Right: W=1, R=1, the read can hit a node that never saw the write">
  <rect class="zone" x="8" y="8" width="304" height="212" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="212" rx="12"/>
  <text class="b" x="160" y="26">N=3 · W=2 · R=2</text>
  <text class="b" x="480" y="26">N=3 · W=1 · R=1</text>
  <rect class="zone" x="22" y="54" width="182" height="94" rx="10"/>
  <rect class="zone" x="118" y="76" width="180" height="96" rx="10"/>
  <text class="sm start" x="28" y="46">write → A, B</text>
  <text class="sm end" x="292" y="184">read ← B, C</text>
  <rect class="box ok" x="30" y="90" width="70" height="44" rx="8"/><text class="sm" x="65" y="112">A · v2</text>
  <rect class="box ok" x="125" y="90" width="70" height="44" rx="8"/><text class="sm" x="160" y="112">B · v2</text>
  <rect class="box dim" x="220" y="90" width="70" height="44" rx="8"/><text class="sm" x="255" y="112">C · v1</text>
  <text class="sm good" x="160" y="206">4 &gt; 3: sets overlap on B, read sees v2</text>
  <rect class="zone" x="342" y="80" width="86" height="64" rx="10"/>
  <rect class="zone" x="532" y="80" width="86" height="64" rx="10"/>
  <text class="sm" x="385" y="70">write → A</text>
  <text class="sm" x="575" y="160">read ← C</text>
  <rect class="box ok" x="350" y="90" width="70" height="44" rx="8"/><text class="sm" x="385" y="112">A · v2</text>
  <rect class="box dim" x="445" y="90" width="70" height="44" rx="8"/><text class="sm" x="480" y="112">B · v1</text>
  <rect class="box warn" x="540" y="90" width="70" height="44" rx="8"/><text class="sm" x="575" y="112">C · v1</text>
  <text class="sm bad" x="480" y="206">2 ≤ 3: no overlap, stale read possible</text>
</svg>`,
      caption: "For leaderless and multi-leader systems such as Cassandra and DynamoDB. <code>N=3, W=2, R=2</code> survives one node down and still reads the latest write. Quorums alone don't order <em>concurrent</em> writes; that needs version vectors, last-write-wins (which silently loses data) or CRDTs.",
    },
  ],
  concepts: [
    { term: "WAL shipping", plain: "The leader appends every change to its write-ahead log and streams it. Followers replay it and serve read-only queries.", why: "One mechanism behind replicas, point-in-time recovery, CDC and cross-region replication. A write to a replica fails with <code>cannot execute INSERT in a read-only transaction</code>, which is the guardrail working." },
    { term: "Sync vs async", plain: "Sync: commit waits for a follower, so there's no loss but writes are slower and stall if the follower does. Async: commit returns immediately, and anything unshipped is lost on failover.", why: "<code>ANY 1 (s1, s2, s3)</code> waits for any one standby, so one slow follower doesn't stall you. Choose per operation: the payment path sync, the analytics write not." },
    { term: "Four lag bugs", plain: "Read-your-writes (your save vanishes), monotonic reads (data moves backwards), consistent prefix (an answer before its question), cross-entity invariants (a state that never existed).", why: "Lag is milliseconds until a bulk load, a long replica query or weak hardware makes it minutes. Alert on it." },
    { term: "Four fixes", plain: "Read from the leader after a write, a sticky replica, wait for an LSN, or design it away by rendering the value you already have.", why: "Designing it away is free and faster, and it's usually the right answer, since most read-your-writes bugs are self-inflicted." },
    { term: "PACELC", plain: "If <b>P</b>artitioned, choose <b>A</b> or <b>C</b>; <b>E</b>lse, choose <b>L</b>atency or <b>C</b>onsistency.", why: "CAP describes the rare partition. The else branch is every normal day: strong consistency costs round trips on every request. DynamoDB is PA/EL, Spanner is PC/EC." },
    { term: "Split-brain", plain: "Two nodes both think they're primary and both accept writes, leaving conflicting histories with no correct merge.", why: "It happens when a network partition is mistaken for a dead node. Prevent it with consensus (Raft, Paxos, Patroni), fencing, or leases. Never with a script that pings and promotes." },
  ],
  numbers: [
    { value: "5 s", label: "read-your-writes window in the lab", note: "Set it well above your measured p99 replication lag." },
    { value: "~60 s", label: "Cloud SQL HA failover", note: "Synchronous standby, no data loss, roughly double the cost." },
    { value: "up to 10", label: "Cloud SQL read replicas", note: "Asynchronous, can be cross-region, lag exposed as <code>replica_lag</code>." },
    { value: "~100 ms", label: "cross-continent latency", note: "One price of multi-region, alongside egress and complexity. Do it for failure domains, not speed." },
  ],
  traps: [
    { myth: "\"Eventual consistency\" means it'll be fine in a moment.", truth: "Users see their own save vanish and call your app broken, and they're not wrong. Decide per endpoint what may be stale: \"leaderboard may be 5 s stale; a user's own profile may not.\"" },
    { myth: "After any write, send all reads to the primary.", truth: "Then the replicas stop earning their cost. Pin per user or per key, for a bounded window, or don't re-read at all." },
    { myth: "Failover is free with replicas.", truth: "With async replication, unshipped writes are gone. The old primary has diverged and must be rebuilt with <code>pg_rewind</code> or a fresh basebackup, never just restarted." },
    { myth: "Run the big analytics query on the replica; it can't hurt the primary.", truth: "A 10-minute query on a replica can create 10 minutes of lag, or be cancelled by <code>max_standby_streaming_delay</code>. Know which you've configured." },
    { myth: "We're \"CP\" (or \"AP\"), so that's settled.", truth: "CAP says nothing about normal operation, and the label is mostly marketing. You trade latency against consistency on every request, and you choose it per operation." },
  ],
  gcp: [
    { service: "Cloud SQL HA", role: "A synchronous standby in another zone, automatic failover in about 60 s, no data loss. Roughly doubles the cost. Assume it's required in production." },
    { service: "Cloud SQL read replicas", role: "Asynchronous, up to 10, cross-region possible, promotable for disaster recovery. Alert on <code>replica_lag</code> in Cloud Monitoring; a replica quietly hours behind is worse than none." },
    { service: "AlloyDB", role: "One primary with independently scaling read pools. Better for mixed analytical and transactional work." },
    { service: "Spanner", role: "Synchronous multi-region replication via Paxos, externally consistent, no failover to manage. TrueTime waits out clock uncertainty on commit, so you pay in hardware and latency. From ~$65/month." },
    { service: "Firestore · Bigtable", role: "Replicated automatically, with guarantees that vary: Firestore is strong for document reads and eventual for some queries. Read the specific guarantees." },
  ],
  takeaways: [
    "Alert on replication lag, with a threshold tied to what the app tolerates.",
    "Route reads explicitly and decide per query whether staleness is OK.",
    "Prefer designing away read-your-writes: render the value you already have.",
    "Know your failover RPO as a number, not a shrug.",
    "Never allow two primaries. Use fencing and consensus, not heuristics.",
    "Long replica queries delay replay.",
    "Rehearse failover. One you've never tested is a hypothesis.",
  ],
  drill: [
    { q: "Users report \"I saved it but it's not there.\" How do you diagnose and fix it?", a: [
      "Correlate reports with lag metrics, check whether the read path uses a replica, and reproduce by pausing replay. The signature is \"fails right after a write, works two seconds later.\"",
      "Fix, cheapest first: don't re-read and render what the write returned; pin that user to the primary for a few seconds; LSN-based wait; or read that endpoint from the primary. Then write down which endpoints tolerate staleness.",
    ] },
    { q: "When is synchronous replication worth the latency?", a: [
      "When losing committed data is unacceptable: payments, ledgers, orders, anything with legal or financial consequences. Each commit waits for a round trip plus the follower's fsync, so write latency roughly doubles within a region and becomes prohibitive across regions.",
      "Middle grounds: <code>ANY 1 (s1, s2, s3)</code>, or per-transaction settings so only the critical path is synchronous. Consistency is a property you choose per operation.",
    ] },
    { q: "Explain PACELC to someone who \"knows CAP\".", a: [
      "CAP only covers behaviour during a partition, which is rare. PACELC adds the normal case: <em>else</em>, latency or consistency. Strong consistency needs coordination, coordination needs round trips, and you pay for them on every request. DynamoDB is PA/EL; Spanner is PC/EC.",
    ] },
    { q: "Your leaderboard is 30 seconds stale. Is that a bug?", a: [
      "It depends on the contract, which is why the contract has to exist. Does anyone act on it? Is money involved? Does a user see their own submission missing? That last one is read-your-writes and will produce tickets even if the ranking is fine.",
      "If 30 s is fine, say so, cache it, and show \"updated 12 seconds ago\". If it isn't, read from the primary or maintain the ranking in Redis on every write.",
    ] },
    { q: "What is split-brain and how do systems prevent it?", a: [
      "Two nodes both accept writes as primary, leaving conflicting histories with no correct merge. It happens when a follower mistakes a network partition for a dead primary and promotes itself.",
      "Prevention: quorum or consensus, so a minority partition can't elect a leader; fencing (STONITH) to disable the old primary before promoting; and leases that expire, so a cut-off leader stops accepting writes on its own.",
    ] },
  ],
  connects: {
    back: "Capsule 12 listed read replicas as step three before sharding; this is it. Capsule 10's <code>max_conn_lifetime</code> exists so connections rotate after a failover, and the <code>Store</code> interface lets <code>ReplicatedStore</code> wrap <code>PostgresStore</code> with no handler changes.",
    forward: "Capsule 14's cache is another replica with its own lag, and its per-user feed comes back to read-your-writes. The WAL comes back as change data capture in Capsule 21.",
  },
});
