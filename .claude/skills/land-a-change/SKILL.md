---
name: land-a-change
description: Use when making and pushing a change to this repository - what to declare before touching anything, the order the work runs in, and how a push is confirmed afterwards.
---

# Land a change

This is the procedure for making a change. It is not a second specification:
what this repository *is* stays in `AGENTS.md` and `docs/adr/`, and is
referenced here rather than copied, because two copies of a rule need a third
rule saying which one wins.

So read `AGENTS.md` first. Its loop, its invariants, its change-size heuristic
and its commit rules govern everything below. For a product behaviour,
`add-slice` says what the slice owns; for a decision, `write-adr`.

## What a declaration contains

Write it before touching anything, and treat approving it as the lock.

1. **One behaviour**, stated as what becomes true.
2. **Its executable acceptance conditions**, each with the failure it produces.
   The failure is a value diff: two values that differ, printed side by side. A
   timeout is not one, and neither is the harness failing to start — both are
   also what a dead dependency produces, and they name nothing.
3. **The file surface**, exact paths. A path whose inclusion depends on
   something not yet known is declared conditional, with both branches named and
   the observation that decides between them stated.
4. **The metadata surface** — the repository description and topics — stated
   even when nothing changes, with the reason. Metadata passes through no gate
   this repository has, so a declaration is the only thing that holds it.
5. **The predicted check output**: per-check verdicts, subject counts, and every
   place in the tree that asserts one of those numbers or strings.
6. **The records due**: any decision the committed records schedule at a subject
   this change creates.

## Before locking, search

- The committed records, for scheduling language — "lands with", "with the
  first", "reconsider", "until there is". List what this change makes due.
- Every place asserting the quantity, name or claim being changed.

## While working

- An acceptance condition is not load-bearing until it has been observed
  discriminating. Break the thing it names, watch that condition and only that
  condition go red, put it back.
- A test uses inputs the collector can actually produce. A fixture tidied up by
  hand will pass a parser that cannot read the real thing.
- An export with no consumer comes out.

## After approval, in order

1. The working tree shows nothing outside the declared surface.
2. The path count is reported against the declaration, and every difference is
   stated in both directions rather than absorbed — a path that joined, and a
   path that was declared and proved unnecessary.
3. The checks pass, and match the prediction. A difference from the prediction
   is reported whether or not the checks are green.
4. A fresh sibling clone installs, checks, and runs the differential
   commit-message hook probe: a message the policy rejects is rejected there,
   and a clean one is accepted.
5. The whole diff is read against the declaration, as `AGENTS.md` step 5 says.
   Obligations the declaration names stay: "does an acceptance condition need
   this" is not the test, or the records and invariants a change owes get read
   as slack and deleted.
6. Immediately before `git commit`, `date -u +%F` is compared with `README.md`'s
   status line, which carries the UTC date of the commit about to be made. A
   mismatch is fixed in the working tree — never by amending afterwards, because
   an amend rewrites a commit the hook has already accepted.
7. Commit. The hook runs; a rejection stops the run and the message is fixed.

## Pushing

Approval for the push is asked separately, and is never assumed from approval of
the change.

1. Push.
2. Wait for the workflow run to reach `completed`. Immediately after a push it is
   `in_progress`, and a check run then reports that status instead of an answer.
3. Confirm by asking the server, never by reading the push command's exit code:

   ```sh
   pnpm check-push --revision <sha> \
     --description "<the declared description>" \
     --topics <the declared topics> \
     --require-environment
   ```

   Pass the flag. Without it, a machine with no `gh` prints skips and exits 0 —
   a check that passed by checking nothing.
4. Read its three lines, not only its exit code: they name what happened. The
   third confirms the metadata against the declaration, including when the
   declaration said nothing changes.
5. Read the workflow run for its per-check lines too, not only its conclusion. A
   run whose environment-dependent checks skipped is green and wrong.
6. Nothing is amended after a push.
