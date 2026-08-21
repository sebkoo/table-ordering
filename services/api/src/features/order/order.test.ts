/**
 * The acceptance conditions for an order a guest sends from their table.
 *
 * This is the first write path in the repository, so it is the first suite whose
 * subject is a guarantee rather than a response body. Two things follow from
 * that and shape everything below.
 *
 * The first is which connection the evidence is gathered through. PostgreSQL
 * exempts a table's owner from its own policies, and exempts a superuser
 * unconditionally; `table_ordering` is both. So the application is given `app`,
 * a pool for a role that owns nothing and is not a superuser, and every
 * condition that asserts a policy goes through it. `owner` exists to build and
 * read the fixture from outside the policy -- which is also what makes C7 a
 * measurement rather than an assertion, because it compares the two.
 *
 * The second is that each condition establishes its own state. Every one mints
 * its own submission ids and every count it asserts is filtered by them, so no
 * condition's expectation is a count of rows some earlier condition left behind.
 * A condition deleted from the middle of this file changes nothing about its
 * neighbours.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../main.ts'
import { SET_SCOPE } from './sql.ts'

/**
 * The migration role, which owns the tables. `main.ts`'s default is the
 * application role instead, so this cannot be imported from there; both are
 * literals from `compose.yaml` and `0003-create-table-order.up.sql`
 * respectively, which are the files that create them.
 */
const OWNER_DATABASE_URL =
  'postgres://table_ordering:table_ordering_dev@127.0.0.1:55432/table_ordering'
const APP_ROLE = 'table_ordering_app'
const APP_PASSWORD = 'table_ordering_app_dev'

const CONNECTION_STRING = process.env.DATABASE_URL ?? OWNER_DATABASE_URL
const SCHEMA = `order_test_${process.pid}`
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations')
const MIGRATION_FILES = [
  '0001-create-menu.up.sql',
  '0002-create-restaurant-table.up.sql',
  '0003-create-table-order.up.sql',
]

function migration(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8')
}

/** The same host, port and database, reached as the role the policies apply to. */
function asAppRole(connectionString: string): string {
  const url = new URL(connectionString)
  url.username = APP_ROLE
  url.password = APP_PASSWORD
  return url.href
}

const BLUE = '11111111-1111-1111-1111-111111111111'
const RED = '22222222-2222-2222-2222-222222222222'
const BLUE_TABLE_1 = 'b0000000-0000-4000-8000-000000000001'
const BLUE_TABLE_2 = 'b0000000-0000-4000-8000-000000000002'
const RED_TABLE = 'b0000000-0000-4000-8000-000000000003'
const BLUE_CODE_1 = '9f3c1a7b20de'
const BLUE_CODE_2 = '71bd0e4c8a26'
const FLAT_WHITE = 'a0000000-0000-4000-8000-000000000001'
const CINNAMON_BUN = 'a0000000-0000-4000-8000-000000000002'
const RED_PINT = 'a0000000-0000-4000-8000-000000000003'

/** Seeded in `beforeAll` for the conditions that read a policy rather than a route. */
const SEEDED_BLUE_ORDER = 'c0000000-0000-4000-8000-000000000001'
const SEEDED_RED_ORDER = 'c0000000-0000-4000-8000-000000000002'
const SEEDED_BLUE_LINE = 'e0000000-0000-4000-8000-000000000001'
const SEEDED_RED_LINE = 'e0000000-0000-4000-8000-000000000002'

/** One per condition. A number that appears in two conditions is a coupling. */
const submission = (n: number): string => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let admin: Pool
let owner: Pool
let app: Pool
let server: FastifyInstance
let origin: string

type OrderRow = { id: string; restaurant_id: string; table_id: string }
type LineRow = { menu_item_id: string; quantity: number; restaurant_id: string }

/** Read from outside the policy, so that what a condition asserts is what is stored. */
async function ordersFor(submissionId: string): Promise<OrderRow[]> {
  const { rows } = await owner.query<OrderRow>(
    'select id, restaurant_id, table_id from table_order where submission_id = $1',
    [submissionId],
  )
  return rows
}

async function linesFor(submissionId: string): Promise<LineRow[]> {
  const { rows } = await owner.query<LineRow>(
    `select line.menu_item_id, line.quantity, line.restaurant_id
       from table_order_line line
       join table_order on table_order.id = line.order_id
      where table_order.submission_id = $1
      order by line.quantity`,
    [submissionId],
  )
  return rows
}

type Line = { menuItemId: string; quantity: number }

async function postOrder(code: string, body: unknown): Promise<Response> {
  return fetch(`${origin}/tables/${code}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function order(submissionId: string, lines: Line[]): unknown {
  return { submissionId, lines }
}

/**
 * What the route does, done by hand: one transaction that establishes its scope
 * before it touches anything. The conditions that drive SQL directly use this so
 * that the only thing separating them from the route is the statement itself.
 */
async function scoped<T>(pool: Pool, restaurantId: string, run: (c: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    // The route's own statement, imported rather than retyped. A copy here
    // would leave the conditions below pinning this file instead of the one
    // that runs in production -- and `is_local` is exactly the argument a copy
    // would go on getting right after the real one stopped.
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
    return (error as { code?: string }).code ?? 'no sqlstate'
  }
}

beforeAll(async () => {
  admin = new Pool({ connectionString: CONNECTION_STRING })
  await admin.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin.query(`create schema ${SCHEMA}`)

  owner = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path=${SCHEMA}` })
  for (const file of MIGRATION_FILES) await owner.query(migration(file))

  await owner.query(
    `insert into restaurant (id, slug, name) values
       ($1, 'blue-door', 'The Blue Door'),
       ($2, 'red-lamp', 'The Red Lamp')`,
    [BLUE, RED],
  )
  // Inserted out of menu order, so that a condition taking items[0] from the
  // menu is taking what the restaurant put first rather than what the database
  // handed back first.
  await owner.query(
    `insert into menu_item (id, restaurant_id, name, price_minor, currency, sort_order) values
       ($2, $1, 'Cinnamon bun', 450, 'GBP', 20),
       ($3, $1, 'Flat white', 300, 'GBP', 10),
       ($5, $4, 'Someone else''s pint', 550, 'GBP', 10)`,
    [BLUE, CINNAMON_BUN, FLAT_WHITE, RED, RED_PINT],
  )
  // Two tables in one restaurant, which is what makes a wrong table a different
  // failure from a wrong restaurant.
  await owner.query(
    `insert into restaurant_table (id, restaurant_id, code, label) values
       ($2, $1, $3, 'Table 7'),
       ($4, $1, $5, 'Table 8'),
       ($7, $6, '4d81e6c05a93', 'Terrace 2')`,
    [BLUE, BLUE_TABLE_1, BLUE_CODE_1, BLUE_TABLE_2, BLUE_CODE_2, RED, RED_TABLE],
  )
  // One order and one line in each restaurant, written from outside the policy.
  // They are the fixture the policy conditions measure against; no condition
  // creates them, so none depends on another having run.
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id) values
       ($1, $2, $3, $4),
       ($5, $6, $7, $8)`,
    [
      SEEDED_BLUE_ORDER,
      BLUE,
      BLUE_TABLE_1,
      submission(900),
      SEEDED_RED_ORDER,
      RED,
      RED_TABLE,
      submission(901),
    ],
  )
  await owner.query(
    `insert into table_order_line (id, order_id, restaurant_id, menu_item_id, quantity) values
       ($1, $2, $3, $4, 1),
       ($5, $6, $7, $8, 1)`,
    [
      SEEDED_BLUE_LINE,
      SEEDED_BLUE_ORDER,
      BLUE,
      FLAT_WHITE,
      SEEDED_RED_LINE,
      SEEDED_RED_ORDER,
      RED,
      RED_PINT,
    ],
  )

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

describe('the order a guest sends from their table', () => {
  it('records what the menu offered, against the table the code names', async () => {
    // Ordered from the menu the guest was served rather than from a fixture, so
    // that a menu which stopped naming its items would fail here rather than in
    // a client nobody has written yet.
    const menu = (await (await fetch(`${origin}/tables/${BLUE_CODE_1}/menu`)).json()) as {
      items: { id: string; name: string }[]
    }
    const first = menu.items[0]
    expect(first?.name).toBe('Flat white')

    const submissionId = submission(1)
    const response = await postOrder(
      BLUE_CODE_1,
      order(submissionId, [{ menuItemId: first?.id ?? '', quantity: 2 }]),
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as { order: { id: string } }
    expect(await ordersFor(submissionId)).toEqual([
      { id: body.order.id, restaurant_id: BLUE, table_id: BLUE_TABLE_1 },
    ])
    expect(await linesFor(submissionId)).toEqual([
      { menu_item_id: FLAT_WHITE, quantity: 2, restaurant_id: BLUE },
    ])
  })

  it('makes one order of two sends carrying the same submission id', async () => {
    const submissionId = submission(2)
    const body = order(submissionId, [{ menuItemId: FLAT_WHITE, quantity: 1 }])

    const first = await postOrder(BLUE_CODE_1, body)
    const second = await postOrder(BLUE_CODE_1, body)

    expect([first.status, second.status]).toEqual([201, 201])
    const ids = [
      ((await first.json()) as { order: { id: string } }).order.id,
      ((await second.json()) as { order: { id: string } }).order.id,
    ]
    expect(ids[0]).toBe(ids[1])
    // The line count is the half a status code cannot show: a resend that
    // reached the line insert would leave two.
    expect(await ordersFor(submissionId)).toHaveLength(1)
    expect(await linesFor(submissionId)).toHaveLength(1)
  })

  it('makes two orders of two sends carrying different submission ids', async () => {
    const [one, two] = [submission(3), submission(4)]
    const line = [{ menuItemId: FLAT_WHITE, quantity: 1 }]

    const first = await postOrder(BLUE_CODE_1, order(one, line))
    const second = await postOrder(BLUE_CODE_1, order(two, line))

    expect([first.status, second.status]).toEqual([201, 201])
    const ids = [
      ((await first.json()) as { order: { id: string } }).order.id,
      ((await second.json()) as { order: { id: string } }).order.id,
    ]
    expect(ids[0]).not.toBe(ids[1])
    expect(await ordersFor(one)).toHaveLength(1)
    expect(await ordersFor(two)).toHaveLength(1)
  })

  it('refuses a submission id already used at another table, and leaves it where it was', async () => {
    const submissionId = submission(5)
    const body = order(submissionId, [{ menuItemId: FLAT_WHITE, quantity: 1 }])

    const first = await postOrder(BLUE_CODE_1, body)
    const elsewhere = await postOrder(BLUE_CODE_2, body)

    expect([first.status, elsewhere.status]).toEqual([201, 409])
    // Not moved and not duplicated. A statement that assigned the table on
    // conflict would answer 201 here and quietly send the food to Table 8.
    const stored = await ordersFor(submissionId)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.table_id).toBe(BLUE_TABLE_1)
    expect(await linesFor(submissionId)).toHaveLength(1)
  })

  it("refuses a line naming an item on another restaurant's menu, and writes nothing", async () => {
    const submissionId = submission(6)

    const response = await postOrder(
      BLUE_CODE_1,
      order(submissionId, [
        { menuItemId: FLAT_WHITE, quantity: 1 },
        { menuItemId: RED_PINT, quantity: 1 },
      ]),
    )

    expect(response.status).toBe(422)
    // Both halves: the order this request would have created, and the line that
    // was legitimate. A transaction that committed the first line before the
    // second failed would leave one of each.
    expect(await ordersFor(submissionId)).toEqual([])
    expect(await linesFor(submissionId)).toEqual([])
  })

  it('refuses a code no table is served at, and writes nothing', async () => {
    const submissionId = submission(7)

    const response = await postOrder(
      '000000000000',
      order(submissionId, [{ menuItemId: FLAT_WHITE, quantity: 1 }]),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'no table is served at 000000000000' })
    expect(await ordersFor(submissionId)).toEqual([])
  })

  it('refuses a body its schema rejects, before anything is written', async () => {
    const [zero, empty] = await Promise.all([
      postOrder(BLUE_CODE_1, order(submission(8), [{ menuItemId: FLAT_WHITE, quantity: 0 }])),
      postOrder(BLUE_CODE_1, order(submission(9), [])),
    ])

    expect([zero.status, empty.status]).toEqual([400, 400])
    expect(await ordersFor(submission(8))).toEqual([])
    expect(await ordersFor(submission(9))).toEqual([])
  })
})

describe('the policy the application writes under', () => {
  // The condition this whole slice turns on. It is a comparison rather than an
  // assertion: the same two tables, counted through the role that owns them and
  // through the role the application uses. A policy that is not applying makes
  // the two equal, which is exactly what a suite connected as the owner would
  // report while proving nothing.
  it('shows the application role one restaurant of the two the owner can see', async () => {
    const orders = [submission(900), submission(901)]
    const lines = [SEEDED_BLUE_LINE, SEEDED_RED_LINE]
    // Lines are counted by their own ids rather than through their orders. A
    // count that reached them by joining to `table_order` would be filtered by
    // the order policy on the way, and would report 1 whether or not the line
    // table had a policy of its own -- which is the half of this the food is on.
    const COUNTS = `
      select (select count(*) from table_order where submission_id = any($1)) as orders,
             (select count(*) from table_order_line where id = any($2)) as lines`

    const asOwner = await owner.query<{ orders: string; lines: string }>(COUNTS, [orders, lines])
    const asApp = await scoped(app, BLUE, (client) =>
      client.query<{ orders: string; lines: string }>(COUNTS, [orders, lines]),
    )

    expect(asOwner.rows[0]).toEqual({ orders: '2', lines: '2' })
    expect(asApp.rows[0]).toEqual({ orders: '1', lines: '1' })
  })

  it("refuses an order written into another restaurant's scope", async () => {
    const code = await sqlstate(() =>
      scoped(app, BLUE, (client) =>
        client.query(
          `insert into table_order (restaurant_id, table_id, submission_id) values ($1, $2, $3)`,
          [RED, RED_TABLE, submission(10)],
        ),
      ),
    )

    expect(code).toBe('42501')
    expect(await ordersFor(submission(10))).toEqual([])
  })

  // The line table has its own policy, and this is what says so. Both parents it
  // names are real -- a genuine Red Lamp order and a genuine Red Lamp item -- so
  // that a foreign key cannot be what refuses the row. Without that, this
  // condition would pass with no policy on the table at all.
  it("refuses a line written into another restaurant's scope", async () => {
    const code = await sqlstate(() =>
      scoped(app, BLUE, (client) =>
        client.query(
          `insert into table_order_line (order_id, restaurant_id, menu_item_id, quantity)
           values ($1, $2, $3, 1)`,
          [SEEDED_RED_ORDER, RED, RED_PINT],
        ),
      ),
    )

    expect(code).toBe('42501')
  })

  // Two observations off one connection, which is what makes the second one
  // possible: a placeholder that has been set once stays defined for the
  // session and reverts to the empty string, so the codes differ. A `set_config`
  // that was not local would leave the previous scope in place and the second
  // insert would succeed, silently, in a restaurant this request never named.
  it('refuses a statement that establishes no scope, on a fresh connection and on a used one', async () => {
    const unscoped = new Pool({
      connectionString: asAppRole(CONNECTION_STRING),
      options: `-c search_path=${SCHEMA}`,
      max: 1,
    })

    try {
      const insert = (submissionId: string) =>
        unscoped.query(
          `insert into table_order (restaurant_id, table_id, submission_id) values ($1, $2, $3)`,
          [BLUE, BLUE_TABLE_1, submissionId],
        )

      const virgin = await sqlstate(() => insert(submission(11)))
      await scoped(unscoped, BLUE, (client) =>
        client.query(
          `insert into table_order (restaurant_id, table_id, submission_id) values ($1, $2, $3)`,
          [BLUE, BLUE_TABLE_1, submission(12)],
        ),
      )
      const used = await sqlstate(() => insert(submission(13)))

      expect([virgin, used]).toEqual(['42704', '22P02'])
    } finally {
      await unscoped.end()
    }
  })

  // The privilege boundary, asserted rather than left to the grant clause. The
  // statement in `sql.ts` is `on conflict ... do nothing` because `do update`
  // would need UPDATE; this is what stops that being restored by widening a
  // grant instead of by changing the statement.
  it('gives the application role no way to alter or remove an order', async () => {
    const update = await sqlstate(() =>
      scoped(app, BLUE, (client) => client.query('update table_order set placed_at = now()')),
    )
    const remove = await sqlstate(() =>
      scoped(app, BLUE, (client) => client.query('delete from table_order')),
    )

    expect([update, remove]).toEqual(['42501', '42501'])
  })
})

describe('the down migration', () => {
  // A schema of its own, because this condition destroys what it runs against,
  // and it is taken all the way back and forward again: a down that leaves a
  // constraint behind passes a `to_regclass` check on the tables and then fails
  // the next `up`, which is the run a developer resetting a scratch database
  // actually makes.
  const DOWN_SCHEMA = `order_down_test_${process.pid}`
  const DOWN_FILES = [
    '0003-create-table-order.down.sql',
    '0002-create-restaurant-table.down.sql',
    '0001-create-menu.down.sql',
  ]

  it('removes what the up migrations created, and lets them be applied again', async () => {
    await admin.query(`drop schema if exists ${DOWN_SCHEMA} cascade`)
    await admin.query(`create schema ${DOWN_SCHEMA}`)
    const scratch = new Pool({
      connectionString: CONNECTION_STRING,
      options: `-c search_path=${DOWN_SCHEMA}`,
    })

    const present = async () => {
      const { rows } = await scratch.query(
        `select to_regclass('${DOWN_SCHEMA}.table_order') as table_order,
                to_regclass('${DOWN_SCHEMA}.table_order_line') as table_order_line,
                (select count(*) from pg_policies where schemaname = '${DOWN_SCHEMA}')::int as policies,
                (select count(*) from pg_constraint c
                   join pg_class t on t.oid = c.conrelid
                   join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = '${DOWN_SCHEMA}' and c.conname like '%_scoped_key')::int as keys`,
      )
      return rows[0]
    }

    try {
      for (const file of MIGRATION_FILES) await scratch.query(migration(file))
      // Rows, so the drops run against a populated schema rather than an empty
      // one: what a developer resets is never empty.
      // One statement per call: `pg` sends a parameterised query through the
      // extended protocol, which carries exactly one command, and a batch like
      // the one in `menu.test.ts` only works because it takes no parameters.
      await scratch.query(`insert into restaurant (id, slug, name) values ($1, 'down-door', $2)`, [
        BLUE,
        'The Down Door',
      ])
      await scratch.query(
        `insert into menu_item (id, restaurant_id, name, price_minor, currency, sort_order)
         values ($2, $1, 'Last orders', 100, 'GBP', 10)`,
        [BLUE, FLAT_WHITE],
      )
      await scratch.query(
        `insert into restaurant_table (id, restaurant_id, code, label)
         values ($2, $1, 'c02b95fd7e41', 'Table 1')`,
        [BLUE, BLUE_TABLE_1],
      )
      await scratch.query(
        `insert into table_order (id, restaurant_id, table_id, submission_id)
         values ($1, $2, $3, $4)`,
        [SEEDED_BLUE_ORDER, BLUE, BLUE_TABLE_1, submission(902)],
      )
      await scratch.query(
        `insert into table_order_line (order_id, restaurant_id, menu_item_id, quantity)
         values ($1, $2, $3, 3)`,
        [SEEDED_BLUE_ORDER, BLUE, FLAT_WHITE],
      )
      expect(await present()).toEqual({
        table_order: 'table_order',
        table_order_line: 'table_order_line',
        policies: 2,
        keys: 2,
      })

      for (const file of DOWN_FILES) await scratch.query(migration(file))
      expect(await present()).toEqual({
        table_order: null,
        table_order_line: null,
        policies: 0,
        keys: 0,
      })

      for (const file of MIGRATION_FILES) await scratch.query(migration(file))
      expect(await present()).toEqual({
        table_order: 'table_order',
        table_order_line: 'table_order_line',
        policies: 2,
        keys: 2,
      })
    } finally {
      await scratch.end()
      await admin.query(`drop schema if exists ${DOWN_SCHEMA} cascade`)
    }
  })
})
