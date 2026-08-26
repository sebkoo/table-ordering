/**
 * The two ways a guest reaches a menu.
 *
 * `GET /restaurants/:slug/menu` is a restaurant's menu with no table in it.
 * `GET /tables/:code/menu` is what the code printed on a table resolves to, and
 * it is the one a card carries: it answers with the table's own label as well,
 * so the page can name where the guest is sitting.
 *
 * The response schemas below are the contract, not documentation of it: Fastify
 * serialises through them, so a field that is not named cannot reach a guest
 * even if the query starts returning it. Prices cross the wire as an integer
 * count of the currency's minor unit, the same way they are stored.
 *
 * Both routes answer a parameter their pattern rejects with 400 and a
 * parameter that names nothing with 404. They are different answers to a guest
 * -- one address cannot name a table, the other names no table that exists --
 * and the page tells them apart rather than folding both into one.
 *
 * Each is one transaction, in the shape the order and board reads already have:
 * resolve what the caller holds, set the scope from the row that resolve
 * returned, then read a statement that names no restaurant. What scopes the menu
 * is `menu_item_scope` rather than a predicate anybody has to remember, and a
 * read that establishes no scope is refused rather than answered with nothing.
 * ADR 0033.
 */

import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { SET_SCOPE } from '../order/sql.ts'
import {
  MENU_ITEMS,
  type MenuItemRow,
  RESTAURANT_FOR_SLUG,
  RESTAURANT_FOR_TABLE_CODE,
  type RestaurantRow,
  type TableRestaurantRow,
} from './sql.ts'

const SLUG = { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 64 }

/**
 * A printed code, which is the whole of the address a card carries. The pattern
 * bounds what a URL segment may hold; it cannot say the code is hard to guess,
 * and nothing here can. That property belongs to whoever mints the code.
 */
const TABLE_CODE = { type: 'string', pattern: '^[a-z0-9]{8,64}$' }

const RESTAURANT = {
  type: 'object',
  required: ['slug', 'name'],
  properties: { slug: { type: 'string' }, name: { type: 'string' } },
}

const ITEMS = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'name', 'priceMinor', 'currency'],
    properties: {
      // The id is here because an order has to name a line by something, and a
      // name is not unique within a restaurant. It identifies a row and
      // authorises nothing: `POST /tables/:code/orders` accepts it only for an
      // item the resolved restaurant serves.
      id: { type: 'string' },
      name: { type: 'string' },
      priceMinor: { type: 'integer' },
      currency: { type: 'string' },
    },
  },
}

const NOT_FOUND = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
}

const MENU_SCHEMA = {
  params: {
    type: 'object',
    required: ['slug'],
    properties: { slug: SLUG },
  },
  response: {
    200: {
      type: 'object',
      required: ['restaurant', 'items'],
      properties: { restaurant: RESTAURANT, items: ITEMS },
    },
    404: NOT_FOUND,
  },
}

const TABLE_MENU_SCHEMA = {
  params: {
    type: 'object',
    required: ['code'],
    properties: { code: TABLE_CODE },
  },
  response: {
    200: {
      type: 'object',
      required: ['restaurant', 'table', 'items'],
      properties: {
        restaurant: RESTAURANT,
        // The label, and not the code. The guest already holds the code; what
        // the page needs is the name the room uses out loud.
        table: {
          type: 'object',
          required: ['label'],
          properties: { label: { type: 'string' } },
        },
        items: ITEMS,
      },
    },
    404: NOT_FOUND,
  },
}

/**
 * The menu of whatever the resolve found, or null when it found nothing.
 *
 * One transaction, and the resolve is the only statement in it with no
 * restaurant to scope by. `SET_SCOPE` is imported from the order slice rather
 * than restated here: it is one statement with one meaning, and a second copy of
 * it would be a second place to get `is_local` wrong.
 *
 * null is a slug or a code that names nothing, which is a 404. An empty list is a
 * restaurant that exists and has nothing available, which is a 200 -- and the two
 * are told apart by which statement came back empty rather than by reading nulls
 * out of a left join.
 */
async function menuOf<Row extends RestaurantRow>(
  pool: Pool,
  resolve: string,
  held: string,
): Promise<{ restaurant: Row; items: MenuItemRow[] } | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows } = await client.query<Row>(resolve, [held])
    const restaurant = rows[0]
    if (restaurant === undefined) {
      await client.query('rollback')
      return null
    }

    // From here on nothing is scoped by hand. The restaurant came from the row
    // above, and the statement below is checked against it by a policy.
    await client.query(SET_SCOPE, [restaurant.restaurant_id])
    const items = await client.query<MenuItemRow>(MENU_ITEMS)

    await client.query('commit')
    return { restaurant, items: items.rows }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/** The wire shape of a menu item. The prices cross as they are stored: minor units beside the code. */
function items(rows: readonly MenuItemRow[]) {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priceMinor: row.price_minor,
    currency: row.currency,
  }))
}

export function menuRoutes(pool: Pool) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get<{ Params: { slug: string } }>(
      '/restaurants/:slug/menu',
      { schema: MENU_SCHEMA },
      async (request, reply) => {
        const { slug } = request.params
        const menu = await menuOf<RestaurantRow>(pool, RESTAURANT_FOR_SLUG, slug)

        if (menu === null) {
          return reply.code(404).send({ error: `no restaurant is served at ${slug}` })
        }

        return {
          restaurant: { slug, name: menu.restaurant.restaurant_name },
          items: items(menu.items),
        }
      },
    )

    app.get<{ Params: { code: string } }>(
      '/tables/:code/menu',
      { schema: TABLE_MENU_SCHEMA },
      async (request, reply) => {
        const { code } = request.params
        const menu = await menuOf<TableRestaurantRow>(pool, RESTAURANT_FOR_TABLE_CODE, code)

        if (menu === null) {
          return reply.code(404).send({ error: `no table is served at ${code}` })
        }

        // The slug comes back from the row rather than from the request: the
        // caller sent a code, and which restaurant it belongs to is the
        // resolve's answer, not the caller's claim.
        const { restaurant } = menu
        return {
          restaurant: { slug: restaurant.restaurant_slug, name: restaurant.restaurant_name },
          table: { label: restaurant.table_label },
          items: items(menu.items),
        }
      },
    )
  }
}
