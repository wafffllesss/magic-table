import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { onCall, HttpsError, type CallableRequest, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const scrypt = promisify(scryptCallback);
const MAX_MEMBERS = 12;
const SEATS = ['northWest', 'northEast', 'southEast', 'southWest'] as const;
const db = () => getDatabase(getApps()[0] ?? initializeApp());

type CallableData = { operation?: unknown; roomId?: unknown; code?: unknown; name?: unknown; playerName?: unknown; password?: unknown; ready?: unknown; deckName?: unknown; deckSummary?: unknown; playmatId?: unknown; generation?: unknown; sessionId?: unknown; phase?: unknown };
type Member = { uid: string; name: string; role: 'player' | 'spectator'; seatId: string | null; joinedAt: number; ready: boolean; online: boolean; deckName?: string; deckSummary?: unknown[]; playmatId?: string };
type Meta = { id: string; name: string; code: string; createdAt: number; generation: number; hostUid: string; hostLeaseUntil: number; hasPassword?: boolean; nextQueueAt: number; phase?: string; closed?: boolean; offlineSince?: number };

function fail(code: FunctionsErrorCode, message: string): never { throw new HttpsError(code, message); }
function uidOf(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) return fail('unauthenticated', 'Entre na sua conta antes de acessar uma mesa.');
  return request.auth.uid;
}
function cleanText(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string') return fail('invalid-argument', `${label} inválido.`);
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < min || text.length > max) return fail('invalid-argument', `${label} deve ter de ${min} a ${max} caracteres.`);
  return text;
}
function roomPath(roomId: string): string { return `p2pRooms/${roomId}`; }
function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) return fail('invalid-argument', `${label} inválido.`);
  return value;
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
async function hashPassword(password: string, salt: string): Promise<Buffer> { return await scrypt(password, salt, 64) as Buffer; }
async function checkPassword(meta: Meta, password: unknown, uid: string, address: string): Promise<void> {
  if (!meta.hasPassword) return;
  const secret = (await db().ref(`p2pRoomSecrets/${meta.id}`).get()).val() as { salt?: string; hash?: string } | null;
  if (!secret?.hash || !secret.salt) return fail('internal', 'Não foi possível validar a senha desta mesa.');
  const key = `p2pRoomAttempts/${digest(`${uid}:${address}`).slice(0, 40)}`;
  const now = Date.now();
  const attempt = await db().ref(key).transaction(current => !current || current.startedAt + 15 * 60_000 <= now
    ? { startedAt: now, count: 1 }
    : { startedAt: current.startedAt, count: current.count + 1 });
  if (Number(attempt.snapshot.val()?.count) > 6) return fail('resource-exhausted', 'Muitas tentativas. Aguarde 15 minutos para tentar novamente.');
  const text = typeof password === 'string' ? password : '';
  const supplied = await hashPassword(text, secret.salt);
  if (text.length < 6 || !timingSafeEqual(supplied, Buffer.from(secret.hash, 'hex'))) fail('permission-denied', 'Senha incorreta.');
  await db().ref(key).remove();
}
function codeValue(): string { return randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 11).toUpperCase(); }
function directory(meta: Meta, members: Record<string, Member>): Record<string, unknown> {
  const list = Object.values(members);
  return { id: meta.id, code: meta.code, name: meta.name, hostName: members[meta.hostUid]?.name ?? 'Anfitrião',
    playerCount: list.filter(member => member.seatId).length, memberCount: list.length,
    locked: Boolean(meta.hasPassword), phase: String(meta.phase ?? 'lobby'), createdAt: meta.createdAt, closed: Boolean(meta.closed) };
}
async function isOnline(roomId: string, uid: string): Promise<boolean> {
  const sessions = (await db().ref(`${roomPath(roomId)}/presence/${uid}`).get()).val() as Record<string, { online?: boolean }> | null;
  return Boolean(sessions && Object.values(sessions).some(session => session.online === true));
}
function chooseSeat(members: Record<string, Member>, allowSeat = true): { seatId: string | null; role: 'player' | 'spectator'; joinedAt: number } {
  const occupied = new Set(Object.values(members).map(member => member.seatId).filter(Boolean));
  const seatId = allowSeat ? SEATS.find(seat => !occupied.has(seat)) : undefined;
  return { seatId: seatId ?? null, role: seatId ? 'player' : 'spectator', joinedAt: Date.now() };
}
async function syncDirectory(meta: Meta): Promise<void> {
  const members = (await db().ref(`${roomPath(meta.id)}/members`).get()).val() ?? {};
  await db().ref(`p2pDirectory/${meta.id}`).set(directory(meta, members));
}

export const roomControl = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async request => {
  const uid = uidOf(request);
  const data = (request.data ?? {}) as CallableData;
  const op = typeof data.operation === 'string' ? data.operation : '';
  const address = request.rawRequest.ip ?? 'unknown';
  if (op === 'create') {
    const name = cleanText(data.name, 3, 40, 'Nome da mesa');
    const password = data.password === '' || data.password === undefined || data.password === null ? '' : cleanText(data.password, 6, 64, 'Senha');
    const id = randomBytes(16).toString('base64url');
    const code = codeValue();
    const now = Date.now();
    const salt = password ? randomBytes(16).toString('hex') : undefined;
    const passHash = password && salt ? (await hashPassword(password, salt)).toString('hex') : undefined;
    const meta: Meta = { id, name, code, createdAt: now, generation: 1, hostUid: uid, hostLeaseUntil: now + 45_000, nextQueueAt: now, hasPassword: Boolean(password) };
    const member: Member = { uid, name: cleanText(data.playerName || request.auth?.token.name || 'Anfitrião', 2, 28, 'Nome do jogador'), role: 'player', seatId: SEATS[0], joinedAt: now, ready: false, online: true };
    await db().ref(roomPath(id)).set({ meta, members: { [uid]: member } });
    if (salt && passHash) await db().ref(`p2pRoomSecrets/${id}`).set({ salt, hash: passHash });
    await db().ref(`p2pInviteCodes/${code}`).set(id);
    await syncDirectory(meta);
    return { roomId: id, code, member, generation: meta.generation };
  }

  if (op === 'list') {
    const cursorValue = (data as CallableData & { cursor?: unknown }).cursor;
    const cursor = typeof cursorValue === 'number' && Number.isFinite(cursorValue) ? cursorValue : Date.now();
    const rows = await db().ref('p2pDirectory').orderByChild('createdAt').endAt(cursor).limitToLast(20).get();
    const values = Object.values(rows.val() ?? {}).filter((entry): entry is Record<string, unknown> => Boolean(entry) && !(entry as Record<string, unknown>).closed)
      .sort((first, second) => Number(second.createdAt) - Number(first.createdAt));
    return { rooms: values, nextCursor: values.length === 20 ? Math.min(...values.map(room => Number(room.createdAt))) - 1 : null };
  }

  if (op === 'join') {
    const code = safeId(data.code, 'Código').toUpperCase();
    const mapped = await db().ref(`p2pInviteCodes/${code}`).get();
    const roomId = mapped.val();
    if (typeof roomId !== 'string') return fail('not-found', 'Essa mesa não está mais disponível.');
    const base = roomPath(roomId);
    const membersRef = db().ref(`${base}/members`);
    const metaRef = db().ref(`${base}/meta`);
    const metaResult = await metaRef.get();
    const meta = metaResult.val() as Meta | null;
    if (!meta || meta.closed) return fail('not-found', 'Essa mesa foi encerrada.');
    const memberRef = db().ref(`${base}/members/${uid}`);
    const existing = (await memberRef.get()).val() as Member | null;
    if (!existing) await checkPassword(meta, data.password, uid, address);
    let member: Member;
    if (existing) {
      member = { ...existing, online: true };
      await memberRef.set(member);
    } else {
      const nextOrder = await metaRef.child('nextQueueAt').transaction(current => Math.max(Date.now(), Number(current ?? 0) + 1));
      const joinedAt = Number(nextOrder.snapshot.val());
      const transaction = await membersRef.transaction(current => {
        const all = (current ?? {}) as Record<string, Member>;
        if (all[uid]) return all;
        if (Object.keys(all).length >= MAX_MEMBERS) return;
        const seat = chooseSeat(all, meta.phase !== 'playing' && meta.phase !== 'starting');
        all[uid] = { uid, name: cleanText(data.playerName || request.auth?.token.name || `Jogador ${uid.slice(0, 4)}`, 2, 28, 'Nome do jogador'), ...seat, joinedAt, ready: false, online: true };
        return all;
      });
      if (!transaction.committed) return fail('resource-exhausted', 'Essa mesa já tem quatro jogadores e oito espectadores.');
      member = transaction.snapshot.child(uid).val() as Member;
    }
    await syncDirectory(meta);
    return { roomId, member, generation: Number(meta.generation), hostUid: meta.hostUid };
  }

  const roomId = safeId(data.roomId, 'Identificador da mesa');
  const base = roomPath(roomId);
  const metaRef = db().ref(`${base}/meta`);
  const meta = (await metaRef.get()).val() as Meta | null;
  if (!meta || meta.closed) return fail('not-found', 'Essa mesa foi encerrada.');
  const membersRef = db().ref(`${base}/members`);
  const members = ((await membersRef.get()).val() ?? {}) as Record<string, Member>;
  const member = members[uid];

  if (op === 'ready' || op === 'profile') {
    if (!member) return fail('permission-denied', 'Você não participa desta mesa.');
    const updates: Partial<Omit<Member, 'playmatId'>> & { playmatId?: string | null } = {};
    if (op === 'ready') {
      if (meta.phase === 'playing') return fail('failed-precondition', 'A partida já começou.');
      if (!member.seatId) return fail('failed-precondition', 'Espectadores não podem confirmar lugar.');
      updates.ready = data.ready === true;
    } else {
      if (typeof data.deckName === 'string') updates.deckName = cleanText(data.deckName, 1, 64, 'Nome do deck');
      if (typeof data.deckSummary === 'object' && Array.isArray(data.deckSummary) && data.deckSummary.length <= 2) {
        updates.deckSummary = data.deckSummary.map(item => {
          const row = item as Record<string, unknown>;
          return { cardId: cleanText(row.cardId, 1, 80, 'Identificador do comandante'), name: cleanText(row.name, 1, 80, 'Nome do comandante'), role: 'commander' };
        });
      }
      if (data.playmatId === null || typeof data.playmatId === 'string') updates.playmatId = data.playmatId === null ? null : cleanText(data.playmatId, 1, 32, 'Playmat');
    }
    await membersRef.child(uid).update(updates);
    if (op === 'ready') {
      const seats = Object.values(members).filter(item => item.seatId);
      const allReady = seats.length === 4 && seats.every(item => item.uid === uid ? updates.ready : item.ready);
      const nextPhase = allReady ? 'starting' : meta.phase === 'starting' ? 'lobby' : meta.phase;
      if (nextPhase !== meta.phase) {
        await metaRef.child('phase').set(nextPhase);
        await syncDirectory({ ...meta, phase: nextPhase });
      }
    }
    return { ok: true };
  }

  if (op === 'leave') {
    if (!member) return { ok: true };
    await membersRef.child(uid).remove();
    const survivors = [] as Member[];
    for (const candidate of Object.values(members).filter(item => item.uid !== uid)) {
      const presence = (await db().ref(`${base}/presence/${candidate.uid}`).get()).val();
      if (presence && Object.values(presence).some(session => (session as { online?: boolean }).online === true)) survivors.push(candidate);
    }
    survivors.sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
    if (!survivors.length) {
      await metaRef.update({ closed: true, hostUid: '', hostLeaseUntil: 0 });
      await db().ref(`p2pDirectory/${roomId}`).update({ closed: true, memberCount: 0, playerCount: 0 });
      await db().ref(`p2pInviteCodes/${meta.code}`).remove();
      await db().ref(`p2pRoomSecrets/${roomId}`).remove();
      return { ok: true, closed: true };
    }
    const generation = Number(meta.generation) + (meta.hostUid === uid ? 1 : 0);
    const hostUid = meta.hostUid === uid ? survivors[0]!.uid : meta.hostUid;
    if (meta.hostUid === uid) await metaRef.update({ hostUid, generation, hostLeaseUntil: Date.now() + 45_000 });
    await syncDirectory({ ...meta, hostUid, generation });
    return { ok: true, hostUid, generation };
  }

  if (op === 'losePrivate') {
    if (!member?.seatId) return { ok: true };
    const queueOrder = await metaRef.child('nextQueueAt').transaction(current => Math.max(Date.now(), Number(current ?? 0) + 1));
    await membersRef.child(uid).update({ seatId: null, role: 'spectator', ready: false, joinedAt: Number(queueOrder.snapshot.val()) });
    await syncDirectory(meta);
    return { ok: true, seatId: member.seatId };
  }

  if (op === 'heartbeat') {
    if (!member) return fail('permission-denied', 'Você não participa desta mesa.');
    const sessionId = safeId(data.sessionId, 'Sessão');
    if (sessionId.length > 60) return fail('invalid-argument', 'Sessão inválida.');
    const presence = (await db().ref(`${base}/presence/${uid}/${sessionId}`).get()).val();
    if (!presence) return fail('failed-precondition', 'A presença da mesa desconectou.');
    if (meta.hostUid === uid) await metaRef.child('hostLeaseUntil').set(Date.now() + 45_000);
    return { ok: true, hostUid: meta.hostUid, generation: meta.generation };
  }

  if (op === 'phase') {
    if (!member || meta.hostUid !== uid) return fail('permission-denied', 'Somente o anfitrião pode mudar a fase da mesa.');
    const phase = data.phase;
    if (phase !== 'lobby' && phase !== 'starting' && phase !== 'playing') return fail('invalid-argument', 'Fase da mesa inválida.');
    await metaRef.child('phase').set(phase);
    await syncDirectory(meta);
    return { ok: true };
  }

  if (op === 'nextGame') {
    if (!member || meta.hostUid !== uid) return fail('permission-denied', 'Somente o anfitrião pode preparar a próxima partida.');
    if (meta.phase !== 'playing' && meta.phase !== 'starting') return fail('failed-precondition', 'A partida atual ainda não terminou.');
    const active = [] as Member[];
    for (const candidate of Object.values(members)) if (await isOnline(roomId, candidate.uid)) active.push(candidate);
    active.sort((a, b) => Number(b.role === 'spectator') - Number(a.role === 'spectator') || a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
    const updates: Record<string, unknown> = {};
    for (const [index, candidate] of active.entries()) {
      updates[`p2pRooms/${roomId}/members/${candidate.uid}/seatId`] = index < SEATS.length ? SEATS[index] : null;
      updates[`p2pRooms/${roomId}/members/${candidate.uid}/role`] = index < SEATS.length ? 'player' : 'spectator';
      updates[`p2pRooms/${roomId}/members/${candidate.uid}/ready`] = false;
    }
    updates[`${base}/meta/phase`] = 'lobby';
    await db().ref().update(updates);
    await syncDirectory({ ...meta, phase: 'lobby' });
    return { ok: true };
  }

  if (op === 'claimHost') {
    if (!member) return fail('permission-denied', 'Você não participa desta mesa.');
    if (meta.hostUid === uid) {
      await metaRef.update({ hostLeaseUntil: Date.now() + 45_000 });
      return { hostUid: uid, generation: meta.generation };
    }
    if (meta.hostLeaseUntil > Date.now()) return fail('failed-precondition', 'O anfitrião atual ainda está conectado.');
    const presence = (await db().ref(`${base}/presence/${meta.hostUid}`).get()).val();
    if (presence && Object.values(presence).some(session => (session as { online?: boolean }).online === true)) return fail('failed-precondition', 'O anfitrião atual está reconectando.');
    const eligible = [] as Member[];
    for (const candidate of Object.values(members)) {
      const sessions = (await db().ref(`${base}/presence/${candidate.uid}`).get()).val();
      if (sessions && Object.values(sessions).some(session => (session as { online?: boolean }).online === true)) eligible.push(candidate);
    }
    eligible.sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
    if (eligible[0]?.uid !== uid) return fail('failed-precondition', 'Outro participante tem prioridade para assumir a mesa.');
    const txn = await metaRef.transaction(current => current && current.generation === meta.generation && current.hostLeaseUntil <= Date.now()
      ? { ...current, hostUid: uid, generation: Number(current.generation) + 1, hostLeaseUntil: Date.now() + 45_000 }
      : undefined);
    if (!txn.committed) return fail('aborted', 'A mesa já foi assumida por outra pessoa.');
    const next = txn.snapshot.val() as Meta;
    await syncDirectory(next);
    return { hostUid: uid, generation: next.generation };
  }
  return fail('invalid-argument', 'Operação de mesa desconhecida.');
});

// Presence expiry and room cleanup contain only membership/control metadata; game state remains on peer links.
export const expireP2PRooms = onSchedule({ schedule: 'every 1 minutes', region: 'us-central1' }, async () => {
  const now = Date.now();
  const rows = (await db().ref('p2pDirectory').get()).val() as Record<string, { closed?: boolean }> | null;
  for (const [roomId, listing] of Object.entries(rows ?? {})) {
    if (listing.closed) continue;
    const base = roomPath(roomId);
    const [metaResult, membersResult] = await Promise.all([db().ref(`${base}/meta`).get(), db().ref(`${base}/members`).get()]);
    const meta = metaResult.val() as Meta | null;
    if (!meta || meta.closed) continue;
    const members = (membersResult.val() ?? {}) as Record<string, Member>;
    const presence = (await db().ref(`${base}/presence`).get()).val() as Record<string, Record<string, { online?: boolean; disconnectedAt?: number }>> | null;
    const inboxes = (await db().ref(`p2pSignals/${roomId}`).get()).val() as Record<string, Record<string, { sentAt?: number }>> | null;
    for (const [recipient, messages] of Object.entries(inboxes ?? {})) {
      const stale = Object.entries(messages).filter(([, message]) => Number(message.sentAt ?? now) < now - 60_000).map(([id]) => id);
      if (stale.length) await Promise.all(stale.map(id => db().ref(`p2pSignals/${roomId}/${recipient}/${id}`).remove()));
    }
    const online = Object.entries(presence ?? {}).some(([, sessions]) => Object.values(sessions).some(session => session.online === true));
    if (!online) {
      const offlineSince = Number((await db().ref(`${base}/meta/offlineSince`).get()).val() ?? now);
      if (!meta.offlineSince) await db().ref(`${base}/meta/offlineSince`).set(now);
      if (now - offlineSince >= 120_000) {
        await db().ref(`${base}/meta`).update({ closed: true, hostUid: '', hostLeaseUntil: 0 });
        await db().ref(`p2pDirectory/${roomId}`).update({ closed: true, memberCount: 0, playerCount: 0 });
        await db().ref(`p2pInviteCodes/${meta.code}`).remove();
        await db().ref(`p2pRoomSecrets/${roomId}`).remove();
      }
      continue;
    }
    if (meta.offlineSince) await db().ref(`${base}/meta/offlineSince`).remove();
    const updates: Record<string, unknown> = {};
    for (const member of Object.values(members)) {
      if (await isOnline(roomId, member.uid)) continue;
      const sessions = Object.values(presence?.[member.uid] ?? {});
      const disconnectedAt = Math.max(0, ...sessions.map(session => Number(session.disconnectedAt ?? 0)));
      if (disconnectedAt && now - disconnectedAt >= 120_000) {
        if (member.seatId) {
          updates[`${base}/members/${member.uid}/seatId`] = null;
          updates[`${base}/members/${member.uid}/role`] = 'spectator';
          updates[`${base}/members/${member.uid}/ready`] = false;
          updates[`${base}/members/${member.uid}/joinedAt`] = now;
        } else updates[`${base}/members/${member.uid}`] = null;
      }
    }
    if (Object.keys(updates).length) {
      await db().ref().update(updates);
      await syncDirectory(meta);
    }
  }
});
