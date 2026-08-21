/**
 * The conditions on what `pnpm verify` reports when a dependency is absent.
 *
 * The first one is not about skipping. A skip mechanism that always reported
 * the environment unreachable would turn the whole suite into a no-op that
 * exits 0, and every check downstream would agree with it. So the probes are
 * driven against a socket this file opens and then closes, and against a
 * directory where `playwright` does not resolve: a probe stuck on "absent"
 * fails here, as a difference between two values.
 *
 * Nothing below needs PostgreSQL or a browser, which is what lets it live in
 * the one project that never skips. The direction these cannot reach -- a real
 * browser being detected as present -- is covered by CI, which demands the
 * environment it provisions.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projects } from '../../vitest.config.ts'
import { verdictLines } from '../check-push.ts'
import {
  exitCode,
  type FileReport,
  type FileTiming,
  formatFileLines,
  formatStepLine,
  type Options,
  type Presence,
  parseArgs,
  probeBrowser,
  probeTcp,
  readFileReport,
  reportArgs,
  type Step,
  type StepReport,
  seconds,
  skipReport,
  steps,
  testStepReport,
} from '../verify.ts'

const RELAXED: Options = { requireHistory: false, requireEnvironment: false }

/** A connection string whose port nothing can be listening on. */
const CLOSED = 'postgres://table_ordering:pw@127.0.0.1:1/table_ordering'

function listening(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function portOf(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the server has no tcp port')
  return address.port
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

/** The step's probe, or a failure -- a step that lost its probe cannot skip honestly. */
function probeOf(step: Step): () => Promise<Presence> {
  if (step.probe === undefined) throw new Error(`${step.name} carries no probe`)
  return step.probe
}

function stepNamed(name: string, options: Options, env: NodeJS.ProcessEnv): Step {
  const found = steps(options, env).find((step) => step.name === name)
  if (found === undefined) throw new Error(`no step named ${name}`)
  return found
}

// ---------------------------------------------------------------------------

describe('the database probe', () => {
  it('reports present for a socket that is accepting connections', async () => {
    const server = await listening()
    try {
      expect(await probeTcp('127.0.0.1', portOf(server), 2_000)).toEqual({ present: true })
    } finally {
      await close(server)
    }
  })

  it('reports absent, naming the address, once that same socket is closed', async () => {
    const server = await listening()
    const port = portOf(server)
    await close(server)

    expect(await probeTcp('127.0.0.1', port, 2_000)).toEqual({
      present: false,
      reason: `nothing is listening at 127.0.0.1:${port}`,
    })
  })
})

describe('the browser probe', () => {
  it('reports absent, naming the install command, where playwright does not resolve', () => {
    const directory = mkdtempSync(join(tmpdir(), 'table-ordering-verify-'))
    try {
      const presence = probeBrowser(directory)

      expect(presence.present).toBe(false)
      if (!presence.present) {
        expect(presence.reason).toContain('playwright install chromium')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------

describe('the step table', () => {
  // The guard against a split that quietly stops running something: a project
  // claimed by no step would run in `pnpm test` and in no verify step, and the
  // run would report PASS for suites nobody executed.
  it('runs every vitest project, each in exactly one step, in the order they are declared', () => {
    const claimed = steps(RELAXED, {}).flatMap((step) =>
      step.project === undefined ? [] : [step.project],
    )

    expect(claimed).toEqual(projects.map((project) => project.test.name))
  })

  it('probes exactly the two steps that need something outside the repository', () => {
    const probed = steps(RELAXED, {}).filter((step) => step.probe !== undefined)

    expect(probed.map((step) => step.name)).toEqual(['test-api', 'test-guest'])
  })
})

describe('a step whose dependency is absent', () => {
  it('skips, naming the address, and the skip is not a failure', async () => {
    const step = stepNamed('test-api', RELAXED, { DATABASE_URL: CLOSED })
    const report = skipReport(step, await probeOf(step)(), false)

    expect(report).toEqual({
      name: 'test-api',
      verdict: 'SKIP',
      detail: 'nothing is listening at 127.0.0.1:1',
    })
    expect(exitCode(report === null ? [] : [report])).toBe(0)
  })

  it('fails, carrying the same reason, under --require-environment', async () => {
    const step = stepNamed('test-api', RELAXED, { DATABASE_URL: CLOSED })
    const report = skipReport(step, await probeOf(step)(), true)

    expect(report).toEqual({
      name: 'test-api',
      verdict: 'FAIL',
      detail: 'nothing is listening at 127.0.0.1:1',
    })
    expect(exitCode(report === null ? [] : [report])).toBe(1)
  })

  it('runs, rather than reporting anything, when the dependency is there', () => {
    const step = stepNamed('test-api', RELAXED, {})

    expect(skipReport(step, { present: true }, true)).toBeNull()
  })

  it('carries the reason onto the printed line, for every step that can skip', () => {
    for (const step of steps(RELAXED, {}).filter((s) => s.probe !== undefined)) {
      const report = skipReport(step, { present: false, reason: 'no dependency here' }, false)
      const line = formatStepLine(report ?? { name: '?', verdict: 'SKIP', detail: '' }, 15)

      expect(report?.verdict).toBe('SKIP')
      expect(line.replace(/^.*SKIP\s+/, '').trim()).toBe('no dependency here')
    }
  })
})

describe('the exit code', () => {
  const skipped: StepReport = { name: 'test-api', verdict: 'SKIP', detail: 'nothing is listening' }
  const passed: StepReport = { name: 'lint', verdict: 'PASS', detail: '0.2s' }
  const failed: StepReport = { name: 'test-guest', verdict: 'FAIL', detail: '3.1s' }

  it('is 0 when a step skipped and none failed', () => {
    expect(exitCode([passed, skipped])).toBe(0)
  })

  it('is 1 as soon as one step failed', () => {
    expect(exitCode([passed, skipped, failed])).toBe(1)
  })
})

describe('the arguments', () => {
  it('reads both flags, and neither by default', () => {
    expect(parseArgs([])).toEqual({ requireHistory: false, requireEnvironment: false })
    expect(parseArgs(['--require-history', '--require-environment'])).toEqual({
      requireHistory: true,
      requireEnvironment: true,
    })
  })

  // Silently ignoring one would let a typo in ci.yml stop demanding the
  // environment that same workflow provisions, with nothing to see.
  it('rejects an argument it does not recognise, rather than ignoring it', () => {
    expect(parseArgs(['--require-enviroment'])).toEqual({
      error: 'unrecognised argument: --require-enviroment',
    })
  })
})

// ---------------------------------------------------------------------------

/**
 * A verbatim capture of `vitest run --project=guest --reporter=junit
 * --outputFile.junit=...`, which is what every test step now asks for. Produced,
 * never composed: it was captured twice and the two diffed, and only the figures
 * and the timestamps moved.
 *
 * Three of its properties are load-bearing and none of them was arranged.
 *
 * **The suites arrive in the order they finished, which on this run was not path
 * order**: `order.browser.test.ts` is first. That is what makes the ordering
 * asserted below able to fail, over data the collector really produced rather
 * than over a pair invented to make the point. The condition after it guards
 * exactly that, so a later recapture that happened to finish in path order says
 * so instead of quietly leaving the ordering asserted by nothing.
 *
 * **`<testsuites>` wraps them**, carrying a `name` and a `time` of its own. A
 * pattern one character looser reads it as a third file called `vitest tests`.
 *
 * **The last testcase carries a `<system-err>` block of arbitrary text**, because
 * the condition it belongs to takes the API away and vite logs the refusal. A
 * reader has to step over it.
 *
 * What is read here is `name`, `time` and the suite structure. The timestamps,
 * the hostname, the per-test figures and that error block are stepped over. They
 * are this run's own values and they stay because a capture is produced and not
 * composed -- marked here so that tidying them away later reads as what it would
 * be. The hostname is `m-gvgjdpxxq6`, which is opaque and names no one; a capture
 * from a differently named machine is judged on its own value rather than waved
 * through on this one.
 *
 * None of this touches the rule that a check's inputs are the tree and the
 * history. That rule is about what a verdict may be computed from -- a value only
 * the machine can answer for is not an input, because a verdict taken from one is
 * a fact about whoever ran the check. A fixture that merely *contains* such a
 * value is a different thing: nothing below reads `hostname`, exactly as nothing
 * reads the timestamps.
 */
const GUEST_REPORT = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="14" failures="0" errors="0" time="18.836827458">
    <testsuite name="apps/guest/src/features/order/order.browser.test.ts" timestamp="2026-08-21T20:13:49.143Z" hostname="m-gvgjdpxxq6" tests="7" failures="0" errors="0" skipped="0" time="10.141906125">
        <testcase classname="apps/guest/src/features/order/order.browser.test.ts" name="the order a guest sends from their table &gt; sends what the guest chose, and the kitchen has it" time="1.000034708">
        </testcase>
        <testcase classname="apps/guest/src/features/order/order.browser.test.ts" name="the order a guest sends from their table &gt; makes a second round a second order" time="0.708412333">
        </testcase>
        <testcase classname="apps/guest/src/features/order/order.browser.test.ts" name="the order a guest sends from their table &gt; says a send did not go, writes nothing, and lands once when it is sent again" time="0.748312333">
        </testcase>
        <testcase classname="apps/guest/src/features/order/order.browser.test.ts" name="the order a guest sends from their table &gt; makes one order of a send whose answer was lost and a retry after a reload" time="1.261078667">
        </testcase>
        <testcase classname="apps/guest/src/features/order/order.browser.test.ts" name="the order a guest sends from their table &gt; offers no way to order on a page with no table" time="0.618421583">
        </testcase>
        <testcase classname="apps/guest/src/features/order/order.browser.test.ts" name="the order a guest sends from their table &gt; refuses an order for an item taken off the menu, and stays orderable" time="0.78076675">
        </testcase>
        <testcase classname="apps/guest/src/features/order/order.browser.test.ts" name="the order a guest sends from their table &gt; sends with randomUUID absent, as a page served over plain http would find it" time="0.673728">
        </testcase>
    </testsuite>
    <testsuite name="apps/guest/src/features/menu/menu.browser.test.ts" timestamp="2026-08-21T20:13:49.146Z" hostname="m-gvgjdpxxq6" tests="7" failures="0" errors="0" skipped="0" time="8.694921333">
        <testcase classname="apps/guest/src/features/menu/menu.browser.test.ts" name="the page a guest opens &gt; shows the restaurant and the items it is serving, in the restaurant&apos;s order" time="0.061597958">
        </testcase>
        <testcase classname="apps/guest/src/features/menu/menu.browser.test.ts" name="the page a guest opens &gt; loads nothing from an origin other than its own" time="0.000692875">
        </testcase>
        <testcase classname="apps/guest/src/features/menu/menu.browser.test.ts" name="the page a guest opens &gt; says so, rather than showing nothing, when no restaurant is served at the slug" time="0.70783775">
        </testcase>
        <testcase classname="apps/guest/src/features/menu/menu.browser.test.ts" name="the page a guest opens from the code on their table &gt; names the table as well as the restaurant, and serves that table its menu" time="0.686756667">
        </testcase>
        <testcase classname="apps/guest/src/features/menu/menu.browser.test.ts" name="the page a guest opens from the code on their table &gt; sends the guest to staff when no table is served at the code" time="0.70362">
        </testcase>
        <testcase classname="apps/guest/src/features/menu/menu.browser.test.ts" name="the page a guest opens from the code on their table &gt; sends the guest to staff when the code is not one the address can hold" time="0.6791555">
        </testcase>
        <testcase classname="apps/guest/src/features/menu/menu.browser.test.ts" name="the page a guest opens from the code on their table &gt; tells the guest to try again, rather than to find staff, when the menu cannot be reached" time="0.625523292">
            <system-err>
4:13:47 PM [vite] http proxy error: /tables/t54759f2m9k4x1/menu
Error: connect ECONNREFUSED 127.0.0.1:59514
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16)

4:13:47 PM [vite] http proxy error: /tables/t54759f2m9k4x1/menu
Error: connect ECONNREFUSED 127.0.0.1:59514
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16)

            </system-err>
        </testcase>
    </testsuite>
</testsuites>
`

/**
 * What that capture says, in path order and in whole milliseconds. `10142` and
 * `8695` are `10.141906125` and `8.694921333` seconds, which is what the file
 * carries; nothing prints beyond a tenth of a second, so the reading rounds.
 */
const GUEST_FILES: FileTiming[] = [
  { path: 'apps/guest/src/features/menu/menu.browser.test.ts', elapsedMs: 8695 },
  { path: 'apps/guest/src/features/order/order.browser.test.ts', elapsedMs: 10142 },
]

/**
 * A run that reported no test file at all, captured from
 * `vitest run --project=api --passWithNoTests no-such-file`. Real, rather than
 * an empty string, because the state this guards against is a report that
 * arrived and named nothing -- not a report that failed to arrive.
 */
const NO_FILES = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="0" failures="0" errors="0" time="0">
</testsuites>
`

/** Where a step's report is written, for the conditions that read the arguments. */
const REPORT_PATH = '/tmp/report.xml'
const REPORT_ARGS = ['--reporter=default', '--reporter=junit', `--outputFile.junit=${REPORT_PATH}`]

/** The files, or the reason there are none -- so a condition compares one value. */
function reported(xml: string): FileTiming[] | string {
  const report = readFileReport(xml)
  return report.read ? report.files : report.reason
}

describe('the per-file report a test step reads', () => {
  it('reads every test file, with the duration of the module rather than of its tests', () => {
    expect(reported(GUEST_REPORT)).toEqual(GUEST_FILES)
  })

  // The root element carries a name and a time of its own, so a pattern that
  // admitted `<testsuites` would report a third file that no clock ever ran.
  it('does not read the testsuites root as a file of its own', () => {
    expect(GUEST_REPORT).toContain('<testsuites name="vitest tests"')
    expect(reported(GUEST_REPORT)).toHaveLength(2)
  })

  // Not decoration. vitest emits a suite when it finishes, and this capture
  // finished out of path order -- which is the whole reason the condition above
  // can fail. Recapture in path order and the ordering there stops being
  // asserted by anything, so this says when that has happened.
  it('is read from a capture whose suites arrive out of path order', () => {
    expect(GUEST_REPORT.indexOf('order.browser.test.ts')).toBeLessThan(
      GUEST_REPORT.indexOf('menu.browser.test.ts'),
    )
  })

  // A report that named nothing is a report that established nothing. Printing
  // no lines and calling the step green is the failure this refuses.
  it('fails a report that named no test file, rather than printing nothing', () => {
    expect(reported(NO_FILES)).toBe('the run reported no test file')
  })

  // What a reporter that stopped filling the attribute would emit. Constructed,
  // because the collector cannot be asked to leave it empty, and shaped from the
  // capture above so that only the one attribute differs.
  it('fails a time that is not a number, naming the file it belongs to', () => {
    const blank = GUEST_REPORT.replace('time="8.694921333"', 'time=""')

    expect(reported(blank)).toBe(
      'apps/guest/src/features/menu/menu.browser.test.ts carries a time that is not a number: ',
    )
  })
})

describe('what a test step reports', () => {
  const read: FileReport = { read: true, files: GUEST_FILES }
  const unread: FileReport = { read: false, reason: 'the run reported no test file' }

  // A suite that passed while its report did not arrive has not been reported
  // on. This is the one way this change can redden a run over something other
  // than the code, and it is deliberate: an instrument that stops working
  // quietly is worse than one that fails loudly.
  it('fails a step whose report could not be read, though the suite exited 0', () => {
    expect(testStepReport('test-tools', 0, 2400, unread)).toEqual({
      name: 'test-tools',
      verdict: 'FAIL',
      detail: '2.4s, the run reported no test file',
    })
  })

  // The line CI already prints, unchanged. Anything appended here would change
  // what every green log has looked like, and `check-push` compares those logs.
  it('leaves a passing step carrying exactly the elapsed it always did', () => {
    expect(testStepReport('test-tools', 0, 2400, read)).toEqual({
      name: 'test-tools',
      verdict: 'PASS',
      detail: '2.4s',
    })
  })

  it('prints one line per file, indented under the step, aligned on the longest', () => {
    expect(formatFileLines(GUEST_FILES)).toEqual([
      '  apps/guest/src/features/menu/menu.browser.test.ts .... 8.7s',
      '  apps/guest/src/features/order/order.browser.test.ts .. 10.1s',
    ])
  })

  // The decision these lines rest on, made executable -- and it is two
  // properties rather than one, because they hold for different reasons.
  //
  // The first belongs to this file: the line carries no verdict word. The second
  // belongs to `check-push`, whose verdict pattern admits a name of lowercase
  // letters, digits and hyphens, and a path carries `/`, `.` and `_` past it.
  //
  // Only the first can be lost by editing the emitter. Asserting the second
  // alone leaves a condition that stays green whatever this file prints: adding
  // `PASS` to the line was run as a break, and the count stayed at zero because
  // the name defeated the pattern on its own. What guards the second property is
  // the condition in `check-push.test.ts` that counts the lines of a real run.
  it('emits no verdict word, so check-push counts none of these lines', () => {
    const lines = formatFileLines(GUEST_FILES)

    expect(lines.filter((line) => /\b(?:PASS|FAIL|SKIP)\b/.test(line))).toEqual([])
    expect(verdictLines(lines.join('\n'))).toEqual([])
  })

  // Only the steps that run a vitest project. Asking `tsc` for a junit report
  // would be an argument it rejects. Every step is named, so a change that
  // applied the flags everywhere and a change that applied them nowhere are both
  // differences here rather than one of them being a silent pass.
  it('asks for a per-file report from every vitest step and from no other', () => {
    const added = steps(RELAXED, {}).map((step) => [
      step.name,
      reportArgs(step, REPORT_PATH).slice(step.args.length),
    ])

    expect(added).toEqual([
      ['typecheck', []],
      ['typecheck-guest', []],
      ['lint', []],
      ['test-tools', REPORT_ARGS],
      ['test-api', REPORT_ARGS],
      ['test-guest', REPORT_ARGS],
      ['conventions', []],
    ])
  })
})

/**
 * Every elapsed figure a run prints goes through this: six step lines, the
 * per-file lines under three of them, and the summary. Until now nothing could
 * go red on it -- the details in this file were written by the test rather than
 * produced by it -- and the refactor from "a start" to "a duration" is what
 * creates the subject.
 */
describe('an elapsed figure', () => {
  // Two milliseconds apart, and the pair is chosen so that truncating at one
  // decimal tells them apart from rounding: rounded they differ, truncated they
  // do not.
  it('rounds to a tenth of a second rather than truncating', () => {
    expect(seconds(49)).toBe('0.0s')
    expect(seconds(51)).toBe('0.1s')
  })

  // Two integer digits, which is what a run prints today and what the log
  // parser is asserted against from the other side. No break tells this apart
  // on its own -- truncation leaves it alone and a shifted decimal moves the
  // two above with it -- so it is a guard, not evidence.
  it('reads milliseconds, at both widths a run prints', () => {
    expect(seconds(2400)).toBe('2.4s')
    expect(seconds(10700)).toBe('10.7s')
  })
})
