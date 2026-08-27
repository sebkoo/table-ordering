/**
 * The conditions on the demo's plan, read as values rather than as pixels.
 *
 * ADR 0032 rejected a capture script in this directory because what it emits is
 * pixels nothing asserts on, and a tool whose output no condition reads is a tool
 * whose breakage is invisible. What answers that here is that the take is planned
 * before it is driven: the viewport, the destination, the budgets and the order of
 * the acts are values, and these are the conditions on them. The pixels are still
 * read by no condition, and are still not what breaks.
 *
 * Two of these read the same field in opposite directions. The sum of the waits
 * fails when it is too large; a single wait fails when it is too small. A plan
 * cannot satisfy one by breaking the other, so neither stands in for the other and
 * no single edit reds both.
 *
 * The sum is a lower bound and not the budget. A take also spends time navigating,
 * loading and acting, so a plan that fits here can still overrun. What settles the
 * budget is the measured duration of a real run, which the record carries.
 */

import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DURATION_BUDGET_MS,
  outputPath,
  SETTLE_FLOOR_MS,
  STEPS,
  VIDEO_SIZE,
  VIEWPORT,
} from '../record-demo.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('the demo plan', () => {
  /**
   * The recorder pads a frame smaller than the video size with gray and crops one
   * larger, both anchored at the top left -- `pad=W:H:0:0:gray,crop=W:H:0:0` is the
   * filter it really runs. Equal sizes are what keep the picture the page.
   *
   * This condition is only load-bearing while `VIDEO_SIZE` is its own literal.
   * Written as an alias of `VIEWPORT` it would compare a value with itself and
   * could never fail, which is why the module declares the two separately.
   */
  it('records at the size it renders at', () => {
    expect(VIDEO_SIZE).toEqual(VIEWPORT)
  })

  /**
   * The whole design rests on this: the producer is in the tree and the product is
   * not. A destination inside the working tree would put a video byte in it on the
   * first run, and the invariant would be a promise rather than a check.
   */
  it('writes outside the repository root', () => {
    const path = outputPath()
    expect(isAbsolute(path)).toBe(true)
    expect({ path, escapesTheTree: relative(ROOT, path).startsWith('..') }).toEqual({
      path,
      escapesTheTree: true,
    })
  })

  it('plans waits that already fit the duration budget', () => {
    const planned = STEPS.reduce((total, step) => total + step.settleMs, 0)
    expect(planned).toBeLessThanOrEqual(DURATION_BUDGET_MS)
  })

  it('opens the guest page at its printed code, then the board', () => {
    const opened = STEPS.filter((step) => step.act === 'open').map(
      (step) => `${step.page} ${step.path}`,
    )
    expect(opened).toEqual(['guest /t/:code', 'staff /'])
  })

  it('settles long enough on every act to be read', () => {
    const tooBrief = STEPS.map((step, index) => ({ index, settleMs: step.settleMs })).filter(
      (step) => step.settleMs < SETTLE_FLOOR_MS,
    )
    expect(tooBrief).toEqual([])
  })
})
