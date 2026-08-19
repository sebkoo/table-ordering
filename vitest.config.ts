import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tools/__tests__/**/*.test.ts', 'services/*/src/**/*.test.ts'],
    // The tool suites shell out to git and write real temporary trees, and the
    // service suites talk to a real database over a real socket, so give them
    // room without letting a hung child process stall the whole run.
    testTimeout: 30_000,
  },
})
