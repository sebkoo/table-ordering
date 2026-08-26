/**
 * The acceptance conditions for the board: what a member of staff is shown of
 * their own restaurant's orders, and what they are not shown of anybody else's.
 *
 * Six restaurants are seeded rather than two, and the reason is the breaks
 * rather than the behaviour. On one shared fixture a single mutation reddens
 * every condition at once, and a condition that only ever reddens beside five
 * others is evidence about nothing in particular. Keeping the compared pair, the
 * window pair and the empty restaurant apart gives each condition a mutation
 * that reaches it alone.
 *
 * The two the act uses are held to the same rule, and it bites harder there
 * because acting *writes*. A condition whose expectation is a board literal over
 * a whole restaurant is coupled to every neighbour that serves an order inside
 * it, so the one condition with such a literal gets a restaurant nobody else
 * touches, and the rest take one order each inside a second.
 *
 * The window fixtures are placed by arithmetic on `OPEN_WINDOW` rather than at a
 * literal age. A row seeded at "100 minutes" knows the window is two hours, and
 * the claim that these conditions bracket whatever the constant says would not
 * be true of it. The margin is five minutes, so the derivation holds while the
 * window is longer than that and stops meaning anything if it ever is not.
 *
 * One credential record is derived and reused across the six staff rows. The
 * board reads that column never, so six derivations would buy nothing but the
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
import { type BoardRow, MARK_PAID, MARK_SERVED, OPEN_ORDERS_IN_RESTAURANT } from './sql.ts'

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
  '0006-record-an-order-served.up.sql',
  '0007-record-an-order-paid.up.sql',
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
 * and nothing else. RED's own order is also what the two refusal conditions aim
 * at: neither writes, so the order stays unserved and each can guard on that --
 * a mutation that made either write reddens both, which is a co-red this file
 * declares rather than a coupling it hides.
 */
const BLUE = '11111111-1111-1111-1111-111111111111'
const RED = '22222222-2222-2222-2222-222222222222'
const GREEN = '33333333-3333-3333-3333-333333333333'
const AMBER = '44444444-4444-4444-4444-444444444444'

/**
 * The two restaurants the act is exercised in, and they are two rather than one
 * for the reason the four above are four.
 *
 * VIOLET is condition 1's alone. Its expectation is a board *literal* over a
 * whole restaurant, so an order any other condition served inside it would
 * change that condition's answer -- which is the coupling the file's own rule
 * forbids.
 *
 * SLATE carries one order per remaining mutating condition. No condition here
 * asserts a literal over SLATE: the expired-ticket condition compares two reads
 * it takes itself, so whatever a neighbour served earlier is in both or neither.
 */
const VIOLET = '55555555-5555-5555-5555-555555555555'
const SLATE = '66666666-6666-6666-6666-666666666666'

/**
 * The two the paid act is exercised in, and they are two rather than one for the
 * reason VIOLET and SLATE are two.
 *
 * PLUM is condition 1's alone. Its expectation is a board *literal* over a whole
 * restaurant, so an order any other condition acted in would change it.
 *
 * WHEAT is the option's own restaurant, and it holds two tables rather than one.
 * `W1` is what the guest is read at, before and after being recorded paid; `W2`
 * is never recorded paid at all and is what `served` is asked to clear. They are
 * at different tables so that the guest read of one carries nothing of the other,
 * and the board read afterwards still holds `W1` -- which is what a filter
 * widened to keep unpaid tickets would change.
 */
const PLUM = '77777777-7777-7777-7777-777777777777'
const WHEAT = '88888888-8888-8888-8888-888888888888'

const ADA = 'f0000000-0000-4000-8000-000000000001'
const BO = 'f0000000-0000-4000-8000-000000000002'
const CY = 'f0000000-0000-4000-8000-000000000003'
const DEE = 'f0000000-0000-4000-8000-000000000004'
const EVE = 'f0000000-0000-4000-8000-000000000005'
const FLO = 'f0000000-0000-4000-8000-000000000006'
const GIL = 'f0000000-0000-4000-8000-000000000007'
const HAL = 'f0000000-0000-4000-8000-000000000008'

const ADA_EMAIL = 'ada@blue-door.example'

/** Minted, not chosen, in the shape the run steps mint one. */
const BLUE_CODE_1 = '9f3c1a7b20de'
const BLUE_CODE_2 = '4d81e6c05a93'
const GREEN_CODE = 'c17a4f9e2b06'
const AMBER_CODE = '5e2b8d43a1fc'
const RED_CODE = 'a83f6021d7b4'
const VIOLET_CODE = '7c04b9d3e618'
const SLATE_CODE = '2a6f8051cb73'
const PLUM_CODE = '3b7e1f60a29c'
const WHEAT_CODE_A = '8d05c2e74b1f'
const WHEAT_CODE_B = 'e61a93f4d7b2'

const BLUE_TABLE_1 = 'b0000000-0000-4000-8000-000000000001'
const BLUE_TABLE_2 = 'b0000000-0000-4000-8000-000000000002'
const RED_TABLE = 'b0000000-0000-4000-8000-000000000003'
const GREEN_TABLE = 'b0000000-0000-4000-8000-000000000004'
const AMBER_TABLE = 'b0000000-0000-4000-8000-000000000005'
const VIOLET_TABLE = 'b0000000-0000-4000-8000-000000000006'
const SLATE_TABLE = 'b0000000-0000-4000-8000-000000000007'
const PLUM_TABLE = 'b0000000-0000-4000-8000-000000000008'
const WHEAT_TABLE_A = 'b0000000-0000-4000-8000-000000000009'
const WHEAT_TABLE_B = 'b0000000-0000-4000-8000-000000000010'

const FLAT_WHITE = 'c0000000-0000-4000-8000-000000000001'
const CINNAMON_BUN = 'c0000000-0000-4000-8000-000000000002'
const RED_PINT = 'c0000000-0000-4000-8000-000000000003'
const AMBER_SOUP = 'c0000000-0000-4000-8000-000000000004'
const VIOLET_TART = 'c0000000-0000-4000-8000-000000000005'
const SLATE_STEW = 'c0000000-0000-4000-8000-000000000006'
const PLUM_SCONE = 'c0000000-0000-4000-8000-000000000007'
const WHEAT_LOAF = 'c0000000-0000-4000-8000-000000000008'

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

/**
 * One order per condition that mutates, so a mutation reaching one reaches only
 * it. `S7OUT` is placed outside the window by arithmetic on `OPEN_WINDOW`, as
 * the AMBER pair above is.
 */
const V1 = 'a0000000-0000-4000-8000-000000000006'
const V2 = 'a0000000-0000-4000-8000-000000000007'
const S2 = 'a0000000-0000-4000-8000-000000000008'
const S5 = 'a0000000-0000-4000-8000-000000000009'
const S6 = 'a0000000-0000-4000-8000-000000000010'
const S7IN = 'a0000000-0000-4000-8000-000000000011'
const S7OUT = 'a0000000-0000-4000-8000-000000000012'

/**
 * The paid act's own orders, on the same rule: one per condition that mutates.
 * `S12` is placed outside the window and `S11` is seeded already served, because
 * those are the two states the act deliberately does not refuse.
 */
const P1 = 'a0000000-0000-4000-8000-000000000013'
const P2 = 'a0000000-0000-4000-8000-000000000014'
const S8 = 'a0000000-0000-4000-8000-000000000015'
const S9 = 'a0000000-0000-4000-8000-000000000016'
const S10 = 'a0000000-0000-4000-8000-000000000017'
const S11 = 'a0000000-0000-4000-8000-000000000018'
const S12 = 'a0000000-0000-4000-8000-000000000019'
const W1 = 'a0000000-0000-4000-8000-000000000020'
const W2 = 'a0000000-0000-4000-8000-000000000021'

/** An id no order in this schema carries. The absent half of the 404 comparison. */
const NO_SUCH_ORDER = 'a0000000-0000-4000-8000-0000000000ff'

const submission = (n: number): string => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Signed in for once, by the one condition whose token the API mints. */
const ADA_PASSWORD = 'fixture-password-for-ada'

const CLOSED = 'that session is not open'

/**
 * The act's 404, restated here as `CLOSED` is rather than imported.
 *
 * It interpolates nothing, and that is the whole of what makes the
 * wrong-restaurant answer and the never-existed answer the same bytes. An id in
 * the sentence would make the two differ by exactly the value that must not
 * tell them apart.
 */
const NOT_HERE = 'that order is not in this restaurant'
const NOT_HERE_BODY = JSON.stringify({ error: NOT_HERE })

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
  paid: boolean
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

/** The ids an answer carries, in the sequence the route returned them. */
function ids(answer: Partial<Board>): string[] {
  return (answer.orders ?? []).map((order) => order.id)
}

/**
 * Whether each order on an answer has been recorded paid, in that same sequence.
 *
 * A third projector rather than a field added to {@link rounds}: the conditions
 * above assert board literals over whole restaurants, and a flag appearing inside
 * their expectations would couple every one of them to a column none of them is
 * about.
 */
function states(answer: Partial<Board>): (boolean | undefined)[] {
  return (answer.orders ?? []).map((order) => order.paid)
}

/** The act, with the token in a header or with no header at all. It carries no body. */
async function serve(id: string, token: string | null): Promise<Response> {
  return fetch(`${origin}/staff/orders/${id}/served`, {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })
}

/** The second act, in the shape of the first. It carries no body either. */
async function pay(id: string, token: string | null): Promise<Response> {
  return fetch(`${origin}/staff/orders/${id}/paid`, {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })
}

/**
 * What a guest at a table is answered, as bytes.
 *
 * Read as text and never parsed, because the claim these conditions make about it
 * is that recording a payment changes nothing a guest is told -- and a comparison
 * of two parsed objects would call two different sets of keys equal if the values
 * under them matched.
 */
async function guestOrders(code: string): Promise<string> {
  return (await fetch(`${origin}/tables/${code}/orders`)).text()
}

/**
 * The moment an order records, read as the owner and as text.
 *
 * As text, because two `timestamptz` values arrive as `Date` objects and `===`
 * on those compares references. The conditions below assert that a repeat left
 * the moment where it was, and that is a comparison of values.
 */
async function servedAt(id: string): Promise<string | null> {
  const { rows } = await owner.query<{ served_at: string | null }>(
    'select served_at::text as served_at from table_order where id = $1',
    [id],
  )
  return rows[0]?.served_at ?? null
}

/** The second moment, read the same way and for the same reason. */
async function paidAt(id: string): Promise<string | null> {
  const { rows } = await owner.query<{ paid_at: string | null }>(
    'select paid_at::text as paid_at from table_order where id = $1',
    [id],
  )
  return rows[0]?.paid_at ?? null
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

  // ---------------------------------------------------------------------
  // The two restaurants the act is exercised in.
  //
  // Seeded after the four above rather than folded into their statements, so
  // that the conditions those four were written for keep the fixture they were
  // written against and this block can be read as one thing.
  // ---------------------------------------------------------------------

  await owner.query(
    `insert into restaurant (id, slug, name) values
       ($1, 'violet-hall', 'The Violet Hall'),
       ($2, 'slate-yard', 'The Slate Yard')`,
    [VIOLET, SLATE],
  )

  await owner.query(
    `insert into menu_item (id, restaurant_id, name, price_minor, currency, sort_order) values
       ($1, $3, 'Plum tart', 400, 'GBP', 10),
       ($2, $4, 'Barley stew', 700, 'GBP', 10)`,
    [VIOLET_TART, SLATE_STEW, VIOLET, SLATE],
  )

  await owner.query(
    `insert into restaurant_table (id, restaurant_id, code, label) values
       ($1, $3, $5, 'Alcove 1'),
       ($2, $4, $6, 'Pass 1')`,
    [VIOLET_TABLE, SLATE_TABLE, VIOLET, SLATE, VIOLET_CODE, SLATE_CODE],
  )

  await owner.query(
    `insert into staff (id, restaurant_id, email, name, credential) values
       ($1, $3, 'eve@violet-hall.example', 'Eve', $5),
       ($2, $4, 'flo@slate-yard.example', 'Flo', $5)`,
    [EVE, FLO, VIOLET, SLATE, credential],
  )

  for (const [staff, restaurant] of [
    [EVE, VIOLET],
    [FLO, SLATE],
  ] as const) {
    const token = mintToken()
    tokens[staff] = token
    await owner.query(OPEN_SESSION_ROW, [staff, restaurant, digestToken(token)])
  }

  // One statement, so both share a transaction time and the sort falls to the
  // id -- which is what makes `[V1, V2]` a decidable sequence rather than an
  // incidental one, exactly as the Blue Door pair above is.
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id) values
       ($1, $5, $6, $3),
       ($2, $5, $6, $4)`,
    [V1, V2, submission(915), submission(916), VIOLET, VIOLET_TABLE],
  )

  // One order per mutating condition. `S7OUT` is placed outside the window by
  // arithmetic on the constant the route passes, as the AMBER pair is.
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id) values
       ($1, $7, $8, $4),
       ($2, $7, $8, $5),
       ($3, $7, $8, $6)`,
    [S2, S5, S6, submission(917), submission(918), submission(919), SLATE, SLATE_TABLE],
  )
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id, placed_at) values
       ($1, $5, $6, $3, now() - $4::interval + interval '5 minutes'),
       ($2, $5, $6, $7, now() - $4::interval - interval '5 minutes')`,
    [S7IN, S7OUT, submission(920), OPEN_WINDOW, SLATE, SLATE_TABLE, submission(921)],
  )

  await owner.query(
    `insert into table_order_line (order_id, restaurant_id, menu_item_id, quantity) values
       ($1, $8, $9, 1),
       ($2, $8, $9, 2),
       ($3, $10, $11, 1),
       ($4, $10, $11, 1),
       ($5, $10, $11, 1),
       ($6, $10, $11, 1),
       ($7, $10, $11, 1)`,
    [V1, V2, S2, S5, S6, S7IN, S7OUT, VIOLET, VIOLET_TART, SLATE, SLATE_STEW],
  )

  // PLUM and WHEAT, the paid act's own restaurants. Seeded after the rest so the
  // block reads as one unit; nothing above it touches either.
  await owner.query(
    `insert into restaurant (id, slug, name) values
       ($1, 'plum-tree', 'The Plum Tree'),
       ($2, 'wheat-sheaf', 'The Wheat Sheaf')`,
    [PLUM, WHEAT],
  )

  await owner.query(
    `insert into menu_item (id, restaurant_id, name, price_minor, currency, sort_order) values
       ($1, $3, 'Fruit scone', 350, 'GBP', 10),
       ($2, $4, 'Half loaf', 250, 'GBP', 10)`,
    [PLUM_SCONE, WHEAT_LOAF, PLUM, WHEAT],
  )

  await owner.query(
    `insert into restaurant_table (id, restaurant_id, code, label) values
       ($1, $4, $6, 'Window 1'),
       ($2, $5, $7, 'Nook 1'),
       ($3, $5, $8, 'Nook 2')`,
    [PLUM_TABLE, WHEAT_TABLE_A, WHEAT_TABLE_B, PLUM, WHEAT, PLUM_CODE, WHEAT_CODE_A, WHEAT_CODE_B],
  )

  await owner.query(
    `insert into staff (id, restaurant_id, email, name, credential) values
       ($1, $3, 'gil@plum-tree.example', 'Gil', $5),
       ($2, $4, 'hal@wheat-sheaf.example', 'Hal', $5)`,
    [GIL, HAL, PLUM, WHEAT, credential],
  )

  for (const [staff, restaurant] of [
    [GIL, PLUM],
    [HAL, WHEAT],
  ] as const) {
    const token = mintToken()
    tokens[staff] = token
    await owner.query(OPEN_SESSION_ROW, [staff, restaurant, digestToken(token)])
  }

  // One statement, so `[P1, P2]` is a decidable sequence, as the two pairs above
  // are.
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id) values
       ($1, $5, $6, $3),
       ($2, $5, $6, $4)`,
    [P1, P2, submission(922), submission(923), PLUM, PLUM_TABLE],
  )

  // One SLATE order per remaining paid condition. `S11` is seeded already served
  // and `S12` outside the window, which are the two states the act is deliberately
  // not bounded by -- each placed by arithmetic on the constant, never at a
  // literal age.
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id) values
       ($1, $6, $7, $4),
       ($2, $6, $7, $5),
       ($3, $6, $7, $8)`,
    [S8, S9, S10, submission(924), submission(925), SLATE, SLATE_TABLE, submission(926)],
  )
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id, served_at) values
       ($1, $2, $3, $4, now())`,
    [S11, SLATE, SLATE_TABLE, submission(927)],
  )
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id, placed_at) values
       ($1, $2, $3, $4, now() - $5::interval - interval '5 minutes')`,
    [S12, SLATE, SLATE_TABLE, submission(928), OPEN_WINDOW],
  )

  // WHEAT's two, at its two tables, so a guest read of one carries nothing of the
  // other.
  await owner.query(
    `insert into table_order (id, restaurant_id, table_id, submission_id) values
       ($1, $5, $6, $3),
       ($2, $5, $7, $4)`,
    [W1, W2, submission(929), submission(930), WHEAT, WHEAT_TABLE_A, WHEAT_TABLE_B],
  )

  await owner.query(
    `insert into table_order_line (order_id, restaurant_id, menu_item_id, quantity) values
       ($1, $10, $11, 1),
       ($2, $10, $11, 2),
       ($3, $12, $13, 1),
       ($4, $12, $13, 1),
       ($5, $12, $13, 1),
       ($6, $12, $13, 1),
       ($7, $12, $13, 1),
       ($8, $14, $15, 1),
       ($9, $14, $15, 1)`,
    [P1, P2, S8, S9, S10, S11, S12, W1, W2, PLUM, PLUM_SCONE, SLATE, SLATE_STEW, WHEAT, WHEAT_LOAF],
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

describe('the ticket a member of staff clears', () => {
  // The change this commit exists for, stated as a difference between two reads
  // of the same board. A row-set diff rather than an assertion about one row:
  // the ticket that was acted on has to leave, and the one beside it has to
  // stay, and only a comparison of the whole answer says both at once.
  //
  // VIOLET is this condition's alone, so the two literals below are facts about
  // the fixture rather than about which neighbour ran first.
  it('takes the acted ticket off the board and leaves the rest where they were', async () => {
    const before = ids((await (await board(tokens[EVE] ?? null)).json()) as Partial<Board>)
    const acted = await serve(V1, tokens[EVE] ?? null)
    const after = ids((await (await board(tokens[EVE] ?? null)).json()) as Partial<Board>)

    expect([before, acted.status, await acted.text(), after]).toEqual([[V1, V2], 204, '', [V2]])
  })

  // Two kitchen screens show one ticket and both are tapped. The second answer
  // is the first answer -- the same status and the same empty body -- and the
  // moment does not move, which is what says the second act wrote nothing.
  //
  // `S2` is this condition's own order, so the first call really is a first act.
  // Sharing a served order with the condition above would have made both calls
  // repeats and left the transition below unobserved.
  it('answers a repeat as it answered the first act, and writes nothing further', async () => {
    const first = await serve(S2, tokens[FLO] ?? null)
    const firstBody = await first.text()
    const recorded = await servedAt(S2)

    const second = await serve(S2, tokens[FLO] ?? null)
    const secondBody = await second.text()
    const later = await servedAt(S2)

    // `recorded !== null` is not redundant beside the equality. Two nulls are
    // equal, so without it a route that recorded nothing at all would satisfy
    // the comparison the condition is named for.
    expect([
      first.status,
      second.status,
      firstBody,
      secondBody,
      recorded !== null,
      recorded === later,
    ]).toEqual([204, 204, '', '', true, true])
  })

  // A's staff aim at B's ticket, and at an id no order carries. Both are
  // refused, and the two refusals are the same bytes -- which is the evidence,
  // not a tidiness. A sentence naming the id would tell a caller that one of
  // the two exists somewhere, and the equality below is what forbids it.
  it("refuses another restaurant's ticket in the words a ticket that never existed gets", async () => {
    const [wrong, absent] = await Promise.all([
      serve(RED_ORDER, tokens[ADA] ?? null),
      serve(NO_SUCH_ORDER, tokens[ADA] ?? null),
    ])
    const [wrongText, absentText] = [await wrong.text(), await absent.text()]
    const redBoard = ids((await (await board(tokens[BO] ?? null)).json()) as Partial<Board>)

    expect([
      wrong.status,
      absent.status,
      wrongText,
      absentText,
      wrongText === absentText,
      await servedAt(RED_ORDER),
      redBoard,
    ]).toEqual([404, 404, NOT_HERE_BODY, NOT_HERE_BODY, true, null, [RED_ORDER]])
  })

  // Refused as values, never by exception, and the row is read afterwards
  // because a refusal that still wrote would be the worst of both.
  it('refuses a signed-out and a forged act, and writes nothing', async () => {
    const [absent, forged] = await Promise.all([
      serve(RED_ORDER, null),
      serve(RED_ORDER, nearMiss(tokens[ADA] ?? '')),
    ])

    expect([
      [absent.status, await absent.json()],
      [forged.status, await forged.json()],
      await servedAt(RED_ORDER),
    ]).toEqual([[401, { error: CLOSED }], [401, { error: CLOSED }], null])
  })

  // One statement, three scopes, and the order of the first two is load-bearing.
  // The wrong-scope call runs while `S5` is still unserved, so the zero it
  // reaches is the policy refusing it. Run after the owning call it would read
  // zero because `served_at` had stopped being null, and a removed policy would
  // pass.
  it('scopes the update by the policy rather than by the statement', async () => {
    const run = (client: PoolClient) => client.query(MARK_SERVED, [S5])

    const other = await scoped(app, BLUE, run)
    const owning = await scoped(app, SLATE, run)

    // A pool of its own, for the reason the board's own scope condition gives:
    // the code a missing scope raises depends on the connection's history.
    const unscoped = new Pool({
      connectionString: asAppRole(CONNECTION_STRING),
      options: `-c search_path=${SCHEMA}`,
      max: 1,
    })
    let none: string
    try {
      none = await sqlstate(() => unscoped.query(MARK_SERVED, [S5]))
    } finally {
      await unscoped.end()
    }

    expect([owning.rowCount, other.rowCount, none]).toEqual([1, 0, '42704'])
  })

  // The privilege, at the layer that holds it. The application role is granted
  // `update` on one column, so a statement naming any other is refused before a
  // policy is consulted -- and unlike a policy this holds for a statement nobody
  // reviewed. Two transactions rather than one: a refused statement aborts the
  // transaction it was sent in.
  it('grants the update on one column, so a statement naming another is refused', async () => {
    const moved = await sqlstate(() =>
      scoped(app, SLATE, (client) =>
        client.query('update table_order set placed_at = now() where id = $1', [S6]),
      ),
    )
    const served = await sqlstate(() =>
      scoped(app, SLATE, (client) =>
        client.query('update table_order set served_at = now() where id = $1', [S6]),
      ),
    )

    expect([moved, served]).toEqual(['42501', 'no error'])
  })

  // The window bounds what a read discloses, not what a write may record. A
  // ticket nobody cleared before it aged off the board is the forgotten ticket,
  // and recording that it was served records something true.
  //
  // The last element is an equality between two reads this condition takes
  // itself, never a literal. That is what keeps it independent of whatever a
  // neighbour served in SLATE earlier: such an order is in both reads or in
  // neither, and the comparison is unmoved either way.
  it('serves a ticket the window no longer shows, and the board does not change', async () => {
    const before = ids((await (await board(tokens[FLO] ?? null)).json()) as Partial<Board>)
    const acted = await serve(S7OUT, tokens[FLO] ?? null)
    const after = ids((await (await board(tokens[FLO] ?? null)).json()) as Partial<Board>)

    expect([
      before.includes(S7OUT),
      acted.status,
      (await servedAt(S7OUT)) !== null,
      JSON.stringify(after) === JSON.stringify(before),
    ]).toEqual([false, 204, true, true])
  })
})

/**
 * The second act, and the roadmap's last row.
 *
 * A member of staff records that a round was paid for. Nothing is gated on it:
 * ordering does not consult it, the guest is never told, and a ticket still
 * leaves the board on `served` alone -- which is the row's own "rather than a
 * requirement", pinned here as a value diff rather than written down as a
 * sentence. ADR 0036.
 *
 * The shape mirrors the block above deliberately. Where a condition here reads
 * the same as its `served` neighbour, that is the point: the two acts are one
 * transaction shape with one statement swapped, and a divergence between them
 * would be the thing to explain.
 */
describe('the round a member of staff records as paid', () => {
  // The change this commit exists for, stated as a difference between two reads
  // of the same board. The ticket has to *stay* -- payment is not a clearing --
  // and the flag beside it has to move, and only a comparison of the whole
  // answer says both at once.
  //
  // PLUM is this condition's alone, so the two literals below are facts about
  // the fixture rather than about which neighbour ran first.
  it('records the moment and leaves the ticket on the board', async () => {
    const before = await (await board(tokens[GIL] ?? null)).json()
    const recorded = await paidAt(P1)
    const acted = await pay(P1, tokens[GIL] ?? null)
    const after = await (await board(tokens[GIL] ?? null)).json()

    expect([
      recorded,
      acted.status,
      (await paidAt(P1)) !== null,
      ids(before as Partial<Board>),
      ids(after as Partial<Board>),
      states(after as Partial<Board>),
    ]).toEqual([null, 204, true, [P1, P2], [P1, P2], [true, false]])
  })

  // Two screens, one round, both tapped. The second answer is the first answer
  // and the moment does not move, which is what says the second act wrote
  // nothing at all rather than rewriting the row with the value it held.
  //
  // `recorded !== null` is not redundant beside the equality: two nulls are
  // equal, so without it a route that recorded nothing would satisfy the
  // comparison this condition is named for.
  it('answers a repeat as it answered the first act, and writes nothing further', async () => {
    const first = await pay(S8, tokens[FLO] ?? null)
    const firstBody = await first.text()
    const recorded = await paidAt(S8)

    const second = await pay(S8, tokens[FLO] ?? null)
    const secondBody = await second.text()
    const later = await paidAt(S8)

    expect([
      first.status,
      second.status,
      firstBody,
      secondBody,
      recorded !== null,
      recorded === later,
    ]).toEqual([204, 204, '', '', true, true])
  })

  // A's staff aim at B's ticket, and at an id no order carries. Both refused,
  // and in the same bytes -- a sentence naming the id would tell a caller that
  // one of the two exists somewhere.
  it("refuses another restaurant's ticket in the words a ticket that never existed gets", async () => {
    const [wrong, absent] = await Promise.all([
      pay(RED_ORDER, tokens[ADA] ?? null),
      pay(NO_SUCH_ORDER, tokens[ADA] ?? null),
    ])
    const [wrongText, absentText] = [await wrong.text(), await absent.text()]

    expect([
      wrong.status,
      absent.status,
      wrongText,
      absentText,
      wrongText === absentText,
      await paidAt(RED_ORDER),
    ]).toEqual([404, 404, NOT_HERE_BODY, NOT_HERE_BODY, true, null])
  })

  // Refused as values, never by exception, and the row is read afterwards
  // because a refusal that still wrote would be the worst of both.
  it('refuses a signed-out and a forged act, and writes nothing', async () => {
    const [absent, forged] = await Promise.all([
      pay(RED_ORDER, null),
      pay(RED_ORDER, nearMiss(tokens[ADA] ?? '')),
    ])

    expect([
      [absent.status, await absent.json()],
      [forged.status, await forged.json()],
      await paidAt(RED_ORDER),
    ]).toEqual([[401, { error: CLOSED }], [401, { error: CLOSED }], null])
  })

  // One statement, three scopes, and the order of the first two is load-bearing
  // for the reason the `served` scope condition gives: the wrong-scope call runs
  // while `S9` is still unpaid, so the zero it reaches is the policy refusing it.
  it('scopes the update by the policy rather than by the statement', async () => {
    const run = (client: PoolClient) => client.query(MARK_PAID, [S9])

    const other = await scoped(app, BLUE, run)
    const owning = await scoped(app, SLATE, run)

    // A pool of its own: the code a missing scope raises depends on the
    // connection's history.
    const unscoped = new Pool({
      connectionString: asAppRole(CONNECTION_STRING),
      options: `-c search_path=${SCHEMA}`,
      max: 1,
    })
    let none: string
    try {
      none = await sqlstate(() => unscoped.query(MARK_PAID, [S9]))
    } finally {
      await unscoped.end()
    }

    expect([owning.rowCount, other.rowCount, none]).toEqual([1, 0, '42704'])
  })

  // The second column-scoped grant, at the layer that holds it. The role may set
  // this column and not `placed_at`, so a statement naming the second is refused
  // before a policy is consulted. Two transactions, because a refused statement
  // aborts the one it was sent in.
  //
  // What this no longer establishes, and `0006`'s neighbour no longer does
  // either, is that the two acts are isolated *from each other*: the role now
  // holds both columns, so what keeps each act to its own is its statement.
  it('grants the update on one column, so a statement naming another is refused', async () => {
    const moved = await sqlstate(() =>
      scoped(app, SLATE, (client) =>
        client.query('update table_order set placed_at = now() where id = $1', [S10]),
      ),
    )
    const paid = await sqlstate(() =>
      scoped(app, SLATE, (client) =>
        client.query('update table_order set paid_at = now() where id = $1', [S10]),
      ),
    )

    expect([moved, paid]).toEqual(['42501', 'no error'])
  })

  // The board's filter bounds what a read discloses, not what a write may
  // record. A round settled after the plates were cleared was settled, and the
  // ticket it belongs to left the board when the kitchen sent it out.
  //
  // The last element is an equality between two reads this condition takes
  // itself, never a literal, so whatever a neighbour acted on in SLATE earlier
  // is in both reads or in neither.
  it('records a ticket that was already served, and the board does not change', async () => {
    const before = ids((await (await board(tokens[FLO] ?? null)).json()) as Partial<Board>)
    const acted = await pay(S11, tokens[FLO] ?? null)
    const after = ids((await (await board(tokens[FLO] ?? null)).json()) as Partial<Board>)

    expect([
      (await servedAt(S11)) !== null,
      before.includes(S11),
      acted.status,
      (await paidAt(S11)) !== null,
      JSON.stringify(after) === JSON.stringify(before),
    ]).toEqual([true, false, 204, true, true])
  })

  // The window, which is the other bound the act does not take. Split from the
  // condition above rather than folded into it: a `served_at is null` predicate
  // on the statement and a window predicate on it are two different mistakes,
  // and one condition over both subjects would be reddened by either with no way
  // to say which.
  it('records a ticket the window no longer shows, and the board does not change', async () => {
    const before = ids((await (await board(tokens[FLO] ?? null)).json()) as Partial<Board>)
    const acted = await pay(S12, tokens[FLO] ?? null)
    const after = ids((await (await board(tokens[FLO] ?? null)).json()) as Partial<Board>)

    expect([
      (await servedAt(S12)) === null,
      before.includes(S12),
      acted.status,
      (await paidAt(S12)) !== null,
      JSON.stringify(after) === JSON.stringify(before),
    ]).toEqual([true, false, 204, true, true])
  })

  /**
   * The option, pinned.
   *
   * Two halves of one claim. A guest is told nothing: the bytes their table
   * answers with are the same before and after a payment is recorded, and the
   * word is not in them at all. And a ticket nobody recorded a payment for still
   * clears on `served` alone -- `W2` is never paid, and after it is served the
   * board holds `W1` and not it.
   *
   * The second element is not redundant beside the first. A leak that rendered
   * the field as `false` on every order would leave the two bodies equal, and
   * only a test for the key itself sees it.
   */
  it('tells a guest nothing, and still clears a ticket nobody paid for', async () => {
    const guestBefore = await guestOrders(WHEAT_CODE_A)
    await pay(W1, tokens[HAL] ?? null)
    const guestAfter = await guestOrders(WHEAT_CODE_A)

    const cleared = await serve(W2, tokens[HAL] ?? null)
    const board2 = ids((await (await board(tokens[HAL] ?? null)).json()) as Partial<Board>)

    expect([
      guestAfter === guestBefore,
      guestAfter.includes('paid'),
      (await paidAt(W1)) !== null,
      await paidAt(W2),
      cleared.status,
      board2,
    ]).toEqual([true, false, true, null, 204, [W1]])
  })
})
