/**
 * One command that runs every repository check.
 *
 * Each step reports its own result rather than folding into a single verdict,
 * so a run that skipped a check is distinguishable from a run that passed it.
 * The convention checks print their own per-rule lines; this file streams them
 * through untouched instead of summarising them a second time.
 *
 * Two of the steps need something this repository does not contain: a
 * PostgreSQL to talk to, and a browser to load a page in. Neither absence is a
 * statement about the code, so each is probed for before its step runs and
 * reported as a SKIP that names what is missing. `--require-environment` turns
 * those skips into failures, which is what CI passes, because CI provisions
 * both and a skip there would mean the provisioning silently stopped working.
 *
 * The probes are explicit reachability checks, never a `try`/`catch` around the
 * step itself. A catch cannot tell a database that is absent from a query that
 * is wrong, and reporting the second as the first is the failure this file
 * exists to remove.
 *
 * Usage: node tools/verify.ts [--require-history] [--require-environment]
 */

import { spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Verdict = 'PASS' | 'FAIL' | 'SKIP'

/** What a probe found. An absence always carries the reason it will be printed with. */
export type Presence = { present: true } | { present: false; reason: string }

export type StepReport = {
  name: string
  verdict: Verdict
  /** The elapsed time for a step that ran, or the reason for one that did not. */
  detail: string
}

export type Step = {
  name: string
  command: string
  args: string[]
  /** Show the child's output even when it succeeds. */
  stream: boolean
  /** The vitest project this step runs, for the steps that run one. */
  project?: string
  /** Asked before the step runs. Absent means the step cannot report on the code. */
  probe?: () => Promise<Presence>
}

export type Options = {
  requireHistory: boolean
  requireEnvironment: boolean
}

/**
 * The host and port `compose.yaml` publishes, which is also what the API's
 * default connection string carries. Only the address is duplicated here: a
 * reachability probe has no use for the credentials, so this is not a third
 * copy of the connection string.
 */
const DEFAULT_DATABASE_HOST = '127.0.0.1'
const DEFAULT_DATABASE_PORT = 55432

/** Long enough for a container that is up, short enough that an empty machine is not a wait. */
const PROBE_TIMEOUT_MS = 2_000

/**
 * Launch the browser rather than look for its file. `executablePath()` answers
 * where playwright would keep a browser, and the suite's first act is to start
 * one, not to stat one.
 *
 * It runs with `apps/guest` as its working directory because that is the
 * workspace `playwright` is a dependency of; for `--eval`, node resolves bare
 * specifiers from the working directory.
 */
const BROWSER_PROBE =
  "const { chromium } = await import('playwright')\nawait (await chromium.launch()).close()\n"

const BROWSER_ABSENT =
  'chromium could not launch; run `pnpm --filter @table-ordering/guest exec playwright install chromium`'

function localBin(name: string): string {
  return join(root, 'node_modules', '.bin', name)
}

export function parseArgs(argv: readonly string[]): Options | { error: string } {
  const options: Options = { requireHistory: false, requireEnvironment: false }

  for (const arg of argv) {
    if (arg === '--require-history') options.requireHistory = true
    else if (arg === '--require-environment') options.requireEnvironment = true
    // Ignoring an argument silently would let a typo in ci.yml stop demanding
    // the environment that same workflow provisions, with nothing to see.
    else return { error: `unrecognised argument: ${arg}` }
  }

  return options
}

function databaseAddress(env: NodeJS.ProcessEnv): { host: string; port: number } {
  const configured = env.DATABASE_URL
  if (configured === undefined) return { host: DEFAULT_DATABASE_HOST, port: DEFAULT_DATABASE_PORT }

  const url = new URL(configured)
  return {
    host: url.hostname === '' ? DEFAULT_DATABASE_HOST : url.hostname,
    port: url.port === '' ? DEFAULT_DATABASE_PORT : Number(url.port),
  }
}

export function probeTcp(host: string, port: number, timeoutMs: number): Promise<Presence> {
  return new Promise((settle) => {
    const socket = createConnection({ host, port })

    const finish = (presence: Presence): void => {
      socket.destroy()
      settle(presence)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ present: true }))
    socket.once('timeout', () =>
      finish({
        present: false,
        reason: `nothing answered at ${host}:${port} within ${timeoutMs}ms`,
      }),
    )
    socket.once('error', () =>
      finish({ present: false, reason: `nothing is listening at ${host}:${port}` }),
    )
  })
}

export function probeBrowser(cwd: string): Presence {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', BROWSER_PROBE], {
    cwd,
    stdio: 'ignore',
  })

  return result.status === 0 ? { present: true } : { present: false, reason: BROWSER_ABSENT }
}

export function steps(options: Options, env: NodeJS.ProcessEnv): Step[] {
  const { host, port } = databaseAddress(env)
  const database = (): Promise<Presence> => probeTcp(host, port, PROBE_TIMEOUT_MS)

  const vitest = (project: string): Pick<Step, 'command' | 'args' | 'stream' | 'project'> => ({
    command: localBin('vitest'),
    args: ['run', `--project=${project}`],
    stream: false,
    project,
  })

  return [
    {
      name: 'typecheck',
      command: localBin('tsc'),
      args: ['--noEmit', '-p', join(root, 'tsconfig.base.json')],
      stream: false,
    },
    // A second project rather than a wider first one. The guest client needs
    // the DOM library, and adding it to the shared configuration would hand
    // `document` and `window` to the API, where reaching for either is a
    // runtime error that nothing would catch.
    {
      name: 'typecheck-guest',
      command: localBin('tsc'),
      args: ['--noEmit', '-p', join(root, 'apps', 'guest', 'tsconfig.json')],
      stream: false,
    },
    { name: 'lint', command: localBin('biome'), args: ['check', '.'], stream: false },
    // One step per vitest project, rather than one for all of them. A single
    // step would take the tool suites down with the database: they need
    // nothing, and hiding a hundred passing checks behind one skipped word is
    // the same lie as reporting an absent database as a code failure.
    { name: 'test-tools', ...vitest('tools') },
    { name: 'test-api', ...vitest('api'), probe: database },
    {
      name: 'test-guest',
      ...vitest('guest'),
      // Both, and in this order: the guest suite seeds a schema before it opens
      // a browser, so a machine missing both should be told about the database
      // it will reach for first.
      probe: async (): Promise<Presence> => {
        const reachable = await database()
        return reachable.present ? probeBrowser(join(root, 'apps', 'guest')) : reachable
      },
    },
    {
      name: 'conventions',
      command: process.execPath,
      args: [
        '--disable-warning=ExperimentalWarning',
        join(root, 'tools', 'check-conventions.ts'),
        ...(options.requireHistory ? ['--require-history'] : []),
      ],
      stream: true,
    },
  ]
}

/**
 * What to report for a step whose probe has come back, or null when the step
 * should simply run. An absence is a SKIP, which is neither a pass nor a
 * failure, until a run says it was promised the environment.
 */
export function skipReport(
  step: Step,
  presence: Presence,
  requireEnvironment: boolean,
): StepReport | null {
  if (presence.present) return null
  return {
    name: step.name,
    verdict: requireEnvironment ? 'FAIL' : 'SKIP',
    detail: presence.reason,
  }
}

export function formatStepLine(report: StepReport, width: number): string {
  const dots = '.'.repeat(Math.max(1, width + 2 - report.name.length))
  return `${report.name} ${dots} ${report.verdict}  ${report.detail}`
}

export function exitCode(reports: readonly StepReport[]): number {
  return reports.some((report) => report.verdict === 'FAIL') ? 1 : 0
}

/**
 * The closing line. It names what was skipped, because a run that reports PASS
 * while two steps never executed is the failure this file was changed to
 * prevent, one level up from the step lines.
 */
function summaryLine(reports: readonly StepReport[], elapsed: string): string {
  const verdict = exitCode(reports) === 0 ? 'PASS' : 'FAIL'
  const skipped = reports.filter((report) => report.verdict === 'SKIP').map((report) => report.name)
  const note = skipped.length === 0 ? '' : `  (skipped: ${skipped.join(', ')})`
  return `verify: ${verdict}  ${elapsed}${note}`
}

function seconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
}

function indent(text: string): string {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

async function run(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const options = parseArgs(argv)
  if ('error' in options) {
    process.stdout.write(`verify: ${options.error}\n`)
    return 1
  }

  const startedAt = Date.now()
  const all = steps(options, env)
  const width = Math.max(...all.map((step) => step.name.length))
  const reports: StepReport[] = []

  for (const step of all) {
    if (step.probe !== undefined) {
      const early = skipReport(step, await step.probe(), options.requireEnvironment)
      if (early !== null) {
        reports.push(early)
        process.stdout.write(`${formatStepLine(early, width)}\n`)
        continue
      }
    }

    const stepStartedAt = Date.now()

    if (step.stream) {
      process.stdout.write(`${step.name}:\n`)
      const streamed = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit' })
      reports.push({
        name: step.name,
        verdict: streamed.status === 0 ? 'PASS' : 'FAIL',
        detail: seconds(stepStartedAt),
      })
      process.stdout.write('\n')
      continue
    }

    const result = spawnSync(step.command, step.args, { cwd: root, encoding: 'utf8' })
    const report: StepReport = {
      name: step.name,
      verdict: result.status === 0 ? 'PASS' : 'FAIL',
      detail: seconds(stepStartedAt),
    }
    reports.push(report)
    process.stdout.write(`${formatStepLine(report, width)}\n`)

    if (result.status !== 0) {
      process.stdout.write(`${indent(`${result.stdout ?? ''}${result.stderr ?? ''}`)}\n`)
    }
  }

  process.stdout.write(`${summaryLine(reports, seconds(startedAt))}\n`)
  return exitCode(reports)
}

// The guard is what lets the tests import this file. Without it, importing the
// module runs every check -- including a nested vitest, inside vitest.
const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  process.exit(await run(process.argv.slice(2), process.env))
}
