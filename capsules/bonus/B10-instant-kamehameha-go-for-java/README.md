# Capsule B10 · Instant Kamehameha — Go for People Who Already Program

> *Goku learns the Kamehameha by watching Roshi do it once. He does not learn
> to fight — he already knows how to fight. He learns one new shape for power
> he already had.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 70 min | you can write code in **some** language | Capsule 01 |

---

## Why this capsule exists

Every capsule in this repo is written in Go, and none of them stop to teach it.
That's deliberate — Go is the vehicle, not the subject. But if you've never
written it, the first capsule costs you double: you're learning connection
pooling *and* wondering why `err != nil` is everywhere.

This capsule gets you to "I can read and modify the code in these capsules" in
one sitting. It is **not** a Go tutorial. It's a translation layer.

The comparisons below are drawn against **Java**, because that's the most
common background people arrive with and because the two languages disagree in
interesting places. **If you don't know Java, you lose nothing** — every Java
snippet is labelled and skippable, and the Go always stands on its own. If your
background is Python, TypeScript, C# or Kotlin, the same shifts apply; only the
"before" column changes.

> If Go is one of your *first* languages, start with
> [B11 · Turtle School](../B11-turtle-school-go-basics/README.md) instead. It
> teaches the toolchain — `go vet`, `gofmt`, `go test`, modules — and the rules
> the compiler enforces, which this capsule assumes you already have.

> If you already write Go, skip this and go to
> [B5 · Afterimage Technique](../B5-afterimage-go-concurrency/README.md), which
> covers the concurrency you'll actually need.

---

## The lore

The Kamehameha isn't new power. Goku had the ki already; Roshi showed him a
shape to put it in. That's what this capsule is — you already know loops,
types, functions, errors, and concurrency. You need the shapes Go puts them in,
and the four or five places where Go's shape is genuinely *different* rather
than just differently spelled.

Those four or five are the whole capsule. Everything else you can guess.

---

## The five things that are actually different

If you remember nothing else, remember these. Everything else is syntax you'll
absorb by reading.

| # | The shift | Why it matters here |
|---|---|---|
| 1 | **Interfaces are implicit** | This is why `Store` works in Capsule 06 and why every decorator in 12–17 composes without touching the interface |
| 2 | **Errors are values, not control flow** | There is no `try`. The `if err != nil` you'll type 200 times is the point, not the noise |
| 3 | **No inheritance — composition and embedding** | Capsules 12–17 wrap `Store` five times. In an inheritance language that's a five-deep class hierarchy |
| 4 | **Zero values are usable** | `var mu sync.Mutex` is ready. No constructor, no `null` check |
| 5 | **Concurrency is cheap and in the language** | A goroutine per request is normal, not a design decision |

---

## 1 · Implicit interfaces — the big one

**Java:** a class declares what it implements. The interface must exist first,
and the implementer must know about it.

```java
// JAVA — skip if unfamiliar
public interface Store { Reading latest(String fighter); }
public class MemStore implements Store {   // <- explicit declaration
    public Reading latest(String fighter) { ... }
}
```

**Go:** a type satisfies an interface by having the right methods. It never
says so. It doesn't even have to know the interface exists.

```go
type Store interface {
	Latest(fighter string) (Reading, bool)
}

type MemStore struct{ /* … */ }

// No "implements". MemStore satisfies Store because it has the method.
func (m *MemStore) Latest(fighter string) (Reading, bool) { /* … */ }
```

This inverts who owns the interface. In Java the interface tends to live with
the implementation and gets exported downward. In Go, **you declare the
interface where you consume it**, listing only the methods you actually call.

That is the single most useful idea in this capsule, and it's why the whole
Scouter arc works:

```go
// internal/scouter/server.go — the SERVER declares what it needs.
// PostgresStore, ShardedStore, ReplicatedStore, CachedStore and a test fake
// all satisfy it. None of them import this file.
type Store interface {
	Record(r Reading) error
	Latest(fighter string) (Reading, bool)
	Leaderboard(n int) []Reading
}
```

By Capsule 17 the real thing is
`CachedStore{ ReplicatedStore{ ShardedStore{ PostgresStore } } }` — four
wrappers, each satisfying `Store`, each unaware of the others. Adding a fifth
requires changing nothing. In an explicit-interface language every layer must
name the interface, and the interface becomes a thing you negotiate with other
teams.

> **The rule of thumb Go people repeat:** *accept interfaces, return structs.*
> Your function takes the narrowest interface it can, and returns a concrete
> type so the caller keeps all the methods.

### The nil interface trap

This one bites everyone once, and it's worth 60 seconds now so it costs you
minutes rather than an afternoon later.

An interface value holds **two** things: a type and a value. It is `nil` only
when *both* are nil.

```go
type MyError struct{ msg string }
func (e *MyError) Error() string { return e.msg }

func broken() error {
	var e *MyError = nil // a nil POINTER
	return e             // wrapped in an interface: type=*MyError, value=nil
}

func main() {
	if broken() != nil {
		fmt.Println("this prints!") // the interface is NOT nil
	}
}
```

**The fix is a habit, not a technique:** declare the return as `error` and
return the literal `nil`, never a typed nil pointer.

```go
func fixed() error {
	return nil // untyped nil — genuinely nil
}
```

---

## 2 · Errors are values

**Java:** exceptions travel up the stack on their own. You annotate with
`throws` or catch.

```java
// JAVA — skip if unfamiliar
try {
    Reading r = store.latest("goku");
} catch (StoreException e) {
    log.error("failed", e);
}
```

**Go:** a function returns its error alongside its result. Nothing propagates
by itself.

```go
r, err := store.Latest(ctx, "goku")
if err != nil {
	return fmt.Errorf("latest reading for goku: %w", err)
}
```

Three things to internalise:

- **Multiple return values are normal.** `(result, error)` is the standard
  shape, and `(value, ok)` is the standard shape for lookups.
- **`%w` wraps.** It builds a chain you can inspect later with `errors.Is`
  (sentinel comparison) and `errors.As` (type extraction). This is Go's
  equivalent of an exception cause chain.
- **The error message is built by the caller,** which is why Go errors read
  like a path: `record reading: query fighters: connection refused`. Each layer
  adds *its* context. Do not add the function's own name — add what it was
  trying to do.

```go
// The two you'll actually use:
if errors.Is(err, sql.ErrNoRows) { /* sentinel: is this THAT error? */ }

var pgErr *pgconn.PgError
if errors.As(err, &pgErr) { /* type: pull the rich error out of the chain */ }
```

`panic` exists and is **not** the exception mechanism. It's for "this program
is broken", not "this request failed". You will use it roughly never. Capsule
01's HTTP server recovers from a panic in one handler without killing the
process, and that's the only reason it comes up.

---

## 3 · Structs and embedding, not classes

There is no `class`, no `extends`, and no constructor keyword.

```go
type Reading struct {
	Fighter    string    `json:"fighter"`
	Power      int64     `json:"power"`
	RecordedAt time.Time `json:"recorded_at"`
}

// A "constructor" is just a function that returns one, by convention New*.
func NewReading(fighter string, power int64) Reading {
	return Reading{Fighter: fighter, Power: power, RecordedAt: time.Now()}
}
```

Those backtick strings are **struct tags** — metadata read at runtime by
`encoding/json`. Closest Java analogue: `@JsonProperty`. That's how the API
capsules control the JSON on the wire without a mapping layer.

**Methods are declared outside the type,** with a receiver:

```go
// value receiver — gets a COPY. Fine for small read-only structs.
func (r Reading) IsOver9000() bool { return r.Power > 9000 }

// pointer receiver — can mutate, and avoids copying. Use this by default
// once a type has any state worth protecting.
func (m *MemStore) Record(r Reading) error { /* … */ }
```

> **Pick one and stay consistent per type.** Mixing value and pointer receivers
> on the same type is the most common review comment on new Go code, because
> only the pointer type ends up satisfying an interface that includes a
> pointer-receiver method.

### Embedding is not inheritance

```go
type Base struct{ ID string }
func (b Base) Describe() string { return "id=" + b.ID }

type Fighter struct {
	Base          // embedded — no field name
	Name string
}

f := Fighter{Base: Base{ID: "f_1"}, Name: "goku"}
f.Describe()    // works: promoted from Base
f.ID            // works: promoted field
```

It looks like inheritance. It is **delegation with syntax sugar** — and the
difference is the one that matters: there is no virtual dispatch. If `Base` has
a method that calls `Describe()`, it calls **`Base.Describe`**, always. It will
never dispatch to a `Fighter.Describe` you defined later.

If you're coming from Java: every template-method pattern you know does not
work here. Go's answer is to pass the varying behaviour in as an interface or a
function value, which is what the middleware in Capsule 01 and the decorators
in 14–17 do.

---

## 4 · Zero values, slices, maps

**Every type has a usable zero value**, and idiomatic Go leans on it hard.

```go
var mu sync.Mutex     // ready to Lock(). No initialisation.
var buf bytes.Buffer  // ready to Write().
var s []string        // nil, but append() works and len() is 0
var count int         // 0
var name string       // "" — NOT null. There is no null string.
```

That last line matters more than it looks: Go has no `null` for value types, so
the entire category of Java's `NullPointerException` on a `String` simply does
not exist. Pointers can be nil, and that's the only place to look.

### Slices ≈ ArrayList, with a sharp edge

```go
xs := []int{1, 2, 3}
xs = append(xs, 4)        // append RETURNS a new slice — you must reassign
ys := xs[1:3]             // [2 3] — a VIEW, not a copy. Shares the backing array.
ys[0] = 99                // xs is now [1 99 3 4]
```

The sharing is the sharp edge, and it's genuinely different from `ArrayList`
and from Python lists. When you need independence, copy explicitly:

```go
zs := make([]int, len(xs))
copy(zs, xs)
```

### Maps ≈ HashMap

```go
m := map[string]int{"goku": 9001}
v, ok := m["vegeta"]      // v == 0, ok == false. The two-value form.
delete(m, "goku")
```

Two things Java doesn't do: reading a missing key returns the **zero value**
rather than null, and **maps are not safe for concurrent use** — concurrent
writes crash the process with `fatal error: concurrent map writes`, which you
cannot recover from. That crash is exactly the bug Capsule 01 plants on purpose
and Capsule 06 explains.

---

## 5 · Concurrency

```go
go handleRequest(r)   // that's a goroutine. Cheap: a few KB, not a few MB.
```

**Java:** `new Thread(...)` maps to an OS thread; you use a pool because
threads are expensive. Virtual threads (Loom) close most of this gap, but the
mental model of "threads are scarce" is what most Java code is written around.

**Go:** goroutines are multiplexed onto a small number of OS threads by the
runtime. One per request is the normal design, not a clever one. Go's HTTP
server already does this for you — which means **every handler you write in
this repo is already concurrent**, whether you thought about it or not.

```go
var wg sync.WaitGroup
for _, f := range fighters {
	wg.Add(1)
	go func() {
		defer wg.Done()
		process(f)     // Go 1.22+: `f` is per-iteration. Older Go: it was NOT.
	}()
}
wg.Wait()
```

Channels are typed pipes, and the idiom you'll see most is `select` with a
context:

```go
select {
case res := <-results:
	return res, nil
case <-ctx.Done():
	return nil, ctx.Err()   // caller gave up, or the deadline passed
}
```

`context.Context` is the first parameter of almost every function in this repo.
It carries deadlines and cancellation *down* the call tree. It has no Java
equivalent in wide use — treat it as a parameter you thread through everywhere
and never store in a struct.

That's the shape. [B5 · Afterimage Technique](../B5-afterimage-go-concurrency/README.md)
is the real treatment, including the race detector.

---

## `defer` ≈ `finally`, but per-statement

```go
f, err := os.Open("x")
if err != nil {
	return err
}
defer f.Close()   // runs when the FUNCTION returns, whatever path it takes
```

Deferred calls run last-in-first-out. The critical difference from `finally`:
**arguments are evaluated immediately**, only the call is deferred.

```go
start := time.Now()
defer log.Info("done", "ms", time.Since(start).Milliseconds()) // ❌ evaluated NOW: always 0
defer func() { log.Info("done", "ms", time.Since(start).Milliseconds()) }() // ✅
```

The mutex idiom you'll see in every capsule:

```go
func (m *MemStore) Record(r Reading) error {
	m.mu.Lock()
	defer m.mu.Unlock()   // released on every return path, including a panic
	m.data[r.Fighter] = r
	return nil
}
```

---

## Visibility, packages, modules

**Capitalisation is the access modifier.** There is no `public` or `private`.

```go
func Record(...)   // exported — visible outside the package
func record(...)   // unexported — package-private
type Reading struct {
	Fighter string  // exported field: marshalled to JSON
	secret  string  // unexported: invisible to encoding/json
}
```

There is no `protected`, and package-private is the *only* other level. That
last struct comment is a real gotcha: `encoding/json` can only see exported
fields, so a lowercase field silently vanishes from your API response.

| Java | Go |
|---|---|
| `package com.example.scouter` | directory = package; short lowercase name |
| Maven / Gradle | `go.mod` |
| `mvn dependency:tree` | `go mod graph` |
| `src/main/java/...` deep nesting | flat, shallow directories |
| `public` / `private` / `protected` | `Capital` / `lowercase` |
| jar | a single static binary |

Two Go-specific rules with no Java analogue:

- **`internal/` is compiler-enforced.** Anything under `internal/` cannot be
  imported by another module. Capsule 00 sets this up on purpose — it's the one
  boundary a compiler enforces rather than a linter.
- **Unused imports and unused local variables are compile errors**, not
  warnings. This is jarring for about a day and then you stop noticing.

---

## The syntax you can just guess

Skim this table; don't study it.

| Java | Go |
|---|---|
| `String s = "x";` | `s := "x"` (inferred) or `var s string = "x"` |
| `final int x = 5;` | `const x = 5` |
| `for (int i = 0; i < n; i++)` | `for i := 0; i < n; i++` |
| `for (String f : fighters)` | `for _, f := range fighters` |
| `while (cond)` | `for cond` |
| `while (true)` | `for` |
| `if/else if/else` | same, no parens around the condition |
| `switch` with `break` | `switch` — **no fallthrough by default** |
| `List<String>` | `[]string` |
| `Map<String, Integer>` | `map[string]int` |
| `Optional<T>` | `(T, bool)` or `(T, error)` |
| `null` | `nil` (pointers, slices, maps, channels, funcs, interfaces only) |
| `toString()` | `String() string` |
| `equals()` | `==` for comparable types; `reflect.DeepEqual` otherwise |
| `@Override` | nothing — there's no overriding |
| `System.out.println` | `fmt.Println` |
| `Thread.sleep(1000)` | `time.Sleep(time.Second)` |
| JUnit `@Test` | `func TestX(t *testing.T)` in `*_test.go` |
| `assertEquals(a, b)` | `if a != b { t.Errorf(...) }` — no assertion library in stdlib |

Formatting is not a preference: `gofmt` is canonical, ships with the toolchain,
and every Go repo is formatted identically. Nobody reviews your brace placement
because there is nothing to review.

---

## Lab — translate something real

The best way to check this landed is to read code you'll meet in Capsule 01
*before* you get there.

### Step 1 — a Go file, from scratch

```bash
mkdir -p ~/go-warmup && cd ~/go-warmup
go mod init warmup
```

**`main.go`**

```go
package main

import (
	"errors"
	"fmt"
	"sort"
	"sync"
)

// Reading is a power-level measurement. Exported fields only — an unexported
// field would be invisible to encoding/json later.
type Reading struct {
	Fighter string
	Power   int64
}

// ErrUnknownFighter is a SENTINEL error: callers compare against it with
// errors.Is instead of matching on a message string.
var ErrUnknownFighter = errors.New("unknown fighter")

// Store is declared here, where it is USED. Any type with these two methods
// satisfies it — without importing this file or naming this interface.
type Store interface {
	Record(r Reading) error
	Top(n int) []Reading
}

type MemStore struct {
	mu   sync.RWMutex          // zero value is ready to use
	data map[string]Reading    // a map must be MADE before writing
}

func NewMemStore() *MemStore {
	return &MemStore{data: make(map[string]Reading)}
}

func (m *MemStore) Record(r Reading) error {
	if r.Fighter == "" {
		return fmt.Errorf("record: %w", ErrUnknownFighter)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if cur, ok := m.data[r.Fighter]; !ok || r.Power > cur.Power {
		m.data[r.Fighter] = r
	}
	return nil
}

func (m *MemStore) Top(n int) []Reading {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]Reading, 0, len(m.data)) // len 0, capacity len(m.data)
	for _, r := range m.data {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Power > out[j].Power })
	if n < len(out) {
		out = out[:n]
	}
	return out
}

func main() {
	// The variable is typed as the INTERFACE, assigned a concrete value.
	var s Store = NewMemStore()

	for _, r := range []Reading{
		{"goku", 9001}, {"vegeta", 8500}, {"krillin", 1770}, {"goku", 150},
	} {
		if err := s.Record(r); err != nil {
			fmt.Println("failed:", err)
		}
	}

	if err := s.Record(Reading{Power: 1}); errors.Is(err, ErrUnknownFighter) {
		fmt.Println("rejected as expected:", err)
	}

	for i, r := range s.Top(2) {
		fmt.Printf("%d. %-8s %d\n", i+1, r.Fighter, r.Power)
	}
}
```

```bash
go run .
```

```
rejected as expected: record: unknown fighter
1. goku     9001
2. vegeta   8500
```

Note that `goku` stayed at 9001 — `Record` keeps the maximum, which is why the
second reading of 150 didn't overwrite it.

### Step 2 — a test, and the race detector

**`main_test.go`**

```go
package main

import (
	"sync"
	"testing"
)

func TestRecordKeepsMax(t *testing.T) {
	s := NewMemStore()
	_ = s.Record(Reading{"goku", 100})
	_ = s.Record(Reading{"goku", 9001})
	_ = s.Record(Reading{"goku", 50})

	got := s.Top(1)
	if len(got) != 1 || got[0].Power != 9001 {
		t.Fatalf("Top(1) = %v, want goku 9001", got)
	}
}

// The test that matters. Run it with -race.
func TestConcurrentRecord(t *testing.T) {
	s := NewMemStore()
	var wg sync.WaitGroup
	for i := range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = s.Record(Reading{"goku", int64(i)})
		}()
	}
	wg.Wait()
}
```

```bash
go test -race ./...
```

Both should pass. **Now break it on purpose** — comment out the `m.mu.Lock()`
and `defer m.mu.Unlock()` in `Record`:

```bash
go test -race ./...
```

```
==================
WARNING: DATA RACE
Read at 0x00c0000a4450 by goroutine 8:
  runtime.mapassign_fast64ptr()
  warmup.(*MemStore).Record()
      .../main.go:43 +0x104
```

(Goroutine numbers and addresses vary run to run, and the race detector is
sampling — if a run comes back clean, run it again.)

That is the single most valuable tool in the Go toolchain, and it's one flag.
Put the lock back.

> Note `for i := range 100` — integer range is Go 1.22+. If that fails to
> compile, your Go is too old; Capsule 00 covers fixing that.

### Step 3 — read ahead

Open [Capsule 01](../../01-scouter-first-service/README.md) and read the
`MemStore` and handler code **without doing the capsule**. You should now
recognise: the receiver syntax, `(value, ok)`, `if err != nil`, `defer
mu.Unlock()`, the interface declared at the point of use, and the struct tags.

If any of those still look like noise, that's the section to reread here.

---

## Bring it to work

- **Declare interfaces where you consume them, not where you implement them.**
  This is portable advice — it's the Dependency Inversion Principle with the
  ceremony removed, and it works in Java too. Go just makes it the path of
  least resistance.
- **Errors as values force you to decide at every call site.** You will notice
  how many exceptions in your Java code are caught three frames above where a
  sensible decision could have been made.
- **A build that fails on unused variables** catches a real class of
  half-finished refactor. Worth wanting in any language.
- **One canonical formatter, no options.** The argument about formatting is
  worth more than the formatting is, and `gofmt` ends it.

---

## Battle drill

<details>
<summary><b>1.</b> A function returns <code>*MyError</code> as its declared type, and returns <code>nil</code>. The caller's <code>if err != nil</code> is true. Why?</summary>

The declared return type is a concrete pointer, so returning it as an `error`
interface produces a value with type `*MyError` and value `nil`. An interface is
nil only when **both** halves are nil, so the check fails.

Declare the return type as `error` and return a literal `nil`. The general
lesson: an interface value is a (type, value) pair, and that's the source of
most Go nil confusion.
</details>

<details>
<summary><b>2.</b> You embed <code>Base</code> in <code>Fighter</code> and define <code>Fighter.Describe()</code>. A method on <code>Base</code> calls <code>Describe()</code>. Which one runs?</summary>

`Base.Describe`. Always. Embedding is delegation, not inheritance — there is no
virtual dispatch, so a base method can never call into a derived override.

Every template-method design you'd write in Java has to be restructured: pass
the varying behaviour in as an interface or a function value. That's what the
middleware chain in Capsule 01 does.
</details>

<details>
<summary><b>3.</b> Why is <code>ys := xs[1:3]</code> dangerous in a way <code>subList</code> or a Python slice isn't?</summary>

Go's slice is a view over a shared backing array, so writing through `ys`
mutates `xs`. (Python copies; Java's `subList` is a view but of a `List`, and
its behaviour on structural modification is at least loudly documented.)

The subtler version: `append` to a slice with spare capacity writes **into the
shared array**, silently changing another slice's contents. When you need
independence, `make` + `copy`.
</details>

<details>
<summary><b>4.</b> Your struct has a field <code>fighter string</code> and it never appears in the JSON response. Why?</summary>

It's lowercase, so it's unexported, so `encoding/json` — which uses reflection
and can only see exported fields — cannot read it. No error, no warning, the
field is just absent.

Capitalise it, and add a `json:"fighter"` tag to control the wire name.
</details>

<details>
<summary><b>5.</b> Two goroutines write to the same map. What happens, and why is it worse than a Java <code>HashMap</code> race?</summary>

`fatal error: concurrent map writes` — the runtime detects it and kills the
**entire process**. It is not a panic and `recover()` cannot catch it.

A Java `HashMap` race corrupts the map and may hang or produce wrong results,
which is arguably worse to debug but doesn't take down your service. Go chose
loud and immediate. Guard with a mutex, or use `sync.Map` for the specific
read-mostly cases it's built for — and run `go test -race` in CI.
</details>

---

## Senzu

| Symptom | Fix |
|---|---|
| `declared and not used` | Unused locals are errors, not warnings. Delete it, or assign to `_`. |
| `imported and not used` | Same for imports. Your editor should do this on save — set up `gopls`. |
| `cannot use x (type T) as type I` | Your type doesn't have every method in the interface — often because you defined methods on `T` but are assigning a `*T`, or vice versa. Check the receivers. |
| `invalid memory address or nil pointer dereference` | A nil pointer. Go's stack trace names the exact line; unlike an NPE there's no null for strings/ints to confuse it with. |
| `fatal error: concurrent map writes` | Unsynchronised map access. Not recoverable. Add a mutex and re-run with `-race`. |
| `for` loop variable captured wrong in a goroutine | Go 1.22+ scopes it per iteration. On older Go you needed `f := f` — if you see that idiom in old code, that's why. |
| `go: cannot find main module` | You're outside a module. `go mod init <name>`. |
| Tests don't run | The file must end in `_test.go` and the function must be `TestXxx(t *testing.T)` — capital T, exported name. |

---

## Log it

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done B10
```

**Next:** [Capsule 01 · Scouter — Your First Service](../../01-scouter-first-service/README.md),
which is where all of this stops being theory. Or
[B5 · Afterimage Technique](../B5-afterimage-go-concurrency/README.md) if you
want the concurrency treatment first.
