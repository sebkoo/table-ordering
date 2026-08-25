/**
 * Repository convention checks.
 *
 * The rules are pure functions of a single input value. Nothing below reads
 * the working directory, the environment or git; `collectInput` resolves all
 * of that once, at the CLI entry point, and passes it in. That separation is
 * what lets the tests drive every state of every rule from a fixture instead
 * of from whatever the repository happens to look like when they run.
 *
 * What `collectInput` may read is the tree and the history, and nothing else.
 * A value only the machine can answer for -- the operator's git configuration,
 * their environment -- would make a verdict a fact about whoever ran the check,
 * which is a different question from the one every rule here is asking.
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

export type Commit = {
  /** The commit message, comments already absent because git stored it. */
  message: string
  /** The address the commit is authored by, from the object rather than the machine. */
  authorEmail: string
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

export type RunStepCommand = {
  /** 1-based line in README.md where the command begins. */
  line: number
  /** The command, with backslash continuations joined into one line. */
  text: string
}

export type WindowMention = {
  /** Repository-relative path of the file carrying it. */
  path: string
  /** 1-based line where the mention begins, which is the line a reader has to edit. */
  line: number
  /** The mention, with a soft line wrap already joined into one line. */
  text: string
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
   * Every commit in history, newest first, or null when the repository is
   * unborn. Each carries its author's address as well as its message, because
   * the message policy asks whether a sign-off names the commit's own author,
   * and the answer has to come from the commit rather than from whoever is
   * running the check.
   *
   * null and [] mean different things and must not be conflated. null is
   * "there is no history to check". [] is "history exists and contains no
   * commits", which cannot happen and, if it were ever produced, would fail
   * this rule for a repository that has done nothing wrong. Derive null from
   * git's unborn state, never from an empty log.
   */
  commits: Commit[] | null
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
  /**
   * Every command in README.md's shell-tagged code blocks that invokes `psql`,
   * in file order, with backslash continuations already joined. The joining
   * happens here rather than in the rule because a continuation can separate an
   * invocation from its flag, and a rule shown one physical line at a time
   * would both invent violations and miss them.
   */
  runStepCommands: RunStepCommand[]
  /**
   * The interval `OPEN_WINDOW` declares, verbatim, or null when the declaration
   * is not there to read. The text arrives rather than a parsed pair because
   * "the constant is missing" and "the constant says something this cannot read"
   * are different answers, and a violation quotes the second back.
   */
  openWindow: string | null
  /**
   * Every duration in the documents that describe the system as it stands, in
   * path then file order. A restatement of the window and a duration that is
   * something else are indistinguishable here on purpose: the rule is what
   * compares them with the value, and a collector that filtered by the current
   * value would stop seeing a sentence at the moment it went wrong.
   */
  windowMentions: WindowMention[]
  /** Treat "no history to evaluate" as a failure rather than a skip. */
  requireHistory: boolean
}

const SINGLE_TRANSACTION = '--single-transaction'
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
 *
 * Each commit is judged against its own author. An identity read from the
 * machine would make the verdict a fact about whoever ran the check -- the same
 * commit passing here and failing in CI -- and it could never catch the thing
 * the trailer is for: signing off in somebody else's name.
 */
export function commitMessagePolicyRule(input: ConventionInput): Rule {
  return {
    name: 'commit-message-policy',
    expectsSubjects: true,
    check(): Outcome {
      const commits = input.commits
      if (commits === null) {
        const reason = 'the repository has no commits yet'
        if (input.requireHistory) {
          return { status: 'fail', subjects: 0, violations: [{ where: 'history', detail: reason }] }
        }
        return { status: 'skip', reason }
      }

      const violations: Violation[] = []
      for (const [index, commit] of commits.entries()) {
        const subject = (commit.message.split('\n')[0] ?? '').trim()
        for (const violation of commitMessageViolations(commit.message, commit.authorEmail)) {
          violations.push({
            where: `commit ${index + 1} (${subject})`,
            detail: `line ${violation.line}: ${violation.reason}: ${violation.text}`,
          })
        }
      }

      if (violations.length > 0) return { status: 'fail', subjects: commits.length, violations }
      return { status: 'pass', subjects: commits.length }
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

/**
 * `psql` commits each statement as it goes. A run step that loses
 * `--single-transaction` applies whatever ran before the failure, and what
 * survives is exactly the statements no constraint stopped -- which is silent,
 * because the statements that did fail printed errors and `psql` still exits 0.
 *
 * ADR 0015 established the flag for migrations, where re-application errors
 * loudly. This rule covers every run step, including the seed, where
 * re-application duplicates rows instead. That record also states the trigger
 * for narrowing this rule, which is deliberately not built here: no run step
 * yet issues a statement PostgreSQL refuses inside a transaction block.
 *
 * The subjects come from `collectInput`, which reads the README's shell-tagged
 * blocks. The rule's coverage therefore rests on a fence's info string, and the
 * vacuity contract only catches losing *every* subject: retag one block of two
 * and this passes over the remaining one. That limit is recorded in ADR 0016
 * rather than papered over here.
 */
export function runStepSingleTransactionRule(input: ConventionInput): Rule {
  return {
    name: 'run-step-single-transaction',
    expectsSubjects: true,
    check(): Outcome {
      const violations: Violation[] = []

      for (const command of input.runStepCommands) {
        if (!command.text.includes(SINGLE_TRANSACTION)) {
          violations.push({
            where: `README.md line ${command.line}`,
            detail: `required: ${SINGLE_TRANSACTION}\n        command:  ${command.text}`,
          })
        }
      }

      const subjects = input.runStepCommands.length
      if (violations.length > 0) return { status: 'fail', subjects, violations }
      return { status: 'pass', subjects }
    },
  }
}

/**
 * The file that owns the window, named once so the rule and the collector agree
 * on where a reader has to go.
 */
const WINDOW_SOURCE = 'services/api/src/features/order/sql.ts'

/**
 * The numbers English writes as words.
 *
 * Wider than the one word the tree uses, and the width is the point. This table
 * has to recognise a *wrong* window as well as the right one: a sentence edited
 * from two hours to three hours must arrive here as a subject that disagrees,
 * not as a subject that disappeared, and a table holding only the word in use
 * would let the second happen silently. What it has to reach is therefore the
 * numbers English writes as words, not the windows this project might pick.
 *
 * It only ever grows. An entry is what lets the rule read the sentence a moved
 * value left behind, and that sentence is written in the word the value used
 * before it moved.
 *
 * A number outside it is invisible rather than wrong, which is this rule's limit
 * and is recorded in ADR 0028 rather than hidden. What narrows the limit is the
 * check below that the window's own number has a word here.
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'forty-five': 45,
  sixty: 60,
  ninety: 90,
}

type Duration = { count: number; unit: 'hour' | 'minute' }

/**
 * A number, then the unit. One reader for the value and for its restatements,
 * because they are the same shape written two ways: `2 hours` and `two-hour`
 * both land here.
 */
const DURATION = /^([A-Za-z]+(?:-[A-Za-z]+)?|\d+)[\s-]+(hour|minute)s?$/i

function readDuration(said: string | null): Duration | null {
  if (said === null) return null
  const match = DURATION.exec(said.trim())
  if (match === null) return null

  const token = (match[1] ?? '').toLowerCase()
  const count = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token]
  if (count === undefined) return null

  return { count, unit: (match[2] ?? '').toLowerCase() as Duration['unit'] }
}

/**
 * A window a guest reads and the server owns says the same thing in both places.
 *
 * `OPEN_WINDOW` lives in one file and is restated in prose that `apps/guest` and
 * `README.md` carry, and `apps/guest` cannot import `services/api`. Nothing else
 * holds those copies together: a window moved on the server leaves a page telling
 * a guest something untrue, and until this rule there was nothing to go red.
 *
 * It reads the documents that describe the system as it stands, and nothing in
 * `docs/adr/`. A record's window is a capture -- true of that decision on its
 * date -- and it stays valid afterwards for the reason every other capture here
 * does. A rule that could only go green by rewriting a record is a rule that gets
 * bypassed, and superseding is what a decision that moves gets instead. ADR 0028.
 *
 * The order below is not cosmetic. A window that cannot be read is reported
 * first and then every mention is named beside it, because in that state no
 * mention has been compared with anything, and reporting them as agreeing would
 * be the rule passing over prose it never checked.
 */
export function openWindowRestatedRule(input: ConventionInput): Rule {
  return {
    name: 'open-window-restated',
    expectsSubjects: true,
    check(): Outcome {
      const violations: Violation[] = []
      const window = readDuration(input.openWindow)

      if (window === null) {
        violations.push({
          where: WINDOW_SOURCE,
          detail:
            input.openWindow === null
              ? 'no OPEN_WINDOW to read'
              : `OPEN_WINDOW is not one duration: ${input.openWindow}`,
        })
      } else if (!Object.values(NUMBER_WORDS).includes(window.count)) {
        // Never fires while the window is two hours. It is what keeps the table
        // above complete as values move, in the way ADR 0004 defends for
        // `expectsSubjects`: the guard is not inert because it has not fired.
        violations.push({
          where: WINDOW_SOURCE,
          detail: `OPEN_WINDOW is ${input.openWindow} and no word is recorded for ${window.count}`,
        })
      }

      for (const mention of input.windowMentions) {
        const where = `${mention.path} line ${mention.line}`
        if (window === null) {
          violations.push({
            where,
            detail: `restates the window as ${mention.text}, and there is nothing to compare it with`,
          })
          continue
        }

        const said = readDuration(mention.text)
        if (said?.count === window.count && said.unit === window.unit) continue
        violations.push({
          where,
          detail: `says ${mention.text}, OPEN_WINDOW says ${input.openWindow}`,
        })
      }

      const subjects = input.windowMentions.length
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
    runStepSingleTransactionRule(input),
    openWindowRestatedRule(input),
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

/**
 * ASCII unit separator, between a record's two fields. An email address cannot
 * contain one, and neither can the first line of a message, so the split is
 * exact rather than a guess at where the address ends.
 */
const FIELD = String.fromCharCode(31)

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
 * Every commit in history, newest first, with the address it is authored by.
 *
 * The format terminates each record, so the split always leaves one trailing
 * empty segment. Exactly that one is removed. Every other segment is a commit,
 * including a commit whose message is empty -- discarding those would
 * under-count subjects, and a repository whose only commit had an empty
 * message would arrive at the history rule as [], which reports a vacuous
 * selector for a repository that plainly has history. An empty message is a
 * matter for the policy to judge, not a reason to pretend the commit is absent.
 *
 * `%ae` is the address in the object, not `%aE`, which a `.mailmap` can rewrite.
 * The rule asks what the commit says about itself.
 */
function readCommits(root: string): Commit[] {
  const format = `--format=%ae${FIELD}%B${RECORD}`
  const records = (gitOrNull(root, ['log', format]) ?? '').split(RECORD)
  if (records.length > 1 && (records[records.length - 1] ?? '').trim() === '') records.pop()

  return records.map((record) => {
    const end = record.indexOf(FIELD)
    // A record with no separator cannot happen while git honours the format,
    // and mapping it to an empty address is what makes that visible: every
    // sign-off in the commit is then rejected, rather than every one allowed.
    if (end === -1) return { message: record.trim(), authorEmail: '' }
    return { message: record.slice(end + 1).trim(), authorEmail: record.slice(0, end).trim() }
  })
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

/**
 * The fence info strings that mean "commands to run". Bare and ```json fences
 * are excluded because they carry output examples, and a transcript line such
 * as `psql: error: connection refused` would otherwise become a subject the
 * rule then failed on.
 *
 * Five rather than one: every shell block in README.md is tagged `sh` today,
 * but nothing enforces that, and a block retagged ```bash is a likelier
 * accident than an alternate fence marker. Widening shrinks that dependency
 * without removing it -- a block tagged outside this set is still invisible,
 * which ADR 0016 records as this rule's limit rather than hiding.
 */
const SHELL_INFO_STRINGS = new Set(['sh', 'bash', 'shell', 'zsh', 'console'])

const FENCE = /^```(\S*)\s*$/
/** `psql` as a whole word, so `postgresql` and `psqlrc` are not invocations. */
const PSQL = /\bpsql\b/

/**
 * Every `psql` invocation in README.md's shell-tagged blocks.
 *
 * Continuations are joined before matching. A line-based reader fails in both
 * directions on the same file: given a command whose flag sits on the next
 * line it reports a violation that is not there, and given a continuation line
 * carrying the flag but not the command it finds no subject at all.
 *
 * The line number reported is where the command begins, which is the line a
 * reader has to edit.
 */
function readRunStepCommands(readme: string | null): RunStepCommand[] {
  if (readme === null) return []

  const commands: RunStepCommand[] = []
  const lines = readme.split('\n')
  let shell = false
  let fenced = false
  let pending: RunStepCommand | null = null

  for (const [index, line] of lines.entries()) {
    const info = FENCE.exec(line)?.[1]
    if (info !== undefined) {
      // A closing fence carries no info string, so entering and leaving are the
      // same branch; `fenced` is what says which of the two this one is.
      shell = fenced ? false : SHELL_INFO_STRINGS.has(info)
      fenced = !fenced
      pending = null
      continue
    }
    if (!shell) continue

    const continues = line.endsWith('\\')
    const text = (continues ? line.slice(0, -1) : line).trim()

    if (pending !== null) {
      pending.text = `${pending.text} ${text}`.trim()
      if (!continues) pending = null
      continue
    }

    if (!PSQL.test(text) && !continues) continue

    const command: RunStepCommand = { line: index + 1, text }
    if (continues) {
      pending = command
      commands.push(command)
      continue
    }
    commands.push(command)
  }

  // A continued command is collected before its later lines are read, so
  // whether it invokes psql is only knowable once it is whole.
  return commands.filter((command) => PSQL.test(command.text))
}

/**
 * The declaration, read as text rather than by importing the module.
 *
 * An import would put the API package's module graph inside a checker that runs
 * before anything is built, for one string. This is the posture `readWorkflowJobs`
 * already takes towards YAML and `readFileReport` towards junit, and the failure
 * mode is the same one that makes it acceptable: a declaration written in a shape
 * this cannot read yields null, which the rule reports as a violation naming the
 * file, rather than as a window that agrees with everything.
 */
const WINDOW_DECLARATION = /^export const OPEN_WINDOW = '([^']*)'$/m

/**
 * The documents that describe the system as it stands.
 *
 * Two paths, not a directory. `services/api/src/features/order/sql.ts` carries
 * `five minutes` in the paragraph above the value, and the order suite carries
 * `10 minutes`, `5 minutes`, `100 minutes` and `3 hours` as fixture ages -- real
 * durations that are not the window, which a selector aimed at a directory would
 * report. A restatement outside these two is invisible, which ADR 0028 records as
 * this rule's limit rather than hiding.
 */
const RESTATING_PATHS = ['README.md', 'apps/guest/src/features/order/placed.tsx'] as const

/**
 * A duration in prose: a number, then the unit.
 *
 * Matched against the whole file with its newlines still in it, so that a phrase
 * a soft wrap has split is still one phrase. README.md carries exactly that today
 * -- `two` ends one line and `hours` begins the next -- and a line-based reader
 * finds six of the seven mentions and reports a number that looks right. It is
 * the same failure `readRunStepCommands` joins continuations to avoid.
 *
 * The leading token is required because `parties can be minutes apart` is not a
 * duration, and a rule that reported it would be legislating the prose rather
 * than checking a value.
 */
const DURATION_IN_PROSE = /\b([A-Za-z]+(?:-[A-Za-z]+)?|\d+)[\s-]+(hour|minute)s?\b/g

function readWindow(root: string): string | null {
  let text: string
  try {
    text = readFileSync(join(root, WINDOW_SOURCE), 'utf8')
  } catch {
    return null
  }
  return WINDOW_DECLARATION.exec(text)?.[1] ?? null
}

function readWindowMentions(root: string): WindowMention[] {
  const mentions: WindowMention[] = []

  for (const path of RESTATING_PATHS) {
    let text: string
    try {
      text = readFileSync(join(root, path), 'utf8')
    } catch {
      continue
    }

    for (const match of text.matchAll(DURATION_IN_PROSE)) {
      // A wrap inside the phrase is joined here, so that what the rule compares
      // and what a violation quotes are the sentence rather than the line.
      const said = match[0].replace(/\s+/g, ' ')
      if (readDuration(said) === null) continue
      const line = text.slice(0, match.index).split('\n').length
      mentions.push({ path, line, text: said })
    }
  }

  return mentions
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

  const commits = unborn ? null : readCommits(root)

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
    commits,
    migrations: readMigrations(root),
    features: readFeatures(root),
    workflowJobs: readWorkflowJobs(root),
    runStepCommands: readRunStepCommands(readme),
    openWindow: readWindow(root),
    windowMentions: readWindowMentions(root),
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
