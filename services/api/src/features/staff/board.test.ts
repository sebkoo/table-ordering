/**
 * The acceptance conditions for the board: what a member of staff is shown of
 * their own restaurant's orders, and what they are not shown of anybody else's.
 *
 * Four restaurants are seeded rather than two, and the reason is the breaks
 * rather than the behaviour. On one shared fixture a single mutation reddens
 * every condition at once, and a condition that only ever reddens beside five
 * others is evidence about nothing in particular. Keeping the compared pair, the
 * window pair and the empty restaurant apart gives each condition a mutation
 * that reaches it alone.
 *
 * The window fixtures are placed by arithmetic on `OPEN_WINDOW` rather than at a
 * literal age. A row seeded at "100 minutes" knows the window is two hours, and
 * the claim that these conditions bracket whatever the constant says would not
 * be true of it. The margin is five minutes, so the derivation holds while the
 * window is longer than that and stops meaning anything if it ever is not.
 *
 * One credential record is derived and reused across the four staff rows. The
 * board reads that column never, so four derivations would buy nothing but the
 * time -- and reusing a record `hashPassword` actually produced is not the
 * hand-written fixture `staff.test.ts` argues against.
 *
 * A file of its own rather than more of `staff.test.ts`: that file dominates the
 * api step, so a second file overlaps inside the step instead of adding to it,
 * and the identity conditions go on running against the fixture they were
 * written for rather than one grown with tables and orders they do not use.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../main.ts'
import { OPEN_WINDOW, SET_SCOPE } from '../order/sql.ts'
import { digestToken, hashPassword, mintToken } from './credential.ts'
import { type BoardRow, OPEN_ORDERS_IN_RESTAURANT } from './sql.ts'

const OWNER_DATABASE_URL =
  'postgres://table_ordering:table_ordering_dev@127.0.0.1:55432/table_ordering'
const APP_ROLE = 'table_ordering_app'
const APP_PASSWORD = 'table_ordering_app_dev'

const CONNECTION_STRING = process.env.DATABASE_URL ?? OWNER_DATABASE_URL
const SCHEMA = `board_test_${process.pid}`
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations')
const MIGRATION_FILES = [
  '0001-create-menu.up.sql',
  '0002-create-restaurant-table.up.sql',
  '0003-create-table-order.up.sql',
  '0004-create-staff.up.sql',
  '0005-scope-the-menu-read.up.sql',
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

/**
 * Four restaurants, each with the one job it is here for.
 *
 * BLUE and RED are the pair the wrong-restaurant condition compares, and BLUE is
 * what a hard-coded answer would say, which is why RED is the half that can tell
 * them apart. GREEN is the board with nothing on it. AMBER holds the pair that
 * brackets the window, so that widening the window reddens the window condition
 * and nothing else.
 */
const BLUE = '11111111-1111-1111-1111-111111111111'
const RED = '22222222-2222-2222-2222-222222222222'
const GREEN = '33333333-3333-3333-3333-333333333333'
const AMBER = '44444444-4444-4444-4444-444444444444'

const ADA = 'f0000000-0000-4000-8000-000000000001'
const BO = 'f0000000-0000-4000-8000-000000000002'
const CY = 'f0000000-0000-4000-8000-000000000003'
const DEE = 'f0000000-0000-4000-8000-000000000004'

const ADA_EMAIL = 'ada@blue-door.example'

/** Minted, not chosen, in the shape the run steps mint one. */
const BLUE_CODE_1 = '9f3c1a7b20de'
const BLUE_CODE_2 = '4d81e6c05a93'
const GREEN_CODE = 'c17a4f9e2b06'
const AMBER_CODE = '5e2b8d43a1fc'
const RED_CODE = 'a83f6021d7b4'

const BLUE_TABLE_1 = 'b0000000-0000-4000-8000-000000000001'
const BLUE_TABLE_2 = 'b0000000-0000-4000-8000-000000000002'
const RED_TABLE = 'b0000000-0000-4000-8000-000000000003'
const GREEN_TABLE = 'b0000000-0000-4000-8000-000000000004'
const AMBER_TABLE = 'b0000000-0000-4000-8000-000000000005'

const FLAT_WHITE = 'c0000000-0000-4000-8000-000000000001'
const CINNAMON_BUN = 'c0000000-0000-4000-8000-000000000002'
const RED_PINT = 'c0000000-0000-4000-8000-000000000003'
const AMBER_SOUP = 'c0000000-0000-4000-8000-000000000004'

/**
 * The two Blue Door orders are inserted by one statement, so they share a
 * transaction time and the sort falls through to the id. These two are ordered,
 * so which comes back first is decidable rather than incidental.
 */
const BLUE_ORDER_1 = 'a0000000-0000-4000-8000-000000000001'
const BLUE_ORDER_2 = 'a0000000-0000-4000-8000-000000000002'
const RED_ORDER = 'a0000000-0000-4000-8000-000000000003'
const AMBER_INSIDE = 'a0000000-0000-4000-8000-000000000004'
const AMBER_OUTSIDE = 'a0000000-0000-4000-8000-000000000005'

const submission = (n: number): string => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Signed in for once, by the one condition whose token the API mints. */
const ADA_PASSWORD = 'fixture-password-for-ada'

const CLOSED = 'that session is not open'

/**
 * The last character changed, at equal length. A truncating comparison, a length
 * check and a prefix test all call the two equal; only a comparison of the whole
 * value tells them apart.
 */
function nearMiss(value: string): string {
  const last = value.slice(-1)
  return `${value.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`
}

let admin: Pool
let owner: Pool
let app: Pool
let server: FastifyInstance
let origin: string

/** The tokens the sessions were seeded from. Held so a condition can present one. */
const tokens: Record<string, string> = {}
let credential = ''

type BoardOrder = {
  id: string
  table: { label: string }
  lines: { name: string; quantity: number }[]
}
type Board = { orders: BoardOrder[] }

async function board(token: string | null): Promise<Response> {
  return fetch(`${origin}/staff/orders`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })
}

/**
 * An order as its id and what is on it. The table is another condition's subject.
 *
 * `orders ?? []` rather than `orders`: a body of another shape -- an error, a
 * route that is not there -- has to arrive as a value that differs from the
 * expected one, not as a TypeError halfway through reading it. An exception
 * names nothing about what the route answered.
 */
function rounds(answer: Partial<Board>): string[][] {
  return (answer.orders ?? []).map((order) => [
    order.id,
    order.lines.map((line) => `${line.quantity} × ${line.name}`).join(', '),
  ])
}

/**
 * What the route does, done by hand: one transaction that establishes its scope
 * before it touches anything. `SET_SCOPE` is imported rather than retyped, so
 * the conditions below pin the statement that runs in production.
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
    return (error as { code?: string }).code ?? 'no sqlstate'
  }
}

const OPEN_SESSION_ROW = `
  insert into staff_session (staff_id, restaurant_id, token_digest, expires_at)
  values ($1, $2, $3, now() + interval '1 hour')`

beforeAll(async () => {
  admin = new Pool({ connectionString: CONNECTION_STRING })
  await admin.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin.query(`create schema ${SCHEMA}`)

  owner = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path=${SCHEMA}` })
  for (const file of MIGRATION_FILES) await owner.query(migration(file))

  await owner.query(
    `insert into restaurant (id, slug, name) values
       ($1, 'blue-door', 'The Blue Door'),
       ($2, 'red-lamp', 'The Red Lamp'),
       ($3, 'green-yard', 'The Green Yard'),
       ($4, 'amber-room', 'The Amber Room')`,
    [BLUE, RED, GREEN, AMBER],
  )

  await owner.query(
    `insert into menu_item (id, restaurant_id, name, price_minor, currency, sort_order) values
       ($1, $5, 'Flat white', 300, 'GBP', 10),
       ($2, $5, 'Cinnamon bun', 450, 'GBP', 20),
       ($3, $6, 'Someone else''s pint', 550, 'GBP', 10),
       ($4, $7, 'Soup of the day', 600, 'GBP', 10)`,
    [FLAT_WHITE, CINNAMON_BUN, RED_PINT, AMBER_SOUP, BLUE, RED, AMBER],
  )

  await owner.query(
    `insert into restaurant_table (id, restaurant_id, code, label) values
       ($1, $6, $10, 'Table 7'),
       ($2, $6, $11, 'Table 8'),
       ($3, $7, $12, 'Terrace 2'),
       ($4, $8, $13, 'Bench 1'),
       ($5, $9, $14, 'Table 3')`,
    [
      BLUE_TABLE_1,
      BLUE_TABLE_2,
      RED_TABLE,
      GREEN_TABLE,
      AMBER_TABLE,
      BLUE,
      RED,
      GREEN,
      AMBER,
      BLUE_CODE_1,
      BLUE_CODE_2,
      RED_CODE,
      GREEN_CODE,
      AMBER_CODE,
    ],
  )

  // One derivation, four rows. Only Ada ever signs in, and the column the other
  // three carry is read by nothing here.
  credential = await hashPassword(ADA_PASSWORD)
  await owner.query(
    `insert into staff (id, restaurant_id, email, name, credential) values
       ($1, $5, $9, 'Ada', $13),
       ($2, $6, $10, 'Bo', $13),
       ($3, $7, $11, 'Cy', $13),
       ($4, $8, $12, 'Dee', $13)`,
    [
      ADA,
      BO,
      CY,
      DEE,
      BLUE,
      RED,
      GREEN,
      AMBER,
      ADA_EMAIL,
      'bo@red-lamp.example',
      'cy@green-yard.example',
      'dee@amber-room.example',
      credential,
    ],
  )

  // Sessions written as digests rather than signed in for. The board reads the
  // row a digest resolves to, and how the row got there is not its subject --
  // except in the one condition where it is, which signs in.
  for (const [staff, restaurant] of [
    [ADA, BLUE],
    [BO, RED],
    [CY, GREEN],
    [DEE, AMBER],
  ] as const) {
    const token = mintToken()
    tokens[staff] = token
    await owner.query(OPEN_SESSION_ROW, [staff, restaurant, digestToken(token)])
  }

  // One statement, so both share a transaction time and the sort falls to the id.
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id) values
       ($1, $5, $6, $3),
       ($2, $5, $7, $4)`,
    [
      BLUE_ORDER_1,
      BLUE_ORDER_2,
      submission(910),
      submission(911),
      BLUE,
      BLUE_TABLE_1,
      BLUE_TABLE_2,
    ],
  )
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id) values ($1, $2, $3, $4)`,
    [RED_ORDER, RED, RED_TABLE, submission(912)],
  )

  // The window pair, placed by arithmetic on the constant the route passes. A
  // window that moved would move these with it; a literal age would not.
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id, placed_at) values
       ($1, $6, $7, $3, now() - $5::interval + interval '5 minutes'),
       ($2, $6, $7, $4, now() - $5::interval - interval '5 minutes')`,
    [
      AMBER_INSIDE,
      AMBER_OUTSIDE,
      submission(913),
      submission(914),
      OPEN_WINDOW,
      AMBER,
      AMBER_TABLE,
    ],
  )

  await owner.query(
    `insert into table_order_line (order_id, restaurant_id, menu_item_id, quantity) values
       ($1, $8, $5, 2),
       ($2, $8, $6, 1),
       ($3, $9, $7, 1),
       ($4, $10, $11, 3),
       ($12, $10, $11, 4)`,
    [
      BLUE_ORDER_1,
      BLUE_ORDER_2,
      RED_ORDER,
      AMBER_INSIDE,
      FLAT_WHITE,
      CINNAMON_BUN,
      RED_PINT,
      BLUE,
      RED,
      AMBER,
      AMBER_SOUP,
      AMBER_OUTSIDE,
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

describe('the orders a staff session reaches', () => {
  // The condition this change exists for, and the row it closes in ADR 0029's
  // coverage map. It is a comparison rather than an assertion: a board hard-coded
  // to The Blue Door answers Ada correctly, and only Bo can tell the two apart.
  // Neither request carries a field naming a restaurant.
  it("answers each restaurant its own orders, and never the other's", async () => {
    const [forAda, forBo] = await Promise.all([
      board(tokens[ADA] ?? null),
      board(tokens[BO] ?? null),
    ])
    const answers = [
      rounds((await forAda.json()) as Partial<Board>),
      rounds((await forBo.json()) as Partial<Board>),
    ]

    expect([forAda.status, forBo.status, answers]).toEqual([
      200,
      200,
      [
        [
          [BLUE_ORDER_1, '2 × Flat white'],
          [BLUE_ORDER_2, '1 × Cinnamon bun'],
        ],
        [[RED_ORDER, "1 × Someone else's pint"]],
      ],
    ])
  })

  // One statement, three scopes. A statement that scoped itself would answer the
  // same under both restaurants, and a policy that was not applying would too.
  // The third is the invariant: a read that establishes no scope is refused
  // rather than answered with nothing.
  it('is scoped by the policy rather than by the statement', async () => {
    const read = (client: PoolClient) =>
      client.query<BoardRow>(OPEN_ORDERS_IN_RESTAURANT, [OPEN_WINDOW])

    const owning = await scoped(app, BLUE, read)
    const other = await scoped(app, RED, read)

    // A pool of its own, because the code a missing scope raises depends on the
    // connection's history: one that has never carried the setting raises 42704,
    // and one that has reads back the empty string and fails the cast with 22P02.
    const unscoped = new Pool({
      connectionString: asAppRole(CONNECTION_STRING),
      options: `-c search_path=${SCHEMA}`,
      max: 1,
    })
    let none: string
    try {
      none = await sqlstate(() => unscoped.query(OPEN_ORDERS_IN_RESTAURANT, [OPEN_WINDOW]))
    } finally {
      await unscoped.end()
    }

    expect([owning.rowCount, other.rowCount, none]).toEqual([2, 1, '42704'])
  })

  // The table is what the caller did not hold: a guest reached their own table's
  // orders by holding that table's code, and a staff member holds none. What the
  // answer must not carry is the code itself, which authorises an order at that
  // table and has no reader here.
  it('names the table each order was placed at, and never the code printed on it', async () => {
    const response = await board(tokens[ADA] ?? null)
    const text = await response.text()
    const labels = ((JSON.parse(text) as Partial<Board>).orders ?? []).map(
      (order) => order.table.label,
    )

    const held = (
      [
        ["Table 7's code", BLUE_CODE_1],
        ["Table 8's code", BLUE_CODE_2],
        ["Terrace 2's code", RED_CODE],
        ["Bench 1's code", GREEN_CODE],
        ["Table 3's code", AMBER_CODE],
        ["Ada's token", tokens[ADA] ?? ''],
        ["Bo's token", tokens[BO] ?? ''],
        ["Cy's token", tokens[CY] ?? ''],
        ["Dee's token", tokens[DEE] ?? ''],
        ["Ada's digest", digestToken(tokens[ADA] ?? '').toString('hex')],
        ['the credential record', credential],
      ] as const
    )
      .filter(([, value]) => value !== '' && text.includes(value))
      .map(([where]) => where)

    expect([response.status, labels, held]).toEqual([200, ['Table 7', 'Table 8'], []])
  })

  // Both rows are at one table and differ only in age, and both ages are derived
  // from the constant the route passes, so this brackets whatever it says.
  it('holds the order inside the window and not the one outside it', async () => {
    const response = await board(tokens[DEE] ?? null)
    const ids = (((await response.json()) as Partial<Board>).orders ?? []).map((order) => order.id)

    expect([response.status, ids]).toEqual([200, [AMBER_INSIDE]])
  })

  // A restaurant with nothing open is an answer, not an absence. A board that
  // reported it as a failure would tell a kitchen its tickets are unreachable on
  // the one morning they are simply not there yet.
  it('answers a restaurant with nothing open with an empty list', async () => {
    const response = await board(tokens[CY] ?? null)

    expect([response.status, await response.json()]).toEqual([200, { orders: [] }])
  })
})

describe('a session the board refuses', () => {
  // Three refusals and one answer between them. A board that answered an empty
  // list instead would tell a caller with no session that their restaurant has
  // nothing open, which is the one thing it must never say wrongly.
  it('refuses an absent, a forged and an expired session, and reads nothing', async () => {
    const expired = mintToken()
    await owner.query(
      `insert into staff_session (staff_id, restaurant_id, token_digest, expires_at)
       values ($1, $2, $3, now() - interval '1 hour')`,
      [ADA, BLUE, digestToken(expired)],
    )

    const [absent, forged, stale] = await Promise.all([
      board(null),
      board(nearMiss(tokens[ADA] ?? '')),
      board(expired),
    ])

    expect([
      [absent.status, await absent.json()],
      [forged.status, await forged.json()],
      [stale.status, await stale.json()],
    ]).toEqual([
      [401, { error: CLOSED }],
      [401, { error: CLOSED }],
      [401, { error: CLOSED }],
    ])
  })

  // The mechanism, at the layer that holds it. A session whose restaurant is not
  // its staff member's is refused by the composite foreign key, which runs as the
  // table's owner and therefore holds for a path that never set a scope. The
  // resolve's two-column join is a second answer to the same question, and this
  // condition is not about that one.
  it('cannot be written into a restaurant its staff member does not work for', async () => {
    const straddling = await sqlstate(() =>
      owner.query(OPEN_SESSION_ROW, [ADA, RED, digestToken(mintToken())]),
    )
    const own = await sqlstate(() =>
      owner.query(OPEN_SESSION_ROW, [ADA, BLUE, digestToken(mintToken())]),
    )

    expect([straddling, own]).toEqual(['23503', 'no error'])
  })
})

describe('the session a sign-in answers', () => {
  // The only condition here whose token the API minted rather than this file
  // constructed. Everything else seeds a digest, which is both sides of the
  // comparison produced by one function; this one crosses the two routes.
  it('reaches the board under the token the sign-in came back with', async () => {
    const signedIn = await fetch(`${origin}/staff/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADA_EMAIL, password: ADA_PASSWORD }),
    })
    const { token } = (await signedIn.json()) as { token: string }

    const response = await board(token)
    const ids = (((await response.json()) as Partial<Board>).orders ?? []).map((order) => order.id)

    expect([signedIn.status, response.status, ids]).toEqual([
      201,
      200,
      [BLUE_ORDER_1, BLUE_ORDER_2],
    ])
  })
})
