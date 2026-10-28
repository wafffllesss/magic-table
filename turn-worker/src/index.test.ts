import { generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Worker module is JavaScript
import { handleRequest } from './index.js';

const env = { FIREBASE_PROJECT_ID: 'project', FIREBASE_DATABASE_URL: 'https://project.firebaseio.com', CLOUDFLARE_TURN_KEY_ID: 'key', CLOUDFLARE_TURN_API_TOKEN: 'private-secret' };
const turn = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'user', credential: 'password' }] };
let privateKey: CryptoKey, publicKey: CryptoKey;
beforeAll(async () => { ({ privateKey, publicKey } = await generateKeyPair('RS256')); });
const sign = (opts: { expired?: boolean; aud?: string } = {}) => new SignJWT({ auth_time: Math.floor(Date.now() / 1000) - 1 })
  .setProtectedHeader({ alg: 'RS256' }).setSubject('user123').setAudience(opts.aud ?? 'project').setIssuer('https://securetoken.google.com/project').setIssuedAt().setExpirationTime(opts.expired ? '-1s' : '1h').sign(privateKey);
const verify = (token: string, project: string) => jwtVerify(token, publicKey, { algorithms: ['RS256'], audience: project, issuer: `https://securetoken.google.com/${project}` });
const request = (token: string) => new Request('https://worker.example/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: 'room1234' }) });
function fetchMock(member: unknown = { uid: 'user123' }, meta: unknown = { closed: false }, response: unknown = turn) {
  return vi.fn(async (url: string) => url.includes('/members/') ? Response.json(member) : url.includes('/meta.json') ? Response.json(meta) : Response.json(response));
}

describe('TURN Worker', () => {
  it('validates identity and membership and returns Cloudflare credentials with conservative expiry', async () => {
    const fetch = fetchMock(), token = await sign(), before = Date.now();
    const response = await handleRequest(request(token), env, { fetch, verify });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.iceServers).toEqual([turn.iceServers[1]]);
    expect(data.expiresAt).toBeGreaterThanOrEqual(before + 3600000);
    expect(data.expiresAt).toBeLessThanOrEqual(Date.now() + 3600000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toContain(`auth=${token}`);
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', body: '{"ttl":3600}' });
  });
  it('ignores additional Cloudflare STUN URLs without discarding TURN credentials', async () => {
    const response = await handleRequest(request(await sign()), env, { verify, fetch: fetchMock({ uid: 'user123' }, { closed: false }, { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:443'] }, turn.iceServers[1]] }) });
    expect(response.status).toBe(200);
    expect((await response.json()).iceServers).toEqual([turn.iceServers[1]]);
  });
  it('rejects invalid, expired and wrongly addressed tokens before database access', async () => {
    const otherKey = await generateKeyPair('RS256');
    const forged = await new SignJWT({ auth_time: Math.floor(Date.now() / 1000) }).setProtectedHeader({ alg: 'RS256' }).setSubject('user123').setAudience('project').setIssuer('https://securetoken.google.com/project').setIssuedAt().setExpirationTime('1h').sign(otherKey.privateKey);
    for (const token of ['invalid', forged, await sign({ expired: true }), await sign({ aud: 'other' })]) {
      const fetch = fetchMock();
      expect((await handleRequest(request(token), env, { fetch, verify })).status).toBe(401);
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it('returns unavailable if Cloudflare request times out', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/members/')) return Response.json({ uid: 'user123' });
      if (url.includes('/meta.json')) return Response.json({ closed: false });
      return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('private-secret'))));
    });
    const pending = handleRequest(request(await sign()), env, { fetch, verify });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private-secret');
    timeout.mockRestore();
  });
  it.each([[null, { closed: false }], [{ uid: 'user123' }, null], [{ uid: 'user123' }, { closed: true }]])('rejects absent membership or closed room', async (member, meta) => {
    const fetch = fetchMock(member, meta);
    expect((await handleRequest(request(await sign()), env, { fetch, verify })).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('returns sanitized errors for database, timeout, HTTP and malformed TURN failures', async () => {
    const token = await sign();
    const cloudflareFailure = vi.fn(async (url: string) => url.includes('/members/') ? Response.json({ uid: 'user123' }) : url.includes('/meta.json') ? Response.json({ closed: false }) : new Response('', { status: 503 }));
    const failing = [vi.fn().mockRejectedValue(new Error('private-secret')), vi.fn().mockResolvedValue(new Response('', { status: 503 })), cloudflareFailure, fetchMock({ uid: 'user123' }, { closed: false }, { iceServers: [] }), fetchMock({ uid: 'user123' }, { closed: false }, { iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u' }] })];
    for (const fetch of failing) {
      const response = await handleRequest(request(token), env, { fetch, verify });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('private-secret');
    }
  });
  it('supports browser CORS preflight without issuing credentials', async () => {
    const response = await handleRequest(new Request('https://worker.example/', { method: 'OPTIONS' }), env);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
