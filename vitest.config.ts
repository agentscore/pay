import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['dotenv/config'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: [
        'dist/**',
        'tests/**',
        'src/cli.ts',
        'src/commands/**',
        'src/index.ts',
        'src/prompts.ts',
        'src/wallets.ts',
        'src/mnemonic-store.ts',
        'vitest.config.ts',
        'vitest.integration.config.ts',
        'tsup.config.ts',
        'eslint.config.mjs',
      ],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 90,
      },
    },
  },
});
