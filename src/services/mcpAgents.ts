import { z } from 'zod';
import type { GameAction, MatchState } from '../domain/game';
import { MatchHistory } from '../domain/history';
import { validateDeck } from '../domain/deck';
import { validPlaymatId } from './playmats';
import { PeerRoom } from './peerRoom';
import { RoomBackend, type JoinedRoom } from './roomBackend';
import { localRepository } from './storage';

const seats = ['northWest', 'northEast', 'southEast', 'southWest'] as const;
const zones = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command', 'stack'] as const;
const point = z.number().finite().min(0).max(2000);
const cardFaceSchema = z.object({ name: z.string().max(160), mana_cost: z.string().max(128), type_line: z.string().max(160), oracle_text: z.string().max(10000), power: z.string().max(32).optional(), toughness: z.string().max(32).optional(), image_uris: z.record(z.string(), z.string().max(4096)).optional() }).passthrough();
const tokenDefinitionSchema = z.object({
  id: z.string().max(128), oracle_id: z.string().max(128), name: z.string().min(1).max(160), layout: z.string().max(32),
  color_identity: z.array(z.string().max(2)).max(6), keywords: z.array(z.string().max(80)).max(64), mana_cost: z.string().max(128),
  type_line: z.string().max(160).refine(value => value.includes('Token') && value.includes('Creature')),
  oracle_text: z.string().max(10000), power: z.string().max(32).optional(), toughness: z.string().max(32).optional(),
  image_uris: z.record(z.string(), z.string().max(4096)).optional(), card_faces: z.array(cardFaceSchema).max(4).optional(),
  legalities: z.record(z.string(), z.string().max(32)), scryfall_uri: z.string().max(2048).optional(),
}).passthrough();
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DRAW'), amount: z.number().int().min(1).max(10).optional() }),
  z.object({ type: z.literal('MULLIGAN') }),
  z.object({ type: z.literal('KEEP_HAND'), bottomCardIds: z.array(z.string()).max(7).optional() }),
  z.object({ type: z.literal('PLAY_LAND'), cardId: z.string(), x: point.optional(), y: point.optional() }),
  z.object({ type: z.literal('REPOSITION_CARD'), cardId: z.string(), x: point, y: point }),
  z.object({ type: z.literal('MOVE_CARD'), cardId: z.string(), zone: z.enum(zones), x: point.optional(), y: point.optional(), libraryPosition: z.enum(['top', 'bottom']).optional() }),
  z.object({ type: z.literal('TAP'), cardId: z.string() }),
  z.object({ type: z.literal('SET_LIFE'), amount: z.number().int().min(-1000).max(1000), seatId: z.string().optional() }),
  z.object({ type: z.literal('CHANGE_COUNTER'), counter: z.string().min(1).max(24), amount: z.number().int().min(-1000).max(1000), seatId: z.string().optional(), cardId: z.string().optional() }),
  z.object({ type: z.literal('ADJUST_COMMANDER_DAMAGE'), commanderCardId: z.string(), amount: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ type: z.literal('COMMANDER_DAMAGE'), commanderCardId: z.string(), defenderId: z.string(), amount: z.number().int().min(1).max(1000) }),
  z.object({ type: z.literal('FLIP_FACE'), cardId: z.string() }),
  z.object({ type: z.literal('SET_FACE_DOWN'), cardId: z.string(), faceDown: z.boolean() }),
  z.object({ type: z.literal('CAST'), cardId: z.string(), x: point.optional(), y: point.optional(), target: z.string().max(128).optional() }),
  z.object({ type: z.literal('CAST_ABILITY'), sourceId: z.string(), name: z.string().max(120), target: z.string().max(128).optional() }),
  z.object({ type: z.literal('PASS_PRIORITY') }),
  z.object({ type: z.literal('RESOLVE_TOP') }),
  z.object({ type: z.literal('PHASE'), step: z.string().max(64) }),
  z.object({ type: z.literal('ADVANCE_TURN') }),
  z.object({ type: z.literal('SHUFFLE') }),
  z.object({ type: z.literal('REVEAL'), cardIds: z.array(z.string()).min(1).max(20) }),
  z.object({ type: z.literal('SEARCH_LIBRARY'), cardIds: z.array(z.string()).min(1).max(20), destination: z.enum(['hand', 'battlefield', 'graveyard', 'exile']).optional() }),
  z.object({ type: z.literal('CREATE_TOKEN'), card: tokenDefinitionSchema, x: point.optional(), y: point.optional() }),
  z.object({ type: z.literal('TRANSFER_CONTROL'), cardId: z.string(), seatId: z.enum(seats) }),
  z.object({ type: z.literal('CONCEDE') }),
]);

type Agent = { token: string; name: string; room: PeerRoom; backend: RoomBackend; joined: JoinedRoom; history: MatchHistory; seen: Map<string, Promise<unknown>>; lastStatusEventId?: string };

export class McpAgents {
  private agents = new Map<string, Agent>();
  private joinRequests = new Map<string, Promise<unknown>>();
  private stopping = false;

  activate(): void { this.stopping = false; }

  async invoke(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (tool === 'join_room') return this.joinOnce(args);
    const agent = this.requireAgent(args.agentToken);
    switch (tool) {
      case 'leave_room': await this.leave(agent); return { left: true };
      case 'list_decks': return this.listDecks();
      case 'select_deck': return this.once(agent, args.requestId, async () => {
        const deck = (await this.validDecks()).find(item => item.id === args.deckId);
        if (!deck) throw new Error('O deck selecionado não existe ou não é um deck Commander válido.');
        await agent.room.saveDeck(deck);
        return { deckId: deck.id, name: deck.name, ready: false };
      });
      case 'set_ready': return this.once(agent, args.requestId, async () => { await agent.room.markReady(args.ready === true); return { ready: args.ready === true }; });
      case 'get_state': return this.getState(agent);
      case 'send_chat': return this.sendChat(agent, args.message);
      case 'table_status': return this.tableStatus(agent);
      case 'wait_for_update': return this.waitForUpdate(agent, args);
      case 'get_card': return this.getCard(agent, args.cardId);
      case 'set_playmat': return this.once(agent, args.requestId, async () => {
        const id = args.playmatId === null || args.playmatId === '' ? undefined : String(args.playmatId);
        if (id && !validPlaymatId(id)) throw new Error('Este playmat não está na biblioteca.');
        await agent.room.setPlaymat(id);
        return { playmatId: id ?? null };
      });
      case 'perform_action': return this.once(agent, args.requestId, async () => {
        const action = actionSchema.parse(args.action) as GameAction;
        const before = agent.room.snapshotState?.state;
        const after = await agent.room.act(action, String(args.requestId));
        if (before && before.id === after.id && after.revision === before.revision + 1) agent.history.record(before, after);
        return sanitizeAgentState(after, agent.joined.member.seatId);
      });
      case 'undo': return this.historyAction(agent, args, false);
      case 'redo': return this.historyAction(agent, args, true);
      default: throw new Error('Ferramenta MCP desconhecida.');
    }
  }

  async closeAll(): Promise<void> {
    this.stopping = true;
    const agents = [...this.agents.values()];
    this.agents.clear();
    this.joinRequests.clear();
    await Promise.all(agents.map(async agent => { await agent.room.leave().catch(() => agent.room.closeTransport()); }));
  }

  private async join(args: Record<string, unknown>): Promise<unknown> {
    if (this.stopping) throw new Error('O servidor está encerrando.');
    const name = String(args.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
    if (name.length < 2) throw new Error('O nome da IA deve ter ao menos dois caracteres.');
    const code = String(args.code ?? '').trim().toUpperCase();
    const backend = new RoomBackend(`meu-magic-ai-${crypto.randomUUID()}`);
    await backend.connectIdentity(name);
    const joined = await backend.join(code, name, String(args.password ?? ''), { agent: true });
    if (!joined.member.seatId || joined.member.role !== 'player') { await backend.leave(); throw new Error('Não há lugar livre para esta IA.'); }
    const room = new PeerRoom(backend, localRepository);
    const agent: Agent = { token: crypto.randomUUID(), name, room, backend, joined, history: new MatchHistory(), seen: new Map() };
    this.agents.set(agent.token, agent);
    try {
      const initial = await room.connect(joined, name, () => {});
      if (initial.state) throw new Error('Uma IA só pode entrar no lobby, antes do início da partida.');
      return { agentToken: agent.token, name, seatId: joined.member.seatId, phase: 'lobby' };
    } catch (error) {
      this.agents.delete(agent.token);
      await room.leave().catch(() => backend.leave());
      throw error;
    }
  }

  private async joinOnce(args: Record<string, unknown>): Promise<unknown> {
    const requestId = String(args.requestId ?? '');
    if (!/^[\w-]{8,128}$/.test(requestId)) throw new Error('requestId deve ter de 8 a 128 letras, números, hífens ou sublinhados.');
    const existing = this.joinRequests.get(requestId);
    if (existing) return existing;
    const result = this.join(args);
    this.joinRequests.set(requestId, result);
    if (this.joinRequests.size > 128) this.joinRequests.delete(this.joinRequests.keys().next().value!);
    try { return await result; } catch (error) { this.joinRequests.delete(requestId); throw error; }
  }

  private async listDecks(): Promise<Array<{ id: string; name: string; commanders: string[]; cardCount: number }>> {
    return (await this.validDecks()).map(deck => ({ id: deck.id, name: deck.name, commanders: deck.entries.filter(entry => entry.role === 'commander').map(entry => entry.name), cardCount: deck.entries.reduce((sum, entry) => sum + entry.quantity, 0) }));
  }

  private async validDecks() {
    const decks = await localRepository.getDecks();
    return decks.filter(deck => validateDeck(deck, new Map(deck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []))).length === 0);
  }

  private getState(agent: Agent): unknown {
    const snapshot = agent.room.snapshotState;
    if (!snapshot) throw new Error('A sessão desta IA não está conectada.');
    return { room: { code: snapshot.code, name: snapshot.name, phase: snapshot.state?.phase ?? 'lobby', connectionState: snapshot.connectionState, seatId: snapshot.selfSeatId }, seats: snapshot.seats, queue: snapshot.queue, state: snapshot.state ? sanitizeAgentState(snapshot.state, agent.joined.member.seatId) : null };
  }

  private async sendChat(agent: Agent, value: unknown): Promise<unknown> {
    if (typeof value !== 'string') throw new Error('Informe a mensagem para o chat.');
    await agent.room.sendChat(value);
    return { sent: true, message: value.trim() };
  }

  private tableStatus(agent: Agent): unknown {
    const snapshot = agent.room.snapshotState;
    if (!snapshot) throw new Error('A sessão desta IA não está conectada.');
    const log = snapshot.state?.log.filter(entry => entry.public) ?? [];
    const cursorIndex = agent.lastStatusEventId ? log.findIndex(entry => entry.id === agent.lastStatusEventId) : -1;
    // If the cursor was evicted from the bounded game log, send the retained log again.
    const events = cursorIndex < 0 ? log : log.slice(cursorIndex + 1);
    if (log.length) agent.lastStatusEventId = log.at(-1)!.id;
    return {
      room: { code: snapshot.code, name: snapshot.name, phase: snapshot.state?.phase ?? 'lobby', connectionState: snapshot.connectionState, seatId: snapshot.selfSeatId },
      revision: snapshot.state?.revision ?? null,
      events,
    };
  }

  private async waitForUpdate(agent: Agent, args: Record<string, unknown>): Promise<unknown> {
    const afterRevision = args.afterRevision === null ? null : Number(args.afterRevision);
    if (afterRevision !== null && (!Number.isSafeInteger(afterRevision) || afterRevision < 0)) throw new Error('afterRevision deve ser uma revisão válida ou null no lobby.');
    const afterConnectionState = String(args.afterConnectionState);
    const timeoutMs = Number(args.timeoutMs);
    if (!['connecting', 'synchronizing', 'connected', 'reconnecting', 'transferring', 'disconnected'].includes(afterConnectionState)) throw new Error('Estado de conexão inválido.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('timeoutMs deve estar entre 1 e 30000.');
    const result = await agent.room.waitForUpdate(afterRevision, afterConnectionState as 'connecting' | 'synchronizing' | 'connected' | 'reconnecting' | 'transferring' | 'disconnected', timeoutMs);
    if (this.agents.get(agent.token) !== agent || !result.snapshot) throw new Error('A sessão desta IA foi encerrada enquanto aguardava a mesa.');
    return { timedOut: result.timedOut, ...this.getState(agent) as object };
  }

  private getCard(agent: Agent, cardId: unknown): unknown {
    if (typeof cardId !== 'string') throw new Error('Informe o identificador da carta.');
    const state = agent.room.snapshotState?.state;
    if (!state) throw new Error('A partida ainda não começou.');
    const card = state.cards[cardId];
    if (!card) throw new Error('A carta não existe ou não está visível para esta IA.');
    if ((card.zone === 'hand' || card.zone === 'library') && card.ownerId !== agent.joined.member.seatId) throw new Error('Esta carta não está visível para esta IA.');
    return card;
  }

  private async historyAction(agent: Agent, args: Record<string, unknown>, redo: boolean): Promise<unknown> {
    return this.once(agent, args.requestId, async () => {
      const current = agent.room.snapshotState?.state;
      if (!current) throw new Error('A partida ainda não começou.');
      const expectedRevision = Number(args.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) throw new Error('A mesa mudou desde a última leitura. Atualize o estado e tente novamente.');
      const snapshot = agent.history.target(redo, expectedRevision);
      if (!snapshot) throw new Error(redo ? 'Não há jogada sua para refazer.' : 'Não há jogada sua para desfazer.');
      const after = await agent.room.restoreHistoryState(snapshot, expectedRevision, redo ? 'REDO' : 'UNDO');
      agent.history.restored(redo, after.revision);
      return sanitizeAgentState(after, agent.joined.member.seatId);
    });
  }

  private async leave(agent: Agent): Promise<void> {
    this.agents.delete(agent.token);
    await agent.room.leave();
  }

  private requireAgent(value: unknown): Agent {
    if (typeof value !== 'string') throw new Error('Entre na sala com join_room antes de usar esta ferramenta.');
    const agent = this.agents.get(value);
    if (!agent) throw new Error('A credencial desta IA expirou. Entre novamente na sala.');
    return agent;
  }

  private async once<T>(agent: Agent, requestIdValue: unknown, work: () => Promise<T>): Promise<T> {
    const requestId = String(requestIdValue ?? '');
    if (!/^[\w-]{8,128}$/.test(requestId)) throw new Error('requestId deve ter de 8 a 128 letras, números, hífens ou sublinhados.');
    const existing = agent.seen.get(requestId) as Promise<T> | undefined;
    if (existing) return existing;
    const result = work();
    agent.seen.set(requestId, result);
    if (agent.seen.size > 256) agent.seen.delete(agent.seen.keys().next().value!);
    try { return await result; } catch (error) { agent.seen.delete(requestId); throw error; }
  }
}

export function sanitizeAgentState(state: MatchState, ownSeatId: string | null | undefined): MatchState {
  const copy = structuredClone(state);
  for (const seat of copy.seats) if (seat.id !== ownSeatId) { seat.hand = []; seat.library = []; }
  for (const [id, card] of Object.entries(copy.cards)) {
    if ((card.zone === 'hand' || card.zone === 'library') && card.ownerId !== ownSeatId && !card.revealed) delete copy.cards[id];
  }
  return copy;
}

export const mcpAgents = new McpAgents();
