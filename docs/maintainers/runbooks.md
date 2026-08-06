# Runbooks

**For maintainers, not learners.** See [`../../MAINTAINERS.md`](../../MAINTAINERS.md).

Step-by-step procedures for the things we do repeatedly. Each one ends with the
same command, so it's worth putting first:

```bash
python3 scripts/maintainers/validate.py
```

It checks MANIFEST/disk agreement, power arithmetic, EN/ES parity, prose leaking
into code blocks, broken internal links, the four surfaces that must list every
capsule, and `bin/scouter`'s hardcoded ranges. It exits non-zero, so it can gate
a PR. Every check exists because something actually broke —
[`build-log.md`](build-log.md) is the evidence.

---

## Contents

- [Runbook 1 — add a bonus capsule](#runbook-1--add-a-bonus-capsule)
- [Runbook 2 — add a main-arc capsule](#runbook-2--add-a-main-arc-capsule) *(rare, and expensive)*
- [Runbook 3 — fix a capsule someone is mid-course on](#runbook-3--fix-a-capsule-someone-is-mid-course-on) *(urgent path)*
- [Runbook 4 — cut a release](#runbook-4--cut-a-release)
- [Runbook 5 — renumber or remove a capsule](#runbook-5--renumber-or-remove-a-capsule) *(MAJOR — avoid)*
- [Runbook 6 — update the reference repo](#runbook-6--update-the-reference-repo)
- [Reference — what a capsule touches](#reference--what-a-capsule-touches)

---

## Runbook 1 — add a bonus capsule

The common case. Bonus capsules are additive: they don't move anyone's progress,
so this is a **MINOR** release.

Worked example: adding `B11`.

### 1. Pick the id and the slug

```
capsules/bonus/B11-<kebab-slug>/README.md
```

The id is everything before the first `-`. `bin/scouter`'s `normalize_id`
accepts `b11`, `B11`, or `B11-anything`, so the slug is free — but it becomes
the URL and the directory forever, so choose it once. Slugs are lowercase and
hyphenated.

### 2. Write the English capsule

Match the existing shape: header table (power level, time, prereqs, best taken
before), *Why this capsule exists*, *The lore*, teaching sections, a **Lab**,
*Bring it to work*, *Battle drill* (`<details>`/`<summary>`), *Senzu*
(symptom/fix table), *Log it*.

**The merge bar applies.** Every snippet compiles, every calculation is
executed, and any lab that can be run locally **is** run.

Time estimate: `words / 55 + 15` minutes, rounded to 5. That formula produced
the current numbers; keep it so estimates stay comparable.

### 3. Register it in the MANIFEST

```
capsules/MANIFEST      B11<TAB>6<TAB>150<TAB>Title — Subtitle
capsules/MANIFEST.es   B11<TAB>Título traducido
```

**Tab-separated, not spaces.** Four columns in `MANIFEST` (`id`, `saga`,
`points`, `title`), two in `MANIFEST.es` (`id`, `title`). Bonus capsules are
saga `6` and worth `150`. Keep rows in id order — `bin/scouter list` and the
reader both render in file order.

> **Do not give a bonus capsule main-arc points.** The main arc must total
> exactly **9000**; `validate.py` enforces it. Bonus points are what take you
> *over* 9000, which is the entire joke.

### 4. Translate it

Prose is translated; **code blocks must be byte-identical to English**, because
the English blocks are the ones that were verified to compile.

The reliable way is to write the Spanish prose with a `@@CODE@@` marker on its
own line wherever a fenced block belongs, then splice the English blocks in by
position. `validate.py` checks fence counts match, which catches a dropped or
doubled block.

Keep technical vocabulary in English (`cache`, `deploy`, `throughput`,
`load balancer`) — that's the house style, and it's what the reader will meet at
work.

### 5. Add it to the four surfaces

| File | What |
|---|---|
| `README.md` | bonus table row |
| `es/README.md` | bonus table row |
| `docs/saga-map.md` | one-line summary row |
| `es/docs/saga-map.md` | one-line summary row |

`validate.py` fails if any of these disagree with the MANIFEST.

### 6. Update `bin/scouter`'s hardcoded ranges

Two strings hardcode the top bonus id:

```bash
grep -n "Filler Arc B1-\|b1 … B" bin/scouter
```

Both must name the new highest id. `validate.py` checks this — it's exactly the
kind of thing that rots silently.

### 7. Wire the prev/next links

Capsules link to their neighbours at the bottom. If B11 slots into a reading
order, update the adjacent capsules' **Next:** lines in both languages.

### 8. Validate, then PR

```bash
python3 scripts/maintainers/validate.py
./bin/serve --no-open &          # confirm it renders and the ES toggle works
NO_COLOR=1 ./bin/scouter list    # confirm it appears, and alignment holds
./bin/scouter open B11           # confirm id resolution works
```

Branch `capsule/b11-<slug>`, and note in the PR that this is a **MINOR**.

---

## Runbook 2 — add a main-arc capsule

**Think hard first.** A main-arc capsule between existing ones is a **MAJOR**,
because inserting `14` renumbers everything after it — see
[Runbook 5](#runbook-5--renumber-or-remove-a-capsule).

Appending at the end (a new `27`) is a **MINOR** and is the only cheap option.

Either way, one extra constraint dominates:

> **The main arc must total exactly 9000 power.** Adding a capsule means
> redistributing points across all of them so the total is unchanged. That is a
> content-wide edit and `validate.py` will fail until it balances.

Current distribution: capsule `00` is worth `0` (setup), the body capsules are
`340` each, and the capstone `26` is `500`.

If you're adding real content, **prefer a bonus capsule.** The main arc is a
spine — one service, grown until it's a system. Ask whether the new material
grows the spine or sits beside it. Beside it means bonus.

---

## Runbook 3 — fix a capsule someone is mid-course on

The urgent path. Someone is stuck right now.

1. **Reproduce it.** Ask which capsule and step, and what they saw. Most reports
   are a step that assumed something it never said.
2. **Check the reference first** — `git diff capsule-NN` may show the answer
   immediately, and every tag from `capsule-01` on builds and tests clean.
3. **Branch `fix/capsule-NN-<what>`.** Fix English and Spanish together. The
   code blocks are shared, so a code fix is one edit applied to both files.
4. **Run the lab.** This is the step that keeps finding the real bug, and the
   step that is always tempting to skip.
5. **Record it** in [`build-log.md`](build-log.md) — what broke, why it was
   invisible, and how it was verified. If you were wrong about a diagnosis
   along the way, keep that too.
6. `python3 scripts/maintainers/validate.py`, then PR.

This is a **PATCH**. Tell the learner they can just `git pull` — capsule ids
didn't move, so their `.scouter/progress` is untouched.

---

## Runbook 4 — cut a release

Versions are defined in [`MAINTAINERS.md`](../../MAINTAINERS.md#versioning).
Short form: **MAJOR** = capsule ids moved, **MINOR** = new content,
**PATCH** = corrections.

```bash
git checkout main && git pull

python3 scripts/maintainers/validate.py     # must pass

./bin/serve --no-open &                     # reader still renders
NO_COLOR=1 ./bin/scouter status             # power maths still 9000
NO_COLOR=1 ./bin/doctor                     # still runs

git tag -a vX.Y.Z -m "<one line: what changed>"
git push origin vX.Y.Z
```

Then pin the reference to match — see [Runbook 6](#runbook-6--update-the-reference-repo).

**On a MAJOR**, additionally: say in the tag message that `.scouter/progress`
will be wrong for anyone mid-course, and what they should do about it.

---

## Runbook 5 — renumber or remove a capsule

**Avoid this.** It's the one operation that reaches into a learner's own machine.

### What breaks

- **`.scouter/progress`** stores ids. Renumber `14` and a learner's file now
  claims they finished a lesson they didn't. There is no migration — the file is
  gitignored and lives only on their machine.
- Every `./bin/scouter done 14` in their shell history now means something else.
- Saved links, bookmarks, and anything they wrote in `NOTES.md`.
- The reference repo's `capsule-NN` tags no longer align with the course.

### If you must

1. Renumber directories, both languages.
2. Rewrite MANIFEST and MANIFEST.es.
3. Redistribute points so the main arc still totals 9000.
4. Update all four surfaces, every prev/next link, and **every cross-reference
   in prose** — capsules refer to each other by number constantly:
   ```bash
   grep -rohE "Capsule [0-9]{2}|Cápsula [0-9]{2}" capsules/ es/ | wc -l
   ```
   That returns **811**. Capsules cite each other constantly — it is how the
   course stays connected — and renumbering means auditing every one of them.
   This is the step that gets missed, and the reason Runbook 5 says *avoid*.
5. Re-tag the reference repo to match.
6. `validate.py`, full reader pass, then a **MAJOR** release whose notes tell
   people to run `./bin/scouter reset --all` or hand-edit `.scouter/progress`.

---

## Runbook 6 — update the reference repo

The reference (`gravity-chamber-reference`) is the answer key. Its value is
per-capsule diffing, so a tag that doesn't match the corrected capsule text is
worse than no tag.

### When a capsule's code changes

Fix `main` there, and decide whether the **tags** need it too. They do if the
change is a correctness fix a learner would diff against.

Tags are immutable snapshots, so backfilling means rewriting history. The method
that worked:

```bash
# an idempotent, PATTERN-BASED tree filter: it only matches the buggy state,
# so commits predating the bug are untouched and fixed ones are no-ops
git filter-branch -f --tree-filter "python3 /path/to/fixtree.py" \
    --tag-name-filter cat -- --all
```

Then verify **every** tag builds before pushing:

```bash
for t in $(git tag | sort -V); do
  git worktree add -f /tmp/tt "$t" >/dev/null 2>&1
  (cd /tmp/tt && go build ./... >/dev/null 2>&1 && go test ./... >/dev/null 2>&1 \
     && echo "$t PASS" || echo "$t FAIL")
  git worktree remove --force /tmp/tt
done
```

`capsule-00` legitimately fails — it's the repo scaffold, no Go code yet.

> **Trap, learned the hard way:** a backup branch created *before*
> `filter-branch -- --all` is itself rewritten by it, so it is not a backup. Take
> the backup afterwards from `origin/main`, which still holds the real
> pre-rewrite history, and push with
> `--force-with-lease=main:<exact-remote-sha>`.

Confirm `main`'s tree is unchanged by the rewrite, then verify from a **fresh
clone** rather than local state.

---

## Reference — what a capsule touches

Everything a new or renamed capsule affects, and what enforces it.

| Surface | File(s) | Breaks if wrong | Checked by |
|---|---|---|---|
| Capsule content | `capsules/<id>-<slug>/README.md` | — | merge bar |
| Translation | `es/capsules/<id>-<slug>/README.md` | ES toggle 404s | `validate.py` |
| Registry | `capsules/MANIFEST` (4 cols, tabs) | invisible to CLI **and** reader | `validate.py` |
| Registry (ES) | `capsules/MANIFEST.es` (2 cols, tabs) | ES title falls back to English | `validate.py` |
| Power total | MANIFEST `points` column | main arc ≠ 9000 breaks the premise | `validate.py` |
| Front door | `README.md`, `es/README.md` | not discoverable | `validate.py` |
| Map | `docs/saga-map.md`, `es/docs/saga-map.md` | not discoverable | `validate.py` |
| CLI ranges | `bin/scouter` (2 hardcoded strings) | `scouter open B11` says "does not exist" | `validate.py` |
| Reading order | prev/next links in neighbours | dead end mid-course | manual |
| Cross-references | prose in other capsules | wrong capsule cited | manual |
| Progress state | learner's `.scouter/progress` | **silently wrong** if ids move | nothing — this is why MAJOR exists |

### Things that need no change

- **`bin/serve`** re-reads the MANIFEST on every `/api/state` request. Verified:
  appending a row while the server is running makes the capsule appear on
  refresh. No code change, no restart.
- **`web/`** is data-driven from `/api/state`. Sagas, counts and the sidebar all
  follow the MANIFEST.
- **Saga definitions** (`SAGA_NAMES`, `MAIN_SAGAS`) only change if you add a
  *saga*, which would be a much larger decision than adding a capsule.
