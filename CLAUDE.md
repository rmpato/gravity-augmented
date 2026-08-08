# CLAUDE.md

Context for an agent session on this repo. Human-facing docs are elsewhere —
see the pointers below rather than re-deriving anything.

## What this is

**Gravity Augmented** — a course teaching GCP and system design at scale, as 27
main capsules + 10 bonus, in English and Argentine Spanish. `README.md` is
written for *learners*; `MAINTAINERS.md` is for us. Don't confuse the two when
editing.

**A real learner is working through `main` right now.** That is the constraint
behind every rule below.

## Three repos

| Path | What |
|---|---|
| `~/repos/pato/gravity-augmented` | this one — the course |
| `~/repos/pato/gravity-chamber-reference` | answer key; a `capsule-NN` tag per capsule. `git diff capsule-13 capsule-14` shows exactly what a capsule asks for. All tags build and test clean |
| `~/repos/pato/capsule-corp-blueprints` | the course *system* with no content, extracted from here. Improvements do NOT auto-flow either way — port by hand, and only when a course actually hits the issue |

The learner builds a fourth repo, `gravity-chamber`, themselves in Capsule 00.

## Rules

- **Never push to `main`.** PRs only; Pato reviews and merges.
- **Run `python3 scripts/maintainers/validate.py` before proposing any change.**
  It gates MANIFEST/disk agreement, power arithmetic (main arc must total
  exactly 9000), EN/ES parity, prose leaking into code blocks, dead links, and
  the surfaces every capsule must appear in. Exits non-zero.
- **A lab that hasn't been run is not finished.** Nearly every real defect found
  in this course was invisible to reading and appeared only on execution. This
  is the rule that matters most; see `docs/maintainers/build-log.md` for 29
  worked examples, including two diagnoses that were wrong.
- **Never rig a demo.** If an effect doesn't reproduce, say so and teach why.
  Capsule 07 is the case study.
- **Edit EN and ES together.** Code blocks must be byte-identical across
  languages — only prose is translated. `validate.py` checks fence counts.
- **Capsule IDs are the compatibility surface.** They're stored in the learner's
  gitignored `.scouter/progress`, so renumbering silently corrupts their state
  and is a MAJOR. Prefer adding a bonus capsule.

## Read these before substantial work

| File | For |
|---|---|
| `MAINTAINERS.md` | workflow, versioning, capsule backlog, known gaps |
| `docs/maintainers/runbooks.md` | add a capsule, cut a release, fix a live course, renumber |
| `docs/maintainers/build-log.md` | what has already gone wrong, and why it was invisible |

## Environment traps

- **System Go is 1.19; capsules assume 1.22+.** `./bin/doctor` correctly flags
  this. To build reference code you need a newer toolchain — don't "fix" the
  capsules to match the old one.
- **A pipe inside a table cell must be `\|`**, including inside a code span.
  GitHub silently truncates the row otherwise. `validate.py` check 9 catches it.
- **`.scouter/progress` is the learner's state**, gitignored. `bin/serve` logs
  every write to the console; it should never change on its own.
- Tooling is stdlib-only and runs on macOS's stock Python 3.9 — no pip, no npm,
  no build step. Keep it that way.

## Commands

```bash
./bin/doctor                              # environment check
./bin/scouter status                      # progress; `list`, `next`, `review`
./bin/serve                               # reader on :8420
python3 scripts/maintainers/validate.py   # the gate
```

## State

27 + 10 capsules, both languages. 23 of 27 exercised against real containers;
04 and 26 are design capsules with no stack, B3/B5 are pure Go where the tests
are the lab. The reference's tags were rebuilt so every one builds.

**The one thing still unverified: whether the teaching works.** Nobody has read
these explanations without already knowing the answers. Bugs findable by
execution have been found; the ones that make a learner quit — an unstated
assumption, a step that loses them — are invisible from the inside.
