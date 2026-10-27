import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const host = env.VITE_FIREBASE_EMULATOR_HOST;
  const emulatorOrigins = host ? [
    `http://${host}:${env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099}`,
    `http://${host}:${env.VITE_FIREBASE_DATABASE_EMULATOR_PORT || 9000}`,
    `ws://${host}:${env.VITE_FIREBASE_DATABASE_EMULATOR_PORT || 9000}`,
  ].join(' ') : '';
  const databaseScriptOrigins = [
    env.VITE_FIREBASE_DATABASE_URL,
    host ? `http://${host}:${env.VITE_FIREBASE_DATABASE_EMULATOR_PORT || 9000}` : '',
    // Realtime Database may redirect long-poll requests to a regional host.
    'https://*.firebaseio.com',
    'https://*.firebasedatabase.app',
  ].flatMap(value => {
    if (!value) return [];
    if (value.includes('*')) return [value];
    try { return [new URL(value).origin]; } catch { return []; }
  });
  return {
    plugins: [vue(), {
      name: 'firebase-connections-csp',
      transformIndexHtml(html) {
        const scriptSources = [...new Set(databaseScriptOrigins)].join(' ');
        let transformed = html.replace("script-src 'self'", `script-src 'self'${scriptSources ? ` ${scriptSources}` : ''}`);
        if (emulatorOrigins) transformed = transformed.replace("connect-src 'self'", `connect-src 'self' ${emulatorOrigins}`);
        return transformed;
      },
    }],
    base: './',
    server: { host: true, watch: { ignored: ['**/test-results*/**', '**/playwright-report/**', '**/.cache/**'] } },
    build: { target: 'es2022' },
  };
});
