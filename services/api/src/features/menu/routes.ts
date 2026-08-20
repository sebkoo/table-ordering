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
 */

import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { MENU_FOR_RESTAURANT, MENU_FOR_TABLE, type MenuRow, type TableMenuRow } from './sql.ts'

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
    required: ['name', 'priceMinor', 'currency'],
    properties: {
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
 * A row with null item columns is the left join reporting a restaurant with
 * nothing available, which is an empty menu rather than a 404. Both queries
 * produce that row for the same reason, so both read it the same way.
 */
function availableItems(rows: readonly MenuRow[]) {
  const items = []
  for (const row of rows) {
    if (row.item_name === null || row.price_minor === null || row.currency === null) continue
    items.push({ name: row.item_name, priceMinor: row.price_minor, currency: row.currency })
  }
  return items
}

export function menuRoutes(pool: Pool) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get<{ Params: { slug: string } }>(
      '/restaurants/:slug/menu',
      { schema: MENU_SCHEMA },
      async (request, reply) => {
        const { slug } = request.params
        const { rows } = await pool.query<MenuRow>(MENU_FOR_RESTAURANT, [slug])

        const first = rows[0]
        if (first === undefined) {
          return reply.code(404).send({ error: `no restaurant is served at ${slug}` })
        }

        return { restaurant: { slug, name: first.restaurant_name }, items: availableItems(rows) }
      },
    )

    app.get<{ Params: { code: string } }>(
      '/tables/:code/menu',
      { schema: TABLE_MENU_SCHEMA },
      async (request, reply) => {
        const { code } = request.params
        const { rows } = await pool.query<TableMenuRow>(MENU_FOR_TABLE, [code])

        const first = rows[0]
        if (first === undefined) {
          return reply.code(404).send({ error: `no table is served at ${code}` })
        }

        // The slug comes back from the row rather than from the request: the
        // caller sent a code, and which restaurant it belongs to is the
        // query's answer, not the caller's claim.
        return {
          restaurant: { slug: first.restaurant_slug, name: first.restaurant_name },
          table: { label: first.table_label },
          items: availableItems(rows),
        }
      },
    )
  }
}
