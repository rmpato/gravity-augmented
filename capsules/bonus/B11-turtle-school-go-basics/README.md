# Capsule B11 · Turtle School — Go Basics & the Daily Toolchain

> *Before Roshi teaches anyone a technique, he makes them deliver milk on foot,
> plough a field bare-handed and swim from the shark. Goku wants the
> Kamehameha. He gets a milk cart. The training looks like it has nothing to do
> with fighting, and then one day the shell comes off and he is faster than
> everyone who skipped it.*

| Power level | Time | Prereqs | Best taken before |
|---|---|---|---|
| Bonus · 150 | 120 min, plus a cheatsheet you keep | you can write a `for` loop in *some* language; Go 1.22+ installed (Capsule 00) | Capsule 01 |

---

## Why this capsule exists

The course is written in Go and never stops to teach it.
[B10 · Instant Kamehameha](../B10-instant-kamehameha-go-for-java/README.md)
covers the language for people who already program in something else — it
assumes you know what a build tool is, that you have opinions about
formatting, and that "run the tests" is a phrase you've typed.

This one sits underneath that. It is for the person on their first or second
job who is meeting Go as an early language, and it teaches the part nobody
writes down: **the five commands you type all day, what the compiler is
shouting about, and why so much of Go feels like it's telling you off.**

Go is an *opinionated* language. Things that are style preferences elsewhere
are compile errors here. Things that are a library choice elsewhere are built
into the tool. That is disorienting for about a week — and the whole point is
that after that week, every Go codebase you open looks like the one you left.

Nothing here is deep. It's the stuff that makes the first month cost half as
much.

> **Already comfortable in another language?** Read
> [B10](../B10-instant-kamehameha-go-for-java/README.md) instead, or read this
> one at speed for the toolchain and skip to the cheatsheet.

---

## How to use this page

It's two documents stapled together, on purpose.

1. **Read it once, in order, with a terminal open.** Parts 1–7 build up the
   toolchain and the habits, and the **Lab** at the end makes every mistake in
   it deliberately, so you've already seen each error message before it happens
   for real.
2. **Then come back to [the cheatsheet](#the-cheatsheet)** whenever you're
   mid-task and can't remember whether it's `go mod tidy` or `go tidy mod`.
   It's at the bottom, it's all tables, and it assumes you've read the rest.

Bookmark this one. It's meant to be reopened.

---

## The lore

Roshi's training is not about strength, it's about making the boring thing
automatic. Deliver the milk every morning and one day you notice you've been
running up the mountain without thinking about it.

Go's toolchain is the milk cart. `gofmt`, `go vet` and `go test` are not
advanced tools you graduate into — they're the first three things you run,
every day, forever, and they are the reason Go teams argue about design
instead of about braces.

The weighted shell is the compiler. It refuses things other languages allow,
you resent it, and then you take it off in a code review where nobody has to
mention that you left an unused import behind.

---

## Part 1 — The toolchain is half the language

Go ships one binary, `go`, and it is the build system, the test runner, the
package manager, the formatter, the documentation browser and the static
analyser. There is no Maven, no npm, no `Makefile` you have to write first,
and no plugin to install.

That's the single biggest practical difference from where you're coming from,
and it's why a Go repo can have no build config at all.

### The commands, in the order you'll meet them

| Command | What it does | When you type it |
|---|---|---|
| `go version` | prints the toolchain version | first thing, when something is weird |
| `go mod init <name>` | starts a module — creates `go.mod` | once per project, ever |
| `go run .` | compile to a temp dir and run it | the inner loop while writing |
| `go build ./...` | compile everything, report errors | "does it still compile?" |
| `go test ./...` | run every test in every package | before every commit |
| `gofmt -l .` | list files that aren't formatted | in CI; your editor does it on save |
| `go vet ./...` | static checks the compiler doesn't do | before every commit, with the tests |
| `go doc <thing>` | print docs for a package or symbol | instead of opening a browser |
| `go mod tidy` | add what's imported, drop what isn't | after you add or remove an import |
| `go env` | show the toolchain's own settings | when the module cache misbehaves |

`./...` means "this directory and every package under it". You will type it a
few thousand times. It is not a typo, it is not a glob your shell expands —
it's a Go path pattern, and it's why quoting it is never necessary.

### `go run` vs `go build` vs `go install`

These three confuse everyone once.

```bash
go run .                 # compile to a temp dir, run it, throw the binary away
go build -o turtle .     # compile, leave ./turtle behind, don't run it
go install ./cmd/scouter # compile and put the binary in $(go env GOBIN)
```

`go run` is for the loop you're in right now. `go build` is what CI does and
what produces the thing you put in a container (Capsule 02). `go install` is
for tools you want on your `PATH`.

The output of `go build` is **one static binary with no runtime to install** —
that's why the Dockerfile in Capsule 02 can end with a `FROM scratch` stage
and why Go is over-represented in infrastructure.

### The single-file trap

Every junior hits this in week one:

```bash
go run main.go
```

```
# command-line-arguments
./power.go:14:7: undefined: NewStore
./power.go:19:14: undefined: Shout
```

Naming a file compiles *only that file*, so everything else in your package
disappears. **Type `go run .`** — the dot means "the package in this
directory", which is almost always what you meant.

---

## Part 2 — `gofmt`: the argument is over

```bash
gofmt -l .      # which files are not formatted? (prints nothing if all are)
gofmt -d .      # show me the diff
gofmt -w .      # fix them in place
```

There is exactly one correct formatting of any Go program, `gofmt` produces
it, it ships with the toolchain, and it has **no options**. Not "few options".
None. You cannot configure the indentation, because it is tabs.

Coming from a language where formatting is a config file you inherit and a
lint rule someone disabled in 2019, this feels authoritarian. Two things to
notice once you've lived with it:

- **Code review stops containing style comments.** Every reviewer sees the
  same shape, so the conversation is about the design.
- **Diffs stay small,** because nobody's editor reflows a file they touched
  one line of.

Set your editor to run it on save — `gopls`, the official language server,
does this and every editor with Go support uses it. Then you never think about
it again, which is the entire design goal.

> `go fmt ./...` is a thin wrapper that runs `gofmt -l -w` over packages.
> Either is fine. `gofmt` is the one that takes the interesting flags.

---

## Part 3 — `go vet`: the compiler's paranoid cousin

**This is the section people skip and shouldn't.** `go vet` finds bugs that
compile perfectly and are wrong at runtime.

The canonical example: this compiles, runs, and exits 0.

```go
fmt.Printf("%s is at %s\n", f.Name, f.Power)   // Power is an int
```

```
goku is at %!s(int=9001)
```

That `%!s(int=9001)` is Go's way of saying "you asked me to print an int as a
string". Nothing failed. It's just wrong, in your logs, in production. Now:

```bash
go vet ./...
```

```
# turtle
# [turtle]
./power.go:12:23: fmt.Printf format %s has arg f.Power of wrong type int
```

Found statically, before it ever ran. That's the whole pitch.

> The `# turtle` / `# [turtle]` pair is just vet labelling the package and its
> test variant; older toolchains print only the first. Ignore both lines and
> read the one with a file and a line number.

### What vet actually checks

`go vet` is a bundle of small analysers. See the list your toolchain has with
`go tool vet help`. The ones that will catch *you*:

| Analyser | Catches |
|---|---|
| `printf` | format verb doesn't match the argument type, or wrong argument count |
| `copylocks` | a `sync.Mutex` copied by value — the copy locks nothing |
| `lostcancel` | the `cancel` from `context.WithTimeout` never called (a context leak) |
| `structtag` | a malformed `json:"..."` tag, which silently does nothing |
| `loopclosure` | a loop variable captured by a goroutine (the pre-Go 1.22 classic) |
| `httpresponse` | using `resp` before checking `err`, or a missing `defer resp.Body.Close()` |
| `unusedresult` | calling `fmt.Sprintf` or `errors.New` and throwing the result away |
| `tests` | a test function with the wrong signature, so it silently never runs |
| `nilfunc`, `unreachable`, `shift`, `assign` | code that provably does nothing |

Two of those are worth seeing in full, because the error message *teaches* you
the rule:

```
./store.go:11:9: Record passes lock by value: turtle.Store contains sync.Mutex
./tmp_vet.go:14:7: the cancel function returned by context.WithTimeout should be called, not discarded, to avoid a context leak
./tmp_vet.go:9:2: struct field tag `json: "fighter"` not compatible with reflect.StructTag.Get: bad syntax for struct tag value
```

The first is a value receiver on a type containing a mutex — every call gets
its own copy of the lock, so the lock protects nothing and the race is
invisible. The last one is a space after `json:` in a struct tag; the tag is
ignored, your field marshals under its Go name, and your API contract changes
without a single error.

### `go test` already runs vet, partially

```
As part of building a test binary, go test runs go vet on the package
and its test source files… Only a high-confidence subset of the default
go vet checks are used. That subset is: atomic, bool, buildtags, directive,
errorsas, ifaceassert, nilfunc, printf, stringintconv, and tests.
```
*(from `go help test`)*

So `go test` will refuse to run if your `t.Errorf` has the wrong number of
arguments — but it will **not** catch `copylocks` or `lostcancel`. Run both:

```bash
go vet ./... && go test ./...
```

Put that pair in your `Makefile` and in CI on day one.

### vet is not a linter, and that's deliberate

`go vet` only reports things that are *almost certainly bugs*. It has no style
opinions, because `gofmt` already settled those. If you want more, they're
separate tools you install:

| Tool | What it adds |
|---|---|
| `staticcheck` | the good one. Dead code, redundant conditions, misused stdlib |
| `golangci-lint` | a runner that bundles staticcheck, vet and dozens more |
| `govulncheck` | known CVEs in your dependencies — **and only if you actually call the vulnerable function** (Capsule B9) |

None are required for this course. `gofmt`, `vet` and `test` are.

---

## Part 4 — `go test`: tests belong to the language

There is no JUnit, no pytest, no Jest. Testing is in the standard library and
in the `go` command, and every Go project on earth runs tests the same way.

The rules are mechanical, and breaking any one of them makes your test
**silently not exist**:

- The file ends in `_test.go`.
- The function is `func TestXxx(t *testing.T)` — capital `T`, and the name
  after `Test` must start with a capital too.
- It lives in the same directory as the code it tests.

That last one surprises people from Java or Python: no parallel `test/` tree.
`store.go` and `store_test.go` sit next to each other, and the test file can
be in the same package, which means **your tests can reach unexported
identifiers.** That is normal and idiomatic here.

### There are no assertions

```go
if got != want {
	t.Errorf("Shout(%q) = %q, want %q", in, got, want)
}
```

That's it. No `assertEquals`, no `expect(x).toBe(y)`. The convention is rigid
enough to be its own kind of assertion library:

- **`got` and `want`**, in that order, in the message. Every Go engineer reads
  it at a glance.
- **`t.Errorf` records the failure and keeps going.** `t.Fatalf` stops this
  test immediately — use it when continuing would just panic on a nil.
- Use `%q` for strings so you can see the whitespace.

### Table-driven tests are the idiom

Not a pattern someone likes. *The* idiom — you'll see it in the standard
library itself.

```go
func TestShout(t *testing.T) {
	cases := []struct {
		name string // the subtest's name, not an input
		in   string
		want string
	}{
		{"normal", "goku", "GOKU!!!"},
		{"already upper", "VEGETA", "VEGETA!!!"},
		{"empty", "", "WHO?"},
		{"spaces kept", "master roshi", "MASTER ROSHI!!!"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Shout(c.in)
			if got != c.want {
				t.Errorf("Shout(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
```

Adding a case is one line. `t.Run` gives each case its own name in the output,
so a failure tells you *which* case, and you can re-run just that one with
`go test -run 'TestShout/empty'`.

### The flags that matter

| Flag | Use |
|---|---|
| `-v` | show every test and subtest, passing or not |
| `-run 'TestShout/empty'` | run one test, or one subtest — it's a regex |
| `-race` | the race detector. Non-negotiable for anything concurrent (B5) |
| `-count=1` | disable the test cache when you want a real re-run |
| `-cover` | print a coverage percentage |
| `-failfast` | stop at the first failing test |

`-count=1` deserves a note: Go **caches** successful test results. If you run
`go test` twice with nothing changed, the second prints `(cached)`. That is a
feature until you're testing something with a side effect outside your code,
and then it's five confusing minutes.

---

## Part 5 — Modules, in the four commands you need

A module is a directory with a `go.mod` in it. That file is the project.

```
module turtle

go 1.25.6
```

Two facts: the module's import path, and the language version — `1.25.6` is
whatever toolchain wrote it, so yours will differ. There is no dependency
section until you have a dependency.

| Command | Effect |
|---|---|
| `go mod init github.com/you/thing` | create `go.mod` — the name is the import path |
| `go get example.com/pkg@v1.2.3` | add or change a dependency version |
| `go mod tidy` | reconcile `go.mod` with what your code actually imports |
| `go mod why example.com/pkg` | explain which of your packages pulls that in |

Four things that are genuinely different from npm or Maven:

- **The import path is the URL.** `github.com/google/uuid` is both where the
  code lives and how you import it. There is no central registry and no
  package name separate from its location.
- **`go.sum` is a checksum file, not a lockfile.** The versions are pinned in
  `go.mod`; `go.sum` records hashes so a dependency can't change under you.
  Commit both. Never edit either by hand.
- **Minimal version selection.** Go picks the *lowest* version that satisfies
  everyone, not the highest. Builds are reproducible without a resolver
  fighting itself.
- **`go mod tidy` is the truth.** It reads your imports and rewrites `go.mod`
  to match — adding what's missing, deleting what's no longer used. Run it
  after touching imports, and commit the result.

The `// indirect` marker confuses people. It means "nothing in this module
imports this directly (yet)". Watch it resolve itself in the lab.

> **`internal/` is enforced by the compiler.** A package under `internal/`
> cannot be imported from outside its module. It's the one visibility boundary
> in Go that isn't a naming convention, and Capsule 00 sets your repo up with
> it on purpose.

---

## Part 6 — The opinionated bits that feel wrong at first

This is the part that makes people say Go is weird. Every one of these is a
deliberate trade: **the language optimises for the person reading the code in
two years, not for the person typing it today.** Once you believe that, most
of them stop being annoying.

| What surprises you | The rule | Why |
|---|---|---|
| An unused variable **fails the build** | `declared and not used: count` | An unused local is the residue of an unfinished edit. A warning would be ignored; an error gets fixed |
| So does an unused import | `"os" imported and not used` | Same reason, plus imports are compile-time cost and dependency surface |
| Capital letter = public | `Record` is exported, `record` isn't | Visibility is readable at the *call site*, without opening the definition |
| Visibility is per **package**, not per type | another file in the same package sees your unexported fields | The package is the encapsulation unit. There is no `private` and no `protected` |
| No ternary `?:` | write the `if` | One way to express a conditional. Nested ternaries were the cost |
| No `while`, no `do…while` | `for cond { }`, `for { }` | One loop keyword |
| No overloading, no default arguments | `NewX` and `NewXWithTimeout` | The call site names exactly one function |
| No exceptions | `if err != nil { return err }` | Every failure is visible at the point it can happen (B10) |
| Error strings are lowercase, no full stop | `errors.New("connection refused")` | They get wrapped: `record reading: query fighters: connection refused` |
| Getters aren't called `GetX` | `f.Name()`, and `f.SetName()` if you must | The noise word buys nothing |
| Interfaces are named for the verb | `Reader`, `Stringer` — never `IStore` | The `-er` suffix says what it does |
| Receivers are one or two letters | `func (s *Store) Record(…)` | No `this`, no `self`. Short scope, short name |
| Package name is part of the identifier | `http.Server`, not `http.HTTPServer` | You already said `http` |
| Tests sit beside the code | `store.go` / `store_test.go` | No mirror tree to keep in sync |

Four of those are worth more than a table row.

### "Unused variable" is a compile error, and you'll fight it

You comment out one line while debugging and the build breaks because a
variable is now unused. It's infuriating for a day. Two escape hatches:

```go
_ = count                               // "yes, unused, and I meant it"
var _ io.Writer = (*bytes.Buffer)(nil)  // compile-time proof of an interface
```

The second line is worth stealing. It asserts an interface is satisfied at
compile time and costs nothing at runtime — you'll see it at the top of files
all through this course.

Note the asymmetry: **unused *imports* and *locals* are errors; unused struct
fields, unused functions, unused package-level variables are not.** The rule
only covers things that are provably a mistake in the scope you're looking at.

### Short names are not laziness

```go
for i, r := range readings { … }
func (s *Store) Record(r Reading) error { … }
```

The Go convention is that **name length scales with scope**. A variable alive
for three lines is `r`. A package-level export that a hundred files read is
`DefaultTimeout`. Coming from a codebase full of `readingRepositoryInstance`,
this reads as sloppy for a while, then reads as fast.

### `:=` and the shadowing trap

`:=` declares and infers; `var` declares explicitly. Use `:=` inside
functions, `var` at package level or when you want the zero value.

The trap is that `:=` inside a new scope creates a **new** variable:

```go
f, err := load("a")
if err != nil {
	return err
}
if g, err := load("b"); err == nil {   // this err is a DIFFERENT variable
	fmt.Println(f, g)
}
```

That compiles cleanly and `go vet` says nothing about it. The outer `err` is
untouched, and if you'd written something that depended on it, you'd be
debugging for a while. Be deliberate about which scope you're declaring in.

### The zero value is supposed to be usable

```go
var mu sync.Mutex     // ready to Lock()
var buf bytes.Buffer  // ready to Write()
var s []string        // nil, but append works and len(s) == 0
var m map[string]int  // nil — reads work, WRITES PANIC
```

`var s []string` and `var m map[string]int` look symmetric and are not. A nil
slice appends fine. A nil map panics the moment you write to it. **Maps must
be made**: `make(map[string]int)` or a literal. You'll do this wrong once; the
lab makes you do it on purpose so it's once and not twice.

---

## Part 7 — How to read what Go tells you

Three kinds of message, three different reflexes.

### A compile error

```
# turtle
./power.go:5:2: "os" imported and not used
```

`# turtle` is the package. Then `file:line:column`. Go compile errors are
short and literal — they very rarely mean something other than what they say.
**Fix the first one and recompile**; later errors are often knock-on.

### A panic

```
panic: assignment to entry in nil map

goroutine 1 [running]:
main.(*Store).Record(0x1009b9688?, {0x10096808f?, 0x100968fdd?}, 0x2329)
	/Users/you/go-turtle/store.go:13 +0xc8
main.main()
	/Users/you/go-turtle/power.go:15 +0x9c
exit status 2
```

Read it in this order:

1. **The first line is the cause.** `assignment to entry in nil map`.
2. **The first frame under `goroutine 1 [running]:` is where it happened** —
   `store.go:13`.
3. **Frames below it are the callers**, most recent first. `power.go:15` is
   what called `Record`.

The hex numbers are arguments and offsets — ignore them. The `?` suffixes mean
the value may be inaccurate because of optimisation. Ignore those too. You
want two lines out of that block: what, and where.

### An error value

Go errors are built by the callers, so a good one reads like a path:

```
record reading: query fighters: dial tcp 10.0.0.5:5432: connection refused
```

Each layer added *what it was trying to do*, using `%w`:

```go
return fmt.Errorf("query fighters: %w", err)
```

Read it left to right and you have the call stack, in domain language, for
free. When you write one: describe the operation, not the function's own name,
and don't start it with "error" or "failed to" — the reader knows.

---

## Lab — one module, five tools, and every mistake on purpose

Twenty-five minutes. Everything below was run on Go 1.25; the messages are
copied from a real terminal. Exact wording can shift slightly between Go
versions — the shape won't.

### Step 0 — a module

```bash
mkdir -p ~/go-turtle && cd ~/go-turtle
go mod init turtle
```

```
go: creating new go.mod: module turtle
```

### Step 1 — meet the compiler

**`power.go`**

```go
package main

import (
	"fmt"
	"os"
)

type Fighter struct {
	Name  string
	Power int
}

func main() {
	f := Fighter{Name: "goku", Power: 9001}
	fmt.Printf("%s is at %s\n", f.Name, f.Power)
}
```

```bash
go build ./...
```

```
# turtle
./power.go:5:2: "os" imported and not used
```

**Mistake 1, on purpose:** an unused import is a build failure, not a warning.
Delete the `"os"` line and collapse the import back to `import "fmt"`.

### Step 2 — meet `go vet`

Now it compiles. Run it:

```bash
go run .
```

```
goku is at %!s(int=9001)
```

**Mistake 2:** `%s` against an `int`. The program succeeded — exit code 0, no
error, garbage in the output. Now let the tool find it:

```bash
go vet ./...
```

```
# turtle
# [turtle]
./power.go:12:23: fmt.Printf format %s has arg f.Power of wrong type int
```

Change `%s` to `%d` and re-run vet. Silence means clean.

> This is the moment the capsule is about. The compiler was happy. The program
> ran. `go vet` is the only thing between you and that line appearing in a
> production log.

### Step 3 — meet `gofmt`

Write this file deliberately badly.

**`shout.go`**

```go
package main

import "strings"

func Shout( name string ) string {
    if name == "" {
      return "WHO?"
    }
    return strings.ToUpper( name )+"!!!"
}
```

```bash
gofmt -l .
```

```
shout.go
```

```bash
gofmt -d shout.go
```

```
diff shout.go.orig shout.go
--- shout.go.orig
+++ shout.go
@@ -2,9 +2,9 @@
 
 import "strings"
 
-func Shout( name string ) string {
-    if name == "" {
-      return "WHO?"
-    }
-    return strings.ToUpper( name )+"!!!"
+func Shout(name string) string {
+	if name == "" {
+		return "WHO?"
+	}
+	return strings.ToUpper(name) + "!!!"
 }
```

Note what it decided without asking: spaces inside the parens gone, tabs for
indentation, a space around `+`. Now:

```bash
gofmt -w .
gofmt -l .
```

The second command prints nothing. **That's the CI check** — `gofmt -l .` with
empty output means the tree is formatted.

### Step 4 — a bug the compiler and `gofmt` both allow

**`store.go`**

```go
package main

import "sync"

type Store struct {
	mu   sync.Mutex
	data map[string]int
}

// Value receiver: every call copies the Store — including its mutex.
func (s Store) Record(name string, power int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[name] = power
}
```

```bash
go build ./... && echo "compiles fine"
go vet ./...
```

```
compiles fine
# turtle
# [turtle]
./store.go:11:9: Record passes lock by value: turtle.Store contains sync.Mutex
```

**Mistake 3:** a value receiver on a type holding a mutex. Every caller locks
its own private copy, so the mutex protects nothing — and under load you get a
data race with no symptom until it corrupts something. Change the receiver to
`func (s *Store) Record(...)`.

### Step 5 — the nil map panic

Add this to `main`, after the `Printf`:

```go
	s := &Store{}
	s.Record(f.Name, f.Power)
```

```bash
go run .
```

```
goku is at 9001
panic: assignment to entry in nil map

goroutine 1 [running]:
main.(*Store).Record(0x1009b9688?, {0x10096808f?, 0x100968fdd?}, 0x2329)
	/Users/you/go-turtle/store.go:13 +0xc8
main.main()
	/Users/you/go-turtle/power.go:15 +0x9c
exit status 2
```

**Mistake 4:** `Store{}` gives you a usable zero-valued mutex and a **nil**
map. Practise reading the trace: cause on line 1, `store.go:13` is where,
`power.go:15` is who called it.

The fix is the constructor convention — a `New*` function that returns a
ready-to-use value:

```go
// NewStore returns a Store that is ready to use. The map must be made;
// the zero value of a map is nil, and writing to a nil map panics.
func NewStore() *Store {
	return &Store{data: make(map[string]int)}
}

func (s *Store) Power(name string) (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.data[name]
	return p, ok
}
```

Now make `main` use it:

```go
func main() {
	f := Fighter{Name: "goku", Power: 9001}
	fmt.Printf("%s is at %d\n", f.Name, f.Power)

	s := NewStore()
	s.Record(f.Name, f.Power)
	if p, ok := s.Power("vegeta"); !ok {
		fmt.Println("no reading for vegeta; zero value is", p)
	}
	fmt.Println(Shout(f.Name))
}
```

```bash
go run .
```

```
goku is at 9001
no reading for vegeta; zero value is 0
GOKU!!!
```

That `(int, bool)` return is the standard Go shape for a lookup — the second
value tells you whether it was found, because the first one can't: a missing
key returns the zero value, and `0` is a perfectly valid power level.

### Step 6 — tests

**`shout_test.go`**

```go
package main

import "testing"

func TestShout(t *testing.T) {
	cases := []struct {
		name string // the subtest's name, not an input
		in   string
		want string
	}{
		{"normal", "goku", "GOKU!!!"},
		{"already upper", "VEGETA", "VEGETA!!!"},
		{"empty", "", "WHO?"},
		{"spaces kept", "master roshi", "MASTER ROSHI!!!"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Shout(c.in)
			if got != c.want {
				t.Errorf("Shout(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestStoreRecord(t *testing.T) {
	s := NewStore()
	s.Record("goku", 9001)

	got, ok := s.Power("goku")
	if !ok {
		t.Fatalf("Power(%q): not found after Record", "goku")
	}
	if got != 9001 {
		t.Errorf("Power(%q) = %d, want 9001", "goku", got)
	}
}
```

```bash
go test ./...
```

```
ok  	turtle	0.193s
```

Go's test output is quiet when it passes. See the detail with `-v`:

```bash
go test -v -run TestShout ./...
```

```
=== RUN   TestShout
=== RUN   TestShout/normal
=== RUN   TestShout/already_upper
=== RUN   TestShout/empty
=== RUN   TestShout/spaces_kept
--- PASS: TestShout (0.00s)
    --- PASS: TestShout/normal (0.00s)
    --- PASS: TestShout/already_upper (0.00s)
    --- PASS: TestShout/empty (0.00s)
    --- PASS: TestShout/spaces_kept (0.00s)
PASS
ok  	turtle	0.197s
```

Note `already_upper` — spaces in a subtest name become underscores, which is
what you type in `-run`.

### Step 7 — watch a test fail properly

In `shout.go`, change `"!!!"` to `"!"`, then:

```bash
go test ./...
```

```
--- FAIL: TestShout (0.00s)
    --- FAIL: TestShout/normal (0.00s)
        shout_test.go:21: Shout("goku") = "GOKU!", want "GOKU!!!"
    --- FAIL: TestShout/already_upper (0.00s)
        shout_test.go:21: Shout("VEGETA") = "VEGETA!", want "VEGETA!!!"
    --- FAIL: TestShout/spaces_kept (0.00s)
        shout_test.go:21: Shout("master roshi") = "MASTER ROSHI!", want "MASTER ROSHI!!!"
FAIL
FAIL	turtle	0.192s
FAIL
```

Three of the four cases failed and the fourth didn't — `empty` returns early
and never reaches the changed line. **That is the argument for table-driven
tests in one screen:** the output localises the bug to the cases that touch
it. Put the `!!!` back.

### Step 8 — `go test` runs vet for you

In the test, delete `want %q` from the format string but leave `c.want` as an
argument, then:

```bash
go test ./...
```

```
# turtle
# [turtle]
./shout_test.go:21:5: (*testing.common).Errorf call needs 2 args but has 3 args
FAIL	turtle [build failed]
FAIL
```

The tests didn't run at all — vet ran first and refused. Put it back.

Then see coverage:

```bash
go test -coverprofile=cover.out ./... && go tool cover -func=cover.out
```

```
turtle/power.go:10:	main		0.0%
turtle/shout.go:5:	Shout		100.0%
turtle/store.go:12:	NewStore	100.0%
turtle/store.go:16:	Record		100.0%
turtle/store.go:22:	Power		100.0%
total:			(statements)	61.1%
```

`go tool cover -html=cover.out` opens the same thing with the uncovered lines
highlighted in a browser, which is the version you'll actually use.

### Step 9 — a dependency, and what `tidy` is for

Needs network.

```bash
go get github.com/google/uuid@v1.6.0
cat go.mod
```

```
go: added github.com/google/uuid v1.6.0
```

```
module turtle

go 1.25.6

require github.com/google/uuid v1.6.0 // indirect
```

**`// indirect` because nothing imports it yet.** Now import it — add
`"github.com/google/uuid"` to `power.go`'s import block and use
`uuid.NewString()` somewhere — then:

```bash
go mod tidy && cat go.mod
```

The `// indirect` marker is gone. Now delete the import and the usage again:

```bash
go mod tidy && cat go.mod
```

```
module turtle

go 1.25.6
```

The dependency is gone entirely. **`go mod tidy` makes `go.mod` describe
reality**, in both directions — that's the whole job, and it's why you run it
after every import change rather than editing `go.mod` by hand.

### Step 10 — the two commands, together

```bash
go vet ./... && go test ./...
```

That's the pair. Make it muscle memory before you write your first real Go
service in [Capsule 01](../../01-scouter-first-service/README.md).

---

## Bring it to work

- **A formatter with no options ends a recurring argument.** You can have this
  in most languages now — `prettier`, `black`, `rustfmt`. The lesson is to pick
  one and remove the config file, not to tune it.
- **Static analysis that only reports near-certain bugs gets run.** `go vet`'s
  restraint is why nobody suppresses it. A linter with a 30% false-positive
  rate teaches the team to ignore lint output entirely.
- **Errors that read like a path** (`record reading: query fighters: connection
  refused`) are a habit, not a language feature. Build the same chain wherever
  you work — it removes most of the need to reproduce a bug to locate it.
- **A build that fails on unused variables** catches half-finished refactors.
  Worth wanting anywhere you can turn it on.

---

## Battle drill

<details>
<summary><b>1.</b> <code>go run main.go</code> says <code>undefined: NewStore</code>, but <code>NewStore</code> is right there in <code>store.go</code>. What's wrong?</summary>

You named a file, so Go compiled *only that file* — `store.go` was never part
of the build. Naming files makes them the entire package.

`go run .` compiles the package in the current directory, which is what you
meant. The same applies to `go build` and `go test`: the target is a package,
not a file.
</details>

<details>
<summary><b>2.</b> Your handler prints <code>%!d(string=goku)</code> into the logs. Which tool would have caught it, and why didn't the compiler?</summary>

`go vet`, via the `printf` analyser. The compiler can't: `fmt.Printf` takes
`...any`, so passing a string where the format says `%d` is a perfectly valid
call. The mismatch is between a *string literal* and the argument types, which
is exactly the kind of thing an analyser exists for.

`go test` would have caught it too — `printf` is in the high-confidence subset
vet runs during `go test` — but only if that code path is in a package with
tests being built.
</details>

<details>
<summary><b>3.</b> <code>var s []string</code> and <code>var m map[string]int</code> are both nil. Why does <code>append(s, "x")</code> work while <code>m["x"] = 1</code> panics?</summary>

`append` is a builtin that *returns a new slice* — given a nil slice it
allocates a backing array and hands it back, which is why you must reassign
(`s = append(s, "x")`). Nothing was mutated in place.

A map assignment mutates the map in place, and there is no map to mutate — a
nil map has no hash table behind it. Reads are defined (they return the zero
value and `ok == false`), writes panic. Maps must be created with `make` or a
literal; the `New*` constructor convention exists largely for this.
</details>

<details>
<summary><b>4.</b> You add a <code>json:"fighter"</code> tag, deploy, and the field still appears as <code>Fighter</code> in the response. What are the two likely causes?</summary>

Either the tag is malformed — `json: "fighter"` with a space is the classic,
and it's silently ignored because it no longer parses as a struct tag — or the
field is unexported, so `encoding/json` can't see it at all.

`go vet`'s `structtag` analyser catches the first. Nothing catches the second
but reading it: `fighter string` marshals to nothing, `Fighter string` marshals
as `"Fighter"`.
</details>

<details>
<summary><b>5.</b> You changed a config file your test reads, re-ran <code>go test ./...</code>, and got the identical passing output instantly. What happened?</summary>

Test result caching. Go caches a successful package test result keyed on the
test binary and the files it *observed through the `os` package* — a config
read some other way, or state in a database or container, isn't part of the
key. The run was skipped and you saw `(cached)`.

`go test -count=1 ./...` forces a real run. It's the standard incantation any
time a test depends on something outside the module.
</details>

---

## The cheatsheet

Everything below is reference. Skim it now, come back to it later.

### Commands

| Command | Does |
|---|---|
| `go version` | toolchain version |
| `go env` / `go env GOMODCACHE` | toolchain settings; add a name for one value |
| `go mod init <import-path>` | start a module |
| `go mod tidy` | sync `go.mod` with your imports — run after every import change |
| `go mod why <pkg>` | why is this dependency here? |
| `go get <pkg>@<version>` | add or upgrade a dependency (`@latest`, `@v1.2.3`) |
| `go run .` | build + run the package here |
| `go build ./...` | compile everything, no output binary |
| `go build -o bin/app ./cmd/app` | compile to a named binary |
| `go install ./cmd/app` | compile into `$(go env GOBIN)` |
| `go test ./...` | run all tests |
| `go vet ./...` | static analysis |
| `gofmt -l .` / `gofmt -w .` | list unformatted / rewrite in place |
| `go doc <pkg> [Symbol]` | docs in the terminal |
| `go tool cover -html=cover.out` | coverage, highlighted, in a browser |
| `go clean -modcache` | nuclear option when the module cache is broken |

### Test flags

| Flag | Does |
|---|---|
| `-v` | verbose: every test and subtest |
| `-run 'TestX/sub'` | filter by regex; `/` separates subtests |
| `-race` | race detector — use it on anything concurrent |
| `-count=1` | bypass the test cache |
| `-cover` / `-coverprofile=f` | coverage percentage / profile file |
| `-failfast` | stop after the first failure |
| `-timeout 30s` | fail a hung test instead of waiting 10 minutes |
| `-short` | your tests can check `testing.Short()` and skip slow ones |

### Declaring things

```go
x := 5                     // declare + infer. Only inside a function
var x int                  // declare, zero value (0)
var x int = 5              // explicit
const Limit = 100          // compile-time constant
var ErrNotFound = errors.New("not found")   // package-level sentinel

func f(a, b int) (int, error)    // two params of the same type, two returns
func f(vals ...int)              // variadic; inside, vals is []int
f(nums...)                       // spread a slice into a variadic call

type Reading struct {
	Fighter string `json:"fighter"`   // exported + tag
	power   int                       // unexported: invisible to encoding/json
}

type Recorder interface{ Record(Reading) error }   // implicit satisfaction

func (s *Store) Method()    // pointer receiver: can mutate, no copy
func (r Reading) Method()   // value receiver: works on a copy
```

### Zero values

| Type | Zero | Usable? |
|---|---|---|
| `int`, `float64` | `0` | yes |
| `string` | `""` | yes — there is no nil string |
| `bool` | `false` | yes |
| pointer, interface, func, chan | `nil` | dereferencing panics |
| slice | `nil` | **yes** — `append`, `len`, `range` all work |
| map | `nil` | **reads yes, writes panic.** `make` it |
| `sync.Mutex`, `bytes.Buffer`, `strings.Builder` | usable | yes, by design |

### Slices, maps, strings

```go
s := []int{1, 2, 3}
s = append(s, 4)          // append RETURNS — you must reassign
s = append(s, other...)   // append another slice
view := s[1:3]            // a VIEW sharing the backing array, not a copy
c := make([]int, len(s))  // when you need independence:
copy(c, s)
make([]int, 0, 100)       // len 0, capacity 100 — preallocate when you know

m := map[string]int{"goku": 9001}
v, ok := m["vegeta"]      // v == 0, ok == false. Always use the two-value form
delete(m, "goku")
len(m)                    // maps are NOT safe for concurrent writes

strings.Contains(text, "x"); strings.HasPrefix(text, "x")
strings.Split(text, ","); strings.Join(parts, ","); strings.TrimSpace(text)
strconv.Itoa(9001); strconv.Atoi("9001")   // int <-> string. NOT string(9001)
fmt.Sprintf("%s is %d", name, power)       // build a string
```

`string(9001)` compiles and gives you the character U+2329, not `"9001"`. The
`stringintconv` vet check exists for exactly this.

### Format verbs you'll use

| Verb | For |
|---|---|
| `%s` | strings, and anything with a `String()` method |
| `%d` | integers |
| `%q` | a quoted string — use it in test failures to see whitespace |
| `%v` | anything, default format |
| `%+v` | structs with field names — the debugging one |
| `%T` | the type, when you're not sure what you have |
| `%w` | **only** in `fmt.Errorf` — wraps an error into the chain |
| `%%` | a literal percent |

### Errors

```go
if err != nil {
	return fmt.Errorf("query fighters: %w", err)   // %w wraps; adds context
}

var ErrNotFound = errors.New("not found")          // sentinel
if errors.Is(err, ErrNotFound) { … }               // is it THAT error?

var pathErr *fs.PathError
if errors.As(err, &pathErr) { … }                  // pull a typed error out

defer f.Close()                                    // runs on every return path
```

Rules: lowercase, no trailing punctuation, describe the operation not the
function. Never `log` *and* `return` the same error — pick one, or you'll read
it three times in the logs.

### Tests

```go
func TestThing(t *testing.T) {
	t.Parallel()                      // opt in; safe only if the test shares nothing

	got := Thing()
	if got != want {
		t.Errorf("Thing() = %v, want %v", got, want)   // record, keep going
	}
	if err != nil {
		t.Fatalf("setup: %v", err)                     // stop this test now
	}

	t.Cleanup(func() { … })           // teardown, runs even on failure
	t.Helper()                        // inside a helper: report the CALLER's line
	t.Skip("needs docker")            // skip with a reason
}

func BenchmarkThing(b *testing.B) {
	for b.Loop() { Thing() }          // Go 1.24+; older: for i := 0; i < b.N; i++
}
```

### Naming

| Thing | Convention | Not |
|---|---|---|
| Package | short, lowercase, one word: `scouter`, `store` | `utils`, `common`, `helpers`, `my_pkg` |
| Exported | `Record`, `DefaultTimeout` | `record` (that's package-private) |
| Interface | `Reader`, `Recorder` — `-er` for one method | `IStore`, `StoreInterface` |
| Receiver | `s`, `srv` — same letter on every method of the type | `this`, `self` |
| Getter | `f.Name()` | `f.GetName()` |
| Error var | `ErrNotFound` | `NotFoundError` (that's for error *types*) |
| Test | `TestRecord_EmptyName` | `test_record`, `TestRecordEmptyName2` |
| Files | `store.go`, `store_test.go` | `StoreImpl.go` |

### Stdlib you'll type this month

| Want to | Package |
|---|---|
| print / format strings | `fmt` |
| slice, split, join, trim text | `strings` |
| numbers to and from strings | `strconv` |
| errors, wrapping, `Is`/`As` | `errors` |
| HTTP server or client | `net/http` |
| JSON | `encoding/json` |
| deadlines, cancellation | `context` |
| mutexes, `WaitGroup`, `Once` | `sync` |
| structured logs | `log/slog` |
| durations, timers | `time` |
| SQL | `database/sql` (plus a driver) |
| sorting | `sort`, or `slices.Sort` |
| tests | `testing` |

### Gotchas, one line each

| Gotcha | Remember |
|---|---|
| `go run main.go` misses your other files | `go run .` |
| unused import / variable | compile error, not a warning |
| a lowercase struct field vanishes from JSON | exported means capitalised |
| writing to a nil map panics | `make(map[K]V)`, or a `New*` constructor |
| `append` seems not to work | it returns a new slice — reassign it |
| a slice of a slice shares memory | `make` + `copy` when you need independence |
| `string(65)` gives `"A"` | use `strconv.Itoa` |
| a value receiver on a type with a mutex | `go vet` catches it; use a pointer receiver |
| `err` silently shadowed inside an `if` | `:=` in a new scope declares a new variable |
| test passes instantly and identically | it was cached — `-count=1` |
| test never runs | wrong file name, wrong signature, lowercase name |
| `%w` outside `fmt.Errorf` | it only means "wrap" there |
| `defer` argument looks stale | arguments evaluate at `defer` time, the call runs later |

---

## Senzu

| Symptom | Fix |
|---|---|
| `"os" imported and not used` | Delete the import. Set your editor up with `gopls` so it does this on save. |
| `declared and not used: count` | Delete the variable, or `_ = count` if you're mid-debug. |
| `undefined: NewStore` when the function exists | You ran `go run main.go`. Use `go run .`. |
| `go: cannot find main module` | You're outside a module. `go mod init <name>`, or `cd` to the right directory. |
| `missing go.sum entry` | `go mod tidy`. |
| `%!s(int=9001)` in your output | Wrong verb for the type. `go vet ./...` names the line. |
| `panic: assignment to entry in nil map` | The map was never `make`d. Add a `New*` constructor. |
| `Record passes lock by value` | Value receiver on a type containing a `sync.Mutex`. Make it a pointer receiver. |
| `cancel function … should be called, not discarded` | `defer cancel()` right after `context.WithTimeout`. |
| `call needs 2 args but has 3 args` from `go test` | `go test` runs vet first. Your `t.Errorf` format string doesn't match its arguments. |
| Tests print `(cached)` and you needed a real run | `go test -count=1 ./...`. |
| `go test` says `no test files` | The file must end in `_test.go` and the function must be `TestXxx(t *testing.T)`. |
| Your Go is 1.19 and something won't compile | The course assumes 1.22+. `./bin/doctor` flags it; Capsule 00 fixes it. |

---

## Log it

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done B11
```

**Next:** [B10 · Instant Kamehameha](../B10-instant-kamehameha-go-for-java/README.md)
for the language itself — interfaces, errors as values, embedding — and then
[Capsule 01 · Scouter — Your First Service](../../01-scouter-first-service/README.md),
where you write the real thing.
