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
  `restaurant` and `restaurant_table` are what a slug and a printed code are
  resolved through, so they carry no policy and on a read of those the scope is
  the query's job. Every other table holding a restaurant's rows is read under a
  policy, and its statements name no restaurant.
- An order is read under the policy it is written under, on a transaction scoped
  from the row this request's one resolve returned -- a printed code's table, a
  staff credential's session. A read that establishes no scope is refused, never
  answered with nothing.
- A write into a table under a policy is scoped by that policy, not by the
  statement. The scope is set once on the transaction, from the row a printed
  code resolved to, and a statement that runs without it is refused rather than
  silently widened or narrowed.
- The application connects as a role the policy applies to: not the owner of the
  tables and not a superuser, both of which PostgreSQL exempts, and a superuser
  even from `FORCE`. Every check that asserts a policy connects the way the
  application does.
- A row naming two of a restaurant's rows names them through one composite
  foreign key, so a child cannot point at a parent in another restaurant while
  every single-column key is satisfied.
- One query per request resolves what the caller holds -- a restaurant's public
  slug, a printed code, a staff credential -- to the restaurant that owns it, and
  it is the only one in that request with no restaurant to scope by. Every query
  after it is scoped by the restaurant it returned, never by anything the caller
  sent.
- A table a credential is resolved through carries no policy, because a policy
  would have to be satisfied before the scope it defines could be known. Its
  rows are tied to their restaurant by a composite foreign key instead, and what
  is written into them comes from the row the resolve returned.
- A secret this repository is given is stored as something derived from it and
  never as itself: a password as a key derivation record carrying the parameters
  it was made with, a session token as a digest. It is compared in constant
  time, and it travels in a header rather than in a path or a query string.
- A secret a page is handed is held in memory for as long as that page is open
  and put nowhere else: not in a URL, a query string, an attribute, a cookie or
  either storage. A browser reads the rendered document, both storages, the
  cookie jar and the address bar, and looks for the value the page really
  carried rather than for one the check minted itself.
- A table is identified by the code printed on it. The code is unique across
  restaurants, is not derived from the table's label, and is not a secret: it is
  printed in public view, so holding it authorises nothing.
- A release too new for pnpm's minimum release age is pinned back to an older
  release. The exclusion list is not used, because an exclusion satisfies the
  install by removing the check.
- A fresh load of a page this repository serves reaches no origin but its own.
  No remote font, script, image, analytics or beacon, and a browser is what says
  so.
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
- A fixture that must show a comparison failing either places its difference
  where a weaker comparison would not look — at the end of a value a truncation
  would cut, inside equal lengths a length check would pass — or makes one value
  a proper prefix of the other, so that a prefix or containment test would call
  the two equal where full equality would not. A pair differing at the first
  character is told apart by every truncation, and so establishes nothing about
  how much of the value was compared.
- A capture framed as history stays as written while only its values have moved.
  When its shape has moved, the label dates nothing a reader can use, and it is
  recaptured or removed.
- A repository check's inputs are the tree and the history. A value only the
  machine can answer for — the operator's git configuration, their environment —
  is not an input, and a check that takes one reports a fact about whoever ran
  it rather than about the repository. Two things are not inputs of this kind: a
  flag the caller passes, which is part of the question, and the identity a
  commit-to-be will carry, which is part of that commit — before the object
  exists there is nowhere else to ask.
- Every `psql` invocation in the run steps carries `--single-transaction`.
  Without it `psql` commits statement by statement, so a batch that fails
  partway leaves behind exactly the statements no constraint stopped, and exits
  0 having said so only on stderr.
- A submission id names one send. A client mints it when it sends, keeps it only
  while that send is unresolved, and retires it when the API answers. It is never
  reused for lines it was not minted for: the write path answers a repeat with
  the first order and writes nothing further, so a reused id is the second order
  going missing rather than an error.
- A view shows a price only from a price the response carried. Nothing joins a
  stored order to the current menu to price it: an order records no price, and
  the menu's price today is the wrong number for an order placed before it moved.
- A value the server owns and a guest reads is restated only where a check
  compares the restatement with the value. `docs/adr/` is outside that: a record
  states what was decided on its date, and a decision that moves is superseded
  rather than rewritten.
- A picture of a page in this repository's documents is a capture: taken from
  the product this repository builds, stored here rather than fetched from
  anywhere else, and captioned with the revision it was taken at.
- A test suite applies the whole migration sequence and never the subset it
  reaches: its list is `services/api/migrations` itself, every `*.up.sql` in order
  and every `*.down.sql` in the reverse. A list a check cannot read is a list that
  is not there, so a suite that applies migrations and carries none it can read is
  named rather than counted as compliant.
- A write that sets one column is granted one column. The application role holds
  `update` on exactly the column the act records and on no other, so a statement
  naming another is refused by the privilege rather than by review, and the
  refusal holds for a statement nobody read.
- A moving picture of the product is produced by a script in this tree and
  published as a release asset, never committed. No video byte enters the tree,
  and the revision it was taken at is the tag it hangs on.

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
  Commits prefix. Lowercase means the whole line and not only its first
  character, which is why an acronym is written `ci` and `http` here. Of those
  four clauses, three are checked and mood is not: imperative is not decidable
  by a program, so it is the one clause a reader holds
  ([ADR 0025](docs/adr/0025-make-the-subject-clauses-executable.md)).
- Body only where a decision needs explaining. Never describe the diff.
- No trailers, with one exception: `Signed-off-by:` carrying the address the
  commit is authored by, and no other. Attribution trailers, session or trace
  URLs, generated-by lines and emoji are rejected, whoever wrote them.
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
