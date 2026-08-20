-- The table a guest is sitting at, and the code printed on it.
--
-- `restaurant_table`, not `table`: `table` is a reserved word, and quoting it
-- at every use is a cost paid forever to save one word here.
--
-- The code is the whole of what a printed card carries, so it is unique across
-- restaurants rather than within one: the URL a guest opens has no other
-- segment to disambiguate it. It is a literal supplied at insert and never a
-- generated default -- a value the database invents differs in every
-- environment, which leaves a test with no known code to open and a printed
-- card with no way to be reproduced.
--
-- It is not a secret. A string printed on a table in a public room identifies
-- that table and authorises nothing; whatever later lets a guest order has to
-- say so itself rather than infer it from possession of this.
--
-- The label is what the room calls the table out loud, and the page shows it
-- verbatim. It is deliberately not in the URL: renumbering a table would
-- otherwise mean reprinting a card whose code is still perfectly good.

create table restaurant_table (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurant (id) on delete cascade,
  code text not null unique,
  label text not null,
  unique (restaurant_id, label)
);
