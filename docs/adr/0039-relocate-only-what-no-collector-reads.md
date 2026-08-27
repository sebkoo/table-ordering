# 0039. Relocate only a section no collector reads, and link the demo from the front door

- **Status:** accepted
- **Date:** 2026-08-27

## Context

[ADR 0038](0038-order-the-readme-for-a-reader-who-scans.md) reordered README and moved
nothing out of it. Its reason was that three convention rules take their subjects from
that file, and that the two ways a move can go wrong are not symmetric:

- **A total move is loud.** `check-conventions.ts` computes
  `const vacuous = rule.expectsSubjects && outcome.subjects === 0` and reports a vacuous
  rule as `FAIL`.
- **A partial move is silent.** The rule keeps a subject, passes, and the count it prints
  is the only trace the others left. Nothing compares that count with a previous one.

That walk proved something narrower than "nothing may leave". Every move it weighed was
one of those two cases — `Known limitations` would have taken three of
`open-window-restated`'s seven subjects, and `Run it` or the captures would have taken all
of another rule's. **A section holding zero subjects is a third case**, and it is the one
this record spends: nothing leaves a sight that never looked.

The licence is earned per section, by census, never assumed. Run at `8a30ebd` with each
rule's own selector:

| Rule | Subjects | Where |
| --- | --- | --- |
| `run-step-single-transaction` | 3 | README 52, 70 (`## Run it`); 686 (`## Run it in full`) |
| `open-window-restated` | 7 | README 216, 222, 671, 959, 971, 1022; one in `apps/guest/src/features/order/placed.tsx` |
| `capture-caption-resolves` | 3 | README 14 (front door); 108, 113 (`## What it looks like`) |

Mapped onto the headings, with each section's size:

| Section | Lines | Size | R6 | R7 | R9 |
| --- | --- | --- | --- | --- | --- |
| `# Table-side ordering…` | 1–17 | 17 | | | 1 |
| `## Why` | 18–26 | 9 | | | |
| `## Run it` | 27–90 | 64 | 2 | | |
| `## What's here` | 91–100 | 10 | | | |
| `## What it looks like` | 101–116 | 16 | | | 2 |
| `## What happens at the table` → `### Today` | 117–489 | 373 | | 2 | |
| `### Next` | 490–498 | 9 | | | |
| **`## How a menu request is served`** | **499–542** | **44** | | | |
| **`## How an order is taken`** | **543–601** | **59** | | | |
| `## Roadmap` | 602–626 | 25 | | | |
| `## Run it in full` | 627–900 | 274 | 1 | 1 | |
| `## Decisions` | 901–944 | 44 | | | |
| `## Known limitations` | 945–1285 | 341 | | 3 | |
| `## Non-goals` | 1286–1293 | 8 | | | |
| `## Money` | 1294–1314 | 21 | | | |
| `## Licence` | 1315–1321 | 7 | | | |

**1085 of 1321 lines — 82% — sit in a section holding a subject.** The relocatable set is
12%, and the honest reading of that number is in the Consequences below: relocation under
this licence is not the answer to the length question, and this record does not pretend
otherwise.

A second thing was true of the same file. README named a moving picture of the loop and
gave a reader no way to reach it. [ADR 0037](0037-produce-the-demo-from-a-script-in-the-tree.md)
put the producer in the tree and the take on a release, and `v0.1.0` now carries
`table-ordering-demo.webm` — 32 s, 900×620, 401,332 bytes. The objection that a link to it
would be a dead link has expired.

## Decision

**The two request-path walkthroughs move verbatim to `docs/how-a-request-is-served.md`,
and nothing else moves.** They are the only sections in README that are code-facing rather
than product-facing — two ASCII diagrams naming source paths — and the census says they
hold no subject of any rule.

**Every collector count is unchanged: `run-step-single-transaction` 3,
`open-window-restated` 7, `capture-caption-resolves` 3.** That invariance is the whole
content of the move, and it is earned by the map above rather than hoped for: R6's three
`psql` fences are in `## Run it` and `## Run it in full`; R7's six README sites are in
`### Today`, `## Run it in full` and `## Known limitations`; R9's three captures are on the
front door and in `## What it looks like`. Every one of those sections stays.

**Verbatim means verbatim.** No re-wrapping, no re-indentation, no tidying in transit. The
one change is the two `docs/adr/…` links, whose resolution base moves with the file that
holds them and which become `adr/…`. Nothing in this repository checks that a link
resolves, so the rewrite is verified by command rather than left to a rule.

**README keeps a `## How a request is served` section**: three newly written sentences and
the link. That is new prose in the place the depth left, not a summary of the depth — the
moved sentences survive whole in the file that now holds them.

**The front-door capture becomes a poster-link to the `v0.1.0` release**, with one sentence
in its caption naming what the link holds. The image stays local and scheme-less:
`IMAGE_REFERENCE`'s target group stops at the first `)`, so `capture-caption-resolves` still
reads `docs/images/guest-page-order-placed.png` and still keeps the subject, and
`captionAfter` still returns the caption paragraph directly beneath. No new image lands, so
the count does not move.

## Rejected alternatives

- **Summarize the two sections in place, or rewrite them shorter.** The obvious way to make
  README shorter, and it is the one ADR 0038 already refused for the same reason: the depth
  is the evidence. A walkthrough compressed to its conclusions is a claim without the
  argument behind it, and the complaint about this file was never that it says too much.
  Relocation keeps every sentence and changes only which file a reader opens to reach it.

- **Move `Known limitations` — 341 lines, the least scannable block in the file.** The
  strongest option by reading benefit, and refused because it is the silent class: three of
  `open-window-restated`'s seven subjects live in it, `RESTATING_PATHS` is
  `['README.md', 'apps/guest/src/features/order/placed.tsx']`, and moved, those three become
  invisible. The rule would report four subjects and pass, and the window could move on the
  server with three sentences left saying the old value and nothing to go red. This is not a
  judgment call about risk; `4986800`'s break pair drove both branches and the silent one
  stays green. What it waits on is in the Consequences.

- **Move `Roadmap`, `Money` and `Non-goals` as well.** All three hold zero subjects, so the
  licence covers them, and each lost on its own terms rather than on the rule. `Non-goals` is
  8 lines: a summary and a link is not smaller than the thing it replaces. `Money` is
  front-door positioning — the zero-basis-points sentence is the claim the project is
  organised around, and a reader who has to follow a link to it has been told less. `Roadmap`
  is a 16-row table where every row reads Done, which is the most scannable evidence in the
  file. The trigger for reconsidering any of them is that section growing past the point
  where it reads at a glance.

- **Embed the take inline with a GitHub user-attachments URL.** It would put the moving
  picture on the front door itself rather than one click away, which is a real gain. Three
  costs, each fatal on its own. It creates a second home for the take — unversioned,
  account-tied, and outside the release the invariant hangs it on, against a design whose
  whole point is one home tied to a tag. It goes stale silently: the embed keeps rendering
  the old take after the next re-record, looks current, and no rule in this tree can see the
  difference. And it is an asset no script here reproduces, in a repository that just spent a
  commit making the demo reproducible from `tools/record-demo.ts`.

- **Commit a GIF or an animated image.** Three standing records already refuse it. ADR 0032's
  size arithmetic rejected motion in the tree against the 45,217 bytes the three stills cost;
  ADR 0037 rejected a GIF on its own terms and chose a release asset; and `AGENTS.md` carries
  it as an invariant — "No video byte enters the tree". A link to the tag the take already
  hangs on is what that invariant permits, and it is what this record takes.

- **Split README wholesale into a document set.** ADR 0038 rejected this and the rejection
  stands unchanged: every split moves some collector's subjects, each move is individually
  invisible, and the rules that hold this file together would end up holding a fraction of
  it. That record's trigger — "worth reconsidering once the rules read a document set rather
  than two named paths" — is the same one the Consequences below carry forward.

## Consequences

**`docs/how-a-request-is-served.md` is read by no rule.** `RESTATING_PATHS` names two paths
and neither is it; `readImageReferences` reads `README.md`, `AGENTS.md` and `docs/adr/*.md`,
and `docs/*.md` is not in that set. A duration written into that file is invisible to
`open-window-restated`, and a picture put in it is invisible to `capture-caption-resolves`.
Today it carries neither. This is stated as the residue of the move rather than repaired,
because a selector widened for a subject that does not exist is a guess.

**The unchecked-link class widens for the first time.** ADR 0038 wrote "This commit does not
widen the class: no section moved into another directory, so no link's resolution base
changed." This commit moves one, and two links change base with it. They are rewritten in
transit and checked by resolving every relative link in the new file against the tree — a
command in the report, standing in for a rule that does not exist. What would close the
class is unchanged: a rule reading every relative link in the documents, arriving with the
first link that breaks rather than ahead of one.

**README goes from 1321 lines to 1230 — seven per cent.** The map says why that is the
ceiling under this licence and not a disappointing outcome of it: 82% of the file is
subject-bound, and no census can make it otherwise. **The length question is answered by the
next commit, not this one.**

**ADR 0038's trigger has come due.** What it says, verbatim:

> The reading benefit is real and the repair is available: widen `RESTATING_PATHS` first,
> then move the block. That is a later beat's decision.

This is that beat, and the trigger is recorded as due rather than left as a sentence that
came true unremarked. It is **not taken here**, and the reason is not caution. Widening the
selector in this commit would land a seam with no consumer: `RESTATING_PATHS` would grow a
path holding no duration, which is exactly what `AGENTS.md` refuses — "Do not build an
abstraction before its first implementation" — and what [ADR 0004](0004-defer-conventions-to-first-subject.md)
refuses in its own words, that a rule written before its subject exists is a prediction
rather than a decision.

So the two halves land together, and the successor is named rather than implied:

**`RESTATING_PATHS` widens with its first subject. The widening and the move of
`Known limitations` to `docs/known-limitations.md` land in the next commit as one
behaviour** — one selector widened, one test proving the widened path finds a duration in a
`docs/` file, one verbatim move, and `open-window-restated`'s seven subjects predicted split
across the two files. That is the same bundling ADR 0004 licenses everywhere else in this
tree: the rule and its first subject arrive in the same commit, and the subject complies
because it was written minutes earlier.

**This change adds no acceptance condition**, for the reason ADR 0038 gave and this one
inherits: its content is invariance. The move is correct exactly when the three counts hold
across it, so what makes them load-bearing is the break table driven against this commit
rather than a new test. That is a departure from the loop's second step, recorded here
rather than left to be noticed.

## Addendum, 2026-08-27

The successor this record named has landed, in
[ADR 0040](0040-widen-the-windows-sight-to-the-documents.md). What is above stays as it
was written on its own date; this section records what happened when it did.

**The promise, verbatim:**

> **`RESTATING_PATHS` widens with its first subject. The widening and the move of
> `Known limitations` to `docs/known-limitations.md` land in the next commit as one
> behaviour** — one selector widened, one test proving the widened path finds a duration in a
> `docs/` file, one verbatim move, and `open-window-restated`'s seven subjects predicted split
> across the two files.

**Kept, on every term.** The selector gained a walk of the markdown documents directly under
`docs/` rather than a second filename, which is the shape `readImageReferences` already uses
and which leaves `docs/adr/` outside the sight by construction. Two conditions landed with
it, one of them the promised proof that a duration in a `docs/` file is now found. The 338
body lines moved byte for byte, with the eleven record links rewritten and nothing else
touched. The count held at seven.

One term needed reading before it could be checked. "The two files" are the two files of the
move — README and the document the block landed in. The seventh subject is on the guest's
`placed.tsx`, untouched by that commit and never in question, so the split shown is three
ways: README 3, `docs/known-limitations.md` 3, the guest's page 1.

**The residue this record wrote down is half discharged.**
`docs/how-a-request-is-served.md` is now read by `open-window-restated` — a duration written
into it is no longer invisible, and the break table drove that against the tree. It remains
outside `capture-caption-resolves`: a picture put in it is still invisible, and what widens
that set is the first picture that appears there.
