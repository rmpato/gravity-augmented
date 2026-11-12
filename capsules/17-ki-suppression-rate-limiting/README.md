# Capsule 17 · Ki Suppression — Rate Limiting, Timeouts & Backpressure

> *Suppressing your ki is a technique, not a weakness. Fighters who broadcast at
> full power all the time get found, get exhausted, and lose. The ones who
> survive control their output deliberately and choose when to spend it.*

| Power level | Time | Prereqs | Mode |
|---|---|---|---|
| 8 | 90 min | Capsules 08–09, 14 · optional [B5 Go concurrency](../bonus/B5-afterimage-go-concurrency/README.md) | Local |

---

## Why this capsule exists

Everything so far made your system *faster*. This capsule makes it **survive**.

Systems don't usually fail by going slowly. They fail by **cascading**: one slow
dependency exhausts a connection pool, which makes callers slow, which fills
their pools, which makes *their* callers slow — until nothing works and no
single component is obviously broken.

Every mechanism here exists to stop that chain. If you learn one capsule in this
repo properly for production work, make it this one.

---

## The concept

### The first rule: slow is worse than down

A dependency returning errors instantly is *fine* — you fail fast, return a
fallback, move on. A dependency taking 30 seconds is **catastrophic**, because
every waiting request holds a goroutine, a connection, and memory. Your resource
pools fill with things that are waiting, and you die of exhaustion while doing
no work.

This is why **timeouts are the foundation** and everything else is built on top.

### Timeouts and deadline propagation

Every network call needs a deadline, and it must be *inherited*:

```
  client → gateway (5s) → service A (4s) → service B (2s) → database (1s)
                ▲
                │  each hop gets LESS than its caller.
                │  If A's budget is gone, it must not start a call to B.
```

In Go this is `context.Context`, and it's the reason every function that does
I/O should take one as its first parameter.

**The anti-pattern:** a fixed timeout per service with no relationship to the
caller's budget. The client gave up 4 seconds ago and you're still querying the
database for it. That's pure waste, and under load it's the waste that kills you.

### Retries: a load multiplier, applied at the worst moment

Three rules, and violating any of them makes things worse:

**1. Exponential backoff with full jitter.**

```
  no jitter:    1s, 2s, 4s, 8s   → every client retries in lockstep. Self-DDoS.
  full jitter:  rand(0,1), rand(0,2), rand(0,4)   → spread out
```

AWS's published analysis found *full* jitter (`sleep = rand(0, base·2^n)`) beats
both no jitter and "equal jitter". Use it.

**2. A retry budget.** Cap retries at a percentage of total requests (say 10%).
Without one, a service at 50% failure doubles its own load precisely when it's
struggling — the **retry storm** that turns a partial outage into a total one.

**3. Only retry what's safe.** Idempotent operations, or operations made
idempotent with a key (Capsule 19). **Never retry a 4xx** — it will fail
identically forever.

### Circuit breakers

Stop calling a dependency that is clearly broken.

```
              failures > threshold
    CLOSED ──────────────────────────► OPEN
      ▲                                  │
      │                                  │ after a cooldown
      │   success                        ▼
      └──────────────────────── HALF-OPEN
                                (one probe at a time)
```

- **Closed** — normal; count failures.
- **Open** — fail immediately without calling. Return a fallback. This is the
  point: you stop paying the timeout on every single request.
- **Half-open** — after a cooldown, let a single probe through at a time while
  everyone else still fails fast. A few successes in a row close it; one failure
  re-opens it.

The value isn't protecting the dependency (though it helps). It's protecting
**you**: an open breaker means you stop holding thousands of goroutines waiting
on something that isn't going to answer.

### Rate limiting algorithms

| Algorithm | Behaviour | Notes |
|---|---|---|
| **Fixed window** | count per wall-clock minute | simple; allows **2× burst at the boundary** (Capsule 08) |
| **Sliding window log** | timestamps of every request | exact, memory-hungry |
| **Sliding window counter** | weighted blend of this and last window | the usual production choice |
| **Token bucket** | tokens refill at rate R, capacity B | **allows a controlled burst.** The best general default |
| **Leaky bucket** | fixed output rate, queue in front | perfectly smooth output; adds latency |

**Token bucket is usually right** because real traffic is bursty and users
expect a short burst to work. `rate` sets the sustained limit; `burst` sets how
much slack you allow.

**Where to enforce it:**

- **Per client/API key** — fairness. Prevents one tenant starving everyone.
- **Per endpoint** — protects the expensive paths specifically.
- **Global** — protects a downstream dependency's hard limit.

**Distributed rate limiting is a real problem.** N replicas each limiting to
100/s means the actual limit is N×100. Options: divide the limit by replica
count (breaks when replicas scale); a shared counter in Redis (accurate, adds a
round trip); or accept the approximation and set the per-replica limit
accordingly. Most teams use Redis for anything that must be exact (billing,
quotas) and local limits for coarse protection.

### Backpressure and load shedding

When you can't keep up, you have exactly three options:

1. **Queue** — bounded only. An unbounded queue converts a throughput problem
   into an out-of-memory crash, and every queued request is one whose client
   already gave up.
2. **Shed** — reject immediately with `429` or `503` + `Retry-After`. Fast
   failure lets the client back off.
3. **Degrade** — return a cheaper answer. Stale cache, fewer results, no
   personalisation.

> **Shedding load is a feature, not an admission of defeat.** A service at 100%
> capacity that serves 100% of what it can and rejects the rest is *healthy*. A
> service that accepts everything and times out on all of it serves nobody.

**Prioritised shedding** is the mature version: drop background and retry traffic
first, keep interactive user requests. Google's approach uses request criticality
levels for exactly this.

### Bulkheads

Isolate resources so one failure can't consume everything:

```
  ONE pool of 100 connections:
     the slow /reports endpoint takes all 100 → checkout is down too

  BULKHEADS: reports=20, checkout=50, admin=10, spare=20
     /reports saturates its 20 and stops. Checkout is unaffected.
```

Named after ship compartments: flood one, the ship floats. Applies to connection
pools, thread pools, goroutine limits and separate service deployments.

---

## Lab

### Step 1 — a token bucket

Go's standard extension library has a good one.

```bash
go get golang.org/x/time/rate
```

**`internal/scouter/limit.go`**

```go
package scouter

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limiter holds one token bucket per caller.
//
// Token bucket rather than fixed window: real traffic is bursty, and a user
// who sends 5 requests in one second then nothing for a minute is behaving
// normally. Burst allows that; rate bounds the sustained load.
type Limiter struct {
	mu       sync.Mutex
	buckets  map[string]*entry
	rate     rate.Limit
	burst    int
	idleFor  time.Duration
}

type entry struct {
	lim  *rate.Limiter
	seen time.Time
}

func NewLimiter(perSecond float64, burst int) *Limiter {
	l := &Limiter{
		buckets: make(map[string]*entry),
		rate:    rate.Limit(perSecond),
		burst:   burst,
		idleFor: 10 * time.Minute,
	}
	go l.reap() // unbounded maps are memory leaks with extra steps
	return l
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	e, ok := l.buckets[key]
	if !ok {
		e = &entry{lim: rate.NewLimiter(l.rate, l.burst)}
		l.buckets[key] = e
	}
	e.seen = time.Now()
	l.mu.Unlock()
	return e.lim.Allow()
}

func (l *Limiter) reap() {
	t := time.NewTicker(time.Minute)
	for range t.C {
		cut := time.Now().Add(-l.idleFor)
		l.mu.Lock()
		for k, e := range l.buckets {
			if e.seen.Before(cut) {
				delete(l.buckets, k)
			}
		}
		l.mu.Unlock()
	}
}

// Middleware rejects over-limit callers with 429 and the headers clients
// need in order to back off correctly.
func (l *Limiter) Middleware(keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := keyFn(r)
			if !l.Allow(key) {
				// Telling the client HOW LONG to wait is what turns a 429 from
				// an error into a coordination mechanism.
				w.Header().Set("Retry-After", "1")
				w.Header().Set("X-RateLimit-Limit", strconv.Itoa(int(l.rate)))
				writeErr(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

Wire it into `Routes()`:

```go
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	// … existing routes …

	limiter := NewLimiter(50, 100) // 50 rps sustained, burst of 100
	byIP := func(r *http.Request) string {
		if c := r.Header.Get("X-Caller"); c != "" { // set by the gateway (C08)
			return c
		}
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		return host
	}
	return s.withLogging(limiter.Middleware(byIP)(mux))
}
```

Test the burst behaviour, which is the whole point of a token bucket:

```bash
make run

# 120 requests as fast as possible: ~100 pass (the burst), then ~50/s
for i in $(seq 1 120); do
  curl -s -o /dev/null -w "%{http_code} " localhost:8080/healthz
done; echo

sleep 2   # bucket refills

for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code} " localhost:8080/healthz
done; echo    # all 200 again
```

### Step 2 — deadline propagation you can see

Add an endpoint that respects its caller's deadline:

```go
	mux.HandleFunc("GET /slow", func(w http.ResponseWriter, r *http.Request) {
		// r.Context() is cancelled when the CLIENT disconnects or its
		// deadline passes. Respecting it means we stop doing work nobody
		// is waiting for — which is most of what backpressure is.
		select {
		case <-time.After(3 * time.Second):
			writeJSON(w, http.StatusOK, map[string]string{"status": "finished"})
		case <-r.Context().Done():
			s.log.Warn("client went away, abandoning work",
				"path", r.URL.Path, "err", r.Context().Err())
			// No response is possible; the client is gone.
		}
	})
```

```bash
# client gives up after 1s
curl -m 1 localhost:8080/slow
# server logs "client went away, abandoning work" — it stopped working
```

**Contrast with a handler that ignores the context**: it keeps burning CPU and
holding a database connection for two more seconds, for a client that has
already left. Under load, that's how you accumulate work for nobody.

### Step 3 — a circuit breaker

**`internal/scouter/breaker.go`**

```go
package scouter

import (
	"errors"
	"sync"
	"time"
)

var ErrCircuitOpen = errors.New("circuit breaker open")

type breakerState int

const (
	closed breakerState = iota
	open
	halfOpen
)

// Breaker stops calling a dependency that is clearly failing.
// The point is not to protect the dependency — it is to stop YOU from
// holding thousands of goroutines waiting on something that will not answer.
type Breaker struct {
	mu sync.Mutex

	state        breakerState
	failures     int
	successes    int
	openedAt     time.Time
	probing      bool // half-open: a probe call is in flight

	threshold    int           // consecutive failures that trip it
	cooldown     time.Duration // how long to stay open
	halfOpenNeed int           // consecutive successes to close again
}

func NewBreaker(threshold int, cooldown time.Duration) *Breaker {
	return &Breaker{
		state:        closed,
		threshold:    threshold,
		cooldown:     cooldown,
		halfOpenNeed: 3,
	}
}

func (b *Breaker) Do(fn func() error) error {
	if !b.allow() {
		return ErrCircuitOpen // fails INSTANTLY: no timeout paid
	}
	err := fn()
	b.record(err == nil)
	return err
}

func (b *Breaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case open:
		if time.Since(b.openedAt) < b.cooldown {
			return false
		}
		b.state = halfOpen
		b.successes = 0
		fallthrough
	case halfOpen:
		if b.probing {
			return false // one probe at a time; everyone else still fails fast
		}
		b.probing = true
		return true // let one through to probe
	default:
		return true
	}
}

func (b *Breaker) record(ok bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.probing = false // the probe, if this was one, is over

	if ok {
		switch b.state {
		case halfOpen:
			b.successes++
			if b.successes >= b.halfOpenNeed {
				b.state = closed
				b.failures = 0
			}
		default:
			b.failures = 0
		}
		return
	}

	b.failures++
	if b.state == halfOpen || b.failures >= b.threshold {
		b.state = open
		b.openedAt = time.Now()
	}
}

func (b *Breaker) State() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return [...]string{"closed", "open", "half-open"}[b.state]
}
```

**`internal/scouter/breaker_test.go`**

```go
package scouter

import (
	"errors"
	"testing"
	"time"
)

func TestBreakerOpensAndRecovers(t *testing.T) {
	b := NewBreaker(3, 50*time.Millisecond)
	boom := errors.New("boom")

	for i := 0; i < 3; i++ {
		if err := b.Do(func() error { return boom }); !errors.Is(err, boom) {
			t.Fatalf("call %d: got %v", i, err)
		}
	}
	if b.State() != "open" {
		t.Fatalf("state = %s, want open", b.State())
	}

	// While open, calls fail instantly without invoking fn.
	called := false
	if err := b.Do(func() error { called = true; return nil }); !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("got %v, want ErrCircuitOpen", err)
	}
	if called {
		t.Error("fn was called while the circuit was open")
	}

	time.Sleep(60 * time.Millisecond) // cooldown

	for i := 0; i < 3; i++ {
		if err := b.Do(func() error { return nil }); err != nil {
			t.Fatalf("recovery call %d: %v", i, err)
		}
	}
	if b.State() != "closed" {
		t.Errorf("state = %s, want closed", b.State())
	}
}

func TestBreakerHalfOpenAdmitsOneProbe(t *testing.T) {
	b := NewBreaker(1, 10*time.Millisecond)
	b.Do(func() error { return errors.New("boom") }) // trip it
	time.Sleep(20 * time.Millisecond)                // cooldown

	release := make(chan struct{})
	started := make(chan struct{})
	go b.Do(func() error { close(started); <-release; return nil }) // the probe, held open
	<-started

	// While the probe is in flight, everyone else must still be refused.
	called := false
	err := b.Do(func() error { called = true; return nil })
	close(release)
	if called || !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("call during half-open: called=%v err=%v, want ErrCircuitOpen", called, err)
	}
}
```

```bash
go test ./internal/scouter/ -run Breaker -v
```

Now wrap the cache with it (`cached.go`) — a dead Redis is the perfect use case,
because otherwise you pay the 200 ms timeout on *every single request*:

```go
type CachedStore struct {
	// …
	breaker *Breaker
}

// NOTE THE FUNCTION NAME. Capsule 15 split `Latest` into a 1-second local-cache
// wrapper plus `latestFromRedisOrDB`, which is where the Redis call now lives.
// The breaker belongs on the Redis call — putting it back in `Latest` would
// either duplicate the network call or throw away your hot-key cache.
func (c *CachedStore) latestFromRedisOrDB(fighter string) (Reading, bool) {
	var raw []byte
	var miss bool
	err := c.breaker.Do(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		b, err := c.rdb.Get(ctx, fighterKey(fighter)).Bytes()
		if errors.Is(err, redis.Nil) {
			miss = true
			return nil // a miss is not a failure — don't trip the breaker on it
		}
		raw = b
		return err
	})
	if errors.Is(err, ErrCircuitOpen) {
		miss = true // an open circuit IS a miss: go straight to the database
		err = nil
	}
	// then classify — see the warning below
	// …
}
```

> **⚠ This breaks Capsule 14's counters unless you also change the `switch`.**
>
> Capsule 14 decided "hit / miss / error" by testing `errors.Is(err, redis.Nil)`.
> You have just wrapped the `Get` in something that — correctly — turns a miss
> into a `nil` error so it never trips the breaker. The `redis.Nil` case now
> never matches, so **every miss falls into `default`** and gets counted as an
> error and logged as `cache read failed err=null`.
>
> Track the miss explicitly instead of inferring it from an error a wrapper is
> allowed to rewrite:
>
> ```go
> var raw []byte
> var miss bool          // <- new
> err := c.breaker.Do(func() error {
> 	b, gerr := c.rdb.Get(ctx, key).Bytes()
> 	if errors.Is(gerr, redis.Nil) {
> 		miss = true
> 		return nil
> 	}
> 	raw = b
> 	return gerr
> })
> if errors.Is(err, ErrCircuitOpen) {
> 	miss = true
> 	err = nil
> }
> switch {
> case err == nil && !miss: // hit
> case miss:                c.misses.Add(1)
> default:                  c.errs.Add(1); c.log.Warn("cache read failed", "key", key, "err", err)
> }
> ```
>
> The general lesson is worth more than the fix: **a sentinel error is part of a
> function's contract, and wrapping that function can erase it.** Check
> `/cache-stats` after this change — if `misses` stays at 0 while `errors`
> climbs, you skipped it.

Note also what you have **not** protected. `Leaderboard` and the cache
write-back still call Redis directly. They inherit the 500 ms deadline, so a
dead Redis costs you latency rather than correctness — but "I added a circuit
breaker to the cache" is not yet true. Wrap them the same way, or write down
why you chose not to.

> Note the subtlety: **a cache miss must not count as a failure.** Trip a breaker
> on misses and it opens permanently the first time your cache is cold.

> ### ⏸ Natural stopping point
>
> Everything above stands on its own — commit it and come back. The steps below
> build on it but don't destabilise anything if you stop here. Two 45-minute
> sittings beat one 90-minute slog you don't finish.

### Step 4 — retries with full jitter

**`internal/scouter/retry.go`**

```go
package scouter

import (
	"context"
	"math"
	"math/rand"
	"time"
)

type RetryPolicy struct {
	MaxAttempts int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
}

// Retry runs fn with exponential backoff and FULL jitter.
//
// Full jitter (sleep = rand(0, base*2^n)) beats both no-jitter and
// half-jitter: without it, every client that failed at the same moment
// retries at the same moment, and you have built a self-inflicted DDoS
// that fires exactly when the dependency is trying to recover.
//
// Only ever wrap IDEMPOTENT operations in this.
func Retry(ctx context.Context, p RetryPolicy, fn func(ctx context.Context) error) error {
	var err error
	for attempt := 0; attempt < p.MaxAttempts; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(float64(p.BaseDelay) * math.Pow(2, float64(attempt-1)))
			if backoff > p.MaxDelay {
				backoff = p.MaxDelay
			}
			jittered := time.Duration(rand.Int63n(int64(backoff) + 1))

			select {
			case <-time.After(jittered):
			case <-ctx.Done():
				// The caller's deadline is gone. Retrying now is pure waste.
				return ctx.Err()
			}
		}

		if err = fn(ctx); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return err
}
```

**`internal/scouter/retry_test.go`**

```go
package scouter

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRetrySucceedsOnThirdAttempt(t *testing.T) {
	calls := 0
	err := Retry(context.Background(),
		RetryPolicy{MaxAttempts: 5, BaseDelay: time.Millisecond, MaxDelay: 10 * time.Millisecond},
		func(context.Context) error {
			calls++
			if calls < 3 {
				return errors.New("transient")
			}
			return nil
		})
	if err != nil || calls != 3 {
		t.Fatalf("err=%v calls=%d, want nil/3", err, calls)
	}
}

func TestRetryStopsWhenContextExpires(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	calls := 0
	err := Retry(ctx,
		RetryPolicy{MaxAttempts: 100, BaseDelay: 10 * time.Millisecond, MaxDelay: time.Second},
		func(context.Context) error { calls++; return errors.New("always") })

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("got %v, want DeadlineExceeded", err)
	}
	if calls > 5 {
		t.Errorf("made %d calls after the deadline — retries ignored the context", calls)
	}
}
```

### Step 5 — load shedding

A guard that rejects when in-flight work exceeds what you can serve:

**`internal/scouter/shedder.go`**

```go
package scouter

import "net/http"

// Shedder bounds concurrent in-flight requests. Past the limit it rejects
// IMMEDIATELY rather than queueing — a request that would time out anyway
// is better rejected now, while the client can still do something about it.
type Shedder struct {
	sem chan struct{}
}

func NewShedder(max int) *Shedder {
	return &Shedder{sem: make(chan struct{}, max)}
}

func (s *Shedder) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never shed health checks — losing them makes the load balancer
		// remove you, which is the opposite of what an overloaded but
		// working service needs.
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			next.ServeHTTP(w, r)
			return
		}
		select {
		case s.sem <- struct{}{}:
			defer func() { <-s.sem }()
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Retry-After", "1")
			writeErr(w, http.StatusServiceUnavailable, "overloaded, retry shortly")
		}
	})
}
```

Compare the two behaviours under overload:

```bash
# without shedding: everything queues, everything times out
k6 run --vus 500 --duration 30s scripts/load/stress.js

# with shedding at, say, 100 concurrent
k6 run --vus 500 --duration 30s scripts/load/stress.js
```

Look at what changed: with shedding, the requests that *are* served keep a
healthy p99, and the rest fail fast with a `503` and a `Retry-After`. Without
it, **everything** is slow and most requests time out.

**Total successful requests is usually higher with shedding.** That's the result
worth internalising.

### Step 6 — simulate a cascade, then stop it

Make the database stop answering — not down, just silent, which is the worse
case from the start of this capsule:

```bash
docker compose pause postgres
k6 run --vus 100 --duration 20s scripts/load/stress.js
```

With none of this capsule's protections, every request would wait as long as
the database made it, goroutines would pile up, memory would grow, and
eventually health checks fail and the load balancer removes your (healthy)
instances.

Here is what you actually get. Measured with this capsule's code, 100 VUs from
one machine, Postgres paused:

- **Writes** each wait the 3-second timeout on the database call, then give up.
- **Leaderboard reads** that Redis can answer stay at a few milliseconds. The
  ones that miss go to Postgres and wait for their timeout (up to 5 s).
- **`/healthz` stays at a few milliseconds** — liveness never touches the
  database (Capsule 01).
- **Most of k6's requests get a `429` in ~2 ms** from Step 1's rate limiter,
  because they all come from one IP. That same limit is what keeps the number of
  in-flight requests below the shedder's cap in this run.

Notice what did *not* happen: nothing failed in ~0 ms because a breaker opened.
**Your breaker wraps Redis, not Postgres**, so a silent database is still paid
for in timeouts. What saved you is that the cost is *bounded* — by the deadlines
from Step 2, by the limiter, and by the shedder if more traffic gets through —
instead of piling up without limit. If you want database calls to fail fast too,
give them their own `Breaker`: same type, a second instance. And when you
unpause, everything recovers on the next request, because nothing was left
stuck.

```bash
docker compose unpause postgres
```

---

## In GCP

- **Cloud Armor** does rate limiting at the edge, before traffic reaches your
  service — per IP, per region, per header. `rate_limit_options` with
  `enforce_on_key = "IP"` or `"HTTP_HEADER"`. **This is the cheapest place to
  shed abusive load**, because you don't pay for it at all.
- **API Gateway / Apigee** enforce per-API-key quotas — the product-level version
  (Capsule 08).
- **Cloud Run** `--max-instances` is a backpressure mechanism: past it, requests
  queue and then 429. Setting it is how you protect your database from your own
  autoscaler.
- **Cloud Run request timeout** (default 300 s, max 60 min) is the outermost
  deadline. Set it much lower for user-facing services — 30 s at most. An
  endpoint that legitimately needs 5 minutes should be an async job (Capsule 20).
- **Cloud Tasks** gives you retries with backoff, rate limiting and concurrency
  control as a managed service, which is often better than implementing it.
- **Client libraries** for GCP services have built-in retry with backoff. Know
  their defaults — they interact with *your* timeouts, and doubled-up retry
  layers multiply.

---

## Bring it to work

- **A timeout on every network call**, derived from the caller's deadline.
- **Full jitter on every retry**, plus a retry budget, plus idempotency.
- **Never retry 4xx.**
- **A circuit breaker on every external dependency** — especially optional ones
  like caches, where an open breaker is strictly better than a timeout.
- **Bound every queue.** Unbounded queues are OOM crashes with a delay.
- **Shed load deliberately**, and never shed health checks.
- **Return `Retry-After` with 429/503.** It's how well-behaved clients cooperate.
- **Bulkhead your pools** so one bad endpoint can't take the service down.
- **Chaos-test it.** Pause a dependency in staging and watch. An untested
  breaker is a hypothesis.

---

## Battle drill

<details>
<summary><b>1.</b> One downstream service slows from 50 ms to 5 s. Your service, which doesn't even depend on it for most requests, goes down. Explain the chain.</summary>

1. Requests that touch the slow dependency hold their goroutine/thread and their
   connection for 5 s instead of 50 ms — a **100× increase in concurrent
   in-flight work** at the same request rate (Little's Law).
2. Those requests exhaust a shared resource: connection pool, thread pool, or
   memory.
3. Requests that *don't* touch that dependency now queue for the same exhausted
   resource. **Now everything is slow.**
4. Health checks time out. The load balancer removes instances. The remaining
   instances get more traffic and fail faster.
5. Clients time out and retry, doubling the offered load.

**Fixes:** aggressive timeouts (fail at 500 ms, not 5 s); a circuit breaker (stop
calling it entirely); **bulkheads** (a separate, small pool for that
dependency, so it can only ever consume its own share); load shedding; and
liveness checks that don't depend on it.

Step 3 is the critical one — the reason an unrelated endpoint dies is a
*shared* resource, which is exactly what bulkheads eliminate.
</details>

<details>
<summary><b>2.</b> Why does a retry storm happen, and what stops it?</summary>

A dependency degrades and starts failing 30% of requests. Every client retries.
Offered load is now 130% — at the precise moment the dependency has *less*
capacity. More failures, more retries, and it never recovers, even after the
original trigger is gone. This is a **metastable failure**: the system stays
broken by its own feedback loop.

Stopped by:
- **Retry budgets** — total retries capped at ~10% of requests, so retries can
  never dominate.
- **Circuit breakers** — clients stop retrying entirely once it's clearly down.
- **Full jitter** — retries spread out instead of arriving in waves.
- **Server-side `Retry-After`** — the server tells clients when to come back.
- **Load shedding at the server** — reject fast so clients aren't holding
  connections.

The general principle: **retries must be a small, bounded fraction of traffic,
never a multiplier.**
</details>

<details>
<summary><b>3.</b> Circuit breaker or just a timeout — why both?</summary>

A timeout bounds *one* request. A breaker bounds the *pattern*.

With only timeouts, a dead dependency costs you a full timeout on every request
forever: at 1,000 rps with a 2 s timeout, that's 2,000 requests permanently in
flight, all guaranteed to fail. You're burning your entire concurrency budget on
known-doomed work.

The breaker notices the pattern and fails instantly — no goroutine, no
connection, no wait — and returns a fallback. It also *stops hammering a
recovering dependency*, giving it room to come back.

They compose: timeouts detect individual slowness, the breaker reacts to
aggregate slowness.
</details>

<details>
<summary><b>4.</b> Design rate limiting for a public API with free and paid tiers.</summary>

- **Token bucket per API key**, with rate and burst from the plan
  (free: 10/s burst 20; pro: 100/s burst 200).
- **Enforce in Redis**, not per replica — a limit that multiplies by your replica
  count isn't a limit, and billing-adjacent limits must be exact.
- **Layer the keys**: per API key (fairness), per endpoint (protect expensive
  paths), and global (protect the database). A request must pass all three.
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`,
  and `Retry-After` on 429. Clients cannot behave well without them.
- **Edge enforcement** (Cloud Armor) for abusive/anonymous traffic so you don't
  pay to reject it.
- **Fail open on limiter failure.** If Redis is down, allowing traffic beats
  rejecting everyone — unless the limit is a hard billing constraint, in which
  case fail closed. Decide deliberately and write it down.
- **Monitor 429 rate per customer.** A customer constantly at their limit is a
  sales conversation, not an incident.
</details>

<details>
<summary><b>5.</b> Your service is at 100% capacity. Argue for rejecting requests.</summary>

At capacity, accepting more work doesn't produce more completed work — it
produces more *queued* work. Queue time is added to every request, so latency
climbs for everyone, including the requests you could have served fine. Clients
hit their own timeouts, give up, and retry — so you spend capacity computing
answers nobody will receive, then get more load.

Rejecting immediately means: the requests you accept still meet their SLO; the
rejected clients find out in 1 ms instead of 30 s and can back off, fail over, or
show a useful message; your memory stays flat; and your health checks keep
passing so you don't get removed from the pool.

**Measured outcome:** total successful requests is usually *higher* with
shedding, and p99 for served requests is dramatically better.

The nuance is *what* to shed: drop retries and background work first, keep
interactive user requests. And never shed health checks.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| Rate limiter blocks everyone | The key function returns a constant. Log the key while debugging. |
| Limit is N× higher than configured | Per-replica limiting with N replicas. Use Redis, or divide the limit. |
| Breaker never opens | Real failures aren't reaching `record(false)`. Check that the closure returns the error (only `redis.Nil` should become `nil`) and that the call actually goes through `breaker.Do`. Remember the threshold counts *consecutive* failures — one success in between resets it. (Counting misses or 404s as failures is the opposite bug: the breaker opens when nothing is wrong.) |
| Breaker never closes | `halfOpenNeed` successes never accumulate because probes keep failing — the dependency really is still down. |
| Retries take forever | No `MaxDelay` cap, so exponential backoff reaches minutes. Cap it. |
| Memory grows with limiter | Per-key map without reaping. That's what `reap()` is for. |
| Shedding rejects health checks | Exclude `/healthz` and `/readyz` explicitly. |

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "feat(resilience): rate limiting, circuit breaker, retries, shedding

Capsule 17. Token-bucket limiter per caller with Retry-After. Circuit breaker
around the cache so a dead Redis costs 0ms instead of a timeout per request.
Retry with full jitter that respects the caller's deadline. Bounded in-flight
shedder returning 503 rather than queueing. Verified under a paused database."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done 17
```

**Next:** [Capsule 18 · King Kai's Telepathy — Pub/Sub](../18-king-kai-telepathy-pubsub/README.md)
