/**
 * The statements a staff session is opened and read with.
 *
 * Both reads here are unscoped, and that is what this slice is: a credential is
 * a global value, so the query that resolves one is the query with no
 * restaurant to scope by -- the same position `TABLE_FOR_CODE` holds for a
 * printed code. Every statement after it takes its restaurant from the row one
 * of these returned.
 *
 * Neither table carries a policy, and it is not an omission. A policy on
 * `staff` or `staff_session` would have to be satisfied before the scope it
 * defines could be known, because the credential is what says which restaurant
 * the request is for. What ties a session to one restaurant is instead the
 * composite foreign key in `0004-create-staff.up.sql`, which holds under
 * referential integrity and therefore holds for whatever writes this table
 * next. ADR 0029.
 */

/**
 * The one query a sign-in has. The email is unique across restaurants rather
 * than within one, for the reason a table's code is: the request carries no
 * other segment to disambiguate it, and it must not, because a request that
 * named a restaurant would be a request that could name someone else's.
 */
export const STAFF_FOR_EMAIL = `
  select staff.id as staff_id,
         staff.restaurant_id,
         staff.name as staff_name,
         staff.credential,
         restaurant.slug as restaurant_slug,
         restaurant.name as restaurant_name
  from staff
  join restaurant on restaurant.id = staff.restaurant_id
  where staff.email = $1
`

export type StaffRow = {
  staff_id: string
  restaurant_id: string
  staff_name: string
  credential: string
  restaurant_slug: string
  restaurant_name: string
}

/**
 * How long a session stays open.
 *
 * A shift, rather than forever: the token is a bearer value, and a bearer value
 * with no end is a permanent secret held by whoever last had it. It cannot be
 * renewed and there is nothing that closes one early -- both wait on a client
 * that can ask, which is the first staff page. ADR 0029 carries the value's
 * reasoning and its deferrals.
 *
 * Unlike the order slice's window, this is not a value a guest reads, so it is
 * stated here and in the record and is restated nowhere a person could edit it
 * out of agreement.
 */
export const SESSION_LIFETIME = '12 hours'

/**
 * The session, written with the restaurant from the row the credential resolved
 * to. Nothing here comes from the request but the derived digest, and the
 * composite key refuses a pair the resolve did not produce together.
 */
export const OPEN_SESSION = `
  insert into staff_session (staff_id, restaurant_id, token_digest, expires_at)
  values ($1, $2, $3, now() + $4::interval)
`

/**
 * Who a token names, or no row.
 *
 * The digest is matched whole and by equality. `expires_at` is part of the
 * predicate rather than a check the caller makes afterwards, so a session that
 * has run out is a session this query does not return -- there is no state in
 * which the row is in hand and the decision is still to be made.
 *
 * The join to `staff` carries `restaurant_id` as well as `id`. The composite
 * key already makes a straddling row unrepresentable; naming both columns here
 * means this query would return nothing rather than the wrong name if one ever
 * existed.
 *
 * `restaurant_id` is selected as well as joined on, because this is the request's
 * one query with no restaurant to scope by and the board is what scopes itself
 * from what it returns. It is taken from `staff` rather than from
 * `staff_session`: the join makes the two equal, and every value this query
 * answers with then comes from the staff row and the restaurant it belongs to.
 * `GET /staff/sessions/current` does not read it, and `CURRENT_SCHEMA` does not
 * name it, so it reaches no client.
 */
export const SESSION_FOR_DIGEST = `
  select staff.restaurant_id,
         staff.name as staff_name,
         restaurant.slug as restaurant_slug,
         restaurant.name as restaurant_name
  from staff_session
  join staff
    on staff.id = staff_session.staff_id
   and staff.restaurant_id = staff_session.restaurant_id
  join restaurant on restaurant.id = staff.restaurant_id
  where staff_session.token_digest = $1
    and staff_session.expires_at > now()
`

export type SessionRow = {
  restaurant_id: string
  staff_name: string
  restaurant_slug: string
  restaurant_name: string
}

/**
 * Every open order in the restaurant on the transaction's scope, with the table
 * each was placed at and the lines on it.
 *
 * Nothing here names a restaurant, and that is the whole of the evidence this
 * statement carries. `table_order` and `table_order_line` hold `for all`
 * policies and `menu_item` a `for select` one since `0005`. Every one of them
 * reads `app.restaurant_id`, set from the row {@link SESSION_FOR_DIGEST}
 * returned, so a predicate here would be the statement taking back the job those
 * policies now have -- and on a connection that has never carried the setting the
 * read is refused rather than answered with nothing.
 *
 * The window is the guest read's `OPEN_WINDOW`, imported rather than restated.
 * A second constant for the same idea is the drift ADR 0028 exists to prevent.
 * "Open" means recent, here as there: no column records that an order has been
 * served, and nothing can write one until staff can act rather than only look.
 *
 * `restaurant_table` carries no policy and cannot -- it is what a printed code is
 * resolved through -- so its join scopes itself, against `o.restaurant_id`, which
 * the policy has already filtered, and never against anything the caller sent. It
 * is an inner join and cannot drop an order: `table_id` is `not null` and its
 * composite foreign key guarantees the row. The second column on the join to
 * `menu_item` is kept on the same terms the guest's read keeps its own: written
 * for the invariant it serves, and now unobservable beside the policy. ADR 0033.
 *
 * The two joins below `restaurant_table` are LEFT, so an order with nothing on it
 * arrives as one row with null line columns rather than vanishing.
 *
 * The sort is `OPEN_ORDERS_AT_TABLE`'s four terms unchanged, so the board reads
 * oldest first, which is the order a kitchen works.
 */
export const OPEN_ORDERS_IN_RESTAURANT = `
  select
    o.id as order_id,
    t.label as table_label,
    line.quantity,
    item.name as item_name
  from table_order o
  join restaurant_table t
    on t.id = o.table_id
   and t.restaurant_id = o.restaurant_id
  left join table_order_line line
    on line.order_id = o.id
  left join menu_item item
    on item.id = line.menu_item_id
   and item.restaurant_id = line.restaurant_id
  where o.placed_at > now() - $1::interval
  order by o.placed_at, o.id, item.sort_order, item.name
`

/** One row of {@link OPEN_ORDERS_IN_RESTAURANT}. The line columns are null for an order with no lines. */
export type BoardRow = {
  order_id: string
  table_label: string
  quantity: number | null
  item_name: string | null
}
