import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['dotenv/config'],
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
