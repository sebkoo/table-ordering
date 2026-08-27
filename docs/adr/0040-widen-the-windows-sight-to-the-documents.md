# 0040. Widen the window's sight to the documents, and move Known limitations out

- **Status:** accepted
- **Date:** 2026-08-27

## Context

[ADR 0039](0039-relocate-only-what-no-collector-reads.md) moved the two request-path
walkthroughs to `docs/how-a-request-is-served.md` and named this commit as its successor.
What it committed to, verbatim:

> **`RESTATING_PATHS` widens with its first subject. The widening and the move of
> `Known limitations` to `docs/known-limitations.md` land in the next commit as one
> behaviour** — one selector widened, one test proving the widened path finds a duration in a
> `docs/` file, one verbatim move, and `open-window-restated`'s seven subjects predicted split
> across the two files.

**That promise is kept here, on every term.** One reading needs fixing before it can be
checked: "the two files" are the two files of the move, README and the document the block
lands in. The seventh subject is on `apps/guest/src/features/order/placed.tsx`, which no
part of this commit touches and which was never in question, so the split this record has
to show is three ways — README 3, `docs/known-limitations.md` 3, the guest's page 1.

It also discharges the trigger [ADR 0038](0038-order-the-readme-for-a-reader-who-scans.md)
set when it refused the same move, and which ADR 0039 recorded as due without taking:

> The reading benefit is real and the repair is available: widen
> `RESTATING_PATHS` first, then move the block. That is a later beat's decision.

### The census, re-run at `7ee8050`

`open-window-restated`'s own selector, over the two paths it reads, with the line numbers
the tree carries today rather than the ones the last map recorded:

| Site | Text | Section |
| --- | --- | --- |
| `README.md` 218 | `two hours` | `### Today` |
| `README.md` 224 | `Two hours` | `### Today` |
| `README.md` 579 | `two hours` | `## Run it in full` |
| `README.md` 868 | `two hours` | `## Known limitations` |
| `README.md` 880 | `two-hour` | `## Known limitations` |
| `README.md` 931 | `two hours` | `## Known limitations` |
| `placed.tsx` 56 | `two hours` | — |

Three in the block, as ADR 0038 said and ADR 0039 confirmed. `## Known limitations` is
`README.md` 854–1194 — heading, blank, 338 lines of bullets, blank — and it carries no
image reference, so `capture-caption-resolves` has nothing at stake in the move.

### The links are eleven, not twelve

ADR 0038 wrote "the twelve `docs/adr/` links inside the block". Recounted at this parent
there are **eleven**, all `docs/adr/…`; at `4986800`, the commit that record landed in,
there were **ten**, and `8a30ebd` added the eleventh with the brand-trigger bullet. So the
number was wrong on its own date. It is left as written, because a record states what was
decided when it was decided and a decision that moves is superseded rather than edited.

### What ADR 0039 left standing

Two residues, both written down there rather than repaired:

- `docs/how-a-request-is-served.md` is read by no rule. A duration written into it is
  invisible to this one.
- The unchecked-link class. Nothing here resolves a relative link, so a link whose base
  changes in transit is rewritten by hand and checked by a command in the report.

The first is why the widening could not land in that commit — a selector widened for a
subject that does not exist is a prediction, which is what
[ADR 0004](0004-defer-conventions-to-first-subject.md) refuses. The subject exists as of
this commit, so the selector and its first subject arrive together.

## Decision

**`open-window-restated` reads two named files and every markdown document directly under
`docs/`.** `RESTATING_PATHS` keeps `README.md` and the guest's `placed.tsx`;
`RESTATING_SOURCE` is `docs`, walked for its own files and filtered to `.md`, and
`readWindowMentions` composes the two lists the way `readImageReferences` already composes
`CAPTURING_FILES` with the records directory.

**The walk never descends.** `names(…, 'file')` returns files, so `docs/adr/` and
`docs/images/` are outside the sight because they are directories, not because a filter
excludes them. That keeps [ADR 0028](0028-check-the-window-where-it-is-restated.md)'s
exclusion — a record's window is a capture, true of that decision on its own date, and a
rule that could only go green by rewriting a record is a rule that gets bypassed — held by
construction rather than by something a later reader has to remember.

**`## Known limitations` moves verbatim to `docs/known-limitations.md`.** The 338 body
lines travel byte for byte: no re-wrapping, no re-indentation, no tidying. Two things
change and nothing else. The eleven `docs/adr/…` targets become `adr/…`, because their
resolution base moves with the file that holds them. And the `##` heading line does not
travel: the document's title carries it, as `# How a request is served` carries the two
headings under it.

**README keeps a `## Known limitations` section**: three newly written sentences and the
link, in the place the depth left. The depth survives whole in the file that now holds it.

**Every count is unchanged, and one of them is unchanged by splitting.**
`run-step-single-transaction` 3, `capture-caption-resolves` 3,
`open-window-restated` **7 — three in README, three in `docs/known-limitations.md`, one on
the guest's page**. A verdict line cannot show that split; the site list is the evidence,
and it is in the report.

**Two README sentences the move falsifies are replaced rather than left.** `## What's here`
said the depth is "under it … and the limitations, at length", which stops being true of
this file the moment the block leaves; it now says "under it or one link from it", which is
also the repair for the request paths that left in the previous commit. The Roadmap
paragraph ended "what each row bought is what the section above describes", and the section
above it is a three-sentence stub pointing at `docs/`. The clause is removed rather than
reworded: it names a neighbour by position, two reorders in three commits have falsified
it, and nothing here checks a cross-reference, so any rewording re-enters the same class.

## Rejected alternatives

- **Name `docs/known-limitations.md` as a second filename, and walk nothing.** The smallest
  landing, and it satisfies every word of ADR 0039's promise. It loses because it re-creates
  the blindness one file over: `docs/how-a-request-is-served.md` narrates the ordering flow
  and is exactly where the next duration phrase would be written, and it would be as
  invisible after this commit as before it. The trigger for widening would then be "the
  first duration written into a second `docs/` file" — a trigger that fires by going
  unnoticed, which is the failure this rule exists to end rather than a state it can
  detect. The break table drives the difference: with the walk, a duration written into the
  request-paths file moves the count to eight; with a filename list it does not move at all.

- **Walk `docs/` and everything under it, records included.** It would end the residue
  completely: no document anywhere under `docs/` could carry an unwatched restatement. ADR 0028 refuses it for a
  reason that has not changed. A record restates the window as it stood on the record's own
  date; the window moves; every record that ever named it goes red at once, and the only way
  back to green is to rewrite history. A rule whose green state requires falsifying the
  archive is a rule that gets bypassed, and the archive is worth more than the coverage.

- **Move the block and leave the selector narrow.** The silent class, and the one ADR 0038
  and ADR 0039 both refused. The rule would report four subjects, pass, and print a number
  nothing compares with a previous one; the window could then move on the server with three
  sentences left saying the old value and nothing to go red. `4986800`'s break pair drove
  both branches and the silent one stays green.

- **Widen the selector and leave the block where it is.** Legal in the other direction and
  useless: `RESTATING_PATHS` would grow a path holding no duration, which is the
  consumer-less seam ADR 0004 and `AGENTS.md` both refuse. The two halves are one behaviour
  precisely because neither is worth landing alone.

- **Summarise the limitations in place rather than moving them.** The obvious way to shorten
  README, and it is what ADR 0038 refused about the same block: the depth is the evidence.
  A limitation compressed to its conclusion is a claim without the argument, and the
  complaint about this file was never that it says too much. The move keeps every sentence
  and changes only which file a reader opens.

- **Keep the eleven link targets as `docs/adr/…` and let them break.** No rule resolves a
  link, so nothing here would notice. It is rejected on what the document is for: a reader
  who follows a citation and lands nowhere has been told less than one who was given no
  citation. The rewrite is verified by a command in the report, which is what a rule would
  do if one existed.

## Consequences

**A `docs/` file is policed for duration prose from now on.** The class of file that can
redden `open-window-restated` has grown from two to two-plus-a-directory, and a document
added under `docs/` inherits the rule without anybody choosing that. Today the directory
carries no duration that is not the window; the first one that is — a `30 minutes` in some
unrelated narration — would be a false violation, and the answer then is a narrower
predicate rather than a narrower path list, because the path list is what just stopped
being the thing that goes blind.

**The unchecked-link class widens a second time.** ADR 0039 widened it first and wrote what
would close it: a rule reading every relative link in the documents and resolving it against
the tree, arriving with the first link that breaks rather than ahead of one. Eleven more
links now resolve from `docs/` rather than from the root, and the same stand-in command
stands in for the same absent rule.

**A capture-labelled constant that no rule compares against the tree goes stale silently.**
`RESTATED` in the convention suite is labelled as the seven the tree carries, and its line
numbers had already drifted — 113, 119, 409, 580, 592, 604 against a tree carrying 218, 224,
579, 868, 880, 931 — with nothing red anywhere, because the constant drives the rule and is
never compared with what it claims to capture. It is recaptured here because this commit
moves its shape and not merely its values. The class is the same residue family as the
links: a restatement whose only reader is a human. Closing it would take a condition that
collects the tree's mentions and compares them with the constant, which is its own beat.

**README goes from 1230 lines to 900.** ADR 0039 said the length question was answered by
the next commit rather than by that one. This is the answer: 27 per cent, taken from the
one section whose subjects the rules could be taught to follow.
