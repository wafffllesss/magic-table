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
