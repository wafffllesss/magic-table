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
    executableName: 'meu-magic',
    icon: 'electron/meu-magic.ico',
    target: [{ target: 'portable', arch: ['x64'] }],
  },
  portable: {
    artifactName: 'MeuMagic-${version}-${arch}.exe',
    requestExecutionLevel: 'user',
    // Concurrent launches must not overwrite each other's extracted runtime.
    unpackDirName: false,
  },
};
