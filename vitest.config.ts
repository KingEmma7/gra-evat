import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/*/src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/__tests__/**', '**/types.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 90 },
    },
  },
});
