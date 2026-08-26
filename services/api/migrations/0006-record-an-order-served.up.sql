-- The moment a ticket was served, and the one column the application may set.
--
-- Until this migration "open" was a fact about time alone: `0003` recorded when
-- an order was placed and nothing else, so a ticket the kitchen had already sent
-- out stayed on the board until the window expired. `0026` and `0030` both
-- deferred a status column to "the first thing staff can do to an order rather
-- than the first thing they can see", and this is that thing.
--
-- A MOMENT RATHER THAN A STATE. `served_at` is null until the kitchen clears the
-- ticket and carries the time it did afterwards, which answers "is this still
-- outstanding" and "when did it go" with one column. A status enum would carry
-- more states than the product has behaviours -- the board needs exactly two --
-- and would record no moment, so the second question would need this column
-- anyway. ADR 0034.
--
-- NO POLICY WORK. `0003` put `table_order` under `table_order_scope`, which is
-- `for all`: its `using` clause decides which rows an UPDATE may reach and its
-- `with check` clause decides what those rows may become, and this update moves
-- no `restaurant_id`, so a row that satisfies the first satisfies the second.
-- The policy that scopes the board's read is already the policy that scopes this
-- write, and adding one here would be a second answer to a question that has one.
--
-- THE GRANT IS COLUMN-SCOPED, and it is the first in this schema that is. The
-- application role holds `update` on `served_at` and on no other column, so a
-- statement setting `restaurant_id`, `table_id`, `submission_id` or `placed_at`
-- is refused with 42501 before any policy is consulted -- by the privilege
-- rather than by review, which is what makes it hold for a statement nobody
-- read. `0003`'s comment that this schema has "no update and no delete" is what
-- this narrows, and it narrows it by one column.
--
-- NO INDEX. The predicate the board reads with gains `served_at is null`, and an
-- index for it would be a guess: nothing is deployed, so no plan has been
-- measured and a restaurant's open orders inside the window are bounded by how
-- fast a kitchen can be ordered from. It arrives with the first board that is
-- slow to load, which is the trigger ADR 0030 already put on pagination.

alter table table_order add column served_at timestamptz;

grant update (served_at) on table_order to table_ordering_app;
