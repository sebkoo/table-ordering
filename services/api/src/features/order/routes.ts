/**
 * The one way a guest sends an order.
 *
 * `POST /tables/:code/orders`, the same address the menu is read from, because
 * the printed code is the whole of what a guest has. The body carries a
 * submission id the client mints and the lines it wants; the restaurant and the
 * table are never in it, and are never taken from it.
 *
 * `GET` on the same address answers the orders open at that table. It is the
 * repository's first read under a policy: `table_order` and `table_order_line`
 * already carry one, so what scopes the read is the setting on the transaction
 * rather than a predicate anybody has to remember. What it discloses, to whom,
 * and why it is bounded in time are ADR 0026's subject.
 *
 * This is the repository's first write path, so it is the first route that does
 * more than one thing per request. All of it is one transaction, and the first
 * statement after the code is resolved sets the scope every later statement is
 * checked against. Getting that wrong is not a wrong answer, it is a row in
 * another restaurant, which is why the policies rather than these statements are
 * what refuse it.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import {
  ADD_LINES,
  CLAIM_ORDER,
  FOREIGN_KEY_VIOLATION,
  OPEN_ORDERS_AT_TABLE,
  OPEN_WINDOW,
  type OpenOrderRow,
  ORDER_FOR_SUBMISSION,
  type OrderRow,
  SET_SCOPE,
  TABLE_FOR_CODE,
  type TableRow,
} from './sql.ts'

/** As {@link TABLE_CODE} in the menu routes: what a URL segment may hold, and nothing about secrecy. */
const TABLE_CODE = { type: 'string', pattern: '^[a-z0-9]{8,64}$' }

const UUID = {
  type: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
}

/**
 * Bounds live here rather than in the schema, which is where ADR 0007 puts what
 * a request may say. `check (quantity > 0)` in the migration is the same rule
 * held one layer down, for anything that reaches the table another way; the
 * upper bounds exist only to keep one request from being unbounded work.
 */
const LINES = {
  type: 'array',
  minItems: 1,
  maxItems: 50,
  items: {
    type: 'object',
    required: ['menuItemId', 'quantity'],
    additionalProperties: false,
    properties: { menuItemId: UUID, quantity: { type: 'integer', minimum: 1, maximum: 99 } },
  },
}

const ERROR = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
}

const PLACE_ORDER_SCHEMA = {
  params: { type: 'object', required: ['code'], properties: { code: TABLE_CODE } },
  body: {
    type: 'object',
    required: ['submissionId', 'lines'],
    additionalProperties: false,
    properties: { submissionId: UUID, lines: LINES },
  },
  response: {
    201: {
      type: 'object',
      required: ['order'],
      properties: {
        // The id and nothing else. What a guest can do with an order is a
        // question no route answers yet, and a field nobody reads is a field the
        // next change has to keep true.
        order: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    404: ERROR,
    409: ERROR,
    422: ERROR,
  },
}

/**
 * What a reader is told, and the whole of it.
 *
 * The name and the quantity, and no price: an order records none, so the only
 * price available is the menu's current one, which is the wrong number for an
 * order placed before it moved. ADR 0021 named the first thing that shows an
 * order's money as the trigger for a price snapshot, and this deliberately is
 * not that thing.
 *
 * The order's id is here because the page renders a list and a list needs a
 * key. Nothing else is: the table and the restaurant are what the caller already
 * held to reach this address, and `placed_at` is a field whose only reader is
 * the sort the query has already applied.
 */
const ORDERS_SCHEMA = {
  params: { type: 'object', required: ['code'], properties: { code: TABLE_CODE } },
  response: {
    200: {
      type: 'object',
      required: ['orders'],
      properties: {
        orders: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'lines'],
            properties: {
              id: { type: 'string' },
              lines: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'quantity'],
                  properties: { name: { type: 'string' }, quantity: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },
    404: ERROR,
  },
}

type Body = {
  submissionId: string
  lines: { menuItemId: string; quantity: number }[]
}

/**
 * What one attempt at the transaction concluded.
 *
 * `retry` is not an answer to a guest. It means the submission id conflicted
 * with a row that had not committed yet, so this attempt cannot tell a resend
 * from a first send; the route runs the whole thing again rather than guessing.
 */
type Attempt =
  | { kind: 'placed'; id: string }
  | { kind: 'no-such-table' }
  | { kind: 'other-table' }
  | { kind: 'no-such-item' }
  | { kind: 'retry' }

async function place(pool: Pool, code: string, body: Body): Promise<Attempt> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows } = await client.query<TableRow>(TABLE_FOR_CODE, [code])
    const table = rows[0]
    if (table === undefined) {
      await client.query('rollback')
      return { kind: 'no-such-table' }
    }

    // From here on nothing is scoped by hand. The restaurant came from the row
    // above, and every statement below is checked against it by a policy.
    await client.query(SET_SCOPE, [table.restaurant_id])

    const claimed = await client.query<{ id: string }>(CLAIM_ORDER, [
      table.restaurant_id,
      table.table_id,
      body.submissionId,
    ])
    const placed = claimed.rows[0]

    if (placed === undefined) return await resend(client, table, body)

    return await addLines(client, placed.id, table, body)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/**
 * The submission id is already taken. Which order it names decides everything,
 * and the table it names decides whether this is a resend at all: the same
 * submission id arriving at a different table is a collision, not a retry, and
 * answering it with the existing order would hand a guest at one table a
 * confirmation for food going to another.
 */
async function resend(client: PoolClient, table: TableRow, body: Body): Promise<Attempt> {
  const { rows } = await client.query<OrderRow>(ORDER_FOR_SUBMISSION, [body.submissionId])
  const existing = rows[0]

  if (existing === undefined) {
    await client.query('rollback')
    return { kind: 'retry' }
  }

  if (existing.table_id !== table.table_id) {
    await client.query('rollback')
    return { kind: 'other-table' }
  }

  // No lines. They were written when the order was, and writing them again is
  // how one order becomes an order for twice the food.
  await client.query('commit')
  return { kind: 'placed', id: existing.id }
}

async function addLines(
  client: PoolClient,
  id: string,
  table: TableRow,
  body: Body,
): Promise<Attempt> {
  try {
    await client.query(ADD_LINES, [
      id,
      table.restaurant_id,
      body.lines.map((line) => line.menuItemId),
      body.lines.map((line) => line.quantity),
    ])
  } catch (error) {
    // On this transaction a foreign key violation has one cause: a line naming
    // an item that is not on this restaurant's menu. The order's own keys were
    // satisfied by the row the code resolved to, and the lines' order key by the
    // order this transaction just wrote.
    if ((error as { code?: string }).code !== FOREIGN_KEY_VIOLATION) throw error
    await client.query('rollback')
    return { kind: 'no-such-item' }
  }

  await client.query('commit')
  return { kind: 'placed', id }
}

type OpenOrder = { id: string; lines: { name: string; quantity: number }[] }

/**
 * Rows into orders, in the sequence the query returned them.
 *
 * A row whose line columns are null is the left join reporting an order with
 * nothing on it, which is an order with an empty list rather than an order to
 * drop. "No order" and "an order with nothing on it" are different answers, and a
 * reader that cannot tell them apart reports the second as the first.
 */
function group(rows: readonly OpenOrderRow[]): OpenOrder[] {
  const orders = new Map<string, OpenOrder>()

  for (const row of rows) {
    let open = orders.get(row.order_id)
    if (open === undefined) {
      open = { id: row.order_id, lines: [] }
      orders.set(row.order_id, open)
    }
    if (row.item_name === null || row.quantity === null) continue
    open.lines.push({ name: row.item_name, quantity: row.quantity })
  }

  return [...orders.values()]
}

/**
 * One transaction, the same shape as the write: resolve the code, set the scope
 * from the row it returned, then read. null is a code no table is served at,
 * which is a different answer from a table nobody has ordered at.
 */
async function openOrders(pool: Pool, code: string): Promise<OpenOrder[] | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows } = await client.query<TableRow>(TABLE_FOR_CODE, [code])
    const table = rows[0]
    if (table === undefined) {
      await client.query('rollback')
      return null
    }

    await client.query(SET_SCOPE, [table.restaurant_id])
    const open = await client.query<OpenOrderRow>(OPEN_ORDERS_AT_TABLE, [
      table.table_id,
      OPEN_WINDOW,
    ])

    await client.query('commit')
    return group(open.rows)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function orderRoutes(pool: Pool) {
  return async (app: FastifyInstance): Promise<void> => {
    app.post<{ Params: { code: string }; Body: Body }>(
      '/tables/:code/orders',
      { schema: PLACE_ORDER_SCHEMA },
      async (request, reply) => {
        const { code } = request.params

        // Twice, never more. The second attempt reads a snapshot taken after the
        // transaction this one collided with has finished, so it either finds
        // the order or the conflict was never real.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const outcome = await place(pool, code, request.body)
          if (outcome.kind !== 'retry') return answer(outcome, reply, code)
        }

        throw new Error(`submission ${request.body.submissionId} conflicted with no visible order`)
      },
    )

    app.get<{ Params: { code: string } }>(
      '/tables/:code/orders',
      { schema: ORDERS_SCHEMA },
      async (request, reply) => {
        const { code } = request.params
        const orders = await openOrders(pool, code)

        if (orders === null) {
          return reply.code(404).send({ error: `no table is served at ${code}` })
        }

        return { orders }
      },
    )
  }
}

function answer(outcome: Attempt, reply: FastifyReply, code: string): unknown {
  switch (outcome.kind) {
    case 'placed':
      // The same answer for a first send and a resend. A client that retries
      // cannot act on the difference, and an API that reported one would be
      // inviting it to.
      return reply.code(201).send({ order: { id: outcome.id } })
    case 'no-such-table':
      return reply.code(404).send({ error: `no table is served at ${code}` })
    case 'other-table':
      return reply.code(409).send({ error: 'that submission belongs to another table' })
    default:
      return reply.code(422).send({ error: 'an item on this order is not on that menu' })
  }
}
