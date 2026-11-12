// Saga 4 · Cell Saga — Async. Recaps for capsules 18–21.
// Source of truth: capsules/18-*/README.md … capsules/21-*/README.md.

GA.thread(4, [
  "Saga 3 made reads fast, but every write was still synchronous: the caller waited for all the work and failed if any of it failed. Capsule 18 breaks that with <b>Pub/Sub</b>. The API records a reading, publishes a past-tense fact, and returns. Subscriptions react on their own time. The same capsule shows you the bill straight away: one message processed three times because the handler outran its ack deadline, and a database write that commits while its event is lost.",
  "The rest of the saga pays that bill. Capsule 19 accepts that <b>at-least-once</b> is the only delivery you get and makes duplicates harmless: a dedup marker in the same transaction as the work, version checks, dead-letter topics, idempotency keys. Capsule 20 puts the event stream to work with batching, event-time windows, and the question of whether to compute at write time or read time. Capsule 21 closes the dual-write gap with a <b>transactional outbox</b>, and uses that log of what happened to rebuild a read model by replay.",
  "You leave with three habits: treat duplicates as normal, make every consumer idempotent, and keep an append-only record you can replay. Saga 5 starts splitting the system into services, and they will talk to each other through exactly these events.",
]);

// ---------------------------------------------------------------------------

GA.recap({
  id: "18",
  tagline: "Messaging separates <em>what happened</em> from <em>what should happen because of it</em>. The caller waits only for the publish, and the subscriptions decide who hears it.",
  built: "You ran the <b>Pub/Sub emulator</b> in compose, published a <code>PowerRecorded</code> event from the API after each database write, and wrote a second binary, <code>cmd/ranker</code>, that consumes it with flow control and explicit nacks. Then you stopped the consumer and watched messages wait, added a second subscription without touching the producer, ran three instances on one subscription, and made the handler sleep past its ack deadline to see one publish executed three times.",
  story: [
    "Until now every request did all its work before responding. That means the caller waits for everything and fails if anything fails. Recording a power reading that also updates a leaderboard, notifies followers, runs fraud checks and feeds analytics turns into a 2-second request that breaks when the notification service is down. With messaging the API writes, publishes one event, and responds. Everything else reacts later.",
    "Pub/Sub is both a queue and a broadcast, and the <b>subscription</b> is where the difference lives. Many instances on one subscription compete for messages, so the work is split. Many subscriptions on one topic each get their own copy. So the design question is how many subscriptions you need: one per <em>consuming concern</em>, not one per instance.",
    "Every received message has an <b>ack deadline</b>, 10 seconds by default. If you don't ack in time, the message is redelivered, maybe to a different consumer, possibly while the first one is still working on it. In the lab, a 30-second handler produced <code>delivery_attempt=1, 2, 3</code> for a single publish. The Go client extends the deadline automatically while your callback runs, so you had to lower <code>MaxExtension</code> to see it clearly. The lesson stands: <b>at-least-once delivery is what you get</b>, and long work doesn't belong in a message handler.",
    "One seam stays open on purpose. The API writes to Postgres and <em>then</em> publishes. If the publish fails, the reading is saved and downstream never hears about it. The code logs it and moves on. That is the dual-write problem, and Capsule 21 exists to close it.",
  ],
  diagrams: [
    {
      title: "Same topic: one subscription is a queue, many is fan-out",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="The Scouter API publishes to the power-readings topic. The ranker subscription splits messages across three instances. The notifier subscription gets its own copy of every message.">
  <rect class="box hot" x="10" y="118" width="120" height="44" rx="10"/><text x="70" y="140">Scouter API</text>
  <rect class="box cool" x="170" y="118" width="130" height="44" rx="10"/><text class="sm" x="235" y="140">power-readings</text>
  <text class="xs mute" x="235" y="106">topic</text>
  <line class="wire" x1="130" y1="140" x2="166" y2="140"/>
  <rect class="box" x="350" y="52" width="110" height="40" rx="10"/><text class="sm" x="405" y="72">sub: ranker</text>
  <rect class="box" x="350" y="200" width="110" height="40" rx="10"/><text class="sm" x="405" y="220">sub: notifier</text>
  <line class="wire" x1="300" y1="130" x2="346" y2="80"/>
  <line class="wire" x1="300" y1="150" x2="346" y2="212"/>
  <rect class="box ok" x="510" y="10" width="120" height="34" rx="8"/><text class="sm" x="570" y="27">ranker #1</text>
  <rect class="box ok" x="510" y="55" width="120" height="34" rx="8"/><text class="sm" x="570" y="72">ranker #2</text>
  <rect class="box ok" x="510" y="100" width="120" height="34" rx="8"/><text class="sm" x="570" y="117">ranker #3</text>
  <line class="wire" x1="460" y1="66" x2="506" y2="30"/>
  <line class="wire" x1="460" y1="72" x2="506" y2="72"/>
  <line class="wire" x1="460" y1="78" x2="506" y2="113"/>
  <text class="xs" x="570" y="152">one instance per message</text>
  <rect class="box ok" x="510" y="203" width="120" height="34" rx="8"/><text class="sm" x="570" y="220">notifier</text>
  <line class="wire" x1="460" y1="220" x2="506" y2="220"/>
  <text class="xs" x="570" y="252">gets every message</text>
  <text class="sm mute" x="320" y="280">Copies per message = number of subscriptions, not number of consumers.</text>
</svg>`,
      caption: "Adding <code>notifier</code> needed no change to the producer: no redeploy, no restart, no config. Starting more <code>ranker</code> instances on the same subscription splits the work instead of duplicating it. That one picture is the whole mental model.",
    },
    {
      title: "Blowing through the ack deadline",
      svg: `<svg class="dg" viewBox="0 0 640 250" role="img" aria-label="Timeline: a handler that takes 30 seconds against a 10 second ack deadline is redelivered at 10 and 20 seconds, so one message runs three times concurrently">
  <line class="wire none soft" x1="215" y1="42" x2="215" y2="172" stroke-dasharray="4 4"/>
  <line class="wire none soft" x1="350" y1="42" x2="350" y2="172" stroke-dasharray="4 4"/>
  <text class="xs mute" x="215" y="30">deadline missed</text>
  <text class="xs mute" x="350" y="30">deadline missed</text>
  <text class="sm end" x="72" y="64">attempt 1</text>
  <text class="sm end" x="72" y="104">attempt 2</text>
  <text class="sm end" x="72" y="144">attempt 3</text>
  <rect class="box warn" x="80" y="52" width="405" height="24" rx="8"/><text class="sm" x="282" y="64">handle() sleeps 30 s</text>
  <text class="xs start" x="492" y="64">ack, too late</text>
  <rect class="box warn" x="215" y="92" width="405" height="24" rx="8"/><text class="sm" x="417" y="104">same message, running again</text>
  <rect class="box warn" x="350" y="132" width="270" height="24" rx="8"/><text class="sm" x="485" y="144">and again</text>
  <line class="axis" x1="80" y1="182" x2="620" y2="182"/>
  <text class="xs mute" x="80" y="198">0 s</text>
  <text class="xs mute" x="215" y="198">10 s</text>
  <text class="xs mute" x="350" y="198">20 s</text>
  <text class="xs mute" x="485" y="198">30 s</text>
  <text class="xs mute" x="620" y="198">40 s</text>
  <text class="sm bad" x="320" y="232">One publish, three executions. If handle() charged a card, it charged three times.</text>
</svg>`,
      caption: "The Go client normally extends the deadline while your callback runs, which is why the lab lowers <code>MaxExtension</code> to show this. The fixes: nack explicitly on failure, raise the deadline if you must, and best of all keep the handler fast by recording the intent and doing the slow part somewhere else.",
    },
    {
      title: "Sync vs async: what the caller waits for",
      svg: `<svg class="dg" viewBox="0 0 640 240" role="img" aria-label="Synchronous: the caller waits for the DB write and five follow-up tasks in sequence. Asynchronous: the caller waits for the DB write and the publish, and the follow-ups run later in parallel">
  <text class="b start" x="20" y="22">Synchronous: the caller waits for everything</text>
  <rect class="box" x="20" y="38" width="100" height="32" rx="8"/><text class="sm" x="70" y="54">DB write</text>
  <rect class="box warn" x="120" y="38" width="100" height="32" rx="8"/><text class="sm" x="170" y="54">leaderboard</text>
  <rect class="box warn" x="220" y="38" width="100" height="32" rx="8"/><text class="sm" x="270" y="54">notify</text>
  <rect class="box warn" x="320" y="38" width="100" height="32" rx="8"/><text class="sm" x="370" y="54">fraud check</text>
  <rect class="box warn" x="420" y="38" width="100" height="32" rx="8"/><text class="sm" x="470" y="54">analytics</text>
  <rect class="box warn" x="520" y="38" width="100" height="32" rx="8"/><text class="sm" x="570" y="54">search index</text>
  <text class="sm bad start" x="20" y="88">≈ 2 s, and the request fails if the notification service is down</text>
  <text class="b start" x="20" y="124">Asynchronous: the caller waits for the publish</text>
  <rect class="box" x="20" y="140" width="100" height="32" rx="8"/><text class="sm" x="70" y="156">DB write</text>
  <rect class="box cool" x="120" y="140" width="70" height="32" rx="8"/><text class="sm" x="155" y="156">publish</text>
  <text class="sm good start" x="200" y="156">201 Created</text>
  <line class="wire soft" x1="155" y1="172" x2="196" y2="196"/>
  <rect class="box dim" x="200" y="186" width="80" height="26" rx="8"/><text class="xs" x="240" y="199">leaderboard</text>
  <rect class="box dim" x="284" y="186" width="80" height="26" rx="8"/><text class="xs" x="324" y="199">notify</text>
  <rect class="box dim" x="368" y="186" width="80" height="26" rx="8"/><text class="xs" x="408" y="199">fraud check</text>
  <rect class="box dim" x="452" y="186" width="80" height="26" rx="8"/><text class="xs" x="492" y="199">analytics</text>
  <rect class="box dim" x="536" y="186" width="84" height="26" rx="8"/><text class="xs" x="578" y="199">search index</text>
  <text class="xs mute start" x="20" y="230">later, in parallel: a consumer that's down means messages wait, not a failed request</text>
</svg>`,
      caption: "The queue is also a shock absorber: a 10× burst turns into a backlog that drains over a few minutes instead of an outage. The price is eventual consistency, harder debugging and duplicate delivery.",
    },
  ],
  concepts: [
    { term: "Queue vs topic, decided by the subscription", plain: "One subscription with many consumer instances is a queue: competing consumers share the work. Many subscriptions on one topic is fan-out: each gets a copy.", why: "\"How many subscriptions?\" is the real design question. The answer is one per consuming concern, never one per instance." },
    { term: "Events are past-tense facts", plain: "<code>PowerRecorded</code>, not <code>UpdateLeaderboard</code>. The event carries an <code>event_id</code> and a <code>version</code> from day one.", why: "A command couples the publisher to whoever obeys it. A fact lets anyone react. Retrofitting a version onto a topic with live consumers is miserable." },
    { term: "Attributes vs payload", plain: "Routing metadata such as <code>event_type</code> and <code>fighter</code> goes in message attributes. The data goes in the body.", why: "Subscription filters run on attributes only, so subscribers can filter without decoding the payload." },
    { term: "Push vs pull", plain: "Pull: the consumer asks for messages at its own rate (streaming pull is the Go default). Push: Pub/Sub POSTs to your HTTPS endpoint and slows down on 429/5xx.", why: "Push suits Cloud Run and scale-to-zero. Pull gives finer control and generally higher throughput." },
    { term: "Ack deadline, nack, flow control", plain: "Ack within the deadline (10 s default) or the message comes back. Nack on failure for immediate redelivery. Cap work in flight with <code>MaxOutstandingMessages</code> / <code>Bytes</code>.", why: "Waiting out the deadline is a 10-second stall. Without flow control, a big backlog is pulled into memory at once and you OOM." },
    { term: "Ordering keys", plain: "Messages with the same key arrive in publish order; different keys stay parallel. Without keys Pub/Sub guarantees no order, and with them the publisher client needs <code>EnableMessageOrdering = true</code>.", why: "Ordering caps per-key throughput, pins to a region, and a stuck message blocks its key. Usually it's better to add a version and have consumers ignore stale events." },
    { term: "Backlog as the scaling signal", plain: "For a consumer, <code>num_undelivered_messages</code> says when to scale, and <b>oldest unacked message age</b> is your real end-to-end lag.", why: "Backlog is a leading indicator and CPU a lagging one. Alert on the age, not just the size." },
  ],
  numbers: [
    { value: "10 s", label: "Default ack deadline", note: "A slower handler gets redelivered while it's still running." },
    { value: "400 / s", label: "Backlog growth (500 in, 100 out)", note: "About 1.4 million messages an hour when consumers can't keep up." },
    { value: "7 days", label: "Default retention", note: "Nothing is lost while you catch up, but the data grows staler." },
    { value: "10 GiB / month", label: "Pub/Sub free tier", note: "The lab uses a few kilobytes, so running it on real Pub/Sub once is free." },
  ],
  traps: [
    { myth: "One subscription per consumer instance.", truth: "That gives every instance its own copy, so the work is duplicated, not shared. Scale a concern by adding instances to its one subscription." },
    { myth: "I set an ordering key and created the topic, so ordering is on.", truth: "<code>EnableMessageOrdering</code> is a <b>publisher client</b> setting. Without it every publish fails. Because the API logs publish errors and still returns 201, you see success and the ranker silently receives nothing." },
    { myth: "Slow handlers just take longer.", truth: "Past the ack deadline the message is redelivered while the first run is still going. The work can repeat and never finish. Move long work behind another queue or into a job." },
    { myth: "A message that keeps failing will eventually get through.", truth: "A poison message fails the same way every time, burns throughput on every redelivery, and with ordering keys blocks its key. It needs a dead-letter topic (Capsule 19)." },
    { myth: "The consumer missed messages, so the emulator is broken.", truth: "A subscription only receives messages published <em>after</em> it exists, and the emulator keeps state in memory, so topics vanish on restart. That's what <code>scripts/pubsub-setup.sh</code> is for." },
  ],
  gcp: [
    { service: "Pub/Sub", role: "Serverless topics and subscriptions with 7-day retention. Your Go code runs unchanged against it: unset <code>PUBSUB_EMULATOR_HOST</code> and use real credentials." },
    { service: "Push subscriptions to Cloud Run", role: "<code>--push-auth-service-account</code> makes Pub/Sub send a signed OIDC token. With <code>--no-allow-unauthenticated</code> the endpoint isn't publicly callable at all." },
    { service: "Subscription filters", role: "<code>--message-filter</code> on attributes, e.g. only Goku and Vegeta, so one topic can serve narrow consumers." },
    { service: "Cloud Tasks · Eventarc · Pub/Sub Lite", role: "Cloud Tasks for targeted \"call this endpoint later\" work with per-queue rate limits. Eventarc routes GCP service events to Cloud Run. Pub/Sub Lite is cheaper and zonal, and you manage capacity." },
  ],
  takeaways: [
    "Async when the caller doesn't need the result. The test: if this step failed, should the user's request fail?",
    "Same topic and one subscription is a queue. Same topic and many subscriptions is fan-out.",
    "Events are versioned, past-tense facts. Routing metadata goes in attributes.",
    "Set flow control, nack explicitly, and keep handlers fast.",
    "At-least-once delivery is the reality. Plan for duplicates.",
    "Autoscale on backlog and alert on oldest-unacked-message age.",
    "Publishing after commit leaves a gap where the event can be lost. Know it's there.",
  ],
  drill: [
    { q: "When should an operation be asynchronous rather than synchronous?", a: [
      "Async when the caller doesn't need the result (email, index update, analytics), when the work is slow or variable, when it can fail and be retried without the user caring, when you need to absorb bursts, or when several independent consumers care about the same event.",
      "Sync when the caller needs the result to continue, the user expects immediate confirmation, it's a read, or it must be strongly consistent with something else. The test: \"if this step failed, should the user's request fail?\" If not, it's a candidate for async. You pay with eventual consistency, harder debugging, duplicates and ordering questions.",
    ] },
    { q: "Consumers handle 100 msg/s, the producer publishes 500 msg/s. What happens, and what do you do?", a: [
      "The backlog grows by 400/s, about 1.4 million an hour. Pub/Sub keeps them for 7 days by default, so nothing is lost, but lag grows without bound.",
      "Add instances on the <em>same</em> subscription and autoscale on <code>num_undelivered_messages</code>, not CPU. Make each message cheaper: batch writes, remove an N+1, move slow work behind another queue. Check for one hot ordering key, which no amount of scaling fixes. Alert on <code>oldest_unacked_message_age</code>.",
    ] },
    { q: "Should you use ordering keys?", a: [
      "Some domains need them: balance changes, state-machine transitions, CDC streams. But ordering serialises per key, caps throughput, lets one stuck message block its key, and pins publishing to a region.",
      "Most of the time, make consumers order-independent instead: carry a version or timestamp and ignore anything older than what's already applied. It's a few lines, works on any transport, and survives replay and duplicates. If you can't design ordering away, use the narrowest key you can.",
    ] },
    { q: "Pub/Sub vs Cloud Tasks vs Kafka?", a: [
      "Broadcast to unknown consumers is Pub/Sub: serverless, 7-day retention, the default on GCP. A targeted job (\"call this endpoint at this time, at this rate, with these retries\") is Cloud Tasks. A durable, replayable log where consumers track their own offsets and can rewind weeks of history is Kafka, at real operational cost.",
    ] },
    { q: "A message keeps failing and being redelivered forever. What's wrong?", a: [
      "It's a poison message: a malformed payload, an unknown schema, a deleted row it refers to. It fails every time, eats throughput on each redelivery, and with ordering keys blocks everything behind it.",
      "Attach a dead-letter topic with <code>--max-delivery-attempts=5</code>, alert on its depth, send permanent failures straight there, and never silently ack a failure you didn't handle.",
    ] },
  ],
  connects: {
    back: "Capsule 10 gave you the database the event follows. Capsule 17's unbounded-queue lesson comes back as consumer flow control, and Capsule 06's \"scale on concurrency\" becomes \"scale on backlog\" for consumers.",
    forward: "Capsule 19 makes the triple delivery you just caused harmless, and builds the dead-letter topic properly. Capsule 21 closes the publish-after-commit gap with a transactional outbox.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "19",
  tagline: "Exactly-once delivery doesn't exist end to end. Stop trying to prevent duplicates and make them harmless: at-least-once plus an idempotent consumer is effectively-once.",
  built: "You gave the ranker a running-total handler and published one event three times: <b>27003, count 3</b>, with no error. Then you made it idempotent by claiming the <code>event_id</code> in <code>processed_events</code> inside the same transaction as the work (<b>9001, count 1</b>). You wrote a version-check variant, attached a dead-letter topic with 5 max attempts and split permanent from transient failures, and added an <code>Idempotency-Key</code> header to <code>POST /readings</code>.",
  story: [
    "Capsule 18 ended with one message processed three times. That wasn't an emulator bug. It is the guarantee you have. A consumer has to do the work and then acknowledge it, and those two steps can't be one atomic operation across a network. Crash after the work and the message comes back. Ack first and crash, and the work is lost. You choose which failure you'd rather have, and the sane choice is duplicates.",
    "Duplicates do damage quietly. In the lab a single event, delivered three times to a handler that adds to a running total, tripled Goku's power. Nothing errored and nothing alerted. The fix is to claim the event: insert its id into <code>processed_events</code> with <code>ON CONFLICT DO NOTHING</code>, and if no row was inserted, stop and ack. <b>The marker and the work must commit in the same transaction</b>, or you're back to the original bug.",
    "When events carry a monotonic version per entity, there's a better pattern: <code>UPDATE … WHERE last_version &lt; incoming</code>. A duplicate or an out-of-order event simply doesn't match and changes nothing. One clause gives you idempotency <em>and</em> order-independence, with no extra table to prune. It only fits \"set to this state\" updates, not deltas.",
    "Some messages will never succeed. A <b>dead-letter topic</b> takes them after N attempts, but only if you classify failures: a malformed payload should go there on attempt 1, a database timeout should be retried. And the same thinking applies to HTTP. A client that retries a POST sends an <code>Idempotency-Key</code>, and the server replays the stored response instead of creating a second record.",
  ],
  diagrams: [
    {
      title: "Why exactly-once delivery is impossible",
      svg: `<svg class="dg" viewBox="0 0 640 240" role="img" aria-label="Two orderings: process then ack, with a crash before the ack, gives a duplicate. Ack then process, with a crash before the work, gives a loss.">
  <text class="b start" x="20" y="22">Process, then ack</text>
  <rect class="box" x="20" y="36" width="120" height="40" rx="10"/><text x="80" y="56">process</text>
  <rect class="box warn" x="175" y="36" width="120" height="40" rx="10"/><text x="235" y="56">crash</text>
  <rect class="box dim" x="330" y="36" width="130" height="40" rx="10"/><text class="sm" x="395" y="56">ack never sent</text>
  <rect class="box warn" x="495" y="36" width="130" height="40" rx="10"/><text class="sm" x="560" y="56">redelivered</text>
  <line class="wire" x1="140" y1="56" x2="171" y2="56"/>
  <line class="wire" x1="295" y1="56" x2="326" y2="56"/>
  <line class="wire bad" x1="460" y1="56" x2="491" y2="56"/>
  <text class="sm bad" x="560" y="92">DUPLICATE</text>
  <text class="b start" x="20" y="128">Ack, then process</text>
  <rect class="box" x="20" y="142" width="120" height="40" rx="10"/><text x="80" y="162">ack</text>
  <rect class="box warn" x="175" y="142" width="120" height="40" rx="10"/><text x="235" y="162">crash</text>
  <rect class="box dim" x="330" y="142" width="130" height="40" rx="10"/><text class="sm" x="395" y="162">work never done</text>
  <rect class="box warn" x="495" y="142" width="130" height="40" rx="10"/><text class="sm" x="560" y="162">gone for good</text>
  <line class="wire" x1="140" y1="162" x2="171" y2="162"/>
  <line class="wire" x1="295" y1="162" x2="326" y2="162"/>
  <line class="wire bad" x1="460" y1="162" x2="491" y2="162"/>
  <text class="sm bad" x="560" y="198">LOSS</text>
  <text class="sm mute" x="320" y="228">No order of these two steps is safe. Choose duplicates, then make them harmless.</text>
</svg>`,
      caption: "That's why \"exactly-once\" always means something narrower: an idempotent consumer on top of at-least-once, a transaction inside one system (Kafka), or Pub/Sub's exactly-once subscriptions, which narrow the window but still redeliver after a crash between your write and your ack.",
    },
    {
      title: "Three deliveries of one event",
      svg: `<svg class="dg" viewBox="0 0 640 280" role="img" aria-label="Left: the naive handler adds the power on each of three deliveries, ending at 27003 with count 3. Right: the idempotent handler claims the event id, applies once, and skips the two duplicates, ending at 9001 with count 1.">
  <rect class="zone" x="8" y="8" width="304" height="264" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="264" rx="12"/>
  <text class="b" x="160" y="30">HandleNaive</text>
  <text class="b" x="480" y="30">Handle: claim + work, one tx</text>
  <rect class="box" x="24" y="50" width="272" height="30" rx="8"/><text class="sm" x="160" y="65">delivery 1: total += 9001</text>
  <rect class="box warn" x="24" y="88" width="272" height="30" rx="8"/><text class="sm" x="160" y="103">delivery 2: total += 9001</text>
  <rect class="box warn" x="24" y="126" width="272" height="30" rx="8"/><text class="sm" x="160" y="141">delivery 3: total += 9001</text>
  <text class="b bad" x="160" y="190">goku · 27003 · count 3</text>
  <text class="sm bad" x="160" y="216">no error, no alert</text>
  <text class="xs mute" x="160" y="244">the shape of most duplicate incidents</text>
  <rect class="box ok" x="344" y="50" width="272" height="30" rx="8"/><text class="sm" x="480" y="65">delivery 1: claim inserted → apply</text>
  <rect class="box" x="344" y="88" width="272" height="30" rx="8"/><text class="sm" x="480" y="103">delivery 2: claim conflicts → skip</text>
  <rect class="box" x="344" y="126" width="272" height="30" rx="8"/><text class="sm" x="480" y="141">delivery 3: claim conflicts → skip</text>
  <text class="b good" x="480" y="190">goku · 9001 · count 1</text>
  <text class="sm good" x="480" y="216">a duplicate is not an error: ack it</text>
  <text class="xs mute" x="480" y="244">RowsAffected() == 0 means already applied</text>
</svg>`,
      caption: "Put the claim in its own transaction and two things can go wrong. Claim, then crash: the event is marked done and never applied, which is silent loss. Work, then crash before the claim: it repeats. Only one transaction for both is safe, which is also why the work has to live in the same database as the marker.",
    },
    {
      title: "The version check: idempotent and order-independent",
      svg: `<svg class="dg" viewBox="0 0 640 220" role="img" aria-label="Four events arrive in order: version 100 applies over 0, version 200 applies over 100, a duplicate 200 is ignored, and a late 150 is ignored">
  <line class="wire soft" x1="20" y1="24" x2="616" y2="24"/>
  <text class="xs mute start halo" x="20" y="14">arrival order</text>
  <rect class="box ok" x="20" y="44" width="140" height="112" rx="10"/>
  <text class="xs mute" x="90" y="64">first event</text>
  <text x="90" y="88">incoming 100</text>
  <text class="sm" x="90" y="112">stored 0</text>
  <text class="sm good" x="90" y="136">applied → 100</text>
  <rect class="box ok" x="173" y="44" width="140" height="112" rx="10"/>
  <text class="xs mute" x="243" y="64">newer</text>
  <text x="243" y="88">incoming 200</text>
  <text class="sm" x="243" y="112">stored 100</text>
  <text class="sm good" x="243" y="136">applied → 200</text>
  <rect class="box dim" x="326" y="44" width="140" height="112" rx="10"/>
  <text class="xs mute" x="396" y="64">duplicate</text>
  <text x="396" y="88">incoming 200</text>
  <text class="sm" x="396" y="112">stored 200</text>
  <text class="sm mute" x="396" y="136">ignored</text>
  <rect class="box dim" x="479" y="44" width="140" height="112" rx="10"/>
  <text class="xs mute" x="549" y="64">older, arrived late</text>
  <text x="549" y="88">incoming 150</text>
  <text class="sm" x="549" y="112">stored 200</text>
  <text class="sm mute" x="549" y="136">ignored</text>
  <text class="sm mono" x="320" y="184">… WHERE fighter_ranks.last_version &lt; EXCLUDED.last_version</text>
  <text class="xs mute" x="320" y="208">These four cases are exactly the table in ranker_test.go.</text>
</svg>`,
      caption: "No extra table, nothing to prune, and a redelivery that arrives after a newer event is handled correctly. It needs a monotonic version per entity (the lab uses <code>RecordedAt.UnixNano()</code>) and a \"set to this state\" update. For deltas and side effects, like charging a card, keep the processed-events table.",
    },
    {
      title: "Dead-lettering: classify the failure first",
      svg: `<svg class="dg" viewBox="0 0 640 250" role="img" aria-label="A failing message is classified. Permanent failures are acked and copied to the dead-letter topic on attempt 1. Transient failures are nacked and retried, and Pub/Sub moves them to the dead-letter topic after 5 attempts.">
  <rect class="box" x="10" y="102" width="100" height="40" rx="10"/><text x="60" y="122">message</text>
  <rect class="box hot" x="150" y="102" width="110" height="40" rx="10"/><text x="205" y="122">handler</text>
  <line class="wire" x1="110" y1="122" x2="146" y2="122"/>
  <rect class="box warn" x="300" y="22" width="180" height="50" rx="10"/>
  <text x="390" y="40">permanent</text><text class="xs" x="390" y="59">malformed, unknown schema</text>
  <rect class="box" x="300" y="172" width="180" height="50" rx="10"/>
  <text x="390" y="190">transient</text><text class="xs" x="390" y="209">DB timeout, network blip</text>
  <line class="wire" x1="260" y1="112" x2="296" y2="60"/>
  <line class="wire" x1="260" y1="132" x2="296" y2="184"/>
  <path class="wire" d="M 300 214 C 250 238, 205 210, 205 146"/>
  <text class="xs halo" x="236" y="232">nack → retry</text>
  <rect class="box energy" x="512" y="100" width="124" height="44" rx="10"/><text class="sm" x="574" y="122">dead-letter topic</text>
  <line class="wire bad" x1="480" y1="52" x2="540" y2="96"/>
  <text class="xs start" x="520" y="56">ack + copy, attempt 1</text>
  <line class="wire bad" x1="480" y1="192" x2="540" y2="148"/>
  <text class="xs start" x="520" y="192">after 5 attempts</text>
</svg>`,
      caption: "Every production subscription gets one, and an alert on depth &gt; 0: a dead-letter topic nobody watches is a silent data-loss channel. Keep enough to replay: the message, the error, the attempt count, the time. In real Pub/Sub the service agent needs publish rights on the DLQ topic, or it silently stays empty. The emulator's DLQ support is partial, so verify on the real thing.",
    },
  ],
  concepts: [
    { term: "At-most / at-least / exactly-once", plain: "At-most-once loses messages. At-least-once duplicates them. Exactly-once delivery doesn't exist end to end.", why: "\"Exactly-once\" claims are always bounded: inside one system's transaction, or within an ack deadline. Ask \"within what boundary?\"" },
    { term: "Effectively-once", plain: "At-least-once delivery plus a consumer for which a second application changes nothing.", why: "It's what you can actually build, and it's genuinely correct. Exactly-once <em>processing</em> comes from the consumer, not the transport." },
    { term: "Four ways to be idempotent", plain: "Absolute writes (<code>SET power = 9001</code>, not <code>+ 100</code>); a unique constraint with <code>ON CONFLICT DO NOTHING</code>; a processed-messages table; an idempotency key on the API.", why: "The unique constraint is cheap and airtight across processes and restarts, and is usually the right answer." },
    { term: "Marker and work in one transaction", plain: "The dedup row and the effect commit together or not at all.", why: "Marker first, then crash: silent loss. Work first, then crash: the duplicate is back. If the work is an external call, you need the external system to dedupe instead." },
    { term: "Version check", plain: "<code>WHERE last_version &lt; incoming</code> applies only newer events.", why: "Idempotent and order-independent in one clause, since redelivery can put message 5 after message 6. The most useful pattern in the capsule." },
    { term: "Permanent vs transient failure", plain: "Permanent (bad payload, rejected by a business rule): ack and dead-letter now. Transient (timeout, blip): nack and retry.", why: "Retrying a malformed payload five times helps nobody, and a retry policy with min/max delay gives transport-level backoff for the rest." },
    { term: "Idempotency-Key", plain: "The client sends a key; the server stores key → response and replays it on a repeat, with <code>Idempotency-Replayed: true</code>.", why: "It's how Stripe's API works. Store keys durably (Redis or the DB, not process memory), and insert the key first under a unique constraint so concurrent repeats get a 409 or wait." },
  ],
  numbers: [
    { value: "27003 → 9001", label: "One event, three deliveries", note: "Triple-counted with the naive handler; applied once with the claim." },
    { value: "5 attempts", label: "maxDeliveryAttempts", note: "Before Pub/Sub moves a transient failure to the dead-letter topic." },
    { value: "> 7 days", label: "processed_events retention", note: "Must outlive the broker's retention, or a backlog redelivery slips through." },
    { value: "~1 hour", label: "Cloud Tasks name dedup", note: "Useful, but the window is a real limit, like BigQuery's insertId." },
  ],
  traps: [
    { myth: "Our broker has exactly-once delivery, so the handler needn't be idempotent.", truth: "Ask what happens if your consumer commits to its database and crashes before acking. It's redelivered. Pub/Sub's exactly-once subscriptions are defence in depth, never a substitute." },
    { myth: "Insert the dedup marker, then do the work.", truth: "Crash in between and the event is marked processed but never applied, and will never be retried. Silent loss, the worst of the three outcomes." },
    { myth: "Store idempotency keys in a map in the service.", truth: "Another replica won't see them (Capsule 06). And check-then-insert lets two concurrent requests both create. Insert first and let a unique constraint arbitrate." },
    { myth: "A DLQ that exists is a DLQ that works.", truth: "Without publish rights for the Pub/Sub service agent it stays empty, and without an alert on depth &gt; 0 nobody notices what lands there." },
    { myth: "The version check never applies anything, so the pattern is broken.", truth: "Usually <code>last_version</code> was initialised higher than incoming versions, or you're comparing different units (ns vs s)." },
  ],
  gcp: [
    { service: "Exactly-once subscriptions", role: "<code>--enable-exactly-once-delivery</code> removes duplicates within the ack deadline, at lower throughput. A crash after your write and before the ack still redelivers." },
    { service: "Dead-letter topics", role: "Need <code>roles/pubsub.publisher</code> on the DLQ topic and <code>roles/pubsub.subscriber</code> on the source subscription, both for the Pub/Sub service agent." },
    { service: "Retry policy", role: "<code>--min-retry-delay</code> / <code>--max-retry-delay</code>: exponential backoff between redeliveries, Capsule 17's idea at the transport." },
    { service: "Cloud Tasks · BigQuery insertId", role: "Both dedupe within a window (about an hour; a few minutes). They narrow the gap, they don't close it." },
  ],
  takeaways: [
    "Assume duplicates. Design the handler, not the transport.",
    "Every event carries a stable <code>event_id</code> generated by the producer.",
    "The dedup marker and the work commit in the same transaction.",
    "Prefer a version check when you have a natural version: it also handles out-of-order delivery.",
    "Prune <code>processed_events</code>, with retention longer than the broker's.",
    "A DLQ on every subscription, an alert on depth &gt; 0, and permanent vs transient classification.",
    "<code>Idempotency-Key</code> on every non-idempotent public endpoint, stored durably.",
  ],
  drill: [
    { q: "A vendor says their queue offers exactly-once delivery. What do you ask?", a: [
      "\"Within what boundary?\" Consume-and-produce inside their own system can be atomic, like Kafka's transactional semantics. The moment your consumer writes to Postgres, sends an email or calls an API, that effect is outside the transaction.",
      "Then: \"what happens if my consumer commits and crashes before acking?\" There's no answer that avoids redelivery. Exactly-once delivery is impossible; exactly-once processing comes from an idempotent consumer.",
    ] },
    { q: "Why must the dedup marker and the work be in one transaction?", a: [
      "Marker first, then a crash: the work never happens and the event is deduped forever, which is silent loss. Work first, then a crash: redelivery repeats the work. In one transaction, either both commit or neither does, and redelivery does it cleanly.",
      "So the work must live in the same database as the marker. For an external call, make it idempotent with a key derived from the event id, or use a saga with compensation.",
    ] },
    { q: "Design idempotency for \"send a welcome email\".", a: [
      "Email is external, so no transaction spans it. Best: a provider idempotency key derived from the event, like <code>welcome:{user_id}</code>. Otherwise a <code>sent_emails</code> table keyed on <code>(user_id, template)</code>, inserted before sending, with a deliberate choice about whether a failed send rolls back (risk a duplicate) or keeps the row (risk a never-sent email plus an alert).",
      "Keep the send fast so the crash window is tiny, and accept the residual risk for something harmless. A duplicate invoice is a different matter. When the effect is external, idempotency belongs to the system that owns the effect.",
    ] },
    { q: "Your DLQ has 50,000 messages. What now?", a: [
      "Don't replay yet. Sample about 20 and group by error; it's usually two or three causes. Correlate with deploys. Work out what didn't happen and how much it matters. Fix the consumer and verify on a few messages.",
      "Then replay with a rate-limited job, relying on the idempotency you built. And ask in the postmortem why the alert didn't fire at message 1. Watch the DLQ's own retention: day 6 of 7 changes the priorities.",
    ] },
    { q: "Processed-events table or version check?", a: [
      "The table works for any event, including deltas and side effects, but it grows, must be pruned, needs a transaction around marker and work, and doesn't fix out-of-order delivery.",
      "The version check needs no table and handles duplicates and ordering in one <code>WHERE</code>, but requires a monotonic version and \"set to this state\" updates. Use it for projections, views, caches and indexes, and the table for counters, charges and notifications. Many systems use both.",
    ] },
  ],
  connects: {
    back: "Capsule 18 produced the triple delivery and left the dual-write seam open. Capsule 06 is why idempotency keys can't live in process memory, and Capsule 17's backoff reappears as Pub/Sub's retry policy.",
    forward: "Capsule 20 reuses the version-check idea for a Redis leaderboard and makes its batch job re-runnable. Capsule 21's relay publishes at-least-once, and replaying the whole outbox only works because these consumers are idempotent.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "20",
  tagline: "Aggregation comes down to one question: compute at write time or at read time? Then ask what latency the business actually needs. Very often the answer is \"by 9am tomorrow\", and that's a cron job.",
  built: "You wrote a generic <b>size-or-time batcher</b> and flushed events with Postgres <code>COPY</code>, comparing throughput at <code>maxSize=1</code> and <code>500</code>. You built an event-time <b>tumbling-window aggregator</b> with a lateness allowance and sent it a late event. You maintained the leaderboard on write with a Redis sorted set and load-tested it against the on-read query with k6. Then you wrote <code>cmd/dailyroll</code>, an idempotent daily rollup that's safe to re-run for any day.",
  story: [
    "Once events flow, you need totals, rankings and daily numbers from them. Recomputing on every read doesn't scale, and neither does doing all the work on every write. Most of this capsule is about choosing where the work happens and being able to state the trade.",
    "The cheapest win comes first: <b>batching</b>. A thousand single-row INSERTs are a thousand round trips. One batched write is one. Flush on size <em>or</em> time, whichever comes first, because size alone stalls when traffic is quiet and time alone doesn't help under load. Flush on shutdown too, or every deploy drops the last partial batch.",
    "Streams never end, so aggregates need <b>windows</b>, and windows force a choice between event time and processing time. Event time is correct but means deciding how long to wait for stragglers. The lateness allowance is a correctness-versus-freshness dial. Anything later than that is late data, and you must pick deliberately what happens to it.",
    "Fan-out on write precomputes the answer (a sorted set updated per event), so reads are cheap and writes cost a little more. Fan-out on read stores once and does the work per read. Real feeds use both, split by the shape of the distribution. And when a daily number is all anyone needs, a scheduled batch job is simpler, cheaper and easier to fix than a stream.",
  ],
  diagrams: [
    {
      title: "Batching: the cheapest win in the course",
      svg: `<svg class="dg" viewBox="0 0 640 260" role="img" aria-label="1000 single inserts take about 2000 milliseconds in 1000 round trips; one batched insert takes about 15 milliseconds. Below, a busy stream flushes on size and a quiet one flushes on time.">
  <text class="b start" x="20" y="20">1,000 messages, one INSERT each</text>
  <rect class="box warn" x="20" y="34" width="600" height="34" rx="8"/><text x="320" y="51">1,000 round trips ≈ 2,000 ms</text>
  <text class="b start" x="20" y="94">1,000 messages, one batched write</text>
  <rect class="fill-good" x="20" y="108" width="5" height="34"/>
  <text class="start" x="36" y="125">1 round trip ≈ 15 ms</text>
  <line class="wire none soft" x1="20" y1="162" x2="620" y2="162"/>
  <text class="sm start" x="20" y="186">busy</text>
  <circle class="dot" cx="80" cy="186" r="4"/><circle class="dot" cx="92" cy="186" r="4"/><circle class="dot" cx="104" cy="186" r="4"/><circle class="dot" cx="116" cy="186" r="4"/><circle class="dot" cx="128" cy="186" r="4"/><circle class="dot" cx="140" cy="186" r="4"/><circle class="dot" cx="152" cy="186" r="4"/><circle class="dot" cx="164" cy="186" r="4"/>
  <text class="sm start" x="176" y="186">… 500 reached → flush on size</text>
  <text class="sm start" x="20" y="222">quiet</text>
  <circle class="dot" cx="80" cy="222" r="4"/><circle class="dot" cx="140" cy="222" r="4"/><circle class="dot" cx="230" cy="222" r="4"/>
  <line class="wire none soft" x1="300" y1="210" x2="300" y2="234"/>
  <text class="sm start" x="312" y="222">200 ms tick → flush 3 on time</text>
  <text class="xs mute start" x="20" y="252">The ticker is what stops a quiet consumer holding messages forever.</text>
</svg>`,
      caption: "The capsule's illustrative numbers; the lab asks you to expect 10–50× more throughput between <code>maxSize=1</code> and <code>500</code>. The catch: a crash loses the unflushed batch, so the work must be idempotent and replayable from unacked messages, and <code>Close()</code> must run on SIGTERM. <code>COPY</code> can't do <code>ON CONFLICT</code>, so for upserts you load a temp table and merge.",
    },
    {
      title: "Tumbling windows, event time and late data",
      svg: `<svg class="dg" viewBox="0 0 640 260" role="img" aria-label="One-minute windows from 10:00. With now at 10:04:30 and a 2 minute lateness allowance, windows starting before 10:02 are closed and emitted. An event with event time 10:00:40 arriving now belongs to a closed window and is late data.">
  <line class="wire none soft" x1="325" y1="40" x2="325" y2="152" stroke-dasharray="4 4"/>
  <text class="xs mute" x="325" y="28">watermark: now − 2 min</text>
  <line class="wire none" x1="545" y1="40" x2="545" y2="152"/>
  <text class="xs" x="545" y="28">now 10:04:30</text>
  <rect class="box dim" x="50" y="60" width="106" height="56" rx="8"/><text class="xs" x="103" y="104">closed · emitted</text>
  <rect class="box dim" x="160" y="60" width="106" height="56" rx="8"/><text class="xs" x="213" y="104">closed · emitted</text>
  <rect class="box cool" x="270" y="60" width="106" height="56" rx="8"/><text class="xs" x="323" y="104">open</text>
  <rect class="box cool" x="380" y="60" width="106" height="56" rx="8"/><text class="xs" x="433" y="104">open</text>
  <rect class="box cool" x="490" y="60" width="106" height="56" rx="8"/><text class="xs" x="543" y="104">open</text>
  <circle class="dot" cx="80" cy="80" r="4"/><circle class="dot" cx="120" cy="80" r="4"/><circle class="dot" cx="190" cy="80" r="4"/><circle class="dot" cx="230" cy="80" r="4"/><circle class="dot" cx="300" cy="80" r="4"/><circle class="dot" cx="350" cy="80" r="4"/><circle class="dot" cx="410" cy="80" r="4"/><circle class="dot" cx="470" cy="80" r="4"/><circle class="dot" cx="520" cy="80" r="4"/>
  <text class="xs mute" x="50" y="132">10:00</text><text class="xs mute" x="160" y="132">10:01</text><text class="xs mute" x="270" y="132">10:02</text><text class="xs mute" x="380" y="132">10:03</text><text class="xs mute" x="490" y="132">10:04</text><text class="xs mute" x="600" y="132">10:05</text>
  <circle class="dot bad" cx="545" cy="180" r="6"/>
  <text class="sm bad end" x="534" y="200">arrives now, event time 10:00:40</text>
  <path class="wire bad" d="M 538 180 C 300 186, 110 178, 103 122"/>
  <text class="sm bad" x="170" y="204">late: its window already closed</text>
  <text class="sm mute" x="320" y="240">Drop it and count it · emit a correction · send it to a side output. Pick one.</text>
</svg>`,
      caption: "The aggregator buckets by <code>RecordedAt</code>, the event time, which is what makes replay correct. <code>CloseExpired</code> emits and deletes windows older than <code>now − lateness</code>, so memory stays bounded. The lab's late event is 10 minutes old against a 2-minute allowance. If you drop late data, emit a metric: silent drops are how you get numbers nobody trusts.",
    },
    {
      title: "The leaderboard, computed on read vs on write",
      svg: `<svg class="dg" viewBox="0 0 640 270" role="img" aria-label="On read: writes are a cheap insert and every read scans, sorts and aggregates. On write: each event also does a ZADD to a Redis sorted set, and a read is a single ZREVRANGE.">
  <rect class="zone" x="8" y="8" width="304" height="254" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="254" rx="12"/>
  <text class="b" x="160" y="30">Fan-out on read</text>
  <text class="b" x="480" y="30">Fan-out on write</text>
  <text class="xs mute start" x="24" y="56">each event</text>
  <rect class="box ok" x="24" y="64" width="272" height="40" rx="8"/><text class="sm" x="160" y="84">INSERT the reading</text>
  <text class="xs mute start" x="24" y="130">each read</text>
  <rect class="box warn" x="24" y="138" width="272" height="40" rx="8"/><text class="sm" x="160" y="158">query, sort, aggregate the readings</text>
  <text class="sm bad" x="160" y="206">cost paid on every read</text>
  <text class="xs mute" x="160" y="232">fine when reads are rare</text>
  <text class="xs mute start" x="344" y="56">each event</text>
  <rect class="box energy" x="344" y="64" width="272" height="40" rx="8"/><text class="sm" x="480" y="84">… plus ZADD leaderboard:live</text>
  <text class="xs mute start" x="344" y="130">each read</text>
  <rect class="box ok" x="344" y="138" width="272" height="40" rx="8"/><text class="sm" x="480" y="158">ZREVRANGE · O(log n + m)</text>
  <text class="sm good" x="480" y="206">write slightly slower, read far faster</text>
  <text class="xs mute" x="480" y="232">state the read:write ratio when you propose it</text>
</svg>`,
      caption: "The k6 table in the lab is yours to fill in; the capsule only predicts the direction. For social feeds the answer is a hybrid: fan out on write for normal users, on read for a celebrity with 50M followers, merged at read time.",
    },
  ],
  concepts: [
    { term: "Fan-out / fan-in", plain: "Fan-out sends one event to many consumers. Fan-in gathers many results into one aggregate.", why: "Fan-out buys parallelism and decoupling. Fan-in is summarisation, and it's where windows and batching come in." },
    { term: "Fan-out on write vs on read", plain: "On write: push into every follower's feed, so reads are prebuilt. On read: store once and gather when someone reads.", why: "Cost scales with followers on write and with reads on read. A celebrity breaks one; inactive users waste the other. So the usual answer is hybrid, split by distribution." },
    { term: "Batch vs stream", plain: "Batch processes a bounded set on a schedule. Stream processes an unbounded flow continuously.", why: "Batch is simple, cheap, easy to re-run and correct because all the data is there. Stream is seconds-fresh, always on, and hard to get right with late data." },
    { term: "Windows", plain: "Tumbling: fixed, non-overlapping. Sliding: fixed and overlapping. Session: split by gaps in activity.", why: "An infinite stream has no total until you bound it. The window type is the question the business is asking." },
    { term: "Event time, watermark, lateness", plain: "Bucket by when it happened. A watermark estimates \"we've probably seen everything up to T\". Past it, the window closes and later events are late data.", why: "Processing time is simple and wrong at every boundary: an hour of offline events lands as a fake spike." },
    { term: "Size-or-time batching", plain: "Flush at N items or T elapsed, whichever is first, and on shutdown.", why: "The most effective consumer optimisation, as long as the work is idempotent and replayable." },
    { term: "OLTP vs OLAP", plain: "Postgres is row-oriented, built for small reads and writes by key. BigQuery is column-oriented, built for huge scans.", why: "An aggregate reads only its column, and columns compress well. Never run analytics on the production database." },
  ],
  numbers: [
    { value: "≈ 2,000 ms vs ≈ 15 ms", label: "1,000 inserts vs one batch", note: "Illustrative. Expect 10–50× more throughput in the lab." },
    { value: "500 or 200 ms", label: "Flush rule", note: "Whichever comes first." },
    { value: "10 vs 1,440 min", label: "Batch vs stream runtime per day", note: "A 10-minute daily job against a pipeline that never stops." },
    { value: "1 TiB / month", label: "BigQuery free queries", note: "Plus 10 GiB storage. Billing is by bytes scanned." },
  ],
  traps: [
    { myth: "We need a streaming pipeline for the daily numbers.", truth: "If the business needs it by 9am, it's a cron job: <code>dailyroll</code> in about 40 lines, re-runnable for any day. Reach for Dataflow when latency genuinely demands it, because it bills continuously." },
    { myth: "Batch on size; that's what batching means.", truth: "At low traffic a size-only batch never fills and never flushes. You need the time trigger, and <code>Close()</code> on SIGTERM so deploys don't drop the last batch." },
    { myth: "Use processing time, it's simpler.", truth: "It's wrong at every boundary. A client offline 10:00–11:00 shows as zero then a spike, and someone will investigate a spike that never happened." },
    { myth: "Keep the window map; memory is cheap.", truth: "Delete windows once emitted. An unbounded map keyed on user id is an OOM with a delay." },
    { myth: "<code>SELECT *</code> in BigQuery is fine for a quick look.", truth: "Columnar storage bills by bytes scanned, so you read every column. Always filter on the partition column and check \"bytes processed\" first." },
  ],
  gcp: [
    { service: "BigQuery", role: "Columnar warehouse billed by bytes scanned. Partitioning on <code>recorded_at</code> and clustering on <code>fighter</code> are the entire cost model." },
    { service: "Pub/Sub BigQuery subscription · Storage Write API", role: "A subscription that writes straight to a table with no code, or a high-throughput API that's exactly-once within BigQuery. Batch loads from Cloud Storage are free." },
    { service: "Dataflow", role: "Managed Apache Beam: windows, watermarks, late data, and the same code in batch or streaming mode. Powerful, and it bills for as long as it runs." },
    { service: "Cloud Scheduler → Cloud Run job", role: "How <code>dailyroll</code> runs in production, e.g. <code>0 2 * * *</code> UTC with an OIDC service account." },
  ],
  takeaways: [
    "Batch every high-volume consumer: size or time, and flush on shutdown.",
    "Ask what latency the business actually needs before building a stream.",
    "Precompute what's read far more than it's written, and say the ratio out loud.",
    "Event time, not processing time, with an explicit lateness allowance and a metric for dropped late data.",
    "Never run analytics on the OLTP database. Partition and cluster warehouse tables.",
    "Batch jobs must be idempotent and re-runnable for a specific day.",
    "Bound every in-memory aggregation.",
  ],
  drill: [
    { q: "Design a top-10 leaderboard for 10M fighters and 100k reads/s.", a: [
      "Maintain the ranking instead of computing it: a Redis sorted set updated with <code>ZADD</code> on write, read with <code>ZREVRANGE 0 9</code>. Cache the rendered top 10 for 1–5 s, so 100k reads/s become about one recomputation a second, with singleflight (Capsule 15) on the recompute. CDN it if it's public (Capsule 16).",
      "Use <code>ZADD GT</code> so replayed events can't corrupt it, and keep a batch rebuild from the source of truth, because a Redis-only ranking will drift. 100k reads/s of the same answer is a caching problem, not a database problem.",
    ] },
    { q: "Fan-out on write or on read for a social feed?", a: [
      "Hybrid. On write for normal users: push the post id into each follower's list, so reads are a range query. On read for celebrities, whose 50M followers would mean 50M writes per post. Merge the two at read time.",
      "Don't fan out to inactive users, fan out asynchronously so posting stays fast, and store ids rather than content so an edit doesn't rewrite millions of rows. The threshold comes from your follower-count distribution.",
    ] },
    { q: "Event time vs processing time, with a concrete failure.", a: [
      "A mobile app offline 10:00–11:00 uploads everything at 11:00. By processing time, the dashboard shows nothing for an hour and a spike at 11:00, which looks like a real event. By event time each event lands in its true window, but those windows closed an hour ago.",
      "Watermarks and a lateness allowance decide how long a window waits. Past that, drop and count, emit a correction, or use a side output. Event time for correctness; processing time only when you genuinely don't care.",
    ] },
    { q: "When is batch better than streaming?", a: [
      "When latency allows it (daily reports, billing, weekly emails), when reprocessing matters (re-run yesterday's job vs a replay project), when the computation needs all the data, when cost matters (10 minutes a day vs 1,440), and when you'd rather not operate watermarks and always-on infrastructure.",
      "Streaming wins when you need seconds, the data's value decays fast (fraud, alerting), or the volume is too large to batch. The lambda architecture runs both: a fast approximate stream and a nightly authoritative batch.",
    ] },
    { q: "Your batch job takes 6 hours and the window is 4.", a: [
      "Profile first: CPU, I/O, one slow stage, or skew. Then, roughly by effort: process incrementally, partition and parallelise, fix the query (Capsule 11), move it to a columnar engine like BigQuery, relax the requirement, or stream it. Whatever you do, make it resumable so a failure at hour 5 doesn't start over.",
    ] },
  ],
  connects: {
    back: "Capsule 14's sorted set returns as fan-out on write, and Capsule 19's version check becomes <code>ZADD GT</code>. Capsules 15 and 16 protect the hot top-10, and Capsule 01's graceful shutdown is where the batcher's final flush lives.",
    forward: "Capsule 21 makes the event log the source of truth and rebuilds a read model by replay, the stream-side version of re-running a batch job. Datastream, mentioned here for loading BigQuery, is its managed CDC.",
  },
});

// ---------------------------------------------------------------------------

GA.recap({
  id: "21",
  tagline: "You can't write atomically to a database and a broker, but you can write two rows in one transaction. Put the event in an outbox, relay it at-least-once, and the log of what happened becomes something you can replay.",
  built: "You added an <code>outbox</code> table with a partial index on unpublished rows, wrote the reading and its event in <b>one transaction</b>, and built <code>cmd/relay</code> to publish with <code>FOR UPDATE SKIP LOCKED</code> and mark rows sent. You posted readings with the relay off, then with Pub/Sub stopped, and saw the API still return 201 while events waited in the database. You turned on logical replication to read Postgres's own change stream, dropped the slot, and rebuilt <code>fighter_ranks</code> from zero by replaying the outbox.",
  story: [
    "Capsule 18 wrote to Postgres and then published. If the process died in between, the reading existed and nobody downstream ever heard. Publishing first is worse: consumers react to something that never happened. No ordering of two independent writes is safe, and retries or care don't fix that.",
    "The <b>transactional outbox</b> turns two writes into one. The reading and an outbox row commit together, so if the data committed, the event exists. A separate relay polls unpublished rows, publishes them, and sets <code>published_at</code>. If it crashes after publishing and before marking, it publishes again next tick. That's a duplicate, not a loss, and Capsule 19 already made duplicates harmless. Don't chase exactly-once here.",
    "<b>CDC</b> gets events a different way: read the database's replication log. It catches every writer, including migrations and admin tools, with no application changes, but its events are row changes that couple consumers to your schema. And a replication slot nobody reads makes Postgres keep WAL forever until the disk fills. A common hybrid is CDC on the outbox table.",
    "The payoff is <b>replay</b>. Because the outbox is an append-only history, you can reset it and republish everything, and idempotent consumers rebuild a read model from scratch. A new projection, a bug fix or a migration becomes a replay instead of a data-migration project. The capsule also covers how services coordinate (choreography or orchestration, and sagas with compensations) and how to evolve schemas you can never delete.",
  ],
  diagrams: [
    {
      title: "The dual-write gap, and how the outbox closes it",
      svg: `<svg class="dg" viewBox="0 0 640 300" role="img" aria-label="Left: the reading commits, the process dies, and the publish never runs, so downstream never learns. Right: the reading and the outbox row commit in one transaction, and a relay publishes later, so a committed reading always has an event.">
  <rect class="zone" x="8" y="8" width="304" height="284" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="284" rx="12"/>
  <text class="b" x="160" y="30">Two writes (Capsule 18)</text>
  <text class="b" x="480" y="30">Outbox: one transaction</text>
  <rect class="box ok" x="34" y="50" width="252" height="34" rx="8"/><text class="sm" x="160" y="67">store.Record(reading): committed</text>
  <line class="wire" x1="160" y1="84" x2="160" y2="104"/>
  <rect class="box warn" x="34" y="108" width="252" height="34" rx="8"/><text class="sm" x="160" y="125">process dies</text>
  <line class="wire dash bad" x1="160" y1="142" x2="160" y2="162"/>
  <rect class="box dim" x="34" y="166" width="252" height="34" rx="8"/><text class="sm" x="160" y="183">Publish(event): never runs</text>
  <text class="b bad" x="160" y="232">data exists, nobody knows</text>
  <text class="xs mute" x="160" y="258">publish first instead? you announce</text>
  <text class="xs mute" x="160" y="274">something that may never happen</text>
  <rect class="zone" x="346" y="46" width="268" height="88" rx="10"/>
  <text class="xs mute start" x="356" y="58">ONE TRANSACTION</text>
  <rect class="box ok" x="358" y="68" width="244" height="26" rx="8"/><text class="sm" x="480" y="81">INSERT INTO readings …</text>
  <rect class="box ok" x="358" y="100" width="244" height="26" rx="8"/><text class="sm" x="480" y="113">INSERT INTO outbox …</text>
  <line class="wire" x1="480" y1="134" x2="480" y2="158"/>
  <rect class="box hot" x="358" y="162" width="244" height="34" rx="8"/><text class="sm" x="480" y="179">relay: publish, set published_at</text>
  <text class="b good" x="480" y="232">committed ⇒ the event exists</text>
  <text class="xs mute" x="480" y="258">the relay may publish twice:</text>
  <text class="xs mute" x="480" y="274">at-least-once, which Capsule 19 handles</text>
</svg>`,
      caption: "The outbox works because both rows live in the same database, so one commit covers both. With Pub/Sub stopped, the API still returned 201 and the row sat with <code>published_at</code> NULL until the broker came back and the relay caught up on its own.",
    },
    {
      title: "The relay loop, and where a crash leaves you",
      svg: `<svg class="dg" viewBox="0 0 640 330" role="img" aria-label="Sequence: the API commits a reading plus an outbox row. Every 500 ms the relay selects unpublished rows with SKIP LOCKED, publishes to Pub/Sub, gets an ack, then sets published_at. A crash between publish and mark causes a duplicate. A failed publish increments attempts and retries.">
  <rect class="box hot" x="20" y="10" width="120" height="40" rx="10"/><text x="80" y="30">Scouter API</text>
  <rect class="box energy" x="190" y="10" width="120" height="40" rx="10"/><text x="250" y="30">outbox</text>
  <rect class="box" x="360" y="10" width="120" height="40" rx="10"/><text x="420" y="30">relay</text>
  <rect class="box cool" x="510" y="10" width="120" height="40" rx="10"/><text x="570" y="30">Pub/Sub</text>
  <line class="wire none soft" x1="80" y1="50" x2="80" y2="232" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="250" y1="50" x2="250" y2="232" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="420" y1="50" x2="420" y2="232" stroke-dasharray="3 5"/>
  <line class="wire none soft" x1="570" y1="50" x2="570" y2="232" stroke-dasharray="3 5"/>
  <line class="wire" x1="82" y1="84" x2="246" y2="84"/><text class="sm" x="165" y="72">① tx: reading + row</text>
  <line class="wire" x1="418" y1="118" x2="254" y2="118"/><text class="xs" x="335" y="106">② SELECT … SKIP LOCKED</text>
  <line class="wire" x1="422" y1="150" x2="566" y2="150"/><text class="sm" x="495" y="138">③ Publish</text>
  <line class="wire dash" x1="568" y1="180" x2="424" y2="180"/><text class="sm" x="495" y="168">ack</text>
  <line class="wire" x1="418" y1="214" x2="254" y2="214"/><text class="xs" x="335" y="202">④ SET published_at</text>
  <text class="xs mute halo" x="335" y="134">every 500 ms, 100 rows max</text>
  <rect class="box warn" x="20" y="246" width="600" height="34" rx="8"/><text class="sm" x="320" y="263">Crash between ③ and ④: published again next tick. A duplicate, not a loss.</text>
  <rect class="box dim" x="20" y="288" width="600" height="34" rx="8"/><text class="sm" x="320" y="305">③ fails: attempts + 1, last_error set, published_at stays NULL, retried next tick.</text>
</svg>`,
      caption: "<code>FOR UPDATE SKIP LOCKED</code> lets several relay instances run without grabbing the same rows. It's the standard \"queue in Postgres\" primitive. The partial index on <code>published_at IS NULL</code> keeps the poll cheap even with millions of published rows. Prune those rows too.",
    },
    {
      title: "Choreography vs orchestration",
      svg: `<svg class="dg" viewBox="0 0 640 290" role="img" aria-label="Choreography: Order publishes OrderPlaced and Payment, Inventory and Shipping each react. Orchestration: an orchestrator calls Payment, Inventory and Shipping directly.">
  <rect class="zone" x="8" y="8" width="304" height="274" rx="12"/>
  <rect class="zone" x="328" y="8" width="304" height="274" rx="12"/>
  <text class="b" x="160" y="30">Choreography</text>
  <text class="b" x="480" y="30">Orchestration</text>
  <rect class="box hot" x="24" y="96" width="90" height="36" rx="8"/><text class="sm" x="69" y="114">Order</text>
  <text class="xs mute" x="69" y="146">emits OrderPlaced</text>
  <rect class="box" x="186" y="50" width="110" height="34" rx="8"/><text class="sm" x="241" y="67">Payment</text>
  <rect class="box" x="186" y="97" width="110" height="34" rx="8"/><text class="sm" x="241" y="114">Inventory</text>
  <rect class="box" x="186" y="144" width="110" height="34" rx="8"/><text class="sm" x="241" y="161">Shipping</text>
  <line class="wire dash" x1="114" y1="108" x2="182" y2="70"/>
  <line class="wire dash" x1="114" y1="114" x2="182" y2="114"/>
  <line class="wire dash" x1="114" y1="120" x2="182" y2="158"/>
  <text class="xs good start" x="24" y="210">+ loose coupling, easy to add reactors</text>
  <text class="xs bad start" x="24" y="232">− nobody knows the whole flow</text>
  <text class="xs bad start" x="24" y="254">− hard to debug</text>
  <rect class="box energy" x="344" y="90" width="110" height="48" rx="8"/><text class="sm" x="399" y="114">Orchestrator</text>
  <rect class="box" x="506" y="50" width="110" height="34" rx="8"/><text class="sm" x="561" y="67">Payment</text>
  <rect class="box" x="506" y="97" width="110" height="34" rx="8"/><text class="sm" x="561" y="114">Inventory</text>
  <rect class="box" x="506" y="144" width="110" height="34" rx="8"/><text class="sm" x="561" y="161">Shipping</text>
  <line class="wire" x1="454" y1="104" x2="502" y2="70"/>
  <line class="wire" x1="454" y1="114" x2="502" y2="114"/>
  <line class="wire" x1="454" y1="124" x2="502" y2="158"/>
  <text class="xs good start" x="344" y="210">+ the flow is explicit and visible</text>
  <text class="xs good start" x="344" y="232">+ easy to see where it failed</text>
  <text class="xs bad start" x="344" y="254">− a coupling point that can grow</text>
  <text class="xs bad start" x="352" y="270">into a monolith</text>
</svg>`,
      caption: "Choreograph notification-shaped fan-out: \"something happened; whoever cares, react\". Orchestrate multi-step business processes with compensation, like checkout, onboarding and refunds. The rule of thumb: if a human would draw it as a flowchart with error branches, orchestrate it.",
    },
    {
      title: "A saga compensates; it doesn't roll back",
      svg: `<svg class="dg" viewBox="0 0 640 200" role="img" aria-label="Saga: reserve inventory, then charge card, then ship. If the card charge fails, release inventory runs as a compensating action.">
  <rect class="box ok" x="20" y="30" width="160" height="44" rx="10"/><text class="sm" x="100" y="52">reserve inventory</text>
  <rect class="box warn" x="240" y="30" width="160" height="44" rx="10"/><text class="sm" x="320" y="52">charge card</text>
  <rect class="box dim" x="460" y="30" width="160" height="44" rx="10"/><text class="sm" x="540" y="52">ship</text>
  <line class="wire" x1="180" y1="52" x2="236" y2="52"/>
  <line class="wire dash soft" x1="400" y1="52" x2="456" y2="52"/>
  <text class="xs mute" x="540" y="90">never reached</text>
  <line class="wire bad" x1="320" y1="74" x2="320" y2="122"/>
  <text class="xs bad start" x="328" y="98">card fails</text>
  <rect class="box energy" x="20" y="126" width="300" height="40" rx="10"/><text class="sm" x="170" y="146">release inventory (compensation)</text>
  <line class="wire bad" x1="100" y1="126" x2="100" y2="78"/>
  <text class="xs mute start" x="340" y="146">a new forward action, retried, so idempotent</text>
  <text class="xs mute" x="320" y="190">You can't un-charge a card, you refund it. Put irreversible steps last.</text>
</svg>`,
      caption: "Compensations can fail and be retried, so they must be idempotent (Capsule 19). Persist the saga's state so a crashed orchestrator resumes instead of restarting, and decide what a timeout means: a payment that may have succeeded has to be queried, not assumed.",
    },
  ],
  concepts: [
    { term: "Dual-write problem", plain: "Writing to a database and a broker as two independent steps. A crash between them loses the event or announces a write that never happened.", why: "Ordering, retries and care can't fix it. Only turning the two writes into one does." },
    { term: "Transactional outbox", plain: "Insert the event into an <code>outbox</code> table in the same transaction as the business data. A relay publishes unpublished rows and marks them sent.", why: "If the data committed, the event exists. The relay is at-least-once, which idempotent consumers already handle." },
    { term: "<code>FOR UPDATE SKIP LOCKED</code>", plain: "Each relay locks the rows it takes and skips rows another relay holds.", why: "Lets you run several relays concurrently. It's how you build a queue in Postgres generally." },
    { term: "Change data capture", plain: "Read the database's replication log (WAL) through a publication and a replication slot, as Debezium and Datastream do.", why: "Catches every writer with no app changes, but events are schema-shaped and an unread slot retains WAL until the disk fills." },
    { term: "Event sourcing, and \"lite\"", plain: "Full event sourcing stores only events and folds them into state. Lite keeps normal mutable state <em>and</em> appends an immutable event log.", why: "Full gives audit, time travel and replay, but every read is a fold, schemas can't be deleted, and GDPR deletion hurts. Lite gets most of the benefit; it's what this capsule builds." },
    { term: "Saga", plain: "A distributed transaction made of local transactions plus compensations, run in reverse when a step fails.", why: "Compensations are new actions, not rollbacks: a refund, an apology email. They retry, so they must be idempotent." },
    { term: "Schema evolution", plain: "Add only optional fields. Never remove, rename, re-type or change a field's meaning. New meaning means a new event type. Consumers ignore unknown fields.", why: "Events outlive the code that wrote them. A schema registry turns a break into a build or publish error instead of a consumer outage." },
  ],
  numbers: [
    { value: "500 ms · 100 rows", label: "Relay poll", note: "Every tick it takes up to 100 unpublished rows." },
    { value: "1 row waiting", label: "With Pub/Sub stopped", note: "The API still returned 201; the relay caught up when the broker returned." },
    { value: "7 days", label: "Prune published outbox rows", note: "<code>DELETE … WHERE published_at &lt; now() - interval '7 days'</code>" },
    { value: "90+", label: "GCP event sources for Eventarc", note: "Routed to Cloud Run." },
  ],
  traps: [
    { myth: "Publish the event first, then write the database.", truth: "If the write fails, consumers have already reacted to something that doesn't exist. Worse than a missing event, because your systems now actively disagree." },
    { myth: "The relay should be exactly-once.", truth: "You can't make it so and you don't need to. Published-but-not-marked becomes a duplicate after a restart, and the idempotent consumer handles it." },
    { myth: "A replication slot is harmless if nothing reads it.", truth: "Postgres keeps WAL for it forever. The disk fills and the database stops. Monitor slot lag and drop unused slots." },
    { myth: "Changing <code>wal_level</code> and reloading the config is enough.", truth: "It needs a full restart, not <code>pg_reload_conf()</code>." },
    { myth: "Replay is just republishing.", truth: "Replay only gives the right answer if consumers are idempotent. Otherwise it doubles the data." },
  ],
  gcp: [
    { service: "Datastream", role: "Managed CDC from Cloud SQL, MySQL or Oracle into BigQuery or Cloud Storage. Handles slots, snapshots and schema drift." },
    { service: "Workflows", role: "A managed orchestrator with steps, retries, error handling and state. The right tool for orchestrated sagas without running an engine." },
    { service: "Eventarc · Cloud Tasks", role: "Eventarc routes events from 90+ GCP services to Cloud Run. Cloud Tasks covers \"call this endpoint later, with retries\"." },
    { service: "Pub/Sub schemas", role: "Avro or Protocol Buffers attached to a topic, checked at publish time, so a schema break is a publish error rather than a consumer outage." },
    { service: "Spanner change streams · Firestore triggers", role: "Native CDC if you're on those stores." },
  ],
  takeaways: [
    "Transactional outbox for every event that must not be lost: one table and one relay.",
    "Accept at-least-once from the relay. Idempotent consumers make it a non-issue.",
    "<code>FOR UPDATE SKIP LOCKED</code> to run multiple relays. Partial index on unpublished rows, and prune the rest.",
    "Monitor replication slot lag. An abandoned slot takes the database down.",
    "Events are append-only and additive-only.",
    "Choreography for notifications, orchestration for business processes.",
    "Design for replay from day one: it turns a backfill project into an afternoon.",
  ],
  drill: [
    { q: "Why can't you just publish the event first, then write to the database?", a: [
      "If the write then fails, consumers have already sent the email, charged the card or updated the index for a state that doesn't exist. Publishing after commit has the opposite failure (data exists, nobody knows), which is at least consistent and recoverable by reconciliation.",
      "Neither order is safe: two independent writes can't be made atomic by ordering them. The outbox works because it makes them one write in one database.",
    ] },
    { q: "Outbox or CDC?", a: [
      "Outbox when you want domain events with stable contracts you control, so you can refactor tables freely. It costs application code and a relay. CDC when you can't change the application, when other writers exist, or for an analytics copy with no code. It costs schema coupling and care around replication slots.",
      "The hybrid: CDC on the outbox table. Well-designed events, guaranteed capture from the WAL, and no relay to operate.",
    ] },
    { q: "Design checkout as a saga: reserve inventory, charge card, ship.", a: [
      "Orchestrated, because it has error branches. Forward: reserve, charge, ship. Compensations in reverse: release inventory, refund the charge. A refund is a new action that shows on the statement, not an un-charge.",
      "Make every step and compensation idempotent, persist saga state, give each step a timeout and query rather than assume after one, put irreversible steps last, and show partial states to the user honestly. On GCP, Workflows is a reasonable orchestrator.",
    ] },
    { q: "Should you use full event sourcing?", a: [
      "Usually not. Yes when audit is a hard requirement, the business thinks in events (ledgers, trading, booking), you need time travel, or you'll build many read models from the same facts. No when the domain is CRUD-shaped, the team is new to it, you need ad-hoc queries over current state, or you face GDPR deletion.",
      "The pragmatic middle is what this capsule builds: mutable state as the source of truth plus an immutable event log, for audit, integration and replay without making every read a fold.",
    ] },
    { q: "How do you evolve an event schema with 12 consumers you don't control?", a: [
      "Never break it. Additive optional fields only; never remove, rename, re-type or change meaning. New meaning gets a new type (<code>PowerRecordedV2</code> alongside V1) until telemetry shows V1 is unused. Consumers ignore unknown fields. A schema registry fails incompatible changes in CI or at publish time. Announce deprecations and measure who still uses the old version.",
    ] },
  ],
  connects: {
    back: "Capsule 18 left the publish-after-commit seam open, and this closes it. Capsule 19's idempotent consumers are what make an at-least-once relay and a full replay safe. Capsule 20 rebuilt numbers by re-running a batch job; replay is the same idea for any read model.",
    forward: "Capsule 22 splits the monolith: the scouter publishes events and the ranking module consumes them, and when ranking data drifts, the fix it suggests is a reconciliation job that replays from this outbox.",
  },
});
