/**
 * The acceptance conditions for the page a guest opens.
 *
 * Every one is observed in a real browser, against the built client, over a
 * real network. The dev server is not what a guest loads: it serves an
 * unbundled module graph, and a remote URL that only appears in built CSS would
 * walk past a measurement taken there. So this test builds the client and
 * serves the build.
 *
 * Nothing here is a stand-in, including the failure. The schema is created from
 * the migration files, the API is the process `main.ts` starts, the page is the
 * artefact `vite build` produces, and the browser is Chromium; the condition
 * about a menu that cannot be reached stops that API rather than intercepting
 * the request the page makes for it.
 *
 * The seeded item names carry this run's schema name. That is not decoration:
 * the preview server reaches the API through a proxy, and if the proxy ever
 * pointed somewhere else -- a developer's own API on port 3000, say -- the
 * assertions below would be measuring a server this test did not start. Text
 * only this run can produce is what makes that impossible to miss.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
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
  // Applied although nothing here orders anything: it is the migration that
  // creates the role the API below connects as, and grants it the menu tables.
  '0003-create-table-order.up.sql',
].map((name) => join(ROOT, 'services', 'api', 'migrations', name))

/** The credentials and published port in `compose.yaml`. This role owns the tables and seeds them. */
const OWNER_DATABASE_URL =
  'postgres://table_ordering:table_ordering_dev@127.0.0.1:55432/table_ordering'

/**
 * The role the API connects as, from `0003-create-table-order.up.sql`, matching
 * `DEFAULT_DATABASE_URL` in `services/api/src/main.ts`. The child below is given
 * this rather than the owner's credentials, because a policy does not apply to a
 * table's owner and an API started as one is not the API a guest reaches.
 */
const APP_ROLE = 'table_ordering_app'
const APP_PASSWORD = 'table_ordering_app_dev'

const CONNECTION_STRING = process.env.DATABASE_URL ?? OWNER_DATABASE_URL
const SCHEMA = `guest_page_test_${process.pid}`
const SLUG = 'blue-door'

/**
 * The code this run prints on its table, and the label the page should show.
 * The code is lowercase alphanumeric because that is what a printed card
 * carries and what the route's pattern admits; the label carries the schema
 * name for the same reason the item names do, so an assertion on it cannot be
 * satisfied by a server this test did not start.
 */
const CODE = `t${process.pid}f2m9k4x1`
const LABEL = `Table 7 ${SCHEMA}`

/**
 * Seeded out of menu order, so the assertion on order proves the page renders
 * what it was sent rather than what the database happened to hand back first.
 *
 * The yen row is there for the money invariant. JPY has no minor unit, so a
 * price divided by a hard-coded 100 renders a hundredth of it, and only a
 * currency whose exponent is not two can tell the two implementations apart.
 */
const ITEMS = [
  { name: `Cinnamon bun ${SCHEMA}`, priceMinor: 450, currency: 'GBP', sortOrder: 20 },
  { name: `Flat white ${SCHEMA}`, priceMinor: 300, currency: 'GBP', sortOrder: 10 },
  { name: `Miso soup ${SCHEMA}`, priceMinor: 600, currency: 'JPY', sortOrder: 30 },
]

const LOCALE = 'en-GB'

function money(priceMinor: number, currency: string): string {
  const format = new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2
  return format.format(priceMinor / 10 ** digits)
}

let admin: Pool
let api: ChildProcess
let server: PreviewServer
let browser: Browser
let context: BrowserContext
let page: Page
let origin: string
const requested: string[] = []

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

  const scoped = new Pool({
    connectionString: CONNECTION_STRING,
    options: `-c search_path=${SCHEMA}`,
  })
  for (const migration of MIGRATIONS) await scoped.query(readFileSync(migration, 'utf8'))
  await scoped.query('insert into restaurant (slug, name) values ($1, $2)', [SLUG, 'The Blue Door'])
  await scoped.query(
    `insert into restaurant_table (restaurant_id, code, label)
     select id, $2, $3 from restaurant where slug = $1`,
    [SLUG, CODE, LABEL],
  )
  for (const item of ITEMS) {
    await scoped.query(
      `insert into menu_item (restaurant_id, name, price_minor, currency, sort_order)
       select id, $2, $3, $4, $5 from restaurant where slug = $1`,
      [SLUG, item.name, item.priceMinor, item.currency, item.sortOrder],
    )
  }
  await scoped.end()

  // The API is spawned rather than imported: `apps/guest` does not depend on
  // `services/api`, and a test is not a reason to open that boundary. The
  // search_path travels in the connection string, so the child needs no
  // knowledge of the throwaway schema beyond the URL it is given.
  const url = new URL(CONNECTION_STRING)
  url.username = APP_ROLE
  url.password = APP_PASSWORD
  url.searchParams.set('options', `-c search_path=${SCHEMA}`)
  api = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', API_ENTRY], {
    env: { ...process.env, DATABASE_URL: url.href, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const target = await apiOrigin(api)

  await build({ root: GUEST, logLevel: 'warn' })
  // The proxy rule lives here rather than in vite.config.ts on purpose. If this
  // override were ever ignored, the page would get the preview server's index
  // fallback instead of a menu and this suite would fail; a default in the
  // config file would instead let it pass against whatever is on port 3000.
  server = await preview({
    root: GUEST,
    logLevel: 'warn',
    preview: {
      port: 0,
      strictPort: false,
      proxy: { '/restaurants': target, '/tables': target },
    },
  })
  const resolved = server.resolvedUrls?.local[0]
  if (resolved === undefined) throw new Error('the preview server reported no local URL')
  origin = new URL(resolved).origin

  browser = await chromium.launch()
  // A fixed locale, because the prices below are formatted by the page through
  // Intl and an assertion on formatted money is otherwise a bet on whatever
  // locale the machine running the tests happens to have.
  context = await browser.newContext({ locale: LOCALE })
  // Below vitest's own timeout, so that an element that never arrives is
  // reported as the assertion it belongs to rather than as a dead suite.
  context.setDefaultTimeout(10_000)
  page = await context.newPage()
  page.on('request', (request) => requested.push(request.url()))

  await page.goto(`${origin}/r/${SLUG}`, { waitUntil: 'networkidle' })
})

afterAll(async () => {
  await context?.close()
  await browser?.close()
  await server?.close()
  api?.kill()
  await admin?.query(`drop schema if exists ${SCHEMA} cascade`)
  await admin?.end()
})

describe('the page a guest opens', () => {
  it("shows the restaurant and the items it is serving, in the restaurant's order", async () => {
    await page.locator('main:not([data-state="loading"])').waitFor()

    // Read what is there rather than waiting for what should be. `getAttribute`
    // and `allTextContents` do not block on a match, so a page showing the
    // wrong thing fails as a difference between two values instead of as a
    // timeout that says only that something never turned up.
    expect(await page.locator('main').getAttribute('data-state')).toBe('ready')
    expect(await page.locator('h1').allTextContents()).toEqual(['The Blue Door'])
    expect(await page.locator('li .name').allTextContents()).toEqual([
      `Flat white ${SCHEMA}`,
      `Cinnamon bun ${SCHEMA}`,
      `Miso soup ${SCHEMA}`,
    ])
    expect(await page.locator('li .price').allTextContents()).toEqual([
      money(300, 'GBP'),
      money(450, 'GBP'),
      money(600, 'JPY'),
    ])
  })

  it('loads nothing from an origin other than its own', () => {
    // Two assertions, because either one alone passes for the wrong reason. A
    // collector that recorded nothing has an empty list of foreign origins, and
    // a page that never asked the API would satisfy the first assertion while
    // showing a menu it made up.
    expect(requested).toContain(`${origin}/restaurants/${SLUG}/menu`)
    expect(requested.filter((url) => !url.startsWith(`${origin}/`))).toEqual([])
  })

  it('says so, rather than showing nothing, when no restaurant is served at the slug', async () => {
    const other = await context.newPage()
    await other.goto(`${origin}/r/no-such-place`, { waitUntil: 'networkidle' })

    const main = other.locator('main:not([data-state="loading"])')
    await main.waitFor()
    expect(await main.getAttribute('data-state')).toBe('unknown')
    expect(await main.textContent()).toContain('ask a member of staff')
    await other.close()
  })
})

describe('the page a guest opens from the code on their table', () => {
  it('names the table as well as the restaurant, and serves that table its menu', async () => {
    const table = await context.newPage()
    await table.goto(`${origin}/t/${CODE}`, { waitUntil: 'networkidle' })
    await table.locator('main:not([data-state="loading"])').waitFor()

    expect(await table.locator('main').getAttribute('data-state')).toBe('ready')
    expect(await table.locator('h1').allTextContents()).toEqual(['The Blue Door'])
    expect(await table.locator('.table').allTextContents()).toEqual([LABEL])
    expect(await table.locator('li .name').allTextContents()).toEqual([
      `Flat white ${SCHEMA}`,
      `Cinnamon bun ${SCHEMA}`,
      `Miso soup ${SCHEMA}`,
    ])
    await table.close()
  })

  // The two states below are the same state to the server -- neither is a menu
  // -- and different states to the guest. Retrying fixes neither, so both send
  // the guest to a person rather than to the reload button.
  it('sends the guest to staff when no table is served at the code', async () => {
    const other = await context.newPage()
    await other.goto(`${origin}/t/000000000000`, { waitUntil: 'networkidle' })

    const main = other.locator('main:not([data-state="loading"])')
    await main.waitFor()
    expect(await main.getAttribute('data-state')).toBe('unknown')
    expect(await main.textContent()).toContain('ask a member of staff')
    await other.close()
  })

  it('sends the guest to staff when the code is not one the address can hold', async () => {
    const other = await context.newPage()
    await other.goto(`${origin}/t/NOT-A-CODE`, { waitUntil: 'networkidle' })

    const main = other.locator('main:not([data-state="loading"])')
    await main.waitFor()
    expect(await main.getAttribute('data-state')).toBe('unknown')
    expect(await main.textContent()).toContain('ask a member of staff')
    await other.close()
  })

  // Last in this file on purpose, because it stops the API every condition
  // above needs. It is stopped through the handle this suite started it with,
  // so nothing here depends on a container runtime or on a process anyone else
  // is running.
  it('tells the guest to try again, rather than to find staff, when the menu cannot be reached', async () => {
    api.kill()
    await once(api, 'exit')

    const other = await context.newPage()
    await other.goto(`${origin}/t/${CODE}`, { waitUntil: 'networkidle' })

    const main = other.locator('main:not([data-state="loading"])')
    await main.waitFor()
    expect(await main.getAttribute('data-state')).toBe('unreachable')
    expect(await main.textContent()).toContain('try again')
    await other.close()
  })
})
