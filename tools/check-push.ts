/**
 * What a push claimed, checked against what the remote actually holds.
 *
 * Three questions, asked of the server rather than of the command that changed
 * it: does the remote hold the revision the declaration names, was that
 * revision's workflow run green *for the right reasons*, and do the repository's
 * description and topics say what the change declared they would. A push
 * command's exit code answers none of them, and a run's conclusion answers only
 * the second one badly -- `success` is exactly what a run prints when a check
 * inside it skipped.
 *
 * The expectations arrive as arguments, never from a file in this repository. A
 * stored copy of the description is a second place for it to be true, and the
 * two drift the moment one of them is edited; the declaration a change is made
 * against is where the expectation belongs, and passing it in is what makes that
 * declaration executable.
 *
 * The trap this file is built around: a checking script can pass by checking
 * nothing. A pattern that matches no lines reports no failures, and a log that
 * arrived empty would sail through a matcher written the obvious way. So the
 * expected step names are read from `verify.ts`'s own table and every one of
 * them must be found; a log this file recognises nothing in fails, loudly,
 * naming each line it went looking for.
 *
 * Everything above the CLI section is a pure function of a value, so every one
 * of those states is reachable from a test with no network and no git.
 *
 * Usage: node tools/check-push.ts --revision <sha> --description <text>
 *                                 --topics <a,b,c> [--require-environment]
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Presence, steps } from './verify.ts'

/** One thing that is not as the declaration said it would be. */
export type Violation = {
  where: string
  detail: string
}

export type Verdict = 'PASS' | 'FAIL' | 'SKIP'

export type CheckReport = {
  name: string
  verdict: Verdict
  /** What was inspected for a check that ran, or the reason for one that did not. */
  detail: string
  violations: readonly Violation[]
}

export type Options = {
  revision: string
  description: string
  topics: string[]
  /** Treat "the dependency this needs is absent" as a failure rather than a skip. */
  requireEnvironment: boolean
}

/**
 * A check that found differences. The count is on the line and the differences
 * are under it, so a reader sees how many before reading any of them.
 */
function fail(name: string, violations: Violation[]): CheckReport {
  const count = violations.length
  return {
    name,
    verdict: 'FAIL',
    detail: `${count} difference${count === 1 ? '' : 's'} from the declaration`,
    violations,
  }
}

const REMOTE = 'origin'
const BRANCH = 'main'

/** How far back to look for the run belonging to a revision. */
const RUN_SEARCH_LIMIT = 30

/** A workflow log is megabytes of text, and the default would truncate it into nonsense. */
const LOG_BUFFER_BYTES = 64 * 1024 * 1024

// ---------------------------------------------------------------------------
// Reading a workflow log
// ---------------------------------------------------------------------------

/**
 * `gh run view --log` prefixes every line with its job, its step and a
 * timestamp, tab separated, and puts a byte order mark before the first
 * timestamp of each step. The prefix is removed when it is there and the line
 * is taken as it stands when it is not, so the same parser reads a downloaded
 * log and the output of `pnpm verify` on a terminal.
 */
const PREFIXED = /^(?:[^\t]*\t){2}﻿?\d{4}-\d{2}-\d{2}T[\d:.]+Z (.*)$/

function messages(log: string): string[] {
  return log
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .map((line) => PREFIXED.exec(line)?.[1] ?? line)
}

/**
 * A line reporting a verdict, from either level of the report. `verify` prints
 * its steps flush left and streams the convention rules indented beneath the
 * step that produced them, so the indent is what says which level a line came
 * from, and it is kept rather than trimmed away.
 */
const VERDICT = /^(\s*)([a-z][a-z0-9-]*) \.+ (PASS|FAIL|SKIP)(?: {2}(.*))?$/

export type VerdictLine = {
  name: string
  verdict: Verdict
  detail: string
  /** Printed beneath a streaming step, so a convention rule rather than a step. */
  indented: boolean
}

export function verdictLines(log: string): VerdictLine[] {
  const found: VerdictLine[] = []

  for (const message of messages(log)) {
    const match = VERDICT.exec(message)
    if (match === null) continue
    found.push({
      name: match[2] ?? '',
      verdict: (match[3] ?? '') as Verdict,
      detail: match[4] ?? '',
      indented: (match[1] ?? '').length > 0,
    })
  }

  return found
}

const COUNTS = /^\s*(\d+) checks: (\d+) PASS, (\d+) FAIL, (\d+) SKIP$/
const SUMMARY = /^verify: (PASS|FAIL) {2}(\S+)(?: {2}\(skipped: (.*)\))?$/

/**
 * `verify`'s closing line, parsed once and read twice: for the verdict and the
 * skipped clause this file compares, and for the elapsed figure it reports.
 *
 * That figure was always inside this pattern -- `\S+` matched it and threw it
 * away. Capturing it adds no dependency on `verify`'s output format that this
 * file did not already have, and none it does not already fail on: a log whose
 * summary line does not match is a violation today, before any of this. Both
 * ends live in `tools/`, so a change to the format and the change to this
 * pattern land in one commit.
 */
type Summary = {
  verdict: Verdict
  /** What `verify` printed for its own elapsed time. */
  elapsed: string
  /** The steps it named as skipped, when it named any. */
  skipped?: string
  /** The line as it stands, for a violation to quote back. */
  line: string
}

function parseSummary(log: string): Summary | null {
  const line = messages(log).find((message) => SUMMARY.test(message))
  if (line === undefined) return null

  const match = SUMMARY.exec(line)
  return {
    verdict: (match?.[1] ?? '') as Verdict,
    elapsed: match?.[2] ?? '',
    ...(match?.[3] === undefined ? {} : { skipped: match[3] }),
    line: line.trim(),
  }
}

/**
 * The step names a green log must carry one verdict line each for, taken from
 * the table `verify` runs rather than restated here, so a step added there
 * cannot go unchecked here.
 *
 * A streaming step is excluded because it has no verdict line of its own: it
 * prints its child's output and the run's summary accounts for it. Expecting
 * one would fail every real log.
 */
export function expectedStepNames(): string[] {
  return steps({ requireHistory: false, requireEnvironment: false }, {})
    .filter((step) => !step.stream)
    .map((step) => step.name)
}

/** A log that was fetched, or the reason fetching it did not work. */
export type RunLog = { read: true; text: string } | { read: false; reason: string }

/**
 * Every way the run for a revision can fail to say what the declaration
 * promised.
 *
 * A log that could not be read is one violation naming that, not eight naming
 * lines it did not find. The two states look identical to a matcher -- no
 * recognised lines either way -- and reporting the first as the second would
 * send a reader looking for a broken check when the truth is that GitHub no
 * longer has the log.
 */
export function runVerifiedViolations(log: RunLog, expected: readonly string[]): Violation[] {
  if (!log.read) return [{ where: "the run's log", detail: `could not be read: ${log.reason}` }]

  const violations: Violation[] = []
  const lines = verdictLines(log.text)
  const printed = new Map(lines.filter((line) => !line.indented).map((line) => [line.name, line]))

  for (const name of expected) {
    const line = printed.get(name)
    if (line === undefined) {
      violations.push({ where: name, detail: 'no verdict line in the log' })
    } else if (line.verdict !== 'PASS') {
      violations.push({ where: name, detail: `${line.verdict}  ${line.detail}`.trimEnd() })
    }
  }

  for (const line of lines) {
    if (line.indented && line.verdict !== 'PASS') {
      violations.push({ where: line.name, detail: `${line.verdict}  ${line.detail}`.trimEnd() })
    }
  }

  violations.push(...countsViolations(log.text), ...summaryViolations(parseSummary(log.text)))
  return violations
}

function countsViolations(text: string): Violation[] {
  const line = messages(text).find((message) => COUNTS.test(message))
  if (line === undefined) {
    return [{ where: 'the convention checks', detail: 'no counts line in the log' }]
  }

  const match = COUNTS.exec(line)
  const checks = Number(match?.[1])
  const passed = Number(match?.[2])

  // Both halves matter. A count of zero is a checker whose rules all vanished,
  // which reports no failures and has established nothing.
  if (checks === 0)
    return [{ where: 'the convention checks', detail: `inspected nothing: ${line.trim()}` }]
  if (passed !== checks) return [{ where: 'the convention checks', detail: line.trim() }]
  return []
}

function summaryViolations(summary: Summary | null): Violation[] {
  if (summary === null) return [{ where: 'the run', detail: 'no verify summary line in the log' }]

  const violations: Violation[] = []
  if (summary.verdict !== 'PASS') violations.push({ where: 'the run', detail: summary.line })
  // The summary names what it skipped. A run that skipped anything is a run
  // that reported on less than it was asked to, whatever its exit code said.
  if (summary.skipped !== undefined) {
    violations.push({ where: 'the run', detail: `steps were skipped: ${summary.skipped}` })
  }
  return violations
}

/**
 * The timestamps GitHub gives a job of a run that has completed.
 */
export type JobTimes = { startedAt: string; completedAt: string }

/** How long the run's jobs took, or why that could not be worked out. */
type Span = { ok: true; seconds: number } | { ok: false; reason: string }

/**
 * Earliest start to latest completion, in whole seconds.
 *
 * The span rather than the first job's own duration, because a run may hold
 * more than one and picking one of them would be a branch on a count nothing
 * here has observed. With `ci.yml`'s single job the two are the same figure.
 *
 * The figure is reported in seconds and never in `gh`'s own `2m27s` form.
 * Mirroring that would tie this line to another project's display format, which
 * nothing keeps in step with this one; seconds are tied to nothing, and below a
 * minute the two read identically anyway.
 */
export function jobSpanSeconds(jobs: readonly JobTimes[]): Span {
  if (jobs.length === 0) return { ok: false, reason: 'gh reported no jobs for this run' }

  for (const job of jobs) {
    if (Number.isNaN(Date.parse(job.startedAt)) || Number.isNaN(Date.parse(job.completedAt))) {
      return {
        ok: false,
        reason: `a job timestamp gh returned is not a date: ${job.startedAt} to ${job.completedAt}`,
      }
    }
  }

  const started = jobs.map((job) => Date.parse(job.startedAt))
  const finished = jobs.map((job) => Date.parse(job.completedAt))
  return { ok: true, seconds: Math.round((Math.max(...finished) - Math.min(...started)) / 1000) }
}

/**
 * How many warning annotations a run carries, or why that could not be read.
 *
 * Reported, and never asserted against zero. `run-verified` answers one
 * question -- did CI verify this revision -- and how many deprecation notices
 * GitHub attached to the run is not that question. A check that answered both
 * would go red without saying which of them had gone wrong, and these lines are
 * worth reading only while each of them means one thing. A count that cannot be
 * read is a different matter and is a violation: a check that inspected nothing
 * has established nothing. ADR 0019.
 */
export type RunWarnings = { read: true; count: number } | { read: false; reason: string }

/**
 * The whole `run-verified` line: the differences from the declaration, and --
 * when there are none -- the two timings the log and the job list already
 * carried, and the count of the run's warning annotations.
 *
 * The timings were being fetched by hand after every commit, from sources this
 * check had already read. The count was not being fetched at all, which is how
 * one deprecation notice rode every run this repository ever produced without
 * anybody having to see it.
 *
 * None of the three is optional on a PASS, and the count prints even when it is
 * zero. A line that quietly left one out would send a reader back to the log
 * without telling them to; a clause omitted at zero would put a count that never
 * arrived on the same branch as a run that really carried none. So a figure that
 * cannot be had is a violation and the line is a FAIL naming why.
 */
export function runVerifiedReport(
  databaseId: number,
  log: RunLog,
  jobs: readonly JobTimes[],
  warnings: RunWarnings,
  expected: readonly string[],
): CheckReport {
  // First, so that everything below can read the text. A log that could not be
  // fetched is one violation naming that, which is what the call already makes.
  if (!log.read) return fail('run-verified', runVerifiedViolations(log, expected))

  const violations = runVerifiedViolations(log, expected)
  const span = jobSpanSeconds(jobs)
  if (!span.ok) violations.push({ where: `run ${databaseId}`, detail: span.reason })
  if (!warnings.read) {
    violations.push({
      where: `run ${databaseId}`,
      detail: `its warning annotations could not be read: ${warnings.reason}`,
    })
  }

  // A log with no summary line has already produced its own violation above, so
  // the middle disjunct never decides this on its own. It is written out because
  // the alternative is a fallback that prints a figure nothing read.
  const summary = parseSummary(log.text)
  if (violations.length > 0 || summary === null || !span.ok || !warnings.read) {
    return fail('run-verified', violations)
  }

  const lines = verdictLines(log.text).length
  return {
    name: 'run-verified',
    verdict: 'PASS',
    detail:
      `run ${databaseId}, ${lines} verdict lines, all PASS, ` +
      `verify: ${summary.elapsed} in ${span.seconds}s of jobs, ` +
      `${warnings.count} warning${warnings.count === 1 ? '' : 's'}`,
    violations: [],
  }
}

// ---------------------------------------------------------------------------
// Picking the run a revision's report is about
// ---------------------------------------------------------------------------

/** A run as `gh run list --json databaseId,headSha,status,createdAt` returns it. */
export type Run = {
  databaseId: number
  headSha: string
  status: string
  createdAt: string
}

/** The run to report on, or every reason there is not one. */
export type Picked = { run: Run } | { violations: Violation[] }

/**
 * The run whose log `run-verified` reads, chosen from the ones `gh run list`
 * returned.
 *
 * A revision can have more than one run -- a re-run, a re-dispatch -- and the
 * newest is the one that counts, because this reports what CI most recently
 * said about the revision. An older PASS does not survive a newer FAIL.
 *
 * Newest by `createdAt` and not by position, although `gh` does happen to list
 * newest first. That ordering is documented nowhere, and depending on it would
 * tie the answer to another project's undocumented behaviour the way printing
 * `2m27s` would tie the timings above to its display format. It would also put
 * the property out of reach: with the order load-bearing, a fixture in the
 * other order has to expect the other run, so the suite would certify the
 * dependency instead of forbidding it.
 *
 * `limit` is what was asked of the server and `runs.length` is what came back.
 * Holding both is the only way to tell "there is no such run" from "this did
 * not look far enough" -- different facts, which send a reader to different
 * places.
 */
export function runForRevision(runs: readonly Run[], revision: string, limit: number): Picked {
  const matches = runs.filter((candidate) => candidate.headSha === revision)

  if (matches.length === 0) {
    return {
      violations: [
        {
          where: revision,
          detail:
            runs.length < limit
              ? `no workflow run for this revision; the ${runs.length} on ${BRANCH} are all there are`
              : `no workflow run for this revision among the last ${limit} on ${BRANCH}, which is as far as this looked`,
        },
      ],
    }
  }

  // Before any comparison of them. A field the `--json` list stopped asking for
  // arrives as `undefined`, which every ordering would silently sort somewhere.
  for (const match of matches) {
    if (Number.isNaN(Date.parse(match.createdAt))) {
      return {
        violations: [
          {
            where: `run ${match.databaseId}`,
            detail: `a createdAt gh returned is not a date: ${match.createdAt}`,
          },
        ],
      }
    }
  }

  const newest = matches.reduce((left, right) =>
    Date.parse(right.createdAt) > Date.parse(left.createdAt) ? right : left,
  )

  // A tie would otherwise be settled by input order, which is gh's order -- the
  // property this function exists to stop depending on. Breaking it by run id
  // would only trade one undocumented property for another, so a tie is
  // reported rather than resolved. The ids are sorted, so the message reads the
  // same whichever order the two arrived in.
  const tied = matches.filter(
    (match) => Date.parse(match.createdAt) === Date.parse(newest.createdAt),
  )
  if (tied.length > 1) {
    const ids = tied.map((match) => match.databaseId).sort((left, right) => left - right)
    return {
      violations: [
        {
          where: revision,
          detail: `${ids.length} runs share the newest createdAt ${newest.createdAt}: ${ids.join(', ')}`,
        },
      ],
    }
  }

  if (newest.status !== 'completed') {
    return {
      violations: [
        {
          where: `run ${newest.databaseId}`,
          detail: `is ${newest.status}; wait for it to complete`,
        },
      ],
    }
  }

  return { run: newest }
}

// ---------------------------------------------------------------------------
// The revision, and the metadata
// ---------------------------------------------------------------------------

export type RemoteRef = { present: true; revision: string } | { present: false }

export function pushArrivedViolations(declared: string, remote: RemoteRef): Violation[] {
  const where = `${REMOTE} refs/heads/${BRANCH}`

  if (!remote.present) {
    return [{ where, detail: `the remote has no such ref; the declaration names ${declared}` }]
  }
  if (remote.revision !== declared) {
    return [
      {
        where,
        detail: `the remote holds ${remote.revision}, the declaration names ${declared}`,
      },
    ]
  }
  return []
}

export type Metadata = {
  description: string
  topics: readonly string[]
}

/**
 * Topics are compared as sets. GitHub does not promise an order and the
 * declaration has no reason to fix one, so an ordering difference is not a
 * difference. A difference in membership is named in both directions: absorbing
 * either one lets the remote quietly carry a topic nobody declared, or drop one
 * that was.
 */
export function metadataViolations(actual: Metadata, expected: Metadata): Violation[] {
  const violations: Violation[] = []

  if (actual.description !== expected.description) {
    violations.push({
      where: 'description',
      detail: `declared: ${expected.description}\n        remote:   ${actual.description}`,
    })
  }

  const onRemote = new Set(actual.topics)
  const declared = new Set(expected.topics)

  for (const topic of expected.topics) {
    if (!onRemote.has(topic)) {
      violations.push({ where: 'topics', detail: `declared, and not on the remote: ${topic}` })
    }
  }
  for (const topic of actual.topics) {
    if (!declared.has(topic)) {
      violations.push({ where: 'topics', detail: `on the remote, and not declared: ${topic}` })
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export function parseArgs(argv: readonly string[]): Options | { error: string } {
  let revision: string | undefined
  let description: string | undefined
  let topics: string | undefined
  let requireEnvironment = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const value = (): string | undefined => argv[++index]

    if (arg === '--require-environment') requireEnvironment = true
    else if (arg === '--revision') revision = value()
    else if (arg === '--description') description = value()
    else if (arg === '--topics') topics = value()
    // Ignoring an argument silently would let a typo drop the demand for an
    // environment, or the expectation the whole check exists to compare against.
    else return { error: `unrecognised argument: ${arg}` }
  }

  if (revision === undefined) return { error: 'missing required argument: --revision' }
  if (description === undefined) return { error: 'missing required argument: --description' }
  if (topics === undefined) return { error: 'missing required argument: --topics' }

  return {
    revision,
    description,
    topics: topics
      .split(',')
      .map((topic) => topic.trim())
      .filter((topic) => topic.length > 0),
    requireEnvironment,
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * The one place the flag converts. An absent dependency is neither a pass nor a
 * failure until a run says it was promised the dependency -- which the procedure
 * this check belongs to always does, because the person running it is the one
 * who provides `gh`.
 */
export function skipReport(name: string, reason: string, requireEnvironment: boolean): CheckReport {
  return {
    name,
    verdict: requireEnvironment ? 'FAIL' : 'SKIP',
    detail: reason,
    violations: [],
  }
}

export function exitCode(reports: readonly CheckReport[]): number {
  return reports.some((report) => report.verdict === 'FAIL') ? 1 : 0
}

export function formatCheck(report: CheckReport, width: number): string {
  const dots = '.'.repeat(Math.max(1, width + 2 - report.name.length))
  const lines = [`${report.name} ${dots} ${report.verdict}  ${report.detail}`]
  for (const violation of report.violations) {
    lines.push(`      ${violation.where}: ${violation.detail}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI entry point: the only part of this file that touches the outside world.
// ---------------------------------------------------------------------------

/**
 * Two probes, not one, because two different absences would otherwise share a
 * single state and a reader could not tell which of them to fix.
 *
 * Each is an explicit question asked before the work, never a `try`/`catch`
 * around it: a catch cannot tell an absent `gh` from a `gh` that is there and
 * answering something unexpected.
 */
function probeGh(): Presence {
  if (spawnSync('gh', ['--version'], { stdio: 'ignore' }).status !== 0) {
    return { present: false, reason: 'gh is not installed; see https://cli.github.com' }
  }
  if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status !== 0) {
    return {
      present: false,
      reason: 'gh is installed but not authenticated; run `gh auth login`',
    }
  }
  return { present: true }
}

function gh(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: LOG_BUFFER_BYTES })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function readRemoteRef(): { ok: true; ref: RemoteRef } | { ok: false; reason: string } {
  const result = spawnSync('git', ['ls-remote', REMOTE, `refs/heads/${BRANCH}`], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    const said = (result.stderr ?? '').trim().split('\n').pop() ?? ''
    return { ok: false, reason: `cannot reach ${REMOTE}: ${said || 'git ls-remote failed'}` }
  }

  const line = (result.stdout ?? '').split('\n').find((candidate) => candidate.trim() !== '')
  if (line === undefined) return { ok: true, ref: { present: false } }
  return { ok: true, ref: { present: true, revision: (line.split('\t')[0] ?? '').trim() } }
}

function checkRun(revision: string): CheckReport {
  const listed = gh([
    'run',
    'list',
    '--branch',
    BRANCH,
    '--limit',
    String(RUN_SEARCH_LIMIT),
    '--json',
    'databaseId,headSha,status,createdAt',
  ])

  if (listed.status !== 0) {
    return fail('run-verified', [{ where: 'gh run list', detail: listed.stderr.trim() }])
  }

  let runs: Run[]
  try {
    runs = JSON.parse(listed.stdout) as Run[]
  } catch (error) {
    return fail('run-verified', [{ where: 'gh run list', detail: `unreadable: ${String(error)}` }])
  }

  const picked = runForRevision(runs, revision, RUN_SEARCH_LIMIT)
  if ('violations' in picked) return fail('run-verified', picked.violations)
  const run = picked.run

  const viewed = gh(['run', 'view', String(run.databaseId), '--log'])
  const log: RunLog =
    viewed.status === 0
      ? { read: true, text: viewed.stdout }
      : { read: false, reason: viewed.stderr.trim() || `gh run view exited ${viewed.status}` }

  // The job list, asked for because two things this line reports are in it and
  // nowhere else.
  //
  // The first is the job's duration, reported so that nobody fetches it by
  // hand. The two sources already in hand both give the wrong number. On run
  // 32416115120, whose job GitHub reports as 52s: the run's own
  // startedAt-to-updatedAt, in the JSON `gh run list` already returned, is 57s,
  // because it counts the queueing before the job and the bookkeeping after it;
  // the log's first-to-last timestamp is 48.5s, because the log begins once the
  // runner is already up. Only the job's own pair reproduces what GitHub
  // prints, and a figure close to the published one but not equal to it is
  // worse than no figure.
  //
  // The second is each job's id, which is what `readWarnings` asks by.
  const listedJobs = gh(['run', 'view', String(run.databaseId), '--json', 'jobs'])
  if (listedJobs.status !== 0) {
    return fail('run-verified', [
      { where: 'gh run view --json jobs', detail: listedJobs.stderr.trim() },
    ])
  }

  let jobs: ListedJob[]
  try {
    jobs = (JSON.parse(listedJobs.stdout) as { jobs: ListedJob[] | null }).jobs ?? []
  } catch (error) {
    return fail('run-verified', [
      { where: 'gh run view --json jobs', detail: `unreadable: ${String(error)}` },
    ])
  }

  return runVerifiedReport(run.databaseId, log, jobs, readWarnings(jobs), expectedStepNames())
}

/** A job as `gh run view --json jobs` returns it, for the two fields read here. */
type ListedJob = JobTimes & { databaseId: number }

/**
 * How many warning annotations the run's jobs carry between them.
 *
 * One request per job, and no number of requests is a property of this file:
 * `ci.yml` declares one job today and this follows whatever it declares.
 *
 * The count belongs to a check run rather than to a workflow run, and nothing
 * `gh run view --json jobs` returns carries it -- the fields are completedAt,
 * conclusion, databaseId, name, startedAt, status and url. What closes the gap
 * is that a job's `databaseId` is also its check run's id, which GitHub does not
 * document.
 *
 * That is an undocumented property of somebody else's system, which is the kind
 * of dependency ADR 0018 exists to keep out of this tool's lookups. It is
 * admitted here by that record's own test: a wrong id answers 404, and the 404
 * becomes a violation naming it. The failure is loud, not a plausible count
 * nothing produced.
 */
function readWarnings(jobs: readonly ListedJob[]): RunWarnings {
  let count = 0

  for (const job of jobs) {
    const viewed = gh(['api', `repos/{owner}/{repo}/check-runs/${job.databaseId}`])
    if (viewed.status !== 0) {
      return {
        read: false,
        reason: viewed.stderr.trim() || `gh api exited ${viewed.status}`,
      }
    }

    let found: unknown
    try {
      found = (JSON.parse(viewed.stdout) as { output?: { annotations_count?: unknown } }).output
        ?.annotations_count
    } catch (error) {
      return { read: false, reason: `check run ${job.databaseId}: unreadable: ${String(error)}` }
    }

    // A field the endpoint stopped returning arrives as `undefined`, which
    // would add to nothing and leave a zero looking like an answer.
    if (typeof found !== 'number') {
      return {
        read: false,
        reason: `check run ${job.databaseId} returned no output.annotations_count`,
      }
    }
    count += found
  }

  return { read: true, count }
}

function checkMetadata(expected: Metadata): CheckReport {
  const viewed = gh(['repo', 'view', '--json', 'description,repositoryTopics'])
  if (viewed.status !== 0) {
    return fail('metadata-declared', [{ where: 'gh repo view', detail: viewed.stderr.trim() }])
  }

  let actual: Metadata
  try {
    const parsed = JSON.parse(viewed.stdout) as {
      description: string | null
      repositoryTopics: { name: string }[] | null
    }
    actual = {
      description: parsed.description ?? '',
      topics: (parsed.repositoryTopics ?? []).map((topic) => topic.name),
    }
  } catch (error) {
    return fail('metadata-declared', [
      { where: 'gh repo view', detail: `unreadable: ${String(error)}` },
    ])
  }

  const violations = metadataViolations(actual, expected)
  if (violations.length > 0) return fail('metadata-declared', violations)

  return {
    name: 'metadata-declared',
    verdict: 'PASS',
    detail: `the description and ${actual.topics.length} topics are as declared`,
    violations: [],
  }
}

function checkPush(revision: string, requireEnvironment: boolean): CheckReport {
  const remote = readRemoteRef()
  // A remote nobody can reach is an absent dependency and converts under the
  // flag. A remote that answers and holds no such ref is not absent: that is
  // the answer, and the answer is that the push did not arrive.
  if (!remote.ok) return skipReport('push-arrived', remote.reason, requireEnvironment)

  const violations = pushArrivedViolations(revision, remote.ref)
  if (violations.length > 0) return fail('push-arrived', violations)

  return {
    name: 'push-arrived',
    verdict: 'PASS',
    detail: `${REMOTE} holds ${revision}`,
    violations: [],
  }
}

function main(argv: readonly string[]): number {
  const options = parseArgs(argv)
  if ('error' in options) {
    process.stderr.write(`check-push: ${options.error}\n`)
    process.stderr.write(
      'usage: check-push --revision <sha> --description <text> --topics <a,b,c>\n' +
        '                  [--require-environment]\n',
    )
    return 2
  }

  const reports: CheckReport[] = []
  const demanded = options.requireEnvironment

  reports.push(checkPush(options.revision, demanded))

  // One dependency, two checks. Both report the same absence rather than one
  // reporting it and the other going quiet, because a reader scanning the
  // lines should not have to work out which of them the missing tool belonged to.
  const cli = probeGh()
  if (!cli.present) {
    const absent = skipReport('run-verified', cli.reason, demanded)
    reports.push(absent, { ...absent, name: 'metadata-declared' })
  } else {
    reports.push(checkRun(options.revision))
    reports.push(checkMetadata({ description: options.description, topics: options.topics }))
  }

  const width = Math.max(...reports.map((report) => report.name.length))
  for (const report of reports) process.stdout.write(`${formatCheck(report, width)}\n`)

  const code = exitCode(reports)
  const skips = reports.filter((report) => report.verdict === 'SKIP').map((report) => report.name)
  const note = skips.length === 0 ? '' : `  (skipped: ${skips.join(', ')})`
  process.stdout.write(`check-push: ${code === 0 ? 'PASS' : 'FAIL'}${note}\n`)
  return code
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
