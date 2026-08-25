/**
 * The acceptance conditions for a member of staff proving who they are.
 *
 * The subject is a credential, so three things shape this file.
 *
 * The first is that every condition is a value diff. A refusal is a status and
 * a body compared against a status and a body, never an exception nobody read,
 * and the absence of a secret is a list of the places it was found compared
 * against an empty list.
 *
 * The second is what a fixture may look like. The passwords here are
 * self-evidently fixtures, and the wrong one differs from the right one at its
 * last character at equal length: a pair differing at the first character is
 * told apart by every truncation, and would establish nothing about how much of
 * the value was compared. The forged token is built the same way.
 *
 * The third is that two restaurants are seeded and both are used. A staff
 * member in the first restaurant cannot tell a correct answer from a hard-coded
 * one -- The Blue Door is what a hard-coded answer would say -- so the
 * wrong-restaurant condition is the one that asks the second.
 *
 * What is NOT pinned here: that a staff scope reaches only its own restaurant's
 * order rows. Nothing in this commit reads an order under a staff credential,
 * so there is nothing to compare; that condition lands with the read that needs
 * it. ADR 0029 says so where a reader of the record will find it.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../main.ts'
import {
  digestToken,
  hashPassword,
  mintCredential,
  mintToken,
  verifyPassword,
} from './credential.ts'

/**
 * The migration role, which owns the tables, as `order.test.ts` uses it and for
 * the same reason: the fixture is built and read from outside whatever the
 * application can see.
 */
const OWNER_DATABASE_URL =
  'postgres://table_ordering:table_ordering_dev@127.0.0.1:55432/table_ordering'
const APP_ROLE = 'table_ordering_app'
const APP_PASSWORD = 'table_ordering_app_dev'

const CONNECTION_STRING = process.env.DATABASE_URL ?? OWNER_DATABASE_URL
const SCHEMA = `staff_test_${process.pid}`
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations')
const MIGRATION_FILES = [
  '0001-create-menu.up.sql',
  '0002-create-restaurant-table.up.sql',
  '0003-create-table-order.up.sql',
  '0004-create-staff.up.sql',
]

function migration(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8')
}

function asAppRole(connectionString: string): string {
  const url = new URL(connectionString)
  url.username = APP_ROLE
  url.password = APP_PASSWORD
  return url.href
}

const BLUE = '11111111-1111-1111-1111-111111111111'
const RED = '22222222-2222-2222-2222-222222222222'
const ADA = 'f0000000-0000-4000-8000-000000000001'
const BO = 'f0000000-0000-4000-8000-000000000002'

const ADA_EMAIL = 'ada@blue-door.example'
const BO_EMAIL = 'bo@red-lamp.example'
const UNKNOWN_EMAIL = 'nobody@blue-door.example'

/**
 * Fixture passwords, and the near miss.
 *
 * `ADA_WRONG` is `ADA_PASSWORD` with its last character changed, at the same
 * length. A truncating comparison, a length check and a prefix test all call
 * those two equal; only a comparison of the whole value tells them apart.
 */
const ADA_PASSWORD = 'fixture-password-for-ada'
const ADA_WRONG = 'fixture-password-for-adb'
const BO_PASSWORD = 'fixture-password-for-bob'

const REFUSED = 'that email and password do not match'
const CLOSED = 'that session is not open'

/** The last character changed, for the same reason `ADA_WRONG` is. */
function nearMiss(value: string): string {
  const last = value.slice(-1)
  return `${value.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`
}

let admin: Pool
let owner: Pool
let app: Pool
let server: FastifyInstance
let origin: string

type Identity = { staff: { name: string }; restaurant: { slug: string; name: string } }
type SignedIn = Identity & { token: string }

async function signIn(email: string, password: string): Promise<Response> {
  return fetch(`${origin}/staff/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

async function whoAmI(token: string | null): Promise<Response> {
  return fetch(`${origin}/staff/sessions/current`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })
}

/** A signed-in session's body, for the conditions whose subject is what comes after it. */
async function tokenFor(email: string, password: string): Promise<string> {
  const body = (await (await signIn(email, password)).json()) as SignedIn
  return body.token
}

type StaffRow = {
  id: string
  restaurant_id: string
  email: string
  name: string
  credential: string
}

async function staffRow(email: string): Promise<StaffRow | undefined> {
  const { rows } = await owner.query<StaffRow>(
    'select id, restaurant_id, email, name, credential from staff where email = $1',
    [email],
  )
  return rows[0]
}

type SessionRow = { staff_id: string; restaurant_id: string; token_digest: Buffer }

async function sessionsFor(staffId: string): Promise<SessionRow[]> {
  const { rows } = await owner.query<SessionRow>(
    `select staff_id, restaurant_id, token_digest from staff_session
      where staff_id = $1 order by opened_at`,
    [staffId],
  )
  return rows
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

  // Hashed here by the same function the route verifies with. A record written
  // out by hand would be a fixture the production code never produced, and the
  // first thing it would stop noticing is a change to the format.
  await owner.query(
    `insert into staff (id, restaurant_id, email, name, credential) values
       ($1, $2, $3, 'Ada', $4),
       ($5, $6, $7, 'Bo', $8)`,
    [
      ADA,
      BLUE,
      ADA_EMAIL,
      await hashPassword(ADA_PASSWORD),
      BO,
      RED,
      BO_EMAIL,
      await hashPassword(BO_PASSWORD),
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

describe('the session a member of staff signs in for', () => {
  it('answers the staff member their own name and their own restaurant', async () => {
    const response = await signIn(ADA_EMAIL, ADA_PASSWORD)
    const body = (await response.json()) as SignedIn

    const { token, ...identity } = body
    expect([response.status, identity]).toEqual([
      201,
      {
        staff: { name: 'Ada' },
        restaurant: { slug: 'blue-door', name: 'The Blue Door' },
      },
    ])
    // The token is not compared with anything -- it is minted -- but a route
    // that stopped returning one would leave the next condition with nothing to
    // send, and this says which of the two went wrong.
    expect(typeof token).toBe('string')
  })

  it('is recognised on the next request, under the token it answered with', async () => {
    const token = await tokenFor(ADA_EMAIL, ADA_PASSWORD)

    const response = await whoAmI(token)
    expect([response.status, await response.json()]).toEqual([
      200,
      {
        staff: { name: 'Ada' },
        restaurant: { slug: 'blue-door', name: 'The Blue Door' },
      },
    ])
  })

  // The wrong-restaurant condition, and the reason two restaurants are seeded.
  // A hard-coded 'blue-door' answers Ada correctly; only Bo can tell the two
  // apart. There is no field in either request that names a restaurant, so the
  // only thing that decides which one is answered is the row the credential
  // resolved to.
  it('answers each restaurant its own staff member, and never the other', async () => {
    const [ada, bo] = await Promise.all([
      tokenFor(ADA_EMAIL, ADA_PASSWORD),
      tokenFor(BO_EMAIL, BO_PASSWORD),
    ])

    const [forAda, forBo] = await Promise.all([whoAmI(ada), whoAmI(bo)])
    const answers = [await forAda.json(), await forBo.json()]

    expect([forAda.status, forBo.status, answers]).toEqual([
      200,
      200,
      [
        { staff: { name: 'Ada' }, restaurant: { slug: 'blue-door', name: 'The Blue Door' } },
        { staff: { name: 'Bo' }, restaurant: { slug: 'red-lamp', name: 'The Red Lamp' } },
      ],
    ])
  })

  // The row, not the answer. Bo rather than Ada for the reason above: a session
  // row written with a hard-coded restaurant would carry The Blue Door's id and
  // Ada's rows could not show it.
  it("writes the session row into the staff member's own restaurant", async () => {
    await tokenFor(BO_EMAIL, BO_PASSWORD)

    const rows = await sessionsFor(BO)
    const restaurants = [...new Set(rows.map((row) => row.restaurant_id))]

    expect([rows.length > 0, restaurants]).toEqual([true, [RED]])
  })
})

describe('a credential the route refuses', () => {
  it('refuses a wrong password as a value, and opens no session', async () => {
    const before = (await sessionsFor(ADA)).length

    const response = await signIn(ADA_EMAIL, ADA_WRONG)

    expect([response.status, await response.json()]).toEqual([401, { error: REFUSED }])
    expect((await sessionsFor(ADA)).length).toBe(before)
  })

  // The same answer, compared against the other one rather than only against a
  // literal. An API whose two refusals differ is an API that will tell anybody
  // which addresses have staff behind them.
  it('refuses an unknown email with the same value a wrong password gets', async () => {
    const unknown = await signIn(UNKNOWN_EMAIL, ADA_PASSWORD)
    const wrong = await signIn(ADA_EMAIL, ADA_WRONG)

    expect([unknown.status, await unknown.json()]).toEqual([401, { error: REFUSED }])
    expect([unknown.status, unknown.statusText]).toEqual([wrong.status, wrong.statusText])
  })

  // Neither the token nor a session that has run out. Both are 401 and both say
  // the same thing: a client cannot act on the difference, and an API that
  // reported one would be saying which tokens have ever existed.
  it('refuses a token that was never minted, and a session that has expired', async () => {
    const real = mintToken()
    await owner.query(
      `insert into staff_session (staff_id, restaurant_id, token_digest, expires_at)
       values ($1, $2, $3, now() - interval '1 hour')`,
      [ADA, BLUE, digestToken(real)],
    )

    const [forged, expired] = await Promise.all([whoAmI(nearMiss(real)), whoAmI(real)])

    expect([forged.status, await forged.json()]).toEqual([401, { error: CLOSED }])
    expect([expired.status, await expired.json()]).toEqual([401, { error: CLOSED }])
  })
})

describe('what the system stores and what it says', () => {
  // The password is searched for in every place this request touched: the row
  // it was checked against, the row the sign-in wrote, and both bodies. The
  // token is searched for in the row, which stores a digest of it.
  it('keeps the password out of every stored row and every answer, and the token out of the row', async () => {
    const signedIn = await signIn(ADA_EMAIL, ADA_PASSWORD)
    const success = await signedIn.text()
    const refused = await (await signIn(ADA_EMAIL, ADA_WRONG)).text()
    const { token } = JSON.parse(success) as SignedIn

    const stored = JSON.stringify(await staffRow(ADA_EMAIL))
    const sessions = await sessionsFor(ADA)

    // Both the password that was right and the password that was wrong. A route
    // that echoed "the password you sent" leaks on the refusal, where what was
    // sent is the wrong one, so searching only for the real one would be
    // watching the half that does not leak.
    const holdsPassword = [
      ['staff row', stored],
      ['staff_session rows', JSON.stringify(sessions)],
      ['the 201 body', success],
      ['the 401 body', refused],
    ]
      .filter(([, text]) =>
        [ADA_PASSWORD, ADA_WRONG].some((secret) => (text ?? '').includes(secret)),
      )
      .map(([where]) => where)

    // Compared as a value, not searched for as text. `JSON.stringify` renders a
    // bytea as a list of numbers, so a token written straight into the column
    // does not appear in the text above at all.
    const storesToken = sessions.some((row) => row.token_digest.toString('utf8') === token)

    expect([holdsPassword, storesToken]).toEqual([[], false])
  })
})

describe('the credential the operator mints', () => {
  it('produces a record the route accepts, and only for the password it printed', async () => {
    const { password, credential } = await mintCredential()

    expect([
      await verifyPassword(credential, password),
      await verifyPassword(credential, nearMiss(password)),
      credential.includes(password),
    ]).toEqual([true, false, false])
  })
})

describe('the down migration', () => {
  // Its own schema, because it destroys what it runs against, and taken all the
  // way back and forward again: a down that leaves something behind passes a
  // `to_regclass` check and then fails the next `up`, which is the run a
  // developer resetting a scratch database actually makes.
  const DOWN_SCHEMA = `staff_down_test_${process.pid}`
  const DOWN_FILES = [
    '0004-create-staff.down.sql',
    '0003-create-table-order.down.sql',
    '0002-create-restaurant-table.down.sql',
    '0001-create-menu.down.sql',
  ]

  it('removes what the up migration created, and lets it be applied again', async () => {
    await admin.query(`drop schema if exists ${DOWN_SCHEMA} cascade`)
    await admin.query(`create schema ${DOWN_SCHEMA}`)
    const scratch = new Pool({
      connectionString: CONNECTION_STRING,
      options: `-c search_path=${DOWN_SCHEMA}`,
    })

    const present = async () => {
      const { rows } = await scratch.query(
        `select to_regclass('${DOWN_SCHEMA}.staff') as staff,
                to_regclass('${DOWN_SCHEMA}.staff_session') as staff_session`,
      )
      return rows[0]
    }

    try {
      for (const file of MIGRATION_FILES) await scratch.query(migration(file))
      // Rows, so the drops run against a populated schema rather than an empty
      // one: what a developer resets is never empty.
      await scratch.query(`insert into restaurant (id, slug, name) values ($1, 'down-door', $2)`, [
        BLUE,
        'The Down Door',
      ])
      await scratch.query(
        `insert into staff (id, restaurant_id, email, name, credential)
         values ($1, $2, $3, 'Ada', 'not-a-record')`,
        [ADA, BLUE, ADA_EMAIL],
      )
      await scratch.query(
        `insert into staff_session (staff_id, restaurant_id, token_digest, expires_at)
         values ($1, $2, $3, now())`,
        [ADA, BLUE, digestToken(mintToken())],
      )
      expect(await present()).toEqual({ staff: 'staff', staff_session: 'staff_session' })

      for (const file of DOWN_FILES) await scratch.query(migration(file))
      expect(await present()).toEqual({ staff: null, staff_session: null })

      for (const file of MIGRATION_FILES) await scratch.query(migration(file))
      expect(await present()).toEqual({ staff: 'staff', staff_session: 'staff_session' })
    } finally {
      await scratch.end()
      await admin.query(`drop schema if exists ${DOWN_SCHEMA} cascade`)
    }
  })
})
