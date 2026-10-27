import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, signInAnonymously, updateProfile, type Auth, type User } from 'firebase/auth';
import { connectDatabaseEmulator, get, getDatabase, onChildAdded, onValue, onDisconnect, ref, remove, runTransaction, serverTimestamp, set, update, query, orderByChild, orderByKey, limitToLast, endAt, type Database, type Unsubscribe } from 'firebase/database';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import type { PeerSignal, RoomDataBus, RoomSignalBus } from './peerTransport';

export type RoomMember = { uid: string; name: string; role: 'player' | 'spectator'; seatId: string | null; memberSlot: number; joinedAt: number; ready: boolean; agent?: boolean; deckName?: string; deckSummary?: Array<{ cardId: string; name: string; role: 'commander' }>; playmatId?: string };
export type RoomListing = { id: string; code: string; name: string; hostName: string; hostLeaseUntil?: number; playerCount: number; memberCount: number; locked: boolean; phase: string; createdAt: number; closed?: boolean };
export type JoinedRoom = { roomId: string; code: string; member: RoomMember; generation: number; hostUid?: string };
type RoomSnapshot = { rooms: RoomListing[]; nextCursor: number | null };
type RoomMeta = { id: string; code: string; name: string; createdAt: number; generation: number; hostUid: string; hostLeaseUntil: number; nextQueueAt: number; hasPassword: boolean; passwordSalt?: string; passwordHash?: string; phase: string; closed: boolean };
type Presence = Record<string, Record<string, { online?: boolean; disconnectedAt?: number; lastSeen?: number }>>;

export interface RoomService {
  connectIdentity(playerName: string): Promise<string>;
  create(name: string, playerName: string, password?: string): Promise<JoinedRoom>;
  join(code: string, playerName: string, password?: string): Promise<JoinedRoom>;
  list(cursor?: number): Promise<RoomSnapshot>;
  leave(): Promise<void>;
  saveProfile(deckName: string, deckSummary: RoomMember['deckSummary'], playmatId?: string): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  createSignalBus(roomId: string): RoomSignalBus;
  createDataBus(roomId: string): RoomDataBus;
  getIceServers?(roomId: string): Promise<{ iceServers: RTCIceServer[]; expiresAt: number }>;
}

const env = import.meta.env;
const config: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL, projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
const SEATS = ['northWest', 'northEast', 'southEast', 'southWest'] as const;
const MAX_MEMBERS = 12;
const PRESENCE_LEASE_MS = 45_000;
const ROOM_STALE_MS = 120_000;

function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = crypto.getRandomValues(new Uint8Array(11));
  return [...values].map(value => alphabet[value & 31]).join('');
}
function normalizedName(value: string, max: number): string { return value.trim().replace(/\s+/g, ' ').slice(0, max); }
function validLinkId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
async function passwordHash(password: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function connectionMessage(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  if (/permission_denied|permission-denied|PERMISSION_DENIED/i.test(message)) return new Error('Não foi possível acessar esta mesa. Confira o código, a senha e sua conexão.');
  if (/network|unavailable|failed to fetch|offline/i.test(message)) return new Error('Sem conexão com o serviço de mesas. Verifique sua internet e tente novamente.');
  return error instanceof Error ? error : new Error('Não foi possível acessar as mesas. Tente novamente.');
}

export class RoomBackend implements RoomService {
  constructor(private readonly appName = 'meu-magic-p2p') {}
  private app?: ReturnType<typeof initializeApp>;
  private auth?: Auth;
  private database?: Database;
  private functions?: Functions;
  private user?: User;
  private emulatorConnected = false;
  private functionsEmulatorConnected = false;
  private readonly sessionId = crypto.randomUUID();
  private presenceTimer?: ReturnType<typeof setInterval>;
  private presenceRef?: ReturnType<typeof ref>;
  private watchers: Unsubscribe[] = [];
  private activeRoomId?: string;

  get isConfigured(): boolean { return Boolean(config.apiKey && config.authDomain && config.databaseURL && config.projectId && config.appId); }
  get uid(): string | undefined { return this.user?.uid; }
  get id(): string { return this.sessionId; }

  async connectIdentity(playerName: string): Promise<string> {
    if (!this.isConfigured) throw new Error('Preencha a configuração Firebase em .env.local para usar o multiplayer.');
    this.app ??= getApps().find(existing => existing.name === this.appName) ?? initializeApp(config, this.appName);
    try { this.auth ??= initializeAuth(this.app, { persistence: indexedDBLocalPersistence }); }
    catch { this.auth ??= (await import('firebase/auth')).getAuth(this.app); }
    this.database ??= getDatabase(this.app);
    if (import.meta.env.DEV && env.VITE_FIREBASE_EMULATOR_HOST && !this.emulatorConnected) {
      connectAuthEmulator(this.auth, `http://${env.VITE_FIREBASE_EMULATOR_HOST}:${env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099}`, { disableWarnings: true });
      connectDatabaseEmulator(this.database, env.VITE_FIREBASE_EMULATOR_HOST, Number(env.VITE_FIREBASE_DATABASE_EMULATOR_PORT || 9000));
      this.emulatorConnected = true;
    }
    await this.auth.authStateReady();
    this.user = this.auth.currentUser ?? (await signInAnonymously(this.auth)).user;
    try { await updateProfile(this.user, { displayName: normalizedName(playerName, 28) }); } catch { /* Anonymous profiles may not support profile updates. */ }
    return this.user.uid;
  }

  async getIceServers(roomId: string): Promise<{ iceServers: RTCIceServer[]; expiresAt: number }> {
    if (!this.app || !this.user || this.activeRoomId !== roomId) throw new Error('Entre na mesa antes de solicitar conexão.');
    this.functions ??= getFunctions(this.app, 'us-central1');
    if (import.meta.env.DEV && env.VITE_FIREBASE_EMULATOR_HOST && !this.functionsEmulatorConnected) {
      connectFunctionsEmulator(this.functions, env.VITE_FIREBASE_EMULATOR_HOST, Number(env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5001));
      this.functionsEmulatorConnected = true;
    }
    const response = await httpsCallable<{ roomId: string }, { iceServers: RTCIceServer[]; expiresAt: number }>(this.functions, 'turnIce')({ roomId });
    const result = response.data;
    if (!Array.isArray(result?.iceServers) || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('O servidor TURN retornou credenciais inválidas.');
    return result;
  }

  async create(name: string, playerName: string, password = ''): Promise<JoinedRoom> {
    await this.connectIdentity(playerName);
    const uid = this.requireUid();
    const tableName = normalizedName(name, 40);
    if (tableName.length < 3) throw new Error('O nome da mesa deve ter pelo menos 3 caracteres.');
    if (password && (password.length < 6 || password.length > 64)) throw new Error('A senha deve ter de 6 a 64 caracteres.');
    const code = roomCode();
    const roomId = code;
    const now = Date.now();
    const salt = password ? crypto.randomUUID().replaceAll('-', '') : undefined;
    const meta: RoomMeta = {
      id: roomId, code, name: tableName, createdAt: now, generation: 1,
      hostUid: uid, hostLeaseUntil: now + PRESENCE_LEASE_MS, nextQueueAt: now,
      hasPassword: Boolean(password), ...(salt ? { passwordSalt: salt, passwordHash: await passwordHash(password, salt) } : {}),
      phase: 'lobby', closed: false,
    };
    const room = ref(this.requireDatabase(), `p2pRooms/${roomId}`);
    await set(room, { meta });
    const database = this.requireDatabase();
    const memberClaim = await runTransaction(ref(database, `p2pRooms/${roomId}/memberClaims/1`), current => current === null ? uid : undefined);
    if (!memberClaim.committed) throw new Error('Não foi possível reservar um lugar nesta mesa.');
    const seatClaim = await runTransaction(ref(database, `p2pRooms/${roomId}/seatClaims/${SEATS[0]}`), current => current === null ? uid : undefined);
    if (!seatClaim.committed) throw new Error('Não foi possível reservar o primeiro lugar da mesa.');
    const member: RoomMember = { uid, name: normalizedName(playerName, 28), role: 'player', seatId: SEATS[0], memberSlot: 1, joinedAt: now, ready: false };
    try {
      const memberResult = await runTransaction(ref(database, `p2pRooms/${roomId}/members/${uid}`), current => current === null ? member : undefined);
      if (!memberResult.committed) throw new Error('Não foi possível confirmar seu lugar na mesa.');
    }
    catch (error) {
      await update(ref(database, `p2pRooms/${roomId}/meta`), { closed: true, hostUid: '', hostLeaseUntil: 0 }).catch(() => {});
      throw connectionMessage(error);
    }
    await this.syncDirectory(roomId);
    await this.watchRoom(roomId);
    await this.beginPresence(roomId);
    return { roomId, code, member, generation: 1, hostUid: uid };
  }

  async join(code: string, playerName: string, password = '', options: { agent?: boolean } = {}): Promise<JoinedRoom> {
    await this.connectIdentity(playerName);
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{6,16}$/.test(normalizedCode)) throw new Error('Confira o código da mesa e tente novamente.');
    const roomId = normalizedCode;
    const database = this.requireDatabase();
    const metaRef = ref(database, `p2pRooms/${roomId}/meta`);
    const metaSnapshot = await get(metaRef);
    const meta = metaSnapshot.val() as RoomMeta | null;
    if (!meta || meta.closed) throw new Error('Essa mesa não está mais disponível.');
    if (options.agent && meta.phase !== 'lobby') throw new Error('Uma IA só pode ocupar um lugar antes do início da partida.');
    const uid = this.requireUid();
    const memberRef = ref(database, `p2pRooms/${roomId}/members/${uid}`);
    let memberSnapshot;
    try { memberSnapshot = await get(memberRef); } catch { memberSnapshot = undefined; }
    let member = memberSnapshot?.val() as RoomMember | null | undefined;
    if (!member) {
      if (meta.hasPassword) {
        if (!password || !meta.passwordSalt || !meta.passwordHash || await passwordHash(password, meta.passwordSalt) !== meta.passwordHash) throw new Error('Senha incorreta. Confira e tente novamente.');
      }
      let memberSlot: number | undefined;
      for (let slot = 1; slot <= MAX_MEMBERS; slot++) {
        const claim = await runTransaction(ref(database, `p2pRooms/${roomId}/memberClaims/${slot}`), current => current === null ? uid : undefined);
        if (claim.committed) { memberSlot = slot; break; }
      }
      if (memberSlot === undefined) throw new Error('Essa mesa já tem quatro jogadores e oito espectadores.');
      let seatId: typeof SEATS[number] | null = null;
      if (meta.phase === 'lobby') for (const seat of SEATS) {
        const claim = await runTransaction(ref(database, `p2pRooms/${roomId}/seatClaims/${seat}`), current => current === null ? uid : undefined);
        if (claim.committed) { seatId = seat; break; }
      }
      const membersRef = ref(database, `p2pRooms/${roomId}/members/${uid}`);
      const joinedAt = Date.now();
      const nextMember: RoomMember = { uid, name: normalizedName(playerName, 28), role: seatId ? 'player' : 'spectator', seatId, memberSlot, joinedAt, ready: false, ...(options.agent ? { agent: true } : {}) };
      let committedMember: RoomMember | null = null;
      try {
        const memberResult = await runTransaction(membersRef, current => current === null ? nextMember : undefined);
        committedMember = memberResult.snapshot.val() as RoomMember | null;
      } catch (error) {
        committedMember = (await get(membersRef).catch(() => null))?.val() as RoomMember | null ?? null;
        if (!committedMember) {
          if (seatId) await remove(ref(database, `p2pRooms/${roomId}/seatClaims/${seatId}`)).catch(() => {});
          await remove(ref(database, `p2pRooms/${roomId}/memberClaims/${memberSlot}`)).catch(() => {});
          throw connectionMessage(error);
        }
      }
      if (!committedMember) {
        if (seatId) await remove(ref(database, `p2pRooms/${roomId}/seatClaims/${seatId}`));
        await remove(ref(database, `p2pRooms/${roomId}/memberClaims/${memberSlot}`));
        throw new Error('Não foi possível reservar seu lugar na mesa.');
      }
      member = committedMember;
    } else {
      if (options.agent && (!member.agent || !member.seatId)) throw new Error('Esta identidade não está vinculada a um lugar de IA nesta mesa.');
      await update(memberRef, { name: normalizedName(playerName, 28) });
      member = { ...member, name: normalizedName(playerName, 28) };
    }
    await this.syncDirectory(roomId);
    await this.watchRoom(roomId);
    await this.beginPresence(roomId);
    return { roomId, code: normalizedCode, member, generation: Number(meta.generation), hostUid: meta.hostUid };
  }

  async list(cursor?: number): Promise<RoomSnapshot> {
    await this.ensureIdentity();
    const directory = ref(this.requireDatabase(), 'p2pDirectory');
    const page = query(directory, orderByChild('createdAt'), ...(cursor === undefined ? [] : [endAt(cursor)]), limitToLast(20));
    const snapshot = await get(page);
    const rooms = Object.values((snapshot.val() ?? {}) as Record<string, RoomListing>)
      .filter(room => !room.closed && Number(room.hostLeaseUntil ?? 0) + ROOM_STALE_MS > Date.now())
      .sort((a, b) => b.createdAt - a.createdAt);
    return { rooms, nextCursor: rooms.length === 20 ? Math.min(...rooms.map(room => room.createdAt)) - 1 : null };
  }

  async saveProfile(deckName: string, deckSummary: RoomMember['deckSummary'], playmatId?: string): Promise<void> {
    const roomId = this.requireActiveRoom();
    const fields: Partial<RoomMember> = { deckName, deckSummary: deckSummary ?? [] };
    if (playmatId !== undefined) fields.playmatId = playmatId;
    await update(ref(this.requireDatabase(), `p2pRooms/${roomId}/members/${this.requireUid()}`), fields);
    await this.syncDirectory(roomId);
  }

  async setReady(ready: boolean): Promise<void> {
    const roomId = this.requireActiveRoom();
    const database = this.requireDatabase();
    const uid = this.requireUid();
    const memberRef = ref(database, `p2pRooms/${roomId}/members/${uid}`);
    await update(memberRef, { ready });
    const members = Object.values((await get(ref(database, `p2pRooms/${roomId}/members`))).val() ?? {}) as RoomMember[];
    const players = members.filter(member => member.seatId);
    const meta = (await get(ref(database, `p2pRooms/${roomId}/meta`))).val() as RoomMeta | null;
    if (meta?.hostUid === uid && players.length > 0 && players.every(member => member.uid === uid ? ready : member.ready)) await this.setPhase('starting');
    await this.syncDirectory(roomId);
  }

  async setPhase(phase: 'starting' | 'playing' | 'lobby'): Promise<void> {
    const roomId = this.requireActiveRoom();
    const uid = this.requireUid();
    await runTransaction(ref(this.requireDatabase(), `p2pRooms/${roomId}/meta`), current => current?.hostUid === uid && !current.closed ? { ...current, phase } : undefined);
    await this.syncDirectory(roomId);
  }

  async leave(): Promise<void> {
    const roomId = this.activeRoomId;
    if (!roomId) return;
    const database = this.requireDatabase();
    const uid = this.requireUid();
    this.stopPresence();
    const [metaSnapshot, membersSnapshot] = await Promise.all([
      get(ref(database, `p2pRooms/${roomId}/meta`)), get(ref(database, `p2pRooms/${roomId}/members`)),
    ]);
    const meta = metaSnapshot.val() as RoomMeta | null;
    const members = (membersSnapshot.val() ?? {}) as Record<string, RoomMember>;
    const departing = members[uid];
    const survivorIds = Object.keys(members).filter(memberUid => memberUid !== uid);
    if (meta && survivorIds.length === 0) {
      await update(ref(database, `p2pRooms/${roomId}/meta`), { closed: true, hostLeaseUntil: 0 });
      await update(ref(database, `p2pDirectory/${roomId}`), { closed: true, memberCount: 0, playerCount: 0, hostLeaseUntil: 0 });
    } else if (meta && meta.hostUid === uid && survivorIds.length) {
      const online = (await this.onlineMembers(roomId, survivorIds)).filter(entry => !entry.member.agent);
      online.sort((a, b) => a.member.joinedAt - b.member.joinedAt || a.uid.localeCompare(b.uid));
      const nextUid = online[0]?.uid;
      if (!nextUid) {
        await update(ref(database, `p2pRooms/${roomId}/meta`), { closed: true, hostLeaseUntil: 0 });
        await update(ref(database, `p2pDirectory/${roomId}`), { closed: true, hostLeaseUntil: 0 });
      } else {
      const next = await runTransaction(ref(database, `p2pRooms/${roomId}/meta`), current => current?.hostUid === uid
        ? { ...current, hostUid: nextUid, generation: Number(current.generation) + 1, hostLeaseUntil: Date.now() + PRESENCE_LEASE_MS }
        : undefined);
      if (next.committed) {
        const remaining = survivorIds.map(id => members[id]!).filter(Boolean);
        const nextHost = remaining.find(member => member.uid === nextUid)?.name ?? 'Anfitrião';
        const nextMeta = next.snapshot.val() as RoomMeta;
        await set(ref(database, `p2pDirectory/${roomId}`), {
          id: roomId, code: nextMeta.code, name: nextMeta.name, hostName: nextHost, hostLeaseUntil: nextMeta.hostLeaseUntil,
          playerCount: remaining.filter(member => member.seatId).length, memberCount: remaining.length,
          locked: nextMeta.hasPassword, phase: nextMeta.phase, createdAt: nextMeta.createdAt, closed: false,
        } satisfies RoomListing);
      }
      }
    } else if (meta) {
      const remaining = survivorIds.map(id => members[id]!).filter(Boolean);
      await set(ref(database, `p2pDirectory/${roomId}`), {
        id: roomId, code: meta.code, name: meta.name, hostName: members[meta.hostUid]?.name ?? 'Anfitrião', hostLeaseUntil: meta.hostLeaseUntil,
        playerCount: remaining.filter(member => member.seatId).length, memberCount: remaining.length,
        locked: meta.hasPassword, phase: meta.phase, createdAt: meta.createdAt, closed: meta.closed,
      } satisfies RoomListing);
    }
    if (departing?.memberSlot) await remove(ref(database, `p2pRooms/${roomId}/memberClaims/${departing.memberSlot}`));
    if (departing?.seatId) await remove(ref(database, `p2pRooms/${roomId}/seatClaims/${departing.seatId}`));
    await remove(ref(database, `p2pRooms/${roomId}/members/${uid}`));
    await remove(ref(database, `p2pSignals/${roomId}/${uid}`));
    await this.unwatchRoom();
  }

  async claimHost(roomId: string): Promise<{ hostUid: string; generation: number }> {
    const database = this.requireDatabase();
    const uid = this.requireUid();
    const members = (await get(ref(database, `p2pRooms/${roomId}/members`))).val() as Record<string, RoomMember> | null;
    if (!members?.[uid]) throw new Error('Você não participa desta mesa.');
    const eligible = (await this.onlineMembers(roomId, Object.keys(members))).filter(entry => !entry.member.agent);
    eligible.sort((a, b) => a.member.joinedAt - b.member.joinedAt || a.uid.localeCompare(b.uid));
    if (eligible[0]?.uid !== uid) throw new Error('Outro participante tem prioridade para assumir a mesa.');
    const metaRef = ref(database, `p2pRooms/${roomId}/meta`);
    const result = await runTransaction(metaRef, current => {
      if (!current || current.closed || !current.hostUid) return;
      if (current.hostUid === uid) return { ...current, hostLeaseUntil: Date.now() + PRESENCE_LEASE_MS };
      if (Number(current.hostLeaseUntil) > Date.now()) return;
      return { ...current, hostUid: uid, generation: Number(current.generation) + 1, hostLeaseUntil: Date.now() + PRESENCE_LEASE_MS };
    });
    if (!result.committed) throw new Error('O anfitrião atual ainda está conectado ou outro participante assumiu a mesa.');
    const meta = result.snapshot.val() as RoomMeta;
    await this.syncDirectory(roomId);
    return { hostUid: meta.hostUid, generation: meta.generation };
  }

  async renewHostLease(): Promise<{ hostUid: string; generation: number }> {
    const roomId = this.requireActiveRoom();
    const uid = this.requireUid();
    const metaRef = ref(this.requireDatabase(), `p2pRooms/${roomId}/meta`);
    const currentMeta = (await get(metaRef)).val() as RoomMeta | null;
    if (!currentMeta) throw new Error('A mesa não está mais disponível.');
    if (currentMeta.hostUid !== uid) return { hostUid: currentMeta.hostUid, generation: Number(currentMeta.generation) };
    const result = await runTransaction(metaRef, current => current?.hostUid === uid ? { ...current, hostLeaseUntil: Date.now() + PRESENCE_LEASE_MS } : current);
    const meta = result.snapshot.val() as RoomMeta;
    if (meta.hostUid === uid) await this.syncDirectory(roomId);
    return { hostUid: meta.hostUid, generation: Number(meta.generation) };
  }

  async resetLobby(roomId: string): Promise<void> {
    const database = this.requireDatabase();
    const uid = this.requireUid();
    const members = (await get(ref(database, `p2pRooms/${roomId}/members`))).val() as Record<string, RoomMember> | null;
    if (!members) return;
    const online = await this.onlineMembers(roomId, Object.keys(members));
    online.sort((a, b) => Number(b.member.role === 'spectator') - Number(a.member.role === 'spectator') || a.member.joinedAt - b.member.joinedAt || a.uid.localeCompare(b.uid));
    const meta = (await get(ref(database, `p2pRooms/${roomId}/meta`))).val() as RoomMeta | null;
    if (meta?.hostUid !== uid) throw new Error('Somente o anfitrião pode preparar a próxima partida.');
    const changes: Record<string, unknown> = {};
    for (const seat of SEATS) changes[`p2pRooms/${roomId}/seatClaims/${seat}`] = null;
    for (const [index, entry] of online.entries()) {
      const seatId = SEATS[index] ?? null;
      changes[`p2pRooms/${roomId}/members/${entry.uid}/seatId`] = seatId;
      changes[`p2pRooms/${roomId}/members/${entry.uid}/role`] = seatId ? 'player' : 'spectator';
      changes[`p2pRooms/${roomId}/members/${entry.uid}/ready`] = false;
      if (seatId) changes[`p2pRooms/${roomId}/seatClaims/${seatId}`] = entry.uid;
    }
    changes[`p2pRooms/${roomId}/meta/phase`] = 'lobby';
    await update(ref(database), changes);
    await this.syncDirectory(roomId);
  }

  async losePrivate(roomId: string): Promise<void> {
    const uid = this.requireUid();
    const memberRef = ref(this.requireDatabase(), `p2pRooms/${roomId}/members/${uid}`);
    const member = (await get(memberRef)).val() as RoomMember | null;
    if (!member?.seatId) return;
    await Promise.all([
      update(memberRef, { seatId: null, role: 'spectator', ready: false, joinedAt: Date.now() }),
      remove(ref(this.requireDatabase(), `p2pRooms/${roomId}/seatClaims/${member.seatId}`)),
    ]);
    await this.syncDirectory(roomId);
    return;
  }

  watchDirectory(receive: (rooms: RoomListing[]) => void): Unsubscribe {
    const directoryPage = query(ref(this.requireDatabase(), 'p2pDirectory'), orderByChild('createdAt'), limitToLast(20));
    return onValue(directoryPage, snapshot => {
      const rooms = Object.values((snapshot.val() ?? {}) as Record<string, RoomListing>)
        .filter(room => !room.closed && Number(room.hostLeaseUntil ?? 0) + ROOM_STALE_MS > Date.now())
        .sort((first, second) => second.createdAt - first.createdAt);
      receive(rooms.slice(0, 20));
    });
  }

  watchRoom(roomId: string): void;
  watchRoom(roomId: string, receive: (members: RoomMember[], meta: Record<string, unknown>, presence: Presence) => void): () => void;
  watchRoom(roomId: string, receive?: (members: RoomMember[], meta: Record<string, unknown>, presence: Presence) => void): (() => void) | void {
    if (!receive) { this.activeRoomId = roomId; return; }
    const database = this.requireDatabase();
    const membersRef = ref(database, `p2pRooms/${roomId}/members`);
    const metaRef = ref(database, `p2pRooms/${roomId}/meta`);
    let members: RoomMember[] = [];
    let meta: Record<string, unknown> = {};
    let presence: Presence = {};
    const emit = () => receive(members, meta, presence);
    const roomWatchers = [
      onValue(membersRef, snapshot => { members = Object.values(snapshot.val() ?? {}) as RoomMember[]; emit(); }),
      onValue(metaRef, snapshot => { meta = snapshot.val() ?? {}; emit(); }),
      onValue(ref(database, `p2pRooms/${roomId}/presence`), snapshot => { presence = snapshot.val() ?? {}; emit(); }),
    ];
    this.watchers.push(...roomWatchers);
    return () => {
      roomWatchers.forEach(unsubscribe => unsubscribe());
      this.watchers = this.watchers.filter(unsubscribe => !roomWatchers.includes(unsubscribe));
    };
  }

  createSignalBus(roomId: string): RoomSignalBus {
    const database = this.requireDatabase();
    const uid = this.requireUid();
    return {
      send: async signal => {
        if (signal.roomId !== roomId || signal.senderUid !== uid || !validLinkId(signal.linkId)) throw new Error('Sinalização inválida.');
        const id = crypto.randomUUID();
        await set(ref(database, `p2pSignals/${roomId}/${signal.targetUid}/${id}`), { ...signal, sentAt: serverTimestamp() });
      },
      subscribe: receive => {
        const inbox = ref(database, `p2pSignals/${roomId}/${uid}`);
        const unsubscribe = onChildAdded(inbox, snapshot => {
          const signal = snapshot.val() as PeerSignal;
          if (signal?.roomId === roomId && signal.targetUid === uid && signal.senderUid !== uid) {
            if (validLinkId(signal.linkId)) receive(signal);
            else receive({ ...signal, incompatible: true });
          }
          void remove(snapshot.ref);
        });
        return unsubscribe;
      },
    };
  }

  createDataBus(roomId: string): RoomDataBus {
    const database = this.requireDatabase();
    const uid = this.requireUid();
    const messagePath = (peerUid: string, generation: number, linkId: string, outgoing = false) => {
      if (!validLinkId(linkId) || !Number.isSafeInteger(generation) || generation < 1 || !uid || uid === peerUid) throw new Error('Vínculo de sincronização inválido.');
      return `p2pRelay/${roomId}/${generation}/${outgoing ? peerUid : uid}/${outgoing ? uid : peerUid}/${linkId}`;
    };
    const presencePath = (peerUid: string, generation: number, linkId: string, outgoing = false) => {
      if (!validLinkId(linkId) || !Number.isSafeInteger(generation) || generation < 1 || !uid || uid === peerUid) throw new Error('Vínculo de presença inválido.');
      return `p2pRelayPresence/${roomId}/${generation}/${outgoing ? peerUid : uid}/${outgoing ? uid : peerUid}/${linkId}`;
    };
    return {
      send: async (peerUid, generation, linkId, sequence, packet) => {
        if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 1_000_000 || typeof packet !== 'string' || packet.length > 32_768) throw new Error('Pacote de sincronização fora dos limites.');
        const path = messagePath(peerUid, generation, linkId, true);
        const key = String(sequence).padStart(12, '0');
        await set(ref(database, `${path}/${key}`), { roomId, generation, linkId, senderUid: uid, targetUid: peerUid, sequence, packet, sentAt: serverTimestamp() });
      },
      subscribe: (peerUid, generation, linkId, receive) => {
        const path = messagePath(peerUid, generation, linkId);
        const inbox = query(ref(database, path), orderByKey());
        return onChildAdded(inbox, snapshot => {
          const value = snapshot.val() as { sequence?: number; packet?: string; sentAt?: number; senderUid?: string; targetUid?: string; linkId?: string; generation?: number; roomId?: string } | null;
          if (!value) return;
          if (Date.now() - Number(value.sentAt ?? 0) > 60_000) { void remove(snapshot.ref); return; }
          if (value.roomId !== roomId || value.generation !== generation || value.linkId !== linkId || value.senderUid !== peerUid || value.targetUid !== uid || !Number.isSafeInteger(value.sequence) || typeof value.packet !== 'string' || value.packet.length > 32_768) {
            void remove(snapshot.ref); return;
          }
          void Promise.resolve(receive(value.sequence!, value.packet)).then(() => remove(snapshot.ref)).catch(() => {});
        });
      },
      sendPresence: async (peerUid, generation, linkId, payload) => {
        await set(ref(database, presencePath(peerUid, generation, linkId, true)), { roomId, generation, linkId, senderUid: uid, targetUid: peerUid, payload, sentAt: serverTimestamp() });
      },
      subscribePresence: (peerUid, generation, linkId, receive) => onValue(ref(database, presencePath(peerUid, generation, linkId)), snapshot => {
        const value = snapshot.val() as { roomId?: string; generation?: number; linkId?: string; senderUid?: string; targetUid?: string; payload?: unknown; sentAt?: number } | null;
        if (value?.roomId === roomId && value.generation === generation && value.linkId === linkId && value.senderUid === peerUid && value.targetUid === uid && Date.now() - Number(value.sentAt ?? 0) <= 60_000) receive(value.payload);
      }),
    };
  }

  async close(): Promise<void> { this.stopPresence(); await this.unwatchRoom(); }

  private async syncDirectory(roomId: string): Promise<void> {
    const database = this.requireDatabase();
    const [metaSnapshot, membersSnapshot] = await Promise.all([
      get(ref(database, `p2pRooms/${roomId}/meta`)), get(ref(database, `p2pRooms/${roomId}/members`)),
    ]);
    const meta = metaSnapshot.val() as RoomMeta | null;
    if (!meta) return;
    const members = Object.values((membersSnapshot.val() ?? {}) as Record<string, RoomMember>);
    await set(ref(database, `p2pDirectory/${roomId}`), {
      id: roomId, code: meta.code, name: meta.name, hostName: members.find(member => member.uid === meta.hostUid)?.name ?? 'Anfitrião',
      hostLeaseUntil: meta.hostLeaseUntil, playerCount: members.filter(member => member.seatId).length,
      memberCount: members.length, locked: meta.hasPassword, phase: meta.phase, createdAt: meta.createdAt, closed: meta.closed,
    } satisfies RoomListing);
  }

  private async onlineMembers(roomId: string, uids: string[]): Promise<Array<{ uid: string; member: RoomMember }>> {
    const database = this.requireDatabase();
    const result: Array<{ uid: string; member: RoomMember }> = [];
    for (const uid of uids) {
      const [memberSnapshot, presenceSnapshot] = await Promise.all([
        get(ref(database, `p2pRooms/${roomId}/members/${uid}`)), get(ref(database, `p2pRooms/${roomId}/presence/${uid}`)),
      ]);
      const member = memberSnapshot.val() as RoomMember | null;
      const sessions = (presenceSnapshot.val() ?? {}) as Record<string, { online?: boolean }>;
      if (member && Object.values(sessions).some(session => session.online === true)) result.push({ uid, member });
    }
    return result;
  }

  private async ensureIdentity(): Promise<void> { if (!this.user) await this.connectIdentity('Jogador'); }
  private async beginPresence(roomId: string): Promise<void> {
    this.stopPresence();
    this.activeRoomId = roomId;
    const uid = this.requireUid(); const database = this.requireDatabase();
    const presence = ref(database, `p2pRooms/${roomId}/presence/${uid}/${this.sessionId}`);
    this.presenceRef = presence;
    await onDisconnect(presence).set({ disconnectedAt: serverTimestamp() });
    await set(presence, { online: true, lastSeen: serverTimestamp() });
    this.presenceTimer = setInterval(() => { void set(presence, { online: true, lastSeen: serverTimestamp() }).catch(() => {}); }, 15_000);
  }
  private stopPresence(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = undefined;
    if (this.presenceRef) { void remove(this.presenceRef).catch(() => {}); this.presenceRef = undefined; }
  }
  private async unwatchRoom(): Promise<void> {
    this.watchers.splice(0).forEach(unsubscribe => unsubscribe());
    this.activeRoomId = undefined;
  }
  private requireDatabase(): Database { if (!this.database) throw new Error('Conecte-se ao serviço de salas primeiro.'); return this.database; }
  private requireUid(): string { if (!this.user) throw new Error('A identidade ainda não está conectada.'); return this.user.uid; }
  private requireActiveRoom(): string { if (!this.activeRoomId) throw new Error('Você não está em uma mesa.'); return this.activeRoomId; }
}

export const roomBackend = new RoomBackend();
