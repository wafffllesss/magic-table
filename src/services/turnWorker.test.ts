import { afterEach, expect, it, vi } from 'vitest';
import { requestTurnCredentials } from './turnWorker';
afterEach(() => vi.unstubAllGlobals());
it('sends the current identity token and room to the Worker', async () => {
  const value = { iceServers: [{ urls: 'turn:turn.cloudflare.com:3478?transport=udp' }], expiresAt: Date.now() + 10000 };
  const fetch = vi.fn().mockResolvedValue(Response.json(value)); vi.stubGlobal('fetch', fetch);
  expect(await requestTurnCredentials('https://turn.example.workers.dev', 'room1234', async () => 'token')).toEqual(value);
  expect(fetch).toHaveBeenCalledWith(new URL('https://turn.example.workers.dev'), expect.objectContaining({ headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: '{"roomId":"room1234"}' }));
});
it('rejects insecure URLs and invalid or unavailable responses', async () => {
  const getToken = vi.fn().mockResolvedValue('token');
  await expect(requestTurnCredentials('http://example.com', 'room1234', getToken)).rejects.toThrow();
  expect(getToken).not.toHaveBeenCalled();
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(Response.json({ iceServers: [], expiresAt: 0 })); vi.stubGlobal('fetch', fetch);
  await expect(requestTurnCredentials('https://example.com', 'room1234', getToken)).rejects.toThrow();
  await expect(requestTurnCredentials('https://example.com', 'room1234', getToken)).rejects.toThrow();
});
