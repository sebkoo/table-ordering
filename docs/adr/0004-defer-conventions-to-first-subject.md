# 0004. Defer each convention to the commit that creates its first subject

- **Status:** accepted
- **Date:** 2026-08-19

## Context

A repository can enforce a rule from its first commit, or it can add the rule
when there is finally something for it to govern. The choice looks like a
question of discipline and is really a question of cost, and the cost is not
the same in both directions.

**Deferring a rule about files is free.** The commit that creates the rule's
first subject also writes that subject, so the subject complies by
construction. Migration `0001` is written with a down section, and the rule
requiring down sections lands in the same commit; it arrives at a set of
exactly one, and that one complies because it was written minutes earlier.
There is never a non-compliant predecessor, so the exception list never opens.

**Deferring a rule about history is not free.** Commit history is write-once.
A message policy that lands at commit three never governed commits one and
two, and cannot be made to without rewriting history — which destroys the
honest record the policy exists to keep. That is a genuine one-way door.

A rule written before its subject exists has a second problem: it is a
prediction. A rule forbidding runtime dependencies in `packages/money` and
`packages/menu-model`, before either package exists, does not enforce a
decision. It guesses a layout, and when the real layout differs, the rule gets
edited in the commit that first makes it meaningful.

## Decision

`tools/check-conventions.ts` ships two rules, and only two:

- **`readme-status-date`** — the README status line carries the UTC committer
  date of the most recent commit that changed `README.md`.
- **`commit-message-policy`** — no message in history carries an attribution
  trailer, a session URL, a generated-by line or an emoji.

`commit-message-policy` ships now because of the one-way door above. Every
other convention rule lands in the commit that creates its first subject.

The subject line's own clauses were prose that nothing ran until
[ADR 0025](0025-make-the-subject-clauses-executable.md) added them to the same
predicate. That record carries the reading of the door above for a rule about
history that landed seventeen commits late.

The same rule governs two other things:

- **Technical invariants in `AGENTS.md`.** An invariant about money lands with
  the first price; one about row-level security with migration `0001`; one
  about Redis with the first use of Redis.
- **Architecture decision records.** A record choosing a web framework lands
  with the first route. Recording it earlier would assert authority over code
  that does not exist.

Two supporting choices follow from this and are easy to misread as dead code.

**Every rule declares `expectsSubjects`, and the runner fails a rule that
passes over zero subjects.** Both rules here declare `true`, and for both it
never fires, because their zero-subject cases are already skips. It is not
inert: it is the guard that stops a later rule whose selector matches nothing
from reporting success. A check that inspects nothing has established nothing,
and without this it is indistinguishable from a check that passed.

Be precise about what it buys. It prevents silent success on a zero-match
rule. A selector that is wrong but happens to match one file, or that is too
broad, or that matches the wrong files while missing the right ones, still
passes. It is not a correctness guarantee for selectors.

**There is no `glob` field on the rule type.** Neither rule here selects
files; one reads git and the README, the other reads history. A shared glob
would exist only to serve file rules that have not been written, which is the
same guess this record rejects. When the first file rule lands it brings its
own selector, shaped from the real thing.

The message policy is enforced at three layers, and they are layered rather
than duplicated. `.claude/settings.json` is intended to control what an agent
composes; `.githooks/commit-msg` controls what git accepts, from anyone; CI
controls what the repository is allowed to contain. Each answers a different
question and none subsumes another. Deleting two of them as redundant would
leave the remaining one answering a question the other two were asked.

## Rejected alternatives

- **Ship every planned rule now.** The argument for it is real: a constraint
  that arrives before the code it governs never has to grandfather anything.
  That argument is decisive for history, which cannot be revised, and worth
  nothing for files, which comply by construction when the rule arrives with
  them. What it costs is rules that assert authority over directories and
  packages nobody has created, which are predictions rather than decisions.
- **Write nothing down and decide per rule later.** The most contestable thing
  in a checker carrying two rules is the shape built for more. Without this
  record the next reader either deletes `expectsSubjects` as unused, or adds
  the deferred rules speculatively — the two failures this is here to prevent.
- **Enforce the message policy only in CI.** One check, one place. It also
  means a bad message is caught after it is written into history, where the
  only fix is a rewrite. The hook catches it while it is still a draft.
