---
name: add-slice
description: Use when adding a product behaviour to this repository - defines what a slice is, the steps it must go through, and what may not ride along with it.
---

# Add a slice

A slice is one observable product behaviour, delivered whole.

## Inputs

Do not start until all three are settled.

- **One behaviour.** Stated from the outside, in the language of the product. "A guest can retrieve the menu for their table."
- **One executable acceptance condition.** An automated check, not a sentence. `GET /menu` returns the documented contract, asserted by a test that fails before the change and passes after it. If the condition cannot be executed, it is not an acceptance condition and the slice is not ready.
- **A small change surface.** Usually one or two files and around 200 changed lines. A heuristic, not an invariant: do not split a coherent change to satisfy it.

## Steps

1. **Inspect.** Read the code the behaviour touches before proposing anything. Name the files the change will need.
2. **Plan.** Write down the acceptance condition first, then the change that satisfies it.
3. **Implement.** Vertical slice: `services/api/src/features/<feature>/` holds the routes, the SQL and the tests together. Create directories by putting real files in them.
4. **Verify.** `pnpm verify` passes, and the acceptance condition fails without the change.
5. **Review the diff.** Read every changed line. Anything you cannot justify to the acceptance condition comes out.
6. **Commit.** One commit, subject in lowercase imperative under 50 characters, body only where a decision needs explaining.

## Ride-alongs the slice owns

These are part of the slice, not follow-up work, and land in the same commit:

- A convention rule in `tools/check-conventions.ts`, when the slice creates that rule's first subject.
- A technical invariant in `AGENTS.md`, one line, when the slice creates the subject it governs.
- An architecture decision in `docs/adr/`, when the slice is the first code to depend on that decision. Use the `write-adr` skill.

## Forbidden follow-ups

Do not add, in the same commit or as a companion to it:

- Tooling, scripts or configuration the behaviour does not require.
- A refactor of code the behaviour does not touch.
- An abstraction with one implementation, or a seam for a caller that does not exist.
