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
- One query resolves a printed code to the restaurant that owns it, and it is
  the only one with no restaurant to scope by. Every query after it is scoped by
  the restaurant it returned, never by anything the caller sent.
- A table is identified by the code printed on it. The code is unique across
  restaurants, is not derived from the table's label, and is not a secret: it is
  printed in public view, so holding it authorises nothing.
- A release too new for pnpm's minimum release age is pinned back to an older
  release. The exclusion list is not used, because an exclusion satisfies the
  install by removing the check.
- A fresh load of the guest page reaches no origin but its own. No remote font,
  script, image, analytics or beacon, and a browser is what says so.
- A dependency a check needs from outside this repository is probed for
  explicitly, before the check runs, and its absence is reported as a skip that
  names it. A `try`/`catch` around the work is not a probe: it cannot tell a
  dependency that is not there from one that is there and broken.
- A browser assertion reads state and compares it. It does not wait for the
  state it expects: a wait that expires reports a timeout, which is what a dead
  server produces too, and names neither.
- A check that reads output another program produced names every line it
  expects and fails when one is absent. Zero matched lines is a failure: a
  pattern that matches nothing reports no violations, and a check that inspected
  nothing has established nothing.

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
5. **Read the whole diff against the declaration** (`.claude/skills/land-a-change`).
   Anything the declaration does not name comes out. Anything it names that
   proved unnecessary is reported as a difference, never dropped in silence.
6. **Commit.**

## Layout

Vertical slices, not layers:
`services/<service>/src/features/<feature>/{routes.ts,sql.ts,*.test.ts}` and
`apps/<app>/src/features/<feature>/`, with tests beside the code they test. A
slice's client half and its server half are the same slice, named the same, in
the two places a workspace package lives.

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
| `pnpm check-push` | What the remote holds, after a push. Not part of `verify`. |
| `docker compose up -d` | PostgreSQL and Redis. |

`pnpm verify` reports `PASS`, `FAIL` or `SKIP` for each check. A `SKIP` means
the check had nothing to evaluate, and it says so on the line. There are two
reasons a check has nothing to evaluate, and they convert under different
flags:

- The commit it would inspect does not exist yet. Pass `--require-history` to
  turn those skips into failures; CI does this by default.
- The dependency it needs is not on this machine. `test-api` needs PostgreSQL
  and `test-guest` needs PostgreSQL and Chromium, each probed for before it
  runs. Pass `--require-environment` to turn those skips into failures; CI
  passes it explicitly, because CI provisions both. Rationale:
  `docs/adr/0011-skip-a-check-whose-environment-is-absent.md`.

An unrecognised argument is rejected rather than ignored.
