module.exports = {
  appId: 'com.meumagic.desktop',
  asar: true,
  directories: { output: 'out/portable' },
  files: [
    'dist/**/*',
    'electron/main.cjs',
    'electron/preload.cjs',
    'electron/updates.cjs',
    'electron/mcp-server.bundle.cjs',
    'package.json',
    // Vite bundles renderer dependencies; main and preload only use Electron/Node.
    '!node_modules/**/*',
  ],
  extraResources: [{ from: 'out/legal', to: 'legal' }],
  npmRebuild: false,
  win: {
    artifactName: 'MeuMagic-${version}-${arch}.zip',
    executableName: 'meu-magic',
    icon: 'electron/meu-magic.ico',
    // Ship the runtime directly, without an NSIS self-extracting launcher.
    target: [{ target: 'zip', arch: ['x64'] }],
  },
};
