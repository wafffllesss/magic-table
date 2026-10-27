import type { DeckDefinition, GameAction, MatchState } from '../domain/game';
import { advanceTurn, applyAction, composeMatchState, eligibleSeats, newMatch, privateProjection, publicProjection } from '../domain/game';
import { canRestoreHistory, restoreHistorySnapshot } from '../domain/history';
import { handPresenceStale, isHandPose, isTableSeat, type HandPresence, type HandPresenceInput } from '../domain/tablePresence';
import { publicGameUpdate, restorePublicMatch } from './firebaseState';
import { roomBackend, type JoinedRoom, type RoomMember } from './roomBackend';
import { PeerTransport } from './peerTransport';
import { localRepository, type SavedRoomSession } from './storage';
import type { RoomSnapshot, TableSeatId } from './firebaseRoom';
import { chatText, validChatMessage, type ChatMessage } from '../domain/chat';
import { validTargetIntent, validTargetMark, type TargetIntent, type TargetMark } from '../domain/tableTargets';

type PeerRoomSnapshot = RoomSnapshot & { roomId: string; code: string; name: string; hostUid?: string; generation: number; selfRole?: 'player' | 'spectator'; connectionState: 'connecting' | 'synchronizing' | 'connected' | 'reconnecting' | 'transferring' | 'disconnected'; memberCount: number };
type StateTransitionType = GameAction['type'] | 'UNDO' | 'REDO';
type PublicCommit = { state: MatchState; actorUid: string; actorSeatId: TableSeatId; actionId: string; actionType: StateTransitionType };
type PendingCommit = { id: string; revision: number; expected: Set<string>; acknowledged: Set<string>; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; finishing?: Promise<void>; result: Promise<void> };
const SEATS = ['northWest', 'northEast', 'southEast', 'southWest'] as const;

export class PeerRoom extends EventTarget {
  constructor(private readonly backend = roomBackend, private readonly repository = localRepository) { super(); }
  get snapshotState(): RoomSnapshot | undefined { return this.snapshot ? structuredClone(this.snapshot) : undefined; }
  private room?: JoinedRoom;
  private name = '';
  private member?: RoomMember;
  private members: RoomMember[] = [];
  private metadata: Record<string, unknown> = {};
  private presence: Record<string, Record<string, { online?: boolean; disconnectedAt?: number }>> = {};
  private transport?: PeerTransport;
  private stopWatch?: () => void;
  private timers: ReturnType<typeof setInterval>[] = [];
  private snapshot?: PeerRoomSnapshot;
  private receive?: (snapshot: RoomSnapshot) => void;
  private receiveHands?: (hands: HandPresence[]) => void;
  private publicState?: MatchState;
  private localState?: MatchState;
  private confirmedPublicState?: MatchState;
  private confirmedPrivateState?: ReturnType<typeof privateProjection>;
  private localDeck?: DeckDefinition;
  private pending = new Map<string, PendingCommit>();
  private seenActions = new Map<string, number>();
  private pendingEliminations = new Set<TableSeatId>();
  private controlLock = false;
  private actionLock = false;
  private startLock = false;
  private resetLock = false;
  private presenceSequence = 0;
  private lastPresence = new Map<string, HandPresence>();
  private restoredLocalMatchId?: string;
  private localPending?: SavedRoomSession['pending'];
  private checkpointPeers = new Set<string>();
  private finalizing?: { state: MatchState; promise: Promise<void> };
  private finalizedState?: MatchState;
  private snapshotWaiters = new Set<() => void>();
  private seenChat = new Set<string>();
  private seenTargets = new Set<string>();

  async waitForUpdate(afterRevision: number | null, afterConnectionState: PeerRoomSnapshot['connectionState'], timeoutMs: number): Promise<{ snapshot?: RoomSnapshot; timedOut: boolean }> {
    const changed = () => !this.snapshot || (this.snapshot.state?.revision ?? null) !== afterRevision || this.snapshot.connectionState !== afterConnectionState;
    if (changed()) return { snapshot: this.snapshotState, timedOut: false };
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (timedOut: boolean) => {
        clearTimeout(timer);
        this.snapshotWaiters.delete(check);
        resolve({ snapshot: this.snapshotState, timedOut });
      };
      const check = () => { if (changed()) finish(false); };
      this.snapshotWaiters.add(check);
      timer = setTimeout(() => finish(true), timeoutMs);
    });
  }

  async connect(room: JoinedRoom, name: string, receive: (snapshot: RoomSnapshot) => void, receiveHands?: (hands: HandPresence[]) => void): Promise<RoomSnapshot> {
    await this.closeTransport();
    this.seenChat.clear();
    this.room = room; this.name = name; this.member = room.member; this.receive = receive; this.receiveHands = receiveHands;
    const uid = this.backend.uid!;
    const saved = await this.repository.getRoomSession(room.roomId, uid);
    const savedIsLegacy = Boolean(saved?.publicState.seats.some(seat => !seat.participantUid));
    const legacyError = savedIsLegacy ? 'O estado salvo desta partida não identifica os participantes. O anfitrião preparará uma nova partida.' : undefined;
    if (saved && savedIsLegacy) {
      await this.repository.deleteRoomSession(room.roomId, uid);
    }
    const validSaved = savedIsLegacy ? undefined : saved;
    this.restoredLocalMatchId = validSaved?.matchId;
    this.localPending = validSaved?.pending;
    if (validSaved) {
      this.publicState = publicGameUpdate(restorePublicMatch(validSaved.publicState)) as MatchState;
      this.confirmedPublicState = this.publicState;
      this.confirmedPrivateState = validSaved.privateState as ReturnType<typeof privateProjection> | undefined;
      this.localState = composeMatchState(this.publicState, room.member.seatId ?? '', room.member.seatId ? this.confirmedPrivateState : undefined);
    }
    this.snapshot = { roomId: room.roomId, code: room.code, name: '', seats: {}, queue: [], online: true, selfUid: uid,
      selfSeatId: room.member.seatId as TableSeatId | undefined, selfRole: room.member.role, generation: room.generation, hostUid: room.hostUid ?? uid,
      connectionState: 'connecting', memberCount: 1, lastError: legacyError };
    this.transport = new PeerTransport(room.roomId, uid, room.hostUid ?? uid, room.generation,
      this.backend.createSignalBus(room.roomId), this.backend.createDataBus(room.roomId),
      this.backend.getIceServers ? () => this.backend.getIceServers!(room.roomId) : undefined);
    this.transport.addEventListener('message', event => {
      const detail = (event as CustomEvent).detail;
      detail.waitUntil(this.onPeerMessage(detail).catch((error: unknown) => { this.patchSnapshot({ lastError: friendly(error) }); throw error; }));
    });
    this.transport.addEventListener('connection-state', event => {
      void event;
      this.refreshConnectionState();
      void this.reconcileDisconnectedPlayers();
      this.maybeStartMatch();
    });
    this.transport.addEventListener('peer-open', event => {
      const { peerUid } = (event as CustomEvent<{ peerUid: string }>).detail;
      this.refreshConnectionState();
      this.checkpointPeers.add(peerUid);
      void this.reconcileDisconnectedPlayers().then(() => this.maybeStartMatch()).then(() => this.flushCheckpoints()).catch(error => this.patchSnapshot({ lastError: friendly(error) }));
    });
    this.transport.addEventListener('authority-changed', event => {
      const change = (event as CustomEvent).detail as { hostUid: string; generation: number };
      this.patchSnapshot({ hostUid: change.hostUid, generation: change.generation, connectionState: 'transferring' });
    });
    this.transport.addEventListener('error', event => this.patchSnapshot({ lastError: (event as CustomEvent).detail instanceof Error ? (event as CustomEvent).detail.message : 'A conexão P2P falhou.' }));
    this.stopWatch = this.backend.watchRoom(room.roomId, (members, metadata, presence) => {
      const previousMembers = this.members;
      this.members = members;
      this.metadata = metadata;
      this.presence = presence;
      this.member = members.find(candidate => candidate.uid === uid) ?? this.member;
      const hostUid = String(metadata.hostUid ?? room.hostUid ?? uid);
      const generation = Number(metadata.generation ?? room.generation);
      if (hostUid !== this.snapshot?.hostUid || generation !== this.snapshot?.generation) {
        this.patchSnapshot({ hostUid, generation, connectionState: 'transferring' });
        this.transport?.setAuthority(hostUid, generation);
      }
      const roster = members.filter(candidate => this.isOnline(candidate.uid)).map(candidate => candidate.uid);
      void this.transport?.start(roster).catch(error => this.patchSnapshot({ lastError: friendly(error) }));
      this.publishMembers(true);
      void this.reconcileDisconnectedPlayers();
      if (this.isHost() && this.publicState?.phase === 'playing') {
        for (const prior of previousMembers) {
          if (!prior.seatId || members.some(member => member.uid === prior.uid && member.seatId)) continue;
          if (!isTableSeat(prior.seatId)) continue;
          const seat = this.publicState.seats.find(candidate => candidate.id === prior.seatId);
          if (seat?.status === 'playing') void this.eliminateDisconnectedSeat(prior.seatId);
        }
      }
      this.maybeStartMatch();
      if (this.publicState?.phase === 'finished' && this.isHost() && !this.resetLock) {
        this.resetLock = true;
        void this.startNextGame(room.roomId).catch(error => this.patchSnapshot({ lastError: friendly(error) })).finally(() => { this.resetLock = false; });
      }
    });
    this.timers.push(setInterval(() => {
      void this.backend.renewHostLease().then(result => {
        if (result.hostUid !== this.snapshot?.hostUid || result.generation !== this.snapshot?.generation) this.transport?.setAuthority(result.hostUid, result.generation);
      }).catch(() => {
        this.patchSnapshot({ online: false, connectionState: 'reconnecting' });
        if (this.snapshot?.generation && Date.now() > Number(this.metadata.hostLeaseUntil ?? 0)) void this.tryHostTransfer();
      });
      this.cleanHands();
    }, 15_000));
    this.publishMembers();
    if (this.publicState) { this.publishState(); this.refreshConnectionState(); }
    return this.snapshot;
  }

  async saveDeck(deck: DeckDefinition): Promise<void> {
    await this.repository.saveDeck(deck);
    this.localDeck = deck;
    const commanders = deck.entries.filter(entry => entry.role === 'commander').map(entry => ({ cardId: entry.cardId, name: entry.name, role: 'commander' as const }));
    await this.backend.saveProfile(deck.name, commanders, this.member?.playmatId);
    this.patchSnapshot({ seats: this.currentSeats() });
    this.maybeStartMatch();
  }

  async setPlaymat(id?: string): Promise<void> {
    if (!this.member?.seatId) throw new Error('Espectadores não podem alterar um lugar.');
    const commanderSummary = this.member.deckSummary;
    await this.backend.saveProfile(this.member.deckName ?? 'Deck Commander', commanderSummary, id);
  }

  async markReady(ready: boolean): Promise<void> {
    await this.backend.setReady(ready);
    this.maybeStartMatch();
  }

  async continueWithout(seatId: string): Promise<void> {
    if (!this.isHost() || !this.publicState || this.publicState.phase !== 'playing' || !this.publicState.disconnectedSeatIds?.includes(seatId)) throw new Error('Somente o anfitrião pode liberar um participante desconectado depois do mulligan.');
    const participantUid = this.publicState.seats.find(seat => seat.id === seatId)?.participantUid;
    const member = this.members.find(candidate => candidate.uid === participantUid);
    if (!member || member.role === 'player' && this.isOnline(member.uid) && this.transport?.connectedPeerUids.includes(member.uid)) throw new Error('Este participante já reconectou.');
    await this.publishControlTransition(state => {
      state.suspendedSeatIds = [...new Set([...(state.suspendedSeatIds ?? []), seatId])];
      state.passes = state.passes.filter(id => id !== seatId);
      if (!state.stack.length && state.activeSeatId === seatId) advanceTurn(state);
    });
  }

  async act(action: GameAction, actionId: string = crypto.randomUUID()): Promise<MatchState> {
    if (!this.localState || !this.publicState || !this.member?.seatId || !isTableSeat(this.member.seatId) || this.member.role !== 'player') throw new Error('Você precisa estar em uma partida e ocupar um lugar para jogar.');
    if (this.actionLock) throw new Error('A última jogada ainda está sincronizando.');
    if (this.snapshot?.connectionState !== 'connected') throw new Error('A mesa está reconectando. Aguarde antes de jogar.');
    this.actionLock = true;
    const previous = this.localState;
    try {
      const next = applyAction(previous, this.member.seatId, action);
      const projection = publicGameUpdate(next, this.member.seatId) as MatchState;
      projection.lastActionId = actionId;
      // The host persists its pending checkpoint in acceptProposal before publishing COMMIT.
      if (!this.isHost()) await this.saveLocalState(this.confirmedPublicState ?? this.publicState, this.confirmedPrivateState ?? privateProjection(previous, this.member.seatId), { actionId, revision: next.revision, publicState: projection, privateState: privateProjection(next, this.member.seatId) });
      this.localState = next;
      if (this.isHost()) {
        const commit = await this.acceptProposal(this.backend.uid!, this.member.seatId, actionId, action.type, projection, previous.revision);
        if (commit) await commit.result;
      } else {
        const committed = this.waitForCommit(actionId, next.revision);
        try {
          await this.transport!.sendToHost('PROPOSE', { actionId, seatId: this.member.seatId, actionType: action.type, state: projection }, previous.revision, actionId);
        } catch (error) { this.rejectCommit(actionId, error instanceof Error ? error : new Error(friendly(error))); }
        await committed;
      }
      return this.localState;
    } catch (error) {
      this.publicState = this.confirmedPublicState ?? this.publicState;
      this.localState = previous;
      await this.saveLocalState(this.publicState, this.confirmedPrivateState);
      this.localState = this.compose(this.publicState);
      throw error;
    } finally { this.actionLock = false; }
  }

  async restoreHistoryState(snapshot: MatchState, expectedRevision: number, operation: 'UNDO' | 'REDO'): Promise<MatchState> {
    if (!this.localState || !this.publicState || !this.member?.seatId || !isTableSeat(this.member.seatId) || this.member.role !== 'player') throw new Error('Você precisa estar em uma partida e ocupar um lugar para desfazer ou refazer.');
    if (this.actionLock) throw new Error('A última jogada ainda está sincronizando.');
    if (this.snapshot?.connectionState !== 'connected') throw new Error('A mesa está reconectando. Aguarde antes de desfazer ou refazer.');
    const current = this.localState;
    if (this.publicState.revision !== expectedRevision || !canRestoreHistory(current, expectedRevision, this.member.seatId)) throw new Error('Só é possível alterar a sua ação mais recente antes de outra ação ser confirmada.');
    this.actionLock = true;
    const actionId = crypto.randomUUID();
    try {
      const next = restoreHistorySnapshot(snapshot, current, this.member.seatId, operation, actionId);
      const projection = publicGameUpdate(next, this.member.seatId) as MatchState;
      projection.lastActionId = actionId;
      if (!this.isHost()) await this.saveLocalState(this.confirmedPublicState ?? this.publicState, this.confirmedPrivateState ?? privateProjection(current, this.member.seatId), {
        actionId, revision: next.revision, publicState: projection, privateState: privateProjection(next, this.member.seatId),
      });
      this.localState = next;
      if (this.isHost()) {
        const commit = await this.acceptProposal(this.backend.uid!, this.member.seatId, actionId, operation, projection, current.revision);
        if (commit) await commit.result;
      } else {
        const committed = this.waitForCommit(actionId, next.revision);
        try { await this.transport!.sendToHost('PROPOSE', { actionId, seatId: this.member.seatId, actionType: operation, state: projection }, current.revision, actionId); }
        catch (error) { this.rejectCommit(actionId, error instanceof Error ? error : new Error(friendly(error))); }
        await committed;
      }
      return this.localState;
    } catch (error) {
      this.publicState = this.confirmedPublicState ?? this.publicState;
      this.localState = current;
      await this.saveLocalState(this.publicState, this.confirmedPrivateState);
      this.localState = this.compose(this.publicState);
      throw error;
    } finally { this.actionLock = false; }
  }

  publishHand(input: HandPresenceInput): void {
    if (!this.transport || !this.publicState || input.matchId !== this.publicState.id || input.seatId !== this.member?.seatId || !isTableSeat(input.seatId) || !isHandPose(input.pose)) return;
    const presence: HandPresence = { ...input, uid: this.backend.uid!, sessionId: this.backend.id, sequence: ++this.presenceSequence, updatedAt: Date.now() };
    if (presence.zone === 'private') { delete presence.cardId; delete presence.x; delete presence.y; }
    this.lastPresence.set(presence.seatId, presence);
    this.transport.sendPresence(presence, presence.sequence);
  }

  async leave(): Promise<void> {
    if (this.isHost() && this.publicState) await this.transport?.sendHost('FINAL_CHECKPOINT', { state: this.publicState }, this.publicState.revision).catch(() => {});
    this.timers.forEach(clearInterval); this.timers = [];
    await this.closeTransport();
    await this.backend.leave();
    this.snapshot = undefined; this.room = undefined; this.publicState = undefined; this.localState = undefined; this.confirmedPublicState = undefined; this.confirmedPrivateState = undefined; this.pending.clear();
    for (const waiter of [...this.snapshotWaiters]) waiter();
  }

  async closeTransport(): Promise<void> {
    this.seenChat.clear();
    this.seenTargets.clear();
    this.checkpointPeers.clear();
    this.finalizing = undefined; this.finalizedState = undefined;
    this.stopWatch?.(); this.stopWatch = undefined;
    this.timers.forEach(clearInterval); this.timers = [];
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('A conexão com a sala terminou.')); }
    this.pending.clear();
    await this.transport?.close(); this.transport = undefined;
  }

  async sendChat(value: string): Promise<void> {
    const text = chatText(value);
    if (!text || !this.room || !this.transport || !this.member?.seatId || this.member.role !== 'player' || !this.snapshot?.online) throw new Error('Não foi possível enviar a mensagem.');
    const chat: ChatMessage = { id: crypto.randomUUID(), uid: this.backend.uid!, seatId: this.member.seatId, text, at: Date.now() };
    if (this.isHost()) await this.broadcastChat(chat);
    else await this.transport.sendToHost('CHAT_SEND', { id: chat.id, text }, this.publicState?.revision ?? 0, chat.id);
  }

  private async broadcastChat(chat: ChatMessage): Promise<void> {
    if (!this.isHost() || !validChatMessage(chat) || this.seenChat.has(chat.id)) return;
    const member = this.members.find(candidate => candidate.uid === chat.uid && candidate.seatId === chat.seatId && candidate.role === 'player');
    if (!member) return;
    this.receiveChat(chat);
    await this.transport?.sendHost('CHAT_BROADCAST', chat, this.publicState?.revision ?? 0, chat.id);
  }

  private receiveChat(chat: ChatMessage): void {
    if (this.seenChat.has(chat.id)) return;
    this.seenChat.add(chat.id);
    if (this.seenChat.size > 256) this.seenChat.delete(this.seenChat.values().next().value!);
    this.dispatchEvent(new CustomEvent<ChatMessage>('chat-message', { detail: { ...chat, at: Date.now() } }));
  }

  async sendTarget(intent: TargetIntent): Promise<void> {
    if (!this.room || !this.transport || !this.publicState || !this.member?.seatId || this.member.role !== 'player' || !this.snapshot?.online || !validTargetIntent(intent, this.publicState)) throw new Error('Não foi possível marcar este alvo.');
    if (this.isHost()) await this.broadcastTarget(intent, this.backend.uid!, this.member.seatId as TableSeatId);
    else await this.transport.sendToHost('TARGET_SEND', intent, this.publicState.revision, intent.id);
  }

  private async broadcastTarget(intent: TargetIntent, uid: string, seatId: TableSeatId): Promise<void> {
    if (!this.isHost() || !this.publicState || !validTargetIntent(intent, this.publicState) || this.seenTargets.has(intent.id)) return;
    if (!this.members.some(member => member.uid === uid && member.seatId === seatId && member.role === 'player')) return;
    const cleanRef = (reference: TargetIntent['target']): TargetIntent['target'] => reference.kind === 'card' ? { kind: 'card', cardId: reference.cardId } : { kind: 'player', seatId: reference.seatId };
    const common = { id: intent.id, matchId: intent.matchId, target: cleanRef(intent.target), uid, seatId, at: Date.now() };
    const mark: TargetMark = intent.kind === 'arrow' ? { ...common, kind: 'arrow', origin: { kind: 'card', cardId: intent.origin.cardId } } : { ...common, kind: 'highlight' };
    this.receiveTarget(mark);
    await this.transport?.sendHost('TARGET_BROADCAST', mark, this.publicState.revision, intent.id);
  }

  private receiveTarget(mark: TargetMark): void {
    if (this.seenTargets.has(mark.id)) return;
    this.seenTargets.add(mark.id);
    if (this.seenTargets.size > 512) this.seenTargets.delete(this.seenTargets.values().next().value!);
    this.dispatchEvent(new CustomEvent<TargetMark>('target-mark', { detail: { ...mark, at: Date.now() } }));
  }

  private async onPeerMessage(detail: { message: Record<string, unknown>; peerUid: string; channel: string }): Promise<void> {
    const { message, peerUid, channel } = detail;
    if (channel === 'table-presence') {
      if (message.type !== 'presence') return;
      if (this.isHost()) {
        this.transport?.relayPresence(peerUid, message.payload, Number(message.revision));
        this.receivePresence(message.payload as HandPresence);
      } else if (peerUid === this.snapshot?.hostUid) {
        const payload = message.payload as { ownerUid?: string; data?: HandPresence };
        this.receivePresence((payload.data ? { ...payload.data, uid: payload.ownerUid } : message.payload) as HandPresence);
      }
      return;
    }
    if (peerUid !== this.snapshot?.hostUid && !this.isHost()) return;
    if (message.type === 'TARGET_SEND' && this.isHost()) {
      const member = this.members.find(candidate => candidate.uid === peerUid && candidate.role === 'player' && isTableSeat(candidate.seatId));
      if (member && this.publicState && validTargetIntent(message.payload, this.publicState)) await this.broadcastTarget(message.payload, peerUid, member.seatId as TableSeatId);
      return;
    }
    if (message.type === 'TARGET_BROADCAST') {
      if (peerUid !== this.snapshot?.hostUid || !this.publicState || !validTargetMark(message.payload, this.publicState)) return;
      const mark = message.payload;
      if (this.members.some(member => member.uid === mark.uid && member.seatId === mark.seatId && member.role === 'player')) this.receiveTarget(mark);
      return;
    }
    if (message.type === 'CHAT_SEND' && this.isHost()) {
      const payload = message.payload as { id?: unknown; text?: unknown } | null;
      const member = this.members.find(candidate => candidate.uid === peerUid && candidate.role === 'player' && isTableSeat(candidate.seatId));
      const text = chatText(payload?.text);
      if (!member || !text || typeof payload?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.id)) return;
      await this.broadcastChat({ id: payload.id, uid: peerUid, seatId: member.seatId!, text, at: Date.now() });
      return;
    }
    if (message.type === 'CHAT_BROADCAST') {
      if (peerUid !== this.snapshot?.hostUid || !validChatMessage(message.payload)) return;
      const chat = message.payload;
      if (!this.members.some(member => member.uid === chat.uid && member.seatId === chat.seatId && member.role === 'player')) return;
      this.receiveChat(chat);
      return;
    }
    if (message.type === 'START') {
      await this.initializePrivateState(message.payload as MatchState);
      return;
    }
    if (message.type === 'LOBBY') {
      this.publicState = undefined;
      this.localState = undefined;
      this.confirmedPublicState = undefined;
      this.confirmedPrivateState = undefined;
      this.restoredLocalMatchId = undefined;
      await this.repository.deleteRoomSession(this.room!.roomId, this.backend.uid!);
      this.patchSnapshot({ state: undefined, gameReady: false, connectionState: 'connected' });
      return;
    }
    if (message.type === 'SNAPSHOT' || message.type === 'COMMIT' || message.type === 'CONTROL') {
      const payload = message.payload as PublicCommit;
      const sanitized = sanitizePublicState(payload.state);
      const participantSeat = sanitized.seats.find(seat => seat.participantUid === this.backend.uid);
      const legacy = sanitized.seats.some(seat => !seat.participantUid);
      if (message.type === 'SNAPSHOT' && legacy) {
        this.patchSnapshot({ lastError: 'Esta partida usa um estado anterior sem identidade dos participantes. O anfitrião iniciou uma nova partida por segurança.' });
        if (this.isHost() && this.room) await this.startNextGame(this.room.roomId);
        return;
      }
      if (message.type === 'SNAPSHOT' && this.member?.role === 'player' && this.member.seatId && (!participantSeat || participantSeat.id !== this.member.seatId || (this.restoredLocalMatchId !== sanitized.id || !this.confirmedPrivateState))) {
        const seatId = this.member.seatId as TableSeatId;
        if (participantSeat && participantSeat.id === seatId) {
          await this.backend.losePrivate(this.room!.roomId);
          this.patchSnapshot({ lastError: 'Os dados privados desta partida não estão neste dispositivo. Você poderá jogar na próxima partida.' });
          if (this.isHost()) await this.publishControlTransition(state => { state.suspendedSeatIds = [...new Set([...(state.suspendedSeatIds ?? []), seatId])]; state.disconnectedSeatIds = [...new Set([...(state.disconnectedSeatIds ?? []), seatId])]; state.paused = state.phase === 'mulligan' || eligibleSeats(state).length === 0; });
          else await this.transport?.sendToHost('PRIVATE_LOST', { seatId }, sanitized.revision, `private-lost-${this.backend.uid}`);
        }
        this.member = { ...this.member, role: 'spectator', seatId: null, ready: false };
        this.patchSnapshot({ selfSeatId: undefined, selfRole: 'spectator' });
        return;
      }
      if (this.localPending && sanitized.id === this.localPending.publicState.id) {
        if (sanitized.lastActionId === this.localPending.actionId && this.localPending.privateState) {
          this.confirmedPrivateState = this.localPending.privateState as ReturnType<typeof privateProjection>;
          this.localState = this.member?.seatId ? composeMatchState(sanitized, this.member.seatId, this.confirmedPrivateState) : sanitized;
        }
        this.localPending = undefined;
      }
      if (this.publicState && sanitized.id === this.publicState.id && sanitized.revision < this.publicState.revision) return;
      this.publicState = sanitized;
      this.localState = this.compose(sanitized);
      if (message.type === 'COMMIT') await this.saveLocalState(this.confirmedPublicState ?? sanitized, this.confirmedPrivateState ?? this.privateState(), {
        actionId: payload.actionId, revision: sanitized.revision, publicState: sanitized,
        ...(payload.actorUid === this.backend.uid && this.privateState() ? { privateState: this.privateState() } : {}),
      });
      else await this.saveLocalState(sanitized, this.privateState());
      this.publishState();
      if (message.type === 'COMMIT' && !this.isHost()) await this.transport?.sendToHost('ACK', { actionId: payload.actionId, revision: sanitized.revision }, sanitized.revision, `ack-${payload.actionId}`);
      if (message.type === 'SNAPSHOT' && !this.isHost() && this.member?.role === 'player' && participantSeat?.id === this.member.seatId && this.confirmedPrivateState) {
        await this.transport?.sendToHost('RESTORED', { matchId: sanitized.id, seatId: participantSeat.id, revision: sanitized.revision }, sanitized.revision, `restored-${sanitized.revision}`);
      }
      return;
    }
    if (message.type === 'PROPOSE' && this.isHost()) {
      const proposal = message.payload as { actionId: string; seatId: TableSeatId; actionType: StateTransitionType; state: MatchState };
      const actor = this.members.find(member => member.uid === peerUid);
      if (!actor || actor.role !== 'player' || actor.seatId !== proposal.seatId || !this.publicState) return;
      try { await this.acceptProposal(peerUid, proposal.seatId, proposal.actionId, proposal.actionType, proposal.state, Number(message.revision)); }
      catch (error) { await this.transport?.sendHost('REJECT', { actionId: proposal.actionId, message: friendly(error) }, Number(message.revision), `reject-${proposal.actionId}`).catch(() => {}); }
      return;
    }
    if (message.type === 'PRIVATE_LOST' && this.isHost()) {
      const payload = message.payload as { seatId?: TableSeatId };
      const member = this.members.find(candidate => candidate.uid === peerUid);
      if (member && !member.seatId && payload.seatId && this.publicState?.seats.some(seat => seat.id === payload.seatId && seat.status === 'playing')) {
        await this.publishControlTransition(state => {
          state.disconnectedSeatIds = [...new Set([...(state.disconnectedSeatIds ?? []), payload.seatId!])];
          state.paused = state.phase === 'mulligan' || !(state.suspendedSeatIds ?? []).includes(payload.seatId!);
        });
      }
      return;
    }
    if (message.type === 'RESTORED' && this.isHost()) {
      const payload = message.payload as { matchId?: string; seatId?: string; revision?: number };
      const seat = this.publicState?.seats.find(candidate => candidate.id === payload.seatId && candidate.participantUid === peerUid);
      if (!seat || payload.matchId !== this.publicState?.id || payload.revision !== this.publicState?.revision || !this.transport?.connectedPeerUids.includes(peerUid)) return;
      if ((this.publicState?.suspendedSeatIds ?? []).includes(seat.id) || (this.publicState?.disconnectedSeatIds ?? []).includes(seat.id)) {
        await this.publishControlTransition(state => {
          state.suspendedSeatIds = (state.suspendedSeatIds ?? []).filter(id => id !== seat.id);
          state.disconnectedSeatIds = (state.disconnectedSeatIds ?? []).filter(id => id !== seat.id);
        });
      }
      return;
    }
    if (message.type === 'ACK' && this.isHost()) {
      const payload = message.payload as { actionId: string; revision: number };
      const pending = this.pending.get(payload.actionId);
      if (pending?.revision === payload.revision) { pending.acknowledged.add(peerUid); this.finishCommitIfReady(payload.actionId); }
      return;
    }
    if (message.type === 'CONFIRMED') {
      const payload = message.payload as { actionId: string; revision: number };
      const pending = this.pending.get(payload.actionId);
      if (pending?.revision === payload.revision || this.publicState?.revision === payload.revision) {
        if (pending) await this.resolveCommit(payload.actionId);
        else await this.finalizePublicState();
      }
    }
    if (message.type === 'REJECT' && peerUid === this.snapshot?.hostUid) {
      const payload = message.payload as { actionId: string; message: string };
      this.rejectCommit(payload.actionId, new Error(payload.message || 'O anfitrião recusou esta jogada.'));
    }
  }

  private async acceptProposal(actorUid: string, seatId: TableSeatId, actionId: string, actionType: StateTransitionType, proposal: MatchState, baseRevision: number): Promise<PendingCommit | undefined> {
    if (!this.publicState || baseRevision !== this.publicState.revision || proposal.id !== this.publicState.id || proposal.revision !== baseRevision + 1 || proposal.lastActionId !== actionId) throw new Error('A mesa recebeu uma revisão antiga. Sincronize e tente novamente.');
    if (this.seenActions.has(actionId)) {
      if (this.pending.has(actionId)) return;
      const priorRevision = this.seenActions.get(actionId)!;
      await this.transport?.sendHost('CONFIRMED', { actionId, revision: priorRevision }, priorRevision, `confirmed-${actionId}`).catch(() => {});
      return;
    }
    if (this.pending.size) throw new Error('A mesa ainda está confirmando a jogada anterior. Aguarde a sincronização.');
    const next = sanitizePublicState(proposal);
    validateTransition(this.publicState, next, actorUid, seatId, actionType);
    this.seenActions.set(actionId, next.revision);
    if (this.seenActions.size > 512) this.seenActions.delete(this.seenActions.keys().next().value!);
    this.publicState = next;
    this.localState = this.compose(next);
    const expected = new Set(this.members.filter(member => member.role === 'player' && member.seatId && member.uid !== actorUid && this.isOnline(member.uid) && this.transport?.connectedPeerUids.includes(member.uid)).map(member => member.uid));
    expected.add(actorUid);
    const pending = this.makePending(actionId, next.revision, expected);
    pending.acknowledged.add(this.backend.uid!);
    await this.saveLocalState(this.confirmedPublicState ?? next, this.confirmedPrivateState, { actionId, revision: next.revision, publicState: next,
      ...(actorUid === this.backend.uid && this.privateState() ? { privateState: this.privateState() } : {}) });
    this.publishState();
    await this.transport?.sendHost('COMMIT', { state: next, actorUid, actorSeatId: seatId, actionId, actionType }, next.revision, actionId);
    this.finishCommitIfReady(actionId);
    return pending;
  }

  private async initializePrivateState(raw: MatchState): Promise<void> {
    const state = sanitizePublicState(raw);
    this.publicState = state;
    if (this.member?.role === 'player' && this.member.seatId) {
      if (!this.localDeck) this.localDeck = (await this.repository.getDecks()).find(deck => deck.id === this.member!.seatId || deck.name === this.member!.deckName) ?? (await this.repository.getDecks())[0];
      if (this.localDeck) {
        const entrants = state.seats.map(matchSeat => {
          const participant = this.members.find(member => member.uid === matchSeat.participantUid && member.seatId === matchSeat.id);
          return { seatId: matchSeat.id, name: matchSeat.name, participantUid: matchSeat.participantUid, deck: matchSeat.id === this.member!.seatId ? this.localDeck! : makePlaceholderDeck(matchSeat.id, matchSeat.name, participant?.deckSummary ?? []) };
        });
        const local = newMatch(entrants, parseInt(state.id.replace('match-', ''), 36) || state.updatedAt);
        this.localState = this.mergePrivate(local, state);
      } else this.localState = state;
    } else this.localState = state;
    this.publicState = state;
    await this.saveLocalState(state, this.privateState());
    this.localState = this.compose(state);
    this.publishState();
  }

  private async maybeStartMatch(): Promise<void> {
    if (!this.isHost() || this.startLock || this.publicState || !this.transport) return;
    const players = this.members.filter(member => member.role === 'player' && member.seatId);
    if (players.length === 0 || !players.every(member => member.ready && member.deckSummary?.length) || players.some(member => !this.transport?.connectedPeerUids.includes(member.uid) && member.uid !== this.backend.uid)) return;
    this.startLock = true;
    try {
      const storedDecks = await this.repository.getDecks();
      const entrants = SEATS.flatMap(seatId => {
        const member = players.find(candidate => candidate.seatId === seatId);
        if (!member) return [];
        const ownDeck = member.uid === this.backend.uid ? this.localDeck ?? storedDecks.find(deck => deck.name === member.deckName) ?? storedDecks[0] : undefined;
        return [{ seatId, name: member.name, participantUid: member.uid, deck: ownDeck ?? makePlaceholderDeck(seatId, member.deckName ?? member.name, member.deckSummary ?? []) }];
      });
      if (!entrants.length || entrants.some(entrant => !entrant.deck)) return;
      const match = newMatch(entrants);
      const publicState = publicProjection(match) as MatchState;
      this.localState = match;
      await this.saveLocalState(publicState, this.member?.seatId ? privateProjection(match, this.member.seatId) : undefined);
      await this.backend.setPhase('playing');
      this.publicState = publicState;
      this.localState = this.compose(publicState);
      this.publishState();
      const startedPeers = this.transport.connectedPeerUids;
      await this.transport.sendHost('START', this.publicState, this.publicState.revision);
      for (const uid of startedPeers) this.checkpointPeers.delete(uid);
    } catch (error) { this.patchSnapshot({ lastError: `Não foi possível iniciar a partida. ${friendly(error)}` }); }
    finally { this.startLock = false; await this.flushCheckpoints(); }
  }

  private async flushCheckpoints(): Promise<void> {
    if (this.startLock || !this.publicState) return;
    for (const uid of [...this.checkpointPeers]) {
      this.checkpointPeers.delete(uid);
      await this.sendCheckpointToPeer(uid);
    }
  }

  private async sendCheckpointToPeer(uid: string): Promise<void> {
    if (!this.isHost() || !this.publicState || !this.transport) return;
    if (!this.members.some(member => member.uid === uid) || !this.transport.connectedPeerUids.includes(uid)) return;
    await this.transport.sendToPeer(uid, 'SNAPSHOT', { state: this.publicState }, this.publicState.revision).catch(() => {});
  }

  private waitForCommit(id: string, revision: number): Promise<void> {
    return this.makePending(id, revision, new Set()).result;
  }

  private makePending(id: string, revision: number, expected: Set<string>): PendingCommit {
    const existing = this.pending.get(id);
    if (existing) { existing.expected = expected; return existing; }
    let resolve = () => {};
    let reject = (_error: Error) => {};
    const result = new Promise<void>((ok, bad) => { resolve = ok; reject = bad; });
    void result.catch(() => {});
    const timer = setTimeout(() => { this.rejectCommit(id, new Error('Nem todos os jogadores receberam a confirmação. A partida ficará pausada até sincronizar.')); }, 12_000);
    const value = { id, revision, expected, acknowledged: new Set<string>(), resolve, reject, timer, result };
    this.pending.set(id, value);
    return value;
  }

  private finishCommitIfReady(id: string): void {
    const pending = this.pending.get(id);
    if (!pending || [...pending.expected].some(uid => !pending.acknowledged.has(uid))) return;
    void this.resolveCommit(id).catch(error => this.rejectCommit(id, error instanceof Error ? error : new Error(friendly(error))));
  }
  private async resolveCommit(id: string): Promise<void> {
    const pending = this.pending.get(id); if (!pending) return;
    if (pending.finishing) return pending.finishing;
    clearTimeout(pending.timer);
    pending.finishing = (async () => {
      await this.finalizePublicState();
      if (this.isHost()) await this.transport?.sendHost('CONFIRMED', { actionId: id, revision: pending.revision }, pending.revision, 'confirmed-' + id).catch(() => {});
      this.pending.delete(id);
      pending.resolve();
      void this.drainPendingEliminations();
    })();
    return pending.finishing;
  }
  private rejectCommit(id: string, error: Error): void { const pending = this.pending.get(id); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(id); pending.reject(error); this.patchSnapshot({ lastError: error.message, connectionState: 'reconnecting' }); void this.drainPendingEliminations(); }
  private privateState(): ReturnType<typeof privateProjection> | undefined {
    if (!this.localState || !this.member?.seatId) return undefined;
    return privateProjection(this.localState, this.member.seatId);
  }
  private compose(state: MatchState): MatchState { return composeMatchState(state, this.member?.seatId ?? '', this.privateState()); }
  private mergePrivate(local: MatchState, remote: MatchState): MatchState {
    const merged = structuredClone(remote);
    merged.cards = { ...merged.cards, ...Object.fromEntries(Object.entries(local.cards).filter(([, card]) => card.ownerId === this.member?.seatId && (card.zone === 'hand' || card.zone === 'library' || card.faceDown))) };
    const own = merged.seats.find(seat => seat.id === this.member?.seatId);
    const localOwn = local.seats.find(seat => seat.id === this.member?.seatId);
    if (own && localOwn) Object.assign(own, { hand: localOwn.hand, library: localOwn.library, commanderCasts: localOwn.commanderCasts, mulligans: localOwn.mulligans, keptHand: localOwn.keptHand });
    return merged;
  }
  private async saveLocalState(state: MatchState, privateState?: unknown, pending?: { actionId: string; revision: number; publicState: MatchState; privateState?: unknown }): Promise<void> {
    const uid = this.backend.uid;
    const room = this.room;
    if (!room || !uid) return;
    // The repository owns the serialization boundary and returns an isolated checkpoint.
    const saved = await this.repository.saveRoomSession({ roomId: room.roomId, uid, matchId: state.id, revision: state.revision,
      publicState: state, privateState, ...(pending ? { pending } : {}) });
    if (this.room !== room || this.backend.uid !== uid) return;
    if (privateState) this.restoredLocalMatchId = state.id;
    if (!pending) {
      this.confirmedPublicState = saved.publicState;
      this.confirmedPrivateState = saved.privateState as ReturnType<typeof privateProjection> | undefined;
      this.localPending = undefined;
    } else {
      this.localPending = saved.pending;
    }
  }
  private finalizePublicState(): Promise<void> {
    const state = this.publicState;
    if (!state || this.finalizedState === state && !this.localPending) return Promise.resolve();
    if (this.finalizing?.state === state) return this.finalizing.promise;
    const promise = this.saveLocalState(state, this.privateState()).then(() => { if (this.publicState === state) this.finalizedState = state; })
      .finally(() => { if (this.finalizing?.state === state) this.finalizing = undefined; });
    this.finalizing = { state, promise };
    return promise;
  }
  private publishState(): void {
    if (!this.snapshot || !this.publicState) return;
    this.patchSnapshot({ state: this.localState, gameReady: true, connectionState: 'connected', lastError: undefined });
  }

  private async reconcileDisconnectedPlayers(): Promise<void> {
    if (!this.isHost() || !this.publicState || this.publicState.phase === 'finished' || this.controlLock) return;
    const detected = this.publicState.seats.filter(seat => seat.status === 'playing' && seat.participantUid && seat.participantUid !== this.backend.uid)
      .filter(seat => {
        const member = this.members.find(candidate => candidate.uid === seat.participantUid);
        return Boolean(member && (member.role !== 'player' || member.seatId !== seat.id || !this.isOnline(member.uid) || !this.transport?.connectedPeerUids.includes(member.uid)));
      }).map(seat => seat.id);
    const prior = this.publicState.disconnectedSeatIds ?? [];
    const disconnected = [...new Set([...detected, ...prior.filter(id => this.publicState?.seats.some(seat => seat.id === id && this.members.some(member => member.uid === seat.participantUid) && seat.status === 'playing'))])];
    if (disconnected.length === prior.length && disconnected.every(id => prior.includes(id))) return;
    if (this.publicState.phase === 'mulligan' && disconnected.length) {
      await this.publishControlTransition(state => { state.disconnectedSeatIds = disconnected; state.paused = true; });
      return;
    }
    await this.publishControlTransition(state => {
      state.disconnectedSeatIds = disconnected;
      state.paused = disconnected.some(id => !(state.suspendedSeatIds ?? []).includes(id));
      if (!state.paused && state.stack.length === 0 && !eligibleSeats(state).some(seat => seat.id === state.activeSeatId)) advanceTurn(state);
    });
  }

  private async publishControlTransition(change: (state: MatchState) => void): Promise<void> {
    if (!this.isHost() || !this.publicState || this.controlLock) return;
    this.controlLock = true;
    try {
      if (this.pending.size) {
        const unavailable = new Set((this.publicState?.seats ?? []).filter(seat => seat.participantUid && seat.participantUid !== this.backend.uid)
          .filter(seat => !this.isOnline(seat.participantUid!) || !this.transport?.connectedPeerUids.includes(seat.participantUid!)).flatMap(seat => seat.participantUid ? [seat.participantUid] : []));
        for (const [id, pending] of this.pending) {
          for (const uid of unavailable) pending.expected.delete(uid);
          this.finishCommitIfReady(id);
        }
        await Promise.all([...this.pending.values()].map(pending => pending.result.catch(() => {})));
      }
      const previous = this.publicState;
      const next = structuredClone(previous);
      change(next);
      next.paused = next.phase === 'mulligan'
        ? (next.disconnectedSeatIds ?? []).length > 0
        : (next.disconnectedSeatIds ?? []).some(id => !(next.suspendedSeatIds ?? []).includes(id)) || eligibleSeats(next).length === 0;
      next.revision++;
      next.updatedAt = Date.now();
      next.log.push({ id: `${next.id}-${next.revision}`, actorId: this.member?.seatId ?? '', message: next.paused
        ? `Partida pausada enquanto ${next.disconnectedSeatIds?.map(id => next.seats.find(seat => seat.id === id)?.name).filter(Boolean).join(', ')} reconecta.`
        : `Estado de conexão atualizado pelo anfitrião.`, at: next.updatedAt, public: true });
      next.lastActionId = `control-${next.revision}`;
      this.publicState = publicGameUpdate(next) as MatchState;
      this.localState = this.compose(this.publicState);
      await this.saveLocalState(this.publicState, this.privateState());
      this.publishState();
      await this.transport?.sendHost('CONTROL', { state: this.publicState }, this.publicState.revision, `control-${this.publicState.revision}`);
    } finally { this.controlLock = false; }
  }
  private publishMembers(membersReady = false): void {
    if (!this.snapshot) return;
    this.snapshot.name = String(this.metadata.name ?? 'Mesa');
    this.snapshot.hostUid = String(this.metadata.hostUid ?? this.backend.uid);
    this.snapshot.generation = Number(this.metadata.generation ?? this.snapshot.generation);
    this.snapshot.memberCount = this.members.length;
    const seats = Object.fromEntries(this.members.filter(member => member.seatId).map(member => [member.seatId!, {
      uid: member.uid, name: member.name, seatId: member.seatId, online: this.isOnline(member.uid), joinedAt: member.joinedAt,
      ready: member.ready, deckName: member.deckName, deckSummary: member.deckSummary as DeckDefinition['entries'], playmatId: member.playmatId,
    }])) as PeerRoomSnapshot['seats'];
    const queue = this.members.filter(member => !member.seatId).sort((first, second) => first.joinedAt - second.joinedAt || first.uid.localeCompare(second.uid))
      .map((member, index) => ({ uid: member.uid, name: member.name, requestedAt: member.joinedAt, position: index + 1, online: this.isOnline(member.uid) }));
    this.patchSnapshot({ seats, queue, membersReady: membersReady || this.snapshot.membersReady, selfSeatId: this.member?.seatId as TableSeatId | undefined, selfRole: this.member?.role, queuePosition: queue.find(item => item.uid === this.backend.uid)?.position });
    this.refreshConnectionState();
  }
  private refreshConnectionState(): void {
    if (!this.snapshot) return;
    const missingRosterPeer = this.isHost()
      ? this.members.some(member => member.uid !== this.backend.uid && this.isOnline(member.uid) && !this.transport?.connectedPeerUids.includes(member.uid))
      : Boolean(this.snapshot.hostUid && this.members.some(member => member.uid === this.snapshot?.hostUid && this.isOnline(member.uid) && !this.transport?.connectedPeerUids.includes(member.uid)));
    const players = this.members.filter(member => member.role === 'player' && member.seatId);
    const missingPresence = players.some(member => !this.isOnline(member.uid));
    const reconnecting = missingRosterPeer || missingPresence;
    const relayed = this.transport?.relayPeerUids.length ?? 0;
    const direct = (this.transport?.connectedPeerUids.length ?? 0) - relayed;
    const transport = this.transport?.connectedPeerUids.length ? relayed && direct ? 'mixed' : relayed ? 'firebase' : 'p2p' : undefined;
    this.patchSnapshot({ connectionState: reconnecting ? 'reconnecting' : this.snapshot.hostUid === this.backend.uid && this.members.length === 1 ? 'connected' : this.transport?.connectedPeerUids.length || this.isHost() ? 'connected' : 'connecting', online: true, transport,
      lastError: reconnecting ? this.snapshot.lastError : undefined });
  }
  private isOnline(uid: string): boolean { return Object.values(this.presence[uid] ?? {}).some(session => session.online === true); }
  private isHost(): boolean { return this.snapshot?.hostUid === this.backend.uid; }
  private currentSeats(): PeerRoomSnapshot['seats'] { return this.snapshot?.seats ?? {}; }
  private receivePresence(hand: HandPresence): void {
    if (!isTableSeat(hand.seatId) || !isHandPose(hand.pose) || hand.uid === this.backend.uid || hand.matchId !== this.publicState?.id || !this.isOnline(hand.uid)) return;
    const prior = this.lastPresence.get(hand.seatId);
    if (prior && (hand.sequence < prior.sequence || hand.sequence === prior.sequence && hand.updatedAt <= prior.updatedAt)) return;
    this.lastPresence.set(hand.seatId, hand);
    this.emitHands();
  }
  private emitHands(): void {
    const hands = [...this.lastPresence.values()].filter(hand => !handPresenceStale(hand));
    this.receiveHands?.(hands);
  }
  private cleanHands(): void {
    for (const [seatId, hand] of this.lastPresence) if (handPresenceStale(hand)) this.lastPresence.delete(seatId);
    this.emitHands();
  }
  private async tryHostTransfer(): Promise<void> {
    try {
      const next = await this.backend.claimHost(this.room!.roomId);
      this.transport?.setAuthority(next.hostUid, next.generation);
    } catch { /* Another live participant remains eligible or has already taken over. */ }
  }
  private async startNextGame(roomId: string): Promise<void> {
    await this.backend.resetLobby(roomId);
    await this.transport?.sendHost('LOBBY', {}, this.publicState?.revision ?? 0).catch(() => {});
    this.publicState = undefined;
    this.localState = undefined;
    this.confirmedPublicState = undefined;
    this.confirmedPrivateState = undefined;
    this.restoredLocalMatchId = undefined;
    await this.repository.deleteRoomSession(roomId, this.backend.uid!);
    this.patchSnapshot({ state: undefined, gameReady: false });
    setTimeout(() => { void this.maybeStartMatch(); }, 500);
  }
  private async eliminateDisconnectedSeat(seatId: TableSeatId): Promise<void> {
    if (!this.isHost() || !this.publicState || !['playing', 'mulligan'].includes(this.publicState.phase)) return;
    if (this.pending.size) { this.pendingEliminations.add(seatId); return; }
    const seat = this.publicState.seats.find(candidate => candidate.id === seatId);
    if (!seat || seat.status !== 'playing') return;
    const next = publicGameUpdate(applyAction(this.compose(this.publicState), seatId, { type: 'CONCEDE' }), seatId) as MatchState;
    const actionId = crypto.randomUUID();
    next.lastActionId = actionId;
    this.publicState = next;
    this.localState = this.compose(next);
    const expected = new Set(this.members.filter(member => member.role === 'player' && member.seatId && member.uid !== this.backend.uid && this.isOnline(member.uid) && this.transport?.connectedPeerUids.includes(member.uid)).map(member => member.uid));
    const pending = this.makePending(actionId, next.revision, expected);
    pending.acknowledged.add(this.backend.uid!);
    await this.saveLocalState(this.confirmedPublicState ?? next, this.confirmedPrivateState, { actionId, revision: next.revision, publicState: next });
    this.publishState();
    await this.transport?.sendHost('COMMIT', { state: next, actorUid: this.backend.uid, actorSeatId: this.member?.seatId ?? seatId, actionId, actionType: 'CONCEDE' }, next.revision, actionId);
    this.finishCommitIfReady(actionId);
  }
  private async drainPendingEliminations(): Promise<void> {
    if (!this.isHost() || this.pending.size || !this.pendingEliminations.size) return;
    const next = this.pendingEliminations.values().next().value as TableSeatId | undefined;
    if (!next) return;
    this.pendingEliminations.delete(next);
    await this.eliminateDisconnectedSeat(next);
  }
  private patchSnapshot(fields: Partial<PeerRoomSnapshot>): void {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, ...fields };
    this.receive?.(this.snapshot);
    for (const waiter of [...this.snapshotWaiters]) waiter();
  }
}

function makePlaceholderDeck(seatId: string, name: string, summary: NonNullable<RoomMember['deckSummary']>): DeckDefinition {
  const commanders = summary.slice(0, 2).map(entry => ({ ...entry, quantity: 1 as const, role: 'commander' as const }));
  if (commanders.length === 0) commanders.push({ cardId: `covered-${seatId}-commander`, name: 'Comandante', quantity: 1, role: 'commander' });
  const fillers = Array.from({ length: 100 - commanders.length }, (_, index) => ({ cardId: `covered-${seatId}-${index}`, name: 'Carta oculta', quantity: 1, role: 'library' as const }));
  return { id: `seat-${seatId}`, name: name || 'Deck Commander', format: 'commander', commanders: commanders.map(entry => entry.cardId), entries: [...commanders, ...fillers], updatedAt: Date.now() };
}

const ACTION_TYPES = new Set<StateTransitionType>(['DRAW', 'MULLIGAN', 'KEEP_HAND', 'PLAY_LAND', 'REPOSITION_CARD', 'MOVE_CARD', 'TAP', 'SET_LIFE', 'CHANGE_COUNTER', 'ADJUST_COMMANDER_DAMAGE', 'COMMANDER_DAMAGE', 'FLIP_FACE', 'SET_FACE_DOWN', 'CAST', 'CAST_ABILITY', 'PASS_PRIORITY', 'RESOLVE_TOP', 'PHASE', 'ADVANCE_TURN', 'SHUFFLE', 'REVEAL', 'SEARCH_LIBRARY', 'CREATE_TOKEN', 'TRANSFER_CONTROL', 'CONCEDE', 'UNDO', 'REDO']);

function sanitizePublicState(value: MatchState): MatchState {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.seats) || value.seats.length < 1 || value.seats.length > 4 || new Set(value.seats.map(seat => seat.id)).size !== value.seats.length || !value.cards || typeof value.cards !== 'object') throw new Error('O estado público da mesa é inválido.');
  if (JSON.stringify(value).length > 4 * 1024 * 1024) throw new Error('O estado público excede o tamanho permitido.');
  for (const seat of value.seats) {
    if (Object.hasOwn(seat, 'hand') || Object.hasOwn(seat, 'library') || !Number.isFinite(seat.life) || seat.id !== 'northWest' && seat.id !== 'northEast' && seat.id !== 'southEast' && seat.id !== 'southWest') throw new Error('A projeção pública contém dados privados ou lugares inválidos.');
  }
  if (value.seats.some(seat => seat.participantUid !== undefined && (typeof seat.participantUid !== 'string' || !seat.participantUid)) || new Set(value.seats.flatMap(seat => seat.participantUid ? [seat.participantUid] : [])).size !== value.seats.filter(seat => seat.participantUid).length) throw new Error('A identidade dos participantes da mesa é inválida.');
  for (const [id, card] of Object.entries(value.cards)) {
    const publicToken = card.card?.type_line?.includes('Token') === true;
    if (id !== card.id || !publicToken && card.cardId !== 'face-down' && id.includes(card.cardId) || card.faceDown && (card.cardId !== 'face-down' || card.card !== undefined) || card.zone === 'hand' || card.zone === 'library') throw new Error('Uma carta pública contém identidade oculta.');
  }
  const normalized = restorePublicMatch(value);
  // Normalization supplies defaults for composition, but the shared snapshot must stay public.
  return { ...normalized, seats: normalized.seats.map(({ hand: _hand, library: _library, ...seat }) => seat) } as MatchState;
}

function validateTransition(previous: MatchState, next: MatchState, actorUid: string, seatId: TableSeatId, actionType: StateTransitionType): void {
  if (!ACTION_TYPES.has(actionType) || !next.seats.some(seat => seat.id === seatId && seat.participantUid === actorUid && (seat.status === 'playing' || (actionType === 'UNDO' || actionType === 'REDO') && seat.status === 'eliminated'))) throw new Error('A jogada não é permitida para este lugar.');
  if ((actionType === 'UNDO' || actionType === 'REDO') && (previous.log.at(-1)?.actorId !== seatId || next.log.at(-1)?.actorId !== seatId)) throw new Error('Só é possível desfazer ou refazer sua ação mais recente.');
  if (next.seats.some(seat => !previous.seats.some(prior => prior.id === seat.id && prior.name === seat.name))) throw new Error('A jogada alterou os participantes da mesa.');
  if (JSON.stringify(next.seats.map(seat => [seat.id, seat.participantUid])) !== JSON.stringify(previous.seats.map(seat => [seat.id, seat.participantUid])) || JSON.stringify(next.suspendedSeatIds ?? []) !== JSON.stringify(previous.suspendedSeatIds ?? []) || JSON.stringify(next.disconnectedSeatIds ?? []) !== JSON.stringify(previous.disconnectedSeatIds ?? []) || next.paused !== previous.paused) throw new Error('Somente o anfitrião pode alterar a participação e a conexão da partida.');
  const before = previous.hiddenZones ?? {};
  const after = next.hiddenZones ?? {};
  for (const id of SEATS) {
    const left = before[id]; const right = after[id];
    if (Boolean(left) !== Boolean(right)) throw new Error('A jogada alterou os lugares ocupados.');
    if (!left && !right) continue;
    if ([right!.hand, right!.library, right!.graveyard, right!.exile].some(value => !Number.isInteger(value) || value < 0 || value > 100)) throw new Error('A jogada alterou contagens privadas inválidas.');
    if (id !== seatId && (left!.hand !== right!.hand || left!.library !== right!.library)) throw new Error('A jogada alterou as contagens privadas de outro jogador.');
    const publicCards = Object.values(next.cards).filter(card => card.ownerId === id);
    if (right!.graveyard !== publicCards.filter(card => card.zone === 'graveyard').length || right!.exile !== publicCards.filter(card => card.zone === 'exile').length) throw new Error('A jogada alterou contagens de zonas públicas inválidas.');
  }
  if (!actorUid) throw new Error('A jogada perdeu a identidade de quem a enviou.');
}

function friendly(error: unknown): string { return error instanceof Error ? error.message : 'A mesa não pôde ser atualizada.'; }

export const peerRoom = new PeerRoom();
