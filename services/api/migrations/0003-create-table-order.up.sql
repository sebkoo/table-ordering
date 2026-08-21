-- An order placed at a table, and the role that is allowed to place one.
--
-- `table_order`, not `order`: `order` is a reserved word, and this is the same
-- reason `restaurant_table` is called that.
--
-- This is the first write path in the repository, and the first schema that has
-- to survive a wrong scope rather than merely a wrong read. Three things carry
-- that, and none of them is the statement the application sends.
--
-- 1. THE ROLE. PostgreSQL exempts a table's owner from its own policies, and
--    exempts a superuser unconditionally -- `FORCE ROW LEVEL SECURITY` reaches
--    the first and not the second. `table_ordering` is both: it owns every table
--    because it applied every migration, and it is the bootstrap superuser the
--    postgres image creates from POSTGRES_USER. A policy checked through that
--    connection enforces nothing while every test passes. So the application
--    connects as `table_ordering_app`, which owns nothing, is not a superuser,
--    and has no BYPASSRLS -- the only three exemptions there are.
--
-- 2. THE SCOPE. Policies read `app.restaurant_id`, set once per transaction
--    through `set_config(..., true)` from the row a printed code resolved to.
--    A statement that runs without it is refused: on a connection that has never
--    been scoped `current_setting` raises 42704, and on one that has, the
--    setting reverts to the empty string and `''::uuid` raises 22P02. The
--    `::uuid` cast is what makes the second of those loud. Comparing
--    `restaurant_id::text` to the setting instead would create cleanly and then
--    match no rows in silence, which is the failure this whole file is against.
--
-- 3. THE COMPOSITE KEYS. A plain `references menu_item (id)` is satisfied while
--    the row is nonsense: an order line can name an item belonging to another
--    restaurant and every single-column key holds. The unique keys added below
--    make that unrepresentable. They are not redundant with the policies --
--    PostgreSQL runs referential-integrity checks as the table owner, and those
--    bypass row security, so a policy on `menu_item` would not be consulted by
--    the foreign key at all.
--
-- The role is cluster-wide while a migration is schema-scoped, so its creation
-- is the one idempotent statement in this file. That is not a convenience: a
-- deployment creates `table_ordering_app` with a real secret FIRST and migrates
-- second, and the exception clause is what leaves that secret untouched. The
-- password below is a development literal, public in this repository, and is
-- only ever reached on a database where nobody created the role first. The
-- clause also covers two test workers applying this file at once.
--
-- Re-applying the file still fails loudly at the first `alter table` below, and
-- `--single-transaction` discards the batch, so ADR 0015's argument for having
-- no migration runner is unharmed.

do $$
begin
  create role table_ordering_app login password 'table_ordering_app_dev';
exception
  when duplicate_object or unique_violation then null;
end
$$;

-- The schema is `public` in a deployment and a throwaway per-run schema under
-- test, so it cannot be a literal here. Everything below this line is named
-- unqualified and resolves through the applying session's search_path.
do $$
begin
  execute format('grant usage on schema %I to table_ordering_app', current_schema());
end
$$;

grant select on restaurant, menu_item, restaurant_table to table_ordering_app;

-- Foreign key targets, so that a child row's restaurant is the same row's
-- parent's restaurant by construction. Each is a superset of its table's primary
-- key and therefore adds no constraint on the data; what it adds is something
-- for a two-column REFERENCES to point at.
alter table menu_item
  add constraint menu_item_scoped_key unique (id, restaurant_id);
alter table restaurant_table
  add constraint restaurant_table_scoped_key unique (id, restaurant_id);

create table table_order (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurant (id) on delete cascade,
  table_id uuid not null,
  -- The client's key for one submission. A resend carries the same one, and the
  -- unique constraint below is what makes two sends one order. Unique within a
  -- restaurant rather than globally: it is minted by a guest's browser, not
  -- printed on anything, so it needs no cross-restaurant meaning.
  submission_id uuid not null,
  placed_at timestamptz not null default now(),
  unique (restaurant_id, submission_id),
  unique (id, restaurant_id),
  foreign key (table_id, restaurant_id)
    references restaurant_table (id, restaurant_id) on delete cascade
);

create table table_order_line (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  -- Carried here as well as on the order, and the duplication is the point: it
  -- is what the policy reads without a join, and it is the column both foreign
  -- keys below pin to one restaurant.
  restaurant_id uuid not null,
  menu_item_id uuid not null,
  quantity integer not null check (quantity > 0),
  foreign key (order_id, restaurant_id)
    references table_order (id, restaurant_id) on delete cascade,
  foreign key (menu_item_id, restaurant_id)
    references menu_item (id, restaurant_id)
);

-- No update and no delete. The application inserts an order and reads it back;
-- it cannot alter one and cannot remove one. That is why the statement in
-- `sql.ts` is `on conflict ... do nothing` rather than `do update`, which
-- PostgreSQL would require the UPDATE privilege for.
grant select, insert on table_order, table_order_line to table_ordering_app;

alter table table_order enable row level security;
alter table table_order_line enable row level security;

-- Both tables, not just the order. The line table is where the food is, and the
-- foreign key that ties a line to its order is a referential-integrity check
-- that bypasses row security -- so without this second policy the application
-- role could attach lines to another restaurant's order.
--
-- `for all`, and `with check` written out beside `using` rather than left to
-- default from it: the two answer different questions, and a reader should not
-- have to know which way the default falls.
create policy table_order_scope on table_order
  for all
  using (restaurant_id = current_setting('app.restaurant_id')::uuid)
  with check (restaurant_id = current_setting('app.restaurant_id')::uuid);

create policy table_order_line_scope on table_order_line
  for all
  using (restaurant_id = current_setting('app.restaurant_id')::uuid)
  with check (restaurant_id = current_setting('app.restaurant_id')::uuid);
