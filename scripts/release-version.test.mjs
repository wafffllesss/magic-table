import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion, parseVersion, selectRelease } from './release-version.mjs';
import { validateReleaseEnvironment } from './release-prerequisites.mjs';

test('increments the highest stable version and ignores unrelated tags', () => {
  assert.equal(nextVersion('0.0.3', []), '0.0.3');
  assert.equal(nextVersion('0.0.2', ['v0.0.9', 'v0.1.0', 'v3.0.0-rc.1', 'other']), '0.1.1');
  assert.equal(nextVersion('1.2.3', ['v1.2.2']), '1.2.3');
  assert.equal(nextVersion('1.2.3', ['v1.2.3']), '1.2.4');
  assert.equal(parseVersion('v01.2.3'), null);
  assert.throws(() => nextVersion('invalid', []));
});

test('requires the publication gate and the complete public Firebase configuration', () => {
  const env = { PUBLICATION_APPROVED: 'true', VITE_FIREBASE_API_KEY: 'demo', VITE_FIREBASE_AUTH_DOMAIN: 'demo', VITE_FIREBASE_DATABASE_URL: 'demo', VITE_FIREBASE_PROJECT_ID: 'demo', VITE_FIREBASE_APP_ID: 'demo' };
  assert.doesNotThrow(() => validateReleaseEnvironment(env));
  assert.throws(() => validateReleaseEnvironment({ ...env, PUBLICATION_APPROVED: '' }), /PUBLICATION_APPROVED/);
  assert.throws(() => validateReleaseEnvironment({ ...env, VITE_FIREBASE_APP_ID: ' ' }), /VITE_FIREBASE_APP_ID/);
});

test('resumes the same draft and does not duplicate a completed release', () => {
  const draft = { tag_name: 'v0.0.3', commit: 'abc', draft: true, prerelease: false };
  assert.deepEqual(selectRelease('0.0.2', ['v0.0.3'], [draft], 'abc'), { version: '0.0.3', tag: 'v0.0.3', complete: false });
  assert.deepEqual(selectRelease('0.0.2', ['v0.0.3'], [{ ...draft, draft: false }], 'abc'), { version: '0.0.3', tag: 'v0.0.3', complete: true });
  assert.deepEqual(selectRelease('0.0.2', ['v0.0.3'], [draft], 'def'), { version: '0.0.4', tag: 'v0.0.4', complete: false });
});
