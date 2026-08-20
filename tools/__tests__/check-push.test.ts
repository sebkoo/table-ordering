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
 *
 * The values these conditions compare are chosen to be able to fail. A pair
 * differing at its first character is told apart by a comparison truncated
 * anywhere, so it establishes nothing about how much of a value was compared.
 * The pairs below differ at the last character, keep their lengths equal, or
 * make one value a proper prefix of the other -- each aimed at the weaker
 * comparison the real one would otherwise be mistaken for.
 */

import { describe, expect, it } from 'vitest'
import {
  type CheckReport,
  exitCode,
  expectedStepNames,
  formatCheck,
  type JobTimes,
  jobSpanSeconds,
  metadataViolations,
  parseArgs,
  pushArrivedViolations,
  type RunLog,
  runVerifiedReport,
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

/**
 * The job times of that same run, read from `gh run view 32298949382 --json
 * jobs`. One run's log beside one run's jobs: a pair the collector really
 * emits, rather than two arguments that merely typecheck together.
 *
 * 2m27s, which is 147 seconds. That run predates ADR 0013, so it is also the
 * only fixture here that carries a duration over a minute -- the case where
 * this file's seconds and `gh`'s own display diverge in form while naming the
 * same duration.
 */
const GREEN_RUN = 32298949382
const GREEN_JOBS: JobTimes[] = [
  { startedAt: '2026-08-19T20:31:06Z', completedAt: '2026-08-19T20:33:33Z' },
]

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

  // A run that failed. The step line is flipped as well as the summary because
  // `verify` derives the second from the first: a log carrying `verify: FAIL`
  // over six passing steps is not a log the collector can produce, and a fixture
  // it cannot produce establishes nothing.
  it('fails on a run whose summary says FAIL, naming the step and the run', () => {
    const failed = withLine(
      withLine(GREEN, 'lint ............. PASS  0.1s', 'lint ............. FAIL  0.1s'),
      'verify: PASS  8.4s',
      'verify: FAIL  8.4s',
    )

    expect(details(runVerifiedViolations(read(failed), EXPECTED))).toEqual([
      'lint: FAIL  0.1s',
      'the run: verify: FAIL  8.4s',
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

/**
 * What the line says when it passes, which until now was written down in
 * README and nowhere else. Both figures were already inside things this check
 * reads -- the elapsed inside the pattern that validates the summary line, the
 * job span one call from the run it had already found -- and both were being
 * fetched by hand after every commit instead.
 */
describe('the timings a passing run reports', () => {
  it('carries the run, the line count, the elapsed and the job span', () => {
    const report = runVerifiedReport(GREEN_RUN, read(GREEN), GREEN_JOBS, EXPECTED)

    expect(report.verdict).toBe('PASS')
    expect(report.detail).toBe(
      'run 32298949382, 10 verdict lines, all PASS, verify: 8.4s in 147s of jobs',
    )
  })

  // The elapsed is read from the log rather than assumed. The rewritten figure
  // keeps the original's length and differs at its last character, so neither a
  // length check nor a comparison truncated anywhere tells the two apart.
  it('takes the elapsed from the log it was given', () => {
    const slower = withLine(GREEN, 'verify: PASS  8.4s', 'verify: PASS  8.5s')

    expect(runVerifiedReport(GREEN_RUN, read(slower), GREEN_JOBS, EXPECTED).detail).toBe(
      'run 32298949382, 10 verdict lines, all PASS, verify: 8.5s in 147s of jobs',
    )
  })

  // Two integer digits, which is what a real run prints today. A pattern
  // assuming one would pass the fixture above and fail every current log.
  it('reads an elapsed figure wider than the one in the fixture', () => {
    const wider = withLine(GREEN, 'verify: PASS  8.4s', 'verify: PASS  10.7s')

    expect(runVerifiedReport(GREEN_RUN, read(wider), GREEN_JOBS, EXPECTED).detail).toBe(
      'run 32298949382, 10 verdict lines, all PASS, verify: 10.7s in 147s of jobs',
    )
  })

  // A figure that cannot be had is a violation, never a clause left off a PASS
  // line. The line would otherwise read as a complete report of a green run.
  it('fails when gh reported no jobs, rather than dropping the span', () => {
    const report = runVerifiedReport(GREEN_RUN, read(GREEN), [], EXPECTED)

    expect(report.verdict).toBe('FAIL')
    expect(details([...report.violations])).toEqual([
      'run 32298949382: gh reported no jobs for this run',
    ])
  })

  it('fails on a job timestamp that is not a date, naming both ends', () => {
    const report = runVerifiedReport(
      GREEN_RUN,
      read(GREEN),
      [{ startedAt: '2026-08-19T20:31:06Z', completedAt: '' }],
      EXPECTED,
    )

    expect(details([...report.violations])).toEqual([
      'run 32298949382: a job timestamp gh returned is not a date: 2026-08-19T20:31:06Z to ',
    ])
  })

  // The span's violation joins the log's rather than replacing them. Reporting
  // one at a time would send a reader round the loop twice.
  it('reports a log difference and a span difference together', () => {
    const missing = withLine(GREEN, 'lint ............. PASS  0.1s', 'lint built nothing')

    expect(
      details([...runVerifiedReport(GREEN_RUN, read(missing), [], EXPECTED).violations]),
    ).toEqual([
      'lint: no verdict line in the log',
      'run 32298949382: gh reported no jobs for this run',
    ])
  })
})

describe('how long the jobs of a run took', () => {
  // The pair gh itself reports as 2m27s, and the pair it reports as 52s.
  it('measures a single job as gh reports it', () => {
    expect(jobSpanSeconds(GREEN_JOBS)).toEqual({ ok: true, seconds: 147 })
    expect(
      jobSpanSeconds([{ startedAt: '2026-08-20T20:48:56Z', completedAt: '2026-08-20T20:49:48Z' }]),
    ).toEqual({ ok: true, seconds: 52 })
  })

  // Earliest start to latest completion. The jobs overlap and neither one spans
  // the whole: a first-job answer gives 30, a sum gives 70, and the run took 50.
  it('spans every job, taking neither the first nor the sum', () => {
    expect(
      jobSpanSeconds([
        { startedAt: '2026-08-20T20:00:00Z', completedAt: '2026-08-20T20:00:30Z' },
        { startedAt: '2026-08-20T20:00:10Z', completedAt: '2026-08-20T20:00:50Z' },
      ]),
    ).toEqual({ ok: true, seconds: 50 })
  })
})

// ---------------------------------------------------------------------------

describe('the revision the remote holds', () => {
  const declared = '7a1d0a55f55fae8cda4eb672ec5ded9d58591656'
  /**
   * The same revision but for its last character, derived rather than typed out
   * so that the shared prefix cannot decay under a later edit. Two revisions
   * differing at their first character are told apart by a comparison truncated
   * anywhere, which would leave the condition below green over one that reads
   * seven characters of forty.
   */
  const other = `${declared.slice(0, -1)}7`
  /** What `git rev-parse --short` prints: a proper prefix of the whole thing. */
  const abbreviated = declared.slice(0, 7)

  it('passes when the remote holds the revision the declaration names', () => {
    expect(pushArrivedViolations(declared, { present: true, revision: declared })).toEqual([])
  })

  it('fails when it holds another, naming both', () => {
    expect(details(pushArrivedViolations(declared, { present: true, revision: other }))).toEqual([
      `origin refs/heads/main: the remote holds ${other}, the declaration names ${declared}`,
    ])
  })

  // The decision this fixture makes, rather than lets a test settle in silence:
  // an abbreviation never matches. `git rev-parse` prints forty characters and
  // the procedure says to pass what it printed, and a comparison lenient enough
  // to accept a short revision is a prefix comparison -- which is the thing the
  // fixture above exists to forbid. Resolving the argument before comparing it
  // would be a third answer, neither taken here nor foreclosed.
  it('fails on a revision the declaration abbreviated', () => {
    expect(
      details(pushArrivedViolations(abbreviated, { present: true, revision: declared })),
    ).toEqual([
      `origin refs/heads/main: the remote holds ${declared}, the declaration names ${abbreviated}`,
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

  // The declared description survives whole inside the remote's, so a
  // `startsWith` or an `includes` calls the two equal. Asserting the whole
  // message rather than its length makes the failure print the violation the
  // weakened comparison should have produced.
  it('fails on a description the remote extended, carrying both', () => {
    const remote = `${declared.description} And more.`

    expect(details(metadataViolations({ ...declared, description: remote }, declared))).toEqual([
      `description: declared: ${declared.description}\n        remote:   ${remote}`,
    ])
  })

  // The other direction, because one fixture cannot defeat both: a remote that
  // extends the declared description survives a reversed prefix test, and one
  // that truncates it survives the forward one.
  it('fails on a description the remote truncated, carrying both', () => {
    const remote = declared.description.slice(0, -10)

    expect(details(metadataViolations({ ...declared, description: remote }, declared))).toEqual([
      `description: declared: ${declared.description}\n        remote:   ${remote}`,
    ])
  })

  // Two differences in each direction rather than one. With a single difference
  // either way, an implementation reporting only the first would pass this and
  // the condition would establish nothing about the loop. Equal lengths keep the
  // length-for-content weakening defeated, and the shared topic keeps the set
  // comparison exercised.
  it('names every topic difference in both directions, absorbing none', () => {
    const violations = metadataViolations(
      { ...declared, topics: ['pnpm', 'svelte', 'astro'] },
      { ...declared, topics: ['pnpm', 'vitest', 'docker'] },
    )

    expect(details(violations)).toEqual([
      'topics: declared, and not on the remote: vitest',
      'topics: declared, and not on the remote: docker',
      'topics: on the remote, and not declared: svelte',
      'topics: on the remote, and not declared: astro',
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
