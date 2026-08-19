/**
 * Repository convention checks.
 *
 * The rules are pure functions of a single input value. Nothing below reads
 * the working directory, the environment or git; `collectInput` resolves all
 * of that once, at the CLI entry point, and passes it in. That separation is
 * what lets the tests drive every state of every rule from a fixture instead
 * of from whatever the repository happens to look like when they run.
 *
 * A rule reports three outcomes, not two. A rule that could not evaluate --
 * because the commit it would have to inspect does not exist yet -- is not a
 * passing rule and is not a failing one, and collapsing that into a boolean
 * either reddens a correct bootstrap run or hides a check that never ran.
 *
 * Each rule also declares whether matching zero subjects is acceptable. The
 * runner turns a pass over an empty subject set into a failure, so a rule
 * whose selector silently matches nothing cannot report success.
 */

import { execFileSync } from 'node:child_process'
import { type Dirent, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commitMessageViolations } from './commit-message.ts'

export type Violation = {
  where: string
  detail: string
}

export type Outcome =
  | { status: 'pass'; subjects: number }
  | { status: 'fail'; subjects: number; violations: Violation[] }
  | { status: 'skip'; reason: string }

export type Rule = {
  name: string
  /** true: an outcome reporting zero subjects is a FAILURE, not a pass */
  expectsSubjects: boolean
  check(): Outcome
}

export type Migration = {
  /** Repository-relative path of the up migration. */
  path: string
  /** Contents of the sibling down migration, or null when there is no sibling. */
  down: string | null
}

export type Feature = {
  /** Repository-relative path of the feature directory. */
  path: string
  /** Names of the files directly inside it. */
  files: string[]
}

export type WorkflowJob = {
  /** Repository-relative path of the workflow file declaring it. */
  path: string
  /** The job's own key under `jobs:`. */
  job: string
  /** The bound the job declares, or null when it declares none. */
  timeoutMinutes: number | null
}

export type ConventionInput = {
  /** Contents of README.md, or null when there is no README.md. */
  readme: string | null
  /**
   * UTC dates, `YYYY-MM-DD`, of the commits that changed README.md, newest
   * first. null when the repository has no commits at all.
   */
  readmeCommitDates: string[] | null
  /** README.md has staged or unstaged modifications. */
  readmeDirty: boolean
  /**
   * Every commit message in history, or null when the repository is unborn.
   *
   * null and [] mean different things and must not be conflated. null is
   * "there is no history to check". [] is "history exists and contains no
   * commits", which cannot happen and, if it were ever produced, would fail
   * this rule for a repository that has done nothing wrong. Derive null from
   * git's unborn state, never from an empty log.
   */
  commitMessages: string[] | null
  /**
   * Every `*.up.sql` under `services/<service>/migrations`, in path order,
   * each carrying the text of its `*.down.sql` sibling or null when it has
   * none. The text comes along because "the sibling exists" and "the sibling
   * says something" are different questions and the rule asks both.
   */
  migrations: Migration[]
  /**
   * Every directory under `apps/<app>/src/features` and
   * `services/<service>/src/features`, in path order. Both areas are read
   * because a slice has a client half as well as a server half, and a slice
   * that shipped without an executable acceptance condition is the same defect
   * whichever half it landed in.
   */
  features: Feature[]
  /**
   * Every job declared under `.github/workflows`, in file then declaration
   * order, each carrying the bound it declares or null when it declares none.
   * The number comes along rather than a boolean because "declares one" and
   * "declares this one" are different questions, and only the first is asked
   * here -- the second belongs to the file that has the reasons beside it.
   */
  workflowJobs: WorkflowJob[]
  /** The email address a Signed-off-by trailer must carry. */
  allowedIdentity: string
  /** Treat "no history to evaluate" as a failure rather than a skip. */
  requireHistory: boolean
}

const STATUS_LINE = /^\*\*Status:\*\*.*$/m
const ISO_DATE = /\d{4}-\d{2}-\d{2}/

/**
 * The README status line carries the date of the most recent commit that
 * changed README.md, not the date of HEAD. Anchoring it to HEAD would deadlock
 * every later commit: the check runs before the commit is made, so HEAD is
 * still the previous commit, and the author would have to choose between a
 * date the check rejects and a README that is already stale.
 */
export function readmeStatusDateRule(input: ConventionInput): Rule {
  return {
    name: 'readme-status-date',
    expectsSubjects: true,
    check(): Outcome {
      // Order matters, and it is not arbitrary. Both branches below skip, but
      // only this one converts to a failure under --require-history, so asking
      // about the working tree first would hide a missing history behind a
      // skip that nothing can turn red.
      const dates = input.readmeCommitDates
      if (dates === null || dates.length === 0) {
        const reason = 'no commit has changed README.md yet'
        if (input.requireHistory) {
          return {
            status: 'fail',
            subjects: 0,
            violations: [{ where: 'README.md', detail: reason }],
          }
        }
        return { status: 'skip', reason }
      }

      if (input.readmeDirty) {
        return {
          status: 'skip',
          reason: 'README.md is modified, so the date belongs to a commit not yet made',
        }
      }

      const expected = dates[0] ?? ''
      const violations: Violation[] = []

      if (input.readme === null) {
        violations.push({ where: 'README.md', detail: 'file is missing' })
      } else {
        const line = STATUS_LINE.exec(input.readme)?.[0]
        if (line === undefined) {
          violations.push({ where: 'README.md', detail: 'no line starting with **Status:**' })
        } else {
          const found = ISO_DATE.exec(line)?.[0]
          if (found === undefined) {
            violations.push({ where: 'README.md', detail: `status line carries no date: ${line}` })
          } else if (found !== expected) {
            violations.push({
              where: 'README.md',
              detail: `status line says ${found}, last commit to README.md is ${expected}`,
            })
          }
        }
      }

      if (violations.length > 0) return { status: 'fail', subjects: dates.length, violations }
      return { status: 'pass', subjects: dates.length }
    },
  }
}

/**
 * History is write-once. A message policy introduced later never governed the
 * commits made before it, and cannot without rewriting history, so this rule
 * ships with the first commit rather than with the first commit that would
 * have violated it.
 */
export function commitMessagePolicyRule(input: ConventionInput): Rule {
  return {
    name: 'commit-message-policy',
    expectsSubjects: true,
    check(): Outcome {
      const messages = input.commitMessages
      if (messages === null) {
        const reason = 'the repository has no commits yet'
        if (input.requireHistory) {
          return { status: 'fail', subjects: 0, violations: [{ where: 'history', detail: reason }] }
        }
        return { status: 'skip', reason }
      }

      const violations: Violation[] = []
      for (const [index, message] of messages.entries()) {
        const subject = (message.split('\n')[0] ?? '').trim()
        for (const violation of commitMessageViolations(message, input.allowedIdentity)) {
          violations.push({
            where: `commit ${index + 1} (${subject})`,
            detail: `line ${violation.line}: ${violation.reason}: ${violation.text}`,
          })
        }
      }

      if (violations.length > 0) return { status: 'fail', subjects: messages.length, violations }
      return { status: 'pass', subjects: messages.length }
    },
  }
}

/**
 * A schema change that cannot be undone is a deployment with no way back, and
 * the moment to write the undo is while the change is still fresh: the author
 * knows what the up migration created, and nobody yet depends on the data it
 * would drop.
 *
 * Up and down are separate files rather than two sections of one, so that
 * applying a migration by hand is `psql < ...up.sql` with nothing to strip
 * first. A marker inside a single file would have to be parsed identically by
 * this rule, by the test that applies it, and by whoever types the command.
 */
export function migrationHasDownRule(input: ConventionInput): Rule {
  return {
    name: 'migration-has-down',
    expectsSubjects: true,
    check(): Outcome {
      const violations: Violation[] = []

      for (const migration of input.migrations) {
        if (migration.down === null) {
          violations.push({ where: migration.path, detail: 'no sibling .down.sql' })
        } else if (migration.down.trim() === '') {
          violations.push({ where: migration.path, detail: 'its .down.sql is empty' })
        }
      }

      const subjects = input.migrations.length
      if (violations.length > 0) return { status: 'fail', subjects, violations }
      return { status: 'pass', subjects }
    },
  }
}

/**
 * A feature directory is a vertical slice, and a slice arrives with the check
 * that says it works. Nothing here judges what the test asserts; the rule
 * catches the case where a slice landed with no executable acceptance
 * condition at all, which is the one a reader cannot detect by looking.
 *
 * The selector reads apps as well as services. A guest client is where a slice
 * stops being a JSON response and starts being something a person looks at,
 * which is not a reason to check it less.
 */
export function featureHasTestRule(input: ConventionInput): Rule {
  return {
    name: 'feature-has-test',
    expectsSubjects: true,
    check(): Outcome {
      const violations: Violation[] = []

      for (const feature of input.features) {
        if (!feature.files.some((file) => file.endsWith('.test.ts'))) {
          violations.push({ where: feature.path, detail: 'holds no *.test.ts file' })
        }
      }

      const subjects = input.features.length
      if (violations.length > 0) return { status: 'fail', subjects, violations }
      return { status: 'pass', subjects }
    },
  }
}

/**
 * A job that declares no bound runs under the platform's default, which is six
 * hours. Nobody chose that number, and a run that has stopped making progress
 * spends all of it: what ends such a run is a person noticing, which is not a
 * check and does not happen at night.
 *
 * The rule asks whether a bound is declared, never which one. What the right
 * number is depends on what the job does, and it is decided in the workflow
 * where the reasons can sit beside it; a checker that also capped the value
 * would be legislating a wall clock for jobs nobody has written yet.
 */
export function workflowJobTimeoutRule(input: ConventionInput): Rule {
  return {
    name: 'workflow-job-timeout',
    expectsSubjects: true,
    check(): Outcome {
      const violations: Violation[] = []

      for (const job of input.workflowJobs) {
        if (job.timeoutMinutes === null) {
          violations.push({
            where: `${job.path} jobs.${job.job}`,
            detail: 'declares no timeout-minutes',
          })
        }
      }

      const subjects = input.workflowJobs.length
      if (violations.length > 0) return { status: 'fail', subjects, violations }
      return { status: 'pass', subjects }
    },
  }
}

export function createRules(input: ConventionInput): Rule[] {
  return [
    readmeStatusDateRule(input),
    commitMessagePolicyRule(input),
    migrationHasDownRule(input),
    featureHasTestRule(input),
    workflowJobTimeoutRule(input),
  ]
}

export type Verdict = 'PASS' | 'FAIL' | 'SKIP'

export type RuleReport = {
  name: string
  verdict: Verdict
  outcome: Outcome
  /** The rule passed but matched nothing, and said that it never should. */
  vacuous: boolean
}

/**
 * Apply the vacuity contract. A rule that passed over zero subjects while
 * declaring it expects some is reported as a failure: its selector found
 * nothing, and a check that inspects nothing has not established anything.
 */
export function runRules(rules: readonly Rule[]): RuleReport[] {
  return rules.map((rule) => {
    const outcome = rule.check()
    if (outcome.status === 'skip') {
      return { name: rule.name, verdict: 'SKIP', outcome, vacuous: false }
    }
    if (outcome.status === 'fail') {
      return { name: rule.name, verdict: 'FAIL', outcome, vacuous: false }
    }
    const vacuous = rule.expectsSubjects && outcome.subjects === 0
    return { name: rule.name, verdict: vacuous ? 'FAIL' : 'PASS', outcome, vacuous }
  })
}

export function formatReports(reports: readonly RuleReport[]): string {
  const width = Math.max(0, ...reports.map((report) => report.name.length))
  const lines: string[] = []

  for (const report of reports) {
    const dots = '.'.repeat(Math.max(1, width + 2 - report.name.length))
    lines.push(`  ${report.name} ${dots} ${report.verdict}  ${describe(report)}`)
    if (report.outcome.status === 'fail') {
      for (const violation of report.outcome.violations) {
        lines.push(`      ${violation.where}: ${violation.detail}`)
      }
    }
  }

  const counts = { PASS: 0, FAIL: 0, SKIP: 0 }
  for (const report of reports) counts[report.verdict]++
  lines.push(
    `  ${reports.length} checks: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.SKIP} SKIP`,
  )
  return lines.join('\n')
}

function describe(report: RuleReport): string {
  const { outcome } = report
  if (outcome.status === 'skip') return outcome.reason
  if (report.vacuous) return 'matched no subjects, and this rule expects at least one'
  const plural = outcome.subjects === 1 ? '' : 's'
  const subjects = `${outcome.subjects} subject${plural}`
  if (outcome.status === 'pass') return subjects
  const count = outcome.violations.length
  return `${subjects}, ${count} violation${count === 1 ? '' : 's'}`
}

export function hasFailure(reports: readonly RuleReport[]): boolean {
  return reports.some((report) => report.verdict === 'FAIL')
}

// ---------------------------------------------------------------------------
// CLI entry point: the only part of this file that touches the outside world.
// ---------------------------------------------------------------------------

/**
 * ASCII record separator. Commit messages are free-form text, so the log is
 * read with a terminator that a message cannot itself contain rather than by
 * guessing at blank-line boundaries.
 */
const RECORD = String.fromCharCode(30)

function gitOrNull(root: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, TZ: 'UTC' },
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

/**
 * Every commit message in history, newest first.
 *
 * The format terminates each record, so the split always leaves one trailing
 * empty segment. Exactly that one is removed. Every other segment is a commit,
 * including a commit whose message is empty -- discarding those would
 * under-count subjects, and a repository whose only commit had an empty
 * message would arrive at the history rule as [], which reports a vacuous
 * selector for a repository that plainly has history. An empty message is a
 * matter for the policy to judge, not a reason to pretend the commit is absent.
 */
function readCommitMessages(root: string): string[] {
  const records = (gitOrNull(root, ['log', `--format=%B${RECORD}`]) ?? '').split(RECORD)
  if (records.length > 1 && (records[records.length - 1] ?? '').trim() === '') records.pop()
  return records.map((message) => message.trim())
}

/**
 * Directory entries, or none when the directory does not exist. A missing
 * directory is not an error here: it means the rule that selects from it has
 * no subjects, and the vacuity contract is what decides whether that is
 * acceptable -- not this function, which only reports what is on disk.
 */
function entriesIn(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

function names(path: string, kind: 'file' | 'directory'): string[] {
  return entriesIn(path)
    .filter((entry) => (kind === 'file' ? entry.isFile() : entry.isDirectory()))
    .map((entry) => entry.name)
    .sort()
}

const UP_SUFFIX = '.up.sql'

function readMigrations(root: string): Migration[] {
  const migrations: Migration[] = []

  for (const service of names(join(root, 'services'), 'directory')) {
    const directory = join(root, 'services', service, 'migrations')
    for (const file of names(directory, 'file')) {
      if (!file.endsWith(UP_SUFFIX)) continue
      const sibling = `${file.slice(0, -UP_SUFFIX.length)}.down.sql`
      let down: string | null
      try {
        down = readFileSync(join(directory, sibling), 'utf8')
      } catch {
        down = null
      }
      migrations.push({ path: `services/${service}/migrations/${file}`, down })
    }
  }

  return migrations
}

/**
 * The workspace areas that hold a slice today. `pnpm-workspace.yaml` also globs
 * `packages/*`, which is not read here: nothing is in it, and a selector aimed
 * at a directory that does not exist is a guess about what will be put there.
 */
const AREAS = ['apps', 'services'] as const

function readFeatures(root: string): Feature[] {
  const features: Feature[] = []

  for (const area of AREAS) {
    for (const workspace of names(join(root, area), 'directory')) {
      const directory = join(root, area, workspace, 'src', 'features')
      for (const feature of names(directory, 'directory')) {
        features.push({
          path: `${area}/${workspace}/src/features/${feature}`,
          files: names(join(directory, feature), 'file'),
        })
      }
    }
  }

  return features
}

const WORKFLOWS = ['.github', 'workflows'] as const

/** A column-zero key, which closes whatever block was open above it. */
const TOP_LEVEL_KEY = /^\S/
const JOBS_KEY = /^jobs:\s*$/
/** A job's own key: two spaces, then a name, then nothing else on the line. */
const JOB_KEY = /^ {2}([A-Za-z_][\w-]*):\s*$/
/** The bound, at the job's own depth. Four spaces, so a step's is not read as one. */
const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*(\d+)\s*$/

/**
 * Every job in every workflow file, with the bound it declares.
 *
 * This reads the block-mapping subset these files are actually written in
 * rather than parsing YAML, which would be a dependency bought for one rule.
 * The subset is narrow on purpose, and the failure mode is the point: a file
 * written in a shape this cannot read contributes no jobs, and the vacuity
 * contract turns "no jobs anywhere" into a failure. A defeated scanner
 * therefore reports that it inspected nothing, rather than reporting that it
 * found no violations.
 */
function readWorkflowJobs(root: string): WorkflowJob[] {
  const jobs: WorkflowJob[] = []
  const directory = join(root, ...WORKFLOWS)

  for (const file of names(directory, 'file')) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue

    let text: string
    try {
      text = readFileSync(join(directory, file), 'utf8')
    } catch {
      continue
    }

    const path = `${WORKFLOWS.join('/')}/${file}`
    let inJobs = false
    let current: WorkflowJob | null = null

    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue

      if (TOP_LEVEL_KEY.test(line)) {
        inJobs = JOBS_KEY.test(line)
        current = null
        continue
      }
      if (!inJobs) continue

      const name = JOB_KEY.exec(line)?.[1]
      if (name !== undefined) {
        current = { path, job: name, timeoutMinutes: null }
        jobs.push(current)
        continue
      }

      const minutes = JOB_TIMEOUT.exec(line)?.[1]
      if (current !== null && minutes !== undefined) current.timeoutMinutes = Number(minutes)
    }
  }

  return jobs
}

export function collectInput(root: string, requireHistory: boolean): ConventionInput {
  let readme: string | null
  try {
    readme = readFileSync(join(root, 'README.md'), 'utf8')
  } catch {
    readme = null
  }

  // null must come from git reporting an unborn HEAD, never from a log that
  // printed nothing: an empty log mapped to an empty array would reach the
  // history rule as zero subjects and fail a repository that is merely new.
  const unborn = gitOrNull(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) === null

  const commitMessages = unborn ? null : readCommitMessages(root)

  const readmeCommitDates = unborn
    ? null
    : (
        gitOrNull(root, [
          'log',
          '--format=%cd',
          '--date=format-local:%Y-%m-%d',
          '--',
          'README.md',
        ]) ?? ''
      )
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

  // An untracked README.md is not a modified one. It has neither a staged nor
  // an unstaged change, because there is no committed version to differ from,
  // and treating git's `??` as dirt would report the wrong reason for not
  // evaluating -- the honest reason being that no commit has changed the file.
  const readmeStatus = gitOrNull(root, ['status', '--porcelain', '--', 'README.md']) ?? ''
  const readmeDirty = readmeStatus
    .split('\n')
    .some((line) => line.trim() !== '' && !line.startsWith('??'))

  return {
    readme,
    readmeCommitDates,
    readmeDirty,
    commitMessages,
    migrations: readMigrations(root),
    features: readFeatures(root),
    workflowJobs: readWorkflowJobs(root),
    allowedIdentity: (gitOrNull(root, ['config', '--get', 'user.email']) ?? '').trim(),
    requireHistory,
  }
}

export function main(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv): number {
  // CI runs on a clean tree with the commit already made, so nothing there has
  // a reason to skip. Treating the CI environment the same as the explicit
  // flag keeps the workflow to a single unadorned command.
  const requireHistory = argv.includes('--require-history') || env.CI === 'true'
  const reports = runRules(createRules(collectInput(cwd, requireHistory)))
  process.stdout.write(`${formatReports(reports)}\n`)
  return hasFailure(reports) ? 1 : 0
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv, process.cwd(), process.env))
}
