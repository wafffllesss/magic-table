import { pathToFileURL } from 'node:url';

const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_DATABASE_URL', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];

export function validateReleaseEnvironment(env) {
  if (env.PUBLICATION_APPROVED !== 'true') throw new Error('PUBLICATION_APPROVED must be true after the third-party rights and security review.');
  const missing = required.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing required GitHub variables: ${missing.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { validateReleaseEnvironment(process.env); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
