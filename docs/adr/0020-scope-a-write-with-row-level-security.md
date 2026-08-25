# 0020. Scope a write with row-level security, carried on the transaction

- **Status:** accepted
- **Date:** 2026-08-21

## Context

Order submission is the first write path in this repository, and the roadmap
carries a second row beside it: "Row-level security, so scope is not the query's
job". The two arrive together because a policy with no statement running under it
has no subject, and because a write is where the existing arrangement stops being
adequate. AGENTS.md has said since migration `0001` that "a restaurant's rows are
read only through a query scoped to that restaurant. Row-level security is not in
place, so the scope is the query's job." A `where` clause somebody forgot on a
read leaks a menu. The same omission on a write puts one restaurant's order in
another's book.

The obstacle is not writing a policy. It is that a policy can be written,
enabled, and enforce nothing, while every check passes.

PostgreSQL exempts three things from row security: a superuser, a role holding
`BYPASSRLS`, and the table's owner. `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
removes the third exemption and does not touch the first two. `compose.yaml` sets
`POSTGRES_USER: table_ordering`, which the `postgres` image creates as the
bootstrap superuser, and every migration is applied as that role, so it owns
every table. Asked directly:

```
$ psql -Atc "select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user"
table_ordering|true|true
```

That is all three exemptions at once. A policy checked through that connection is
inert, and a suite that connected the same way would report a guarantee that is
not there — this repository's own recurring failure, which is gathering evidence
through a connection that is not subject to the thing being tested.

The scope also has to come from somewhere. ADR 0014 already fixed where: "one
query in the system is not scoped by a restaurant: the one that resolves a code,
because it is the query that finds the restaurant", and everything after it is
scoped by what that query returned rather than by anything the caller sent.

## Decision

**The application connects as `table_ordering_app`.** It owns nothing, is not a
superuser, holds no `BYPASSRLS`, and is granted `usage` on the schema, `select` on
the three existing tables and `select, insert` on the two new ones. It has no
`UPDATE` and no `DELETE`. Migration `0003` creates it and grants it;
`main.ts`'s `DEFAULT_DATABASE_URL` is its connection string, and every suite that
builds or spawns the application gives it that role.

**Scope is a setting on the transaction.** Each write opens one transaction,
resolves the printed code, and then issues

```sql
select set_config('app.restaurant_id', $1, true)
```

`set_config` rather than `SET LOCAL`, because `SET` takes no parameter and the
value would otherwise be interpolated into statement text. The third argument is
`is_local`, so the setting reverts at commit or rollback and a pooled connection
cannot carry one request's restaurant into the next.

**Both new tables are enabled and both carry a policy**, each keyed on
`restaurant_id = current_setting('app.restaurant_id')::uuid`, with `with check`
written out beside `using` rather than left to default from it. The line table's
policy is not symmetry. The application holds `insert` on it, and the foreign key
that ties a line to its order is a referential-integrity check, which PostgreSQL
runs as the table's owner and which bypasses row security — so without a policy of
its own the application could attach lines to another restaurant's order, and
lines are where the food is.

**A row that names two of a restaurant's rows names them through one composite
foreign key.** `menu_item` and `restaurant_table` each gain
`unique (id, restaurant_id)`, and the order and its lines reference those pairs.
A single-column key is satisfied while the row is nonsense: an order line naming
an item from another restaurant passes `references menu_item (id)` and passes the
policy, because its own `restaurant_id` is right. Row security cannot close that,
for the reason above.

## Rejected alternatives

- **`FORCE ROW LEVEL SECURITY`, keeping one role.** The obvious reading of the
  problem, and it is the documented answer to the owner exemption. It fails here
  for a reason that is easy to miss: the owner is also a superuser, and `FORCE`
  does not reach a superuser. Even against a non-superuser owner it would cost the
  migration and seed path its exemption, and those must be able to write outside
  any scope. Worth revisiting only if the application role ever becomes an owner.
- **`current_setting('app.restaurant_id', true)`.** The two-argument form returns
  NULL instead of raising when the setting is absent, which reads as the tidier
  choice. It converts a forgotten scope from a refusal into a policy that matches
  no rows: a read returns an empty menu and a write is rejected as out-of-scope,
  neither of which says that the scope was never established. A request that
  forgets to establish scope has to fail loudly.
- **A role per tenant, or a connection per tenant.** Either makes scope
  structural rather than conventional, which is stronger than what was chosen.
  Both need one database object or one pool per restaurant, created and torn down
  as restaurants come and go, and a connection pool that cannot be shared across
  tenants is a pool per tenant. Reconsider if a tenant ever needs isolation this
  cannot express.
- **A schema per tenant.** The strongest isolation available without separate
  databases, and `search_path` already carries a schema in every suite here.
  Rejected because migrations would then have to run once per restaurant, which
  is the migration-runner problem ADR 0015 deferred, arriving through the side
  door.
- **`SET ROLE` from the superuser connection.** No second login role, no second
  password, no change to the connection string: the write path would drop to a
  non-superuser role for the length of its transaction. Rejected on how it fails.
  A forgotten `set local role` leaves a superuser writing with no policy at all,
  silently — which is worse than the convention it replaces, because the
  convention at least fails visibly when a `where` clause is missing.
- **Keeping scope in every statement, as the read path does.** It works, it needs
  no role and no setting, and it is what the repository does today. It loses on
  what it is being asked to protect: a `where` clause is a thing a person
  remembers, and the roadmap row exists because remembering is not a control.
- **`grant update (table_id) on table_order`, to allow an upsert.** The write
  path needs to tell a resend from a first send. `INSERT ... ON CONFLICT DO
  UPDATE` does that and takes a lock while doing it, but PostgreSQL requires the
  `UPDATE` privilege for it, and a column-level grant is the narrowest form that
  would serve. Rejected because the privilege turned out to be avoidable rather
  than merely narrowable: `ON CONFLICT DO NOTHING` with a scoped re-select answers
  the same question, and the commit that introduces a privilege boundary should
  not widen one. What `DO NOTHING` costs is that a concurrent first send can leave
  the insert returning no row while the row it conflicted with is not yet visible;
  the route runs the whole transaction again, once, and that is the price.
- **Row-level security on `menu_item`, instead of the composite foreign keys.**
  It would put the cross-restaurant line under the same mechanism as everything
  else. It cannot work: referential-integrity checks run as the table's owner and
  bypass row security, so the foreign key would never consult the policy. It would
  also put the existing read path under a scope it does not set, which is the
  read-path work this change deliberately does not do.

## Consequences

**The `::uuid` cast is load-bearing, not cosmetic.** Once `app.restaurant_id` has
been set on a connection the placeholder stays defined for the session and reverts
to the empty string, so a later unscoped transaction reads `''`, and `''::uuid`
raises `22P02`. Writing the comparison as `restaurant_id::text =
current_setting('app.restaurant_id')` instead creates cleanly and then matches no
rows in silence — the failure mode the two-argument `current_setting` was rejected
for, reintroduced from the other side.

**The read path is not under a policy.** `restaurant`, `restaurant_table` and
`menu_item` carry none, and the menu queries still scope themselves. That is its
own roadmap row: bringing them under one means the code lookup and the menu read
become two statements in a transaction, which is a change to the menu slice rather
than to this one. The claim is about those three tables only. The policies added
here are `for all`, so they cover a select as well, and
[ADR 0026](0026-read-a-tables-open-orders-by-its-printed-code.md) reads an order
back under them without adding a migration.

**ADR 0015's trigger has not fired**, and this was run rather than reasoned.
Re-applying `0003` to a schema that already has it prints

```
ERROR:  relation "menu_item_scoped_key" already exists
ERROR:  current transaction is aborted, commands ignored until end of transaction block  (x8)
psql exit: 0
```

and changes nothing. `0003` creates structure; the first non-idempotent statement
stops it, and `--single-transaction` discards the batch. The exit code is 0, which
is ADR 0016's finding about `-v ON_ERROR_STOP=1` reproducing exactly, and that
record's trigger — the first run step something automated reads — has not fired
either.

**The role's creation is the one idempotent statement in a migration**, because a
role is cluster-wide while a migration is schema-scoped. It is guarded by an
exception clause, and that clause is what makes the deployment order work: a
deployer creates `table_ordering_app` with a real secret first and migrates
second, at which point the block finds the role and leaves the secret alone. The
password in the file is a development literal and is only ever reached on a
database where nobody did that.

**The down file does not drop the role**, for the same reason it can only be
created idempotently: dropping it would reach every other schema in the cluster,
including a concurrent test run.
