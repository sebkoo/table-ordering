# 0017. Check the procedure by running it, not by matching its text

- **Status:** accepted
- **Date:** 2026-08-20

## Context

Two steps of `.claude/skills/land-a-change` carry a property that decides
whether they establish anything: a step's evidence comes from the subject it
reports on.

The metadata comparison is one. `pnpm check-push` compares the repository's
description and topics against a string passed on the command line. If that
string is read from the server at push time, the comparison is the server
against itself, and `metadata-declared` prints `PASS` whatever the server holds.
The string has to come from the declaration, quoted there before the declaration
locks, for the comparison to have two sides.

The commit-message hook probe is the other. A fresh sibling clone installs,
checks, and puts a rejected message and a clean one through the hook. A clone
taken before the commit holds the parent, and its output does not say which
commit it holds: a clone is clean whatever tree it came from, and the rule count
is the same either way. The clone has to be taken after the commit, and its
`git rev-parse HEAD` has to be read, for the probe to be about the change.

Nothing in this repository reads that skill file. `pnpm verify` has never opened
it, CI has never opened it, and the two references to it — in `AGENTS.md` and in
ADR 0012 — are prose. ADR 0012 divided the procedure into a half a program can
perform and a half only prose can carry, and named the cost of the second half:
a document can state a rule for a year while the tree quietly disagrees with it,
and nothing goes red.

These two steps are in that second half, and for a reason narrower than "they
are prose". What makes each of them true is where a value came from and when it
was taken. A document has no access to either. What the document says about the
steps and what the steps do are separate facts, and only one of them is on disk.

Both steps do end in a comparison of two values: two revisions for the clone,
two strings for the description. Those comparisons run while the procedure runs,
against the change being made.

## Decision

**The two steps are checked by running them, on the change being made. Nothing
in `pnpm verify` inspects the document that states them.**

The clone step prints `git rev-parse HEAD` from the clone beside the revision
under test, and the two are equal or it is not a clone of the subject. The push
step passes `--description` the string the declaration quoted, and
`metadata-declared` prints `declared:` and `remote:` on adjacent lines when they
differ. Each is a value diff, produced at the moment the step runs, by the
person running it.

The skill's wording is the subject of no rule. It is read, followed, and edited
freely.

## Rejected alternatives

- **A convention rule asserting the skill file contains a sentence naming each
  property.** One rule, running on every commit, and an edit that deleted the
  sentence would turn CI red. It lost because the presence of a sentence is not
  the truth of a step. A file that carries both sentences and orders its steps
  the other way satisfies the rule completely, which makes the rule's `PASS` a
  report about typing rather than about the procedure.
- **A rule that parses the ordered list and asserts the clone item's index
  exceeds the commit item's.** Its case is the strongest of the three: it is
  executable, it discriminates, it prints two indices side by side, and it
  catches the one thing nothing else catches — a later edit moving the clone
  step back before the commit. It lost on two counts. The ordering would then be
  written down twice, once as the list and once as a matcher in
  `tools/check-conventions.ts`, and two copies of a rule drift with nothing to
  notice. And a rule that matches text inside a prose document couples the build
  to that document's wording: the first rewrite of a step — a clarification, a
  shorter sentence, a heading renamed — turns CI red for something that is not a
  defect. A rule that goes red for things that are not defects is removed rather
  than narrowed, and the ordering then has neither a rule nor the habit of one.
- **A `check-push` flag that reads the description out of the declaration
  file.** It would remove a transcription, and with it the chance of transcribing
  wrongly. It lost because a declaration lives outside this repository: the path
  is not version controlled here, is not reviewable in the diff, and is not
  something a fixture can honestly stand in for. ADR 0012 declined an expectation
  stored in a file *inside* the repository while crediting it with the first two
  of those; a path outside has none of them. The transcription is also what turns
  the declaration into an assertion rather than a description, and a tool that
  performs it removes the only place the intent is stated.

## Consequences

An edit that moves the clone step back before the commit, or that drops the
requirement to quote the metadata, is caught by nothing here. It shows at the
next run of the procedure, and only to someone reading the step. That is the
price of the decision, and it is not small.

What it buys is that the skill can be rewritten — reworded, reordered,
shortened — without a build going red for a reason that is not a defect. The
document stays a document.

The comparisons happen once per change, at the moment the change is made, and
their output is retained nowhere. Whether a given commit's clone held the right
revision is answerable from that commit's report and from nothing else
afterwards.
