/**
 * The two ways a member of staff is recognised.
 *
 * `POST /staff/sessions` takes an email and a password and answers who they
 * belong to, with the token every later request carries.
 * `GET /staff/sessions/current` answers the same identity for a token.
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
import { digestToken, mintToken, verifyNobody, verifyPassword } from './credential.ts'
import {
  OPEN_SESSION,
  SESSION_FOR_DIGEST,
  SESSION_LIFETIME,
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

const REFUSED = 'that email and password do not match'
const CLOSED = 'that session is not open'

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
  }
}
