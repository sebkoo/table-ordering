import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tools/__tests__/**/*.test.ts'],
    // Each suite shells out to git and writes real temporary trees, so give
    // them room without letting a hung child process stall the whole run.
    testTimeout: 30_000,
  },
})
