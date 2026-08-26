/**
 * What a member of staff is recognised by, and the first thing that recognition
 * reaches.
 *
 * `POST /staff/sessions` takes an email and a password and answers who they
 * belong to, with the token every later request carries.
 * `GET /staff/sessions/current` answers the same identity for a token.
 * `GET /staff/orders` answers the open orders in that token's restaurant.
 * `POST /staff/orders/:id/served` clears one of them from that board.
 * `POST /staff/orders/:id/paid` records that a round was paid for.
 *
 * The last two are this router's writes, and neither takes a body at all. There
 * is nothing a caller may say about either act beyond which ticket it is for, and
 * an address that took a field would be an address that could take `false` --
 * which is un-serving, a second behaviour nobody has asked for. ADR 0034.
 *
 * They are one function with one statement swapped, because they are one shape:
 * resolve, scope, claim, read back. Two callers is what makes {@link act} a seam
 * rather than a guess about a variation nobody has observed -- and the fold is
 * load-bearing beyond tidiness, since a `401` at either address leaves the page
 * through one door, which is why the board's suite pins that path once. ADR 0036.
 *
 * The third address is here rather than in a slice of its own because this
 * router is grouped by the boundary it sits behind: everything in this file
 * begins by resolving a credential, and nothing outside it needs `bearer` or the
 * body a closed session is refused with. ADR 0030.
 *
 * Neither request names a restaurant, and neither may. The restaurant a staff
 * request reaches is the one on the row the credential resolved to, so there is
 * nothing a caller can send that would reach another -- the same construction
 * that makes a printed code safe, applied to a credential. ADR 0029.
 *
 * The token is in a header. It is not in the path, which is why the second
 * address is `current` rather than the token itself: a path is written to every
 * proxy log and every access log between here and the client.
 *
 * Neither refusal says which half was wrong. A sign-in that distinguished an
 * unknown address from a wrong password would answer the question "does this
 * person work here" for anybody who asked, and the two answers are made
 * identical in cost as well as in text.
 */

import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { OPEN_WINDOW, SET_SCOPE } from '../order/sql.ts'
import { digestToken, mintToken, verifyNobody, verifyPassword } from './credential.ts'
import {
  type BoardRow,
  MARK_PAID,
  MARK_SERVED,
  OPEN_ORDERS_IN_RESTAURANT,
  OPEN_SESSION,
  ORDER_IN_RESTAURANT,
  SESSION_FOR_DIGEST,
  SESSION_LIFETIME,
  type ServedRow,
  type SessionRow,
  STAFF_FOR_EMAIL,
  type StaffRow,
} from './sql.ts'

/**
 * Bounds on what a request may say, which is where ADR 0007 puts them. The
 * upper bound on the password is not a policy about passwords: it is what stops
 * one request asking for a memory-hard derivation over a megabyte.
 */
const EMAIL = { type: 'string', minLength: 3, maxLength: 254 }
const PASSWORD = { type: 'string', minLength: 1, maxLength: 1024 }

const ERROR = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
}

/**
 * The identity, and the whole of it. A name the room uses out loud and the
 * restaurant it is in. Not the email, not the staff id, not the session id:
 * each would be a field a later change has to keep true for no reader.
 */
const IDENTITY = {
  staff: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  restaurant: {
    type: 'object',
    required: ['slug', 'name'],
    properties: { slug: { type: 'string' }, name: { type: 'string' } },
  },
}

const SIGN_IN_SCHEMA = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: { email: EMAIL, password: PASSWORD },
  },
  response: {
    201: {
      type: 'object',
      required: ['token', 'staff', 'restaurant'],
      properties: { token: { type: 'string' }, ...IDENTITY },
    },
    401: ERROR,
  },
}

const CURRENT_SCHEMA = {
  response: {
    200: { type: 'object', required: ['staff', 'restaurant'], properties: IDENTITY },
    401: ERROR,
  },
}

/**
 * What the board is told, and the whole of it.
 *
 * The table's label, because it is the one thing the caller did not hold: a
 * guest reaches their own table's orders by holding that table's code, and a
 * member of staff holds none. Never the code itself -- it authorises an order at
 * that table, and the board has no reader for it, so it does not travel here.
 *
 * No price, because an order records none. No time either: `placed_at`'s only
 * reader is the sort the query has already applied, which is the reason the
 * guest's read leaves it out too. The first board view that shows how long a
 * ticket has waited is what adds it. ADR 0030.
 *
 * `paid` is a boolean and not a moment, for that same reason: the page needs to
 * know whether the control to record a payment still belongs on the row, and a
 * time would be a second value with no reader. It is on this answer and on no
 * other -- the guest's read of their own table does not carry it, because
 * payment is a fact about the till and not about whether the food is coming.
 * ADR 0036.
 */
const BOARD_SCHEMA = {
  response: {
    200: {
      type: 'object',
      required: ['orders'],
      properties: {
        orders: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'table', 'lines', 'paid'],
            properties: {
              id: { type: 'string' },
              paid: { type: 'boolean' },
              table: {
                type: 'object',
                required: ['label'],
                properties: { label: { type: 'string' } },
              },
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
    401: ERROR,
  },
}

/** As {@link UUID} in the order routes: what a URL segment may hold, and nothing about secrecy. */
const ORDER_ID = {
  type: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
}

const SERVED_SCHEMA = {
  params: { type: 'object', required: ['id'], properties: { id: ORDER_ID } },
  response: {
    // No body. The caller holds the id already -- it is in the address it just
    // called -- and what it does next is read the board again, so a field here
    // would be one nobody reads and every later change has to keep true. It also
    // makes a first act and a repeat identical down to the byte.
    204: { type: 'null' },
    401: ERROR,
    404: ERROR,
  },
}

/**
 * The second act's, and it is the first's with one word changed.
 *
 * No body in and no body out, for the reasons above. `404` covers a ticket this
 * session cannot reach exactly as it does for `served`, and answers it in the
 * same sentence.
 */
const PAID_SCHEMA = SERVED_SCHEMA

const REFUSED = 'that email and password do not match'
const CLOSED = 'that session is not open'

/**
 * What an order this session cannot clear is answered with, and it interpolates
 * nothing.
 *
 * Another restaurant's ticket and an id no order ever carried get this same
 * sentence, byte for byte. A sentence naming the id would differ between the two
 * by exactly the value that must not tell them apart -- and telling them apart is
 * telling a caller that a ticket they cannot see exists somewhere.
 */
const NOT_HERE = 'that order is not in this restaurant'

const BEARER = /^bearer +(\S+)$/i

/** The token an `authorization` header carries, or null for anything else. */
function bearer(header: string | undefined): string | null {
  if (header === undefined) return null
  return BEARER.exec(header)?.[1] ?? null
}

function identity(row: StaffRow | SessionRow) {
  return {
    staff: { name: row.staff_name },
    restaurant: { slug: row.restaurant_slug, name: row.restaurant_name },
  }
}

type BoardOrder = {
  id: string
  table: { label: string }
  lines: { name: string; quantity: number }[]
  paid: boolean
}

/**
 * Rows into orders, in the sequence the query returned them.
 *
 * A row whose line columns are null is the left join reporting an order with
 * nothing on it, which is an order with an empty list rather than an order to
 * drop -- the same reading the guest's read gives, for the same reason.
 */
function group(rows: readonly BoardRow[]): BoardOrder[] {
  const orders = new Map<string, BoardOrder>()

  for (const row of rows) {
    let open = orders.get(row.order_id)
    if (open === undefined) {
      open = { id: row.order_id, table: { label: row.table_label }, lines: [], paid: row.paid }
      orders.set(row.order_id, open)
    }
    if (row.item_name === null || row.quantity === null) continue
    open.lines.push({ name: row.item_name, quantity: row.quantity })
  }

  return [...orders.values()]
}

/**
 * One transaction, in the shape the guest's read already has: resolve what the
 * caller holds, set the scope from the row it returned, then read.
 *
 * The resolve is this request's only statement with no restaurant to scope by.
 * Nothing after it names a restaurant at all -- the policies on `table_order`
 * and `table_order_line` are what scope the read, against a value that came from
 * a row rather than from anything the caller sent, and there is no field in the
 * request for a caller to put one in.
 *
 * null is a session that does not resolve, and the route refuses it. A board
 * that answered an empty list instead would tell a kitchen that nothing is open
 * when what it actually knows is nothing at all.
 */
async function openOrders(pool: Pool, digest: Buffer): Promise<BoardOrder[] | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows } = await client.query<SessionRow>(SESSION_FOR_DIGEST, [digest])
    const session = rows[0]
    if (session === undefined) {
      await client.query('rollback')
      return null
    }

    await client.query(SET_SCOPE, [session.restaurant_id])
    const open = await client.query<BoardRow>(OPEN_ORDERS_IN_RESTAURANT, [OPEN_WINDOW])

    await client.query('commit')
    return group(open.rows)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/** What one act concluded. `refused` is a session that does not resolve, never an order. */
type Acted = 'recorded' | 'not-here' | 'refused'

/**
 * One transaction, in this router's established shape: resolve what the caller
 * holds, set the scope from the row it returned, then write.
 *
 * Two statements, because one cannot answer both questions. The claim tells a
 * first act from everything else; the read-back tells a repeat from an order
 * this scope cannot see. The `is null` clause each claim carries is what makes a
 * repeat write nothing at all rather than rewrite the row with the same value.
 *
 * `claim` is the only thing that differs between the two acts, which is why they
 * are one function. Both are `update ... where id = $1 and <column> is null
 * returning id`, and a divergence between them would be the thing to explain.
 *
 * Neither statement names a restaurant. The policy `0003` put on `table_order`
 * is `for all`, so it governs both updates exactly as it governs the board's
 * read, and an id belonging to another restaurant reaches zero rows twice --
 * which is the same thing an id belonging to nobody does, and the reason both
 * are answered with the same sentence.
 */
async function act(pool: Pool, digest: Buffer, id: string, claim: string): Promise<Acted> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows } = await client.query<SessionRow>(SESSION_FOR_DIGEST, [digest])
    const session = rows[0]
    if (session === undefined) {
      await client.query('rollback')
      return 'refused'
    }

    await client.query(SET_SCOPE, [session.restaurant_id])

    const acted = await client.query<{ id: string }>(claim, [id])
    if (acted.rows[0] !== undefined) {
      await client.query('commit')
      return 'recorded'
    }

    const existing = await client.query<ServedRow>(ORDER_IN_RESTAURANT, [id])
    await client.query('commit')
    // A row here is one this scope can see and this act did not change, which on
    // either claim has one cause: it had already been recorded. The same answer
    // as the first act, because a second screen cannot act on the difference.
    return existing.rows[0] === undefined ? 'not-here' : 'recorded'
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function staffRoutes(pool: Pool) {
  return async (app: FastifyInstance): Promise<void> => {
    app.post<{ Body: { email: string; password: string } }>(
      '/staff/sessions',
      { schema: SIGN_IN_SCHEMA },
      async (request, reply) => {
        const { email, password } = request.body

        const { rows } = await pool.query<StaffRow>(STAFF_FOR_EMAIL, [email])
        const staff = rows[0]

        if (staff === undefined) {
          // Not a shortcut past the derivation. See `verifyNobody`: an answer
          // that came back sooner is an answer to a question this route does
          // not take.
          await verifyNobody(password)
          return reply.code(401).send({ error: REFUSED })
        }

        if (!(await verifyPassword(staff.credential, password))) {
          return reply.code(401).send({ error: REFUSED })
        }

        // The token is minted here and its digest is what is written. The value
        // itself leaves in this response and is never in the database, so a
        // session cannot be resumed from a dump of it.
        const token = mintToken()
        await pool.query(OPEN_SESSION, [
          staff.staff_id,
          staff.restaurant_id,
          digestToken(token),
          SESSION_LIFETIME,
        ])

        return reply.code(201).send({ token, ...identity(staff) })
      },
    )

    app.get('/staff/sessions/current', { schema: CURRENT_SCHEMA }, async (request, reply) => {
      const token = bearer(request.headers.authorization)
      if (token === null) return reply.code(401).send({ error: CLOSED })

      const { rows } = await pool.query<SessionRow>(SESSION_FOR_DIGEST, [digestToken(token)])
      const open = rows[0]
      if (open === undefined) return reply.code(401).send({ error: CLOSED })

      return identity(open)
    })

    app.get('/staff/orders', { schema: BOARD_SCHEMA }, async (request, reply) => {
      const token = bearer(request.headers.authorization)
      if (token === null) return reply.code(401).send({ error: CLOSED })

      const orders = await openOrders(pool, digestToken(token))
      if (orders === null) return reply.code(401).send({ error: CLOSED })

      return { orders }
    })

    // The two acts, and the only thing that differs between them is the
    // statement. Written out twice rather than registered from a table: an
    // address is something a reader should be able to find by searching for it,
    // and a loop over a pair would hide both.
    app.post<{ Params: { id: string } }>(
      '/staff/orders/:id/served',
      { schema: SERVED_SCHEMA },
      async (request, reply) => {
        const token = bearer(request.headers.authorization)
        if (token === null) return reply.code(401).send({ error: CLOSED })

        const acted = await act(pool, digestToken(token), request.params.id, MARK_SERVED)
        if (acted === 'refused') return reply.code(401).send({ error: CLOSED })
        if (acted === 'not-here') return reply.code(404).send({ error: NOT_HERE })

        return reply.code(204).send()
      },
    )

    app.post<{ Params: { id: string } }>(
      '/staff/orders/:id/paid',
      { schema: PAID_SCHEMA },
      async (request, reply) => {
        const token = bearer(request.headers.authorization)
        if (token === null) return reply.code(401).send({ error: CLOSED })

        const acted = await act(pool, digestToken(token), request.params.id, MARK_PAID)
        if (acted === 'refused') return reply.code(401).send({ error: CLOSED })
        if (acted === 'not-here') return reply.code(404).send({ error: NOT_HERE })

        return reply.code(204).send()
      },
    )
  }
}
