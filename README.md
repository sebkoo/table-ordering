# Table-side ordering for restaurants

Self-hosted table-side ordering for restaurants, built in the open under AGPL-3.0.

[![CI](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml/badge.svg)](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-brightgreen.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue.svg)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-orange.svg)](pnpm-workspace.yaml)

**Status:** 2026-08-20 · a table's own code, on a page a phone loads. Read only —
nothing takes an order.

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
    { "name": "Flat white", "priceMinor": 300, "currency": "GBP" },
    { "name": "Cinnamon bun", "priceMinor": 450, "currency": "GBP" }
  ]
}
```

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
    { "name": "Flat white", "priceMinor": 300, "currency": "GBP" }
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

A guest opens `/t/9f3c1a7b20de` on their phone and gets that menu as a page:

```
The Blue Door
Table 7

Flat white                                                   £3.00
Cinnamon bun                                                 £4.50
```

`/r/blue-door` still answers with the same menu and no table, for a restaurant
that wants to put its menu on a link.

A fresh load of that page asks for nothing but its own origin. No font, script,
image, analytics or beacon from anywhere else — and what says so is not a
promise in this file, it is a browser test that loads the built page and
inspects every request it made.

The page is read only. A guest opens their own table and the page names it, but
there is no session, no order, and no button that could start one. A table is a
row in the schema, not a record of anyone's visit: nothing yet groups what one
sitting ordered, and nothing is written when a guest arrives.

An address the page cannot serve says which kind it is. A code no table uses,
and a code the address cannot hold at all, both send the guest to a member of
staff — asking again will not help either one. A menu that cannot be fetched
says to try again instead.

### Next

1. Guests will build an order and send it. Sending it twice, from a flaky
   connection or a second tab, will produce one order rather than two, and that
   is where a sitting starts being recorded.
2. The kitchen will see the ticket. A kitchen client that drops off the network
   will be able to reconnect and pick up where it left off.
3. Staff will be able to see what each table has ordered and what is still open.

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
| Order submission that tolerates retries | Planned |
| Row-level security, so scope is not the query's job | Planned |
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
{"restaurant":{"slug":"blue-door","name":"The Blue Door"},"table":{"label":"Table 7"},"items":[{"name":"Flat white","priceMinor":300,"currency":"GBP"}]}
```

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

Everything above runs before a commit exists. What the remote holds *after* a
push is a separate question, and `pnpm check-push` asks it:

```sh
pnpm check-push --revision "$(git rev-parse HEAD)" \
  --description "Self-hosted table-side ordering for restaurants. ..." \
  --topics docker,fastify,github-actions,monorepo,pnpm,postgresql,react,rest-api,typescript,vite,vitest \
  --require-environment
```

Run against the push of `7a1d0a5`, it printed:

```
push-arrived ....... PASS  origin holds 7a1d0a55f55fae8cda4eb672ec5ded9d58591656
run-verified ....... PASS  run 32298949382, 10 verdict lines, all PASS
metadata-declared .. PASS  the description and 11 topics are as declared
```

Each line answers a question the obvious source answers wrongly. The revision
comes from the server, not from the exit code of the push, which reports what
the client believed it sent. The run is read for the per-check lines `verify`
printed, not for its conclusion — a run whose environment-dependent checks
skipped reads `success`. And the description and topics are compared against
what you pass in rather than against a file in this repository, because a stored
copy of the expectation drifts from the real one with nothing to notice; the
repository's description and topics otherwise pass through no check at all.

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

## Known limitations

- The guest page is read only. It renders a table's menu and stops there: no
  session, no order, and no control that could begin one. A table is furniture
  in the schema; nothing records that anyone sat at it.
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
- Nothing forces `pnpm check-push` to be run. It is a step in the commit
  procedure, not a gate, so a push nobody checked is indistinguishable from one
  that passed.
- `pnpm check-push` needs GitHub to still hold the run's log. Logs are retained
  for a limited period, and after that the run cannot be verified this way. The
  check reports that the log could not be read, rather than reporting a run that
  printed nothing it recognised.
- `pnpm check-push`'s CLI half is reached by no test. It picks the run for a
  revision with a second whole-revision comparison, and the suite that pins the
  first one cannot see it. The boundary between the tested half and this one is
  drawn by a header comment and nothing else, so a comparison can cross it
  without anything noticing.
- `readme-status-date`'s subject count has never been observed independently of
  `commit-message-policy`'s: every commit so far has touched README. The first
  commit that leaves README alone is the first run that can tell them apart.
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
