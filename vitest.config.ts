import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/security/**/*.test.ts', 'tests/certification/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
