---
name: add-slice
description: Use when adding a product behaviour to this repository - defines what a slice is, what it owns, and what may not ride along with it.
---

# Add a slice

A slice is one observable product behaviour, delivered whole.

The procedure for making the change is `land-a-change`. What the repository is
stays in `AGENTS.md` and `docs/adr/`. This skill says only what makes a change a
slice, what the slice owns, and what it must not carry.

## What makes it a slice

- **Stated from the outside, in the language of the product.** "A guest can retrieve the menu for their table." Not "add a route", and not "add a table".
- **Delivered whole.** The routes, the SQL and the tests together under `services/<service>/src/features/<feature>/`, and the client half of the same slice, named the same, under `apps/<app>/src/features/<feature>/`. `AGENTS.md` "Layout" has the rest.

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
