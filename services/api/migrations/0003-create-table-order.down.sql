-- The line table first: its foreign key to `table_order` holds until it is gone.
-- Both policies go with the tables that carry them, so there is no `drop policy`
-- here -- a policy has no existence apart from its table.
drop table table_order_line;
drop table table_order;

-- The keys added to tables this migration did not create. Without these, running
-- down and up again fails on `constraint ... already exists`, which is the
-- failure the up file relies on for re-application and not one a reset should
-- meet.
alter table restaurant_table drop constraint restaurant_table_scoped_key;
alter table menu_item drop constraint menu_item_scoped_key;

-- Table privileges went with the tables. These did not.
revoke select on restaurant, menu_item, restaurant_table from table_ordering_app;
do $$
begin
  execute format('revoke usage on schema %I from table_ordering_app', current_schema());
end
$$;

-- The role itself stays. It is cluster-wide, so dropping it here would reach
-- every other schema in the same cluster -- including a concurrent test run --
-- and on a deployment it was created by the deployer with a real secret before
-- this migration ever ran, which makes it not this file's to remove.
