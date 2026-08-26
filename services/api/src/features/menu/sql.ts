/**
 * The statements a menu is read with, in the order the routes send them.
 *
 * Only the first of each pair is unscoped, and each is the query AGENTS.md
 * records as the exception -- the one with no restaurant to scope by, because it
 * is the query that finds the restaurant. What follows it runs under
 * `app.restaurant_id`, set from the row that resolve returned and never from
 * anything the caller sent.
 *
 * Until `0005` this slice had one statement per route: the slug or the printed
 * code sat in the `where` clause of the same select that returned the items, so
 * the read scoped itself. That worked and could not be extended -- a statement
 * that carries its own restaurant is a statement a later edit can quietly widen,
 * and nothing would go red. ADR 0033.
 */

/**
 * The one unscoped read on the slug path. `restaurant` carries no policy, which
 * is what lets it run first, and it cannot carry one: it is what a slug is
 * resolved through, so a policy on it would have to be satisfied before the
 * scope it defines could be known.
 */
export const RESTAURANT_FOR_SLUG = `
  select restaurant.id as restaurant_id, restaurant.name as restaurant_name
  from restaurant
  where restaurant.slug = $1
`

export type RestaurantRow = {
  restaurant_id: string
  restaurant_name: string
}

/**
 * The one unscoped read on the printed-code path, which is the address a card
 * carries. A code names one table and a table names one restaurant, so nothing
 * the guest types can widen it.
 *
 * It answers the slug as well as the id, because the response names the
 * restaurant and the caller sent a code rather than a slug -- which restaurant it
 * belongs to is this query's answer, not the caller's claim. The label comes back
 * with it so the page can name where the guest is sitting.
 */
export const RESTAURANT_FOR_TABLE_CODE = `
  select restaurant.id as restaurant_id,
         restaurant.slug as restaurant_slug,
         restaurant.name as restaurant_name,
         restaurant_table.label as table_label
  from restaurant_table
  join restaurant
    on restaurant.id = restaurant_table.restaurant_id
  where restaurant_table.code = $1
`

export type TableRestaurantRow = RestaurantRow & {
  restaurant_slug: string
  table_label: string
}

/**
 * The menu itself, and it names no restaurant.
 *
 * That is the point of this change rather than an omission from the statement:
 * `menu_item` carries `menu_item_scope`, whose `using` clause is this read's
 * scope, set on the transaction from the row the resolve returned. A predicate
 * here would be the statement taking back a job the policy now has, and on a
 * connection that has never carried the setting the read is refused rather than
 * answered with nothing.
 *
 * There is no join and no left join. Whether a restaurant exists is what the
 * resolve answers; whether it has anything available is what this answers, and a
 * restaurant that has sold out returns no row rather than one row full of nulls.
 * The fused statement this replaces needed a `LEFT JOIN` to tell those two apart
 * in one pass, and separating them is what retires it.
 */
export const MENU_ITEMS = `
  select id, name, price_minor, currency
  from menu_item
  where available
  order by sort_order
`

/** One row of {@link MENU_ITEMS}. Nothing here is nullable: every column is `not null` and no join can widen it. */
export type MenuItemRow = {
  /** What an order names a line by. A menu that did not carry it could not be ordered from. */
  id: string
  name: string
  price_minor: number
  currency: string
}
