# Capsule B2 · Snake Way — HTTP & Networking Essentials

> *Snake Way is a million kilometres long and Goku runs the whole thing. He
> doesn't get faster by training harder — he gets there faster by learning the
> route. Latency is a property of the path, not of your effort.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 70 min | none | Capsule 07 |

---

## Why this capsule exists

Every capsule about performance eventually bottoms out in the network. If TLS
handshakes, keep-alive, HTTP/2 multiplexing and DNS TTLs are fuzzy, you'll
optimise the wrong layer — shaving 5 ms off a handler that spends 200 ms on
connection setup.

This is the layer underneath everything else in the repo.

---

## The numbers to know by heart

```
  L1 cache reference                     0.5 ns
  Branch mispredict                        5 ns
  L2 cache reference                       7 ns
  Mutex lock/unlock                       25 ns
  Main memory reference                  100 ns
  Compress 1 KB                        3,000 ns   =   3 µs
  Send 1 KB over 1 Gbps                10,000 ns  =  10 µs
  SSD random read                     150,000 ns  = 150 µs
  Read 1 MB sequentially from memory  250,000 ns  = 250 µs
  Round trip within a datacenter      500,000 ns  = 500 µs
  Read 1 MB from SSD                1,000,000 ns  =   1 ms
  Disk seek (spinning)             10,000,000 ns  =  10 ms
  Round trip CA → Netherlands     150,000,000 ns  = 150 ms
```

The ratios are what matter, not the exact figures:

- **Memory is ~100× faster than SSD. SSD is ~100× faster than a cross-continent
  round trip.**
- **One cross-continent round trip costs as much as 150,000 mutex operations.**
- **A datacenter round trip (~0.5 ms) is 5,000× a memory reference.** This is
  why an N+1 query (Capsule 10) is devastating and a slow loop usually isn't.

**The consequence:** almost all latency in a distributed system is *waiting*, not
*computing*. Optimise round trips first.

---

## The path of one request

```
  1. DNS lookup                    0–100 ms   (cached after the first)
  2. TCP handshake (SYN/SYN-ACK/ACK)  1 RTT
  3. TLS handshake                    1 RTT   (TLS 1.3; 2 RTT for 1.2; 0 on resume)
  4. HTTP request                     1 RTT
  5. server processing              your code
  6. response transfer              size / bandwidth
```

At 80 ms RTT that's **240 ms before your handler runs**. This is why:

- **CDNs help even for uncacheable content** (Capsule 16) — steps 2–3 happen at
  the edge.
- **Connection reuse is enormous** — steps 2–3 happen once, not per request.
- **TLS 1.3 matters** — it removed a full round trip from the handshake.

---

## TCP: the parts that bite

**The three-way handshake** costs 1 RTT before any data moves.

**Slow start** — TCP doesn't know the available bandwidth, so it begins with a
small congestion window (~10 packets ≈ 14 KB) and doubles each RTT. A 200 KB
response needs several round trips just to ramp up, even on a fast link.

This is why **the first 14 KB of a response are special**: fitting your critical
HTML/CSS in there means it arrives in the first round trip. It's a real
front-end optimisation with a TCP cause.

**Head-of-line blocking** — TCP guarantees ordered delivery, so one lost packet
stalls everything behind it, even data that already arrived. HTTP/2 multiplexes
streams over one TCP connection, so a single loss stalls *all* streams. **HTTP/3
(QUIC over UDP) exists specifically to fix this.**

**Nagle's algorithm** buffers small writes to reduce packet count. Combined with
delayed ACKs it can add ~40 ms to small request/response exchanges. Most RPC
libraries set `TCP_NODELAY` for this reason.

---

## TLS

```
  TLS 1.2:  ClientHello → ServerHello+Cert → KeyExchange → Finished   2 RTT
  TLS 1.3:  ClientHello → ServerHello+Finished → Finished             1 RTT
  TLS 1.3 resumption (0-RTT):  data with the first packet             0 RTT
```

- **Use TLS 1.3.** Half the handshake, fewer cipher suites, no known-bad options.
- **Session resumption** makes repeat connections nearly free. It requires
  connection reuse or a session ticket cache to work.
- **0-RTT is not replay-safe.** Use it for idempotent GETs only; an attacker can
  replay 0-RTT data.
- **Certificate chains cost bytes** in the handshake — a shorter chain is
  measurably faster.
- **Terminate close to the user** (Capsule 16). This is often the largest single
  latency win available.
- **mTLS** — both sides present certificates. The basis of zero-trust
  service-to-service auth and of service meshes (Capsule 08).

---

## HTTP versions

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | **QUIC over UDP** |
| Concurrency | one request per connection (6 per origin) | multiplexed streams | multiplexed streams |
| Head-of-line blocking | at HTTP level | **at TCP level** | none |
| Headers | plain text | HPACK compressed | QPACK compressed |
| Server push | no | deprecated | no |
| Connection migration | no | no | ✅ survives a network change |

**HTTP/1.1's real limitation** is 6 connections per origin, which is why the era
of domain sharding and sprite sheets existed. HTTP/2 removed that, which is why
those techniques are now *harmful*.

**HTTP/2's remaining flaw** is TCP-level head-of-line blocking: multiplexing many
streams onto one TCP connection means one lost packet stalls all of them. On a
lossy mobile network HTTP/2 can be *worse* than HTTP/1.1.

**HTTP/3 fixes it** by moving to QUIC over UDP with per-stream ordering, plus
connection migration — switching from Wi-Fi to cellular doesn't drop the
connection.

**gRPC runs on HTTP/2**, which is why it needs an L7 load balancer (Capsule 07).

---

## Connection pooling and keep-alive

The single most impactful client-side setting.

```go
// Go's DEFAULTS ARE WRONG for a service that fans out.
transport := &http.Transport{
	MaxIdleConns:        100,
	MaxIdleConnsPerHost: 32,  // DEFAULT IS 2. This is the one that hurts.
	IdleConnTimeout:     90 * time.Second,
	TLSHandshakeTimeout: 5 * time.Second,
	ForceAttemptHTTP2:   true,
}

client := &http.Client{
	Transport: transport,
	Timeout:   5 * time.Second,  // http.DefaultClient has NO timeout
}
```

`MaxIdleConnsPerHost: 2` means a service making 50 concurrent calls to one
backend opens and closes 48 connections *per batch* — a full TCP + TLS handshake
each time. That's ~2 RTT of pure waste per call, and it's invisible in your code.

**Two rules:**

1. **Reuse one `http.Client`.** Creating one per request defeats pooling
   entirely, and leaks connections.
2. **Always drain and close the body**, even when you don't read it — otherwise
   the connection can't be reused:

```go
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()
```

---

## DNS

```
  browser cache → OS cache → resolver → root → TLD → authoritative
```

- **TTL controls failover speed.** A 300-second TTL means up to 5 minutes of
  traffic to a dead endpoint after you change the record.
- **Low TTLs cost lookups.** 60 s is a common compromise for records you might
  need to change quickly.
- **Many clients ignore TTLs.** The JVM historically cached DNS forever; Go's
  resolver caches per lookup; connection pools hold a resolved IP for the
  connection's lifetime. **`MaxConnLifetime` on your pools** (Capsule 10) is
  partly a DNS-freshness mechanism.
- **DNS-based load balancing is coarse** — no health awareness, no fast failover.
  Real load balancing happens at L4/L7 (Capsule 07), with DNS pointing at a
  stable anycast IP.

---

## Timeouts, layer by layer

Every one of these has a default, and several of the defaults are "infinite".

```go
// SERVER (Capsule 01)
&http.Server{
	ReadHeaderTimeout: 5 * time.Second,   // Slowloris defence. Default: NONE
	ReadTimeout:       15 * time.Second,
	WriteTimeout:      30 * time.Second,
	IdleTimeout:       60 * time.Second,
}

// CLIENT
&http.Client{Timeout: 5 * time.Second}   // whole request. Default: NONE

// DIALER — finer control
&net.Dialer{
	Timeout:   3 * time.Second,           // connect
	KeepAlive: 30 * time.Second,          // TCP keep-alive probes
}
```

And the deadline that overrides all of them: `context.WithTimeout` (Capsule 17),
because it's inheritable.

---

## Lab

### Step 1 — see the phases of a request

```bash
cat > /tmp/curl-format.txt <<'EOF'
    dns_lookup:  %{time_namelookup}s
   tcp_connect:  %{time_connect}s
 tls_handshake:  %{time_appconnect}s
   pretransfer:  %{time_pretransfer}s
     first_byte:  %{time_starttransfer}s
         total:  %{time_total}s
EOF

curl -w "@/tmp/curl-format.txt" -o /dev/null -s https://cloud.google.com
curl -w "@/tmp/curl-format.txt" -o /dev/null -s https://cloud.google.com   # warm DNS
```

The second run is faster — DNS is cached. Now try something far away and watch
every phase grow proportionally. **That's the speed of light in your terminal.**

### Step 2 — measure connection reuse

```bash
# 10 separate connections (new TCP + TLS each time)
time (for i in $(seq 1 10); do curl -s -o /dev/null https://cloud.google.com; done)

# 10 requests, ONE connection
time curl -s -o /dev/null https://cloud.google.com \
     $(for i in $(seq 1 9); do echo -n "-o /dev/null https://cloud.google.com "; done)
```

Typically **2–4× faster** for the reused connection. That's the entire value of
keep-alive, in one comparison.

### Step 3 — prove the Go pooling default is wrong

```go
// scripts/pooltest/main.go
package main

import (
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

func bench(name string, client *http.Client, url string, n int) {
	start := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := client.Get(url)
			if err != nil {
				return
			}
			// MUST drain and close, or the connection is not reusable.
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}()
	}
	wg.Wait()
	fmt.Printf("%-28s %d requests in %v\n", name, n, time.Since(start).Round(time.Millisecond))
}

func main() {
	url := "http://localhost:8080/healthz"

	bench("default (2 idle/host)", &http.Client{Timeout: 5 * time.Second}, url, 200)

	tuned := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        200,
			MaxIdleConnsPerHost: 100,
			IdleConnTimeout:     90 * time.Second,
		},
	}
	bench("tuned (100 idle/host)", tuned, url, 200)
}
```

```bash
make run &          # the Scouter on :8080
go run ./scripts/pooltest
```

Then watch the connection churn:

```bash
# macOS
netstat -an | grep 8080 | grep TIME_WAIT | wc -l
```

The default client leaves a pile of `TIME_WAIT` sockets — each one a connection
that was opened, used once and discarded.

### Step 4 — HTTP/2 multiplexing

```bash
curl -sI --http1.1 https://cloud.google.com | head -1
curl -sI --http2   https://cloud.google.com | head -1
curl -sI --http3   https://cloud.google.com | head -1   # if your curl supports it
```

```bash
# 20 parallel requests over each version
time (for i in $(seq 1 20); do curl -s --http1.1 -o /dev/null https://cloud.google.com & done; wait)
time (for i in $(seq 1 20); do curl -s --http2   -o /dev/null https://cloud.google.com & done; wait)
```

HTTP/2 multiplexes them onto one connection instead of opening six and queueing.

### Step 5 — see what a handshake actually contains

```bash
openssl s_client -connect cloud.google.com:443 -tls1_3 </dev/null 2>/dev/null \
  | grep -E 'Protocol|Cipher|Verify return'

# the certificate chain — every certificate costs handshake bytes
openssl s_client -connect cloud.google.com:443 -showcerts </dev/null 2>/dev/null \
  | grep -c 'BEGIN CERTIFICATE'
```

### Step 6 — the latency budget for your own system

```bash
python3 - <<'PY'
scenarios = {
    "same zone":        0.0005,
    "cross-zone":       0.001,
    "cross-region US":  0.030,
    "US → EU":          0.090,
    "US → APAC":        0.150,
}
for name, rtt in scenarios.items():
    setup = 2 * rtt          # TCP + TLS 1.3
    one   = setup + rtt
    five  = setup + 5 * rtt  # 5 sequential calls
    print(f"{name:<18} 1 call: {one*1000:>6.1f} ms   "
          f"5 sequential: {five*1000:>6.1f} ms   "
          f"5 parallel: {(setup + rtt)*1000:>6.1f} ms")
PY
```

```
same zone           1 call:    1.5 ms   5 sequential:    3.5 ms   5 parallel:    1.5 ms
cross-zone          1 call:    3.0 ms   5 sequential:    7.0 ms   5 parallel:    3.0 ms
cross-region US     1 call:   90.0 ms   5 sequential:  210.0 ms   5 parallel:   90.0 ms
US → EU             1 call:  270.0 ms   5 sequential:  630.0 ms   5 parallel:  270.0 ms
US → APAC           1 call:  450.0 ms   5 sequential: 1050.0 ms   5 parallel:  450.0 ms
```

**Two conclusions that shape architecture:**

1. **Keep compute and data in the same region.** Cross-region is 30–100× the
   latency, and it's on every call.
2. **Parallel fan-out is free relative to sequential** (Capsule 23). Five
   sequential cross-region calls is a second; five parallel is 270 ms.

---

## Bring it to work

- **Set `MaxIdleConnsPerHost`.** The default of 2 is wrong for any service that
  fans out.
- **One shared `http.Client`**, never `http.DefaultClient` (no timeout), never a
  new one per request.
- **Always drain and close response bodies** or connections aren't reused.
- **`ReadHeaderTimeout` on every server.** It's a documented DoS vector
  otherwise.
- **Count round trips, not milliseconds of CPU.** That's where the time is.
- **Same region for compute and data.**
- **TLS 1.3, terminated near the user.**
- **`MaxConnLifetime` on pools** so DNS changes and failovers are picked up.
- **Know your DNS TTLs** — they're your failover floor.

---

## Battle drill

<details>
<summary><b>1.</b> Your API is 40 ms in the same region and 400 ms for a user in Sydney. Where's the time?</summary>

Almost entirely round trips. Sydney → us-central1 is ~160 ms RTT, so:

- TCP handshake: 1 RTT = 160 ms
- TLS 1.3 handshake: 1 RTT = 160 ms
- The request itself: 1 RTT = 160 ms

That's 480 ms before your 40 ms of work — and the fact that they're seeing 400 ms
means connection reuse is already helping.

Fixes, by impact: **a CDN or edge presence** so TCP and TLS terminate ~2 ms away
(Capsule 16); **connection reuse and session resumption** so repeat requests skip
the handshake; **fewer round trips** — one BFF call instead of four (Capsule 23);
**HTTP/3** if the network is lossy; and finally **a regional deployment** with
data replication, which is the expensive answer.

Note that optimising your handler is the *last* thing on that list, and it's
usually the first thing people try.
</details>

<details>
<summary><b>2.</b> Why can HTTP/2 be slower than HTTP/1.1 on a mobile network?</summary>

**TCP-level head-of-line blocking.** HTTP/2 multiplexes all streams onto one TCP
connection. TCP guarantees ordered delivery, so a single lost packet stalls
*every* stream until it's retransmitted — even streams whose data already
arrived.

HTTP/1.1 with six parallel connections has six independent TCP streams, so one
loss stalls only one sixth of the work.

On a clean network HTTP/2 wins decisively (no connection setup per request,
header compression, true multiplexing). On a lossy mobile network with 2–5%
packet loss, the blocking can dominate.

**HTTP/3 solves it properly**: QUIC implements per-stream ordering over UDP, so a
loss on stream 3 doesn't touch streams 1, 2 and 4. Plus connection migration, so
switching Wi-Fi → cellular doesn't reset anything.
</details>

<details>
<summary><b>3.</b> What is TIME_WAIT and when does it become a problem?</summary>

After closing a TCP connection, the side that closed first holds the socket in
`TIME_WAIT` for 2×MSL (typically 60 s on Linux). It exists so that delayed
packets from the old connection can't be misinterpreted as belonging to a new
one on the same port pair.

It becomes a problem when a client opens many short-lived connections: each
consumes an ephemeral port for 60 seconds, and there are only ~28,000 by default
(`net.ipv4.ip_local_port_range`). At 500 new connections/second you exhaust them
in under a minute and see `cannot assign requested address`.

**The real fix is connection reuse** — keep-alive plus a properly sized pool.
Tuning `tcp_tw_reuse` or widening the port range treats the symptom.

The diagnostic: `netstat -an | grep TIME_WAIT | wc -l` in the thousands means
something isn't pooling. In Go, the usual cause is an undrained response body or
a per-request `http.Client`.
</details>

<details>
<summary><b>4.</b> Explain the 14 KB rule.</summary>

TCP slow start begins with an initial congestion window of ~10 packets. At ~1460
bytes of payload per packet that's roughly **14 KB** the server can send before
it must wait for an ACK.

So a response under 14 KB arrives in **one round trip**. At 15 KB you pay a
second RTT — 160 ms extra for a distant user, for one extra kilobyte.

This is why front-end performance advice says to inline critical CSS and keep
the initial HTML small: it isn't superstition, it's the congestion window.

It applies to APIs too. A 13 KB JSON response and a 20 KB one can differ by a
full round trip. Compression (`gzip`/`brotli`) helps directly by getting you
under the threshold.
</details>

<details>
<summary><b>5.</b> A deploy changed a DNS record 10 minutes ago and some traffic still hits the old servers. Why?</summary>

Layers of caching, most of which ignore your intent:

- **TTL not expired** — if it was 3600 s, you have another 50 minutes.
- **Resolvers that ignore TTL** — some ISP and corporate resolvers enforce their
  own minimums.
- **Application-level DNS caching** — the JVM historically cached forever
  (`networkaddress.cache.ttl`); many HTTP clients cache resolutions.
- **Established connections** — a connection pool holds an already-resolved IP
  for the connection's lifetime. DNS is irrelevant to a connection that's
  already open. **This is usually the real answer**, and it's why
  `MaxConnLifetime` exists.

**The lesson: DNS is not a failover mechanism.** For fast, reliable
cutover, use a stable anycast IP with an L7 load balancer that health-checks
backends (Capsule 07), and change the *backends*, not the DNS.

Lower the TTL well in advance of a planned change (hours before), and set
connection lifetimes so pools rotate.
</details>

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "perf(http): tune client connection pooling

Capsule B2. MaxIdleConnsPerHost raised from the default 2; single shared
client with an explicit timeout; response bodies drained so connections are
reusable. Measured the difference under 200 concurrent requests."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done B2
```
