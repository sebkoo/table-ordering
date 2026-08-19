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
  item_name: string | null
  price_minor: number | null
  currency: string | null
}
