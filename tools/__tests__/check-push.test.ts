/**
 * The conditions on what `check-push` reports, driven from values rather than
 * from a network.
 *
 * The first of them is not about a push at all. A checking script can pass by
 * checking nothing: a pattern that matches no lines reports no failures, and a
 * log that arrived empty, or from a run that printed nothing this repository
 * recognises, would sail through a matcher written the obvious way. So an empty
 * log is asserted to fail, naming every line it went looking for, and the rest
 * of the conditions are expressed over a log that a real run really produced.
 *
 * That fixture is a verbatim capture, tab-separated prefixes, byte order mark,
 * escape sequences and all. A tidied-up one would let a parser pass here that
 * cannot read anything `gh run view --log` actually emits.
 */

import { describe, expect, it } from 'vitest'
import {
  type CheckReport,
  exitCode,
  expectedStepNames,
  formatCheck,
  metadataViolations,
  parseArgs,
  pushArrivedViolations,
  type RunLog,
  runVerifiedViolations,
  skipReport,
  verdictLines,
} from '../check-push.ts'

/** A capture of the run for revision 7a1d0a5, which was green. */
const GREEN = `verify	Run pnpm verify --require-environment	﻿2026-08-19T20:33:17.9914030Z ##[group]Run pnpm verify --require-environment
verify	Run pnpm verify --require-environment	2026-08-19T20:33:17.9914439Z ^[[36;1mpnpm verify --require-environment^[[0m
verify	Run pnpm verify --require-environment	2026-08-19T20:33:18.3916546Z $ node --disable-warning=ExperimentalWarning tools/verify.ts --require-environment
verify	Run pnpm verify --require-environment	2026-08-19T20:33:18.8460717Z typecheck ........ PASS  0.3s
verify	Run pnpm verify --require-environment	2026-08-19T20:33:19.0297816Z typecheck-guest .. PASS  0.2s
verify	Run pnpm verify --require-environment	2026-08-19T20:33:19.1143737Z lint ............. PASS  0.1s
verify	Run pnpm verify --require-environment	2026-08-19T20:33:20.8725519Z test-tools ....... PASS  1.8s
verify	Run pnpm verify --require-environment	2026-08-19T20:33:21.6111202Z test-api ......... PASS  0.7s
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.8736151Z test-guest ....... PASS  3.0s
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.8736734Z conventions:
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.9744028Z   readme-status-date ..... PASS  4 subjects
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.9744852Z   commit-message-policy .. PASS  4 subjects
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.9745440Z   migration-has-down ..... PASS  1 subject
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.9746195Z   feature-has-test ....... PASS  2 subjects
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.9747413Z   4 checks: 4 PASS, 0 FAIL, 0 SKIP
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.9782930Z 
verify	Run pnpm verify --require-environment	2026-08-19T20:33:26.9784627Z verify: PASS  8.4s`

const EXPECTED = expectedStepNames()

/** The same log with one line rewritten, which is how a difference is produced. */
function withLine(log: string, find: string, replace: string): string {
  if (!log.includes(find)) throw new Error(`the fixture carries no line matching: ${find}`)
  return log.replace(find, replace)
}

function read(text: string): RunLog {
  return { read: true, text }
}

const details = (violations: { where: string; detail: string }[]): string[] =>
  violations.map((violation) => `${violation.where}: ${violation.detail}`)

// ---------------------------------------------------------------------------

describe('the log of the run for a revision', () => {
  // The condition this file exists for. A matcher that reports nothing when it
  // matches nothing would pass here, having established nothing at all.
  it('fails on an empty log, naming every line it went looking for', () => {
    expect(details(runVerifiedViolations(read(''), EXPECTED))).toEqual([
      'typecheck: no verdict line in the log',
      'typecheck-guest: no verdict line in the log',
      'lint: no verdict line in the log',
      'test-tools: no verdict line in the log',
      'test-api: no verdict line in the log',
      'test-guest: no verdict line in the log',
      'the convention checks: no counts line in the log',
      'the run: no verify summary line in the log',
    ])
  })

  it('passes on the log a real green run produced', () => {
    expect(runVerifiedViolations(read(GREEN), EXPECTED)).toEqual([])
  })

  it('fails when a step it expects is absent, naming that step', () => {
    const missing = withLine(GREEN, 'test-guest ....... PASS  3.0s', 'test-guest built nothing')

    expect(details(runVerifiedViolations(read(missing), EXPECTED))).toEqual([
      'test-guest: no verdict line in the log',
    ])
  })

  // Green and wrong: the run's conclusion is `success`, and two of the checks
  // inside it never ran.
  it('fails when an environment-dependent step skipped, naming the step twice over', () => {
    const skipped = withLine(
      withLine(
        GREEN,
        'test-api ......... PASS  0.7s',
        'test-api ......... SKIP  nothing is listening at 127.0.0.1:55432',
      ),
      'verify: PASS  8.4s',
      'verify: PASS  8.4s  (skipped: test-api)',
    )

    expect(details(runVerifiedViolations(read(skipped), EXPECTED))).toEqual([
      'test-api: SKIP  nothing is listening at 127.0.0.1:55432',
      'the run: steps were skipped: test-api',
    ])
  })

  it('fails on a convention rule that did not pass, naming the rule', () => {
    const skipped = withLine(
      withLine(
        GREEN,
        '  readme-status-date ..... PASS  4 subjects',
        '  readme-status-date ..... SKIP  no commit has changed README.md yet',
      ),
      '4 checks: 4 PASS, 0 FAIL, 0 SKIP',
      '4 checks: 3 PASS, 0 FAIL, 1 SKIP',
    )

    expect(details(runVerifiedViolations(read(skipped), EXPECTED))).toEqual([
      'readme-status-date: SKIP  no commit has changed README.md yet',
      'the convention checks: 4 checks: 3 PASS, 0 FAIL, 1 SKIP',
    ])
  })

  it('fails a convention run that inspected nothing, which reports no failures', () => {
    const empty = withLine(
      GREEN,
      '4 checks: 4 PASS, 0 FAIL, 0 SKIP',
      '0 checks: 0 PASS, 0 FAIL, 0 SKIP',
    )

    expect(details(runVerifiedViolations(read(empty), EXPECTED))).toEqual([
      'the convention checks: inspected nothing: 0 checks: 0 PASS, 0 FAIL, 0 SKIP',
    ])
  })

  // A log that could not be fetched and a log that says nothing look identical
  // to a matcher. Reporting the first as the second sends a reader hunting a
  // broken check when GitHub has simply dropped the log.
  it('fails on a log it could not read by naming that, not the lines it did not find', () => {
    const unreadable: RunLog = { read: false, reason: 'HTTP 410: Gone' }

    expect(details(runVerifiedViolations(unreadable, EXPECTED))).toEqual([
      "the run's log: could not be read: HTTP 410: Gone",
    ])
  })

  // The streaming step prints its child's output and no verdict line of its
  // own. Expecting one would fail every log a real run has ever produced.
  it('expects a verdict line from every step that prints one, and from no other', () => {
    expect(EXPECTED).toEqual([
      'typecheck',
      'typecheck-guest',
      'lint',
      'test-tools',
      'test-api',
      'test-guest',
    ])
    expect(EXPECTED).not.toContain('conventions')
  })

  it('reads a prefixed log and a bare one the same way', () => {
    expect(verdictLines('lint ............. PASS  0.1s')).toEqual([
      { name: 'lint', verdict: 'PASS', detail: '0.1s', indented: false },
    ])
  })
})

// ---------------------------------------------------------------------------

describe('the revision the remote holds', () => {
  const declared = '7a1d0a55f55fae8cda4eb672ec5ded9d58591656'
  const other = '8425908628daced177f50e23227e4cbcc626f165'

  it('passes when the remote holds the revision the declaration names', () => {
    expect(pushArrivedViolations(declared, { present: true, revision: declared })).toEqual([])
  })

  it('fails when it holds another, naming both', () => {
    expect(details(pushArrivedViolations(declared, { present: true, revision: other }))).toEqual([
      `origin refs/heads/main: the remote holds ${other}, the declaration names ${declared}`,
    ])
  })

  // Not an absent dependency. The remote answered, and its answer is no.
  it('fails when the remote has no such ref at all', () => {
    expect(details(pushArrivedViolations(declared, { present: false }))).toEqual([
      `origin refs/heads/main: the remote has no such ref; the declaration names ${declared}`,
    ])
  })
})

// ---------------------------------------------------------------------------

describe('the repository metadata', () => {
  const declared = { description: 'Self-hosted table-side ordering.', topics: ['pnpm', 'vitest'] }

  it('passes when both are as declared', () => {
    expect(metadataViolations({ ...declared }, declared)).toEqual([])
  })

  it('passes when the same topics come back in another order', () => {
    expect(metadataViolations({ ...declared, topics: ['vitest', 'pnpm'] }, declared)).toEqual([])
  })

  it('fails on a description that differs, carrying both', () => {
    const violations = metadataViolations({ ...declared, description: 'Something else.' }, declared)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.where).toBe('description')
    expect(violations[0]?.detail).toContain('declared: Self-hosted table-side ordering.')
    expect(violations[0]?.detail).toContain('remote:   Something else.')
  })

  it('names a topic difference in both directions, absorbing neither', () => {
    const violations = metadataViolations({ ...declared, topics: ['pnpm', 'svelte'] }, declared)

    expect(details(violations)).toEqual([
      'topics: declared, and not on the remote: vitest',
      'topics: on the remote, and not declared: svelte',
    ])
  })
})

// ---------------------------------------------------------------------------

describe('a dependency this check needs and cannot find', () => {
  const reason = 'gh is not installed; see https://cli.github.com'

  it('skips, naming what is missing, and the skip is not a failure', () => {
    const report = skipReport('run-verified', reason, false)

    expect(report).toEqual({
      name: 'run-verified',
      verdict: 'SKIP',
      detail: reason,
      violations: [],
    })
    expect(exitCode([report])).toBe(0)
  })

  it('fails, carrying the same reason, under --require-environment', () => {
    const report = skipReport('run-verified', reason, true)

    expect(report).toEqual({
      name: 'run-verified',
      verdict: 'FAIL',
      detail: reason,
      violations: [],
    })
    expect(exitCode([report])).toBe(1)
  })
})

describe('what a failing check prints', () => {
  it('puts every difference under the line that found it', () => {
    const report: CheckReport = {
      name: 'metadata-declared',
      verdict: 'FAIL',
      detail: '1 difference from the declaration',
      violations: [{ where: 'topics', detail: 'on the remote, and not declared: svelte' }],
    }

    expect(formatCheck(report, 17)).toBe(
      'metadata-declared .. FAIL  1 difference from the declaration\n' +
        '      topics: on the remote, and not declared: svelte',
    )
  })
})

// ---------------------------------------------------------------------------

describe('the arguments', () => {
  const complete = [
    '--revision',
    '7a1d0a5',
    '--description',
    'A description, with a comma.',
    '--topics',
    'pnpm, vitest ,docker',
  ]

  it('reads the three expectations, and the flag off by default', () => {
    expect(parseArgs(complete)).toEqual({
      revision: '7a1d0a5',
      description: 'A description, with a comma.',
      topics: ['pnpm', 'vitest', 'docker'],
      requireEnvironment: false,
    })
  })

  it('reads the flag', () => {
    expect(parseArgs([...complete, '--require-environment'])).toMatchObject({
      requireEnvironment: true,
    })
  })

  // Silently ignoring one would drop an expectation, and a check with nothing
  // to compare against passes.
  it('rejects an argument it does not recognise, rather than ignoring it', () => {
    expect(parseArgs([...complete, '--revison', 'x'])).toEqual({
      error: 'unrecognised argument: --revison',
    })
  })

  it('refuses to run without an expectation to compare against', () => {
    expect(parseArgs(['--revision', '7a1d0a5'])).toEqual({
      error: 'missing required argument: --description',
    })
  })
})
