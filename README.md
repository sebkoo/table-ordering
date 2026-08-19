# Table-side ordering for restaurants

Self-hosted table-side ordering for restaurants, built in the open under AGPL-3.0.

[![CI](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml/badge.svg)](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-brightgreen.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue.svg)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-orange.svg)](pnpm-workspace.yaml)

**Status:** 2026-08-19 · bootstrap. Toolchain, convention checks and CI only. No application code.

## What happens at the table

### Today

This repository contains the toolchain, the convention checks and the CI workflow.
Nothing else. There is no application code, no schema and no running service.

### Next

1. A guest will scan the code on their table and get that restaurant's menu on
   their own phone, with no app to install and no account to create.
2. They will build an order and send it. Sending it twice, from a flaky
   connection or a second tab, will produce one order rather than two.
3. The kitchen will see the ticket. A kitchen client that drops off the network
   will be able to reconnect and pick up where it left off.
4. Staff will be able to see what each table has ordered and what is still open.

## Why

Every table-ordering product I looked at wanted a percentage of card volume, a
tablet on every table, or both — and most of what they were charging for was a
menu on a screen. The menu is not the hard part. The hard part is making one
guest's order survive a retry, a dropped signal, and a kitchen screen that
somebody else is updating at the same moment. That is worth building carefully,
and it is worth being able to run yourself.

## Roadmap

Everything below the first row is planned. None of it is started.

| Step | State |
| --- | --- |
| Toolchain, convention checks, CI | Done |
| Tenant schema and isolation | Planned |
| Guest menu, served to a phone | Planned |
| Table session | Planned |
| Order submission that tolerates retries | Planned |
| Kitchen board | Planned |
| Payment, as an option rather than a requirement | Planned |

## Run it

Requires Node 24 (see `.nvmrc`) and pnpm. Docker is needed only for the
services, which nothing connects to yet.

```sh
git clone https://github.com/sebkoo/table-ordering.git
cd table-ordering
pnpm install
pnpm verify
```

`pnpm install` does one thing beyond fetching dependencies: it points git at
this repository's hooks by setting `core.hooksPath` to `.githooks` in your
clone. That is a change to your local git configuration, and it is what makes
the commit message check active without any manual setup step. Installing with
`--ignore-scripts` skips it, and the hook then does nothing.

`pnpm verify` reports `PASS`, `FAIL` or `SKIP` per check. Before the first
commit both convention checks report `SKIP`, because the commit each one would
inspect does not exist yet, and each says so on its own line. CI runs on a
clean tree with the commit already made, so both evaluate there.

To start PostgreSQL and Redis:

```sh
docker compose up -d
```

No host ports are published. Nothing in the repository connects to either
service yet, so use `docker compose exec` to reach them.

## Decisions

Architecture decisions are in [`docs/adr/`](docs/adr/), one file per decision,
each with the alternatives that were rejected and why.

- [0001 Record architecture decisions](docs/adr/0001-record-decisions.md)
- [0002 Pick the toolchain](docs/adr/0002-pick-the-toolchain.md)
- [0003 Choose the name: describe now, brand later](docs/adr/0003-choose-the-name.md)
- [0004 Defer each convention to the commit that creates its first subject](docs/adr/0004-defer-conventions-to-first-subject.md)
- [0005 Choose the AGPL-3.0 licence](docs/adr/0005-choose-the-licence.md)
- [0006 Keep changes small](docs/adr/0006-keep-changes-small.md)

## Known limitations

- There is no application code. Nothing here serves a menu or takes an order.
- The convention checker carries two rules. The rest arrive with the code they
  govern, so that each rule shows up to a set of subjects that already comply.
- `compose.yaml` starts two services that nothing connects to, with development
  credentials inline and no ports published.
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
