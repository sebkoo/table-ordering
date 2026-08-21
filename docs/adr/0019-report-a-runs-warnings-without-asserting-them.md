# 0019. Take the action release that ends the Node 20 notice, and report a run's warnings without asserting them

- **Status:** accepted
- **Date:** 2026-08-21

## Context

Every workflow run this repository has produced carried one warning annotation,
and the bump that would end it was deferred each time for the same reason:
nothing here checks action versions, so the change would arrive with no
acceptance condition.

The observations, kept apart from what this project concluded from them.

**The annotation.** On run 32432461939, `annotation_level` `warning`, `path`
`.github`, `start_line` 2, empty title:

> Node.js 20 is deprecated. The following actions target Node.js 20 but are
> being forced to run on Node.js 24: pnpm/action-setup@v4. For more information
> see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

The step's own log line is a different string — `Node 20 is being deprecated.
This workflow is running with Node 24 by default. …` — and is not the
annotation. The annotation's list is an aggregate over every offending action,
so a count of one does not by itself mean one action; this list has one entry.
`actions/checkout@v5` and `actions/setup-node@v5` both declare `using: node24`,
read from their own `action.yml`. And the runner was already forcing the action
onto Node.js 24: only the declared `runs.using` was stale.

**The tags.** `pnpm/action-setup`'s floating `v4` resolves to `b906affc`, which
is `v4.3.0` exactly, declaring `node20`. `v4.4.0`, `v5` and `v5.0.0` all resolve
to `fc06bc1257f339d1d5d8b3a19a8cae5388b55320`, declaring `node24`. The diff
`v4.3.0...v4.4.0` is one commit, `feat!: run the action on Node.js 24 (#205)`,
touching `action.yml` by one line and a devDependency; the release notes for
`v4.4.0` and `v5.0.0` are the same sentence, "Updated the action to use Node.js
24." The floating `v4` tag was never advanced to `v4.4.0`, which shipped
2026-03-13. `v6.0.0` is `feat!: replace bundled pnpm binary with npm + lockfile
bootstrap`, and ten patch releases followed it between 2026-04-17 and
2026-08-03. The action is called here with no `with:` block, and its `inputs`
are identical across `v4`, `v4.4.0` and `v6.0.10` but for one doc-string.

**The count.** `gh run view <id> --json jobs` returns `completedAt`,
`conclusion`, `databaseId`, `name`, `startedAt`, `status` and `url`, and no
annotation count. The count belongs to a check run. On runs 32432461939,
32426186935 and 32416115120, the `databaseId` that call returned for the job is
also the id at which `repos/{owner}/{repo}/check-runs/<id>` answers, carrying
`output.annotations_count`. GitHub does not document that identity.

## Decision

**`ci.yml` pins `pnpm/action-setup@v5`, keeping the floating-major form the
other two steps use.** The number moves and the form does not. An exact tag or a
commit SHA here would put one action of three under a different rule, on a set
where the other two do not comply, which ADR 0004 forbids. That `v4.4.0` and
`v5.0.0` are the same commit is the maintainer closing the v4 line, and `v5` is
where that commit is meant to be found.

**`run-verified` reports how many warning annotations the run carries, and never
asserts that the number is zero.** The line answers one question — did CI verify
this revision — and how many deprecation notices GitHub attached to the run is
not that question. A check that answered both would go red without saying which
of them had gone wrong, and these three lines are worth reading only while each
of them means one thing.

**A count that cannot be read is a violation, and the clause prints even at
zero.** The first because a check that inspected nothing has established
nothing. The second because a clause omitted at zero would put a count that
never arrived on the same branch as a run that really carried none.

**The undocumented job-to-check-run identity is admitted under ADR 0018's own
test, and this is that rule's first subject outside the commit that wrote it.**
The rule asks whether a wrong answer would be silent. A wrong id answers 404,
and the 404 becomes a violation naming it, so the failure is loud rather than a
plausible count nothing produced. Had it instead yielded some other run's count,
the rule would have demanded the seam.

## Rejected alternatives

- **Pin `@v4.4.0`.** The smallest possible move: the same major, and the
  identical tree to `v5.0.0`. It has the merit of recording that the fix existed
  inside the pinned major, which is why no migration was needed. It lost on
  consistency — it makes one of three actions carry an exact pin for a reason
  none of the others has — and that is a rule arriving on a non-compliant set.
- **Pin a full commit SHA.** The only form that cannot be re-pointed or go
  stale, and the form GitHub's own hardening guidance asks for. Its case is
  strong and it is not foreclosed. It lost here for the same reason as the
  above, doubled: introducing SHA pinning for one action grandfathers the other
  two on the day the rule arrives, and pinning all three widens this change past
  the notice it exists to end.
- **Take `@v6`.** The maintained line; `v5` has one release and will get no
  more. It lost on scope. `v6.0.0` replaces the bundled pnpm binary with an
  `npm ci` bootstrap, which is a change to how this repository's toolchain is
  installed, and ending a deprecation does not require it. Ten patch releases in
  the four months after it say the line is still settling. This is judgment, and
  it is not the repository's minimum-release-age invariant applied to a new
  subject: that invariant has no number behind it here — `pnpm config get
  minimumReleaseAge` answers `undefined` — and its remedy is to pin back to an
  older release, which would give `v6.0.9`, not `v5`.
- **Assert that a run carries zero warnings.** It would make the one-to-zero
  permanent rather than merely visible, and it is consistent with how strict
  this file already is: any skipped step is a violation, and a convention run
  that inspected nothing is a violation. It lost because those violations are
  all answers to the question the line asks. This one is not, and a red line
  that could mean either "the push is broken" or "somebody else deprecated
  something" is a line that stops being read.
- **Leave the clause off when the count is zero.** The line would be shorter in
  the ordinary case, which is every case once this commit lands. It lost because
  the shorter line is also what a count that never arrived would print, and two
  states that print the same thing are one state to a reader.
- **Read the count from `repos/{owner}/{repo}/commits/<sha>/check-runs`.** One
  request for the whole revision rather than one per job. It lost because it is
  keyed on the revision and not on the run, and ADR 0018 settled that the run
  reported on is the revision's *newest*: a re-run revision returns check runs
  this line is not about, with nothing in the payload naming which run each came
  from.
- **Bump the action and leave `check-push` alone.** The acceptance condition
  does not need the reporting — the count can be had by hand from `gh`, and step
  zero of this change did exactly that. It lost because the two halves share one
  subject, which is a deprecation notice nobody was obliged to read. Ending this
  one without putting the next one where it will be seen fixes the instance and
  leaves the mechanism.
- **Record this as an invariant line in `AGENTS.md` instead.** Invariants there
  are one-line rules about things in the tree. What this establishes is which
  question a check answers and which it declines, which needs its reasons beside
  it.

## Consequences

Pinning a floating major reproduces the exposure this record is about. A
floating tag going stale is what produced the annotation, and `@v5` can go stale
the same way. That is not an oversight: this change does not prevent the
recurrence, it makes the recurrence visible. The next stale tag arrives in the
three lines read after every push instead of on a page nobody opens, which is
the same reason the count is reported at all.

Because nothing asserts zero, the one-to-zero is read off the line by a person.
`check-push` prints `PASS` whether the count is zero or one, so a bump that
failed to end the notice would show as a number and not as an exit code.

The count costs one request per job. No number of requests is a property of
`check-push`: `ci.yml` declares one job and the loop follows whatever it
declares.

`run-verified` now depends on GitHub keeping a job's id usable as its check
run's id. If that stops being true, every push reports the same violation naming
the 404, which is a loud failure with an obvious cause, and the remedy is to
resolve the check run from the job rather than to assume it.
