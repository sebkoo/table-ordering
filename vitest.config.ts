import { defineConfig } from 'vitest/config'

/**
 * Three projects, split by what a suite needs outside this repository rather
 * than by what it is about. `tools` needs nothing; `api` needs a PostgreSQL;
 * `guest` needs a PostgreSQL and a browser. `pnpm verify` runs one step per
 * project so that an absent database skips the two suites that cannot run
 * without it and leaves the rest reporting for themselves.
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
      include: ['apps/*/src/**/*.test.ts'],
      testTimeout: 30_000,
      // This suite builds the client, spawns the API and launches a browser
      // before its first assertion, all in one hook. Ten seconds, the default,
      // is a timeout on the setup rather than on anything being tested.
      hookTimeout: 120_000,
    },
  },
]

export default defineConfig({ test: { projects } })
