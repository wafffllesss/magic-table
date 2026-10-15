import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { indexedDBLocalPersistence, initializeAuth, signInAnonymously, type Auth, type User } from 'firebase/auth';
import {
  get, getDatabase, onDisconnect, onValue, ref, remove, runTransaction, serverTimestamp, set, update,
  type Database, type Unsubscribe,
} from 'firebase/database';
import type { DeckDefinition, GameAction, MatchState, PlayerSeat } from '../domain/game';
import { applyAction, newMatch, privateProjection, publicProjection } from '../domain/game';
import { localRepository } from './storage';

export const TABLE_SEATS = ['northWest', 'northEast', 'southEast', 'southWest'] as const;
export type TableSeatId = typeof TABLE_SEATS[number];
export type Participant = { uid: string; name: string; seatId?: TableSeatId; online: boolean; joinedAt: number; ready?: boolean; deckName?: string; deckSummary?: DeckDefinition['entries'] };
export type QueueParticipant = { uid: string; name: string; requestedAt: number; position: number; online: boolean };
export type ReplacementOffer = { seatId: TableSeatId; candidateUid: string; candidateName: string; expiresAt: number; rejectedUids: Record<string, true>; acceptedUid?: string };
export type RoomSnapshot = {
  seats: Partial<Record<TableSeatId, Participant>>; queue: QueueParticipant[]; offer?: ReplacementOffer;
  coordinatorUid?: string; online: boolean; selfUid?: string; selfSeatId?: TableSeatId;
  queuePosition?: number; state?: MatchState; gameReady?: boolean; lastError?: string;
};

type FirebaseConfig = Pick<FirebaseOptions, 'apiKey' | 'authDomain' | 'databaseURL' | 'projectId' | 'appId' | 'messagingSenderId' | 'storageBucket'>;
type StoredPrivateGame = {
  matchId: string; seatId: string; hand: string[]; library: string[]; mana: PlayerSeat['mana'];
  commanderCasts: PlayerSeat['commanderCasts']; mulligans: number; keptHand: boolean; privateCards: MatchState['cards'];
};
type StoredPrivateSeat = { deck?: DeckDefinition; game?: StoredPrivateGame };
type QueueTicket = Pick<QueueParticipant, 'uid' | 'name' | 'requestedAt'>;
type LobbyData = {
  seats?: Partial<Record<TableSeatId, Participant & { leftAt?: number; lastOfflineAt?: number }>>;
  queue?: Record<string, QueueTicket>;
  offers?: Partial<Record<TableSeatId, ReplacementOffer>>;
  presence?: Record<string, Record<string, unknown>>;
  coordinator?: { uid: string; leaseUntil: number };
};

const ROOM_PATH = 'rooms/main';
const PRESENCE_LEASE_MS = 45_000;
const MISSING_PLAYER_GRACE_MS = 120_000;
const REPLACEMENT_WINDOW_MS = 30_000;
const OVERLAYS_DISABLED_MESSAGE = 'O Firebase não está configurado. Abra a demonstração local ou preencha o arquivo .env.';

export class FirebaseRoom {
  readonly isConfigured: boolean;
  readonly missingConfig: string[];
  private readonly config: FirebaseConfig;
  private app?: FirebaseApp;
  private auth?: Auth;
  private database?: Database;
  private user?: User;
  private sessionId?: string;
  private displayName = '';
  private seatId?: TableSeatId;
  private roomListener?: Unsubscribe;
  private gameListener?: Unsubscribe;
  private privateListener?: Unsubscribe;
  private presenceWatcher?: Unsubscribe;
  private interval?: ReturnType<typeof setInterval>;
  private submitInProgress = false;
  private controlMode = false;
  private releaseControlLock?: () => void;
  private processingQueue = false;
  private currentSnapshot?: RoomSnapshot;
  private onSnapshot?: (snapshot: RoomSnapshot) => void;
  private lastPublicMatch?: MatchState;
  private localPrivate?: StoredPrivateGame;
  private privateGamePending?: Promise<void>;

  constructor(environment: Record<string, string | undefined> = import.meta.env) {
    this.config = {
      apiKey: environment.VITE_FIREBASE_API_KEY,
      authDomain: environment.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: environment.VITE_FIREBASE_DATABASE_URL,
      projectId: environment.VITE_FIREBASE_PROJECT_ID,
      appId: environment.VITE_FIREBASE_APP_ID,
      messagingSenderId: environment.VITE_FIREBASE_MESSAGING_SENDER_ID,
      storageBucket: environment.VITE_FIREBASE_STORAGE_BUCKET,
    };
    this.missingConfig = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'].filter(key => !this.config[key as keyof FirebaseConfig]);
    this.isConfigured = this.missingConfig.length === 0;
  }

  async connect(name: string, receive: (snapshot: RoomSnapshot) => void): Promise<RoomSnapshot> {
    if (!this.isConfigured) throw new Error(OVERLAYS_DISABLED_MESSAGE);
    this.displayName = name.trim().slice(0, 28);
    this.onSnapshot = receive;
    this.app ??= getApps().find(existing => existing.name === 'mana-table') ?? initializeApp(this.config, 'mana-table');
    this.auth ??= initializeAuth(this.app, { persistence: indexedDBLocalPersistence });
    this.database ??= getDatabase(this.app);
    const credential = this.auth.currentUser ? { user: this.auth.currentUser } : await signInAnonymously(this.auth);
    this.user = credential.user;
    this.sessionId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    this.controlMode = await this.claimLocalControl();
    if (this.controlMode) { await this.startPresence(); await this.joinRoom(); }
    else this.currentSnapshot = { ...this.emptySnapshot(), online: true };
    this.startListening();
    if (this.controlMode) void this.tryCoordinator();
    return this.currentSnapshot ?? this.emptySnapshot();
  }

  async saveDeck(deck: DeckDefinition): Promise<void> {
    const self = this.requireIdentity();
    await localRepository.saveDeck(deck);
    if (!this.seatId) return;
    const commanderSummary = deck.entries.filter(entry => entry.role === 'commander');
    const database = this.requireDatabase();
    await update(ref(database), {
      [`${ROOM_PATH}/privateSeats/${this.seatId}/deck`]: deck,
      [`${ROOM_PATH}/lobby/seats/${this.seatId}/ready`]: false,
      [`${ROOM_PATH}/lobby/seats/${this.seatId}/deckName`]: deck.name,
      [`${ROOM_PATH}/lobby/seats/${this.seatId}/deckSummary`]: commanderSummary,
    });
    void self;
  }

  async markReady(isReady: boolean): Promise<void> {
    const self = this.requireIdentity();
    if (!this.seatId) throw new Error('Você está na fila. O deck ficou salvo neste computador.');
    const privateSeat = await this.readValue<StoredPrivateSeat>(`${ROOM_PATH}/privateSeats/${this.seatId}`);
    if (isReady && !privateSeat?.deck) throw new Error('Escolha um deck antes de confirmar o lugar.');
    await set(ref(this.requireDatabase(), `${ROOM_PATH}/lobby/seats/${this.seatId}/ready`), isReady);
    if (isReady) await this.maybeStartGame();
    void self;
  }

  async acceptOffer(offer: ReplacementOffer): Promise<void> {
    const self = this.requireIdentity();
    if (self.uid !== offer.candidateUid || offer.expiresAt < Date.now()) throw new Error('Esta oferta já expirou.');
    const database = this.requireDatabase(); const offerRef = ref(database, `${ROOM_PATH}/lobby/offers/${offer.seatId}`);
    const result = await runTransaction(offerRef, current => current?.candidateUid === self.uid && Number(current.expiresAt) >= Date.now() ? { ...current, acceptedUid: self.uid } : undefined);
    if (!result.committed) throw new Error('A vaga já foi oferecida a outra pessoa.');
    const [seat, ticket] = await Promise.all([
      this.readValue<Participant>(`${ROOM_PATH}/lobby/seats/${offer.seatId}`),
      this.readValue<QueueParticipant>(`${ROOM_PATH}/lobby/queue/${self.uid}`),
    ]);
    if (!seat?.uid || !ticket) throw new Error('Esta oferta não está mais disponível.');
    await update(ref(database), {
      [`${ROOM_PATH}/lobby/seats/${offer.seatId}/uid`]: self.uid,
      [`${ROOM_PATH}/lobby/seats/${offer.seatId}/name`]: this.displayName,
      [`${ROOM_PATH}/lobby/seats/${offer.seatId}/joinedAt`]: ticket.requestedAt,
      [`${ROOM_PATH}/lobby/seats/${offer.seatId}/ready`]: Boolean(seat.ready),
      [`${ROOM_PATH}/lobby/seats/${offer.seatId}/leftAt`]: null,
      [`${ROOM_PATH}/lobby/seats/${offer.seatId}/lastOfflineAt`]: null,
    });
    this.seatId = offer.seatId;
    await Promise.all([remove(ref(database, `${ROOM_PATH}/lobby/queue/${self.uid}`)), remove(offerRef)]);
    await this.bindPrivateSeat(offer.seatId);
  }

  async declineOffer(offer: ReplacementOffer): Promise<void> {
    const self = this.requireIdentity();
    if (self.uid !== offer.candidateUid) throw new Error('Esta oferta pertence a outro jogador.');
    const target = ref(this.requireDatabase(), `${ROOM_PATH}/lobby/offers/${offer.seatId}`);
    const result = await runTransaction(target, current => {
      if (!current || current.candidateUid !== self.uid || current.acceptedUid) return;
      return { ...current, candidateUid: null, candidateName: null, rejectedUids: { ...(current.rejectedUids ?? {}), [self.uid]: true } };
    });
    if (!result.committed) throw new Error('A oferta não está mais disponível.');
    void this.processQueue();
  }

  async leave(): Promise<void> {
    const self = this.requireIdentity(); const database = this.requireDatabase();
    if (this.seatId) await update(ref(database, `${ROOM_PATH}/lobby/seats/${this.seatId}`), { leftAt: Date.now(), ready: false });
    await remove(ref(database, `${ROOM_PATH}/lobby/queue/${self.uid}`));
    if (this.sessionId) await remove(ref(database, `${ROOM_PATH}/lobby/presence/${self.uid}/${this.sessionId}`));
    if (this.seatId) void this.processQueue();
    await this.disconnectListeners();
  }

  async act(action: GameAction): Promise<MatchState> {
    const self = this.requireIdentity(); const database = this.requireDatabase(); const current = this.currentSnapshot?.state;
    if (!this.seatId || !current || !this.currentSnapshot?.online) throw new Error('A mesa não está conectada ou você não ocupa um lugar.');
    if (this.submitInProgress) throw new Error('A última jogada ainda está sincronizando.');
    this.submitInProgress = true;
    try {
      const id = `${self.uid}-${crypto.randomUUID?.() ?? Date.now().toString(36)}`;
      const next = applyAction(current, this.seatId, action, Date.now());
      const lastAction = { id, actorUid: self.uid, actorSeatId: this.seatId, type: action.type, at: Date.now() };
      await update(ref(database), {
        [`${ROOM_PATH}/game/public`]: { ...publicProjection(next), lastAction },
        [`${ROOM_PATH}/privateSeats/${this.seatId}/game`]: { ...privateProjection(next, this.seatId), matchId: next.id, seatId: this.seatId },
        [`${ROOM_PATH}/game/actionIds/${id}`]: { actorUid: self.uid, revision: next.revision, createdAt: serverTimestamp() },
      });
      this.localPrivate = { ...privateProjection(next, this.seatId), matchId: next.id, seatId: this.seatId };
      this.hydrateGame(publicProjection(next) as MatchState);
      return next;
    } catch (error) {
      const details = error instanceof Error ? error.message.toLowerCase() : '';
      if (details.includes('permission') || details.includes('denied')) throw new Error('A jogada entrou em conflito com outra pessoa. A mesa foi atualizada; tente de novo.');
      throw error;
    } finally { this.submitInProgress = false; }
  }

  async getCachedDecks(): Promise<DeckDefinition[]> { return localRepository.getDecks(); }

  async disconnectListeners(): Promise<void> {
    this.roomListener?.(); this.gameListener?.(); this.privateListener?.(); this.presenceWatcher?.();
    if (this.interval) clearInterval(this.interval);
    this.roomListener = undefined; this.gameListener = undefined; this.privateListener = undefined; this.presenceWatcher = undefined; this.interval = undefined;
    this.releaseControlLock?.(); this.releaseControlLock = undefined; this.controlMode = false;
  }

  private async claimLocalControl(): Promise<boolean> {
    if (!navigator.locks) return true;
    let release: (() => void) | undefined;
    let settle: (available: boolean) => void = () => {};
    const available = new Promise<boolean>(resolve => { settle = resolve; });
    const lockHeld = new Promise<void>(resolve => { release = resolve; });
    void navigator.locks.request('mana-table-control', { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { settle(false); return; }
      this.releaseControlLock = release;
      settle(true);
      await lockHeld;
    }).catch(() => settle(false));
    return available;
  }

  private async startPresence(): Promise<void> {
    const database = this.requireDatabase(); const self = this.requireIdentity();
    const presence = ref(database, `${ROOM_PATH}/lobby/presence/${self.uid}/${this.sessionId}`);
    this.presenceWatcher = onValue(ref(database, '.info/connected'), async snapshot => {
      if (!snapshot.val()) { this.emit({ online: false }); return; }
      await onDisconnect(presence).remove();
      await set(presence, { name: this.displayName, lastSeen: serverTimestamp() });
      this.emit({ online: true });
    });
    this.interval = setInterval(() => {
      void set(presence, { name: this.displayName, lastSeen: serverTimestamp() }).catch(() => this.emit({ online: false }));
      void this.tryCoordinator();
    }, 15_000);
  }

  private async joinRoom(): Promise<void> {
    const self = this.requireIdentity(); const database = this.requireDatabase();
    let lobby = await this.readLobby();
    const knownSeat = TABLE_SEATS.find(seat => lobby.seats?.[seat]?.uid === self.uid);
    if (knownSeat) {
      const currentOffer = await this.readValue<ReplacementOffer>(`${ROOM_PATH}/lobby/offers/${knownSeat}`);
      if (currentOffer?.acceptedUid) {
        await runTransaction(ref(database, `${ROOM_PATH}/lobby/queue/${self.uid}`), current => current ?? { uid: self.uid, name: this.displayName, requestedAt: Date.now() });
        return;
      }
      this.seatId = knownSeat;
      await update(ref(database, `${ROOM_PATH}/lobby/seats/${knownSeat}`), { name: this.displayName, leftAt: null, lastOfflineAt: null });
      if (currentOffer?.candidateUid && !currentOffer.acceptedUid) await remove(ref(database, `${ROOM_PATH}/lobby/offers/${knownSeat}`));
      await this.bindPrivateSeat(knownSeat);
      return;
    }
    const ticket = await this.readValue<QueueParticipant>(`${ROOM_PATH}/lobby/queue/${self.uid}`);
    if (ticket) {
      await update(ref(database, `${ROOM_PATH}/lobby/queue/${self.uid}`), { name: this.displayName, online: true });
      return;
    }
    const game = await this.readValue<MatchState>(`${ROOM_PATH}/game/public`);
    if (!game || game.phase === 'finished') {
      for (const seatId of TABLE_SEATS) {
        const target = ref(database, `${ROOM_PATH}/lobby/seats/${seatId}`);
        const result = await runTransaction(target, current => current?.uid ? undefined : { uid: self.uid, name: this.displayName, seatId, ready: false, joinedAt: Date.now() });
        if (result.committed) { this.seatId = seatId; await this.bindPrivateSeat(seatId); return; }
      }
    }
    await runTransaction(ref(database, `${ROOM_PATH}/lobby/queue/${self.uid}`), current => current ?? { uid: self.uid, name: this.displayName, requestedAt: Date.now() });
    lobby = await this.readLobby(); this.publishRoom(lobby);
  }

  private startListening(): void {
    const database = this.requireDatabase(); const self = this.requireIdentity();
    this.roomListener?.(); this.gameListener?.();
    this.roomListener = onValue(ref(database, `${ROOM_PATH}/lobby`), snapshot => {
      this.publishRoom((snapshot.val() as LobbyData | null) ?? {});
      if (this.controlMode) void this.maybeStartGame();
      if (this.controlMode && this.isLeader()) void this.processQueue();
    }, () => this.emit({ online: false, lastError: 'Não foi possível ler a sala do Firebase.' }));
    this.gameListener = onValue(ref(database, `${ROOM_PATH}/game/public`), snapshot => {
      const state = snapshot.val() as MatchState | null;
      if (!state) { this.emit({ state: undefined, gameReady: false }); return; }
      this.hydrateGame(state);
      if (this.currentSnapshot?.selfSeatId) void this.ensurePrivateGame(this.currentSnapshot.selfSeatId, state);
      if (this.controlMode && state.phase === 'finished' && this.isLeader()) void this.prepareNextGame();
      else if (this.controlMode && this.isLeader()) void this.processQueue();
      void self;
    }, () => this.emit({ online: false, lastError: 'A mesa caiu. Nenhuma jogada pendente foi confirmada.' }));
  }

  private async bindPrivateSeat(seatId: TableSeatId): Promise<void> {
    this.privateListener?.();
    this.privateListener = onValue(ref(this.requireDatabase(), `${ROOM_PATH}/privateSeats/${seatId}`), snapshot => {
      this.localPrivate = (snapshot.val() as StoredPrivateSeat | null)?.game;
      if (this.lastPublicMatch) void this.ensurePrivateGame(seatId, this.lastPublicMatch);
      if (this.lastPublicMatch) this.hydrateGame(this.lastPublicMatch);
    }, () => this.emit({ lastError: 'O Firebase bloqueou a leitura privada deste lugar.' }));
  }

  private hydrateGame(publicState: MatchState): void {
    this.lastPublicMatch = publicState;
    const hydrated = structuredClone(publicState);
    const selfSeatId = this.currentSnapshot?.selfSeatId;
    const secret = this.localPrivate;
    if (selfSeatId && secret?.matchId === publicState.id) {
      const seat = hydrated.seats.find(candidate => candidate.id === selfSeatId);
      if (seat) Object.assign(seat, { hand: secret.hand ?? [], library: secret.library ?? [], mana: secret.mana ?? seat.mana, commanderCasts: secret.commanderCasts ?? seat.commanderCasts, mulligans: secret.mulligans ?? seat.mulligans, keptHand: secret.keptHand ?? seat.keptHand });
      Object.assign(hydrated.cards, secret.privateCards ?? {});
    }
    this.emit({ state: hydrated, gameReady: true });
  }

  private async ensurePrivateGame(seatId: TableSeatId, publicState: MatchState): Promise<void> {
    if (this.privateGamePending) { await this.privateGamePending; return; }
    if (!this.user || this.seatId !== seatId || this.localPrivate?.matchId === publicState.id) return;
    this.privateGamePending = (async () => {
      const saved = await this.readValue<StoredPrivateSeat>(`${ROOM_PATH}/privateSeats/${seatId}`);
      if (saved?.game?.matchId === publicState.id) { this.localPrivate = saved.game; this.hydrateGame(publicState); return; }
      if (!saved?.deck) return;
      const lobby = await this.readLobby();
      const entrants = TABLE_SEATS.map(id => {
        const seat = lobby.seats?.[id];
        if (!seat) throw new Error('A vaga está vazia.');
        return { seatId: id, name: seat.name, deck: id === seatId ? saved.deck! : placeholderDeck(id, seat) };
      });
      const localGame = newMatch(entrants, parseInt(publicState.id.replace('match-', ''), 36) || publicState.updatedAt);
      localGame.id = publicState.id; localGame.revision = publicState.revision; localGame.phase = publicState.phase;
      localGame.paused = publicState.paused;
      localGame.turn = publicState.turn; localGame.step = publicState.step; localGame.activeSeatId = publicState.activeSeatId;
      localGame.passes = publicState.passes; localGame.stack = structuredClone(publicState.stack); localGame.log = structuredClone(publicState.log);
      for (const remoteSeat of publicState.seats) {
        const ours = localGame.seats.find(seat => seat.id === remoteSeat.id);
        if (ours && remoteSeat.id !== seatId) Object.assign(ours, { ...remoteSeat, hand: [], library: [], mulligans: 0, keptHand: false });
        else if (ours) Object.assign(ours, { ...remoteSeat, hand: ours.hand, library: ours.library, mulligans: ours.mulligans, keptHand: ours.keptHand });
      }
      Object.assign(localGame.cards, publicState.cards);
      const game = { ...privateProjection(localGame, seatId), seatId, matchId: publicState.id } satisfies StoredPrivateGame;
      this.localPrivate = game;
      await set(ref(this.requireDatabase(), `${ROOM_PATH}/privateSeats/${seatId}/game`), game);
      this.hydrateGame(publicState);
    })();
    try { await this.privateGamePending; }
    finally { this.privateGamePending = undefined; }
  }

  private publishRoom(lobby: LobbyData): void {
    const self = this.user; if (!self) return;
    const onlinePresence = lobby.presence ?? {};
    const seats = Object.fromEntries(TABLE_SEATS.flatMap(seatId => {
      const current = lobby.seats?.[seatId];
      if (!current?.uid) return [];
      const connected = Object.keys(onlinePresence[current.uid] ?? {}).length > 0;
      return [[seatId, { ...current, seatId, online: connected }]];
    })) as RoomSnapshot['seats'];
    const queue = Object.values(lobby.queue ?? {}).sort((first, second) => first.requestedAt - second.requestedAt || first.uid.localeCompare(second.uid)).map((ticket, index) => ({ ...ticket, position: index + 1, online: Object.keys(onlinePresence[ticket.uid] ?? {}).length > 0 }));
    const selfSeatId = this.controlMode ? TABLE_SEATS.find(seatId => seats[seatId]?.uid === self.uid) : undefined;
    if (selfSeatId !== this.seatId) { this.seatId = selfSeatId; if (selfSeatId) void this.bindPrivateSeat(selfSeatId); }
    const existing = this.currentSnapshot;
    this.currentSnapshot = {
      seats, queue, online: existing?.online ?? true, selfUid: self.uid, selfSeatId,
      queuePosition: queue.find(ticket => ticket.uid === self.uid)?.position,
      offer: this.controlMode ? Object.values(lobby.offers ?? {}).find(offer => offer?.candidateUid === self.uid && !offer.acceptedUid) : undefined,
      coordinatorUid: lobby.coordinator?.uid, state: existing?.state, gameReady: existing?.gameReady,
    };
    if (selfSeatId && this.lastPublicMatch) void this.ensurePrivateGame(selfSeatId, this.lastPublicMatch);
    this.onSnapshot?.(this.currentSnapshot);
  }

  private async tryCoordinator(): Promise<void> {
    const self = this.user; if (!self) return;
    const target = ref(this.requireDatabase(), `${ROOM_PATH}/lobby/coordinator`);
    await runTransaction(target, current => {
      const now = Date.now();
      if (current?.uid && current.uid !== self.uid && Number(current.leaseUntil) > now) return;
      return { uid: self.uid, leaseUntil: now + PRESENCE_LEASE_MS };
    }).then(result => {
      if (result.committed && result.snapshot.val()?.uid === self.uid) { void this.processQueue(); void this.maybeStartGame(); }
    }).catch(() => {});
  }

  private isLeader(): boolean { return this.currentSnapshot?.coordinatorUid === this.user?.uid; }

  private async processQueue(): Promise<void> {
    if (this.processingQueue || !this.isLeader()) return;
    this.processingQueue = true;
    try {
      const [lobby, game] = await Promise.all([this.readLobby(), this.readValue<MatchState>(`${ROOM_PATH}/game/public`)]);
      const database = this.requireDatabase(); const now = Date.now();
      const queue = Object.values(lobby.queue ?? {}).sort((first, second) => first.requestedAt - second.requestedAt || first.uid.localeCompare(second.uid));
      const present = lobby.presence ?? {};
      const liveGame = game?.phase === 'mulligan' || game?.phase === 'playing';
      if (!liveGame) { await this.offerFreeSeats(lobby, queue); return; }
      const missingSeat = game!.seats.filter(candidate => candidate.status === 'playing').some(candidate => {
        const occupant = lobby.seats?.[candidate.id as TableSeatId];
        return !occupant?.uid || Boolean(occupant.leftAt) || Object.keys(present[occupant.uid] ?? {}).length === 0;
      });
      await this.setMatchPaused(missingSeat, game!);
      for (const seatId of TABLE_SEATS) {
        const occupant = lobby.seats?.[seatId]; if (!occupant?.uid) continue;
        const voluntary = Boolean(occupant.leftAt);
        if (!voluntary && Object.keys(present[occupant.uid] ?? {}).length > 0) continue;
        const disconnectedAt = Number(occupant.leftAt || occupant.lastOfflineAt || now);
        if (!voluntary && now - disconnectedAt < MISSING_PLAYER_GRACE_MS) {
          if (!occupant.leftAt && !occupant.lastOfflineAt) await update(ref(database, `${ROOM_PATH}/lobby/seats/${seatId}`), { lastOfflineAt: now });
          continue;
        }
        let offer = lobby.offers?.[seatId];
        if (offer?.candidateUid && offer.expiresAt <= now) {
          offer = { ...offer, candidateUid: '', candidateName: '', rejectedUids: { ...(offer.rejectedUids ?? {}), [offer.candidateUid]: true } };
          await set(ref(database, `${ROOM_PATH}/lobby/offers/${seatId}`), offer);
        }
        if (offer?.candidateUid && offer.expiresAt > now) continue;
        const seated = new Set(TABLE_SEATS.map(candidate => lobby.seats?.[candidate]?.uid).filter(Boolean));
        const rejected = new Set(Object.keys(offer?.rejectedUids ?? {}));
        const candidate = queue.find(ticket => !seated.has(ticket.uid) && !rejected.has(ticket.uid) && Object.keys(present[ticket.uid] ?? {}).length > 0);
        if (candidate) {
          await set(ref(database, `${ROOM_PATH}/lobby/offers/${seatId}`), { seatId, candidateUid: candidate.uid, candidateName: candidate.name, expiresAt: now + REPLACEMENT_WINDOW_MS, rejectedUids: Object.fromEntries([...rejected].map(uid => [uid, true])) } satisfies ReplacementOffer);
          continue;
        }
        const possibleLater = queue.some(ticket => !seated.has(ticket.uid) && !rejected.has(ticket.uid));
        if (!possibleLater && (rejected.size > 0 || queue.length === 0)) await this.eliminateAbandonedSeat(seatId);
      }
    } catch (error) { this.emit({ lastError: friendly(error) }); }
    finally { this.processingQueue = false; }
  }

  private async offerFreeSeats(lobby: LobbyData, queue: QueueTicket[]): Promise<void> {
    if (!queue.length) return;
    const database = this.requireDatabase(); const present = lobby.presence ?? {};
    for (const seatId of TABLE_SEATS) {
      if (lobby.seats?.[seatId]?.uid) continue;
      const taken = new Set(TABLE_SEATS.map(candidate => lobby.seats?.[candidate]?.uid).filter(Boolean));
      const candidate = queue.find(ticket => !taken.has(ticket.uid) && Object.keys(present[ticket.uid] ?? {}).length > 0);
      if (!candidate) continue;
      const seatRef = ref(database, `${ROOM_PATH}/lobby/seats/${seatId}`);
      const result = await runTransaction(seatRef, current => current?.uid ? undefined : { uid: candidate.uid, name: candidate.name, seatId, joinedAt: candidate.requestedAt, ready: false });
      if (result.committed) await remove(ref(database, `${ROOM_PATH}/lobby/queue/${candidate.uid}`));
    }
  }

  private async eliminateAbandonedSeat(seatId: TableSeatId): Promise<void> {
    const current = this.lastPublicMatch; const departed = this.currentSnapshot?.seats[seatId];
    if (!current || !departed?.uid) return;
    const next = structuredClone(current); const target = next.seats.find(seat => seat.id === seatId);
    if (!target || target.status === 'eliminated') return;
    target.status = 'eliminated'; next.cards = Object.fromEntries(Object.entries(next.cards).filter(([, card]) => card.ownerId !== seatId));
    next.stack = next.stack.filter(item => item.controllerId !== seatId); next.passes = []; next.revision++; next.updatedAt = Date.now();
    if (next.seats.filter(seat => seat.status === 'playing').length <= 1) next.phase = 'finished';
    next.log.push({ id: `${next.id}-${next.revision}`, actorId: this.seatId ?? 'room', message: `${departed.name} deixou a partida.`, at: next.updatedAt, public: true });
    const publicView = publicProjection(next);
    await update(ref(this.requireDatabase()), {
      [`${ROOM_PATH}/game/public`]: { ...publicView, lastAction: { id: `leave-${next.revision}`, actorUid: this.requireIdentity().uid, actorSeatId: this.seatId ?? null, type: 'ELIMINATE_SEAT', at: next.updatedAt } },
      [`${ROOM_PATH}/lobby/seats/${seatId}/status`]: 'vacated',
      [`${ROOM_PATH}/lobby/seats/${seatId}/uid`]: null,
      [`${ROOM_PATH}/lobby/offers/${seatId}`]: null,
    });
  }

  private async setMatchPaused(paused: boolean, current: MatchState): Promise<void> {
    if (current.paused === paused || !this.isLeader()) return;
    const next = structuredClone(current); next.paused = paused; next.revision++; next.updatedAt = Date.now();
    const id = `room-${next.revision}-${crypto.randomUUID?.() ?? Date.now().toString(36)}`;
    next.log.push({ id: `${next.id}-${next.revision}`, actorId: 'room', message: paused ? 'A partida pausou enquanto um lugar reconecta ou recebe uma oferta.' : 'A partida foi retomada.', at: next.updatedAt, public: true });
    if (next.log.length > 160) next.log = next.log.slice(-160);
    await update(ref(this.requireDatabase()), {
      [`${ROOM_PATH}/game/public`]: { ...publicProjection(next), lastAction: { id, actorUid: this.requireIdentity().uid, actorSeatId: this.seatId ?? null, type: paused ? 'PAUSE_MATCH' : 'RESUME_MATCH', at: next.updatedAt } },
      [`${ROOM_PATH}/game/actionIds/${id}`]: { actorUid: this.requireIdentity().uid, revision: next.revision, createdAt: serverTimestamp() },
    });
  }

  private async maybeStartGame(): Promise<void> {
    if (!this.isLeader()) return;
    const [lobby, existing] = await Promise.all([this.readLobby(), this.readValue<MatchState>(`${ROOM_PATH}/game/public`)]);
    if (existing) return;
    if (!TABLE_SEATS.every(seatId => lobby.seats?.[seatId]?.uid && lobby.seats[seatId]?.ready && lobby.seats[seatId]?.deckSummary?.length)) return;
    const entrants = TABLE_SEATS.map(seatId => {
      const seat = lobby.seats![seatId]!;
      const commanders = seat.deckSummary!.filter(entry => entry.role === 'commander');
      const fillers = Array.from({ length: 100 - commanders.length }, (_, index) => ({ cardId: `covered-${seatId}-${index}`, name: `Carta oculta ${index + 1}`, quantity: 1, role: 'library' as const }));
      return { seatId, name: seat.name, deck: { id: `seat-${seatId}`, name: seat.deckName || 'Deck Commander', format: 'commander' as const, commanders: commanders.map(entry => entry.cardId), entries: [...commanders, ...fillers], updatedAt: Date.now() } };
    });
    const state = newMatch(entrants);
    await update(ref(this.requireDatabase()), {
      [`${ROOM_PATH}/game/public`]: { ...publicProjection(state), lastAction: { id: `${state.id}-start`, actorUid: this.user!.uid, actorSeatId: this.seatId ?? null, type: 'START_MATCH', at: Date.now() } },
      [`${ROOM_PATH}/game/startedAt`]: serverTimestamp(),
    });
  }

  private async prepareNextGame(): Promise<void> {
    if (!this.isLeader()) return;
    const lobby = await this.readLobby(); const database = this.requireDatabase();
    const queued = Object.values(lobby.queue ?? {}).sort((a, b) => a.requestedAt - b.requestedAt || a.uid.localeCompare(b.uid));
    const present = lobby.presence ?? {}; const now = Date.now();
    for (const seatId of TABLE_SEATS) {
      const old = lobby.seats?.[seatId];
      if (old?.uid && !queued.some(ticket => ticket.uid === old.uid)) queued.push({ uid: old.uid, name: old.name, requestedAt: now + TABLE_SEATS.indexOf(seatId) });
      await remove(ref(database, `${ROOM_PATH}/lobby/seats/${seatId}`));
    }
    await update(ref(database), {
      [`${ROOM_PATH}/game/public`]: null,
      [`${ROOM_PATH}/game/startedAt`]: null,
      ...Object.fromEntries(TABLE_SEATS.map(seatId => [`${ROOM_PATH}/privateSeats/${seatId}` , null])),
      [`${ROOM_PATH}/game/actionIds`]: null,
    });
    await remove(ref(database, `${ROOM_PATH}/lobby/offers`));
    for (const ticket of queued) {
      if (!present[ticket.uid] || Object.keys(present[ticket.uid]).length === 0) continue;
      await set(ref(database, `${ROOM_PATH}/lobby/queue/${ticket.uid}`), { uid: ticket.uid, name: ticket.name, requestedAt: ticket.requestedAt });
    }
    this.emit({ gameReady: false, state: undefined });
    void this.processQueue();
  }

  private async readLobby(): Promise<LobbyData> { return await this.readValue<LobbyData>(`${ROOM_PATH}/lobby`) ?? {}; }
  private async readValue<T>(path: string): Promise<T | undefined> {
    const snapshot = await get(ref(this.requireDatabase(), path));
    return snapshot.exists() ? snapshot.val() as T : undefined;
  }
  private requireDatabase(): Database { if (!this.database) throw new Error(OVERLAYS_DISABLED_MESSAGE); return this.database; }
  private requireIdentity(): User { if (!this.user) throw new Error('Entre na sala antes de continuar.'); return this.user; }
  private emptySnapshot(): RoomSnapshot { return { seats: {}, queue: [], online: true, selfUid: this.user?.uid }; }
  private emit(fields: Partial<RoomSnapshot>): void {
    this.currentSnapshot = { ...this.emptySnapshot(), ...this.currentSnapshot, ...fields };
    this.onSnapshot?.(this.currentSnapshot);
  }
}

function placeholderDeck(seatId: string, seat: Participant): DeckDefinition {
  const commanders = (seat.deckSummary ?? []).filter(entry => entry.role === 'commander');
  const fillers = Array.from({ length: 100 - commanders.length }, (_, index) => ({ cardId: `hidden-${seatId}-${index}`, name: 'Carta oculta', quantity: 1, role: 'library' as const }));
  return { id: `seat-${seatId}`, name: seat.deckName || 'Deck Commander', format: 'commander', commanders: commanders.map(entry => entry.cardId), entries: [...commanders, ...fillers], updatedAt: Date.now() };
}

export const firebaseRoom = new FirebaseRoom();

function friendly(error: unknown): string { return error instanceof Error ? error.message : 'A sala não pôde ser atualizada.'; }
