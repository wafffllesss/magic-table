import { createRemoteJWKSet, jwtVerify } from 'jose';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Cache-Control': 'no-store' };
const reply = (body, status) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export async function handleRequest(request, env, deps = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const token = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token || token.length > 8192) return reply({ error: 'Unauthorized' }, 401);
  let uid;
  try {
    const verify = deps.verify ?? ((value, project) => jwtVerify(value, keys, { algorithms: ['RS256'], audience: project, issuer: `https://securetoken.google.com/${project}` }));
    const { payload } = await verify(token, env.FIREBASE_PROJECT_ID);
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub) || !Number.isFinite(payload.exp) || payload.exp <= now || !Number.isFinite(payload.iat) || payload.iat > now || !Number.isFinite(payload.auth_time) || payload.auth_time > now) throw new Error('Invalid identity');
    uid = payload.sub;
  } catch { return reply({ error: 'Unauthorized' }, 401); }
  let body;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request' }, 400); }
  const room = body?.roomId;
  if (typeof room !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(room)) return reply({ error: 'Invalid request' }, 400);
  try {
    const database = new URL(env.FIREBASE_DATABASE_URL);
    if (database.protocol !== 'https:' || !/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(database.hostname) || database.pathname !== '/' || database.search || database.hash || database.port || database.username || database.password) throw new Error('Invalid configuration');
    if (!/^[A-Za-z0-9_-]+$/.test(env.CLOUDFLARE_TURN_KEY_ID ?? '') || !env.CLOUDFLARE_TURN_API_TOKEN) throw new Error('Invalid configuration');
    const fetcher = deps.fetch ?? fetch;
    const read = async path => {
      const url = new URL(`/p2pRooms/${room}/${path}.json`, database);
      url.searchParams.set('auth', token);
      const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error('Database unavailable');
      return response.json();
    };
    const [member, meta] = await Promise.all([read(`members/${uid}`), read('meta')]);
    if (!member || !meta || meta.closed !== false) return reply({ error: 'Forbidden' }, 403);
    const expiresAt = Date.now() + 3600000;
    const response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 3600 }), signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('TURN unavailable');
    const data = await response.json();
    if (!Array.isArray(data?.iceServers)) throw new Error('Invalid response');
    const iceServers = [];
    for (const entry of data.iceServers) {
      const urls = typeof entry?.urls === 'string' ? [entry.urls] : entry?.urls;
      if (!Array.isArray(urls) || !urls.length || !urls.every(url => typeof url === 'string')) throw new Error('Invalid response');
      const turnUrls = urls.filter(url => /^turns?:turn\.cloudflare\.com:\d+\?transport=(udp|tcp)$/.test(url));
      if (turnUrls.length !== urls.filter(url => url !== 'stun:stun.cloudflare.com:3478').length) throw new Error('Invalid response');
      if (!turnUrls.length) continue;
      if (typeof entry.username !== 'string' || !entry.username || typeof entry.credential !== 'string' || !entry.credential) throw new Error('Invalid response');
      iceServers.push({ urls: turnUrls, username: entry.username, credential: entry.credential });
    }
    if (!iceServers.length || expiresAt <= Date.now()) throw new Error('Invalid response');
    return reply({ iceServers, expiresAt }, 200);
  } catch { return reply({ error: 'TURN unavailable' }, 503); }
}

export default { fetch: handleRequest };
