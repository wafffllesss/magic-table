const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const electron = require('electron');
const devUrl = 'http://127.0.0.1:5173';
const vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'inherit' });
let desktop;
let stopping = false;

function waitForVite(attempt = 0) {
  if (stopping || attempt > 100) return shutdown(1);
  const request = http.get(`${devUrl}/`, response => {
    response.resume();
    if (response.statusCode && response.statusCode < 500) {
      desktop = spawn(electron, ['.'], { cwd: root, env: { ...process.env, MEU_MAGIC_DEV_SERVER_URL: devUrl }, stdio: 'inherit' });
      desktop.on('exit', code => shutdown(code ?? 0));
    } else setTimeout(() => waitForVite(attempt + 1), 250);
  });
  request.on('error', () => setTimeout(() => waitForVite(attempt + 1), 250));
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  if (desktop && !desktop.killed) desktop.kill();
  if (!vite.killed) vite.kill();
  process.exitCode = code;
}

vite.on('exit', code => { if (!stopping && code) shutdown(code); });
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
waitForVite();
