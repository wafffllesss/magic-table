const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkForUpdate, releaseUrl } = require('./updates.cjs');
const valid = { tag_name: 'v1.10.0', html_url: 'https://github.com/wafffllesss/magic-table/releases/tag/v1.10.0', draft: false, prerelease: false };
const reply = value => async () => ({ ok: true, json: async () => value });
test('compares numeric stable versions and validates release URL', async () => {
  assert.equal((await checkForUpdate('1.9.9', reply(valid))).version, '1.10.0');
  assert.equal(await checkForUpdate('1.10.0', reply(valid)), null);
  assert.equal(await checkForUpdate('2.0.0', reply(valid)), null);
  assert.equal(await checkForUpdate('invalid', reply(valid)), null);
  for (const release of [{ ...valid, prerelease: true }, { ...valid, draft: true }, { ...valid, tag_name: 'v1.10.0-rc.1' }, { ...valid, html_url: 'https://evil.example/file' }]) assert.equal(await checkForUpdate('1.0.0', reply(release)), null);
  assert.equal(releaseUrl('https://github.com.evil.example/wafffllesss/magic-table/releases/tag/v1.10.0', 'v1.10.0'), false);
});
test('network errors, rate limits and aborts do not block startup', async () => {
  assert.equal(await checkForUpdate('1.0.0', async () => { throw Error('offline'); }), null);
  assert.equal(await checkForUpdate('1.0.0', async () => ({ ok: false, status: 403 })), null);
  assert.equal(await checkForUpdate('1.0.0', (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')))), 5), null);
});

test('loads only matching release assets and keeps download available when a note fails', async () => {
  const asset = locale => ({ name: `1.10.0.${locale}.md`, browser_download_url: `https://github.com/wafffllesss/magic-table/releases/download/v1.10.0/1.10.0.${locale}.md` });
  const release = { ...valid, assets: [asset('en'), asset('pt-BR')] };
  const result = await checkForUpdate('1.0.0', async url => {
    if (url.includes('/releases/latest')) return { ok: true, json: async () => release };
    if (url.endsWith('.pt-BR.md')) throw Error('offline');
    return { ok: true, text: async () => '# Features\n- New' };
  });
  assert.deepEqual(result.notes, { en: '# Features\n- New' });
  assert.equal(result.url, valid.html_url);
  release.assets[0].browser_download_url = 'https://evil.example/notes';
  const invalid = await checkForUpdate('1.0.0', async url => url.includes('/releases/latest') ? { ok: true, json: async () => release } : { ok: false });
  assert.deepEqual(invalid.notes, {});
});
