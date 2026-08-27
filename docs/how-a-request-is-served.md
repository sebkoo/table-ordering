# How a request is served

This is the README's "How a menu request is served" and "How an order is
taken", moved here whole by
[ADR 0039](adr/0039-relocate-only-what-no-collector-reads.md). Nothing in them
changed except the two record links, which resolve from `docs/` now rather than
from the repository root.

## How a menu request is served

```
  the page on a guest's phone   apps/guest/src/features/menu/menu.tsx
        │   GET /tables/9f3c1a7b20de/menu   (or /restaurants/blue-door/menu)
        ▼
  Fastify route ─────────────  services/api/src/features/menu/routes.ts
        │   the code is validated against the route's JSON Schema
        ▼   a pattern it fails → 400, which is not the same answer as 404
  one transaction ───────────  services/api/src/features/menu/sql.ts
        │   the code resolves to a restaurant — the one unscoped read, and the
        │   only statement here with no restaurant to scope by
        ▼   set_config('app.restaurant_id', that restaurant, local)
  the policy ────────────────  services/api/migrations/0005-*.up.sql
        │   the menu select names no restaurant at all; menu_item_scope is what
        ▼   scopes it, and an unscoped read is refused rather than answered empty
  PostgreSQL ────────────────  services/api/migrations/*.up.sql
        │   no restaurant → 404 · no items → an empty menu, which is not the
        ▼   same answer · the rest serialised through the response schema
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

Two statements rather than one, and the split is what puts the read under the
policy. A single statement cannot do both jobs: it would have to carry the slug
or the code in its own `where` clause, and a statement that knows its own
restaurant is one a later edit can quietly widen with nothing to go red. So the
first statement finds the restaurant and the second names none, and which
restaurant the second one saw is not something the caller can influence
([ADR 0033](adr/0033-read-the-menu-under-a-policy.md)).

A restaurant that does not exist and a restaurant that has sold out are still
different answers, and they are now told apart by which of the two statements
came back empty rather than by reading nulls out of a join.

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
([ADR 0020](adr/0020-scope-a-write-with-row-level-security.md)).

A statement that establishes no scope at all is refused rather than quietly
narrowed: `current_setting` raises on a connection that has never carried the
setting, and the empty string it reverts to afterwards fails the `::uuid` cast.

Reading those orders back is the same transaction with no write in it. The code
resolves, the scope is set from the row it resolved to, and the select then
names no restaurant at all: `table_order` and `table_order_line` carry `for all`
policies, so the `using` clause is what scopes the read. It is the first read
here that a policy scopes, and it needed no migration — the tables were already
enabled and the application role already held `select`.

Clearing a ticket is that shape again with a staff session in place of a printed
code: resolve the session, set the scope from the row it resolved to, then update
a statement that names no restaurant. `for all` covers an update as well as a
read, so the policy that scopes the board is already the policy that scopes the
act, and `0006` writes none. What `0006` does write is a **column grant**:

```sql
grant update (served_at) on table_order to table_ordering_app;
```

so the application role can record that a ticket went out and still cannot move
an order to another table, re-time it, or delete it. A statement naming any other
column is refused by the privilege before a policy is consulted — which is what
makes the refusal hold for a statement nobody reviewed.
