# 0041. Move the depth into `docs/`, and widen the run steps' sight to reach it

- **Status:** accepted
- **Date:** 2026-08-27

## Context

README was 900 lines. Shortening it has been asked for four times, and the answer has
each time been order-not-deletion — ADR 0038 ordered it for a reader who scans, ADR 0039
relocated the one section no collector read, ADR 0040 widened a rule so a second section
could follow. That sequence has now run out of free moves inside the file. What is left
is relocation, and the only two blocks large enough to matter are
`## What happens at the table` (379 body lines) and `## Run it in full` (271).

**The two moves have different enablers, and that asymmetry is the most useful thing this
record says.** A reader who finds both in one commit must be able to see why one of them
was free:

- The API narrative carries two `open-window-restated` sites and nothing else a rule
  reads. ADR 0040 widened that rule to walk every markdown document directly under
  `docs/`, so those two sites stay in sight the moment the file lands. **No code.** That
  widening was argued prospectively; this is its first actual use.
- The walkthrough carries one `psql` fence, and `run-step-single-transaction` read
  `README.md` and nothing else. Moving the section without widening that rule would have
  left it reading the two invocations in `## Run it` and passing — a partial move, green,
  and silent. The vacuity contract cannot see it: that contract catches losing *every*
  subject, and this loses one of three. So the rule is widened here.

### The census, re-run at `f4181de`

`pnpm conventions` reported nine checks, nine PASS. The two rules with sites in the
moving blocks:

| Rule | Subjects | Sites |
| --- | --- | --- |
| `run-step-single-transaction` | 3 | `README.md` 55, 73 (`## Run it`); `README.md` 594 (`## Run it in full`) |
| `open-window-restated` | 7 | `README.md` 219, 225 (`### Today`); `README.md` 579 (`## Run it in full`); `placed.tsx` 56; `known-limitations.md` 20, 32, 83 |

`capture-caption-resolves`' three sites are at `README.md` 14, 111 and 116 — all outside
both moving blocks, checked rather than assumed. No document under `docs/` carried a
`psql` invocation, and no fence under `docs/adr/` is shell-tagged, so the widening below
adds zero subjects on the day it lands and exactly one after the move.

### Positional language, swept rather than read

Reading the two blocks found two sentences that pointed at something staying in README. A
sweep of 26 positional and self-referential terms over both blocks and over the text
staying behind found 24 hits; a supplementary sweep for named sections found 6, three of
them shared. **27 distinct hits, all classified, and the sweep found a third
cross-block reference that reading had missed** — `The rest of the walkthrough`, whose
"rest of" is addressing with no word in it that a reader would search for.

That is the lesson worth keeping: a hand-read count of positional references in 650 moved
lines is a count of what was noticed.

## Decision

**Both sections move into `docs/`, and `run-step-single-transaction` gains the same walk
`open-window-restated` has.**

**`## What happens at the table` moves verbatim to `docs/what-happens-at-the-table.md`,
and `## Run it in full` to `docs/run-it-in-full.md`.** In each, README keeps the `##`
heading and gains a pointer of two or three sentences; the moved body opens under a new
`#` title and a preamble saying what it is and where it came from. That is the shape ADR
0039 and ADR 0040 established.

**Nothing is summarized, compressed or tidied. Only addressing changes**, and every
instance is named here:

| Change | Count | What |
| --- | --- | --- |
| Record links rebased | 10 | `](docs/adr/…` → `](adr/…`: 8 in the API narrative, 2 in the walkthrough |
| Headings promoted | 2 | `### Today` and `### Next` → `##`, preserving relative depth under the new `#` title |
| Deictics rebased | 3 | "the limitations **below**" → a link; "**The rest of** the walkthrough" and "The migration **above**" → both name the README's `## Run it` |
| Deictics created | 2 | The two new pointers say "the same reason **the two above it are**" and "the quickstart **above** is enough to see a menu" — both intra-README, both true, and both recorded so the next relocation's sweep finds them already known. The second was written after the table said one, and found by sweeping the added lines rather than by re-reading them |
| Left as written | 1 | "the roadmap row's" names that row by its content and not by its position, so it stays true wherever it is read. Rebasing it would need `../README.md#roadmap`, the first anchor link in this tree, added to a class nothing resolves |

Rebasing a deictic is the same operation as rebasing a link. A relative link means what it
meant and merely has to be spelled differently from a different directory; "above" and
"below" are that exact species. The verbatim rule exists to stop relocation becoming
sanitization, and rebasing addressing is not that. One paragraph in the walkthrough was
re-wrapped where the rebase lengthened it, and the lead-in gained a line for the same
reason; nothing else in 650 moved lines differs from its source.

**`run-step-single-transaction` reads `README.md` and every markdown document directly
under `docs/`.** A `RunStepCommand` now carries the path it came from, as a
`WindowMention` already did, and a violation names that path rather than a literal
`README.md`. The fence parser is unchanged and was extracted rather than wrapped: the loop
keeps its indentation, so the diff shows added lines instead of a re-indented block, and
the parser is a better function for taking the text it parses.

**A directory rather than a second filename.** ADR 0039 recorded the reason against
`open-window-restated` and ADR 0040 acted on it: naming one document re-creates the
blindness on the file beside it. **The walk never descends**, so `docs/adr/` is outside the
sight by construction rather than by a filter somebody has to remember to keep. That
matters concretely here — ADR 0020 quotes a `psql` line with no flag on it, and a rule
that went red over a decision for being true on its own date is a rule that gets bypassed.

**ADR 0004 is satisfied in this same commit**: the widened selector arrives with its first
subject. It adds none before it and exactly one after, so there is no consumer-less seam.

**The path list is written out rather than shared** with `readWindowMentions`, which walks
the same directory today. The two coincide by coincidence and not by concept — that rule
excludes `services/` because of the durations it carries, and this one has no such reason.

**README stays in `RESTATING_PATHS` holding zero subjects.** After this commit the split
is `placed.tsx` 1, `known-limitations.md` 3, `run-it-in-full.md` 1,
`what-happens-at-the-table.md` 2, **`README.md` 0** — seven, unchanged. The vacuity
contract is rule-total, so nothing fails, and that design is the answer rather than a
loophole: a per-path contract would fail on README, and the only ways to satisfy it would
be to delete the path or to write a restatement into README to feed the checker. A rule
that pressures somebody into adding prose to satisfy it has stopped serving. The list
names where a restatement **must** be checked, not where one is, and README is the file
most likely to gain the next one. **Taking it out would re-create, on the highest-traffic
file, exactly the blindness ADR 0040 spent a commit closing.** A break row proves the
empty path is still watched: one duration written into README moves the rule 7 → 8.

**One acceptance condition is a deliberate tripwire.** The census over this tree asserts
that run steps live in `README.md` and `docs/run-it-in-full.md` and in no other document.
The first `psql` fence written into a new document under `docs/` will redden it, and the
repair is to name that document there. That is intended behaviour, said out loud so a
later session does not read the red as a break.

### A clause on the front door that was false when it was written

README's limitations pointer said that block became a document "because it was the longest
block in this file". Measured at `7ee8050`, where the sentence was written: README was
1230 lines, `## Known limitations` was 854–1194 = **341**, and `## What happens at the
table` was 119–500 = **382**. The API narrative was longer. **The clause was false on its
own date**, and it has since gone vestigial as well — after this commit three blocks are
documents, so "because it was the longest" no longer explains why that one is. It is
dropped rather than repaired, and replaced with the reason now true of all three.

**The principle, because it will be asked again: a false claim in a record is reported and
never rewritten; a false claim in editable prose that the commit is already rewriting is
corrected there and named.** ADR 0038's 'twelve' could only be reported because it lives
in a record. Applying that rule to README would be the letter of the discipline against
its purpose.

Separately: ADR 0040's "338 body lines" was checked against the tree and is correct —
`docs/known-limitations.md` is 345 lines less a seven-line header, and `f4181de`'s
deletion hunk removes exactly 338. It is the figures in that commit's declaration, not the
record, that were off by one.

## Rejected alternatives

- **Delete or trim the depth instead of moving it.** The depth is the evidence for every
  claim above it. A shorter README bought by removing what makes it checkable is a worse
  document that measures better. Trigger for revisiting: none — this is the answer ADR
  0038 already gave and nothing has changed it.
- **Move a section and leave part of a rule's subjects behind.** This is the silent class:
  the check stays green, the count drops, and nothing says so. It is the whole reason the
  walk is widened in the same commit rather than a later one.
- **Move `## Run it` or the captures too.** They are what a reader needs at the door — the
  quickstart is the shortest path from clone to a menu on screen, and the pictures are the
  fastest answer to what this is. Moving the quickstart is also a different behaviour with
  its own enabler question, since two `run-step-single-transaction` subjects live in it.
  Trigger: a front door that reads as an index rather than a door.
- **Share one `docs/` walk between the two rules.** Fewer lines, and it would make two
  rules' sight one thing to change. Their path sets agree today by coincidence, not by
  concept. Trigger: a third rule needing the same walk, at which point the shape is a
  concept rather than a coincidence.
- **A per-path vacuity contract, so an empty listed path fails.** It would fail on README
  today and could only be satisfied by deleting the path or writing prose to feed the
  checker. Rejected above at length.
- **A census condition pinning each run step's line number.** Lines move with every README
  edit, and the capture-residue class ADR 0040 named would gain a third instance. The
  census names paths only.
- **Gloss the broken deictics in each new file's preamble instead of rebasing them.** It
  would keep the moved text byte-identical, and it would leave a sentence that is true
  only for a reader who read a preamble two hundred lines earlier. Rebasing leaves it true
  where the reader meets it.

## Consequences

**Relative links in this repository are still resolved by nothing.** ADR 0039 wrote this
residue down and ADR 0040 widened it; this commit widens it again. The moved documents
carry 13 relative targets — 10 rebased, 2 in their preambles, 1 created by a deictic
rebase — and README's went from 62 to 58, six of them new and five of those pointing at
files this commit creates. A stand-in command resolved all of them by hand and reconciled its own totals
before they were reported, which is a run of a command and not a check in the tree.

**README is 262 lines**, from 900. That is well under the 450 that was asked for, and
nothing was deleted to get there: 650 lines moved, and 12 lines of pointer, link and record row
came back. The number is measured rather than promised — no paragraph was added, kept or
cut to reach a figure.

**`## Run it` is now 24% of the front door**, at 64 lines, where it was 7% of 900. Nothing
is done about it here. Proportion is a property of the whole that only becomes visible
after a cut, and moving the quickstart is a separate behaviour with its own enabler.

**A document under `docs/` is policed for run steps from now on**, as it already is for
duration prose. The class of file that can go blind is smaller by one, and the two rules
now go blind in the same place: a document not directly under `docs/`, or a fence tagged
outside `SHELL_INFO_STRINGS`.
