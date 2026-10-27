import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseVersion(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
export function nextVersion(base, tags) {
  const start = parseVersion(base);
  if (!start) throw new Error(`Invalid base version: ${base}`);
  const highest = tags.map(parseVersion).filter(Boolean).reduce((a, b) => !a || compareVersions(a, b) < 0 ? b : a, null);
  if (!highest || compareVersions(start, highest) > 0) return start.join('.');
  return `${highest[0]}.${highest[1]}.${highest[2] + 1}`;
}
export function selectRelease(base, tags, releases, sha) {
  const existing = releases.filter(release => !release.prerelease && /^v/.test(release.tag_name)
    && parseVersion(release.tag_name) && tags.includes(release.tag_name) && release.commit === sha)
    .sort((a, b) => compareVersions(parseVersion(b.tag_name), parseVersion(a.tag_name)))[0];
  const version = existing ? existing.tag_name.slice(1) : nextVersion(base, tags);
  return { version, tag: `v${version}`, complete: Boolean(existing && !existing.draft) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = process.env.GITHUB_SHA;
  if (!sha || !process.env.GITHUB_OUTPUT || !process.env.GH_REPO) throw new Error('Missing GitHub environment');
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split(/\r?\n/).filter(tag => /^v/.test(tag) && parseVersion(tag));
  const releases = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${process.env.GH_REPO}/releases?per_page=100`], { encoding: 'utf8' })).flat();
  const candidates = releases.filter(release => tags.includes(release.tag_name)).map(release => ({
    ...release, commit: execFileSync('git', ['rev-list', '-n', '1', release.tag_name], { encoding: 'utf8' }).trim(),
  }));
  const selected = selectRelease(JSON.parse(readFileSync('package.json', 'utf8')).version, tags, candidates, sha);
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${selected.version}\ntag=${selected.tag}\ncomplete=${selected.complete}\n`);
}
