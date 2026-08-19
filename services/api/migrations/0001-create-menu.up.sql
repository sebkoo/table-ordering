-- The first schema: a restaurant, and the items a guest sees on its menu.
--
-- Prices are an integer count of the currency's minor unit with the ISO 4217
-- code stored beside them. A flat white at three pounds is 300 GBP, never
-- 3.00: a float cannot hold a price exactly, and a decimal string carries no
-- unit, so neither can be added up or compared without knowing what it meant.

create table restaurant (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null
);

create table menu_item (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurant (id) on delete cascade,
  name text not null,
  price_minor integer not null check (price_minor >= 0),
  currency char(3) not null check (currency = upper(currency)),
  available boolean not null default true,
  sort_order integer not null
);

-- A menu is always read whole, for one restaurant, in the restaurant's order.
create index menu_item_menu_order on menu_item (restaurant_id, sort_order);
