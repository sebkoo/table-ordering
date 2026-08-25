/**
 * The acceptance conditions for the board's page.
 *
 * Every one is observed in a real browser, against the built client, over a real
 * network, with the API this file starts and the schema it creates. Nothing is a
 * stand-in, and that includes the credential: the record in each staff row is
 * produced by running `services/api/src/features/staff/credential.ts` as a
 * program and reading the two streams it prints on, so the password every
 * sign-in below types is a password the mint really minted. Importing that
 * module would open a boundary the application does not cross -- `apps/staff`
 * does not depend on `services/api` -- and a hand-written record would be a
 * fixture asserting its own format. Running the mint is the same posture this
 * suite takes towards the migrations, which it reads as files.
 *
 * What can be wrong here while looking right is silence, twice over. A board
 * that showed nothing when it could not read would tell a kitchen its tickets
 * are not there; a board rendered for somebody who is not signed in would say
 * the same thing about a restaurant nobody asked about. So the conditions below
 * separate four answers that all render as no tickets: a restaurant with nothing
 * open, a read that failed, a session that was refused, and nobody signed in at
 * all.
 *
 * The second subject is the secret. A page holding a bearer token can leak it in
 * more places than it renders, so one condition reads the whole document, both
 * storages, the cookie jar and the address bar, and looks for every value this
 * run minted -- the token, its digest, and every table code seeded.
 *
 * Each condition signs in to a restaurant of its own, so every ticket it counts
 * is its own and a condition deleted from the middle of this file changes
 * nothing about its neighbours. Only the first restaurant holds more than one
 * open order, which is what lets a truncating mistake redden that condition
 * alone.
 *
 * There is no way to put a token into this page from outside it -- it keeps one
 * in memory and reads none from anywhere -- so every condition that reaches the
 * board pays a real scrypt derivation. That is the cost of the decision in
 * ADR 0031 and it is reported rather than worked around.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'
import { build, type PreviewServer, preview } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NOTHING_OPEN } from './board.tsx'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..', '..', '..', '..')
const STAFF = join(ROOT, 'apps', 'staff')
const API_ENTRY = join(ROOT, 'services', 'api', 'src', 'main.ts')
const MINT_ENTRY = join(ROOT, 'services', 'api', 'src', 'features', 'staff', 'credential.ts')
const MIGRATIONS = [
  '0001-create-menu.up.sql',
  '0002-create-restaurant-table.up.sql',
  '0003-create-table-order.up.sql',
  '0004-create-staff.up.sql',
].map((name) => join(ROOT, 'services', 'api', 'migrations', name))

/** The credentials and published port in `compose.yaml`. This role owns the tables and seeds them. */
const OWNER_DATABASE_URL =
  'postgres://table_ordering:table_ordering_dev@127.0.0.1:55432/table_ordering'

/**
 * The role the API connects as, from `0003-create-table-order.up.sql`. The child
 * below is given this rather than the owner's credentials, because a policy does
 * not apply to a table's owner and an API started as one is not the API a
 * member of staff reaches.
 */
const APP_ROLE = 'table_ordering_app'
const APP_PASSWORD = 'table_ordering_app_dev'

const CONNECTION_STRING = process.env.DATABASE_URL ?? OWNER_DATABASE_URL
const SCHEMA = `staff_page_test_${process.pid}`
const LOCALE = 'en-GB'

/**
 * How long an action is given to conclude. An action that issues no request at
 * all runs this out and is then read as the state it is stuck in, which is a
 * value another value can differ from. A wait for the outcome a condition
 * expects would instead report a timeout, and a timeout is what a dead server
 * produces too.
 */
const SETTLE_MS = 5_000

let admin: Pool
let owner: Pool
let api: ChildProcess
let server: PreviewServer
let browser: Browser
let context: BrowserContext
let origin: string

/** The record every staff row carries, produced by running the mint. */
let credential = ''
/** The password that record was minted for, read off the mint's other stream. */
let password = ''

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

/**
 * One restaurant, its staff member, its tables and its open orders.
 *
 * Every name carries this run's schema, for the reason the guest suite gives:
 * the preview server reaches the API through a proxy, and text only this run can
 * produce is what makes a page served by somebody else's API impossible to miss.
 *
 * The codes are minted in the shape a printed card carries -- twelve lowercase
 * hex characters -- because the leak condition searches the page for them and a
 * placeholder would be a search for something no card would ever hold.
 */
type Seeded = {
  slug: string
  email: string
  who: string
  item: string
  codes: string[]
  labels: string[]
}

let minted = 0

function mintCode(): string {
  minted += 1
  return `${process.pid.toString(16)}${minted.toString(16)}`.padEnd(12, '0').slice(0, 12)
}

/**
 * A restaurant with one menu item, `labels.length` tables, and one open order at
 * each of the first `orders` of them.
 *
 * Orders are written through the role that owns the tables, so they are the
 * restaurant's rather than anything this page sent -- which is what a board
 * actually reads, and what a page showing only its own writes would fail on.
 */
async function seed(slug: string, who: string, labels: string[], orders: number): Promise<Seeded> {
  const email = `${who.toLowerCase()}@${slug}.example`
  const item = `Flat white ${slug} ${SCHEMA}`
  const codes = labels.map(() => mintCode())

  const { rows } = await owner.query<{ id: string }>(
    'insert into restaurant (slug, name) values ($1, $2) returning id',
    [slug, `The ${who} Room ${SCHEMA}`],
  )
  const restaurant = rows[0]
  if (restaurant === undefined) throw new Error(`no restaurant was seeded for ${slug}`)

  const { rows: items } = await owner.query<{ id: string }>(
    `insert into menu_item (restaurant_id, name, price_minor, currency, sort_order)
     values ($1, $2, 300, 'GBP', 10) returning id`,
    [restaurant.id, item],
  )
  const menuItem = items[0]
  if (menuItem === undefined) throw new Error(`no menu item was seeded for ${slug}`)

  const tables: string[] = []
  for (const [index, label] of labels.entries()) {
    const { rows: seededTables } = await owner.query<{ id: string }>(
      'insert into restaurant_table (restaurant_id, code, label) values ($1, $2, $3) returning id',
      [restaurant.id, codes[index], `${label} ${SCHEMA}`],
    )
    const table = seededTables[0]
    if (table === undefined) throw new Error(`no table was seeded for ${slug}`)
    tables.push(table.id)
  }

  for (let index = 0; index < orders; index++) {
    const { rows: seededOrders } = await owner.query<{ id: string }>(
      `insert into table_order (restaurant_id, table_id, submission_id)
       values ($1, $2, gen_random_uuid()) returning id`,
      [restaurant.id, tables[index]],
    )
    const order = seededOrders[0]
    if (order === undefined) throw new Error(`no order was seeded for ${slug}`)
    await owner.query(
      `insert into table_order_line (order_id, restaurant_id, menu_item_id, quantity)
       values ($1, $2, $3, $4)`,
      [order.id, restaurant.id, menuItem.id, index + 1],
    )
  }

  await owner.query(
    'insert into staff (restaurant_id, email, name, credential) values ($1, $2, $3, $4)',
    [restaurant.id, email, `${who} ${SCHEMA}`, credential],
  )

  return {
    slug,
    email,
    who: `${who} ${SCHEMA}`,
    item,
    codes,
    labels: labels.map((l) => `${l} ${SCHEMA}`),
  }
}

/** The restaurants, one per condition that reaches a board. */
let two: Seeded // two open orders, so a truncation has something to cut
let red: Seeded // the compared pair, one order each
let gold: Seeded
let closed: Seeded // the session refused at the board
let dropped: Seeded // the board read that never completed
let quiet: Seeded // nothing open
let named: Seeded // the identity read answered by somebody else
let held: Seeded // the leak search

// ---------------------------------------------------------------------------
// Starting the API, the mint, and the page
// ---------------------------------------------------------------------------

/** Wait for the line `main.ts` prints once it is bound, and take the address from it. */
function apiOrigin(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      seen += chunk
      const address = /api listening on (\S+)/.exec(seen)?.[1]
      if (address !== undefined) resolve(new URL(address).origin)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      seen += chunk
    })
    child.once('exit', (code) => reject(new Error(`the api exited with ${code}: ${seen}`)))
  })
}

/**
 * Run the mint and take both of the things it prints.
 *
 * The record is the whole of stdout, which is what the README's run step
 * captures. The password is on stderr, deliberately, so that it reaches no pipe
 * and no shell history -- and reading it here is the one place anything reads
 * it, which is why this is also the first thing to exercise that split.
 */
function runMint(): Promise<{ credential: string; password: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', MINT_ENTRY], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      out += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      err += chunk
    })

    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`the mint exited with ${code}: ${err}`))
        return
      }
      const said = /it is not stored\): (\S+)/.exec(err)?.[1]
      if (said === undefined) {
        reject(new Error(`the mint printed no password on stderr: ${err}`))
        return
      }
      resolve({ credential: out.trim(), password: said })
    })
  })
}

beforeAll(async () => {
  admin = new Pool({ connectionString: CONNECTION_STRING })
  await admin.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin.query(`create schema ${SCHEMA}`)

  owner = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path=${SCHEMA}` })
  for (const migration of MIGRATIONS) await owner.query(readFileSync(migration, 'utf8'))

  // One derivation, eight rows. Only the password is reused; every sign-in below
  // verifies it against the record the mint really produced.
  const mint = await runMint()
  credential = mint.credential
  password = mint.password

  two = await seed('two-rounds', 'Ada', ['Table 7', 'Table 8'], 2)
  red = await seed('red-lamp', 'Bo', ['Terrace 2'], 1)
  gold = await seed('gold-bar', 'Cy', ['Bench 1'], 1)
  closed = await seed('plum-tree', 'Dee', ['Table 3'], 1)
  dropped = await seed('teal-room', 'Eli', ['Table 4'], 1)
  quiet = await seed('green-yard', 'Fay', ['Table 5'], 0)
  named = await seed('sage-house', 'Gus', ['Table 6'], 1)
  held = await seed('navy-pier', 'Hal', ['Table 9'], 1)

  // Spawned rather than imported: `apps/staff` does not depend on
  // `services/api`, and a test is not a reason to open that boundary.
  const url = new URL(CONNECTION_STRING)
  url.username = APP_ROLE
  url.password = APP_PASSWORD
  url.searchParams.set('options', `-c search_path=${SCHEMA}`)
  api = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', API_ENTRY], {
    env: { ...process.env, DATABASE_URL: url.href, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const target = await apiOrigin(api)

  // The workspace's own output directory, which is what `pnpm --filter
  // @table-ordering/staff build` emits: this app has one browser suite, so
  // nothing else is building into it and the artefact measured is the artefact
  // the workspace produces.
  await build({ root: STAFF, logLevel: 'warn' })
  // The proxy rule lives here rather than in vite.config.ts for the reason that
  // file records: a default there would let this suite reach whatever is on port
  // 3000 and pass against a server it did not start.
  server = await preview({
    root: STAFF,
    logLevel: 'warn',
    preview: { port: 0, strictPort: false, proxy: { '/staff': target } },
  })
  const resolved = server.resolvedUrls?.local[0]
  if (resolved === undefined) throw new Error('the preview server reported no local URL')
  origin = new URL(resolved).origin

  browser = await chromium.launch()
  context = await browser.newContext({ locale: LOCALE })
  // Below vitest's own timeout, so an element that never arrives is reported as
  // the assertion it belongs to rather than as a dead suite.
  context.setDefaultTimeout(10_000)
})

afterAll(async () => {
  await context?.close()
  await browser?.close()
  await server?.close()
  api?.kill()
  await owner?.end()
  await admin?.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin?.end()
})

// ---------------------------------------------------------------------------
// Driving the page
// ---------------------------------------------------------------------------

/** A page, with everything it threw and everything it asked for collected from the start. */
type Opened = { page: Page; errors: string[]; requested: string[] }

async function open(on: BrowserContext = context): Promise<Opened> {
  const page = await on.newPage()
  const errors: string[] = []
  const requested: string[] = []
  // Attached before the first navigation, so an exception thrown while the page
  // was loading is collected rather than missed.
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => requested.push(request.url()))
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.locator('main').waitFor()
  return { page, errors, requested }
}

/**
 * A request this page made, settled either way: the response with its body
 * finished, or the failure, whichever came. Set up before the action and awaited
 * after it.
 *
 * The body is waited for and not only the headers, because what a condition
 * reads is the render that follows the parse. A page that issues no request at
 * all runs this out and is then read as whatever it is stuck in.
 */
function asking(page: Page, path: string): Promise<unknown> {
  const matches = (url: string): boolean => new URL(url).pathname === path
  return Promise.race([
    page
      .waitForResponse((response) => matches(response.url()), { timeout: SETTLE_MS })
      .then((response) => response.finished()),
    page.waitForEvent('requestfailed', {
      predicate: (request) => matches(request.url()),
      timeout: SETTLE_MS,
    }),
  ]).catch(() => undefined)
}

/**
 * Two turns of the page's own task queue, which is where the render that follows
 * an answer happens.
 *
 * A wait on the platform rather than on the DOM, because the conditions that
 * have to survive the page rendering *nothing* could not take a wait for an
 * element.
 */
function flushed(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(() => setTimeout(() => resolve(), 0), 0)
      }),
  )
}

/**
 * Fill the form and send it, then wait until the page is done with it -- not
 * until it reaches the outcome a condition expects.
 *
 * `data-busy` is cleared in a `finally`, after the identity read as well as the
 * sign-in, so one wait covers both requests. The board's own read is a separate
 * settle, because not every condition here has a board to wait for.
 */
async function signIn(page: Page, email: string, said: string): Promise<void> {
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(said)

  const concluded = asking(page, '/staff/sessions')
  await page.locator('button.sign-in').click()
  await concluded
  await page.locator('main[data-busy="false"]').waitFor()
}

/** Read and compare. Never a wait for the value the condition expects. */
function staffState(page: Page): Promise<string | null> {
  return page.locator('main').getAttribute('data-staff')
}

/**
 * The board's state, or null when there is no board.
 *
 * The count comes first so that a page rendering no board is a value another
 * value can differ from: `getAttribute` on a locator matching nothing reports a
 * timeout, and a timeout is what a dead server produces too.
 */
async function boardState(page: Page): Promise<string | null> {
  const region = page.locator('[data-board]')
  return (await region.count()) === 0 ? null : region.getAttribute('data-board')
}

function boardCount(page: Page): Promise<number> {
  return page.locator('[data-board]').count()
}

/** One entry per ticket, table first, in the sequence the route returned them. */
async function tickets(page: Page): Promise<string[][]> {
  const rows = page.locator('[data-board] li')
  const found: string[][] = []
  for (let index = 0; index < (await rows.count()); index++) {
    const row = rows.nth(index)
    found.push([
      (await row.locator('.table').textContent()) ?? '',
      (await row.locator('.lines').textContent()) ?? '',
    ])
  }
  return found
}

/** As {@link boardState}: null is the absence of the element, never a wait for it. */
async function text(page: Page, selector: string): Promise<string | null> {
  const at = page.locator(selector)
  return (await at.count()) === 0 ? null : at.textContent()
}

/**
 * Sign in and wait until the board's read has settled, whatever it settled into.
 *
 * The last wait is on settledness and not on an outcome: `loading` is the one
 * board state that is not an answer, and every answer satisfies it -- including
 * the board being absent, which is what a session refused at the board leaves
 * behind. It runs after the response's body has arrived, so the board is already
 * mounted and `loading`; run before that, it would be satisfied by a board that
 * had not been drawn yet.
 */
async function signInAndRead(page: Page, seeded: Seeded): Promise<void> {
  const read = asking(page, '/staff/orders')
  await signIn(page, seeded.email, password)
  await read
  await page.locator('[data-board="loading"]').waitFor({ state: 'detached' })
  await flushed(page)
}

// ---------------------------------------------------------------------------

describe('the board a member of staff signs in to', () => {
  // The whole flow, and the only condition whose every value came from a real
  // one: a record the mint printed, a row the operator would have inserted, a
  // password typed into the form, a token the API minted, and the board that
  // token reaches. Two tickets, so a page that truncated the list would differ
  // here as a value rather than pass.
  it("signs in through the form and shows that restaurant's open orders", async () => {
    const { page } = await open()
    await signInAndRead(page, two)

    expect([
      await staffState(page),
      await boardState(page),
      await tickets(page),
      // An order records no price, so nothing on this page may show one.
      await page.locator('[data-board] .price').count(),
    ]).toEqual([
      'signed-in',
      'ready',
      [
        [two.labels[0] ?? '', `1 × ${two.item}`],
        [two.labels[1] ?? '', `2 × ${two.item}`],
      ],
      0,
    ])
    await page.close()
  })

  // A comparison rather than an assertion: a page hard-coded to one restaurant
  // answers the first correctly, and only the second can tell the two apart.
  // Neither sign-in carries a field naming a restaurant, and there is none for
  // it to carry.
  it("shows each restaurant its own orders, and nothing of the other's", async () => {
    const { page: first } = await open()
    const { page: second } = await open()
    await signInAndRead(first, red)
    await signInAndRead(second, gold)

    const documents = [await first.content(), await second.content()]

    expect([
      await tickets(first),
      await tickets(second),
      // The negative half, read as a value: neither document carries anything
      // seeded for the other restaurant.
      [documents[0]?.includes(gold.item) ?? true, documents[1]?.includes(red.item) ?? true],
    ]).toEqual([
      [[red.labels[0] ?? '', `1 × ${red.item}`]],
      [[gold.labels[0] ?? '', `1 × ${gold.item}`]],
      [false, false],
    ])
    await first.close()
    await second.close()
  })

  // An empty board is an artefact of a signed-in read. A page that drew one for
  // somebody who has not signed in would say a restaurant has nothing open
  // without having asked about a restaurant at all.
  it('shows the sign-in form and no board at all before anyone signs in', async () => {
    const { page } = await open()

    expect([
      await staffState(page),
      await boardCount(page),
      await page.locator('button.sign-in').count(),
    ]).toEqual(['signed-out', 0, 1])
    await page.close()
  })

  // The refusal is shown in the API's own words, and the comparison is against
  // the API rather than against a string in this file: a page that translated
  // the sentence into copy of its own would differ here.
  it('says a refused sign-in in the words the api used, and shows no board', async () => {
    const answered = await fetch(`${origin}/staff/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: two.email, password: 'not the minted password' }),
    })
    const { error } = (await answered.json()) as { error: string }

    const { page } = await open()
    await signIn(page, two.email, 'not the minted password')

    expect([
      answered.status,
      await staffState(page),
      await text(page, '.said'),
      await boardCount(page),
    ]).toEqual([401, 'refused', error, 0])
    await page.close()
  })

  /**
   * A session refused at the board, which is not a board that could not be read.
   *
   * The remedy is signing in again, so the page goes back to the form carrying
   * what the API said -- and the 401 arrives as a value, never as an unhandled
   * rejection in the console, which is the other thing this reads.
   */
  it('returns to the sign-in state when the session is refused at the board', async () => {
    const { page, errors } = await open()
    await page.route('**/staff/orders', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'that session is not open' }),
      }),
    )
    await signInAndRead(page, closed)

    expect([await staffState(page), await boardCount(page), errors]).toEqual(['refused', 0, []])
    await page.close()
  })

  // A read that never completed. The restaurant has an order, so an empty board
  // here would be the page telling a kitchen its ticket is not there.
  it('says the board could not be read, rather than showing an empty board', async () => {
    const { page } = await open()
    await page.route('**/staff/orders', (route) => route.abort())
    await signInAndRead(page, dropped)

    expect([await staffState(page), await boardState(page), await tickets(page)]).toEqual([
      'signed-in',
      'unavailable',
      [],
    ])
    await page.close()
  })

  /**
   * The empty state, as its own artefact.
   *
   * A condition asserting that no tickets are shown passes identically when the
   * component crashed, was never mounted, or never asked. The count, the
   * attribute and the sentence are three values, and the count is first so that
   * a page rendering nothing reads as a value rather than as a timeout.
   *
   * The sentence is imported rather than restated, which leaves one copy of it
   * in this workspace instead of two.
   */
  it('renders an empty board as its own artefact, not as an absence', async () => {
    const { page } = await open()
    await signInAndRead(page, quiet)

    expect([
      await boardCount(page),
      await boardState(page),
      await text(page, '[data-board] .none'),
    ]).toEqual([1, 'empty', NOTHING_OPEN])
    await page.close()
  })

  /**
   * Who is signed in comes from the token, and not from the answer to the
   * request that minted it.
   *
   * The two are made to disagree, which is the only way to tell them apart: the
   * sign-in really answers Gus, and the identity read is answered by somebody
   * else. A page that remembered the sign-in's body shows Gus and fails here.
   */
  it("names who is signed in from the token, not from the sign-in's answer", async () => {
    const other = `Someone Else ${SCHEMA}`
    const { page } = await open()
    await page.route('**/staff/sessions/current', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          staff: { name: other },
          restaurant: { slug: 'somewhere-else', name: `Somewhere Else ${SCHEMA}` },
        }),
      }),
    )
    await signInAndRead(page, named)

    expect([await staffState(page), await text(page, '.who')]).toEqual([
      'signed-in',
      `${other} · Somewhere Else ${SCHEMA}`,
    ])
    await page.close()
  })

  /**
   * What the page holds, and where it does not hold it.
   *
   * The token is a bearer value with a twelve-hour life, so every place it could
   * come to rest is read: the document as rendered, both storages, the cookie
   * jar and the address bar. The digest is here for the same reason
   * `board.test.ts` searches for one -- a page that hashed the token before
   * storing it would still be storing it -- and every seeded table code is here
   * because a code authorises an order at that table and the board has no reader
   * for one.
   *
   * The second half is the origin count. A page that fetched a font, a script or
   * a beacon from anywhere else would put a room's kitchen on somebody else's
   * network, and this is a browser saying it does not.
   */
  it('puts no token, digest or table code anywhere, and reaches no origin but its own', async () => {
    const { page, requested } = await open()
    // The page's own token, taken off the request it made with it. Nothing else
    // can observe a value the page keeps in memory -- and a search for some
    // other token would establish nothing about this page.
    const carried = page
      .waitForRequest((request) => new URL(request.url()).pathname === '/staff/orders', {
        timeout: SETTLE_MS,
      })
      .catch(() => null)
    await signInAndRead(page, held)

    const request = await carried
    const token = (await request?.allHeaders())?.authorization?.replace(/^Bearer /i, '') ?? ''

    const haystack = [
      await page.content(),
      await page.evaluate(() => JSON.stringify(localStorage)),
      await page.evaluate(() => JSON.stringify(sessionStorage)),
      JSON.stringify(await context.cookies()),
      page.url(),
    ].join('\n')

    const codes = [two, red, gold, closed, dropped, quiet, named, held].flatMap((r) => r.codes)
    const leaked = (
      [
        ['a token the api minted', token],
        ['its digest', token === '' ? '' : createHash('sha256').update(token).digest('hex')],
        ...codes.map((code, index): [string, string] => [`table code ${index + 1}`, code]),
      ] as [string, string][]
    )
      .filter(([, value]) => value !== '' && haystack.includes(value))
      .map(([where]) => where)

    expect([
      // The page really did carry a token, so the search above had something to
      // look for. Without this an empty capture would report no leak.
      token === '',
      leaked,
      requested.filter((url) => !url.startsWith(`${origin}/`)),
    ]).toEqual([false, [], []])
    await page.close()
  })
})
