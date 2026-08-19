# 0002. Pick the toolchain

- **Status:** accepted
- **Date:** 2026-08-19

## Context

This repository is a monorepo that will hold a guest client, an API service
and a few shared packages. Its checks run on every change, locally and in CI,
so the cost of the toolchain is paid many times a day. A verify run that takes
minutes gets skipped; one that takes seconds gets used.

Two infrastructure services are needed before any of that code exists, because
a `compose.yaml` that comes up on a fresh clone is testable today, while the
code that will connect to it is not yet written.

Only decisions whose subject exists in this repository today are recorded here.
The web framework, the data access approach, the migration runner and what
each service will hold are decided in the commits that first introduce them.

## Decision

**Node on the Active LTS line, with pnpm workspaces.** `.nvmrc` pins the major
version only. pnpm's workspaces are enough for a handful of packages, and
`packageManager` in the root manifest pins the exact pnpm build.

**TypeScript with `strict: true`**, plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and `erasableSyntaxOnly`. The last of these keeps
every source file to syntax Node can strip and run directly, which is why the
repository's own tools need no build step and no runtime dependency.

**Biome** for formatting and linting, as one binary.

**Vitest** for tests.

**PostgreSQL and Redis** as the two `compose.yaml` services. There are two
because they answer different questions: Postgres is the store of record for
anything with an invariant in it, and Redis is the ephemeral store for things
that may be rebuilt. What each one holds is decided as it arrives.

## Rejected alternatives

- **Turborepo or Nx over pnpm workspaces.** A task graph earns its keep when
  builds are slow and interdependent. A handful of packages with a sub-minute
  verify run is not that, and the caching layer would be a second thing to
  debug when a check misbehaves.
- **npm or yarn.** Workspaces work in all three. pnpm's content-addressed
  store and its strictness about undeclared dependencies are the difference,
  and the second one catches real mistakes in a monorepo.
- **A loose TypeScript configuration, tightened later.** Tightening later means
  fixing every violation at once, under time pressure, in code nobody is
  currently reading. Strict from the first file costs nothing, because there
  is no code yet to be non-compliant.
- **ESLint with Prettier.** The larger and better-established ecosystem, and
  the honest cost of not choosing it: React Compiler's lint rules have no
  Biome equivalent. That is specifically the compiler rules, not React linting
  in general, and it costs nothing until there is React code to lint. Traded
  for one binary and a lint step measured in fractions of a second.
- **Jest.** Vitest handles TypeScript and ES modules without a transform layer
  to configure, which is most of the setup Jest would need here.
- **A single database service.** Putting cache-shaped and rate-limit-shaped
  data in Postgres works, and would be one less thing to run. It also puts
  churn on the store whose durability matters most, and the separation is
  cheaper to establish now than to introduce later.
- **No `compose.yaml` until the first query.** Defensible, and the reason it
  was not taken is that this file can be started and probed today. It is the
  first thing to reconsider if committing to infrastructure ahead of code ever
  looks like the wrong trade.
