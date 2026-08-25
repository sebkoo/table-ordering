import { defineConfig } from 'vitest/config'

/**
 * Four projects, split by what a suite needs outside this repository rather
 * than by what it is about. `tools` needs nothing; `api` needs a PostgreSQL;
 * `guest` and `staff` each need a PostgreSQL and a browser. `pnpm verify` runs
 * one step per project so that an absent database skips the suites that cannot
 * run without it and leaves the rest reporting for themselves.
 *
 * `guest` and `staff` need the same two things, and they are still two projects.
 * The rule above says what makes a split necessary, not what makes one
 * forbidden: a project of its own is what gives each page suite a step line, a
 * per-file report and a probe reason that names the workspace it belongs to, and
 * folding them together would have meant renaming a step every log in this
 * repository's history carries.
 *
 * The list is exported because the verify step table is checked against it: a
 * project claimed by no step would still run under `pnpm test` and in no step
 * of `pnpm verify`, and the run would report PASS for suites nobody executed.
 */
export const projects = [
  {
    test: {
      name: 'tools',
      environment: 'node' as const,
      include: ['tools/__tests__/**/*.test.ts'],
      // The tool suites shell out to git and write real temporary trees, so
      // give them room without letting a hung child process stall the run.
      testTimeout: 30_000,
    },
  },
  {
    test: {
      name: 'api',
      environment: 'node' as const,
      include: ['services/*/src/**/*.test.ts'],
      // A real database over a real socket.
      testTimeout: 30_000,
    },
  },
  {
    test: {
      name: 'guest',
      environment: 'node' as const,
      // This workspace and no other. The glob was `apps/*` while there was one
      // app, and a second app inheriting it would have run in a step named after
      // the first.
      include: ['apps/guest/src/**/*.test.ts'],
      testTimeout: 30_000,
      // This suite builds the client, spawns the API and launches a browser
      // before its first assertion, all in one hook. Ten seconds, the default,
      // is a timeout on the setup rather than on anything being tested.
      hookTimeout: 120_000,
    },
  },
  {
    test: {
      name: 'staff',
      environment: 'node' as const,
      include: ['apps/staff/src/**/*.test.ts'],
      testTimeout: 30_000,
      // As `guest`, and one thing more: this suite runs the credential mint and
      // then verifies what it minted once per condition, which is a memory-hard
      // derivation each time and deliberately slow.
      hookTimeout: 120_000,
    },
  },
]

export default defineConfig({ test: { projects } })
