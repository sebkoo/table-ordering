-- Dropping menu_item first is not optional: restaurant is its parent, and the
-- foreign key holds until the child table is gone.
drop table menu_item;
drop table restaurant;
