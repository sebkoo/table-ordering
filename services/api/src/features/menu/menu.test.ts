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
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../main.ts'
import { SET_SCOPE } from '../order/sql.ts'
import { MENU_ITEMS, type MenuItemRow } from './sql.ts'

/**
 * The migration role, which owns the tables. `main.ts`'s default is the
 * application role, so it is no longer what a schema is created with; both are
 * literals from `compose.yaml` and `0003-create-table-order.up.sql`, which are
 * the files that create them.
 */
const OWNER_DATABASE_URL =
  'postgres://table_ordering:table_ordering_dev@127.0.0.1:55432/table_ordering'
const APP_ROLE = 'table_ordering_app'
const APP_PASSWORD = 'table_ordering_app_dev'

const CONNECTION_STRING = process.env.DATABASE_URL ?? OWNER_DATABASE_URL
const SCHEMA = `menu_test_${process.pid}`

/** The same database, reached as the role the application uses and the policies apply to. */
function asAppRole(connectionString: string): string {
  const url = new URL(connectionString)
  url.username = APP_ROLE
  url.password = APP_PASSWORD
  return url.href
}

/**
 * Item ids are literals here because the menu now carries them and an order
 * names one. A default would leave the assertions below unable to say which
 * item came back.
 */
const FLAT_WHITE = 'a0000000-0000-4000-8000-000000000001'
const CINNAMON_BUN = 'a0000000-0000-4000-8000-000000000002'
const SOLD_OUT_SOUP = 'a0000000-0000-4000-8000-000000000003'
const OTHER_PINT = 'a0000000-0000-4000-8000-000000000004'
const YESTERDAYS_PIE = 'a0000000-0000-4000-8000-000000000005'

/**
 * The restaurants, named because the policy condition below has to say which
 * scope a read ran under, and a scope is a restaurant's id rather than its slug.
 */
const BLUE = '11111111-1111-1111-1111-111111111111'
const RED = '22222222-2222-2222-2222-222222222222'
const GREEN = '33333333-3333-3333-3333-333333333333'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations')

/**
 * The whole migration prefix, not the subset this suite reaches.
 *
 * `0004` creates tables nothing here reads and `0005` alters one every condition
 * here does. A list chosen by which files a suite touches was serviceable while
 * every migration was a `create`; an `alter` makes the omission silent, because
 * a suite whose list skips it passes against a schema that exists nowhere. ADR 0033.
 */
const MIGRATION_FILES = [
  '0001-create-menu.up.sql',
  '0002-create-restaurant-table.up.sql',
  '0003-create-table-order.up.sql',
  '0004-create-staff.up.sql',
  '0005-scope-the-menu-read.up.sql',
]

const DOWN_FILES = [
  '0005-scope-the-menu-read.down.sql',
  '0004-create-staff.down.sql',
  '0003-create-table-order.down.sql',
  '0002-create-restaurant-table.down.sql',
  '0001-create-menu.down.sql',
]

function migration(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8')
}

/**
 * What the route does, done by hand: one transaction that establishes its scope
 * before it touches anything. `SET_SCOPE` is imported rather than retyped, so
 * the condition below pins the statement that runs in production.
 */
async function scoped<T>(pool: Pool, restaurantId: string, run: (c: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(SET_SCOPE, [restaurantId])
    const result = await run(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/**
 * The SQLSTATE a statement was refused with, or the string `no error`. A code is
 * a value, so a condition asserting one fails as a difference between two
 * strings rather than as an exception nobody compared.
 */
async function sqlstate(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'no error'
  } catch (error) {
    return String((error as { code?: string }).code)
  }
}

let admin: Pool
let owner: Pool
let app: Pool
let server: FastifyInstance
let origin: string

beforeAll(async () => {
  admin = new Pool({ connectionString: CONNECTION_STRING })
  await admin.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin.query(`create schema ${SCHEMA}`)

  owner = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path=${SCHEMA}` })
  for (const file of MIGRATION_FILES) await owner.query(migration(file))

  await owner.query(`
    insert into restaurant (id, slug, name) values
      ('${BLUE}', 'blue-door', 'The Blue Door'),
      ('${RED}', 'red-lamp', 'The Red Lamp'),
      ('${GREEN}', 'green-hut', 'The Green Hut')
  `)
  // Inserted out of menu order, so passing proves the query orders rather than
  // that the rows happened to arrive in the right sequence.
  await owner.query(`
    insert into menu_item (id, restaurant_id, name, price_minor, currency, available, sort_order) values
      ('${CINNAMON_BUN}', '${BLUE}', 'Cinnamon bun', 450, 'GBP', true, 20),
      ('${FLAT_WHITE}', '${BLUE}', 'Flat white', 300, 'GBP', true, 10),
      ('${SOLD_OUT_SOUP}', '${BLUE}', 'Sold out soup', 600, 'GBP', false, 5),
      ('${OTHER_PINT}', '${RED}', 'Someone else''s pint', 550, 'GBP', true, 10),
      ('${YESTERDAYS_PIE}', '${GREEN}', 'Yesterday''s pie', 700, 'GBP', false, 10)
  `)
  // Codes are literals, the way a printed card carries one. They are opaque on
  // purpose: nothing in the schema or the route stops a code spelling out its
  // table, and an example that did would be the template the next reader copies.
  await owner.query(`
    insert into restaurant_table (restaurant_id, code, label) values
      ('${BLUE}', '9f3c1a7b20de', 'Table 7'),
      ('${GREEN}', '4d81e6c05a93', 'Terrace 2')
  `)

  // The application's own pool, as `main.ts` builds it: a role that owns nothing
  // and is not a superuser. That is what the policy on `menu_item` applies to,
  // and it is what makes a missing grant fail here rather than in a deployment.
  app = new Pool({
    connectionString: asAppRole(CONNECTION_STRING),
    options: `-c search_path=${SCHEMA}`,
  })
  server = buildApp(app)
  origin = await server.listen({ port: 0, host: '127.0.0.1' })
})

afterAll(async () => {
  await server?.close()
  await app?.end()
  await owner?.end()
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
        { id: FLAT_WHITE, name: 'Flat white', priceMinor: 300, currency: 'GBP' },
        { id: CINNAMON_BUN, name: 'Cinnamon bun', priceMinor: 450, currency: 'GBP' },
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

  // The route has carried this pattern since it was written and nothing has
  // ever run it. 400 and 404 are different answers -- the first says the
  // address cannot name a restaurant, the second that none is served there --
  // and only one of them was being checked.
  it('answers a slug the pattern rejects with 400, not 404', async () => {
    const response = await fetch(`${origin}/restaurants/Blue_Door/menu`)

    expect(response.status).toBe(400)
  })
})

describe('the menu a guest fetches at their table', () => {
  it("serves the table's restaurant, its label and the items it is serving", async () => {
    const response = await fetch(`${origin}/tables/9f3c1a7b20de/menu`)

    expect(response.status).toBe(200)
    // One assertion covers four exclusions: the unavailable item is absent, the
    // other restaurants' items are absent, 10 precedes 20, and the label
    // belongs to the table the code names rather than to the restaurant.
    expect(await response.json()).toEqual({
      restaurant: { slug: 'blue-door', name: 'The Blue Door' },
      table: { label: 'Table 7' },
      items: [
        { id: FLAT_WHITE, name: 'Flat white', priceMinor: 300, currency: 'GBP' },
        { id: CINNAMON_BUN, name: 'Cinnamon bun', priceMinor: 450, currency: 'GBP' },
      ],
    })
  })

  it('serves an empty menu, not a 404, when the table is real and nothing is available', async () => {
    const response = await fetch(`${origin}/tables/4d81e6c05a93/menu`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      restaurant: { slug: 'green-hut', name: 'The Green Hut' },
      table: { label: 'Terrace 2' },
      items: [],
    })
  })

  it('answers a code no table uses with 404', async () => {
    const response = await fetch(`${origin}/tables/000000000000/menu`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'no table is served at 000000000000' })
  })

  it('answers a code the pattern rejects with 400, not 404', async () => {
    const response = await fetch(`${origin}/tables/NOT-A-CODE/menu`)

    expect(response.status).toBe(400)
  })
})

describe('the menu under the policy', () => {
  // The condition this change turns on, and it is a comparison rather than an
  // assertion: one statement, three scopes. A statement that scoped itself would
  // answer the same under both restaurants, and a policy that was not applying
  // would too. The third is the invariant: a read that establishes no scope is
  // refused rather than answered with nothing.
  it('is scoped by the policy rather than by the statement', async () => {
    const read = (client: PoolClient) => client.query<MenuItemRow>(MENU_ITEMS)

    const owning = await scoped(app, BLUE, read)
    const other = await scoped(app, RED, read)

    // A pool of its own, because the code a missing scope raises depends on the
    // connection's history: one that has never carried the setting raises 42704,
    // and one that has reads back the empty string and fails the cast with 22P02.
    // The two reads above have just scoped a connection on `app`.
    const unscoped = new Pool({
      connectionString: asAppRole(CONNECTION_STRING),
      options: `-c search_path=${SCHEMA}`,
      max: 1,
    })
    let none: string
    try {
      none = await sqlstate(() => unscoped.query(MENU_ITEMS))
    } finally {
      await unscoped.end()
    }

    // Two available at The Blue Door and one sold out, one available at The Red
    // Lamp. The unavailable rows are what stop the counts being a row total.
    expect([owning.rowCount, other.rowCount, none]).toEqual([2, 1, '42704'])
  })
})

describe('the down migrations', () => {
  // A schema of its own, because this condition destroys what it runs against.
  // Sharing the one above would make it depend on being declared last, and an
  // ordering nothing states is an ordering nothing preserves. A down section
  // nobody executes is a claim rather than a check.
  //
  // Taken all the way back and forward again, the shape `staff.test.ts` uses: a
  // down that leaves something behind passes a `to_regclass` check and then fails
  // the next `up`. That matters more here than it did there. `0005` creates no
  // table, so `to_regclass` cannot see it at all: what it leaves behind is a
  // policy and a flag on a table that stays, and re-applying is the only thing
  // that reports either.
  const DOWN_SCHEMA = `menu_down_test_${process.pid}`

  it('remove what the up migrations created, newest first, and let them be applied again', async () => {
    await admin.query(`drop schema if exists ${DOWN_SCHEMA} cascade`)
    await admin.query(`create schema ${DOWN_SCHEMA}`)
    const scratch = new Pool({
      connectionString: CONNECTION_STRING,
      options: `-c search_path=${DOWN_SCHEMA}`,
    })

    // Whether `menu_item` is policed, read from the catalogue rather than
    // inferred from a statement's behaviour: the flag and the count answer
    // separately, so a down that drops the policy and leaves the flag is a
    // different value here rather than the same one.
    const policed = async () => {
      const { rows } = await scratch.query(`
        select relrowsecurity,
               (select count(*)::int from pg_policy
                 where polrelid = to_regclass('${DOWN_SCHEMA}.menu_item')) as policies
        from pg_class where oid = to_regclass('${DOWN_SCHEMA}.menu_item')
      `)
      return rows[0]
    }

    try {
      for (const file of MIGRATION_FILES) await scratch.query(migration(file))
      // Rows, so the drops run against a populated schema rather than an empty
      // one: what a developer resets is never empty.
      await scratch.query(`
        insert into restaurant (id, slug, name)
          values ('44444444-4444-4444-4444-444444444444', 'down-door', 'The Down Door');
        insert into menu_item (restaurant_id, name, price_minor, currency, sort_order)
          values ('44444444-4444-4444-4444-444444444444', 'Last orders', 100, 'GBP', 10);
        insert into restaurant_table (restaurant_id, code, label)
          values ('44444444-4444-4444-4444-444444444444', 'c02b95fd7e41', 'Table 1');
      `)
      const applied = await policed()

      await scratch.query(migration('0005-scope-the-menu-read.down.sql'))
      const reversed = await policed()

      // Applied again on the table its first application left in place, which is
      // the whole of what a down that dropped nothing would break.
      await scratch.query(migration('0005-scope-the-menu-read.up.sql'))
      const reapplied = await policed()

      expect([applied, reversed, reapplied]).toEqual([
        { relrowsecurity: true, policies: 1 },
        { relrowsecurity: false, policies: 0 },
        { relrowsecurity: true, policies: 1 },
      ])

      for (const file of DOWN_FILES) await scratch.query(migration(file))

      const { rows } = await scratch.query(`
        select
          to_regclass('${DOWN_SCHEMA}.restaurant_table') as restaurant_table,
          to_regclass('${DOWN_SCHEMA}.menu_item') as menu_item,
          to_regclass('${DOWN_SCHEMA}.restaurant') as restaurant
      `)
      expect(rows[0]).toEqual({ restaurant_table: null, menu_item: null, restaurant: null })
    } finally {
      await scratch.end()
      await admin.query(`drop schema if exists ${DOWN_SCHEMA} cascade`)
    }
  })
})
