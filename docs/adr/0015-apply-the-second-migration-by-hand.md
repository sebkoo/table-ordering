# 0015. Apply the second migration by hand, and defer the runner to a named trigger

- **Status:** accepted
- **Date:** 2026-08-20

## Context

ADR 0008 chose plain SQL migrations with no runner, and closed with a consequence
that scheduled its own review:

> Nothing records which migrations have been applied to a given database. That is
> acceptable with one migration and no deployment, and it is the constraint that
> forces the runner decision to be revisited rather than forgotten: the second
> migration cannot be applied safely without one.

The table slice writes `0002-create-restaurant-table.up.sql`. The second
migration exists, so this is the revisit, and the sentence above has to be
answered rather than stepped around.

"Safely" is doing the work, and it can be read two ways. Read as "without a
mistake going unnoticed", the sentence is right and a runner is due now. Read as
"without silent corruption", it depends on what re-applying a migration to this
repository's schema actually does, which is a question about files rather than
about principle. Three observations, checked rather than assumed:

- No migration file uses `IF NOT EXISTS` or `CREATE OR REPLACE`. Re-applying one
  raises `relation already exists` and stops. A developer who has lost track is
  told so by the database, at the first statement, before anything changes.
- Every statement in every migration is DDL. The test suites send a whole file as
  one query, which PostgreSQL runs in an implicit transaction. A person running
  `psql` does not get that — `psql` commits each statement as it goes, so a file
  that failed halfway would leave the half behind. The run steps therefore pass
  `--single-transaction`, which is what makes the property true rather than
  merely likely.
- The README names both files, in order, in the steps a fresh clone follows.

Nothing is deployed. There is no machine whose schema version is unknown, and no
second machine applying migrations at the same time — the two things a state
table and an advisory lock exist to handle.

## Decision

The second migration is applied by hand, as the first one is, and the runner is
deferred to a trigger that can be observed rather than argued about:

**The runner lands with the first deployment, or with the first migration that
alters data rather than creating structure.** A re-applied `CREATE` errors; a
re-applied `UPDATE` corrupts.

This narrows ADR 0008's closing sentence: not "the second migration cannot be
applied safely without one", but "a migration that changes data cannot". ADR 0008
is not edited and is not superseded — its decision, plain SQL file pairs with no
runner, is reaffirmed here, and only the scope of one consequence is drawn more
tightly, on evidence that record could not have had before a second migration
existed.

## Rejected alternatives

- **A runner now — dbmate or node-pg-migrate.** It would settle the question for
  good, and ADR 0008 itself named this as the first thing to add. Rejected
  because the state table and the lock that make a runner worth its keep answer
  problems this repository does not have yet, and because a tool taken on now is
  a tool every later migration is written against, chosen when there are two
  files to learn from.
- **A hand-written runner now — a `schema_migrations` table and an advisory
  lock.** The strongest case against this decision, and it is ADR 0004's own
  argument: a rule arrives with the commit that creates its first subject, and
  `0002` is that subject. It loses on what the rule would be governing. A runner
  is not a rule that a file must comply with; it is a program that has to be
  right, and its first correctness question — what happens when two processes
  apply migrations at once — has no subject here at all. The trigger above puts
  it in the commit where that question becomes real.
- **Idempotent migrations, with `IF NOT EXISTS`.** It would make re-application
  harmless and remove the need to track state at all. Rejected because it removes
  the loud failure this whole argument rests on: a migration that quietly does
  nothing cannot tell a schema that is already correct from one that has drifted,
  and the divergence is then discovered by a query returning the wrong shape.
- **Reading ADR 0008's sentence as written and adding the runner without
  argument.** Honest, and it would have been cheaper than this record. Rejected
  because the sentence was written when no second migration existed, and treating
  a prediction as a finding is the failure mode ADR 0004 describes for rules
  written ahead of their subjects.

## Consequences

A developer with an existing clone has to know which migrations they have already
applied, and nothing tells them. With two files that is the README; the trigger
above is what stops it being the README with six.

`--single-transaction` is now part of how a migration is applied by hand, and the
argument in this record depends on it. A run step that loses the flag loses the
property, silently.
