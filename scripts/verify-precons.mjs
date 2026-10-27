// Optional integration check against live Scryfall. Uses memory-only storage.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
// Browsers supply their own User-Agent; the Node verification client must identify itself.
const fetchRemote = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', 'MeuMagic/0.1 (precon catalogue verification)');
  return fetchRemote(url, { ...init, headers });
};
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, watch: { ignored: ['**/*'] }, hmr: false } });
try {
  const { getStarterDecks } = await server.ssrLoadModule('/src/services/starters.ts');
  const result = await getStarterDecks();
  if (result.warning || result.decks.length !== 30) throw new Error(result.warning ?? 'Expected 30 precons');
  for (const deck of result.decks) console.log(`${deck.name}: ${deck.entries.reduce((sum, entry) => sum + entry.quantity, 0)} cards; validated with live Scryfall`);
} finally { await server.close(); }
