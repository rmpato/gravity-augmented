# Capsule B5 · Afterimage Technique — Concurrency in Go

> *The Afterimage makes it look like you're in several places at once. You
> aren't — you're moving between them fast enough that the distinction stops
> mattering. Concurrency is dealing with many things at once; parallelism is
> doing many things at once. Goku's afterimage is concurrency.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 70 min | basic Go | Capsule 17 |

---

## Why this capsule exists

Every service in this repo is concurrent whether you thought about it or not —
Go's HTTP server runs each request in its own goroutine. That means shared state
is *already* a hazard, and the bugs it produces are non-deterministic, invisible
in tests, and catastrophic in production (`fatal error: concurrent map writes`
kills the whole process, uncatchably).

This capsule covers what you actually need: `context`, worker pools, the race
detector, and the handful of patterns that appear in every real service.

---

## Goroutines

```go
go doSomething()   // that's it
```

A goroutine starts with a ~2 KB stack that grows on demand, versus ~1–8 MB for
an OS thread. Millions of goroutines are routine; millions of threads are not.

Go's scheduler multiplexes goroutines onto `GOMAXPROCS` OS threads (Capsule 05 —
and the cgroup trap). A goroutine that blocks on I/O yields its thread to
another; a goroutine in a tight CPU loop is preemptible since Go 1.14.

**The two rules that prevent most goroutine bugs:**

1. **Never start a goroutine without knowing how it ends.** An unbounded or
   never-terminating goroutine is a leak, and leaked goroutines hold everything
   they reference.
2. **The starter is responsible for the lifetime.** Pass a `context`, or a
   `done` channel, or a `WaitGroup` — something that says when to stop.

### The loop variable trap (fixed in Go 1.22, but know it)

```go
// Go < 1.22: all goroutines see the FINAL value of i. A classic.
for i := 0; i < 5; i++ {
    go func() { fmt.Println(i) }()   // prints 5,5,5,5,5
}

// Go < 1.22 fix:
for i := 0; i < 5; i++ {
    i := i                            // shadow it
    go func() { fmt.Println(i) }()
}
```

**Go 1.22+ makes loop variables per-iteration**, so the original is now correct.
You still need to recognise the pattern in older code and in other languages
(JavaScript's `var` has the identical bug).

---

## Channels

```go
ch := make(chan int)       // UNBUFFERED: send blocks until a receiver is ready
ch := make(chan int, 10)   // BUFFERED: send blocks only when full
```

**Unbuffered channels are a synchronisation point** — the send and receive happen
together. That's often what you want, and it's a natural backpressure mechanism.

**Buffered channels decouple** producer and consumer up to the buffer size. The
buffer size is a *capacity* decision: too small and you serialise, too large and
you've built an unbounded queue that hides a throughput problem (Capsule 17).

```go
// select: whichever is ready first. The core concurrency primitive.
select {
case v := <-ch1:
    use(v)
case ch2 <- x:
    // sent
case <-time.After(time.Second):
    // timeout
case <-ctx.Done():
    return ctx.Err()
default:
    // non-blocking: taken if nothing else is ready
}
```

**Channel rules that prevent panics:**

- **Only the sender closes**, and only when no more sends will happen. Sending on
  a closed channel panics; closing twice panics.
- **Receiving from a closed channel** returns the zero value immediately.
  `v, ok := <-ch` — `ok` is false when closed and drained.
- **A nil channel blocks forever.** Occasionally useful in `select` to disable a
  case.
- **`range ch`** receives until closed.

> **"Share memory by communicating"** is the Go proverb, but it's not absolute.
> A mutex around a map is often simpler and faster than a channel-based
> alternative. **Use channels for ownership transfer and coordination; use
> mutexes for protecting state.**

---

## Context — the most important type in Go services

`context.Context` carries **deadlines, cancellation and request-scoped values**
across API boundaries. Every function that does I/O should take one as its first
parameter.

```go
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()          // ALWAYS. Not calling it leaks the timer and the goroutine.

ctx, cancel := context.WithCancel(ctx)
ctx, cancel := context.WithDeadline(ctx, t)
ctx = context.WithValue(ctx, key{}, val)   // request-scoped data ONLY
```

**Cancellation propagates down the tree.** Cancel a parent and every derived
context is cancelled — which is exactly the deadline propagation from Capsule 17.

```go
func work(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()          // context.Canceled or DeadlineExceeded
        case job := <-jobs:
            if err := process(ctx, job); err != nil {
                return err
            }
        }
    }
}
```

**The rules:**

- Pass it explicitly as the **first parameter**. Never store it in a struct.
- **Always `defer cancel()`**, even when the context will expire anyway.
- **`WithValue` is for request-scoped data** — trace ids, user identity. Not for
  optional parameters, not for dependency injection.
- Use an **unexported struct type as the key** to prevent collisions:
  `type ctxKey struct{}`.
- A `nil` context is a bug. Use `context.TODO()` if you genuinely don't have one
  yet.

---

## Synchronisation primitives

```go
var mu sync.Mutex
mu.Lock(); defer mu.Unlock()

var rw sync.RWMutex
rw.RLock()   // many readers OR one writer
rw.Lock()    // exclusive

var wg sync.WaitGroup
wg.Add(1); go func(){ defer wg.Done(); ... }(); wg.Wait()

var once sync.Once
once.Do(func(){ /* runs exactly once, ever */ })

var counter atomic.Int64
counter.Add(1)          // lock-free, for simple counters

var m sync.Map           // for high-read, low-write, disjoint-key workloads
```

**Choosing:**

- **`atomic`** for a single counter or flag. Fastest.
- **`Mutex`** for anything else. Simple and fast; don't reach past it without a
  measurement.
- **`RWMutex`** only when reads *heavily* dominate and the critical section is
  long — it has more overhead per operation, so for short critical sections a
  plain `Mutex` is often faster.
- **`sync.Map`** is *not* a general replacement for `map` + `Mutex`. It's
  optimised for two specific cases (write-once-read-many, and disjoint key sets
  per goroutine). Benchmark before using it.

**`defer mu.Unlock()` immediately after `Lock()`** — the discipline that prevents
the "returned early and never unlocked" deadlock.

---

## Patterns you'll actually use

### Worker pool with bounded concurrency

```go
// Bounded concurrency. Unbounded `go` per item is how you exhaust file
// descriptors, connections, or memory (Capsule 17's bulkhead idea in code).
func ProcessAll(ctx context.Context, items []Item, workers int) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(workers)          // errgroup does the bounding for you

    for _, item := range items {
        item := item             // (unnecessary in Go 1.22+, harmless)
        g.Go(func() error {
            return process(ctx, item)
        })
    }
    // Wait returns the FIRST error, and cancels ctx so siblings stop early.
    return g.Wait()
}
```

`golang.org/x/sync/errgroup` is the right default for "run N things, stop on the
first failure". It combines `WaitGroup`, error collection and context
cancellation.

### Fan-out / fan-in

```go
func FanIn[T any](ctx context.Context, chans ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup

    for _, c := range chans {
        wg.Add(1)
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return       // don't block forever if nobody is reading
                }
            }
        }(c)
    }

    go func() { wg.Wait(); close(out) }()   // closer owns the channel
    return out
}
```

### Pipeline with cancellation

```go
func generate(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)                 // producer closes
        for i := 0; i < n; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return                   // THE LEAK PREVENTION
            }
        }
    }()
    return out
}
```

**Without the `ctx.Done()` case, a consumer that stops early leaves this
goroutine blocked on `out <- i` forever.** That's the canonical Go goroutine
leak, and it's why every stage of a pipeline needs a cancellation path.

### Singleflight (Capsule 15)

```go
var g singleflight.Group

v, err, shared := g.Do(key, func() (any, error) {
    return expensiveLoad(key)
})
```

### Timeout an operation that doesn't take a context

```go
func withTimeout[T any](ctx context.Context, d time.Duration, fn func() (T, error)) (T, error) {
    type result struct {
        v   T
        err error
    }
    ch := make(chan result, 1)   // BUFFERED: so the goroutine can exit even
                                 // if we've already returned on timeout.
    go func() {
        v, err := fn()
        ch <- result{v, err}
    }()

    select {
    case r := <-ch:
        return r.v, r.err
    case <-time.After(d):
        var zero T
        // NOTE: fn is still running. We abandoned it, we didn't cancel it.
        // This is why context-aware APIs matter.
        return zero, context.DeadlineExceeded
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

**The buffered channel is the important detail.** With an unbuffered channel, if
we return on timeout nobody ever receives, and that goroutine leaks forever.

---

## Lab

### Step 1 — see a data race

**`internal/conc/race_test.go`**

```go
package conc

import (
	"sync"
	"testing"
)

func TestRaceDemo(t *testing.T) {
	// Run with -race and this fails. Run without and it "passes"
	// with a wrong answer — which is exactly why races survive in
	// production for months.
	counter := 0
	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			counter++ // READ, ADD, WRITE — three steps, not one
		}()
	}
	wg.Wait()
	t.Logf("counter = %d (want 1000)", counter)
}
```

```bash
go test ./internal/conc/ -run RaceDemo -v          # often prints ~980
go test ./internal/conc/ -run RaceDemo -race -v    # DATA RACE detected
```

**`counter++` is not atomic.** It compiles to load, increment, store, and two
goroutines can interleave between them.

Three correct fixes, and when to use each:

```go
// 1. atomic — for a plain counter. Fastest.
var counter atomic.Int64
counter.Add(1)

// 2. mutex — for anything more complex than a counter
var mu sync.Mutex
mu.Lock(); counter++; mu.Unlock()

// 3. channel — when the count is a result to collect, not shared state
results := make(chan int, 1000)
```

### Step 2 — a goroutine leak, then the fix

```go
// LEAKS: if the consumer stops reading, this goroutine blocks forever
// on the send and is never collected. It holds its stack, its closure,
// and anything they reference.
func leaky() <-chan int {
	ch := make(chan int)
	go func() {
		for i := 0; ; i++ {
			ch <- i           // blocks forever once nobody reads
		}
	}()
	return ch
}

// FIXED
func notLeaky(ctx context.Context) <-chan int {
	ch := make(chan int)
	go func() {
		defer close(ch)
		for i := 0; ; i++ {
			select {
			case ch <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	return ch
}
```

Prove it:

```go
func TestGoroutineLeak(t *testing.T) {
	before := runtime.NumGoroutine()

	for i := 0; i < 100; i++ {
		ch := leaky()
		<-ch // read once, then abandon
	}

	time.Sleep(100 * time.Millisecond)
	after := runtime.NumGoroutine()
	t.Logf("goroutines: %d -> %d (leaked ~%d)", before, after, after-before)
	if after-before > 10 {
		t.Errorf("leaked %d goroutines", after-before)
	}
}
```

```bash
go test ./internal/conc/ -run Leak -v
```

For real services, use `go.uber.org/goleak` in `TestMain` — it fails any test
that leaves goroutines behind, which catches this class of bug automatically:

```go
func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}
```

### Step 3 — bounded vs unbounded concurrency

```go
// ❌ unbounded: 10,000 concurrent HTTP calls will exhaust file descriptors,
// hammer the target, and probably OOM
for _, url := range urls {
	go fetch(url)
}

// ✅ bounded
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(20)
for _, url := range urls {
	url := url
	g.Go(func() error { return fetch(ctx, url) })
}
if err := g.Wait(); err != nil {
	return err
}
```

Benchmark the difference against a local server:

```go
func BenchmarkConcurrency(b *testing.B) {
	for _, workers := range []int{1, 4, 16, 64, 256} {
		b.Run(fmt.Sprintf("workers-%d", workers), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				g := new(errgroup.Group)
				g.SetLimit(workers)
				for j := 0; j < 1000; j++ {
					g.Go(func() error {
						time.Sleep(time.Millisecond) // simulated I/O
						return nil
					})
				}
				_ = g.Wait()
			}
		})
	}
}
```

```bash
go test ./internal/conc/ -bench Concurrency -benchtime 3x
```

You'll see gains flatten and then reverse — the same knee as Capsule 09, in
process. **More concurrency is not monotonically better.**

### Step 4 — context cancellation end to end

```go
func TestContextPropagates(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	g, ctx := errgroup.WithContext(ctx)
	started := atomic.Int32{}
	finished := atomic.Int32{}

	for i := 0; i < 10; i++ {
		g.Go(func() error {
			started.Add(1)
			select {
			case <-time.After(500 * time.Millisecond):
				finished.Add(1)
				return nil
			case <-ctx.Done():
				return ctx.Err() // respected the deadline
			}
		})
	}

	err := g.Wait()
	t.Logf("started=%d finished=%d err=%v", started.Load(), finished.Load(), err)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("got %v, want DeadlineExceeded", err)
	}
	if finished.Load() != 0 {
		t.Errorf("%d goroutines ignored the deadline", finished.Load())
	}
}
```

**Ten goroutines, one deadline, all of them stop.** That's the mechanism behind
every timeout in Capsule 17.

### Step 5 — always run tests with `-race`

```makefile
test:
	go test ./... -race -count=1
```

- `-race` instruments memory access; roughly 2–10× slower and 5–10× more memory.
- `-count=1` disables the test cache so you actually re-run.
- **Run `-race` in CI.** It only detects races that *actually occur*, so more
  execution paths means more coverage. Some teams also run a slower `-race`
  build in staging.

---

## Bring it to work

- **`go test -race` in CI. Always.**
- **Never start a goroutine without a defined exit.** Context, done channel, or
  `WaitGroup`.
- **Bound every fan-out.** `errgroup.SetLimit`, or a semaphore channel.
- **`context.Context` as the first parameter** of every I/O function.
- **`defer cancel()` immediately** after creating a cancellable context.
- **`defer mu.Unlock()` immediately** after `Lock()`.
- **Only the sender closes a channel.**
- **Buffered channel of size 1** for a goroutine that reports a result you might
  abandon — otherwise it leaks.
- **`goleak` in `TestMain`** for services.
- **Prefer a mutex to a channel for protecting state.** Channels are for
  ownership transfer.

---

## Battle drill

<details>
<summary><b>1.</b> Your service works in tests and panics with "concurrent map writes" in production. Explain.</summary>

Go's runtime detects concurrent map access and **deliberately panics** — it's
not recoverable, and it kills the whole process, taking every in-flight request
with it. That's intentional: a corrupted map is worse than a crash.

It doesn't happen in tests because your tests are effectively single-threaded, or
the timing window is small enough that the interleaving never occurs. Races are
probabilistic; production has thousands of goroutines and the odds catch up.

**Find it:** `go test -race` with a test that exercises the map concurrently.
The race detector reports both stack traces — the conflicting read and write.

**Fix:** a `sync.Mutex` (or `RWMutex` if reads dominate), `sync.Map` if the access
pattern fits, or restructure so one goroutine owns the map and others send it
messages.

**Prevent:** `-race` in CI, and treat any shared mutable state as requiring a
documented synchronisation strategy.
</details>

<details>
<summary><b>2.</b> What's a goroutine leak and how do you find one?</summary>

A goroutine that never terminates — usually blocked forever on a channel send or
receive that nobody will service, or in a loop with no cancellation path. Each
one holds its stack plus everything its closure references, so leaks look like a
slow memory leak that eventually OOMs.

**Detect:** expose `runtime.NumGoroutine()` as a metric (Capsule 25) and alert on
sustained growth. In tests, `go.uber.org/goleak`. Live, `pprof`:

```bash
go tool pprof http://localhost:8080/debug/pprof/goroutine
# then: top, and `traces` to see where they're all stuck
```

Thousands of goroutines at the same line is the answer.

**Common causes:** a producer with no `ctx.Done()` case; an unbuffered result
channel whose reader timed out; a `time.Ticker` never stopped; a subscription
never unsubscribed; a `WaitGroup` where `Done()` isn't reached on an error path.
</details>

<details>
<summary><b>3.</b> When would you use a channel instead of a mutex?</summary>

Channels for **transferring ownership** and **coordinating**; mutexes for
**protecting state**.

Channel: a pipeline where each stage owns the data it receives; distributing work
to a pool; signalling completion or cancellation; anywhere `select` over multiple
events is natural.

Mutex: a shared cache, a counter, a config struct read by many goroutines — cases
where the data stays in one place and many goroutines touch it.

Trying to protect a shared map with a channel means routing every read and write
through a single goroutine, which serialises everything and is both slower and
harder to read than `mu.Lock()`.

The proverb "share memory by communicating" is guidance, not law — and the Go
standard library uses mutexes extensively.
</details>

<details>
<summary><b>4.</b> Why must a result channel be buffered when the caller might time out?</summary>

```go
ch := make(chan result)     // UNBUFFERED
go func() { ch <- compute() }()

select {
case r := <-ch:  return r
case <-time.After(d): return timeout   // we leave...
}
```

On timeout, the caller returns. The goroutine is still blocked on `ch <-
compute()` because an unbuffered send needs a receiver, and there will never be
one. **That goroutine leaks permanently**, holding its stack and everything it
captured.

`make(chan result, 1)` lets the send complete into the buffer and the goroutine
exits cleanly. The value is discarded when the channel is garbage collected.

Note what this does *not* fix: `compute()` still ran to completion. You abandoned
it, you didn't cancel it. That's why context-aware APIs are better than
timeout-wrappers — cancellation actually stops the work.
</details>

<details>
<summary><b>5.</b> How many goroutines is too many?</summary>

The count itself is rarely the issue — Go handles millions. What matters is what
each one *holds*.

Real limits: file descriptors (`ulimit -n`, often 1024 by default); database
connections (Capsule 10 — 10,000 goroutines each wanting a connection against a
100-connection pool means 9,900 waiting); memory (2 KB minimum stack, but a
goroutine holding a 1 MB buffer is 1 MB); and downstream capacity — 10,000
concurrent calls to a service sized for 500 is a DoS you built.

So the question is never "how many goroutines" but **"how many concurrent
operations against each constrained resource"** — which is the bulkhead idea from
Capsule 17.

Practically: bound fan-out with `errgroup.SetLimit` or a semaphore, size the
bound from a measurement (Capsule 09), and monitor `runtime.NumGoroutine()` for
unexpected growth.
</details>

---

## Log it

```bash
cd ~/repos/pato/gravity-chamber
git add -A
git commit -m "test: run the race detector in the default test target

Capsule B5. make test now runs -race -count=1. Added goleak to TestMain so
leaked goroutines fail the build. Fan-out bounded with errgroup.SetLimit."

cd ~/repos/pato/gravity-augmented && ./bin/scouter done B5
```
