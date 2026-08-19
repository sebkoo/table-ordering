# Table-side ordering for restaurants

Self-hosted table-side ordering for restaurants, built in the open under AGPL-3.0.

[![CI](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml/badge.svg)](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-brightgreen.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue.svg)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-orange.svg)](pnpm-workspace.yaml)

**Status:** 2026-08-19 · the guest menu, served over HTTP. One route, one migration, no client yet.

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

There is no page for a phone to load yet, and no table, session or order.

### Next

1. A guest will scan the code on their table and get that restaurant's menu on
   their own phone, with no app to install and no account to create.
2. They will build an order and send it. Sending it twice, from a flaky
   connection or a second tab, will produce one order rather than two.
3. The kitchen will see the ticket. A kitchen client that drops off the network
   will be able to reconnect and pick up where it left off.
4. Staff will be able to see what each table has ordered and what is still open.

## How a menu request is served

```
  a guest's phone
        │   GET /restaurants/blue-door/menu
        ▼
  Fastify route ─────────────  services/api/src/features/menu/routes.ts
        │   the slug is validated against the route's JSON Schema
        ▼
  one SQL query ─────────────  services/api/src/features/menu/sql.ts
        │   restaurant LEFT JOIN the menu_item rows that are available
        ▼
  PostgreSQL ────────────────  services/api/migrations/0001-create-menu.up.sql
        │   no rows → 404 · rows → the menu, serialised through the
        ▼   response schema, so only the fields it names can escape
  a guest's phone
```

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

The two rows marked Done are what exists. Everything else is planned, and
none of it is started.

| Step | State |
| --- | --- |
| Toolchain, convention checks, CI | Done |
| Guest menu, over HTTP | Done |
| Tenant schema and isolation | Planned |
| A page the guest's phone loads | Planned |
| Table session | Planned |
| Order submission that tolerates retries | Planned |
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
the migration:

```sh
docker compose exec -T postgres psql -U table_ordering -d table_ordering \
  < services/api/migrations/0001-create-menu.up.sql
```

Give it a restaurant to serve. There is no admin route yet either:

```sh
docker compose exec -T postgres psql -U table_ordering -d table_ordering <<'SQL'
insert into restaurant (slug, name) values ('blue-door', 'The Blue Door');
insert into menu_item (restaurant_id, name, price_minor, currency, sort_order)
select id, 'Flat white', 300, 'GBP', 10 from restaurant where slug = 'blue-door';
SQL
```

Then start the API and ask it for the menu:

```sh
pnpm dev
curl -s localhost:3000/restaurants/blue-door/menu
```

```json
{"restaurant":{"slug":"blue-door","name":"The Blue Door"},"items":[{"name":"Flat white","priceMinor":300,"currency":"GBP"}]}
```

Everything the repository checks runs in one command:

```sh
pnpm verify
```

`pnpm install` does one thing beyond fetching dependencies: it points git at
this repository's hooks by setting `core.hooksPath` to `.githooks` in your
clone. That is a change to your local git configuration, and it is what makes
the commit message check active without any manual setup step. Installing with
`--ignore-scripts` skips it, and the hook then does nothing.

`pnpm verify` reports `PASS`, `FAIL` or `SKIP` per check. A `SKIP` means the
check had nothing to evaluate — commonly a convention check whose commit does
not exist yet — and it says so on its own line. CI runs on a clean tree with
the commit already made, so nothing skips there.

`pnpm verify` needs the database running: the menu test talks to a real
PostgreSQL and fails, rather than skipping, when it cannot reach one.

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

## Known limitations

- There is no guest client. The menu is JSON on an endpoint; nothing renders
  it, and nothing takes an order.
- A restaurant and its menu items can only be created by writing SQL, as the
  run steps above show. There is no admin route and no seed.
- Nothing records which migrations a database has had applied. That is fine for
  one migration, and it is why the second one needs a runner first.
- `pnpm verify` needs PostgreSQL running. The menu test fails rather than skips
  when it cannot reach one: a test that skips itself on a missing dependency
  reports success for a system nobody exercised.
- The convention checker carries four rules. The rest arrive with the code they
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
