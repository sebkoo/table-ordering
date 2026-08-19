/**
 * The rules are exercised as pure functions across every state they can reach.
 * `collectInput` is exercised separately against real repositories built under
 * a temporary directory, because the one thing a pure test cannot cover is
 * whether the CLI reads git correctly -- and that reading is where the
 * dangerous mistake lives: an empty log is not an unborn repository.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  type ConventionInput,
  collectInput,
  commitMessagePolicyRule,
  createRules,
  featureHasTestRule,
  formatReports,
  hasFailure,
  migrationHasDownRule,
  type Rule,
  readmeStatusDateRule,
  runRules,
} from '../check-conventions.ts'

const IDENTITY = 'committer@example.test'

function input(overrides: Partial<ConventionInput> = {}): ConventionInput {
  return {
    readme: '# Title\n\n**Status:** 2026-08-19 · bootstrap.\n',
    readmeCommitDates: ['2026-08-19'],
    readmeDirty: false,
    commitMessages: ['set up toolchain and ci\n\nNo application code yet.'],
    migrations: [
      { path: 'services/api/migrations/0001-create-menu.up.sql', down: 'drop table menu_item;\n' },
    ],
    features: [
      {
        path: 'services/api/src/features/menu',
        files: ['menu.test.ts', 'routes.ts', 'sql.ts'],
      },
    ],
    allowedIdentity: IDENTITY,
    requireHistory: false,
    ...overrides,
  }
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
    const rule = commitMessagePolicyRule(input({ commitMessages: null }))
    expect(verdictOf(rule)).toBe('SKIP')
  })

  it('fails on an unborn repository under --require-history', () => {
    const rule = commitMessagePolicyRule(input({ commitMessages: null, requireHistory: true }))
    expect(verdictOf(rule)).toBe('FAIL')
  })

  it('passes over a clean history and counts every message', () => {
    const messages = ['first subject', 'second subject\n\nwith a body']
    const outcome = commitMessagePolicyRule(input({ commitMessages: messages })).check()
    expect(outcome).toEqual({ status: 'pass', subjects: 2 })
  })

  it('fails when any message in history carries an attribution trailer', () => {
    const messages = ['clean subject', 'subject\n\nCo-Authored-By: Agent <noreply@example.test>']
    const outcome = commitMessagePolicyRule(input({ commitMessages: messages })).check()
    expect(outcome.status).toBe('fail')
    if (outcome.status === 'fail') {
      expect(outcome.subjects).toBe(2)
      expect(outcome.violations).toHaveLength(1)
      expect(outcome.violations[0]?.where).toContain('commit 2')
    }
  })

  it('treats an empty history array as a vacuous pass, which the runner fails', () => {
    // This is what an empty `git log` would produce if it were mapped to [].
    // It must not be mistaken for the unborn case: the repository below has
    // done nothing wrong, and reporting FAIL here is the alarm that says the
    // input was built the wrong way.
    const rule = commitMessagePolicyRule(input({ commitMessages: [] }))
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
  // The two history-dependent fields are both derived from git's unborn state,
  // so they are null together or not at all, and an unborn repository's README
  // is untracked rather than modified. The file rules read the working tree, so
  // they evaluate before the first commit.
  it('summarises a repository with no commits as two skips and two passes', () => {
    const reports = runRules(
      createRules(input({ commitMessages: null, readmeCommitDates: null, readmeDirty: false })),
    )
    const text = formatReports(reports)
    expect(text).toContain('4 checks: 2 PASS, 0 FAIL, 2 SKIP')
    expect(text).toContain('readme-status-date')
    expect(text).toContain('commit-message-policy')
    expect(hasFailure(reports)).toBe(false)
  })

  it('summarises a clean committed tree as four passes', () => {
    const reports = runRules(createRules(input({ requireHistory: true })))
    expect(formatReports(reports)).toContain('4 checks: 4 PASS, 0 FAIL, 0 SKIP')
    expect(hasFailure(reports)).toBe(false)
  })

  it('prints a reason beside every skip', () => {
    const reports = runRules(
      createRules(input({ commitMessages: null, readmeCommitDates: null, readmeDirty: false })),
    )
    for (const line of formatReports(reports).split('\n')) {
      if (!line.includes('SKIP')) continue
      if (line.includes('checks:')) continue
      expect(line.replace(/^.*SKIP\s+/, '').trim().length).toBeGreaterThan(0)
    }
  })

  it('ships exactly the four rules', () => {
    expect(createRules(input()).map((rule) => rule.name)).toEqual([
      'readme-status-date',
      'commit-message-policy',
      'migration-has-down',
      'feature-has-test',
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

describe('collectInput', () => {
  it('maps an unborn repository to null, not to an empty array', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'README.md'), '**Status:** 2026-08-19\n', 'utf8')

    const collected = collectInput(dir, false)
    expect(collected.commitMessages).toBeNull()
    expect(collected.readmeCommitDates).toBeNull()
  })

  it('maps a repository whose history does not touch README.md to an empty array', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'other.txt'), 'x\n', 'utf8')
    commitAll(dir, 'add a file that is not the readme')

    const collected = collectInput(dir, false)
    expect(collected.commitMessages).toHaveLength(1)
    expect(collected.readmeCommitDates).toEqual([])
  })

  it('reads commit messages newest first, with bodies intact', () => {
    const dir = newRepo()
    writeFileSync(join(dir, 'a.txt'), 'a\n', 'utf8')
    commitAll(dir, 'first subject\n\nfirst body')
    writeFileSync(join(dir, 'b.txt'), 'b\n', 'utf8')
    commitAll(dir, 'second subject\n\nsecond body')

    const collected = collectInput(dir, false)
    expect(collected.commitMessages?.[0]).toContain('second subject')
    expect(collected.commitMessages?.[0]).toContain('second body')
    expect(collected.commitMessages?.[1]).toContain('first subject')
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
    expect(collected.commitMessages).toHaveLength(1)
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

    expect(collectInput(dir, false).commitMessages).toHaveLength(3)
  })

  it('reads the configured identity, which the history rule needs', () => {
    expect(collectInput(newRepo(), false).allowedIdentity).toBe(IDENTITY)
  })

  it('passes --require-history through to the rules', () => {
    const dir = newRepo()
    expect(collectInput(dir, true).requireHistory).toBe(true)

    // Named rather than counted: the two file rules also fail on this empty
    // repository, but they fail as vacuous, which would let this assertion go
    // on passing for a reason that has nothing to do with --require-history.
    const verdicts = new Map(
      runRules(createRules(collectInput(dir, true))).map((report) => [report.name, report.verdict]),
    )
    expect(verdicts.get('readme-status-date')).toBe('FAIL')
    expect(verdicts.get('commit-message-policy')).toBe('FAIL')
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
describe('an unborn repository whose README.md is untracked', () => {
  /** A fresh clone before its first commit: files on disk, nothing in history. */
  function bootstrapRepo(): string {
    const dir = newRepo()
    writeFileSync(join(dir, 'README.md'), '# Title\n\n**Status:** 2026-08-19 · x.\n', 'utf8')
    mkdirSync(join(dir, 'services', 'api', 'migrations'), { recursive: true })
    writeFileSync(join(dir, 'services', 'api', 'migrations', '1.up.sql'), 'create table x ();\n')
    writeFileSync(join(dir, 'services', 'api', 'migrations', '1.down.sql'), 'drop table x;\n')
    mkdirSync(join(dir, 'services', 'api', 'src', 'features', 'menu'), { recursive: true })
    writeFileSync(join(dir, 'services', 'api', 'src', 'features', 'menu', 'menu.test.ts'), '')
    return dir
  }

  it('reports the README as untouched by history rather than as modified', () => {
    const collected = collectInput(bootstrapRepo(), false)
    expect(collected.readmeCommitDates).toBeNull()
    expect(collected.readmeDirty).toBe(false)
  })

  it('skips the two history checks, and names missing history as the reason', () => {
    const reports = runRules(createRules(collectInput(bootstrapRepo(), false)))
    expect(reports.map((report) => report.verdict)).toEqual(['SKIP', 'SKIP', 'PASS', 'PASS'])
    const readme = reports[0]?.outcome
    expect(readme?.status).toBe('skip')
    if (readme?.status === 'skip') {
      expect(readme.reason).toBe('no commit has changed README.md yet')
    }
  })

  it('fails the two history checks under --require-history', () => {
    const reports = runRules(createRules(collectInput(bootstrapRepo(), true)))
    expect(reports.map((report) => report.verdict)).toEqual(['FAIL', 'FAIL', 'PASS', 'PASS'])
  })
})

// ---------------------------------------------------------------------------

/**
 * Both file rules are driven through `collectInput` against real directories,
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
