import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tools/__tests__/**/*.test.ts',
      'services/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    // The tool suites shell out to git and write real temporary trees, and the
    // service suites talk to a real database over a real socket, so give them
    // room without letting a hung child process stall the whole run.
    testTimeout: 30_000,
    // The guest page's suite builds the client, spawns the API and launches a
    // browser before its first assertion, all in one hook. Ten seconds, the
    // default, is a timeout on the setup rather than on anything being tested.
    hookTimeout: 120_000,
  },
})
