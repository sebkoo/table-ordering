/**
 * The rules are exercised as pure functions across every state they can reach.
 * `collectInput` is exercised separately against real repositories built under
 * a temporary directory, because the one thing a pure test cannot cover is
 * whether the CLI reads git correctly -- and that reading is where the
 * dangerous mistake lives: an empty log is not an unborn repository.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  type Commit,
  type ConventionInput,
  captureCaptionResolvesRule,
  collectInput,
  commitMessagePolicyRule,
  createRules,
  featureHasTestRule,
  formatReports,
  hasFailure,
  type ImageReference,
  type MigrationList,
  migrationHasDownRule,
  migrationListFullPrefixRule,
  openWindowRestatedRule,
  type Rule,
  type RunStepCommand,
  readmeStatusDateRule,
  runRules,
  runStepSingleTransactionRule,
  type Violation,
  type WindowMention,
  workflowJobTimeoutRule,
} from '../check-conventions.ts'

const IDENTITY = 'committer@example.test'

/** This repository, two levels up from `tools/__tests__`. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * A three-migration sequence, as `collectInput` reads a directory: every file,
 * ascending. An up list is the `.up.sql` half of it in that order and a down list
 * is the `.down.sql` half reversed, which is what a down sequence has to be.
 */
const DIRECTORY = [
  '0001-create-menu.down.sql',
  '0001-create-menu.up.sql',
  '0002-create-restaurant-table.down.sql',
  '0002-create-restaurant-table.up.sql',
  '0003-create-table-order.down.sql',
  '0003-create-table-order.up.sql',
]
const WHOLE_UP = [
  '0001-create-menu.up.sql',
  '0002-create-restaurant-table.up.sql',
  '0003-create-table-order.up.sql',
]
const WHOLE_DOWN = [
  '0003-create-table-order.down.sql',
  '0002-create-restaurant-table.down.sql',
  '0001-create-menu.down.sql',
]

const SUITE = 'services/api/src/features/menu/menu.test.ts'

/**
 * A revision this tree really carries, and a second that nothing does.
 *
 * Full shas, because the rule resolves a caption's short form by prefix against
 * whole ones. `8f828f7` below is inside the first and is not its prefix, which
 * is the pair a containment test calls resolved and a prefix test does not.
 */
const SHA_ONE = 'a8f828f7957384d6030b637a20fc5a9a6b98b5e7'
const SHA_TWO = '0fe409d405eac5654f36d2ff60c400525d1c527d'

/** Two shas differing only after the seventh character, so a short form is ambiguous. */
const AMBIGUOUS_ONE = 'abc1234000000000000000000000000000000001'
const AMBIGUOUS_TWO = 'abc1234000000000000000000000000000000002'

const WORKFLOW_WITH_BOUND = `name: CI

on:
  push:

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo hello
`

function input(overrides: Partial<ConventionInput> = {}): ConventionInput {
  return {
    readme: '# Title\n\n**Status:** 2026-08-19 · bootstrap.\n',
    readmeCommitDates: ['2026-08-19'],
    readmeDirty: false,
    commits: [
      { message: 'set up toolchain and ci\n\nNo application code yet.', authorEmail: IDENTITY },
    ],
    migrations: [
      { path: 'services/api/migrations/0001-create-menu.up.sql', down: 'drop table menu_item;\n' },
    ],
    features: [
      {
        path: 'services/api/src/features/menu',
        files: ['menu.test.ts', 'routes.ts', 'sql.ts'],
      },
    ],
    workflowJobs: [{ path: '.github/workflows/ci.yml', job: 'verify', timeoutMinutes: 10 }],
    runStepCommands: [{ line: 12, text: 'psql -U u -d d --single-transaction < 0001.up.sql' }],
    openWindow: '2 hours',
    windowMentions: [{ path: 'README.md', line: 113, text: 'two hours' }],
    migrationDirectory: ['0001-create-menu.down.sql', '0001-create-menu.up.sql'],
    migrationLists: [
      { path: SUITE, line: 75, name: 'MIGRATION_FILES', files: ['0001-create-menu.up.sql'] },
    ],
    migrationAppliers: [SUITE],
    historyRevisions: [SHA_ONE],
    imageReferences: [
      {
        path: 'README.md',
        line: 20,
        alt: 'A page of the product.',
        target: 'docs/images/a-page.png',
        caption: `*A page, captured at \`${SHA_ONE.slice(0, 7)}\`.*`,
      },
    ],
    requireHistory: false,
    ...overrides,
  }
}

/** Messages authored by the same person, which is what history here looks like. */
function authored(...messages: string[]): Commit[] {
  return messages.map((message) => ({ message, authorEmail: IDENTITY }))
}

function verdictOf(rule: Rule): string {
  return runRules([rule])[0]?.verdict ?? 'MISSING'
}

// ---------------------------------------------------------------------------

describe('readme-status-date', () => {
  it('skips while README.md is modified, because the date belongs to a commit not yet made', () => {
    const outcome = readmeStatusDateRule(input({ readmeDirty: true })).check()
    expect(outcome.status).toBe('skip')
  })

  it('stays a skip on a dirty tree even under --require-history', () => {
    const rule = readmeStatusDateRule(input({ readmeDirty: true, requireHistory: true }))
    expect(verdictOf(rule)).toBe('SKIP')
  })

  it('skips on an unborn repository', () => {
    const rule = readmeStatusDateRule(input({ readmeCommitDates: null, readmeDirty: false }))
    expect(verdictOf(rule)).toBe('SKIP')
  })

  it('skips when no commit has changed README.md yet', () => {
    const rule = readmeStatusDateRule(input({ readmeCommitDates: [] }))
    expect(verdictOf(rule)).toBe('SKIP')
  })

  it('fails on a clean tree with no history under --require-history', () => {
    const rule = readmeStatusDateRule(input({ readmeCommitDates: null, requireHistory: true }))
    expect(verdictOf(rule)).toBe('FAIL')
  })

  it('passes when the status line matches the last commit that changed README.md', () => {
    const outcome = readmeStatusDateRule(input()).check()
    expect(outcome).toEqual({ status: 'pass', subjects: 1 })
  })

  it('counts every commit that changed README.md as a subject', () => {
    const dates = ['2026-08-19', '2026-08-01', '2026-07-30']
    const outcome = readmeStatusDateRule(input({ readmeCommitDates: dates })).check()
    expect(outcome).toEqual({ status: 'pass', subjects: 3 })
  })

  it('compares against the newest date, not the oldest', () => {
    const rule = readmeStatusDateRule(input({ readmeCommitDates: ['2026-08-19', '2026-01-01'] }))
    expect(verdictOf(rule)).toBe('PASS')
  })

  it('fails when the status line carries a stale date', () => {
    const rule = readmeStatusDateRule(input({ readmeCommitDates: ['2026-08-20'] }))
    expect(verdictOf(rule)).toBe('FAIL')
  })

  it('fails when there is no status line', () => {
    const rule = readmeStatusDateRule(input({ readme: '# Title\n\nno status here\n' }))
    expect(verdictOf(rule)).toBe('FAIL')
  })

  it('fails when the status line carries no date', () => {
    const rule = readmeStatusDateRule(input({ readme: '**Status:** bootstrap.\n' }))
    expect(verdictOf(rule)).toBe('FAIL')
  })

  it('fails when README.md is missing but history says it once existed', () => {
    const rule = readmeStatusDateRule(input({ readme: null }))
    expect(verdictOf(rule)).toBe('FAIL')
  })
})

// ---------------------------------------------------------------------------

describe('commit-message-policy', () => {
  it('skips on an unborn repository', () => {
    const rule = commitMessagePolicyRule(input({ commits: null }))
    expect(verdictOf(rule)).toBe('SKIP')
  })

  it('fails on an unborn repository under --require-history', () => {
    const rule = commitMessagePolicyRule(input({ commits: null, requireHistory: true }))
    expect(verdictOf(rule)).toBe('FAIL')
  })

  it('passes over a clean history and counts every message', () => {
    const commits = authored('first subject', 'second subject\n\nwith a body')
    const outcome = commitMessagePolicyRule(input({ commits })).check()
    expect(outcome).toEqual({ status: 'pass', subjects: 2 })
  })

  it('fails when any message in history carries an attribution trailer', () => {
    const commits = authored(
      'clean subject',
      'subject\n\nCo-Authored-By: Agent <noreply@example.test>',
    )
    const outcome = commitMessagePolicyRule(input({ commits })).check()
    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.subjects).toBe(2)
      expect(outcome.violations).toHaveLength(1)
      expect(outcome.violations[0]?.where).toContain('commit 2')
    }
  })

  it('fails when any subject in history carries a Conventional Commits prefix', () => {
    const outcome = commitMessagePolicyRule(
      input({ commits: authored('feat: add a thing') }),
    ).check()
    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.violations).toHaveLength(1)
      expect(outcome.violations[0]?.detail).toContain('Conventional Commits prefix "feat:"')
    }
  })

  it('passes over the same subject with the prefix removed', () => {
    const outcome = commitMessagePolicyRule(input({ commits: authored('add a thing') })).check()
    expect(outcome).toEqual({ status: 'pass', subjects: 1 })
  })

  it('treats an empty history array as a vacuous pass, which the runner fails', () => {
    // This is what an empty `git log` would produce if it were mapped to [].
    // It must not be mistaken for the unborn case: the repository below has
    // done nothing wrong, and reporting FAIL here is the alarm that says the
    // input was built the wrong way.
    const rule = commitMessagePolicyRule(input({ commits: [] }))
    const report = runRules([rule])[0]
    expect(report?.verdict).toBe('FAIL')
    expect(report?.vacuous).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('the vacuity contract', () => {
  it('fails a rule that passes over zero subjects while expecting some', () => {
    const rule: Rule = {
      name: 'expects-subjects',
      expectsSubjects: true,
      check: () => ({ status: 'pass', subjects: 0 }),
    }
    const report = runRules([rule])[0]
    expect(report?.verdict).toBe('FAIL')
    expect(report?.vacuous).toBe(true)
  })

  it('passes a rule that permits zero subjects', () => {
    const rule: Rule = {
      name: 'permits-nothing',
      expectsSubjects: false,
      check: () => ({ status: 'pass', subjects: 0 }),
    }
    const report = runRules([rule])[0]
    expect(report?.verdict).toBe('PASS')
    expect(report?.vacuous).toBe(false)
  })

  it('does not attach a subject count to a skip', () => {
    const rule: Rule = {
      name: 'skipper',
      expectsSubjects: true,
      check: () => ({ status: 'skip', reason: 'nothing to evaluate' }),
    }
    const report = runRules([rule])[0]
    expect(report?.verdict).toBe('SKIP')
    expect(report?.outcome).not.toHaveProperty('subjects')
  })
})

// ---------------------------------------------------------------------------

describe('the report', () => {
  // The three history-dependent fields are all derived from git's unborn state,
  // so they are null together or not at all, and an unborn repository's README
  // is untracked rather than modified. The file rules read the working tree, so
  // they evaluate before the first commit.
  it('summarises a repository with no commits as three skips and six passes', () => {
    const reports = runRules(
      createRules(
        input({
          commits: null,
          readmeCommitDates: null,
          readmeDirty: false,
          historyRevisions: null,
        }),
      ),
    )
    const text = formatReports(reports)
    expect(text).toContain('9 checks: 6 PASS, 0 FAIL, 3 SKIP')
    expect(text).toContain('readme-status-date')
    expect(text).toContain('commit-message-policy')
    expect(hasFailure(reports)).toBe(false)
  })

  it('summarises a clean committed tree as nine passes', () => {
    const reports = runRules(createRules(input({ requireHistory: true })))
    expect(formatReports(reports)).toContain('9 checks: 9 PASS, 0 FAIL, 0 SKIP')
    expect(hasFailure(reports)).toBe(false)
  })

  it('prints a reason beside every skip', () => {
    const reports = runRules(
      createRules(
        input({
          commits: null,
          readmeCommitDates: null,
          readmeDirty: false,
          historyRevisions: null,
        }),
      ),
    )
    for (const line of formatReports(reports).split('\n')) {
      if (!line.includes('SKIP')) continue
      if (line.includes('checks:')) continue
      expect(line.replace(/^.*SKIP\s+/, '').trim().length).toBeGreaterThan(0)
    }
  })

  it('ships exactly the nine rules', () => {
    expect(createRules(input()).map((rule) => rule.name)).toEqual([
      'readme-status-date',
      'commit-message-policy',
      'migration-has-down',
      'feature-has-test',
      'workflow-job-timeout',
      'run-step-single-transaction',
      'open-window-restated',
      'migration-list-full-prefix',
      'capture-caption-resolves',
    ])
  })
})

// ---------------------------------------------------------------------------

const workdirs: string[] = []

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
}

function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'table-ordering-conv-'))
  workdirs.push(dir)
  git(dir, ['init', '--quiet', '-b', 'main'])
  git(dir, ['config', 'user.name', 'A Committer'])
  git(dir, ['config', 'user.email', IDENTITY])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  return dir
}

function commitAll(dir: string, message: string, when?: string): void {
  const env = when === undefined ? {} : { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }
  git(dir, ['add', '-A'], env)
  git(dir, ['commit', '--quiet', '-m', message], env)
}

// ---------------------------------------------------------------------------

describe('run-step-single-transaction', () => {
  function withCommands(...texts: string[]): Rule {
    return runStepSingleTransactionRule(
      input({ runStepCommands: texts.map((text, index) => ({ line: index + 1, text })) }),
    )
  }

  it('passes an invocation that carries the flag', () => {
    expect(verdictOf(withCommands('psql -U u -d d --single-transaction < 0001.up.sql'))).toBe(
      'PASS',
    )
  })

  it('fails one that does not, printing the flag beside the command it is missing from', () => {
    const outcome = withCommands("psql -U u -d d <<'SQL'").check()
    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return
    expect(outcome.violations).toEqual([
      {
        where: 'README.md line 1',
        detail: "required: --single-transaction\n        command:  psql -U u -d d <<'SQL'",
      },
    ])
  })

  it('names only the offending invocation when others comply', () => {
    const outcome = withCommands(
      'psql -U u -d d --single-transaction < 0001.up.sql',
      "psql -U u -d d <<'SQL'",
    ).check()
    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return
    expect(outcome.subjects).toBe(2)
    expect(outcome.violations.map((violation) => violation.where)).toEqual(['README.md line 2'])
  })

  it('fails as vacuous when no run step invokes psql at all', () => {
    expect(verdictOf(runStepSingleTransactionRule(input({ runStepCommands: [] })))).toBe('FAIL')
  })
})

describe('the run steps a README actually carries', () => {
  function readmeWith(body: string): RunStepCommand[] {
    const dir = newRepo()
    writeFileSync(join(dir, 'README.md'), body, 'utf8')
    return collectInput(dir, false).runStepCommands
  }

  const HEREDOC = "docker compose exec -T postgres psql -U u -d d <<'SQL'"
  const REDIRECT = 'psql -U u -d d --single-transaction < 0001.up.sql'

  it('reads both invocation forms the run steps are written in', () => {
    expect(
      readmeWith(
        `\`\`\`sh\n${REDIRECT}\n\`\`\`\n\n\`\`\`sh\n${HEREDOC}\ninsert into x;\nSQL\n\`\`\`\n`,
      ),
    ).toEqual([
      { line: 2, text: REDIRECT },
      { line: 6, text: HEREDOC },
    ])
  })

  it('joins a continuation, so a flag on the next line still belongs to the command', () => {
    const commands = readmeWith('```sh\npsql -U u -d d \\\n  --single-transaction < x.sql\n```\n')
    expect(commands).toEqual([{ line: 2, text: 'psql -U u -d d --single-transaction < x.sql' }])
    expect(verdictOf(runStepSingleTransactionRule(input({ runStepCommands: commands })))).toBe(
      'PASS',
    )
  })

  it('joins a continuation that begins before the command itself', () => {
    expect(
      readmeWith(
        '```sh\ndocker compose exec -T postgres \\\n  psql -U u -d d --single-transaction < x.sql\n```\n',
      ),
    ).toEqual([
      {
        line: 2,
        text: 'docker compose exec -T postgres psql -U u -d d --single-transaction < x.sql',
      },
    ])
  })

  it('reads every shell info string, not only sh', () => {
    for (const info of ['sh', 'bash', 'shell', 'zsh', 'console']) {
      expect(readmeWith(`\`\`\`${info}\n${REDIRECT}\n\`\`\`\n`)).toHaveLength(1)
    }
  })

  it('does not read a fence that carries output rather than commands', () => {
    expect(readmeWith('```\npsql: error: connection refused\n```\n')).toEqual([])
    expect(readmeWith('```json\n{"psql": true}\n```\n')).toEqual([])
  })

  it('does not read a mention of psql in prose', () => {
    expect(readmeWith('There is no runner, so this is `psql` reading each file.\n')).toEqual([])
  })

  it('does not read psql inside a longer word', () => {
    expect(readmeWith('```sh\ncat postgresql.conf .psqlrc\n```\n')).toEqual([])
  })

  it('reports the line the command begins on, which is the line to edit', () => {
    expect(readmeWith(`# Title\n\nSome prose.\n\n\`\`\`sh\n${HEREDOC}\nSQL\n\`\`\`\n`)).toEqual([
      { line: 6, text: HEREDOC },
    ])
  })

  // This is the limit ADR 0016 records, asserted rather than described. The
  // vacuity contract catches losing every subject; it cannot catch losing one.
  it('goes blind on a retagged block, and the contract only catches losing all of them', () => {
    const blocks = (first: string, second: string): string =>
      `\`\`\`${first}\n${REDIRECT}\n\`\`\`\n\n\`\`\`${second}\n${HEREDOC}\nSQL\n\`\`\`\n`

    expect(readmeWith(blocks('sh', 'sh'))).toHaveLength(2)

    // Both retagged: no subjects at all, and the vacuity contract fails it.
    expect(readmeWith(blocks('text', 'text'))).toEqual([])

    // Retag the block that complies and the violation is still caught.
    const violating = readmeWith(blocks('text', 'sh'))
    expect(violating).toHaveLength(1)
    expect(verdictOf(runStepSingleTransactionRule(input({ runStepCommands: violating })))).toBe(
      'FAIL',
    )

    // Retag the block that violates and the rule passes over the one that is
    // left, silently, having inspected half the run steps. That is the limit
    // ADR 0016 records: the vacuity contract catches total blindness only.
    const compliant = readmeWith(blocks('sh', 'text'))
    expect(compliant).toHaveLength(1)
    expect(verdictOf(runStepSingleTransactionRule(input({ runStepCommands: compliant })))).toBe(
      'PASS',
    )
  })
})

describe('collectInput', () => {
  it('maps an unborn repository to null, not to an empty array', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'README.md'), '**Status:** 2026-08-19\n', 'utf8')

    const collected = collectInput(dir, false)
    expect(collected.commits).toBeNull()
    expect(collected.readmeCommitDates).toBeNull()
  })

  it('maps a repository whose history does not touch README.md to an empty array', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'other.txt'), 'x\n', 'utf8')
    commitAll(dir, 'add a file that is not the readme')

    const collected = collectInput(dir, false)
    expect(collected.commits).toHaveLength(1)
    expect(collected.readmeCommitDates).toEqual([])
  })

  it('reads commit messages newest first, with bodies intact', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'a.txt'), 'a\n', 'utf8')
    commitAll(dir, 'first subject\n\nfirst body')
    writeFileSync(join(dir, 'b.txt'), 'b\n', 'utf8')
    commitAll(dir, 'second subject\n\nsecond body')

    const collected = collectInput(dir, false)
    expect(collected.commits?.[0]?.message).toContain('second subject')
    expect(collected.commits?.[0]?.message).toContain('second body')
    expect(collected.commits?.[1]?.message).toContain('first subject')
  })

  it('reports the README commit date in UTC, not in the committer timezone', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'README.md'), '**Status:** 2024-03-06\n', 'utf8')
    // Local 2024-03-05 in this offset, but 2024-03-06 in UTC.
    commitAll(dir, 'add a readme', '2024-03-05T23:30:00-08:00')

    expect(collectInput(dir, false).readmeCommitDates).toEqual(['2024-03-06'])
  })

  it('sees a modified README.md as dirty', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'README.md'), '**Status:** 2024-03-06\n', 'utf8')
    commitAll(dir, 'add a readme', '2024-03-05T23:30:00-08:00')
    expect(collectInput(dir, false).readmeDirty).toBe(false)

    writeFileSync(join(dir, 'README.md'), '**Status:** 2024-03-07\n', 'utf8')
    expect(collectInput(dir, false).readmeDirty).toBe(true)
  })

  it('does not see an untracked README.md as modified', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'other.txt'), 'x\n', 'utf8')
    commitAll(dir, 'add a file that is not the readme')
    writeFileSync(join(dir, 'README.md'), '**Status:** 2024-03-06\n', 'utf8')

    // git reports `?? README.md`, which is not a staged or unstaged change.
    expect(collectInput(dir, false).readmeDirty).toBe(false)
  })

  it('counts a commit whose message is empty, rather than discarding it', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'a.txt'), 'a\n', 'utf8')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '--quiet', '--allow-empty-message', '-m', ''])

    // History exists, so this must not be []. Reporting [] here would trip the
    // vacuity contract and blame the selector for a repository that has a
    // commit -- exactly the confusion null is kept distinct from [] to avoid.
    const collected = collectInput(dir, false)
    expect(collected.commits).toHaveLength(1)
    expect(runRules([commitMessagePolicyRule(collected)])[0]?.verdict).toBe('PASS')
  })

  it('does not drop an empty message from the middle of history', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'a.txt'), 'a\n', 'utf8')
    commitAll(dir, 'first subject')
    writeFileSync(join(dir, 'b.txt'), 'b\n', 'utf8')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '--quiet', '--allow-empty-message', '-m', ''])
    writeFileSync(join(dir, 'c.txt'), 'c\n', 'utf8')
    commitAll(dir, 'third subject')

    expect(collectInput(dir, false).commits).toHaveLength(3)
  })

  it('reads each commit author from the commit, which the history rule needs', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'a.txt'), 'a\n', 'utf8')
    commitAll(dir, 'a subject')

    expect(collectInput(dir, false).commits?.[0]?.authorEmail).toBe(IDENTITY)
  })

  it('passes --require-history through to the rules', () => {
    const dir = newRepo()
    expect(collectInput(dir, true).requireHistory).toBe(true)

    // Named rather than counted: the file rules also fail on this empty
    // repository, but they fail as vacuous, which would let this assertion go
    // on passing for a reason that has nothing to do with --require-history.
    const verdicts = new Map(
      runRules(createRules(collectInput(dir, true))).map((report) => [report.name, report.verdict]),
    )
    expect(verdicts.get('readme-status-date')).toBe('FAIL')
    expect(verdicts.get('commit-message-policy')).toBe('FAIL')
    expect(verdicts.get('capture-caption-resolves')).toBe('FAIL')
  })
})

/**
 * The bootstrap repository has an untracked README.md, and that is the state
 * a fixture built from an in-memory object is least likely to reproduce: git
 * reports `??`, which is neither a staged nor an unstaged change, and reading
 * it as one would make the working-tree skip fire ahead of the missing-history
 * branch. Only the missing-history branch converts under --require-history,
 * so getting that order wrong makes the check unfailable exactly where it is
 * supposed to be strictest. These cases drive the real repository shape.
 */
/**
 * The run-step rule reads the README, so a fixture repository needs a real run
 * step or that rule fails as vacuous and the verdict arrays below stop being
 * about history at all.
 */
/**
 * The window rule reads this file and the guest page, so the README a fixture
 * repository carries needs a real restatement of the window and the constant
 * needs to exist beside it. Without both, that rule fails as vacuous and the
 * verdict arrays below stop being about history at all.
 */
const BOOTSTRAP_README = `# Title

**Status:** 2026-08-19 · x.

The orders placed at that table in the last two hours.

\`\`\`sh
psql -U u -d d --single-transaction < 0001.up.sql
\`\`\`
`

const BOOTSTRAP_SQL = "export const OPEN_WINDOW = '2 hours'\n"

/**
 * A suite that applies the fixture's one migration. Without it the list rule has
 * no subject in this repository and fails as vacuous, and the verdict arrays
 * below stop being about history -- the same reason the run step and the window
 * had to be real above.
 */
const BOOTSTRAP_SUITE = `const MIGRATIONS = join(here, 'services', 'api', 'migrations')
const MIGRATION_FILES = [
  '0001-create-menu.up.sql',
]
`

describe('an unborn repository whose README.md is untracked', () => {
  /** A fresh clone before its first commit: files on disk, nothing in history. */
  function bootstrapRepo(): string {
    const dir = newRepo()
    writeFileSync(join(dir, 'README.md'), BOOTSTRAP_README, 'utf8')
    mkdirSync(join(dir, 'services', 'api', 'migrations'), { recursive: true })
    const migrations = join(dir, 'services', 'api', 'migrations')
    writeFileSync(join(migrations, '0001-create-menu.up.sql'), 'create table x ();\n')
    writeFileSync(join(migrations, '0001-create-menu.down.sql'), 'drop table x;\n')
    mkdirSync(join(dir, 'services', 'api', 'src', 'features', 'menu'), { recursive: true })
    writeFileSync(
      join(dir, 'services', 'api', 'src', 'features', 'menu', 'menu.test.ts'),
      BOOTSTRAP_SUITE,
    )
    mkdirSync(join(dir, 'services', 'api', 'src', 'features', 'order'), { recursive: true })
    writeFileSync(join(dir, 'services', 'api', 'src', 'features', 'order', 'sql.ts'), BOOTSTRAP_SQL)
    // A slice is a slice to `feature-has-test` too, so the directory the window
    // lives in arrives with the file that rule looks for.
    writeFileSync(join(dir, 'services', 'api', 'src', 'features', 'order', 'order.test.ts'), '')
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), WORKFLOW_WITH_BOUND, 'utf8')
    return dir
  }

  it('reports the README as untouched by history rather than as modified', () => {
    const collected = collectInput(bootstrapRepo(), false)
    expect(collected.readmeCommitDates).toBeNull()
    expect(collected.readmeDirty).toBe(false)
  })

  it('skips the three history checks, and names missing history as the reason', () => {
    const reports = runRules(createRules(collectInput(bootstrapRepo(), false)))
    expect(reports.map((report) => report.verdict)).toEqual([
      'SKIP',
      'SKIP',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'SKIP',
    ])
    const readme = reports[0]?.outcome
    expect(readme?.status).toBe('skip')
    if (readme?.status === 'skip') {
      expect(readme.reason).toBe('no commit has changed README.md yet')
    }
  })

  it('fails the three history checks under --require-history', () => {
    const reports = runRules(createRules(collectInput(bootstrapRepo(), true)))
    expect(reports.map((report) => report.verdict)).toEqual([
      'FAIL',
      'FAIL',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'FAIL',
    ])
  })
})

// ---------------------------------------------------------------------------

/**
 * A check answers about the repository, not about the machine it runs on.
 *
 * The condition is deliberately about the whole input rather than about one
 * rule's verdict: the defect it exists to catch is "an input taken from the
 * operator", and a field nobody has written yet is covered by comparing the
 * object. A rule-level assertion would have to be added again for every future
 * field, which is the same as not having one.
 *
 * Both environments are constructed. Taking one of them from whatever this
 * machine's git answers would leave the condition inert wherever there is no
 * global user.email: both sides collect the same empty string, the comparison
 * passes, and the defect is still there. A condition that is red on one laptop
 * and green on another reports the operator, which is the thing being removed.
 */

const CONFIGURED_IDENTITY = 'configured@example.test'

/**
 * A fixed instant inside the window where a UTC date and a Los Angeles date
 * disagree: the 15th in UTC, the 14th in Los Angeles.
 *
 * Pinned rather than left to the clock. Stamped `now`, the two timezones below
 * agree for seventeen hours of every day, and the timezone half of these
 * environments would then discriminate only for a suite that happened to run
 * before 07:00 UTC -- inert the rest of the time, silently.
 */
const COMMITTED_AT = '2026-01-15T03:00:00Z'

/** A directory nothing has been put in, so nothing is reachable through HOME. */
function emptyDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'table-ordering-home-'))
  workdirs.push(dir)
  return dir
}

/** A global git configuration file carrying exactly one setting. */
function globalConfigNaming(email: string): string {
  const path = join(emptyDirectory(), 'gitconfig')
  writeFileSync(path, `[user]\n\temail = ${email}\n`, 'utf8')
  return path
}

/**
 * The two operator environments a check must not be able to tell apart.
 *
 * `GIT_CONFIG_GLOBAL` supplies as well as suppresses, which is what lets both
 * sides be built rather than only one. Neither variable reaches a repository's
 * own `.git/config` -- that is why the repositories below never write an
 * identity into one, and it is why reproducing this defect needed a clone.
 */
const IDENTITY_CONFIGURED: Record<string, string> = {
  GIT_CONFIG_GLOBAL: globalConfigNaming(CONFIGURED_IDENTITY),
  GIT_CONFIG_SYSTEM: '/dev/null',
  HOME: emptyDirectory(),
  TZ: 'UTC',
}

const IDENTITY_ABSENT: Record<string, string> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  HOME: emptyDirectory(),
  TZ: 'America/Los_Angeles',
}

/**
 * Run `body` under one of those environments.
 *
 * The environment is set on `process.env` rather than passed to `collectInput`,
 * so that what runs here is the path `main` takes. A parameter would be a seam
 * with one caller -- this file -- driving a variation production never takes.
 * It assumes nothing in this file runs concurrently with the mutation, which
 * holds while no test in it is marked `.concurrent`.
 */
function under<T>(overrides: Record<string, string>, body: () => T): T {
  const saved = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]))

  Object.assign(process.env, overrides)
  try {
    return body()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

type AuthoredCommit = { message: string; author: string }

/**
 * A repository whose commits carry the authors given, with no identity written
 * to its configuration at all. The identity goes on the one command that needs
 * it, so that suppressing the global and system files leaves nothing behind.
 */
function repoAuthoredBy(commits: readonly AuthoredCommit[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'table-ordering-ident-'))
  workdirs.push(dir)
  git(dir, ['init', '--quiet', '-b', 'main'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'README.md'), BOOTSTRAP_README, 'utf8')

  for (const [index, commit] of commits.entries()) {
    writeFileSync(join(dir, `file-${index}.txt`), `${index}\n`, 'utf8')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '--quiet', '-m', commit.message], {
      GIT_AUTHOR_NAME: 'An Author',
      GIT_AUTHOR_EMAIL: commit.author,
      GIT_AUTHOR_DATE: COMMITTED_AT,
      GIT_COMMITTER_NAME: 'An Author',
      GIT_COMMITTER_EMAIL: commit.author,
      GIT_COMMITTER_DATE: COMMITTED_AT,
    })
  }

  return dir
}

function policyVerdict(dir: string): string {
  return verdictOf(commitMessagePolicyRule(collectInput(dir, false)))
}

describe('what a check is allowed to depend on', () => {
  it('collects the same input with an identity configured and with none anywhere', () => {
    const dir = repoAuthoredBy([{ message: 'a subject', author: IDENTITY }])

    const configured = under(IDENTITY_CONFIGURED, () => collectInput(dir, false))
    const absent = under(IDENTITY_ABSENT, () => collectInput(dir, false))

    expect(absent).toEqual(configured)
  })

  /**
   * The two halves pin the rule from both sides. Without the first, forbidding
   * the trailer outright would satisfy the second; without the second, accepting
   * every trailer would satisfy the first.
   */
  it('accepts a sign-off naming the commit author, whatever the machine says', () => {
    const dir = repoAuthoredBy([
      { message: `subject\n\nSigned-off-by: An Author <${IDENTITY}>`, author: IDENTITY },
    ])

    expect(under(IDENTITY_CONFIGURED, () => policyVerdict(dir))).toBe('PASS')
    expect(under(IDENTITY_ABSENT, () => policyVerdict(dir))).toBe('PASS')
  })

  /**
   * The difference is placed where a weaker comparison would not look. The
   * allowed value is a proper suffix of the one present, so a containment test
   * that dropped the angle brackets would call the two equal -- `a@example.test`
   * does occur inside `ba@example.test`, while `<a@example.test>` does not occur
   * inside `<ba@example.test>`. A pair differing at the first character would be
   * told apart by every weakening, and so would establish nothing.
   */
  it('rejects a sign-off naming somebody who is not the author, whatever the machine says', () => {
    const dir = repoAuthoredBy([
      { message: 'subject\n\nSigned-off-by: B <ba@example.test>', author: 'a@example.test' },
    ])

    expect(under(IDENTITY_CONFIGURED, () => policyVerdict(dir))).toBe('FAIL')
    expect(under(IDENTITY_ABSENT, () => policyVerdict(dir))).toBe('FAIL')
  })
})

// ---------------------------------------------------------------------------

/**
 * The file rules are driven through `collectInput` against real directories,
 * never through a hand-built input. A rule about files that is only ever shown
 * an object literal is a rule about object literals: it would keep agreeing
 * with a selector that reads the wrong path, or one that reads nothing at all.
 */
describe('migration-has-down', () => {
  function repoWithMigrations(files: Record<string, string>): ConventionInput {
    const dir = newRepo()
    mkdirSync(join(dir, 'services', 'api', 'migrations'), { recursive: true })
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, 'services', 'api', 'migrations', name), text, 'utf8')
    }
    return collectInput(dir, false)
  }

  it('passes an up migration whose down sibling says something', () => {
    const collected = repoWithMigrations({
      '0001-create-menu.up.sql': 'create table menu_item ();\n',
      '0001-create-menu.down.sql': 'drop table menu_item;\n',
    })
    expect(migrationHasDownRule(collected).check()).toEqual({ status: 'pass', subjects: 1 })
  })

  it('counts the pair as one subject, not two', () => {
    const collected = repoWithMigrations({
      '0001-create-menu.up.sql': 'create table menu_item ();\n',
      '0001-create-menu.down.sql': 'drop table menu_item;\n',
      '0002-add-currency.up.sql': 'alter table menu_item add column currency char(3);\n',
      '0002-add-currency.down.sql': 'alter table menu_item drop column currency;\n',
    })
    expect(migrationHasDownRule(collected).check()).toEqual({ status: 'pass', subjects: 2 })
  })

  it('fails an up migration with no down sibling', () => {
    const collected = repoWithMigrations({ '0001-create-menu.up.sql': 'create table x ();\n' })
    const outcome = migrationHasDownRule(collected).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.violations).toEqual([
        {
          where: 'services/api/migrations/0001-create-menu.up.sql',
          detail: 'no sibling .down.sql',
        },
      ])
    }
  })

  it('fails an up migration whose down sibling is blank', () => {
    const collected = repoWithMigrations({
      '0001-create-menu.up.sql': 'create table x ();\n',
      '0001-create-menu.down.sql': '\n\n',
    })
    const outcome = migrationHasDownRule(collected).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.violations[0]?.detail).toBe('its .down.sql is empty')
    }
  })

  it('fails as vacuous when no service carries a migration', () => {
    const report = runRules([migrationHasDownRule(collectInput(newRepo(), false))])[0]
    expect(report?.verdict).toBe('FAIL')
    expect(report?.vacuous).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('feature-has-test', () => {
  type Feature = { area: 'apps' | 'services'; workspace: string; name: string; files: string[] }

  function repoWithFeatures(...features: readonly Feature[]): ConventionInput {
    const dir = newRepo()
    for (const feature of features) {
      const path = join(dir, feature.area, feature.workspace, 'src', 'features', feature.name)
      mkdirSync(path, { recursive: true })
      for (const file of feature.files) writeFileSync(join(path, file), '', 'utf8')
    }
    return collectInput(dir, false)
  }

  const service = (files: string[]): Feature => ({
    area: 'services',
    workspace: 'api',
    name: 'menu',
    files,
  })

  const app = (files: string[]): Feature => ({
    area: 'apps',
    workspace: 'guest',
    name: 'menu',
    files,
  })

  it('passes a feature directory that holds a test beside its code', () => {
    const collected = repoWithFeatures(service(['routes.ts', 'sql.ts', 'menu.test.ts']))
    expect(featureHasTestRule(collected).check()).toEqual({ status: 'pass', subjects: 1 })
  })

  it('fails a feature directory that holds only code', () => {
    const collected = repoWithFeatures(service(['routes.ts', 'sql.ts']))
    const outcome = featureHasTestRule(collected).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.violations).toEqual([
        { where: 'services/api/src/features/menu', detail: 'holds no *.test.ts file' },
      ])
    }
  })

  // A guest client sits outside `services`, so a selector that reads only that
  // area reports a clean pass while an entire application goes unchecked.
  it('reads a feature directory in an app, not only in a service', () => {
    const collected = repoWithFeatures(app(['menu.tsx']))
    const outcome = featureHasTestRule(collected).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.violations).toEqual([
        { where: 'apps/guest/src/features/menu', detail: 'holds no *.test.ts file' },
      ])
    }
  })

  it('counts a feature in each area, in path order', () => {
    const collected = repoWithFeatures(
      service(['routes.ts', 'menu.test.ts']),
      app(['menu.tsx', 'menu.browser.test.ts']),
    )
    expect(collected.features.map((feature) => feature.path)).toEqual([
      'apps/guest/src/features/menu',
      'services/api/src/features/menu',
    ])
    expect(featureHasTestRule(collected).check()).toEqual({ status: 'pass', subjects: 2 })
  })

  it('fails as vacuous when no workspace has a feature directory', () => {
    const report = runRules([featureHasTestRule(collectInput(newRepo(), false))])[0]
    expect(report?.verdict).toBe('FAIL')
    expect(report?.vacuous).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('workflow-job-timeout', () => {
  function repoWithWorkflows(files: Record<string, string>): ConventionInput {
    const dir = newRepo()
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, '.github', 'workflows', name), text, 'utf8')
    }
    return collectInput(dir, false)
  }

  it('passes a job that declares a bound', () => {
    const collected = repoWithWorkflows({ 'ci.yml': WORKFLOW_WITH_BOUND })
    expect(collected.workflowJobs).toEqual([
      { path: '.github/workflows/ci.yml', job: 'verify', timeoutMinutes: 10 },
    ])
    expect(workflowJobTimeoutRule(collected).check()).toEqual({ status: 'pass', subjects: 1 })
  })

  it('fails a job that declares none, and names it', () => {
    const collected = repoWithWorkflows({
      'ci.yml': WORKFLOW_WITH_BOUND.replace('    timeout-minutes: 10\n', ''),
    })
    const outcome = workflowJobTimeoutRule(collected).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.violations).toEqual([
        { where: '.github/workflows/ci.yml jobs.verify', detail: 'declares no timeout-minutes' },
      ])
    }
  })

  // A step may carry its own bound, and a step's bound is not the job's: it
  // ends one step while the job goes on. Reading the inner one as the outer
  // would pass exactly the job this rule exists to catch.
  it("does not read a step's bound as the job's", () => {
    const collected = repoWithWorkflows({
      'ci.yml': `jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
        timeout-minutes: 3
`,
    })

    expect(collected.workflowJobs).toEqual([
      { path: '.github/workflows/ci.yml', job: 'verify', timeoutMinutes: null },
    ])
    expect(workflowJobTimeoutRule(collected).check()).toMatchObject({ status: 'fail' })
  })

  it('reads every job in a file, and every file in the directory', () => {
    const collected = repoWithWorkflows({
      'ci.yml': `jobs:
  verify:
    timeout-minutes: 10
  publish:
    runs-on: ubuntu-latest
`,
      'nightly.yaml': WORKFLOW_WITH_BOUND,
    })

    expect(collected.workflowJobs.map((job) => `${job.path} ${job.job}`)).toEqual([
      '.github/workflows/ci.yml verify',
      '.github/workflows/ci.yml publish',
      '.github/workflows/nightly.yaml verify',
    ])

    const outcome = workflowJobTimeoutRule(collected).check()
    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.subjects).toBe(3)
      expect(outcome.violations.map((violation) => violation.where)).toEqual([
        '.github/workflows/ci.yml jobs.publish',
      ])
    }
  })

  // Keys below a block that is not `jobs:` are not jobs, however they are
  // indented. A selector that read them would report subjects it never checked.
  it('reads jobs only under the jobs key', () => {
    const collected = repoWithWorkflows({
      'ci.yml': `on:
  schedule:
    - cron: '0 0 * * *'

jobs:
  verify:
    timeout-minutes: 10
`,
    })
    expect(collected.workflowJobs.map((job) => job.job)).toEqual(['verify'])
  })

  it('fails as vacuous when there is no workflow directory', () => {
    const report = runRules([workflowJobTimeoutRule(collectInput(newRepo(), false))])[0]
    expect(report?.verdict).toBe('FAIL')
    expect(report?.vacuous).toBe(true)
  })

  // The scanner reads the block-mapping subset these files are written in. A
  // file it cannot read must not read as a file with nothing wrong: it yields
  // no subjects, and the vacuity contract turns that into a failure.
  it('fails as vacuous on a workflow written in a shape it cannot read', () => {
    const collected = repoWithWorkflows({
      'ci.yml': 'jobs: { verify: { runs-on: ubuntu-latest } }\n',
    })

    expect(collected.workflowJobs).toEqual([])
    const report = runRules([workflowJobTimeoutRule(collected)])[0]
    expect(report?.verdict).toBe('FAIL')
    expect(report?.vacuous).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('open-window-restated', () => {
  const PAGE = 'apps/guest/src/features/order/placed.tsx'
  const LIMITS = 'docs/known-limitations.md'
  const SOURCE = 'services/api/src/features/order/sql.ts'

  /**
   * The seven the tree carries, in the shape it carries them since ADR 0040:
   * three in README, three in the document the limitations moved to, one on the
   * guest's page. The lines are read from the collector rather than by eye.
   *
   * Nothing compares this constant with the tree again, so it goes stale
   * silently -- its lines already had once before this recapture. That is the
   * class ADR 0040 names, and it is the same residue family as a relative link
   * no rule resolves.
   */
  const RESTATED: WindowMention[] = [
    { path: 'README.md', line: 219, text: 'two hours' },
    { path: 'README.md', line: 225, text: 'Two hours' },
    { path: 'README.md', line: 579, text: 'two hours' },
    { path: PAGE, line: 56, text: 'two hours' },
    { path: LIMITS, line: 20, text: 'two hours' },
    { path: LIMITS, line: 32, text: 'two-hour' },
    { path: LIMITS, line: 83, text: 'two hours' },
  ]

  function withWindow(openWindow: string | null, windowMentions = RESTATED): Rule {
    return openWindowRestatedRule(input({ openWindow, windowMentions }))
  }

  it('passes a restatement that says what the window says', () => {
    expect(verdictOf(withWindow('2 hours'))).toBe('PASS')
  })

  // The condition this rule exists for, and the sites are named rather than
  // counted: a reader who moved the value already knows how many there were,
  // and what they do not have is the list of lines to go and edit.
  it('fails every restatement when the window moves, and names each', () => {
    const outcome = withWindow('90 minutes').check()
    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return

    expect(outcome.subjects).toBe(7)
    expect(outcome.violations.map((violation) => violation.where)).toEqual([
      'README.md line 219',
      'README.md line 225',
      'README.md line 579',
      `${PAGE} line 56`,
      `${LIMITS} line 20`,
      `${LIMITS} line 32`,
      `${LIMITS} line 83`,
    ])
    expect(outcome.violations[0]?.detail).toBe('says two hours, OPEN_WINDOW says 90 minutes')
  })

  it('names only the restatement that disagrees, when the others match', () => {
    const outcome = withWindow('2 hours', [
      { path: 'README.md', line: 113, text: 'two hours' },
      { path: 'README.md', line: 409, text: 'three hours' },
      { path: PAGE, line: 56, text: 'two hours' },
    ]).check()
    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return

    expect(outcome.subjects).toBe(3)
    expect(outcome.violations).toEqual([
      { where: 'README.md line 409', detail: 'says three hours, OPEN_WINDOW says 2 hours' },
    ])
  })

  // A window it cannot read is not a window every sentence agrees with. Each
  // restatement is named beside it, because none of them has been compared with
  // anything, and passing them would be the rule vouching for prose it never
  // checked.
  it('fails when OPEN_WINDOW is not one duration, and vouches for no restatement', () => {
    const outcome = withWindow('2 hours 30 minutes').check()
    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return

    expect(outcome.violations).toHaveLength(8)
    expect(outcome.violations[0]).toEqual({
      where: SOURCE,
      detail: 'OPEN_WINDOW is not one duration: 2 hours 30 minutes',
    })
    expect(outcome.violations[1]).toEqual({
      where: 'README.md line 219',
      detail: 'restates the window as two hours, and there is nothing to compare it with',
    })
  })

  it('fails when there is no OPEN_WINDOW to read at all', () => {
    const outcome = withWindow(null).check()
    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return

    expect(outcome.violations).toHaveLength(8)
    expect(outcome.violations[0]).toEqual({ where: SOURCE, detail: 'no OPEN_WINDOW to read' })
  })

  // The branch that keeps the vocabulary complete as values move. It is what
  // stops a window nothing can spell from leaving a wrong sentence unreadable,
  // and so unreported, at the next move.
  it('fails when it carries no word for the window own number', () => {
    const outcome = withWindow('75 minutes').check()
    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return

    expect(outcome.violations[0]).toEqual({
      where: SOURCE,
      detail: 'OPEN_WINDOW is 75 minutes and no word is recorded for 75',
    })
  })

  it('fails as vacuous when nothing restates the window at all', () => {
    const report = runRules([withWindow('2 hours', [])])[0]
    expect(report?.verdict).toBe('FAIL')
    expect(report?.vacuous).toBe(true)
  })
})

describe('the window a repository restates', () => {
  const SQL = 'services/api/src/features/order/sql.ts'
  const PAGE = 'apps/guest/src/features/order/placed.tsx'

  function repoWith(files: Record<string, string>): ConventionInput {
    const dir = newRepo()
    for (const [path, body] of Object.entries(files)) {
      const full = join(dir, ...path.split('/'))
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body, 'utf8')
    }
    return collectInput(dir, false)
  }

  it('reads the window the constant declares', () => {
    expect(repoWith({ [SQL]: "export const OPEN_WINDOW = '2 hours'\n" }).openWindow).toBe('2 hours')
  })

  it('reads no window when the declaration is not there', () => {
    expect(repoWith({ [SQL]: 'export const OTHER = 1\n' }).openWindow).toBeNull()
    expect(repoWith({}).openWindow).toBeNull()
  })

  // README.md carries exactly this shape: `two` ends one line and `hours`
  // begins the next. A reader taking a line at a time finds six of the seven
  // restatements and reports a subject count that looks entirely reasonable.
  it('reads a restatement a soft line wrap has split across two lines', () => {
    const collected = repoWith({
      'README.md':
        '# Title\n\nAnyone holding the code can read what that table ordered in the last two\nhours. The code is printed in a public room.\n',
    })
    expect(collected.windowMentions).toEqual([{ path: 'README.md', line: 3, text: 'two hours' }])
  })

  it('does not read a duration noun with no number in front of it', () => {
    const collected = repoWith({
      'README.md': 'No window closes that, because parties can be minutes apart.\n',
    })
    expect(collected.windowMentions).toEqual([])
  })

  it('reads a digit form as well as a word form', () => {
    const collected = repoWith({ 'README.md': 'Bounded to 2 hours, and to one table.\n' })
    expect(collected.windowMentions).toEqual([{ path: 'README.md', line: 1, text: '2 hours' }])
  })

  it('reads both documents, each mention at the line it begins on', () => {
    const collected = repoWith({
      'README.md': '# Title\n\nThe orders placed in the last two hours.\n',
      [PAGE]: "const A = 1\nexport const NOTHING = 'Nothing in the last two hours.'\n",
    })
    expect(collected.windowMentions).toEqual([
      { path: 'README.md', line: 3, text: 'two hours' },
      { path: PAGE, line: 2, text: 'two hours' },
    ])
  })

  // The widening's first subject is `docs/known-limitations.md`, and the file
  // beside it carries no duration today. A selector naming one document by name
  // would find the first and stay blind to the second, which is the residue ADR
  // 0039 wrote down rather than repaired: the sight has to be the directory, or
  // it is re-created one file over.
  it('reads a restatement in every document under docs, not in one named file', () => {
    const collected = repoWith({
      'docs/known-limitations.md': 'Anyone holding the code reads the last two hours of it.\n',
      'docs/how-a-request-is-served.md': 'The read is scoped, and bounded to two hours.\n',
    })
    expect(collected.windowMentions).toEqual([
      { path: 'docs/how-a-request-is-served.md', line: 1, text: 'two hours' },
      { path: 'docs/known-limitations.md', line: 1, text: 'two hours' },
    ])
  })

  // ADR 0028: a record's window is a capture, true of that decision on its own
  // date, and a rule that could only go green by rewriting a record is a rule
  // that gets bypassed. The walk reads the files directly under `docs/` and
  // never descends, so `docs/adr/` stays outside the sight by construction
  // rather than by a filter somebody has to remember to keep.
  it('reads no restatement out of a record under docs/adr', () => {
    const collected = repoWith({
      'docs/adr/0028-check-the-window-where-it-is-restated.md':
        'The window was two hours on the date this was decided.\n',
    })
    expect(collected.windowMentions).toEqual([])
  })
})

// ---------------------------------------------------------------------------

/**
 * The rule is driven from values, and the collector against real directories,
 * for the reason the file rules above already are: a rule about files that is
 * only ever shown an object literal is a rule about object literals.
 *
 * The two conditions at the end of this block read this repository itself. They
 * are the census, and they are what stops the rule losing a subject quietly --
 * the defect it exists to police, one level up. They use two instruments with
 * different keys, and neither compares itself against the other, so a collector
 * that goes blind reddens one of them and leaves the other green.
 */
describe('migration-list-full-prefix', () => {
  function listed(files: string[], name = 'MIGRATION_FILES'): MigrationList {
    return { path: SUITE, line: 40, name, files }
  }

  function withLists(lists: MigrationList[], appliers: string[] = [SUITE]): Rule {
    return migrationListFullPrefixRule(
      input({ migrationDirectory: DIRECTORY, migrationLists: lists, migrationAppliers: appliers }),
    )
  }

  const WHERE = `${SUITE} line 40 (MIGRATION_FILES)`

  function difference(declares: string[], migrations: string[]): string {
    return `declares:   ${declares.join(', ')}\n        migrations: ${migrations.join(', ')}`
  }

  it('passes a suite whose up list and down list are both the whole sequence', () => {
    const outcome = withLists([listed(WHOLE_UP), listed(WHOLE_DOWN, 'DOWN_FILES')]).check()
    expect(outcome).toEqual({ status: 'pass', subjects: 2 })
  })

  // B. The failure this rule exists for: a list written when the sequence was
  // shorter, against a schema that exists nowhere.
  it('fails an up list that stops short of the newest migration, naming the list', () => {
    const outcome = withLists([
      listed(['0001-create-menu.up.sql', '0002-create-restaurant-table.up.sql']),
    ]).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return
    expect(outcome.violations).toEqual([
      {
        where: WHERE,
        detail: difference(
          ['0001-create-menu.up.sql', '0002-create-restaurant-table.up.sql'],
          WHOLE_UP,
        ),
      },
    ])
  })

  // C. Order and not membership. A list naming every migration in the wrong
  // order applies `0003` before `0002`, which a set comparison calls whole.
  it('fails an up list that names every migration in the wrong order', () => {
    const outcome = withLists([
      listed([
        '0002-create-restaurant-table.up.sql',
        '0001-create-menu.up.sql',
        '0003-create-table-order.up.sql',
      ]),
    ]).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return
    expect(outcome.violations[0]?.detail).toBe(
      difference(
        [
          '0002-create-restaurant-table.up.sql',
          '0001-create-menu.up.sql',
          '0003-create-table-order.up.sql',
        ],
        WHOLE_UP,
      ),
    )
  })

  // D. The other direction, which is not the same assertion: a down sequence
  // runs newest first, so the directory's order is the wrong one for it.
  it('fails a down list written in the up order', () => {
    const ascending = [...WHOLE_DOWN].reverse()
    const outcome = withLists([listed(ascending, 'DOWN_FILES')]).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return
    expect(outcome.violations).toEqual([
      {
        where: `${SUITE} line 40 (DOWN_FILES)`,
        detail: difference(ascending, WHOLE_DOWN),
      },
    ])
  })

  // E. A list can be wrong by naming too much as well as too little.
  it('fails a list naming a migration the directory does not hold', () => {
    const phantom = [...WHOLE_UP, '0007-add-a-sitting.up.sql']
    const outcome = withLists([listed(phantom)]).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return
    expect(outcome.violations[0]?.detail).toBe(difference(phantom, WHOLE_UP))
  })

  // F. The vacuity contract. A collector that stopped recognising every list
  // would otherwise report a rule that found nothing wrong.
  it('fails as vacuous when no suite carries a list at all', () => {
    const report = runRules([withLists([], [])])[0]
    expect(report?.verdict).toBe('FAIL')
    expect(report?.vacuous).toBe(true)
  })

  // G, fixture half. The second selector: a file that applies migrations and
  // yields no list this rule can read is a list gone quiet, not a file with
  // nothing wrong.
  it('fails a file that applies migrations and yields no list it can read', () => {
    const other = 'services/api/src/features/order/order.test.ts'
    const outcome = withLists([listed(WHOLE_UP)], [SUITE, other]).check()

    expect(outcome.status).toBe('fail')
    if (outcome.status !== 'fail') return
    expect(outcome.subjects).toBe(1)
    expect(outcome.violations).toEqual([
      {
        where: other,
        detail: 'names the migrations directory and carries no migration list this rule can read',
      },
    ])
  })
})

describe('the migration lists a repository carries', () => {
  function repoWithSuites(files: Record<string, string>): ConventionInput {
    const dir = newRepo()
    const migrations = join(dir, 'services', 'api', 'migrations')
    mkdirSync(migrations, { recursive: true })
    for (const name of DIRECTORY) writeFileSync(join(migrations, name), '-- x\n', 'utf8')

    for (const [path, body] of Object.entries(files)) {
      const full = join(dir, ...path.split('/'))
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body, 'utf8')
    }
    return collectInput(dir, false)
  }

  const ELEMENTS = WHOLE_UP.map((name) => `  '${name}',`).join('\n')
  const DOWN_ELEMENTS = WHOLE_DOWN.map((name) => `    '${name}',`).join('\n')

  const BARE = `const MIGRATION_FILES = [\n${ELEMENTS}\n]\n`
  const MAPPED = `const MIGRATIONS = [\n${ELEMENTS}\n].map((name) => join(ROOT, 'services', 'api', 'migrations', name))\n`
  const INDENTED = `describe('the down migration', () => {\n  const DOWN_FILES = [\n${DOWN_ELEMENTS}\n  ]\n})\n`

  const A = 'apps/guest/src/features/menu/menu.browser.test.ts'
  const S = 'services/api/src/features/menu/menu.test.ts'

  // H. The fixture guard, and the failure that produced this rule's own census
  // wrong the first time: three of the ten lists close `].map(...)` rather than
  // with a bare `]`, and a reader keyed on the closer finds seven and says
  // nothing. Two of the three shapes here would be invisible to it.
  it('reads a list closing with a map, one closing bare, and one indented alike', () => {
    const collected = repoWithSuites({ [A]: MAPPED, [S]: `${BARE}\n${INDENTED}` })

    expect(
      collected.migrationLists.map((list) => `${list.path} ${list.name} ${list.files.length}`),
    ).toEqual([`${A} MIGRATIONS 3`, `${S} MIGRATION_FILES 3`, `${S} DOWN_FILES 3`])
    expect(runRules([migrationListFullPrefixRule(collected)])[0]?.verdict).toBe('PASS')
  })

  it('reports the line each list begins on, which is the line to edit', () => {
    const collected = repoWithSuites({ [S]: `// a comment\n\n${BARE}` })
    expect(collected.migrationLists.map((list) => list.line)).toEqual([3])
  })

  // I. An array is not a migration list because it is an array, and a migration
  // named on its own is not a list at all -- `menu.test.ts` applies one file by
  // name inside a condition, and a reader scanning for filenames takes it.
  it('reads neither an array of something else nor a migration named on its own', () => {
    const collected = repoWithSuites({
      [S]:
        `const TABLES = [\n  'restaurant',\n  'menu_item',\n]\n\n` +
        `await scratch.query(migration('0002-create-restaurant-table.up.sql'))\n` +
        `const MIGRATIONS = join(here, 'migrations')\n`,
    })

    expect(collected.migrationLists).toEqual([])
    expect(collected.migrationAppliers).toEqual([S])
  })

  it('names a file that applies migrations, and no file that does not', () => {
    const collected = repoWithSuites({
      [S]: `const MIGRATIONS = join(here, 'services', 'api', 'migrations')\n${BARE}`,
      [A]: `const NOTHING = 1\n`,
    })
    expect(collected.migrationAppliers).toEqual([S])
  })

  it('reads the whole migration directory, both directions, ascending', () => {
    expect(repoWithSuites({ [S]: BARE }).migrationDirectory).toEqual(DIRECTORY)
  })
})

// ---------------------------------------------------------------------------

/**
 * The census, over this repository rather than over a fixture.
 *
 * Two conditions and two instruments. The first runs the collector the rule
 * runs; the second parses no array structure at all, and counts head elements
 * the directory supplies. Neither compares itself with the other, which is what
 * makes them separable by observation: a collector blind to a shape reddens the
 * first and leaves the second green, and a head moved onto its opener line does
 * the reverse. Their blindness runs in opposite directions, which is the whole
 * reason both are here.
 *
 * Sites are named rather than counted, so an eleventh list says which one it is
 * instead of moving a number.
 */
describe('the migration lists this repository carries', () => {
  /** Every `*.test.ts` under the two workspace areas, walked rather than collected. */
  function testFilesUnder(root: string): string[] {
    const found: string[] = []

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.test.ts')) found.push(full)
      }
    }

    for (const area of ['apps', 'services']) walk(join(root, area))
    return found.sort()
  }

  /**
   * How many lists begin, counted by their head element alone.
   *
   * The head of an up list is the directory's first `.up.sql` ascending and the
   * head of a down list is its last `.down.sql`, because a down list is the
   * reverse. Both come from the directory, so this restates no filename.
   */
  function headCounts(root: string): { up: number; down: number } {
    const migrations = readdirSync(join(root, 'services', 'api', 'migrations')).sort()
    const upHead = migrations.filter((name) => name.endsWith('.up.sql'))[0] ?? ''
    const downHead = migrations.filter((name) => name.endsWith('.down.sql')).at(-1) ?? ''
    const counts = { up: 0, down: 0 }

    for (const file of testFilesUnder(root)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const said = line.trim()
        if (said === `'${upHead}',`) counts.up++
        if (said === `'${downHead}',`) counts.down++
      }
    }

    return counts
  }

  // A. The collector's census, by site.
  it('finds ten lists, at the ten sites this tree carries', () => {
    const lists = collectInput(ROOT, false).migrationLists

    expect(lists.map((list) => `${list.path} ${list.name}`)).toEqual([
      'apps/guest/src/features/menu/menu.browser.test.ts MIGRATIONS',
      'apps/guest/src/features/order/order.browser.test.ts MIGRATIONS',
      'apps/staff/src/features/staff/staff.browser.test.ts MIGRATIONS',
      'services/api/src/features/menu/menu.test.ts MIGRATION_FILES',
      'services/api/src/features/menu/menu.test.ts DOWN_FILES',
      'services/api/src/features/order/order.test.ts MIGRATION_FILES',
      'services/api/src/features/order/order.test.ts DOWN_FILES',
      'services/api/src/features/staff/board.test.ts MIGRATION_FILES',
      'services/api/src/features/staff/staff.test.ts MIGRATION_FILES',
      'services/api/src/features/staff/staff.test.ts DOWN_FILES',
    ])
  })

  // A'. The same census by a different key, which never looks at an array.
  it('counts the same ten by their head element, parsing no array at all', () => {
    expect(headCounts(ROOT)).toEqual({ up: 7, down: 3 })
  })

  // G, root half. What the rule says about this tree, so that a file losing its
  // only list moves a verdict inside this suite rather than only in a live run.
  it('passes over this tree, at ten subjects and no violations', () => {
    expect(migrationListFullPrefixRule(collectInput(ROOT, false)).check()).toEqual({
      status: 'pass',
      subjects: 10,
    })
  })
})

// ---------------------------------------------------------------------------

describe('capture-caption-resolves', () => {
  function reference(overrides: Partial<ImageReference> = {}): ImageReference {
    return {
      path: 'README.md',
      line: 33,
      alt: 'The board, with a row per open ticket.',
      target: 'docs/images/staff-board.png',
      caption: `*The board, captured at \`${SHA_ONE.slice(0, 7)}\`.*`,
      ...overrides,
    }
  }

  function withCaptures(
    references: readonly ImageReference[],
    revisions: string[] | null = [SHA_ONE, SHA_TWO],
    requireHistory = false,
  ): Rule {
    return captureCaptionResolvesRule(
      input({ imageReferences: [...references], historyRevisions: revisions, requireHistory }),
    )
  }

  function violationsOf(rule: Rule): Violation[] {
    const outcome = rule.check()
    return outcome.status === 'fail' ? outcome.violations : []
  }

  it('passes a caption naming a revision that resolves', () => {
    expect(verdictOf(withCaptures([reference()]))).toBe('PASS')
  })

  it('names the reference and the caption when no revision is in it', () => {
    expect(violationsOf(withCaptures([reference({ caption: '*The board.*' })]))).toEqual([
      { where: 'README.md line 33', detail: 'caption names no revision: *The board.*' },
    ])
  })

  it('fails a revision that resolves against no commit', () => {
    const rule = withCaptures([reference({ caption: '*The board, captured at `deadbee`.*' })])
    expect(violationsOf(rule)).toEqual([
      {
        where: 'README.md line 33',
        detail: 'caption names deadbee, which resolves against no commit',
      },
    ])
  })

  // The difference is placed where a weaker comparison would not look. `8f828f7`
  // occurs inside SHA_ONE and is not its prefix, so a rule written with
  // `.includes()` calls it resolved and this stays green for the wrong reason.
  // A pair differing at the first character would tell the two apart either way
  // and so would establish nothing about which comparison ran.
  it('fails a revision contained in a sha that is not its prefix', () => {
    expect(SHA_ONE).toContain('8f828f7')
    expect(SHA_ONE.startsWith('8f828f7')).toBe(false)

    const rule = withCaptures([reference({ caption: '*The board, captured at `8f828f7`.*' })])
    expect(violationsOf(rule)).toEqual([
      {
        where: 'README.md line 33',
        detail: 'caption names 8f828f7, which resolves against no commit',
      },
    ])
  })

  it('fails a revision that is a prefix of two commits', () => {
    const rule = withCaptures(
      [reference({ caption: '*The board, captured at `abc1234`.*' })],
      [AMBIGUOUS_ONE, AMBIGUOUS_TWO],
    )
    expect(violationsOf(rule)).toEqual([
      {
        where: 'README.md line 33',
        detail: 'caption names abc1234, which resolves against 2 commits',
      },
    ])
  })

  // Twelve characters, not seven. A reader who pasted a longer short form is
  // naming the same commit, and a rule pinned to one width would reject it.
  it('passes a longer prefix of the same commit', () => {
    const long = SHA_ONE.slice(0, 12)
    const rule = withCaptures([reference({ caption: `*The board, captured at \`${long}\`.*` })])
    expect(verdictOf(rule)).toBe('PASS')
  })

  it('fails a reference carrying no alt text, and still reads its caption', () => {
    expect(violationsOf(withCaptures([reference({ alt: '' })]))).toEqual([
      {
        where: 'README.md line 33',
        detail: 'carries no alt text: docs/images/staff-board.png',
      },
    ])
  })

  // Both words are seven letters drawn entirely from a to f, so a rule that
  // scanned prose for hex runs finds three revisions here and reddens on two
  // English words. The backticks are what declare which token is a revision.
  it('does not read a hex-shaped English word as a revision', () => {
    const caption = `*The defaced sign was effaced before capture, at \`${SHA_ONE.slice(0, 7)}\`.*`
    expect(/^[0-9a-f]{7}$/.test('defaced')).toBe(true)
    expect(/^[0-9a-f]{7}$/.test('effaced')).toBe(true)

    expect(verdictOf(withCaptures([reference({ caption })]))).toBe('PASS')
  })

  // Both resolve, so the resolve clause cannot be what fires. An at-least-one
  // rule passes this fixture; only exactly-one reddens it, which is the whole
  // difference between the two readings.
  it('fails a caption naming two revisions, though both resolve', () => {
    const caption = `*The board, captured at \`${SHA_ONE.slice(0, 7)}\`, superseding \`${SHA_TWO.slice(0, 7)}\`.*`
    expect(violationsOf(withCaptures([reference({ caption })]))).toEqual([
      {
        where: 'README.md line 33',
        detail: `caption names 2 revisions, and a picture came from one: ${SHA_ONE.slice(0, 7)}, ${SHA_TWO.slice(0, 7)}`,
      },
    ])
  })

  it('fails as vacuous when the documents carry no capture at all', () => {
    expect(verdictOf(withCaptures([]))).toBe('FAIL')
  })

  it('skips an unborn repository, and fails it under --require-history', () => {
    expect(verdictOf(withCaptures([reference()], null))).toBe('SKIP')
    expect(verdictOf(withCaptures([reference()], null, true))).toBe('FAIL')
  })

  it('names every offending reference and leaves the compliant ones alone', () => {
    const rule = withCaptures([
      reference(),
      reference({ path: 'AGENTS.md', line: 9, caption: '*A page.*' }),
    ])
    expect(violationsOf(rule).map((violation) => violation.where)).toEqual(['AGENTS.md line 9'])
    const outcome = rule.check()
    expect(outcome.status === 'fail' && outcome.subjects).toBe(2)
  })
})

// ---------------------------------------------------------------------------

/**
 * The collector, against real files under a temporary directory.
 *
 * What a pure test cannot cover is which documents are read and where a caption
 * is found, and both are where the quiet mistake lives: a collector that walked
 * the README alone would report the same three subjects this tree has today and
 * go blind to the first picture a record adds.
 */
describe('the captures a repository carries', () => {
  const CAPTURE = (name: string, alt = 'A page of the product.') =>
    `![${alt}](docs/images/${name}.png)`

  function repositoryWith(files: Record<string, string>): string {
    const dir = newRepo()
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(path)), { recursive: true })
      writeFileSync(join(dir, path), text, 'utf8')
    }
    return dir
  }

  it('reads a capture from the README, from AGENTS.md and from a record', () => {
    const dir = repositoryWith({
      'README.md': `# Title\n\n${CAPTURE('board')}\n\n*The board, captured at \`${SHA_ONE.slice(0, 7)}\`.*\n`,
      'AGENTS.md': `# Working here\n\n${CAPTURE('guest')}\n\n*The guest's page, captured at \`${SHA_ONE.slice(0, 7)}\`.*\n`,
      'docs/adr/0001-a-decision.md': `# 0001. A decision\n\n${CAPTURE('sign-in')}\n\n*The sign-in, captured at \`${SHA_ONE.slice(0, 7)}\`.*\n`,
    })

    expect(collectInput(dir, false).imageReferences.map((found) => found.path)).toEqual([
      'README.md',
      'AGENTS.md',
      'docs/adr/0001-a-decision.md',
    ])
  })

  // Five badges and one capture, which is the README's own shape. A collector
  // keyed on anything but the target counts six and reddens on shields.io.
  it('leaves an image on another origin out', () => {
    const badges = [
      '[![CI](https://example.test/badge.svg)](https://example.test/ci)',
      '[![License](https://img.shields.io/badge/l-a-blue.svg)](LICENSE)',
    ].join('\n')
    const dir = repositoryWith({
      'README.md': `# Title\n\n${badges}\n\n${CAPTURE('board')}\n\n*The board, captured at \`${SHA_ONE.slice(0, 7)}\`.*\n`,
    })

    const found = collectInput(dir, false).imageReferences
    expect(found.map((reference) => reference.target)).toEqual(['docs/images/board.png'])
  })

  // The caption is split the way this repository's sign-in caption is split. A
  // line-based reader takes the first physical line, which here holds no
  // revision at all, and reports a violation against a caption that names one.
  it('joins a caption a soft wrap has split', () => {
    const dir = repositoryWith({
      'README.md':
        `# Title\n\n${CAPTURE('sign-in')}\n\n` +
        `*The board's sign-in. What was typed into the password field is masked\n` +
        `by the browser, and it was captured at \`${SHA_ONE.slice(0, 7)}\`.*\n`,
    })

    const [found] = collectInput(dir, false).imageReferences
    expect(found?.caption).toContain(`captured at \`${SHA_ONE.slice(0, 7)}\`.`)
    expect(found?.caption).not.toContain('\n')
  })

  it('reads no caption from a heading that merely follows a picture', () => {
    const dir = repositoryWith({
      'README.md': `# Title\n\n${CAPTURE('board')}\n\n## What happens next\n\nProse at \`${SHA_ONE.slice(0, 7)}\`.\n`,
    })

    expect(collectInput(dir, false).imageReferences[0]?.caption).toBe('')
  })

  it('reports the line the reference sits on', () => {
    const dir = repositoryWith({
      'README.md': `# Title\n\nSome prose.\n\n${CAPTURE('board')}\n\n*At \`${SHA_ONE.slice(0, 7)}\`.*\n`,
    })

    expect(collectInput(dir, false).imageReferences[0]?.line).toBe(5)
  })

  // null and an empty array are different answers, and only the first means
  // there is no history to resolve against.
  it('reads history as null while unborn and as shas once committed', () => {
    const dir = repositoryWith({ 'README.md': '# Title\n' })
    expect(collectInput(dir, false).historyRevisions).toBeNull()

    commitAll(dir, 'a subject')
    const revisions = collectInput(dir, false).historyRevisions
    expect(revisions).toHaveLength(1)
    expect(revisions?.[0]).toMatch(/^[0-9a-f]{40}$/)
  })
})

// ---------------------------------------------------------------------------

/**
 * The census, over this repository rather than over a fixture.
 *
 * Sites are named rather than counted, so a fourth capture says which one it is
 * instead of moving a number.
 */
describe('the captures this repository carries', () => {
  it('finds three, at the three sites this tree carries', () => {
    const references = collectInput(ROOT, false).imageReferences

    expect(references.map((reference) => `${reference.path} ${reference.target}`)).toEqual([
      'README.md docs/images/guest-page-order-placed.png',
      'README.md docs/images/staff-sign-in.png',
      'README.md docs/images/staff-board.png',
    ])
  })

  it('resolves every caption it carries against its own history', () => {
    expect(verdictOf(captureCaptionResolvesRule(collectInput(ROOT, true)))).toBe('PASS')
  })
})
