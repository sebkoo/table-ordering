/**
 * The demo: a producer in the tree, a product for a release.
 *
 * ADR 0032 put three stills of the pages in the README and said what they cannot
 * do -- "the loop is the product, and three stills only imply the motion between
 * them". This is the motion. What lands here is the script; what it emits is a
 * webm that is attached to a release and never committed, so the tree carries the
 * producer and none of the product's bytes.
 *
 * The take is planned before it is driven. The viewport, the destination, the
 * budgets and the order of the acts are values, which is what gives a suite
 * something to read: ADR 0032 rejected a capture script here because what it
 * emitted was pixels nothing asserts on, and the answer to that is not to assert
 * on pixels but to make the plan the thing that breaks.
 *
 * One take, one context, one viewport. Not a choice: the ffmpeg Playwright ships
 * is built `--disable-everything` with `libvpx` and `png` for encoders and
 * `image2`/`webm` for muxers, and carries no concat demuxer, no concat filter and
 * no stacking filter. Two clips cannot be joined and two pages cannot be placed
 * side by side without tooling this repository does not have. The viewport cannot
 * move mid-take either, because the recorder runs `pad=W:H:0:0:gray,crop=W:H:0:0`
 * against the size fixed when it started, so a smaller frame gains gray and a
 * larger one loses its edges.
 */

import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The screen viewport ADR 0032 already pins for the board, reused rather than
 * invented. Both pages are `max-width` columns centred in whatever they are given
 * -- 32rem for the guest, 40rem for the board -- and neither carries a media
 * query, so one viewport renders both as they render anywhere.
 */
export const VIEWPORT = { width: 900, height: 620 }

/**
 * The same numbers, written again rather than aliased. `VIDEO_SIZE = VIEWPORT`
 * would make the condition that compares them a comparison of a value with
 * itself, which cannot fail and would leave the letterbox unguarded.
 */
export const VIDEO_SIZE = { width: 900, height: 620 }

/** What a take may cost. The measured duration of a real run is what settles it. */
export const DURATION_BUDGET_MS = 45_000

/** At the recorder's `-b:v 1M`, 45s cannot exceed this. A near-static page is far under. */
export const SIZE_BUDGET_BYTES = 6_000_000

/** Below this an act is a frame or two at 25fps, which is a flicker rather than a step. */
export const SETTLE_FLOOR_MS = 1_000

export type Step =
  | {
      readonly act: 'open'
      readonly page: 'guest' | 'staff'
      readonly path: string
      readonly settleMs: number
    }
  | {
      readonly act: 'fill'
      readonly label: string
      readonly value: string
      readonly settleMs: number
    }
  | { readonly act: 'secret'; readonly label: string; readonly settleMs: number }
  | { readonly act: 'click'; readonly selector: string; readonly settleMs: number }

/**
 * The loop, once, with no narration and no tour. A guest orders from the code on
 * their table; a member of staff signs in and the round is on the board; the round
 * is recorded paid and the ticket is cleared.
 *
 * Paid before served, as the run steps have it, because the two acts are the ones
 * a reader most often runs together: recording a payment leaves the ticket where
 * it is, and clearing it is what takes it off the board.
 *
 * The board orders by `placed_at`, so the round the guest has just sent is the last
 * row -- which is the one the last two acts reach, closing the loop the take opened.
 */
export const STEPS: readonly Step[] = [
  { act: 'open', page: 'guest', path: '/t/:code', settleMs: 3_500 },
  { act: 'fill', label: 'How many Flat white', value: '2', settleMs: 1_800 },
  { act: 'click', selector: 'button.send', settleMs: 3_500 },
  { act: 'open', page: 'staff', path: '/', settleMs: 3_000 },
  { act: 'fill', label: 'Email', value: ':email', settleMs: 1_500 },
  { act: 'secret', label: 'Password', settleMs: 1_500 },
  { act: 'click', selector: 'button.sign-in', settleMs: 3_500 },
  { act: 'click', selector: 'section[data-board] li:last-child button.paid', settleMs: 4_500 },
  { act: 'click', selector: 'section[data-board] li:last-child button.served', settleMs: 4_500 },
]

/**
 * Where the take is written: outside the working tree, always. The whole design
 * rests on the product never entering the repository, and a destination is the
 * one place that can be decided once rather than remembered every run.
 */
export function outputPath(): string {
  return join(tmpdir(), 'table-ordering-demo.webm')
}

export interface Stage {
  readonly guestOrigin: string
  readonly staffOrigin: string
  readonly code: string
  readonly email: string
  readonly password: string
}

/** What the run read while it was recording, for the report that follows it. */
export interface Take {
  readonly path: string
  readonly bytes: number
  readonly passwordFieldType: string | null
  readonly passwordInDocument: boolean
}

function fill(text: string, stage: Stage): string {
  return text.replace(':code', stage.code).replace(':email', stage.email)
}

/**
 * Drive the plan and record it.
 *
 * `playwright` is a dependency of `apps/guest` and `apps/staff` and not of the
 * root, so it is resolved through the workspace that owns it -- the same reason
 * `tools/verify.ts` runs its browser probe with `apps/guest` as the working
 * directory. The specifier is computed rather than literal, which is also what
 * keeps the plan above typechecking at a root where the package does not resolve.
 */
export async function record(stage: Stage): Promise<Take> {
  const entry = join(ROOT, 'apps', 'guest', 'node_modules', 'playwright', 'index.js')
  const { chromium } = (await import(pathToFileURL(entry).href)).default

  const browser = await chromium.launch()
  // The three ADR 0032 pins that decide what the pixels look like, all explicit:
  // both pages declare `color-scheme: light dark`, and the `£` follows the locale.
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-GB',
  })
  context.setDefaultTimeout(15_000)
  const page = await context.newPage()

  let passwordFieldType: string | null = null
  let passwordInDocument = true

  await page.screencast.start({ path: outputPath(), size: VIDEO_SIZE })
  try {
    for (const step of STEPS) {
      switch (step.act) {
        case 'open': {
          const origin = step.page === 'guest' ? stage.guestOrigin : stage.staffOrigin
          await page.goto(`${origin}${fill(step.path, stage)}`)
          break
        }
        case 'fill':
          await page.getByLabel(step.label).fill(fill(step.value, stage))
          break
        case 'secret': {
          // The one secret that enters the frame. What keeps it out of the pixels
          // is the browser's own masking, so the type is read before anything is
          // typed rather than assumed from the markup: a field that lost its type
          // would record a legible password at twenty-five frames a second.
          //
          // The document is read afterwards and the answer is expected to be yes.
          // The field is controlled, so React keeps the typed value on the node,
          // and a password a person is typing is in the page by definition -- it
          // is not the secret the page was handed, which is the token, and which
          // `staff.browser.test.ts` already holds. It is reported because what a
          // reader wants to know is which of the two this is.
          const field = page.getByLabel(step.label)
          passwordFieldType = await field.getAttribute('type')
          if (passwordFieldType !== 'password') {
            throw new Error(`${step.label} is type ${passwordFieldType}, not password`)
          }
          await field.fill(stage.password)
          passwordInDocument = (await page.content()).includes(stage.password)
          break
        }
        case 'click':
          await page.locator(step.selector).click()
          break
      }
      await page.waitForTimeout(step.settleMs)
    }
  } finally {
    await page.screencast.stop()
    await context.close()
    await browser.close()
  }

  // The size budget, read rather than remembered. A take that overruns it is not
  // returned: an artifact nobody measured is how a budget written into a record
  // stops being true without anyone noticing.
  const bytes = statSync(outputPath()).size
  if (bytes > SIZE_BUDGET_BYTES) {
    throw new Error(`the take is ${bytes} bytes, over the ${SIZE_BUDGET_BYTES} budget`)
  }

  return { path: outputPath(), bytes, passwordFieldType, passwordInDocument }
}

/**
 * Read the stage from the environment, and the password from standard input.
 *
 * The password arrives on stdin rather than in an argument or a variable for the
 * reason the mint prints it on stderr: an argument is in the process list and in
 * the shell's history, and this is the one value in the stage that is a secret.
 */
async function main(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const password = Buffer.concat(chunks).toString('utf8').trim()
  if (password === '') throw new Error('no password on stdin')

  const take = await record({
    guestOrigin: process.env.GUEST_ORIGIN ?? 'http://localhost:5173',
    staffOrigin: process.env.STAFF_ORIGIN ?? 'http://localhost:5174',
    code: process.env.TABLE_CODE ?? '',
    email: process.env.STAFF_EMAIL ?? '',
    password,
  })

  process.stdout.write(`${JSON.stringify(take)}\n`)
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  await main()
}
