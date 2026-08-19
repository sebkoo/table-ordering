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
import {
  exitCode,
  formatStepLine,
  type Options,
  type Presence,
  parseArgs,
  probeBrowser,
  probeTcp,
  type Step,
  type StepReport,
  skipReport,
  steps,
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
