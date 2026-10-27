import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('firebase-tools/lib/bin/firebase.js'),
  'emulators:exec', '--only', 'auth,database', '--project', 'demo-magic-table',
  'playwright test --config playwright.firebase.config.ts',
], {
  stdio: 'inherit',
  env: { ...process.env },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
