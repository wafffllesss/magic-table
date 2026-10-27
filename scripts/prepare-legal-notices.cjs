const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

async function findPackage(name, from) {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    try { await fs.access(candidate); return path.dirname(candidate); } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Cannot locate ${name} from ${from}`);
    dir = parent;
  }
}

async function prepareLegalNotices() {
  const output = path.join(root, 'out', 'legal');
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(output, 'LICENSE.txt'));
  await fs.copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(output, 'THIRD_PARTY_NOTICES.md'));
  // Include all runtime dependency licenses, including transitive dependencies.
  const queue = Object.keys(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).dependencies)
    .map(name => ({ name, from: root }));
  const visited = new Set();
  const notices = [];
  while (queue.length) {
    const { name, from } = queue.shift();
    const dir = await fs.realpath(await findPackage(name, from));
    if (visited.has(dir)) continue;
    visited.add(dir);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    const files = (await fs.readdir(dir)).filter(file => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(file)).sort();
    const fallback = pkg.license === 'Apache-2.0' ? 'Apache-2.0.txt'
      : pkg.name === '@vue/devtools-api' && pkg.version === '6.6.4' ? 'vue-devtools-MIT.txt' : null;
    if (!files.length && !fallback) throw new Error(`No license or notice file found for ${pkg.name}@${pkg.version}`);
    const texts = files.length
      ? await Promise.all(files.map(async file => `--- ${file} ---\n${await fs.readFile(path.join(dir, file), 'utf8')}`))
      : [await fs.readFile(path.join(root, 'licenses', fallback), 'utf8')];
    notices.push(`${pkg.name}@${pkg.version} (${pkg.license || 'see notices'})\n${texts.join('\n\n')}`);
    for (const dependency of Object.keys(pkg.dependencies || {})) queue.push({ name: dependency, from: dir });
  }
  notices.sort();
  await fs.writeFile(path.join(output, 'DEPENDENCY_LICENSES.txt'), notices.join('\n\n====================\n\n'));
  const electronDir = path.join(root, 'node_modules', 'electron', 'dist');
  await fs.copyFile(path.join(electronDir, 'LICENSE'), path.join(output, 'ELECTRON_LICENSE.txt'));
  await fs.copyFile(path.join(electronDir, 'LICENSES.chromium.html'), path.join(output, 'CHROMIUM_LICENSES.html'));
}

module.exports = { prepareLegalNotices };
if (require.main === module) prepareLegalNotices().catch(error => { console.error(error); process.exitCode = 1; });
