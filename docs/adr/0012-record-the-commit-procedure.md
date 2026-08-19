# 0012. Record the commit procedure as a skill, and check its mechanical half after a push

- **Status:** accepted
- **Date:** 2026-08-19

## Context

The procedure for making a change here repeats, and it is two different kinds of
thing wearing one name.

Some of it is judgement. What a declaration must contain before work starts,
what to search the committed records for before locking one, which of two
plausible readings of a rule governs. Prose is the only thing that carries that,
and prose has a known cost in this repository: it cannot be seen failing. A
document can state a rule for a year while the tree quietly disagrees with it,
and nothing goes red.

The rest is mechanical, and today it is done by eye after a push. Three
questions get asked and answered by reading:

- Does the remote hold the revision the push claimed? A push command's exit code
  does not answer this. It reports what the client believed it sent.
- Was that revision's workflow run green for the right reasons? `pnpm verify`
  reports one line per check and CI passes `--require-environment` so that a
  skip is a failure — but the run's *conclusion* collapses all of that to one
  word. A run whose environment-dependent checks skipped reads `success`, which
  is exactly the state ADR 0011's flag exists to make impossible, and exactly
  the state a dropped flag reproduces.
- Do the repository's description and topics say what the change said they
  would? Metadata passes through no gate this repository has. `pnpm verify` has
  never seen it, CI has never seen it, and no file in the tree records what it
  is supposed to be.

The danger in automating the third one is the same danger ADR 0011 names for
skipping: a check can be broken open rather than broken shut. A script that
searches a log for lines it never finds reports no violations and exits 0, and
every check downstream agrees with it.

## Decision

**The procedure is recorded as a skill, `.claude/skills/land-a-change`, and the
part of it a program can perform is a program, `tools/check-push.ts`.**

The skill is the record. The script carries the executable acceptance
conditions, because the commit that introduces a procedure cannot demonstrate a
prose record failing, and a change with no condition that can be seen failing is
the thing this repository's own loop forbids.

The skill states only what is stated nowhere else, and references the rest.
Anything already in `AGENTS.md`, in a record, or in `add-slice` is pointed at
rather than copied: two copies of a rule need a third rule saying which wins,
and that third rule is the cost being avoided.

**The script's expectations arrive as arguments.** The revision, the description
and the topics are passed on the command line, not read from a file in the tree.
A stored copy is a second place for the truth to live, and the declaration a
change is made against is the first.

**It asks the server, and it reads the run's per-check lines.** `git ls-remote`
for the revision, `gh run view --log` for the lines `verify` printed, `gh repo
view` for the metadata. Not the push's exit code, and not the run's conclusion.

**The step names it expects come from `verify.ts`'s own table**, filtered to the
steps that print a verdict line, so a step added there cannot go unchecked here.
Every expected name must be found. An empty log, or a log from a run that
printed nothing recognisable, fails and names each line it went looking for —
which is the guard against the broken-open failure above, and it is driven from
a fixture rather than argued for.

**An absent `gh` is a skip that names it, and `--require-environment` converts
it**, which is ADR 0011's decision applied rather than a second answer invented.
The probe is explicit and runs before the work; it is two probes rather than
one, because "not installed" and "not authenticated" are different things to fix
and would otherwise share one state. The skill's pushing step passes the flag,
so the demand sits beside the provision exactly as it does in `ci.yml`: CI
provisions Postgres and a browser and demands them, and the person running this
procedure provides `gh` and demands it.

The script is not a step of `pnpm verify`. Verify runs before a commit exists;
these three questions cannot be asked until after it has been pushed.

## Rejected alternatives

- **The procedure in `AGENTS.md`, with no skill.** One document, one place to
  look, and it is already loaded in every session. It lost because `AGENTS.md`
  states what this repository *is* — its invariants, its layout, its commands —
  and a checklist for performing a change is a different kind of document. Mixed
  together, a reader looking up an invariant reads a procedure, and the file
  grows in a direction that makes both harder to find.
- **The skill alone, with no script.** Nothing to build, and every rule in one
  place. It lost on the one thing that matters here: a prose record cannot be
  seen failing, so the change would ship with no acceptance condition at all.
- **The script alone, with no skill.** Everything enforceable, nothing
  decorative. It lost because the half that is judgement — what a declaration
  contains, what to search before locking it — would then be recorded nowhere,
  and it is the half that decides whether the mechanical checks are asked the
  right question.
- **A `pre-push` hook that clones and checks.** It would make the confirmation
  impossible to forget, which is the one real weakness of what was chosen. It
  lost on timing rather than on merit: a hook that clones and runs the suite
  decides how long a push takes, and that is its own decision with its own
  record. This is not a rejection on the substance.
- **A CI job that checks the repository's own metadata.** It would run without
  anyone remembering to, and it would be enforced on every push. It lost because
  the check would live inside the thing being checked: a workflow whose flag was
  dropped, or whose job was skipped, takes this check down with it. Metadata
  also changes without any run happening at all, so a run-triggered check cannot
  see the change it most needs to catch.
- **Expected description and topics stored in a repository file and diffed.**
  Its case is strong: the expectation would be version controlled, reviewable in
  the diff, and CI could run the comparison with no arguments to remember. It
  lost because the file would be a second place where the intended metadata is
  written down, and a change that edits the description without editing the file
  — or the file without the description — leaves the two disagreeing with
  nothing to notice. The declaration is where the expectation is stated, and
  passing it in is what makes the declaration executable rather than descriptive.
- **Reading `gh run view --json conclusion` instead of the log.** Cheap, stable,
  and immune to log retention, which the chosen approach is not. It lost because
  a green conclusion is precisely what a run with skipped checks produces, and
  that run is the one this check exists to catch.
- **No `--require-environment`, with a standing rule to read the three lines and
  never the exit code.** One fewer flag, and the lines get read either way. It
  lost because that rule is prose nothing enforces, while the flag is a value:
  without it, a machine with no `gh` prints three skips and exits 0, and a check
  that passes by checking nothing is the failure this whole change is built
  around.

## Consequences

The confirmation is a step someone has to take. Nothing in the repository forces
`pnpm check-push` to be run, and a push that is never checked is indistinguishable
from one that passed. The pre-push hook above is the answer to that, when there
is a decision about what a push may cost.

The check depends on GitHub still holding the run's log. Logs are retained for a
limited period, after which the run can no longer be verified this way. That
state is reported as itself — the log could not be read, carrying what the API
said — rather than as a run that printed nothing recognisable, because the two
are indistinguishable to a matcher and lead a reader to opposite conclusions.

`gh` becomes a dependency of the procedure, though not of the repository.
`pnpm verify` does not need it, CI does not use it, and a contributor without it
is told so by name.

The step names come from `verify.ts`, so a step whose name changes there changes
what a green log must contain. That coupling is deliberate: the alternative is a
second list that drifts, and a check whose expectations have drifted passes
runs it should have failed.
