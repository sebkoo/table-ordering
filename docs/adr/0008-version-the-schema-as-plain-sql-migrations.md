# 0008. Version the schema as plain SQL migrations, and query with hand-written SQL

- **Status:** accepted
- **Date:** 2026-08-19

## Context

The menu slice brings the first table and the first query, so ADR 0002's
deferred data access approach and migration runner both have a subject now.

Two obligations sit behind that. A schema has to be reproducible: the tests
create it from nothing on every run, and a deployment will one day have to
arrive at the same shape. And a query has to be inspectable: the read that
matters here is a menu, fetched whole for one restaurant, and the reads that
matter later are order and kitchen reads whose correctness is about
concurrency — `select ... for update`, `on conflict`, isolation levels. Those
are the parts of Postgres a mapping layer is least willing to expose.

The menu query already shows why the SQL is worth reading. It is a left join
with the availability filter in the join condition rather than in a `where`
clause, because a `where` clause on the right-hand table would discard the null
row that distinguishes "this restaurant has nothing available" from "there is
no such restaurant". That distinction is the difference between an empty menu
and a 404, and it is visible in six lines of SQL.

## Decision

Queries are hand-written, parameterised SQL, sent through `pg`
(node-postgres). A feature's SQL lives in `sql.ts` beside the route that uses
it.

The schema is versioned as numbered file pairs under
`services/<service>/migrations`: `NNNN-name.up.sql` and `NNNN-name.down.sql`.
Up and down are separate files rather than two sections of one file, so that
applying a migration is `psql < …up.sql` with nothing to strip first, and so
that no marker has to be parsed identically by the convention checker, by the
test, and by the person typing the command.

There is no migration runner. The test applies the up file it needs, a
developer applies it by hand, and the `migration-has-down` convention rule
enforces that every up file has a non-empty down file beside it.

## Rejected alternatives

- **An ORM — Prisma, Drizzle, TypeORM.** Generated types and generated
  migrations are a genuine gain, and Prisma's migration engine is better than
  anything written here will be. It was rejected because the queries this
  product turns on are concurrency-shaped, which is where a mapping layer stops
  helping and starts having to be worked around, and because codegen
  reintroduces the build step ADR 0002 deliberately avoided.
- **A query builder — Kysely.** The closest call. It gives typed SQL with no
  codegen and composes well where queries are built conditionally. It types the
  query and not the schema, so migrations are still hand-written SQL, and one
  static query does not need composition. Reconsider when the first query has
  to be assembled from optional parts.
- **`postgres.js` instead of `pg`.** Faster in its own benchmarks and a nicer
  tagged-template API. `pg` was taken for its pool semantics, its per-connection
  `options` (which is how each test run gets its own schema), and the weight of
  deployment behind it. Not a decision worth defending hard if that changes.
- **A migration runner now — dbmate, node-pg-migrate.** A runner earns its keep
  through a state table and a lock, which matter when there are many migrations
  and more than one machine applying them. There is one migration and no
  deployment. This is the first thing to add when either changes.
- **Forward-only migrations, with no down file.** Plenty of production teams
  never run a down migration, and an untested down section rots into a lie.
  Rejected because the menu test runs the down file on every run, so it does not
  rot, and because a down file is how a developer resets a scratch database
  today, before any of this is deployed anywhere.

## Consequences

Nothing records which migrations have been applied to a given database. That is
acceptable with one migration and no deployment, and it is the constraint that
forces the runner decision to be revisited rather than forgotten: the second
migration cannot be applied safely without one.
