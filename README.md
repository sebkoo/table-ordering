# Table-side ordering for restaurants

Self-hosted table-side ordering for restaurants, built in the open under AGPL-3.0.

[![CI](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml/badge.svg)](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-brightgreen.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue.svg)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-orange.svg)](pnpm-workspace.yaml)

**Status:** 2026-08-22 · a guest sends their order from the page, and a send
repeated across a reload is still one order.

## What happens at the table

### Today

The API serves a restaurant's menu:

```
GET /restaurants/blue-door/menu
```

```json
{
  "restaurant": { "slug": "blue-door", "name": "The Blue Door" },
  "items": [
    { "id": "8f14e45f-ceea-467a-9f0b-2c2e0a3f7c31", "name": "Flat white", "priceMinor": 300, "currency": "GBP" },
    { "id": "c9f0f895-fb98-4b3f-a4d4-7f0a1f1a2b3c", "name": "Cinnamon bun", "priceMinor": 450, "currency": "GBP" }
  ]
}
```

Each item carries an id, because an order has to name a line by something and a
name is not unique within a restaurant. It identifies a row and authorises
nothing.

Items the restaurant has marked unavailable are left out, and the rest come
back in the order the restaurant chose. Prices are an integer count of the
currency's minor unit: 300 GBP is three pounds.

A slug no restaurant uses is answered `404`. A restaurant whose items are all
unavailable is answered `200` with an empty list — a guest sitting in a real
restaurant that has sold out is not a guest at a restaurant that does not
exist.

Each table carries its own code, and that code is the whole of the address a
card prints:

```
GET /tables/9f3c1a7b20de/menu
```

```json
{
  "restaurant": { "slug": "blue-door", "name": "The Blue Door" },
  "table": { "label": "Table 7" },
  "items": [
    { "id": "8f14e45f-ceea-467a-9f0b-2c2e0a3f7c31", "name": "Flat white", "priceMinor": 300, "currency": "GBP" }
  ]
}
```

The code names one table, the table names one restaurant, and the menu follows
from that — so a guest never types a restaurant's name and the card never
carries one. It is opaque rather than `blue-door/7` because a printed code
cannot be revised: a rename would kill every card in the building, and a
number anyone can count to is an address anyone can construct, which costs
nothing today and costs someone else's order once a code says where the food
goes. It is not a secret, though. It is printed on a table in a public room,
and holding it authorises nothing.

That table can also be ordered at:

```
POST /tables/9f3c1a7b20de/orders

{
  "submissionId": "6c2e1b40-9f3a-4d2e-8a1b-5f7c9e0d3a24",
  "lines": [{ "menuItemId": "8f14e45f-ceea-467a-9f0b-2c2e0a3f7c31", "quantity": 2 }]
}
```

```json
{ "order": { "id": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" } }
```

The submission id is minted by whoever is sending, and it is what makes a resend
one order rather than two: send it again from a flaky connection or a second tab
and the answer is the same `201` with the same order id, and nothing further is
written. Send the same submission id at a *different* table and it is refused
`409` — that is a collision, not a retry, and answering it would hand a guest at
one table a confirmation for food going to another.

A line naming an item that is not on that restaurant's menu is refused `422` and
nothing at all is written, not even the lines that were fine. A code no table
uses is `404`, as it is for the menu.

A guest opens `/t/9f3c1a7b20de` on their phone and gets that menu as a page:

```
The Blue Door
Table 7

Flat white                                        £3.00      [ 2 ]
Cinnamon bun                                      £4.50      [ 0 ]

                 [ Send to the kitchen ]
```

`/r/blue-door` still answers with the same menu and no table, for a restaurant
that wants to put its menu on a link.

A fresh load of that page asks for nothing but its own origin. No font, script,
image, analytics or beacon from anywhere else — and what says so is not a
promise in this file, it is a browser test that loads the built page and
inspects every request it made.

**The page sends it.** A guest raises the quantity on the rows they want and
sends, and what leaves the page is exactly the request above. The submission id
is the page's: minted when the guest sends, kept in `sessionStorage` under that
table's code while the send is unresolved, and retired the moment the API
answers. So a guest who reloads because they are not sure it went through sends
the *same* submission again rather than a second one, and a guest who orders a
second round gets a second order
([ADR 0023](docs/adr/0023-mint-a-submission-id-per-send.md)).

A send the network refuses says so and offers to try the same submission again.
A send the API refuses — an item that came off the menu while the guest was
choosing — says the menu may have changed and leaves the page orderable, because
nothing was written.

Nothing is written when a guest *arrives*, either. A table is a row in the
schema, not a record of anyone's visit, and there is still no sitting: what
groups an order is the table it was placed at and the time it was placed.

An address the page cannot serve says which kind it is. A code no table uses,
and a code the address cannot hold at all, both send the guest to a member of
staff — asking again will not help either one. A menu that cannot be fetched
says to try again instead.

### Next

1. The kitchen will see the ticket. A kitchen client that drops off the network
   will be able to reconnect and pick up where it left off.
2. Staff will be able to see what each table has ordered and what is still open.
3. The read path will move under the policy too, so that a menu query stops
   carrying its own scope.

## How a menu request is served

```
  the page on a guest's phone   apps/guest/src/features/menu/menu.tsx
        │   GET /tables/9f3c1a7b20de/menu   (or /restaurants/blue-door/menu)
        ▼
  Fastify route ─────────────  services/api/src/features/menu/routes.ts
        │   the code is validated against the route's JSON Schema
        ▼   a pattern it fails → 400, which is not the same answer as 404
  one SQL query ─────────────  services/api/src/features/menu/sql.ts
        │   restaurant_table JOIN restaurant, LEFT JOIN the available items
        ▼   the code finds the restaurant; every join after it is scoped by it
  PostgreSQL ────────────────  services/api/migrations/*.up.sql
        │   no rows → 404 · rows → the menu, serialised through the
        ▼   response schema, so only the fields it names can escape
  the page on a guest's phone
```

The page asks for the menu at a relative path, so it reaches the API on the
origin that served the page. In development the guest dev server proxies
`/tables` and `/restaurants` across; the acceptance test does the same against
an API it starts itself. Nothing deploys this yet, so nothing else does it in
production.

The response schema is the contract rather than a description of one. A column
that starts coming back from the query cannot reach a guest unless the schema
names it.

## How an order is taken

The guest's page sends this. What takes it is one transaction, and what makes it
safe is that no statement in it carries a restaurant of its own.

```
  the guest's page         POST /tables/9f3c1a7b20de/orders
        │                  { submissionId, lines: [{ menuItemId, quantity }] }
        ▼
  Fastify route ─────────  services/api/src/features/order/routes.ts
        │   the body is validated against the route's JSON Schema
        ▼   a shape it rejects → 400, before a connection is taken
  one transaction ───────  services/api/src/features/order/sql.ts
        │   the code resolves to a restaurant and a table — the one unscoped
        │   read, and the only statement here with no restaurant to scope by
        ▼   set_config('app.restaurant_id', that restaurant, local)
  the policies ──────────  services/api/migrations/0003-*.up.sql
        │   every statement after it is checked against that restaurant, by
        │   table_order_scope and table_order_line_scope rather than by a
        ▼   where clause anyone could forget
  PostgreSQL
        │   a row outside the scope is refused, not filtered · a line naming
        ▼   another restaurant's item fails a composite key → 422
  201 { order: { id } }
```

The application connects as `table_ordering_app`, which owns nothing and is not
a superuser. That is not a detail: PostgreSQL exempts a table's owner from its
own policies and exempts a superuser from them unconditionally, so a process
connected as the role that ran the migrations would write orders with every
policy in the schema enforcing nothing, and every test would still pass
([ADR 0020](docs/adr/0020-scope-a-write-with-row-level-security.md)).

A statement that establishes no scope at all is refused rather than quietly
narrowed: `current_setting` raises on a connection that has never carried the
setting, and the empty string it reverts to afterwards fails the `::uuid` cast.

## Why

Every table-ordering product I looked at wanted a percentage of card volume, a
tablet on every table, or both — and most of what they were charging for was a
menu on a screen. The menu is not the hard part. The hard part is making one
guest's order survive a retry, a dropped signal, and a kitchen screen that
somebody else is updating at the same moment. That is worth building carefully,
and it is worth being able to run yourself.

## Roadmap

The rows marked Done are what exists. Everything else is planned, and none of
it is started.

| Step | State |
| --- | --- |
| Toolchain, convention checks, CI | Done |
| Tenant schema | Done |
| Guest menu, over HTTP | Done |
| A page the guest's phone loads | Done |
| A table's own code, on the guest's page | Done |
| Order submission over HTTP, tolerating retries | Done |
| Row-level security on a write, so scope is not the query's job | Done |
| The guest's page sends the order | Done |
| Row-level security on a read, so a menu query drops its scope too | Planned |
| Kitchen board | Planned |
| Payment, as an option rather than a requirement | Planned |

## Run it

Requires Node 24 (see `.nvmrc`), pnpm, and Docker for PostgreSQL.

```sh
git clone https://github.com/sebkoo/table-ordering.git
cd table-ordering
pnpm install
docker compose up -d
```

PostgreSQL is published on host port 55432 rather than 5432, so that it comes
up beside whatever PostgreSQL you already run. If 55432 is taken, change it in
`compose.yaml` and set `DATABASE_URL` to match.

Create the schema. There is no migration runner yet, so this is `psql` reading
each migration in turn, on a database that has had none of them —
re-applying one raises `relation already exists`, and nothing is applied —
the loud failure the absence of a runner rests on. `--single-transaction` is
not optional: without it `psql` commits each statement as it goes, and a file
that failed halfway would leave the half behind
([ADR 0015](docs/adr/0015-apply-the-second-migration-by-hand.md)):

```sh
for m in services/api/migrations/*.up.sql; do
  docker compose exec -T postgres \
    psql -U table_ordering -d table_ordering --single-transaction < "$m"
done
```

Give it a restaurant to serve, and a table to sit at. There is no admin route
yet either. The code is the address the table's card will carry, so mint it
rather than choose it — `openssl rand -hex 6` produced the one below — and do
not name the table in it.

The flag is not optional here either, and it buys more than it does above.
`restaurant` and `restaurant_table` each carry a unique constraint that stops a
second run; `menu_item` carries none. Without `--single-transaction` a repeated
run therefore leaves the item behind on its own, duplicated, while the two
inserts around it fail — and `psql` exits 0 having reported the failures on
stderr and nothing about what it kept:

```sh
docker compose exec -T postgres \
  psql -U table_ordering -d table_ordering --single-transaction <<'SQL'
insert into restaurant (slug, name) values ('blue-door', 'The Blue Door');
insert into menu_item (restaurant_id, name, price_minor, currency, sort_order)
select id, 'Flat white', 300, 'GBP', 10 from restaurant where slug = 'blue-door';
insert into restaurant_table (restaurant_id, code, label)
select id, '9f3c1a7b20de', 'Table 7' from restaurant where slug = 'blue-door';
SQL
```

Then start the API and ask it for that table's menu:

```sh
pnpm dev
curl -s localhost:3000/tables/9f3c1a7b20de/menu
```

```json
{"restaurant":{"slug":"blue-door","name":"The Blue Door"},"table":{"label":"Table 7"},"items":[{"id":"8f14e45f-ceea-467a-9f0b-2c2e0a3f7c31","name":"Flat white","priceMinor":300,"currency":"GBP"}]}
```

The API connects as `table_ordering_app`, not as `table_ordering`. The migration
above creates that role and grants it `usage` on the schema, which is why there
is no step here for it. Against a schema that predates that migration the
connection still succeeds and the query does not: with no `usage`, the schema
drops out of the role's `search_path` and PostgreSQL answers `relation
"restaurant" does not exist`, which reads like a missing table and is a missing
grant.

Order from that menu, taking the item's id out of what it just answered and
minting a submission id the same way the table's code was minted:

```sh
item=$(curl -s localhost:3000/tables/9f3c1a7b20de/menu | sed 's/.*"items":\[{"id":"\([^"]*\)".*/\1/')
submission=$(uuidgen | tr 'A-Z' 'a-z')

curl -s -X POST localhost:3000/tables/9f3c1a7b20de/orders \
  -H 'content-type: application/json' \
  -d "{\"submissionId\":\"$submission\",\"lines\":[{\"menuItemId\":\"$item\",\"quantity\":2}]}"
```

```json
{"order":{"id":"1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"}}
```

Run that second command again with the same `$submission` and it answers the
same id, and the order is still one order with one line. Change
`9f3c1a7b20de` to another table's code while keeping `$submission` and it
answers `409`.

The page a guest opens is a second process in development:

```sh
pnpm dev        # the API, on port 3000
pnpm dev:guest  # the page, on port 5173
```

Then open `http://localhost:5173/t/9f3c1a7b20de`, which is what the card on that
table would point at. `http://localhost:5173/r/blue-door` gives the same menu
with no table. The page asks for the menu at a relative path, and the guest dev
server proxies `/tables` and `/restaurants` to the API, so the two are on one
origin.

Raise a quantity on a row and send. That is the same request as the `curl`
above, under a submission id the page minted for it.

Everything the repository checks runs in one command:

```sh
pnpm verify
```

It drives a real browser as well as a real database. Install the one the
lockfile pins, once per machine:

```sh
pnpm --filter @table-ordering/guest exec playwright install chromium
```

`pnpm install` does one thing beyond fetching dependencies: it points git at
this repository's hooks by setting `core.hooksPath` to `.githooks` in your
clone. That is a change to your local git configuration, and it is what makes
the commit message check active without any manual setup step. Installing with
`--ignore-scripts` skips it, and the hook then does nothing.

`pnpm verify` reports `PASS`, `FAIL` or `SKIP` per check. A `SKIP` means the
check had nothing to evaluate, and it says so on its own line — either because
the commit it would inspect does not exist yet, or because the dependency it
needs is not on this machine.

Two of the checks need something this repository does not contain. `test-api`
talks to a real PostgreSQL. `test-guest` builds the client, serves it and loads
it in Chromium. Each is probed for before it runs, so a clone with no Docker
gets

```
test-api ......... SKIP  nothing is listening at 127.0.0.1:55432
```

rather than a failure that reads as though the code is broken. The tool suites
have no such dependency and run either way. Pass `--require-environment` to turn
those skips into failures — CI does, because CI provisions both, and a skip
there would mean the provisioning silently stopped working.

Each test step also says what each of its files cost:

```
test-api ......... PASS  1.2s
  services/api/src/features/menu/menu.test.ts .... 0.3s
  services/api/src/features/order/order.test.ts .. 0.4s
```

so a change that made a run slower can be attributed to the file it landed in,
rather than to a step total that a startup cost dominates. The figure is the
module's own — its collection and its hooks as well as its assertions — read
from the report vitest is asked to write beside its readable output.

Nothing fails because one of those numbers moved. There is no threshold and no
budget: a duration that can fail a build is a flaky build, and the line is worth
reading only while it means one thing
([ADR 0024](docs/adr/0024-report-what-each-test-file-cost.md)).

Everything above runs before a commit exists. What the remote holds *after* a
push is a separate question, and `pnpm check-push` asks it:

```sh
pnpm check-push --revision "$(git rev-parse HEAD)" \
  --description "Self-hosted table-side ordering for restaurants. ..." \
  --topics docker,fastify,github-actions,monorepo,pnpm,postgresql,react,rest-api,typescript,vite,vitest \
  --require-environment
```

Run against the push of `6064402`, it printed:

```
push-arrived ....... PASS  origin holds 60644025ad99c59c5d90bd8bc8309216f0b148c0
run-verified ....... PASS  run 32432461939, 12 verdict lines, all PASS, verify: 10.1s in 47s of jobs, 1 warning
metadata-declared .. PASS  the description and 11 topics are as declared
check-push: PASS
```

Each line answers a question the obvious source answers wrongly. The revision
comes from the server, not from the exit code of the push, which reports what
the client believed it sent. The run is read for the per-check lines `verify`
printed, not for its conclusion — a run whose environment-dependent checks
skipped reads `success`. And the description and topics are compared against
what you pass in rather than against a file in this repository, because a stored
copy of the expectation drifts from the real one with nothing to notice; the
repository's description and topics otherwise pass through no check at all.

The two timings come out of what the check had already fetched. `verify`'s own
elapsed figure is in the log that is read to count those verdict lines, and the
job's duration is one call from the run that was already found. Both were being
looked up by hand after every push.

The warning count is not free in that way. It belongs to a check run rather than
to a workflow run, so it costs a request per job, asked by an id the job list
already carried. It is reported and never asserted against zero: the line
answers whether CI verified the revision, and a deprecation somebody else
scheduled is a different question
([ADR 0019](docs/adr/0019-report-a-runs-warnings-without-asserting-them.md)). It
reads `1 warning` above because that run predates the action bump that ended it.

It needs `gh`. Without it the last two lines skip and name what is missing, and
`--require-environment` turns those skips into failures, which is what the
commit procedure passes.

`docker compose up -d` also starts Redis. Nothing connects to it yet, and it
publishes no host port.

## Decisions

Architecture decisions are in [`docs/adr/`](docs/adr/), one file per decision,
each with the alternatives that were rejected and why.

- [0001 Record architecture decisions](docs/adr/0001-record-decisions.md)
- [0002 Pick the toolchain](docs/adr/0002-pick-the-toolchain.md)
- [0003 Choose the name: describe now, brand later](docs/adr/0003-choose-the-name.md)
- [0004 Defer each convention to the commit that creates its first subject](docs/adr/0004-defer-conventions-to-first-subject.md)
- [0005 Choose the AGPL-3.0 licence](docs/adr/0005-choose-the-licence.md)
- [0006 Keep changes small](docs/adr/0006-keep-changes-small.md)
- [0007 Serve HTTP with Fastify, and validate at the boundary](docs/adr/0007-serve-http-with-fastify.md)
- [0008 Version the schema as plain SQL migrations](docs/adr/0008-version-the-schema-as-plain-sql-migrations.md)
- [0009 Render the guest page in the browser](docs/adr/0009-render-the-guest-page-in-the-browser.md)
- [0010 Observe the guest page in a real browser](docs/adr/0010-observe-the-guest-page-in-a-real-browser.md)
- [0011 Report a check whose environment is absent as a skip](docs/adr/0011-skip-a-check-whose-environment-is-absent.md)
- [0012 Record the commit procedure as a skill, and check its mechanical half after a push](docs/adr/0012-record-the-commit-procedure.md)
- [0013 Bound the CI job in time, and take Chromium's libraries from the runner image](docs/adr/0013-bound-the-ci-job.md)
- [0014 Print a table's own code, and make it the guest's URL](docs/adr/0014-print-a-tables-own-code-and-make-it-the-guests-url.md)
- [0015 Apply the second migration by hand, and defer the runner to a named trigger](docs/adr/0015-apply-the-second-migration-by-hand.md)
- [0016 Make every run step atomic, and check the flag rather than restate it](docs/adr/0016-make-every-run-step-atomic.md)
- [0017 Check the procedure by running it, not by matching its text](docs/adr/0017-check-the-procedure-by-running-it.md)
- [0018 Pick a revision's newest run, and extract only a picking that fails silently](docs/adr/0018-pick-a-revisions-newest-run.md)
- [0019 Take the action release that ends the Node 20 notice, and report a run's warnings without asserting them](docs/adr/0019-report-a-runs-warnings-without-asserting-them.md)
- [0020 Scope a write with row-level security, carried on the transaction](docs/adr/0020-scope-a-write-with-row-level-security.md)
- [0021 Record an order as a submission with lines, and nothing else](docs/adr/0021-record-an-order-as-a-submission-with-lines.md)
- [0022 Take a check's inputs from the repository, not from the machine](docs/adr/0022-take-a-checks-inputs-from-the-repository.md)
- [0023 Mint a submission id per send, and keep it until the API answers](docs/adr/0023-mint-a-submission-id-per-send.md)
- [0024 Report what each test file cost, and assert nothing about it](docs/adr/0024-report-what-each-test-file-cost.md)
- [0025 Check the subject clauses a program can decide, and say which one it cannot](docs/adr/0025-make-the-subject-clauses-executable.md)

## Known limitations

- A guest who opens the printed code a second time can produce two orders for
  one round. The pending submission lives in `sessionStorage`, which a second
  opening does not share, so that opening mints an id of its own. It is
  indistinguishable from a table ordering the same round twice, which is a real
  thing a restaurant does, so no client can decide it.
- A send that has not resolved freezes the guest's choices until it does,
  because it may already have reached the kitchen and a new id for edited lines
  would order everything twice. The way out without retrying is to close the
  tab, which takes the stored submission with it.
- The page cannot say which item a refused order was refused for. The route
  answers `422` with the fact that an item on the order is not on that menu, and
  not with which one.
- Nothing reads an order. It is written, it is scoped, and no route selects one
  — so the only thing that has ever looked at a stored order is the check that
  asserts it was stored correctly.
- Row-level security covers what an order writes and nothing else. `restaurant`,
  `restaurant_table` and `menu_item` carry no policy, so on a read the scope is
  still the query's job, exactly as it was.
- **A menu item that has been ordered cannot be removed from the menu.** The
  order line's foreign key to `menu_item` is `NO ACTION`, so the delete is
  refused. Deleting the whole restaurant is refused too, and by the same
  constraint: the cascade into `menu_item` is blocked before the cascade into
  `table_order` can clear the lines. Both were run rather than reasoned about.
  For a menu that changes seasonally this bites long before anything about money
  does, and the repair is the price and name snapshot
  ([ADR 0021](docs/adr/0021-record-an-order-as-a-submission-with-lines.md))
  which would make the key droppable.
- An order records no price. A menu price that moves leaves an older order
  unpriceable, which costs nothing while nothing is deployed and there are no
  rows to lose.
- A resend carrying the same submission id but different lines answers with the
  first order's id and does not record the new lines. Nothing compares them:
  the submission id identifies the request, and the answer is what that request
  produced.
- The application role's development password is a literal in
  `0003-create-table-order.up.sql`, public in this repository, and that
  migration creates the role in whatever database it is applied to. A deployment
  creates `table_ordering_app` itself, with a real secret, **before** running
  the migration — the migration's exception clause then finds it and leaves it
  alone — and passes its own connection string in `DATABASE_URL`.
- The down migration does not drop that role. A role is cluster-wide, so
  dropping it would reach every other schema in the same cluster.
- A table's code cannot be revoked without reprinting the card it is on, and
  nothing in the schema or the route makes a code hard to guess — the pattern
  would accept `table001`. That property lives entirely in how the code is
  minted, which is why the run steps above mint one rather than choose one.
- Nothing serves the built page in production. The page fetches the API at a
  relative path, which the dev server and the acceptance test each proxy; a
  deployment would have to route `/tables` and `/restaurants` to the API and
  answer `/t/<code>` and `/r/<slug>` with `index.html`.
- A restaurant with nothing available gets a heading and an empty list. The page
  does not say that everything has sold out, though the API distinguishes it
  from a restaurant that does not exist.
- A restaurant, its menu items and its tables can only be created by writing
  SQL, as the run steps above show. There is no admin route and no seed.
- Nothing records which migrations a database has had applied, so a developer
  with an older clone has to know which ones they have run. That holds while
  every migration creates structure and re-applying one errors rather than
  changing anything; the runner arrives with the first deployment, or with the
  first migration that alters data
  ([ADR 0015](docs/adr/0015-apply-the-second-migration-by-hand.md)).
- The database probe is a TCP connect. It answers whether something is
  accepting connections at the address the tests use, not whether that
  something is PostgreSQL, so a wrong service on the port fails the suites
  rather than skipping them. That is deliberate — a misconfiguration is not an
  absent dependency — but it does mean the skip is keyed on absence alone.
- CI downloads that browser on every run. Caching it is the obvious next move
  and has not been made.
- The per-file figures a run prints are durations of files that run in
  parallel, so they neither add up to their step's total nor stay under it: one
  run here put 11.9s of files inside a `test-guest` step that took 7.8s. No sum
  is printed, for that reason. A file costing under fifty milliseconds reads
  `0.0s`, which says only that it is below what the line can show.
- A file's figure is a property of the machine as much as of the file, so a
  local reading cannot answer a question about a CI one. `test-tools` runs in
  2.2–2.6s on CI and 28s here. Two runs back to back on an idle machine agree to
  within a few per cent; a first run after the machine has been busy does not —
  `menu.test.ts` read 2.3s cold and 0.3s warm, the same file either way.
- A test step whose per-file report cannot be read fails, though its suite
  passed and its exit code was 0. That is deliberate: a check that could not
  gather its evidence has established nothing, and an instrument that stops
  working quietly is worse than one that fails loudly. It does mean a
  temporary-directory problem, or a vitest release that changes the report's
  shape, reddens a run over something other than the code.
- `verify` reads that report from a temporary file, and the part of `verify.ts`
  that writes, reads and removes it is reached by no test — the same boundary as
  `check-push`'s CLI half below. What the arguments are and what the reading
  says are both checked; the six lines that carry a file between them are not.
- Nothing forces `pnpm check-push` to be run. It is a step in the commit
  procedure, not a gate, so a push nobody checked is indistinguishable from one
  that passed.
- `pnpm check-push` reports a run's warning annotations without asserting that
  there are none, so a run that started carrying one is a number on a line
  somebody has to read rather than a check that fails. That is deliberate, and
  the reasoning is in ADR 0019.
- `pnpm check-push` needs GitHub to still hold the run's log. Logs are retained
  for a limited period, and after that the run cannot be verified this way. The
  check reports that the log could not be read, rather than reporting a run that
  printed nothing it recognised.
- `pnpm check-push`'s CLI half is reached by no test. It fetches the run list,
  the log, the job times and each job's annotation count, and parses each, and
  no fixture can see which arguments those calls carry. The boundary between
  that half and the tested one is drawn by a header comment and nothing else, so
  code can cross it without anything noticing.
- `readme-status-date`'s subject count has never been observed independently of
  `commit-message-policy`'s: every commit so far has touched README. The first
  commit that leaves README alone is the first run that can tell them apart.
- The sign-off rule has three outcomes and real commits reach two of them. Most
  commits carry no trailer at all, and every `Signed-off-by:` in history names
  its own author, which is the allowed branch. The rejected branch — a sign-off
  naming somebody else — is reached by no commit at all, only by fixtures.
  Nothing is grandfathered, and that is why: the trailers that exist comply.
  This is the same shape as the bullet above.
- The subject rule's rejecting branch is reached by no commit either. All
  seventeen subjects that existed when it landed were lowercase throughout, at
  most 48 characters, and carried no colon, so it arrived at a set that already
  complied and every rejection it has ever made was of a fixture. That is now
  three places where a branch is told apart by fixtures and never by a real
  subject.
- Of the four things `AGENTS.md` says about a subject line, three are checked
  and one is not. Imperative mood is not decidable by a program, so nothing
  enforces it and no run will ever go red over it. The file says which is
  which, because a document stating four rules of which three run is worse than
  one that says so ([ADR 0025](docs/adr/0025-make-the-subject-clauses-executable.md)).
- The prefix clause matches the Conventional Commits grammar, whose type is
  letters. A hyphenated pseudo-prefix — `check-push: read the log` — passes.
  Widening the type would make it coincide with the trailer key grammar and
  would take a case with it, which is the trade recorded in ADR 0025.
- The invariant is wider than the check that guards it. `collectInput` is
  checked by collecting twice under two constructed environments that differ in
  the operator's git configuration, in `HOME` and in `TZ`. An input read from
  somewhere else on the machine — a hostname, a path outside the repository, a
  variable nobody thought to vary — passes that check. It catches the class of
  input that produced the divergence in
  [ADR 0022](docs/adr/0022-take-a-checks-inputs-from-the-repository.md), not
  every way a check could learn something about its operator.
- The convention checker carries six rules. The rest arrive with the code they
  govern, so that each rule shows up to a set of subjects that already comply.
- `compose.yaml` carries development credentials inline, and starts a Redis
  that nothing connects to.
- `pnpm install` modifies git configuration in your clone, as described above.
- AGPL-3.0 rules this out for some companies as a matter of policy. That is a
  deliberate trade, not an oversight.
- The name is a description, not a brand, and it is expected to change at the
  first release.

## Non-goals

- Replacing a restaurant's point-of-sale system.
- A delivery marketplace, or anything that puts a third party between the
  restaurant and its guest.
- An app for guests to download.
- Taking a percentage of the money that moves through it.

## Money

This platform takes zero basis points of card volume. That is a statement about
what this software charges, not a claim about what a restaurant pays overall:
the restaurant still pays its own card processor, whoever that is.

Payment handling is optional and not built. If this ever needs to fund itself,
the honest routes are hosting, support and integration work — the same routes
that are available under any licence — rather than a cut of the till.

## Licence

AGPL-3.0-only. The full text is in [`LICENSE`](LICENSE); the reasoning, and the
licences that were rejected, are in
[ADR 0005](docs/adr/0005-choose-the-licence.md).

— Ben Koo
