# Working in this repository

## What this is

Table-side ordering for restaurants, self-hosted. The interesting problem is
not displaying a menu. It is making a guest's order survive retries,
disconnects and concurrent kitchen updates, on a platform that takes no
percentage of card volume — the platform's own pricing, not a claim about what
the restaurant pays, since the restaurant still pays its own card processor.

The product preserves what people value in a paper menu: fast, shared,
anonymous, and needing no app download. It adds the two things paper cannot
do — send the order to the kitchen, and make the order operationally visible.

Payment is deliberately absent from that sentence. The positioning is
payment-neutral, and payment integration is an optional later addition rather
than part of the core promise.

Do not promise that ordering works without a network. The guest client talks
to a server. When offline work is built, offline browsing and offline order
submission are separate problems and are treated separately.

## Invariants

Technical invariants are recorded here one line at a time, each in the commit
that creates the thing it governs.

- Money is an integer count of the currency's minor unit, carried with its ISO
  4217 code. Never a float, never a decimal string, in the schema or on the
  wire.
- A restaurant's rows are read only through a query scoped to that restaurant.
  Row-level security is not in place, so the scope is the query's job.
- A release too new for pnpm's minimum release age is pinned back to an older
  release. The exclusion list is not used, because an exclusion satisfies the
  install by removing the check.

## Change size

> A normal change is one behaviour with one observable, executable acceptance
> condition. Prefer a small change surface: usually one or two files and around
> 200 changed lines or fewer. These are heuristics, not invariants. Do not
> split a coherent change solely to satisfy them, and do not treat file count
> as the goal. Rationale and sources: `docs/adr/0006-keep-changes-small.md`.
>
> The bootstrap commit is the exception: it establishes repository mechanics
> and spans the bootstrap file set, because a toolchain cannot be introduced
> one file at a time.

## The loop

1. **Read** the code the change touches before proposing anything.
2. **Write the acceptance condition first**, as an automated check that fails
   before the change and passes after it. A sentence is not an acceptance
   condition.
3. **Implement** the smallest change that satisfies it.
4. **Verify** with `pnpm verify`.
5. **Read the whole diff.** Remove anything the acceptance condition does not
   need.
6. **Commit.**

## Layout

Vertical slices, not layers:
`services/api/src/features/<feature>/{routes.ts,sql.ts,*.test.ts}`, with tests
beside the code they test.

Directories come into existence when a real file is put in them. Do not
reserve a directory ahead of the file that belongs in it, and do not add a
placeholder to hold one open.

Do not build an abstraction before its first implementation. A seam with one
caller, or with none, is a guess about a variation nobody has observed.

## Commits

- One commit per change.
- Subject line: lowercase, imperative, under 50 characters. No Conventional
  Commits prefix.
- Body only where a decision needs explaining. Never describe the diff.
- No trailers, with one exception: `Signed-off-by:` carrying the committer's
  configured email address. Attribution trailers, session or trace URLs,
  generated-by lines and emoji are rejected, whoever wrote them.
- The `commit-msg` hook enforces this on the way in, and `pnpm verify` checks
  the whole history. Never bypass either. If the hook rejects a message, fix
  the message.

## Decisions

Architecture decisions go in `docs/adr/`, written from
`docs/adr/0000-template.md`, one file per decision, each with a populated
"Rejected alternatives" section.

Write the record in the commit that first introduces the decision's subject,
not ahead of it.

## Commands

| Command | What it runs |
| --- | --- |
| `pnpm verify` | Everything below, in one pass, with a result per check. |
| `pnpm typecheck` | `tsc --noEmit` across the workspace. |
| `pnpm lint` | Biome, formatting and lint rules. |
| `pnpm test` | Vitest. |
| `pnpm conventions` | The repository convention checks alone. |
| `docker compose up -d` | PostgreSQL and Redis. |

`pnpm verify` reports `PASS`, `FAIL` or `SKIP` for each check. A `SKIP` means
the check had nothing to evaluate — commonly that the commit it would inspect
does not exist yet — and it says so on the line. Pass `--require-history` to
turn those skips into failures; CI does this by default.
