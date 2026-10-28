import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'turn-worker/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
  },
});
