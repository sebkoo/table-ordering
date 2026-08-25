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
 */
export const SESSION_FOR_DIGEST = `
  select staff.name as staff_name,
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
  staff_name: string
  restaurant_slug: string
  restaurant_name: string
}
