/**
 * The menu a guest is shown, as one query.
 *
 * The join is a LEFT JOIN on purpose. An inner join cannot tell a restaurant
 * that does not exist from a restaurant whose every item is unavailable: both
 * come back as zero rows, and the route would have to answer 404 to a guest
 * sitting in a real restaurant that has sold out. With a left join the first
 * case is zero rows and the second is one row whose item columns are null.
 *
 * Unavailable items are excluded in the join condition rather than in a WHERE
 * clause, because a WHERE clause on the right-hand table of a left join
 * discards the null row it is there to produce.
 */
export const MENU_FOR_RESTAURANT = `
  select
    restaurant.name as restaurant_name,
    menu_item.id as item_id,
    menu_item.name as item_name,
    menu_item.price_minor,
    menu_item.currency
  from restaurant
  left join menu_item
    on menu_item.restaurant_id = restaurant.id
    and menu_item.available
  where restaurant.slug = $1
  order by menu_item.sort_order
`

/** One row of {@link MENU_FOR_RESTAURANT}. The item columns are null when the restaurant has no available item. */
export type MenuRow = {
  restaurant_name: string
  /** What an order names a line by. A menu that did not carry it could not be ordered from. */
  item_id: string | null
  item_name: string | null
  price_minor: number | null
  currency: string | null
}

/**
 * The same menu, reached by the code printed on a table.
 *
 * This is the one query in the system with no restaurant to scope by, because
 * it is the query that finds the restaurant. That is the recorded exception to
 * "a restaurant's rows are read only through a query scoped to that
 * restaurant": the scope arrives with the first join and applies from there on,
 * so the items come from `restaurant_table.restaurant_id` and never from
 * anything the caller sent. A code names one table, and a table names one
 * restaurant, so nothing the guest types can widen it.
 *
 * The left join and the availability filter in its condition are the same
 * shape, and are there for the same reason, as {@link MENU_FOR_RESTAURANT}: a
 * real table whose kitchen has sold out is not a code nobody is served at.
 */
export const MENU_FOR_TABLE = `
  select
    restaurant.slug as restaurant_slug,
    restaurant.name as restaurant_name,
    restaurant_table.label as table_label,
    menu_item.id as item_id,
    menu_item.name as item_name,
    menu_item.price_minor,
    menu_item.currency
  from restaurant_table
  join restaurant
    on restaurant.id = restaurant_table.restaurant_id
  left join menu_item
    on menu_item.restaurant_id = restaurant_table.restaurant_id
    and menu_item.available
  where restaurant_table.code = $1
  order by menu_item.sort_order
`

/** One row of {@link MENU_FOR_TABLE}. The item columns go null on the same condition. */
export type TableMenuRow = MenuRow & {
  restaurant_slug: string
  table_label: string
}
