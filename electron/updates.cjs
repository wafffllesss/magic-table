const RELEASE_API = 'https://api.github.com/repos/wafffllesss/magic-table/releases/latest';
const RELEASE_PREFIX = '/wafffllesss/magic-table/releases/tag/';
function parseVersion(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
function releaseUrl(value, tag) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === RELEASE_PREFIX + tag;
  } catch { return false; }
}
async function checkForUpdate(currentVersion, fetcher = fetch, timeout = 8000) {
  const current = parseVersion(currentVersion);
  if (!current) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(RELEASE_API, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return null;
    const release = await response.json();
    if (release.draft || release.prerelease || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) return null;
    const latest = parseVersion(release.tag_name);
    if (!latest || !releaseUrl(release.html_url, release.tag_name)) return null;
    const comparison = latest.findIndex((part, index) => part !== current[index]);
    if (comparison < 0 || latest[comparison] < current[comparison]) return null;
    return { currentVersion, version: release.tag_name.slice(1), url: release.html_url };
  } catch { return null; } finally { clearTimeout(timer); }
}
module.exports = { checkForUpdate, releaseUrl, parseVersion };
