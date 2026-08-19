/**
 * The acceptance condition for the menu a guest fetches.
 *
 * Everything here is the real thing: the migration file is applied to a real
 * PostgreSQL, the application is the one `main.ts` starts, and the requests go
 * over a real socket. A fixture standing in for any of those would be able to
 * hold a state the running system cannot reach, and would then agree with
 * itself while a guest saw something else.
 *
 * Each run gets its own schema, so a failed run leaves nothing behind that the
 * next one has to clean up, and two runs cannot collide in one database.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, DEFAULT_DATABASE_URL } from '../../main.ts'

const CONNECTION_STRING = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
const SCHEMA = `menu_test_${process.pid}`
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations')

function migration(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8')
}

let admin: Pool
let pool: Pool
let app: FastifyInstance
let origin: string

beforeAll(async () => {
  admin = new Pool({ connectionString: CONNECTION_STRING })
  await admin.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin.query(`create schema ${SCHEMA}`)

  pool = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path=${SCHEMA}` })
  await pool.query(migration('0001-create-menu.up.sql'))

  await pool.query(`
    insert into restaurant (id, slug, name) values
      ('11111111-1111-1111-1111-111111111111', 'blue-door', 'The Blue Door'),
      ('22222222-2222-2222-2222-222222222222', 'red-lamp', 'The Red Lamp'),
      ('33333333-3333-3333-3333-333333333333', 'green-hut', 'The Green Hut')
  `)
  // Inserted out of menu order, so passing proves the query orders rather than
  // that the rows happened to arrive in the right sequence.
  await pool.query(`
    insert into menu_item (restaurant_id, name, price_minor, currency, available, sort_order) values
      ('11111111-1111-1111-1111-111111111111', 'Cinnamon bun', 450, 'GBP', true, 20),
      ('11111111-1111-1111-1111-111111111111', 'Flat white', 300, 'GBP', true, 10),
      ('11111111-1111-1111-1111-111111111111', 'Sold out soup', 600, 'GBP', false, 5),
      ('22222222-2222-2222-2222-222222222222', 'Someone else''s pint', 550, 'GBP', true, 10),
      ('33333333-3333-3333-3333-333333333333', 'Yesterday''s pie', 700, 'GBP', false, 10)
  `)

  app = buildApp(pool)
  origin = await app.listen({ port: 0, host: '127.0.0.1' })
})

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await admin?.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin?.end()
})

describe('the menu a guest fetches', () => {
  it('serves the restaurant and its available items, in the order the restaurant chose', async () => {
    const response = await fetch(`${origin}/restaurants/blue-door/menu`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    // One assertion covers three exclusions: the unavailable item is absent,
    // the other restaurants' items are absent, and 10 precedes 20.
    expect(await response.json()).toEqual({
      restaurant: { slug: 'blue-door', name: 'The Blue Door' },
      items: [
        { name: 'Flat white', priceMinor: 300, currency: 'GBP' },
        { name: 'Cinnamon bun', priceMinor: 450, currency: 'GBP' },
      ],
    })
  })

  it('serves an empty menu, not a 404, when a real restaurant has nothing available', async () => {
    const response = await fetch(`${origin}/restaurants/green-hut/menu`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      restaurant: { slug: 'green-hut', name: 'The Green Hut' },
      items: [],
    })
  })

  it('answers a slug no restaurant uses with 404', async () => {
    const response = await fetch(`${origin}/restaurants/no-such-place/menu`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'no restaurant is served at no-such-place' })
  })
})

describe('the down migration', () => {
  // Last on purpose: it removes the schema the tests above run against. A down
  // section nobody executes is a claim rather than a check.
  it('removes what the up migration created', async () => {
    await pool.query(migration('0001-create-menu.down.sql'))

    const { rows } = await pool.query<{ menu_item: string | null; restaurant: string | null }>(
      "select to_regclass('menu_item') as menu_item, to_regclass('restaurant') as restaurant",
    )
    expect(rows[0]).toEqual({ menu_item: null, restaurant: null })
  })
})
