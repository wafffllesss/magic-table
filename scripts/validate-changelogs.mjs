import { readdirSync, readFileSync } from 'node:fs';
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('A release version is required.');
const files = readdirSync('changelogs');
const versions = new Set(files.map(file => /^(\d+\.\d+\.\d+)\.(?:en|pt-BR)\.md$/.exec(file)?.[1]).filter(Boolean));
if (versions.size > 10) throw new Error('Keep at most ten changelog versions.');
for (const item of versions) for (const locale of ['en', 'pt-BR']) {
  const file = `changelogs/${item}.${locale}.md`;
  const content = readFileSync(file, 'utf8');
  if (!/^# Features\s*$/m.test(content) || !/^# Fixes and adjustments\s*$/m.test(content)) throw new Error(`${file} must contain both changelog sections.`);
}
if (!versions.has(version)) throw new Error(`Missing changelog for ${version}.`);
