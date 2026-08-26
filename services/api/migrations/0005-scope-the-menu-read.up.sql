-- The menu, read under a policy instead of under a predicate.
--
-- `0003` put the order tables under row level security and left this one alone,
-- and said why: bringing the read path under a policy means the code lookup and
-- the menu read become two statements in a transaction, which is a change to the
-- menu slice rather than to that one. This is that change's half of the schema.
--
-- WHY THIS TABLE AND NOT THE OTHER TWO. `restaurant` and `restaurant_table` are
-- what a slug and a printed code are resolved through, and a policy on a table
-- you resolve through is circular: it would have to be satisfied before the scope
-- it defines could be known. `menu_item` is resolved through by nothing. It is
-- read after a scope exists on both paths -- a guest's resolved code, a staff
-- session's resolved row -- so its no-policy state was never structural, only
-- historical. `0004` recorded the three tables in one list, and ADR 0033 draws
-- the line that list folded together.
--
-- SELECT AND NOTHING ELSE, which is not a narrower version of `0003`'s `for all`
-- but the only clause with a subject here. The application role holds `select` on
-- `menu_item` and no other privilege, and the one writer is the operator seeding a
-- menu as the owner -- whom PostgreSQL does not bind to a table's own policies.
-- A `with check` clause would therefore govern statements no grant permits and no
-- connection makes, which is a policy announcing security it does not provide.
-- Enabling row level security is itself the refusal for the rest: with no policy
-- for insert, update or delete, the application role has none.
--
-- The `using` clause is `0003`'s, character for character, and for `0003`'s
-- reasons. `current_setting` with one argument raises 42704 on a connection that
-- has never been scoped, and the `::uuid` cast raises 22P02 on the empty string
-- the setting reverts to afterwards, so a read that establishes no scope is
-- refused rather than answered with nothing. Comparing `restaurant_id::text`
-- with the setting instead would create cleanly and then match no rows in
-- silence.

alter table menu_item enable row level security;

create policy menu_item_scope on menu_item
  for select
  using (restaurant_id = current_setting('app.restaurant_id')::uuid);
