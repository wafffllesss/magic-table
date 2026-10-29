const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const config = require('../electron-builder.cjs');
const { prepareLegalNotices } = require('./prepare-legal-notices.cjs');

const root = path.resolve(__dirname, '..');
// electron-builder merges configuration in place while resolving the build.
const output = path.resolve(root, config.directories.output);

async function publishExecutable(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try { await fs.copyFile(source, destination); return; }
    catch (error) {
      if (attempt >= 9 || !['EBUSY', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

async function main() {
  // Windows can deny renaming Electron's extracted directory inside a checkout.
  // Stage in the system temp directory and publish only the completed executable.
  await prepareLegalNotices();
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'meu-magic-build-'));
  try {
    const artifacts = await build({
      projectDir: root,
      targets: Platform.WINDOWS.createTarget('portable', Arch.x64),
      publish: 'never',
      config: { ...config, directories: { ...config.directories, output: staging } },
    });
    const executables = artifacts.filter(file => file.endsWith('.exe'));
    if (executables.length !== 1) throw new Error('Expected one portable executable.');
    await fs.mkdir(output, { recursive: true });
    const artifact = path.join(output, path.basename(executables[0]));
    await publishExecutable(executables[0], artifact);
    console.log(`Portable executable: ${artifact}`);
  } finally {
    if (path.dirname(staging) !== path.resolve(os.tmpdir()) || !path.basename(staging).startsWith('meu-magic-build-')) {
      throw new Error('Unexpected build staging directory.');
    }
    await fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
