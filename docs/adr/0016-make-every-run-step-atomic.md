# 0016. Make every run step atomic, and check the flag rather than restate it

- **Status:** accepted
- **Date:** 2026-08-20

## Context

ADR 0015 established `--single-transaction` for migrations and closed with a
consequence about what would happen if it were lost:

> `--single-transaction` is now part of how a migration is applied by hand, and
> the argument in this record depends on it. A run step that loses the flag
> loses the property, silently.

The flag was never on the seed block. It was written into the migration loop
and omitted from the block immediately below it, in the same commit as the
sentence above.

The consequence is not the one that record predicted, because a seed is not a
migration. ADR 0015's argument rests on re-application erroring loudly: every
migration statement is DDL, no file uses `IF NOT EXISTS`, so a developer who
has lost track is told by the database before anything changes. The seed is
DML, and the tables it writes are not alike. Run against a database that
already holds the rows, observed rather than reasoned about:

```
insert into restaurant        ERROR  duplicate key ... restaurant_slug_key
insert into menu_item         INSERT 0 1
insert into restaurant_table  ERROR  duplicate key ... restaurant_table_code_key
psql exit: 0
```

`restaurant` and `restaurant_table` each carry a unique constraint. `menu_item`
carries none, so the one statement with nothing to stop it is the one that
succeeds, alone. The menu gains a duplicate item, the API serves it, and the
guest's page shows it twice. `psql` exits 0.

The test suites cannot see this. They apply a whole file as one `pool.query`,
which PostgreSQL runs in an implicit transaction — the difference ADR 0015
names, and the reason the property has to hold in the run step itself rather
than in anything this repository executes.

The same run with `--single-transaction` reports `current transaction is
aborted, commands ignored until end of transaction block` and changes nothing.

## Decision

**Every `psql` invocation in the README's run steps carries
`--single-transaction`, and `tools/check-conventions.ts` is what says so** —
rule `run-step-single-transaction`, reading the shell-tagged code blocks and
failing an invocation without the flag.

A rule rather than a sentence, because the sentence has already been tried. ADR
0015 wrote it for migrations, and the seed block one screen below did not get
the flag. Prose that failed at the moment of its own writing is not a control.

The rule is late by ADR 0004's standard: both of its subjects predate it. That
record's cost for a late rule is a non-compliant predecessor forcing an
exception list open, and it is not paid here — the one non-compliant subject is
repaired in the same commit, so the rule arrives at a set that complies.

**The rule narrows with the first run step that must issue a statement
PostgreSQL will not run inside a transaction block** — `CREATE DATABASE`,
`CREATE INDEX CONCURRENTLY`, `VACUUM`. Nothing is built for that case now,
because an exemption with no subject is a guess about which of two shapes it
takes: the checker recognising the statement inside the block it is already
reading, or the run step being split so the non-transactional statement stands
in its own invocation. The second needs no code and is available today, which
is why the first is not written ahead of it. Without this paragraph the first
such invocation deletes the rule instead of narrowing it.

## Rejected alternatives

- **A sentence beside the seed block.** The cheapest repair, and ADR 0015 had
  already written that sentence for migrations — the case for it is that the
  reader who copies the run steps is a person, and a person reads. It lost on
  the evidence: the seed block was written in the same commit as that sentence,
  by an author who had just argued for the flag, and still did not carry it.
- **`-v ON_ERROR_STOP=1` as well.** A real gap, and the observed run above
  shows it: `psql` exits 0 after printing two errors, so a run step that
  corrupts the menu reports success. Not taken here because the property this
  record is about is atomicity, which `--single-transaction` delivers on its
  own, and because the exit code matters when something automated reads it. Its
  first subject is the first run step something automated runs; today they are
  read by a person, who sees the errors. Reconsider then.
- **An idempotent seed — `on conflict do nothing`.** It would make re-running
  harmless rather than merely non-destructive, which is a better property than
  the one chosen. It loses twice. `menu_item` has no unique constraint to
  conflict on, so it would need a schema change written to fix a documentation
  defect; and it removes the loud error, which is exactly ADR 0015's argument
  against idempotent migrations, applied to the seed.
- **A `unique (restaurant_id, name)` on `menu_item`.** It would make the
  duplicate impossible at the source rather than at the run step, which is
  where a constraint belongs. Rejected because it is a claim about menus — that
  one restaurant cannot list the same name twice — asserted in order to fix a
  documentation defect. No menu has asked for it, and a restaurant with two
  entries sharing a name is not obviously wrong.
- **A seed file under `services/api/`, applied by the migration loop.** It
  would inherit the flag for free and never drift from it. Rejected because a
  seed is not schema, the README says there is no seed on purpose, and adding
  one is a product decision this change does not need to make.
- **A migration runner.** ADR 0015's trigger has not fired, and it would not
  help: a runner records which migrations a database has had. The seed is not a
  migration and no runner would police it.

## Consequences

The checker reads README.md's shell-tagged fences, so the rule's coverage rests
on a fence's info string. Five are read — `sh`, `bash`, `shell`, `zsh`,
`console` — rather than only `sh`, because nothing enforces the tag and a block
retagged ```` ```bash ```` is a likelier accident than an alternate fence
marker. Bare fences are excluded: they carry output, and a transcript line like
`psql: error: connection refused` would otherwise become a subject.

Widening shrinks that dependency without removing it, and the vacuity contract
does not close the gap. It catches losing *every* subject: retag both
psql-bearing blocks and the rule reports zero subjects and fails. Retag one and
it inspects the other, finds it compliant, and passes — having covered half the
run steps and said nothing. Both directions are asserted in the rule's tests
rather than left as prose here.

Including `console` can produce a false subject from a diagnostic line in a
transcript. That fails loudly, which is the direction to err in, and no guard
against it is written ahead of the first such block.
