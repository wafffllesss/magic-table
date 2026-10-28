export async function requestTurnCredentials(workerUrl: string | undefined, roomId: string, getIdToken: () => Promise<string>): Promise<{ iceServers: RTCIceServer[]; expiresAt: number }> {
  let url: URL;
  try { url = new URL(workerUrl ?? ''); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
  catch { throw new Error('O serviço TURN não está configurado.'); }
  const token = await getIdToken();
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('O serviço TURN não está disponível.');
  const result = await response.json() as { iceServers: RTCIceServer[]; expiresAt: number };
  if (!Array.isArray(result?.iceServers) || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('O servidor TURN retornou credenciais inválidas.');
  return result;
}
