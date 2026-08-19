/**
 * GET /restaurants/:slug/menu — what a guest's phone asks for after scanning.
 *
 * The response schema below is the contract, not documentation of it: Fastify
 * serialises through it, so a field that is not named here cannot reach a
 * guest even if the query starts returning it. Prices cross the wire as an
 * integer count of the currency's minor unit, the same way they are stored.
 */

import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { MENU_FOR_RESTAURANT, type MenuRow } from './sql.ts'

const SLUG = { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 64 }

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
      properties: {
        restaurant: {
          type: 'object',
          required: ['slug', 'name'],
          properties: { slug: { type: 'string' }, name: { type: 'string' } },
        },
        items: {
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
        },
      },
    },
    404: {
      type: 'object',
      required: ['error'],
      properties: { error: { type: 'string' } },
    },
  },
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

        // A row with null item columns is the left join reporting a restaurant
        // with nothing available, which is an empty menu rather than a 404.
        const items = []
        for (const row of rows) {
          if (row.item_name === null || row.price_minor === null || row.currency === null) continue
          items.push({ name: row.item_name, priceMinor: row.price_minor, currency: row.currency })
        }

        return { restaurant: { slug, name: first.restaurant_name }, items }
      },
    )
  }
}
