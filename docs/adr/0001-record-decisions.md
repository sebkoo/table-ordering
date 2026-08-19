# 0001. Record architecture decisions

- **Status:** accepted
- **Date:** 2026-08-19

## Context

The decisions that shape a system are mostly invisible in its code. Code shows
what was built; it does not show what else was on the table, what constraint
ruled the alternatives out, or whether a constraint still holds. Without a
record, a later reader who dislikes a choice has two options: keep it out of
caution, or change it without knowing what it was protecting against.

Commit messages are the wrong home for this. They are keyed to a change rather
than to a subject, they are hard to supersede, and a decision that took three
commits to land has no single message that holds it.

## Decision

Architecture decisions are recorded as numbered Markdown files in `docs/adr/`,
one decision per file, written from `docs/adr/0000-template.md`. Numbers are
never reused. A reversed decision gets a new record; the superseded record
stays in place and says which record replaced it.

A record is written in the commit that first introduces the decision's
subject, not in advance of it.

Every record names its rejected alternatives, and the `write-adr` skill will
not finish a record without them. That section is the one that carries the
information a reader cannot reconstruct from the code.

## Rejected alternatives

- **No records; rely on commit messages and code comments.** Both are keyed to
  a change rather than to a subject, and neither survives the refactor that
  moves the code somewhere else.
- **A single running design document.** It grows without bound, has no way to
  express supersession, and turns every decision into an edit that hides the
  previous state.
- **A wiki or an issue tracker.** Decisions then live outside the repository
  and out of sync with the code they govern, and a clone stops being a
  complete copy of the project.
