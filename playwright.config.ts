import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 5173);

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/firebase.spec.ts',
  fullyParallel: false,
  // A cold precon library uses the rate-limited API before the table is ready.
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
  },
});
