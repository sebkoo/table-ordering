# 0011. Report a check whose environment is absent as a skip, and let a flag demand it

- **Status:** accepted
- **Date:** 2026-08-19

## Context

Two of this repository's suites need something the repository does not contain.
`services/api` talks to a real PostgreSQL. `apps/guest` builds the client,
serves it and loads it in Chromium. A clone with neither gets

```
test ............ FAIL
```

with an `ECONNREFUSED`, or a missing-executable error, somewhere inside the
child output the step captured. Neither line is a statement about the code, and
a reader who has just cloned the repository cannot tell from it whether they
forgot `docker` or broke a query.

The vocabulary for this already exists here and is used everywhere else.
`tools/check-conventions.ts` reports three outcomes, not two: a rule that could
not evaluate — because the commit it would inspect does not exist yet — is a
`SKIP` that prints its reason, and `--require-history` turns those skips into
failures for a run that has no business skipping. ADR 0004 records why. The
environment-dependent tests are the one place that vocabulary is not used.

The obvious danger is the reason it was not used. A skip mechanism can skip
everything and exit 0, and a probe that always reported the environment
unreachable would turn the whole suite into a silent no-op that every check
downstream would agree with.

## Decision

**A step whose environment is absent reports `SKIP` and names what is missing.
`--require-environment` turns those skips into failures. CI passes it.**

The environment is probed explicitly, before the step runs — never by catching
what the step throws. A catch cannot tell a database that is not there from a
query that is wrong, which is precisely the confusion this record removes;
reintroducing it inside the fix would undo the change. `compose.yaml` and
`ci.yml` already probe Postgres with `pg_isready` rather than inferring its
health from whatever the workload does. The database probe is a TCP connect to
the address the tests will use; the browser probe launches Chromium and closes
it, because the suite's first act is to start a browser, not to stat one.

A probe is a separate act performed before the work, and its only possible
outcome is a statement about the environment. That is what distinguishes it
from the catch this record rejects — what the catch surrounds, not that a catch
exists.

**The unit of skipping is the vitest project, not `pnpm test`.** `vitest.config.ts`
declares three — `tools`, `api`, `guest` — split by what a suite needs rather
than by what it is about, and `pnpm verify` runs one step per project. A single
`test` step would take a hundred passing tool suites down with the database.

Three things guard the danger named above, and the skip mechanism cannot reach
any of them. The probes are driven, in the project that never skips, against a
socket the test opens and then closes and against a directory where `playwright`
does not resolve, so a probe stuck on "absent" fails as a value diff. The verify
step table is checked against the project list, so a project claimed by no step
fails the same way. And CI runs `pnpm verify --require-environment`, so a probe
broken open turns CI red rather than green.

CI passes the flag explicitly rather than inferring it from `CI=true`, which is
how `check-conventions.ts` learns to demand history. The two are demanded for
different reasons: history is intrinsic to what CI *is* — a clean tree with the
commit already made, true of any job — while the environment is a property of
what *this workflow provisions*, in its `services:` block and its
`playwright install` step. Coupling it to `CI=true` would fail a future job that
provisioned neither, for a rule it never opted into, and would hide the link
from the reader of the workflow. The demand belongs beside the provision.

Verify rejects an argument it does not recognise. Ignoring one silently would
let a typo in `ci.yml` stop demanding the environment that same workflow went to
the trouble of providing, with nothing to see.

## Rejected alternatives

- **Keep failing, as ADR 0010 decided.** Its case is the one above: a failure
  cannot go quietly green, and a skip can. It lost because this repository
  already answers that objection rather than avoiding it — a skip prints its
  reason, and a flag converts it — and because the answer is now load-bearing in
  CI, where the green-everywhere run cannot reach `main`.
- **A `try`/`catch` around the step.** No probe to write, no address to keep in
  step with the suites, and it would cover every dependency at once including
  ones nobody has thought of. It lost because it cannot tell a refused
  connection from a query that is wrong, which is the whole defect.
- **`describe.skipIf` inside the suites.** The knowledge of what a suite needs
  would live beside the suite, which is where it is truest. It lost because
  `pnpm verify` prints one line per step: the skip would be buried in vitest's
  own output while the step line read `PASS` for a suite that ran nothing.
- **Keep `test` as one step.** One step, one line, no project split, and no
  wall-clock cost. It lost because a missing database would then skip the tool
  suites too, and reporting `SKIP` for a hundred checks that could have run is
  the same lie as reporting an absent database as a code failure, pointed the
  other way.
- **Two flags, `--require-database` and `--require-browser`.** A job that
  provisioned only Postgres could demand only Postgres. It lost because
  `--require-history` already converts the skips of two rules with two subjects
  under one flag, and a seam with no caller is a guess about a variation nobody
  has observed.
- **Let `CI=true` imply it.** CI would stay one unadorned command, matching what
  `check-conventions.ts` does. Rejected for the reason given above: the two
  demands come from different facts.
- **`existsSync(chromium.executablePath())` for the browser.** It asks playwright
  where the browser is rather than guessing, and it costs no launch per run. It
  lost because it answers where a file would be, not whether a browser starts,
  and a browser that is installed but cannot start is not a passing environment.
- **Running the three test steps concurrently**, to buy back what the split
  costs. Measured rather than argued, and it measures well: three warm runs of
  10.1s, 10.7s and 10.8s, against 12.6s, 13.6s and 16.2s sequential. That is
  faster than the single run it replaces, so this alternative does not merely
  reduce the cost, it removes it. It lost on two things the number does not
  show. The step lines would stop appearing as each step finished and would
  arrive together at the end, and the per-step times would overlap so that they
  no longer sum to the total the run prints — both of them legibility, which is
  the whole subject of this record. And the measurement comes from a ten-core
  machine; contention already kept it well short of the 9.1s of its slowest
  project, and a four-vCPU CI runner is where three vitest instances would
  contend hardest.

## Consequences

`pnpm verify` costs more when the environment is present. The cost is the
split, not the probes: one `vitest run` over every file took 10.0s, 11.7s and
13.6s across three warm runs on the machine this was written on, while `tools`,
`api` and `guest` run one after another took 12.6s, 13.6s and 16.2s — about two
seconds, because the single run overlapped suites that are now sequential. Full
`pnpm verify` lands between 15.6s and 17.8s. Against ADR 0002's "seconds gets
used, minutes gets skipped", that is still seconds. A clone with no database
skips both steps and finishes faster than either, and says what is missing
where before it reported a failure of the code.

ADR 0010's Consequences paragraph — "Without one it fails rather than skips" —
is overtaken by this record and is **left as written**. That follows the
precedent set when ADR 0004's "ships two rules, and only two" was left standing
after commit 2 shipped four. A record says what was decided when it was decided,
and a reader who wants the current position reads the newest record. ADR 0010 is
not marked superseded: its decision — observe the guest page in a real browser,
provision that browser explicitly — stands in full, and only one sentence about
consequences is overtaken.

ADR 0010 rejected `@playwright/test` partly as "a second command in `pnpm verify`".
That still holds: three invocations of the one runner already configured is not
a second runner, a second reporter or a second thing to configure.

A socket that is listening but is not PostgreSQL still fails rather than skips.
That is deliberate. Only absence is being reclassified, and a misconfiguration
is not an absence.
