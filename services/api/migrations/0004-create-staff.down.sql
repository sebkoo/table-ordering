-- The session table first: its foreign key to `staff` holds until it is gone.
-- Both tables are created here, so their privileges go with them and there is
-- nothing to revoke -- unlike `0003`, which granted on tables it did not create.
drop table staff_session;
drop table staff;
