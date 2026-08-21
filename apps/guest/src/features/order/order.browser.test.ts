/**
 * The acceptance conditions for the order a guest sends from their page.
 *
 * Every one is observed in a real browser, against the built client, over a real
 * network, with the API this file starts and the schema it creates. Nothing is a
 * stand-in, including the failures: the send that does not go is a browser that
 * has been put offline, and the send whose answer never arrives is a request
 * that reaches the server and has its response dropped on the way back. Neither
 * intercepts the application.
 *
 * The subject is the submission id, and the id is where this can be wrong while
 * looking right. If one id named a *visit* rather than a *send*, a guest's
 * second round would carry the first id, `ON CONFLICT DO NOTHING` would answer
 * with the first order, and the second round's food would be gone -- 201, a real
 * order id, and every condition below except C2 still green. So C2 compares two
 * orders' line sets against one, as values.
 *
 * Each condition orders at its own seeded table, so every count it reads is its
 * own and a condition deleted from the middle of this file changes nothing about
 * its neighbours.
 *
 * The build goes to a directory of this run's own. `menu.browser.test.ts` builds
 * into `apps/guest/dist`, which is what `pnpm --filter @table-ordering/guest
 * build` emits, so that suite measures the artefact the workspace produces; the
 * two files run concurrently and `vite build` empties its outDir, so a second
 * build cannot share it. The asymmetry ends at a third suite: at that point they
 * all take private directories and the default output stops being any suite's
 * subject. Two is where the asymmetry is cheaper than the change.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'
import { build, type PreviewServer, preview } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..', '..', '..', '..')
const GUEST = join(ROOT, 'apps', 'guest')
const API_ENTRY = join(ROOT, 'services', 'api', 'src', 'main.ts')
const MIGRATIONS = [
  '0001-create-menu.up.sql',
  '0002-create-restaurant-table.up.sql',
  '0003-create-table-order.up.sql',
].map((name) => join(ROOT, 'services', 'api', 'migrations', name))

/** The credentials and published port in `compose.yaml`. This role owns the tables and seeds them. */
const OWNER_DATABASE_URL =
  'postgres://table_ordering:table_ordering_dev@127.0.0.1:55432/table_ordering'

/**
 * The role the API connects as, from `0003-create-table-order.up.sql`. The child
 * below is given this rather than the owner's credentials, because a policy does
 * not apply to a table's owner and an API started as one is not the API a guest
 * reaches.
 */
const APP_ROLE = 'table_ordering_app'
const APP_PASSWORD = 'table_ordering_app_dev'

const CONNECTION_STRING = process.env.DATABASE_URL ?? OWNER_DATABASE_URL
const SCHEMA = `order_page_test_${process.pid}`
const SLUG = 'blue-door'
const LOCALE = 'en-GB'

/**
 * One table per condition, so that "the orders at this table" is exactly this
 * condition's orders and no count is a tally of what a neighbour left behind.
 * Lowercase alphanumeric because that is what a printed card carries and what
 * the route's pattern admits.
 */
function tableCode(letter: string): string {
  return `t${process.pid}${letter}f2m9k4x1`
}

const SENDS = tableCode('a')
const SECOND_ROUND = tableCode('b')
const OFFLINE = tableCode('c')
const LOST_ANSWER = tableCode('d')
const REFUSED = tableCode('e')
const NO_RANDOM_UUID = tableCode('f')

const TABLES = [SENDS, SECOND_ROUND, OFFLINE, LOST_ANSWER, REFUSED, NO_RANDOM_UUID]

/**
 * The item names carry this run's schema, for the reason `menu.browser.test.ts`
 * gives: the preview server reaches the API through a proxy, and text only this
 * run can produce is what makes a page served by somebody else's API impossible
 * to miss.
 */
const FLAT_WHITE = `Flat white ${SCHEMA}`
const CINNAMON_BUN = `Cinnamon bun ${SCHEMA}`
const MISO_SOUP = `Miso soup ${SCHEMA}`
/** Deleted by C6 while a guest has the page open. Its own item, so no other condition loses one. */
const SPECIAL = `Off-menu special ${SCHEMA}`

const FLAT_WHITE_ID = 'a0000000-0000-4000-8000-000000000001'
const CINNAMON_BUN_ID = 'a0000000-0000-4000-8000-000000000002'
const MISO_SOUP_ID = 'a0000000-0000-4000-8000-000000000003'
const SPECIAL_ID = 'a0000000-0000-4000-8000-000000000004'

const ITEMS = [
  { id: FLAT_WHITE_ID, name: FLAT_WHITE, sortOrder: 10 },
  { id: CINNAMON_BUN_ID, name: CINNAMON_BUN, sortOrder: 20 },
  { id: MISO_SOUP_ID, name: MISO_SOUP, sortOrder: 30 },
  { id: SPECIAL_ID, name: SPECIAL, sortOrder: 40 },
]

/**
 * How long a send is given to conclude. A send that never issues a request at
 * all -- a page that threw before the fetch -- runs this out and is then read as
 * the state it is stuck in, which is a value another value can differ from. A
 * wait for the outcome a condition expects would instead report a timeout, and a
 * timeout is what a dead server produces too.
 */
const SETTLE_MS = 5_000

let admin: Pool
let owner: Pool
let api: ChildProcess
let server: PreviewServer
let browser: Browser
let context: BrowserContext
let origin: string

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

beforeAll(async () => {
  admin = new Pool({ connectionString: CONNECTION_STRING })
  await admin.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin.query(`create schema ${SCHEMA}`)

  owner = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path=${SCHEMA}` })
  for (const migration of MIGRATIONS) await owner.query(readFileSync(migration, 'utf8'))

  await owner.query('insert into restaurant (slug, name) values ($1, $2)', [SLUG, 'The Blue Door'])
  for (const item of ITEMS) {
    await owner.query(
      `insert into menu_item (id, restaurant_id, name, price_minor, currency, sort_order)
       select $2, id, $3, 300, 'GBP', $4 from restaurant where slug = $1`,
      [SLUG, item.id, item.name, item.sortOrder],
    )
  }
  for (const code of TABLES) {
    await owner.query(
      `insert into restaurant_table (restaurant_id, code, label)
       select id, $2, $3 from restaurant where slug = $1`,
      [SLUG, code, `Table ${code}`],
    )
  }

  // Spawned rather than imported: `apps/guest` does not depend on
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

  const outDir = join(tmpdir(), SCHEMA)
  await build({ root: GUEST, logLevel: 'warn', build: { outDir, emptyOutDir: true } })
  // The proxy rule lives here rather than in vite.config.ts for the reason that
  // file records: a default there would let this suite reach whatever is on port
  // 3000 and pass against a server it did not start.
  server = await preview({
    root: GUEST,
    logLevel: 'warn',
    build: { outDir },
    preview: { port: 0, strictPort: false, proxy: { '/restaurants': target, '/tables': target } },
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

type OrderLineRow = { id: string; quantity: number | null; name: string | null }

/**
 * Every order at one table, as line sets, read from outside the policy so that
 * what a condition asserts is what is stored rather than what the application
 * was willing to show itself.
 *
 * The join is a LEFT JOIN so that an order carrying no lines is `[]` inside the
 * result rather than absent from it: "no order" and "an order with nothing on
 * it" are different failures and a condition asserting nothing was written has
 * to be able to tell them apart.
 *
 * Sorted by their own text. Nothing here asserts which order was placed first,
 * and `placed_at` is the transaction's start time, which two sends can share.
 */
async function ordersAt(code: string): Promise<string[][]> {
  const { rows } = await owner.query<OrderLineRow>(
    `select o.id, l.quantity, m.name
       from table_order o
       join restaurant_table t on t.id = o.table_id
       left join table_order_line l on l.order_id = o.id
       left join menu_item m on m.id = l.menu_item_id
      where t.code = $1`,
    [code],
  )

  const byOrder = new Map<string, string[]>()
  for (const row of rows) {
    const lines = byOrder.get(row.id) ?? []
    if (row.quantity !== null && row.name !== null) lines.push(`${row.quantity} × ${row.name}`)
    byOrder.set(row.id, lines)
  }

  return [...byOrder.values()]
    .map((lines) => [...lines].sort())
    .sort((a, b) => a.join('|').localeCompare(b.join('|')))
}

async function openTable(code: string, on: BrowserContext = context): Promise<Page> {
  const page = await on.newPage()
  await page.goto(`${origin}/t/${code}`, { waitUntil: 'networkidle' })
  await page.locator('main:not([data-state="loading"])').waitFor()
  return page
}

async function choose(page: Page, name: string, quantity: number): Promise<void> {
  await page.getByLabel(`How many ${name}`, { exact: true }).fill(String(quantity))
}

/**
 * Press send and wait until the page is done with it -- not until it reaches the
 * outcome a condition expects.
 *
 * Two waits, in this order, because neither alone settles it. The first is the
 * network: a response or a failed request, whichever the send produces. The
 * second is the render that follows, which is where `data-busy` is cleared. A
 * send that issues no request runs the first wait out and finds `data-busy`
 * already false, so the condition reads whatever state the page is stuck in.
 */
async function send(page: Page, code: string): Promise<void> {
  const path = `/tables/${code}/orders`
  const concluded = Promise.race([
    page.waitForResponse((response) => response.url().endsWith(path), { timeout: SETTLE_MS }),
    page.waitForEvent('requestfailed', {
      predicate: (request) => request.url().endsWith(path),
      timeout: SETTLE_MS,
    }),
  ]).catch(() => undefined)

  await page.locator('button.send').click()
  await concluded
  await page.locator('[data-order][data-busy="false"]').waitFor()
}

/** Read and compare. Never a wait for the value the condition expects. */
function state(page: Page): Promise<string | null> {
  return page.locator('[data-order]').getAttribute('data-order')
}

describe('the order a guest sends from their table', () => {
  it('sends what the guest chose, and the kitchen has it', async () => {
    const page = await openTable(SENDS)

    await choose(page, FLAT_WHITE, 2)
    await send(page, SENDS)

    expect(await state(page)).toBe('sent')
    expect(await page.locator('[data-order] .outcome').textContent()).toContain('with the kitchen')
    expect(await ordersAt(SENDS)).toEqual([[`2 × ${FLAT_WHITE}`]])
    await page.close()
  })

  // The condition this whole commit turns on. One id names one send, not one
  // visit: if it named the visit, the second round would carry the first id and
  // the API would answer with the first order, leaving the bun unordered and
  // every status code correct.
  it('makes a second round a second order', async () => {
    const page = await openTable(SECOND_ROUND)

    await choose(page, FLAT_WHITE, 1)
    await send(page, SECOND_ROUND)
    expect(await state(page)).toBe('sent')

    await choose(page, CINNAMON_BUN, 1)
    await send(page, SECOND_ROUND)
    expect(await state(page)).toBe('sent')

    expect(await ordersAt(SECOND_ROUND)).toEqual([[`1 × ${CINNAMON_BUN}`], [`1 × ${FLAT_WHITE}`]])
    await page.close()
  })

  // A context of its own, so that being offline cannot outlive this condition if
  // an assertion below it fails.
  it('says a send did not go, writes nothing, and lands once when it is sent again', async () => {
    const offline = await browser.newContext({ locale: LOCALE })
    offline.setDefaultTimeout(10_000)

    try {
      const page = await openTable(OFFLINE, offline)
      await choose(page, FLAT_WHITE, 1)

      await offline.setOffline(true)
      await send(page, OFFLINE)

      expect(await state(page)).toBe('unsent')
      expect(await page.locator('[data-order] .outcome').textContent()).toContain('try again')
      expect(await ordersAt(OFFLINE)).toEqual([])

      await offline.setOffline(false)
      await send(page, OFFLINE)

      expect(await state(page)).toBe('sent')
      expect(await ordersAt(OFFLINE)).toEqual([[`1 × ${FLAT_WHITE}`]])
    } finally {
      await offline.close()
    }
  })

  /**
   * The reload condition, and the only one where the stored *id* is what is
   * being measured rather than the stored lines.
   *
   * The first send reaches the server and commits; its response is dropped on
   * the way back, so the page cannot tell it from a send that never arrived --
   * which is the case a guest on a restaurant's wifi actually meets. The page is
   * then reloaded, which is what a guest does, and sent again. An id that did
   * not survive the reload orders the soup twice.
   */
  it('makes one order of a send whose answer was lost and a retry after a reload', async () => {
    const page = await openTable(LOST_ANSWER)
    const path = `/tables/${LOST_ANSWER}/orders`

    await page.route(`**${path}`, async (route) => {
      // Performed, then dropped: the server receives it and commits, and the
      // page's fetch rejects. `route.fetch` does not handle the route, so the
      // abort below is what answers the browser.
      await route.fetch()
      await route.abort()
    })

    await choose(page, MISO_SOUP, 1)
    await send(page, LOST_ANSWER)
    expect(await state(page)).toBe('unsent')

    await page.unroute(`**${path}`)
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('main:not([data-state="loading"])').waitFor()

    // The reloaded page came back holding the send that had not resolved.
    expect(await state(page)).toBe('unsent')
    expect(await page.locator('[data-order] .pending').textContent()).toContain(`1 × ${MISO_SOUP}`)

    await send(page, LOST_ANSWER)

    expect(await state(page)).toBe('sent')
    expect(await ordersAt(LOST_ANSWER)).toEqual([[`1 × ${MISO_SOUP}`]])
    await page.close()
  })

  it('offers no way to order on a page with no table', async () => {
    const page = await context.newPage()
    await page.goto(`${origin}/r/${SLUG}`, { waitUntil: 'networkidle' })
    await page.locator('main:not([data-state="loading"])').waitFor()

    // Two counts, because either alone passes for the wrong reason: a page that
    // rendered nothing at all has no order control either.
    expect(await page.locator('[data-order]').count()).toBe(0)
    expect(await page.locator('li .name').count()).toBe(ITEMS.length)
    await page.close()
  })

  /**
   * A restaurant takes something off the menu while a guest has the page open.
   *
   * The send is refused for good -- sending the same body again sends the same
   * body -- so the page says so instead of offering a retry that would fail
   * identically forever. And because nothing was written, the pending is retired
   * rather than frozen: the guest drops the item that is gone, sends the rest,
   * and that lands. A state with no exit would strand them with a page that can
   * order nothing else.
   */
  it('refuses an order for an item taken off the menu, and stays orderable', async () => {
    const page = await openTable(REFUSED)

    await choose(page, FLAT_WHITE, 1)
    await choose(page, SPECIAL, 1)
    await owner.query('delete from menu_item where id = $1', [SPECIAL_ID])

    expect(await ordersAt(REFUSED)).toEqual([])
    await send(page, REFUSED)

    expect(await state(page)).toBe('refused')
    expect(await page.locator('[data-order] .outcome').textContent()).toContain(
      'ask a member of staff',
    )
    // Both halves: no order, and no line. A transaction that wrote the line that
    // was fine before the one that was not would leave one of each.
    expect(await ordersAt(REFUSED)).toEqual([])

    // Orderable again, read rather than left to the fill below to discover. A
    // page that froze the rows on a refusal would fail that fill as a timeout,
    // which names neither the freeze nor anything else.
    const row = page.getByLabel(`How many ${FLAT_WHITE}`, { exact: true })
    expect(await row.isDisabled()).toBe(false)

    await choose(page, SPECIAL, 0)
    await send(page, REFUSED)

    expect(await state(page)).toBe('sent')
    expect(await ordersAt(REFUSED)).toEqual([[`1 × ${FLAT_WHITE}`]])
    await page.close()
  })

  /**
   * `crypto.randomUUID` is exposed only in a secure context, and the likeliest
   * first deployment of this is a self-hosted server on a restaurant's LAN over
   * plain HTTP -- where the menu loads, the guest chooses, and the send dies.
   *
   * The page mints from `crypto.getRandomValues`, which carries no such gate, and
   * this is what says so. The environment is constructed rather than found, the
   * same way `check-conventions`'s own conditions construct an absent git
   * configuration on a machine that has one: `randomUUID` is removed here on a
   * browser that has it.
   */
  it('sends with randomUUID absent, as a page served over plain http would find it', async () => {
    const page = await context.newPage()
    // `Reflect.deleteProperty` rather than `delete`: the property is not
    // optional, and a cast to say it is would be this fixture describing the
    // platform rather than changing it.
    await page.addInitScript(() => {
      Reflect.deleteProperty(Crypto.prototype, 'randomUUID')
    })
    await page.goto(`${origin}/t/${NO_RANDOM_UUID}`, { waitUntil: 'networkidle' })
    await page.locator('main:not([data-state="loading"])').waitFor()

    await choose(page, FLAT_WHITE, 1)
    await send(page, NO_RANDOM_UUID)

    expect(await state(page)).toBe('sent')
    expect(await ordersAt(NO_RANDOM_UUID)).toEqual([[`1 × ${FLAT_WHITE}`]])
    await page.close()
  })
})
