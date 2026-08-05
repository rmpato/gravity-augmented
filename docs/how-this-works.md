# How to actually study this

Short. Read once.

## The loop

Every capsule is the same six moves:

```
  read the concept  →  do the lab  →  break it on purpose  →
  pass the checkpoint  →  commit in gravity-chamber  →  scouter done NN
```

Roughly 15 minutes of reading, 30 of hands-on, 5 of writing it down. If you're
past 90 minutes, stop — see "when you're stuck" below.

## Anatomy of a capsule

| Section | What to do with it |
|---|---|
| **Header table** | Power level (difficulty), time, prereqs, and whether it's local or has a cloud option |
| **Why this capsule exists** | The real production problem. If you remember nothing else, remember this |
| **The concept** | The actual teaching. Read properly, don't skim |
| **In GCP** | Which Google service does this, what it costs, what its limits are |
| **Lab** | Numbered steps, in *your* `gravity-chamber` repo |
| **Checkpoint** | Commands with expected output. Passing this is what "done" means |
| **Bring it to work** | The transferable practice |
| **Battle drill** | Interview questions. Answer out loud *before* opening the answer |
| **Senzu** | Troubleshooting for when the lab breaks |

## Three rules that decide whether this sticks

**1. Type the code. Don't paste it.**
The muscle memory of writing a handler, a Dockerfile, a query, is a large part
of what you're actually buying here. Pasting produces the feeling of learning
without the substance.

**2. Answer the Battle Drill out loud before reading the answer.**
Retrieval, not recognition. If you can't say it, you don't have it — and the
gap you find is exactly the paragraph worth rereading. This is also literally
the skill a system design interview tests.

**3. Do the "break it" step.**
Several capsules end by telling you to kill a container mid-request, or fire 10×
traffic, or unplug the cache. That failure is not a bonus; it is the lesson.
Knowing *how* a thing fails is what separates people who have run systems from
people who have read about them.

## Pacing

- **One capsule per sitting.** They're designed to fit one.
- **Two or three a week** finishes the arc in about two months and gives ideas
  time to settle. Cramming six in a weekend produces a good feeling and very
  little retention.
- **Never skip forward.** Capsule 14 deliberately breaks what you built in 13.
  Capsule 21 splits what you built in 09–20. Out of order, the lessons lose
  their teeth.
- **Re-reading is cheap.** `./bin/scouter open 11` any time.

## Spaced repetition, minimum viable version

At the start of each session, before opening the new capsule, answer one Battle
Drill question from a capsule you finished **two or more capsules ago**. Sixty
seconds. This one habit is worth more than any note-taking app.

## Keep a log

In your `gravity-chamber` repo, keep `NOTES.md`. After each capsule, three lines:

```markdown
## Capsule 13 — Senzu Bean
- Cache-aside is the default; write-through only when reads must never be stale.
- Surprised me: a 90% hit rate can still leave the DB at 100% load if the 10%
  are the expensive queries. Hit *ratio* is not the same as load reduction.
- Open question: how do I invalidate a leaderboard that changes constantly?
```

The "surprised me" line is the valuable one. Surprise marks the exact place your
mental model was wrong, which is the only place learning happens.

## When you're stuck

1. Read the **Senzu** section of the capsule.
2. Read the actual error message. Out loud. All of it.
3. Reduce it: is it the code, the container, the network, or the config? Test
   each one separately.
4. Give it **20 focused minutes**.
5. Then: write the question in `gravity-chamber/NOTES.md` as precisely as you
   can — what you expected, what happened, what you already ruled out — and move
   on to the next capsule. Come back to it later.

Being able to write the question precisely is most of the debugging skill. A
question you can state that clearly usually answers itself, and the ones that
don't are the ones worth asking a colleague.

## What "done" means

The checkpoint passed and you committed the work. Not "I read it and it made
sense." The Scouter is deliberately dumb: it only knows what you tell it, so the
only person you can cheat is yourself.
