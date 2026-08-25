# 0024. Report what each test file cost, from vitest's junit report, and assert nothing about it

- **Status:** accepted
- **Date:** 2026-08-21

## Context

`pnpm verify` reports one elapsed figure per step. A step that runs a vitest
project reports one figure for the whole project, and that figure is dominated by
what the project costs before it asserts anything.

The gap this leaves is not hypothetical. A change to
`tools/check-commit-message.ts` and its suite was predicted at 2.4–2.6s, refined
to ~2.7s, and its real cost was afterwards bounded at 0.2s or less — a bound
reached by subtracting one step total from another, because nothing in the tree
reported anything smaller than a step.

The observations, kept apart from what this project concluded from them.

**What vitest already produces.** Version 4.1.10 lists thirteen reporters.
Ten of them — `default`, `agent`, `minimal`, `verbose`, `dot`, `tree`, `tap`,
`tap-flat`, `github-actions`, `hanging-process` — render through the logger and
ignore `--outputFile`. Run here, `--reporter=tap --outputFile.tap=<path>` wrote
TAP to stdout and created no file. Three write a file: `blob`, `json` and
`junit`.

**Two of those three carry a per-file duration, and it is not the same
duration.** `json` emits `startTime` and `endTime` per file, computed as the
earliest `result.startTime` of the file's tests and the latest
`startTime + duration` among them. `junit` emits `<testsuite time="…">`, which is
`file.result.duration`. On `services/api/src/features/menu/menu.test.ts`, one
run: `0.085s` from the first, `0.349777042s` from the second. The difference is
transform, import, collection and the file's hooks, which the first excludes.

**`junit` also names the file relative to the repository root**, as
`relative(ctx.config.root, file.filepath)`, and emits a `<testsuite>` for a file
that failed as readily as for one that passed.

**What the figure is stable to.** Two runs back to back on an idle machine agree
within 3–9% on files costing more than a second. A first run after the machine
has been busy does not: `menu.test.ts` read 2.3s cold and 0.3s warm in the same
tree. Across machines the difference is larger still — `test-tools` is 2.2–2.6s
on CI and 28s here. Files run in parallel, so their figures overlap: one run put
11.9s of files inside a `test-guest` step that took 7.8s.

## Decision

**Each test step asks vitest for a junit report and prints a line per file
underneath its own.** The step runs with `--reporter=default --reporter=junit
--outputFile.junit=<temp>`; `default` is named alongside so that a step which
fails still prints a readable failure, and the report goes to a temporary
directory outside the repository that the run removes.

**The figure is the module's own duration.** The alternative reading available
without leaving the built-in reporters excludes module load, which is the cost
that made the original problem invisible, and reads a 0.350s module as 0.085s.

**A per-file line carries a duration and no verdict word.** A duration is a
measurement and a verdict is a judgement. Whether the file passed is already the
step's verdict, so the word would always read `PASS` on a green run, and putting
it there would place a timing inside the machinery that asserts. It is also what
keeps these lines out of `check-push`'s count, which they miss twice over: by the
absent verdict word, and by a name its verdict pattern does not admit. The count
a green run yields is unchanged at twelve.

**Nothing is asserted about a duration. There is no threshold and no budget.**
This is ADR 0019's rule reaching its second subject: the line answers what a file
cost, and a line that could go red either because a test broke or because a
machine was busy is a line that stops being read.

**A step whose per-file report cannot be read fails, though its suite exited 0.**
A check that could not gather its evidence has established nothing, and a report
naming no file at all is that state rather than a run with nothing in it. This is
not a threshold in disguise: no duration is compared with anything, and what
fails is the instrument, not a slow test.

**No total of the per-file figures is printed.** They overlap, so a sum is a
number no clock produced.

## Rejected alternatives

- **`--reporter=tap`.** The closest, and its case is strong. It carries the same
  module duration on a flat, file-level line — `ok 1 - services/api/src/features/menu/menu.test.ts # time=395.12ms {`,
  and `not ok` for a file that failed — its capture is 31 lines against junit's
  45, and unlike junit's it carries no machine value at all. It lost on one
  thing: it cannot be sent to a file, so taking it means either replacing the
  readable failure output or parsing one stream that carries two reporters, both
  writing at column zero. That is what junit's hostname buys.
- **`--reporter=json`.** Writes a file, and its payload is JSON rather than a
  shape that has to be matched. It lost on the quantity: first test to last test
  is not what the file cost, and the 76% it drops on one real file here is
  exactly the part this record exists to expose.
- **`--reporter=blob`.** Writes a file. It is vitest's internal format for
  merging sharded runs, read back only by `--merge-reports`, and carries no
  stability contract for anything else to read.
- **A custom reporter.** It would give the module diagnostics directly and in
  whatever shape was wanted. It lost because the figure is already produced:
  writing one would put a program of this repository's inside vitest's run to
  obtain something a flag already emits.
- **Per-file lines as verdict lines, counted by `check-push`.** It would match
  the convention rules that are already indented under `conventions:` and
  counted, and it would make the count say how many files a run inspected. It
  lost on the first decision above, and on what it costs to implement:
  `check-push`'s verdict pattern admits a name of lowercase letters, digits and
  hyphens, and admitting a path means widening it to accept `/`, `.` and `_` —
  loosening the one pattern that whole check rests on, to buy a printed number
  that nothing asserts.
- **A threshold, or a per-file budget.** It would make a regression fail rather
  than merely appear, which is what every other check here does. It lost to the
  measurements above: a figure that moves 7× between a cold run and a warm one on
  the same tree cannot carry a threshold that is neither meaningless nor flaky.
- **Printing a total of the per-file figures.** A step line and a sum that agreed
  would be easy to read. They do not agree and cannot: the files run in parallel.
- **Per-rule timings for the convention checks.** The same idea one level down.
  The whole block costs 0.10–0.12s, so six rules are about 0.02s each, which is
  below anything the instrument separates from noise.
- **`check-push` printing each step's timing from the log it already reads.**
  Adjacent, and it needs no new source. It is a separate decision about what that
  check's line says, and it is not foreclosed here.

## Consequences

A new way for a run to go red arrives with this, and it has nothing to do with
the code under test. A temporary-directory problem on the runner, or a vitest
release that changes the junit payload's shape, fails a step whose suite passed.
That is the deliberate half of the trade above, and it is recorded in README's
limitations beside the figures it protects.

The figures are worth reading against each other and not on their own. A single
reading is not evidence: warm and cold runs of the same tree differ by more than
most changes will, and two machines differ by an order of magnitude. What the
lines buy is localisation — which file a run spends its time in — rather than
resolution.

**The population this record bounds is not the one a series of runs compares.**
The three figures above are back-to-back runs on an idle machine, a cold run
against a warm one, and one machine against another. Comparing the same file
across *consecutive CI runs of different commits* is a fourth, and nothing here
said anything about it until something depended on it. Measured over three
pushes: a file above a second, untouched between the two runs, moved as much as
**+38%** and as little as **−27%** — both in the `tools` project — while the two
browser files moved at most 7.4% across the same runs. A single figure for "the
instrument" would be wrong in both directions, and a prediction narrower than the
spread for its own project is not refutable.

What survives that spread is a derived quantity rather than any figure. Summing a
project's file lines and subtracting its step total held to ±0.1s across those
same three pushes — because the files and the step move together when the runner
does, and the difference subtracts the common part out. For a project whose files
run concurrently that difference is the shorter file minus a constant, so it is
an identity conditional on the shorter file being unchanged rather than a
constant of the project. Read that way the lines carry a prediction; read as
seconds they carry localisation, which is what this record already said.

`verify` now reads a file that another program wrote. The pattern that reads it
is matched against a subset of the junit payload rather than parsed, which is the
posture `check-conventions.ts` already takes towards the YAML its workflow files
are written in. The failure mode is what makes that acceptable: a payload written
in a shape the pattern cannot read yields no files, and a report naming no file
fails the step rather than printing nothing and passing.

The temporary file is written, read and removed by the part of `verify.ts` no
test reaches. What arguments a step runs with, and what a report says once read,
are both checked; the lines that carry a file between them are not.
