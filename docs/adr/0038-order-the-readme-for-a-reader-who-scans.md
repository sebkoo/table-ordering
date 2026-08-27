# 0038. Order the README for a reader who scans, and move nothing out of its collectors' sight

- **Status:** accepted
- **Date:** 2026-08-27

## Context

README was 1304 lines behind fourteen headings. Three sections carried 1043 of them:
`### Today` at 371 lines, `## Run it` at 333, and `## Known limitations` at 339.

It was built one commit at a time, each adding the sentences its own change earned, and
each of those additions was right on its own terms. What accumulated was a document with
no first screen. A reader who reads it meets judgment everywhere. A reader who scans meets
a wall — and a wall of uniform, exhaustive prose reads as machine output at exactly the
door where a person decides whether to look further. The failure is not that the depth is
wrong. It is that the depth arrives before anything that would make a reader want it.

The old first screen ran: title, five badges, a one-line description, a status line, three
captures, and then, at line 39, `GET /restaurants/blue-door/menu`. Nothing said why the
project exists, nothing said how to run it, and the roadmap sat 500 lines down.

**What constrains a reordering here is that four convention rules read this file.** Three
of them take their subjects from it: `run-step-single-transaction` reads its shell-tagged
fences, `open-window-restated` reads its prose for durations, `capture-caption-resolves`
reads its images and the paragraph under each. `readme-status-date` reads its status line.
A section moved out of README is a section moved out of their sight.

Two facts about the checker decide how that risk behaves, and they were read from it
rather than assumed:

- **A total move is loud.** `check-conventions.ts` computes
  `const vacuous = rule.expectsSubjects && outcome.subjects === 0` and reports a vacuous
  rule as `FAIL`. Moving every subject of a rule out of README reddens it.
- **A partial move is silent.** A rule that keeps one subject passes, and the count it
  prints is the only trace that the others left. Nothing compares that count with a
  previous one.

So the danger is not relocation as such. It is relocation that takes *some* of a rule's
subjects, which is exactly what moving one long section would do.

A third fact bounds the repair options: **nothing in this repository checks that a link
resolves.** README carries 72 relative links — 65 into `docs/adr/`, 7 to root files and
images — and no rule reads any of them. `capture-caption-resolves` reads an image's
reference and its caption but never asks whether the target file exists.

## Decision

**The README is reordered, and nothing is moved out of it.**

The first screen — lines 1 to 101 — is what a person needs to decide whether to keep
reading: what this is, the status line, the guest's page as a picture, why the project
exists, the run steps as far as the first working response, and a pointer into the depth.
The depth follows in a reader's order: the remaining captures, what happens at the table,
how a menu request and an order are served, the roadmap, the rest of the run steps, the
decisions, and the limitations.

**Order, not deletion.** Every block that moves, moves verbatim — no re-wrapping, no
re-indentation, no tidying in transit. Four passages are newly written: the opening
description, the `What's here` pointer, the lead-in to `Run it in full`, and the Decisions
line for this record. Nothing else in the file is new, and nothing is removed except the
four badges below.

**Every collector subject stays in README**, and the counts are unchanged:
`run-step-single-transaction` 3, `open-window-restated` 7, `capture-caption-resolves` 3.
The three psql fences split two-and-one across the quickstart and the full walkthrough;
the six duration restatements travel with their prose; the guest capture leads the front
door and the two staff captures move down into the product story, each keeping the caption
paragraph directly beneath it that `captionAfter` requires.

**One badge survives.** The CI badge is GitHub's own
`github.com/…/actions/workflows/ci.yml/badge.svg` and reports live state a scanning reader
uses. The other four — License, Node, TypeScript, pnpm — were static shields served from
`img.shields.io`, and they are removed. Each one's fact already lives in the tree:

| Badge | Surviving home |
| --- | --- |
| License | `LICENSE`, `package.json` `"license"`, the Licence section |
| Node 24 | `.nvmrc`, `package.json` `"engines"`, "Requires Node 24" in the run steps |
| TypeScript strict | `tsconfig.base.json` `"strict": true` |
| pnpm workspaces | `pnpm-workspace.yaml`, `package.json` `"packageManager"` |

Four of the five images on the old front door were fetched from a third-party badge host,
in a repository whose non-goals reject "anything that puts a third party between the
restaurant and its guest" and whose pages are held to reaching no origin but their own.
**That invariant governs the pages this repository serves, not this file rendered on
GitHub, so this is not an invariant violation.** It is the same reasoning applied where no
rule reaches, to four images that asserted facts the tree already holds.

## Rejected alternatives

- **Move `Known limitations` to `docs/`.** The strongest option, and the one with the
  clearest reading benefit: 339 lines of bullets is the least scannable block in the file,
  and a reader looking for limitations would find them faster in a document that announces
  itself as limitations. It loses on the count. Three of `open-window-restated`'s seven
  subjects live in that block — the two-hour restatements at the guest read, the sitting
  proxy, and the empty-list sentence — and the rule reads two paths, `README.md` and the
  guest's `placed.tsx`. Moved, those three become invisible: the rule would report four
  subjects and pass, and the window could move on the server with three sentences left
  saying the old value and nothing to go red. It would also break the twelve `docs/adr/`
  links inside the block, whose resolution base changes with the file that holds them, and
  nothing checks a link. The reading benefit is real and the repair is available: widen
  `RESTATING_PATHS` first, then move the block. That is a later beat's decision.

- **Move `Run it` or the captures to `docs/`.** Both are total moves —
  `run-step-single-transaction` and `capture-caption-resolves` take all their subjects from
  those two sections — so both reach zero subjects and the vacuity contract fails the run.
  Not a judgment call; the checker refuses them.

- **Delete or trim the depth.** The depth is the evidence. The limitations list is the
  honest half of every claim above it, and the record citations are how a reader gets from
  a sentence to the argument behind it. A README that reads well because it says less is a
  worse document that scans better, and the complaint was never that the file says too
  much — it is that it says it in the wrong order.

- **Add a table of contents and change nothing else.** Cheap, reversible, and it does help
  a reader who already knows what they are looking for. It does not move the wall: the
  first screen still opens on badges and an API example, and a table of contents is one
  more thing between the reader and the reason to care. It also decays, because nothing
  checks that its entries match the headings.

- **Decorate the front door** — more badges, emoji, a feature grid, adjectives. Rejected on
  sight. The complaint being answered is that the file reads as machine output; the repair
  for that is not more ornament. The voice stays the repository's own.

- **Split README into several small documents.** A genuine option, and the usual answer to
  a long README. It multiplies the silence risk this record is about: every split moves
  some collector's subjects, each move is individually invisible, and the rules that hold
  this file together would end up holding a fraction of it. It is worth reconsidering once
  the rules read a document set rather than two named paths.

- **Keep all five badges and move them to the bottom.** Preserves everything and costs
  nothing, which is its case. It keeps four third-party image fetches in the file to
  restate facts the tree already carries, which is the reason it lost.

## Consequences

`tsconfig.base.json` and `pnpm-workspace.yaml` lose their only mention in README — the
removed shields were the only things linking them. Neither fact was ever checked; both are
readable in the files themselves. `.nvmrc` is still named in the run steps.

The unchecked-link class is now written down. Seventy-two relative links leave this file,
none of them checked, and there are no inbound relative links to it — the records refer to
README in prose only. This commit does not widen the class: no section moved into another
directory, so no link's resolution base changed. Closing it would take a rule that reads
every relative link in the documents and resolves it against the tree, which would arrive
with the first link that breaks rather than ahead of one.

`readme-status-date` skips while README is modified, so the reordering could not be
observed failing that rule in the working tree. It was observed in a throwaway clone
instead, which is the established treatment.

This change adds no acceptance condition. Its whole content is invariance — the reorder is
correct exactly when the four rules hold their counts across it — so what makes those
counts load-bearing is the break table driven against this commit rather than a new test.
That is a departure from the loop's usual second step, and it is recorded here rather than
left to be noticed.

## Addendum, 2026-08-27

The repair this record named has been made, in
[ADR 0040](0040-widen-the-windows-sight-to-the-documents.md). What is above stays as it was
written on its own date; this section records what happened when it did.

What the rejected alternative said, verbatim:

> The reading benefit is real and the repair is available: widen
> `RESTATING_PATHS` first, then move the block. That is a later beat's decision.

The later beat is ADR 0040. The selector was widened first, in the same commit and minutes
ahead of the block that gave it its first subject, and `Known limitations` then moved to
`docs/known-limitations.md` with `open-window-restated` still reading seven.

One number here is wrong, and is left as written. This record says the block holds "the
twelve `docs/adr/` links"; it held ten on this record's own date, and eleven when they were
rewritten two commits later.
