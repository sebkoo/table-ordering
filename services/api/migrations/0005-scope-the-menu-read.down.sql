-- The policy first: it has no existence apart from its table, but this migration
-- did not create the table and must not drop it, so unlike `0003` and `0004` the
-- policy is named here. Without this the file leaves the policy behind, `up`
-- fails on `policy "menu_item_scope" for table "menu_item" already exists`, and
-- that is the run a developer resetting a scratch database actually makes.
drop policy menu_item_scope on menu_item;

-- And the flag the policy hung on. A table left with row level security enabled
-- and no policy answers the application role nothing at all, which is a state no
-- `to_regclass` check can see.
alter table menu_item disable row level security;
