/**
 * One command that runs every repository check.
 *
 * Each step reports its own result rather than folding into a single verdict,
 * so a run that skipped a check is distinguishable from a run that passed it.
 * The convention checks print their own per-rule lines; this file streams them
 * through untouched instead of summarising them a second time.
 *
 * Three of the steps need something this repository does not contain: a
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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
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
    // A third configuration rather than a wider second one. Each app's tsconfig
    // includes its own `src`, so one config covering both would be a fourth
    // place that knows where the apps are, and a step named after neither.
    {
      name: 'typecheck-staff',
      command: localBin('tsc'),
      args: ['--noEmit', '-p', join(root, 'apps', 'staff', 'tsconfig.json')],
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
    // The browser is probed for in this workspace and not in the one above,
    // because that is where this step's suite resolves `playwright` from. The
    // two resolve to one version and therefore to one per-machine browser, so a
    // single install serves both -- and if that ever stopped being true, this
    // probe would say so on its own line rather than failing inside a suite.
    {
      name: 'test-staff',
      ...vitest('staff'),
      probe: async (): Promise<Presence> => {
        const reachable = await database()
        return reachable.present ? probeBrowser(join(root, 'apps', 'staff')) : reachable
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

// ---------------------------------------------------------------------------
// What a test step's run cost, file by file
// ---------------------------------------------------------------------------

/** One test file, and what its module took. */
export type FileTiming = { path: string; elapsedMs: number }

/** The files a step's run reported, or why they could not be read. */
export type FileReport = { read: true; files: FileTiming[] } | { read: false; reason: string }

/** The flags that ask vitest for a report of its own, beside the readable one. */
const REPORTERS = ['--reporter=default', '--reporter=junit']

/**
 * Every `<testsuite>` element, and the duration it declares.
 *
 * A pattern rather than an XML parser, which would be a dependency bought for
 * one reader, and the same posture `check-conventions.ts` takes towards the
 * YAML subset its workflow files are written in. What makes it acceptable is the
 * failure mode: a payload written in a shape this cannot read yields no files at
 * all, and a report naming no file is a failure below rather than a step that
 * quietly printed nothing.
 *
 * The space in `<testsuite name=` is load-bearing. The root element is
 * `<testsuites name="vitest tests" ... time="...">`, so a pattern that let the
 * `s` through would report a third file called `vitest tests` carrying the whole
 * run's duration.
 *
 * `[^>]*\stime="` reaches the last `time`-prefixed attribute rather than the
 * first, because `timestamp` sits in front of it and is not it.
 */
const TEST_SUITE = /<testsuite name="([^"]*)"[^>]*\stime="([^"]*)"/g

/**
 * What a step's run cost, file by file.
 *
 * The figure is the module's own, hooks and collection and import included,
 * which is what vitest puts in `<testsuite time=...>`. Its json reporter carries
 * a different quantity -- the file's first test to its last, with module load
 * left out, which on one real file here was 76% of the cost -- and an instrument
 * that reads a 0.350s module as 0.085s measures the wrong thing. ADR 0024.
 *
 * The paths arrive relative to the repository already. They are sorted because
 * vitest emits a suite when it finishes, and which of two suites finishes first
 * is a race: unsorted, a run would reorder its own report between runs and every
 * reading would look like a change.
 */
export function readFileReport(xml: string): FileReport {
  const files: FileTiming[] = []

  for (const match of xml.matchAll(TEST_SUITE)) {
    const path = match[1] ?? ''
    const declared = match[2] ?? ''
    // An attribute the reporter stopped filling arrives empty, and `Number('')`
    // is 0 -- a figure, and a plausible one, that nothing ever measured.
    const value = declared.trim() === '' ? Number.NaN : Number(declared)
    if (!Number.isFinite(value)) {
      return { read: false, reason: `${path} carries a time that is not a number: ${declared}` }
    }
    files.push({ path, elapsedMs: Math.round(value * 1000) })
  }

  // A report that named nothing is not a run with nothing in it. It is a reader
  // that has established nothing, and no step passes on one.
  if (files.length === 0) return { read: false, reason: 'the run reported no test file' }

  files.sort((left, right) => {
    if (left.path < right.path) return -1
    return left.path > right.path ? 1 : 0
  })
  return { read: true, files }
}

/**
 * The report vitest was asked to write, or why it is not there.
 *
 * The `catch` reports an absence as itself rather than standing in for a probe.
 * This is not a dependency being looked for: the file was written moments ago by
 * the child that just exited, and "it is not there" is the answer, carried onto
 * the step's own line.
 */
function readReportFile(path: string): FileReport {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    return { read: false, reason: `its per-file report could not be read: ${said}` }
  }
  return readFileReport(text)
}

/**
 * The lines that go under a step, one per file.
 *
 * Two spaces, the indent the convention rules already carry under
 * `conventions:`, and no verdict word. A duration is a measurement and not a
 * judgement: whether the file passed is already the step's verdict, and a `PASS`
 * here would put a timing inside the machinery that asserts, where the first
 * person wanting a budget would find the hook waiting. It is also what keeps
 * these lines out of `check-push`'s count, which they miss twice over -- by the
 * absent verdict, and by a name its pattern does not admit. ADR 0024.
 *
 * No total is printed. Files run in parallel and their durations overlap: five
 * of them summed to 28.6s inside a step that took 23.8s, and a sum would be a
 * figure no clock produced.
 */
export function formatFileLines(files: readonly FileTiming[]): string[] {
  const width = Math.max(0, ...files.map((file) => file.path.length))

  return files.map((file) => {
    const dots = '.'.repeat(Math.max(1, width + 2 - file.path.length))
    return `  ${file.path} ${dots} ${seconds(file.elapsedMs)}`
  })
}

/**
 * A step that ran a vitest project, judged on two things rather than one.
 *
 * A suite that exited 0 while its report did not arrive has not been reported
 * on, so it fails and the line says why. That is the one way this file can
 * redden a run over something other than the code under test, and it is the
 * deliberate half of the trade: an instrument that stops working quietly is
 * worse than one that fails loudly, and it is the same answer `check-push`
 * already gives a warning count it could not read.
 *
 * It is not a threshold in disguise. No duration is asserted against anything;
 * being unable to read the report at all is a failure of the instrument, not a
 * slow test.
 *
 * A step that passed carries exactly the elapsed it always did. Anything
 * appended there would change what every green log has looked like, and those
 * logs are what `check-push` reads.
 */
export function testStepReport(
  name: string,
  status: number | null,
  elapsedMs: number,
  report: FileReport,
): StepReport {
  const elapsed = seconds(elapsedMs)
  return {
    name,
    verdict: status === 0 && report.read ? 'PASS' : 'FAIL',
    detail: report.read ? elapsed : `${elapsed}, ${report.reason}`,
  }
}

/**
 * A step's arguments, with the report asked for when the step runs a project.
 *
 * The path is a run's own temporary file, so it is passed in rather than kept in
 * the step table: `steps` is a pure description that `check-push` also reads, and
 * a path that exists only while a run is happening does not belong in it.
 *
 * `--reporter=default` is named alongside, and naming it is what keeps a failing
 * step readable. Asked for the junit report alone, vitest prints where it wrote
 * the file and nothing else, and the output this file shows on a failure would
 * be that one line.
 */
export function reportArgs(step: Step, path: string): string[] {
  if (step.project === undefined) return step.args
  return [...step.args, ...REPORTERS, `--outputFile.junit=${path}`]
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

/**
 * Every figure a run prints goes through here: the step lines, the per-file
 * lines under three of them, and the summary. It takes the duration rather than
 * the start it used to, because the per-file figures are durations already --
 * vitest reports what a module took, not when it began.
 */
export function seconds(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`
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

  // One directory per run, outside the repository and removed whatever happens.
  // A report written into the tree would be a file `git status` has to explain.
  const reportDirectory = mkdtempSync(join(tmpdir(), 'table-ordering-verify-'))

  try {
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
          detail: seconds(Date.now() - stepStartedAt),
        })
        process.stdout.write('\n')
        continue
      }

      const reportPath =
        step.project === undefined ? '' : join(reportDirectory, `${step.project}.xml`)
      const result = spawnSync(step.command, reportArgs(step, reportPath), {
        cwd: root,
        encoding: 'utf8',
      })

      const elapsedMs = Date.now() - stepStartedAt
      const files = step.project === undefined ? null : readReportFile(reportPath)
      const report: StepReport =
        files === null
          ? {
              name: step.name,
              verdict: result.status === 0 ? 'PASS' : 'FAIL',
              detail: seconds(elapsedMs),
            }
          : testStepReport(step.name, result.status, elapsedMs, files)

      reports.push(report)
      process.stdout.write(`${formatStepLine(report, width)}\n`)

      // Under the step's own line, and printed for a step that failed as well as
      // one that passed: which file a run spent its time in is the same question
      // either way.
      if (files?.read) {
        for (const line of formatFileLines(files.files)) process.stdout.write(`${line}\n`)
      }

      if (result.status !== 0) {
        process.stdout.write(`${indent(`${result.stdout ?? ''}${result.stderr ?? ''}`)}\n`)
      }
    }
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true })
  }

  process.stdout.write(`${summaryLine(reports, seconds(Date.now() - startedAt))}\n`)
  return exitCode(reports)
}

// The guard is what lets the tests import this file. Without it, importing the
// module runs every check -- including a nested vitest, inside vitest.
const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  process.exit(await run(process.argv.slice(2), process.env))
}
