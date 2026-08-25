-- The people who work in a restaurant, and the sessions they are recognised by.
--
-- This is the first thing in the schema that authorises rather than identifies.
-- A printed code says which table a request is about; a credential says who is
-- making it, and the restaurant it reaches follows from the row rather than
-- from anything the request carries.
--
-- NEITHER TABLE CARRIES A POLICY, and that is a decision rather than an
-- omission. Every policy in `0003` reads `app.restaurant_id`, which is set from
-- the row a printed code resolved to. A credential is what tells you the
-- restaurant, so a policy on the table you resolve a credential through would
-- have to be satisfied before the scope it defines could be known. Writing
-- `current_setting(..., true)` to get past that would make an unscoped read
-- answer with no rows instead of being refused, which is the failure `0003`'s
-- `::uuid` cast exists to prevent. So these are resolve tables, in the position
-- `restaurant`, `restaurant_table` and `menu_item` already hold: no policy, and
-- the scope is the query's job.
--
-- What ties a session to one restaurant is therefore the composite foreign key
-- below and not a policy. It is the stronger of the two here: a policy can only
-- compare a column with the transaction's scope, while the invariant is that
-- two columns of one row agree with each other -- a session's restaurant is its
-- staff member's restaurant. PostgreSQL runs referential integrity as the
-- table's owner, so that key holds for a path that forgets to set a scope, for
-- a session that never had one, and for whatever writes this table next.
-- ADR 0029.
--
-- The role is created and granted usage in `0003`, so there is nothing to do
-- for it here beyond the two grants at the foot of this file.

create table staff (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurant (id) on delete cascade,
  -- Unique across restaurants rather than within one, for the same reason
  -- `restaurant_table.code` is: a sign-in carries no other segment to
  -- disambiguate it, and it must not carry one -- a request that named a
  -- restaurant would be a request that could name somebody else's.
  email text not null unique,
  -- What the room calls this person out loud, which is what a page shows.
  name text not null,
  -- The stored form of a password, never a password: the algorithm, its three
  -- parameters, the salt and the derived key. The parameters are in the value
  -- rather than in the code so that raising them does not invalidate a row
  -- minted under the old ones. `credential.ts` owns the format.
  credential text not null,
  -- The foreign key target below. A superset of the primary key, so it
  -- constrains no data; what it adds is something for a two-column REFERENCES
  -- to point at. `0003` added the same pair to `menu_item` and
  -- `restaurant_table` as `alter table`, because those tables predated it.
  unique (id, restaurant_id)
);

create table staff_session (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  -- Carried here as well as on the staff row, and the duplication is the point:
  -- it is the column the composite key pins, and it is what a later scoped read
  -- would read without a join.
  restaurant_id uuid not null,
  -- The token's SHA-256, never the token. A 32-byte random value has no
  -- guessing space to protect, so a digest is enough and no slow derivation is
  -- warranted; what it buys is that a dump of this table holds nothing anybody
  -- can present.
  token_digest bytea not null unique,
  opened_at timestamptz not null default now(),
  -- Set by the insert rather than defaulted here, so the interval lives beside
  -- the statement in `staff/sql.ts` and is written down once.
  expires_at timestamptz not null,
  foreign key (staff_id, restaurant_id)
    references staff (id, restaurant_id) on delete cascade
);

-- Read to verify a credential, read and inserted to open a session. No update
-- and no delete on either: nothing in the application changes a staff row, and
-- closing a session is a thing no client can ask for yet.
grant select on staff to table_ordering_app;
grant select, insert on staff_session to table_ordering_app;
