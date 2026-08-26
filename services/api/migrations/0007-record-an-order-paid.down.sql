-- The column, and with it the grant.
--
-- As `0006`: a column privilege has no existence apart from its column, so
-- dropping the column takes the `update (paid_at)` grant with it, and naming the
-- revoke first would fail on the way back up.
--
-- The second down file in the sequence that discards data rather than structure.
-- The moments already recorded are lost and there is nowhere else they are kept,
-- which is the honest cost of the column and not a reason to skip the file.
alter table table_order drop column paid_at;
