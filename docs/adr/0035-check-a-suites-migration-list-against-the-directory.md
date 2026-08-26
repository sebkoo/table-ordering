# 0035. Check a suite's migration list against the directory, by two keys

- **Status:** accepted
- **Date:** 2026-08-26

## Context

A test suite that seeds a database applies the migrations by name, from a list it
carries. [ADR 0033](0033-read-the-menu-under-a-policy.md) settled what that list
should be and left nothing running it:

> **A test suite's migration list is the full prefix**, `0001` through the newest.

It also said why the older rule stopped working. `b895e42` chose each list by which
files its suite reached, which was serviceable while every migration was a
`create` — `0004` creates tables four of the suites never touch, so excluding it
changed nothing they could observe. `0005` is an `alter` of a table most of them
join, and an omission there is silent: the suite passes against a schema that
exists nowhere.

That record deferred the program to a named trigger:

> **A convention rule enforcing the full-prefix rule now.** It would have seven
> subjects today and would fail before this change and pass after — the shape
> ADR 0004 asks for. Rejected as a second behaviour in one commit. Its trigger is
> named instead: **the next migration**, `0006`, which is the first chance for the
> rule to be broken by a new list rather than by an old one.

[ADR 0034](0034-clear-a-ticket-by-recording-when-it-was-served.md) landed `0006`,
found the count wrong, and replaced the condition with a commit:

> `0006` is this migration. The rule is still not here, and the successor is a
> commit rather than a condition: **it is the next commit.** A condition can be
> argued with; "the next commit" can only be kept or visibly broken.

This is that commit.

**What the tree carries.** Read, not carried forward. Ten lists, in seven files:

| file | constant | direction |
| --- | --- | --- |
| `apps/guest/src/features/menu/menu.browser.test.ts` | `MIGRATIONS` | up |
| `apps/guest/src/features/order/order.browser.test.ts` | `MIGRATIONS` | up |
| `apps/staff/src/features/staff/staff.browser.test.ts` | `MIGRATIONS` | up |
| `services/api/src/features/menu/menu.test.ts` | `MIGRATION_FILES`, `DOWN_FILES` | up, down |
| `services/api/src/features/order/order.test.ts` | `MIGRATION_FILES`, `DOWN_FILES` | up, down |
| `services/api/src/features/staff/board.test.ts` | `MIGRATION_FILES` | up |
| `services/api/src/features/staff/staff.test.ts` | `MIGRATION_FILES`, `DOWN_FILES` | up, down |

Seven up and three down. Every up list is `0001`–`0006` ascending and every down
list is `0006`–`0001` descending, which is what a down sequence has to be: a drop
runs newest first or it runs into its own dependants.

**Three things vary across the ten, and each of them defeats a different reader.**
The constant is written under three names. The closer is written two ways — four
up lists and all three down lists close with a bare `]`, and the three browser
lists close `].map((name) => join(ROOT, 'services', 'api', 'migrations', name))`.
The indent is written two ways, top level and inside a `describe`.

That is not hypothetical. The first census taken for this record keyed the closer on
a bracket alone on its line, found **seven of ten**, and reported no difficulty —
the same shape of silence the rule exists to end, one level up.

**One duration in these files is not a list.** `menu.test.ts` applies
`0005-scope-the-menu-read.down.sql` and then its `.up.sql` by name inside a
condition, to show a policy going away and coming back. A reader scanning for
migration filenames rather than for array literals takes those two as subjects.

## Decision

**A convention rule, `migration-list-full-prefix`, reads every migration list a
feature suite declares and requires each to be the whole of
`services/api/migrations`: the `.up.sql` files ascending, the `.down.sql` files
descending.** Eighth rule; ten subjects; `expectsSubjects: true`.

**It compares with the directory and never with a number.** A count written into
the checker is a second place for the sequence to be true, and the two drift the
moment one of them is edited — which is the drift this rule exists to remove, so
it must not introduce it. The directory is the authority, named once, the way
`open-window-restated` names the file that owns the window.

**Order, and not membership.** A set comparison calls a list that runs `0003`
before `0002` whole. Order is what a migration sequence is, and the two directions
are separate assertions: a down list written in the directory's own order is
wrong, and nothing else in the tree would say so.

**Two selectors, keyed on different things.** A *list* is an array literal every
element of which is a migration filename — content-keyed, so it survives all three
of the shapes above. A *file* is a feature test file carrying the string literal
`'migrations'`, which is how all seven build the directory path and the only such
literal in each. A file that applies migrations and yields no list is itself a
violation, so a list that is renamed, reshaped or emptied does not simply stop
being a subject.

**The census is pinned by two instruments with opposite blindness, and neither
compares itself against the other.** One condition runs the rule's own collector
over this repository and names the ten sites. A second parses no array structure at
all: it takes the directory's two endpoints and counts, per file, the lines whose
whole content is that head element. A collector blind to a shape reddens the first
and leaves the second green; a head element moved onto its opener line does the
reverse. Folding the two into one condition that compared them would make that
difference unobservable, and a cross-check is only worth what its second instrument
is worth.

**A third condition asserts what the rule says about this tree** — `pass`, ten
subjects, no violations. It is the first condition in this repository whose verdict
follows the repository's own rule outcomes, and it is what makes a file losing its
only list move a verdict inside the suite rather than only in a live run.

**The census holds today's tree; the invariant in `AGENTS.md` holds tomorrow's
writers.** That is the division the capture invariant already uses. A program
compares what exists; a written invariant governs the shape somebody writes next,
where no program reaches.

## Rejected alternatives

- **A recorded count of the migrations, compared against each list's length.**
  Trivial to write and it catches the case that produced this rule — a list left
  behind by a new migration. Rejected because the number is then maintained in a
  ninth place, and a rule whose authority is a hand-edited constant fails in
  exactly the way the lists do. The directory costs one `readdir`.
- **Policing the seven up lists only.** It is what ADR 0033 counted and it covers
  the case that has actually gone wrong. Rejected on the residue ADR 0034
  measured: "The down lists themselves are held by nothing: removing `0006.down`
  on its own reddens nothing, because `0003`'s down drops the table the column
  hangs on." A rule that polices seven of ten re-creates the silence it closes,
  and the three it would skip are the three nothing else holds.
- **The list selector alone, with partial loss recorded as a limit.** It is the
  posture ADR 0016 takes toward a retagged fence and ADR 0028 toward a restatement
  in a new file, and it is the smaller rule. Rejected because those two limits are
  about subjects a rule never had; this one would be about a subject the rule had
  and lost, and a rule that polices silent loss cannot be the one that loses
  silently. The second selector costs a `String.includes`.
- **`expectsSubjects: false`, leaving the bootstrap fixture untouched.** It saves
  editing a fixture that has nothing to do with this rule. Rejected because ADR
  0004 defends `expectsSubjects` as the guard against a selector that matches
  nothing, and this is the rule least able to do without it. The fixture gains a
  suite carrying a list instead, which complies by construction.
- **One census condition comparing the two instruments with each other.** It reads
  as the stronger assertion and it is one condition rather than two. Rejected
  because it makes the instruments agree by construction: a collector that goes
  blind and a finder that does not would red the same single condition, and which
  of them moved would be unreadable. Separately asserted, the pair says which.
- **Deriving each suite's list at run time from `readdirSync`.** No list to keep
  right, and no rule needed. Rejected because a suite would then apply whatever is
  on disk, including a migration written after the suite's assertions were, and
  the failure would arrive inside a seeding hook rather than as a difference
  between two values. It also removes the list a reader uses to see what schema a
  suite is written against.
- **A shared helper exporting one list for every suite to import.** The same
  removal-instead-of-checking, and the seven copies really are identical today.
  Rejected because `apps/*` and `services/api` are separate workspaces with no
  package between them, so the helper is a workspace, a build and a version for
  one array — the seam ADR 0004 refuses ahead of its first implementation.
- **Parsing the suites with TypeScript's own parser rather than by line.** Exact,
  and blind to none of the three shapes. Rejected because it puts a compiler API
  inside a checker that runs before anything is built, for one rule; it is the
  posture `readWorkflowJobs` already takes toward YAML and `readFileReport` toward
  junit. What makes it acceptable is that the failure is loud: a list written in a
  shape this cannot read makes its file a violation under the second selector.
- **Reading every `*.test.ts` in the workspace rather than the feature
  directories.** It would reach a list moved to a helper outside a slice.
  Rejected because `readFeatures` already decides where a slice's tests live, and
  a second answer to that question is a second thing to keep in step.

## Consequences

**A list left behind by a new migration is a difference between two values**,
naming the file, the line and the constant, with what it declares beside what the
directory holds.

**A file that applies migrations and carries no readable list is named**, so the
collector cannot lose a subject without saying so.

**A file that loses one of two lists is invisible to the rule**, because the second
selector is satisfied by the other list. That gap is what the two census conditions
cover, and it is the reason they are conditions rather than an argument: deleting a
down list leaves the rule passing at nine subjects and reddens both censuses.

**A list written outside a feature directory, or built from a path that does not
carry the literal `'migrations'`, is invisible.** Both are recorded here and in
README rather than hidden, in the posture ADR 0016 and ADR 0028 already take.

**The authority is one service's directory.** `services/api` is the only service
with migrations. A second service's would be outside this rule, and what widens it
is that second directory rather than a prediction about it.

**An emptied list stops being a subject.** The collector does not admit an empty
array, so a list emptied in place is a list the rule stops seeing — caught by the
census conditions and not by the rule.

**`verify` prints sixteen verdict lines where it printed fifteen**, and reports
`8 checks` where it reported seven.
