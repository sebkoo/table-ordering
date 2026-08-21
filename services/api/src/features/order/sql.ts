/**
 * The statements an order is written with, in the order the route sends them.
 *
 * Only the first is unscoped. It is the query AGENTS.md already records as the
 * exception -- the one with no restaurant to scope by, because it is the query
 * that finds the restaurant. Everything after it runs under
 * `app.restaurant_id`, which is set from the row this one returned and never
 * from anything the caller sent.
 */

/** The one unscoped read. `restaurant_table` carries no policy, which is what lets it run first. */
export const TABLE_FOR_CODE = `
  select restaurant_table.id as table_id, restaurant_table.restaurant_id
  from restaurant_table
  where restaurant_table.code = $1
`

export type TableRow = {
  table_id: string
  restaurant_id: string
}

/**
 * The scope, as a parameter. `SET LOCAL` cannot take one, so the value would
 * have to be interpolated into the statement text -- and the whole point of this
 * setting is that it comes from a row rather than from a string somebody built.
 * The third argument is `is_local`: it reverts at commit or rollback, so a
 * pooled connection cannot carry one request's restaurant into the next.
 */
export const SET_SCOPE = `select set_config('app.restaurant_id', $1, true)`

/**
 * The order, if this submission id has not been seen before.
 *
 * `do nothing` rather than `do update`. `do update` would take a lock, which is
 * what recommends it, but it also assigns -- and assigning the table would move
 * an existing order to whichever table resent the submission id, which is the
 * corruption this slice is against. It would also need the UPDATE privilege,
 * which the application role deliberately does not have.
 *
 * What `do nothing` costs is that a concurrent first send can leave this
 * returning no row while the row it conflicted with is not yet visible. The
 * route answers that by running the whole transaction again, once.
 *
 * Returning no row is also how the route knows a send is a resend, which is
 * exact and needs no system column.
 */
export const CLAIM_ORDER = `
  insert into table_order (restaurant_id, table_id, submission_id)
  values ($1, $2, $3)
  on conflict (restaurant_id, submission_id) do nothing
  returning id
`

/**
 * The order that submission id already names. The predicate does not mention the
 * restaurant: that is the policy's job now, and adding it back would be the
 * query carrying a scope it is no longer responsible for.
 */
export const ORDER_FOR_SUBMISSION = `
  select id, table_id from table_order where submission_id = $1
`

export type OrderRow = {
  id: string
  table_id: string
}

/**
 * Every line of one order, as one statement, with the items and quantities
 * arriving as two arrays rather than as a built-up list of placeholders.
 *
 * Nothing here filters. An item belonging to another restaurant is refused by
 * `table_order_line_menu_item_id_restaurant_id_fkey`, which is a constraint on
 * the row rather than a predicate in this text -- so it holds however this
 * statement is later rewritten, and it cannot be quietly lost by editing a
 * `where` clause. A policy could not do this job: PostgreSQL runs referential
 * integrity as the table's owner, and those checks bypass row security.
 */
export const ADD_LINES = `
  insert into table_order_line (order_id, restaurant_id, menu_item_id, quantity)
  select $1, $2, line.menu_item_id, line.quantity
  from unnest($3::uuid[], $4::integer[]) as line(menu_item_id, quantity)
`

/** `foreign_key_violation`. On this transaction it has exactly one cause; see {@link ADD_LINES}. */
export const FOREIGN_KEY_VIOLATION = '23503'
