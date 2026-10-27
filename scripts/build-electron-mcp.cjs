const path = require('node:path');
const { build } = require('esbuild');

build({
  entryPoints: [path.resolve(__dirname, '../electron/mcp-server.cjs')],
  outfile: path.resolve(__dirname, '../electron/mcp-server.bundle.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
}).catch(error => { console.error(error); process.exitCode = 1; });
