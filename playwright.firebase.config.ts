import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/firebase.spec.ts', workers: 1, timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://127.0.0.1:5175', locale: 'pt-BR', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5175 --strictPort', url: 'http://127.0.0.1:5175', reuseExistingServer: false,
    env: {
      VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-magic-table.firebaseapp.com',
      VITE_FIREBASE_DATABASE_URL: 'https://demo-magic-table.firebaseio.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-magic-table', VITE_FIREBASE_APP_ID: 'demo-app', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
      VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099', VITE_FIREBASE_DATABASE_EMULATOR_PORT: '9000',
    },
  },
});
