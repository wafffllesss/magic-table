import { clampCardPosition } from './tableView';
import { battlefieldPosition } from './battlefieldLayout';

export type Zone = 'library' | 'revealed' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack';
export type CardFace = { name: string; mana_cost: string; type_line: string; oracle_text: string; power?: string; toughness?: string; loyalty?: string; image_uris?: Record<string, string> };
export type RelatedCard = { id: string; component: string; name: string; type_line: string; uri: string };
export type CardDefinition = {
  id: string; oracle_id: string; name: string; printed_name?: string; layout: string;
  color_identity: string[]; keywords: string[]; mana_cost: string; type_line: string; oracle_text: string;
  image_uris?: Record<string, string>; card_faces?: CardFace[];
  all_parts?: RelatedCard[];
  power?: string; toughness?: string; loyalty?: string;
  legalities: Record<string, string>; scryfall_uri?: string;
};
export type DeckEntry = { cardId: string; name: string; quantity: number; role: 'commander' | 'library'; card?: CardDefinition };
export type DeckDefinition = { id: string; name: string; format: 'commander'; commanders: string[]; entries: DeckEntry[]; updatedAt: number; source?: string;
  precon?: { setCode: string; edition: string; sourceUrl: string; version: number } };
export type CardInstance = { id: string; ownerId: string; controllerId: string; cardId: string; zone: Zone; tapped: boolean; faceDown: boolean; isToken?: boolean; revealed?: boolean; temporaryReveal?: boolean; face?: number; x: number; y: number; counters: Record<string, number>; card?: CardDefinition };
export type StackItem = { id: string; sourceId: string; controllerId: string; name: string; kind: 'spell' | 'ability'; target?: string; battlefieldPosition?: { x?: number; y?: number } };
export type CommanderRosterEntry = { id: string; cardId: string; name: string };
export type PlayerSeat = { id: string; name: string; participantUid?: string; status: 'playing' | 'waiting' | 'eliminated'; commanderIds: string[]; commanderRoster?: CommanderRosterEntry[]; library: string[]; hand: string[]; libraryRevealOpen?: boolean; libraryRevealed?: string[]; mulligans: number; keptHand: boolean; life: number; poison: number; commanderCasts: Record<string, number>; commanderDamage: Record<string, number>; landPlays: number };
export type GameLogEvent = { key: string; params?: Record<string, string | number>; source?: GameLogEvent };
export type GameLogEntry = { id: string; actorId: string; message: string; event?: GameLogEvent; at: number; public: boolean };
export type MatchState = { id: string; revision: number; lastActionId?: string; phase: 'lobby' | 'mulligan' | 'playing' | 'finished'; paused: boolean; activeSeatId: string; turn: number; step: string; seats: PlayerSeat[]; suspendedSeatIds?: string[]; disconnectedSeatIds?: string[]; cards: Record<string, CardInstance>; stack: StackItem[]; passes: string[]; log: GameLogEntry[]; updatedAt: number; hiddenZones?: Record<string, { hand: number; library: number; graveyard: number; exile: number }> };
export type GameAction =
  | { type: 'DRAW'; amount?: number }
  | { type: 'MULLIGAN' }
  | { type: 'KEEP_HAND'; bottomCardIds?: string[] }
  | { type: 'PLAY_LAND'; cardId: string; x?: number; y?: number }
  | { type: 'REPOSITION_CARD'; cardId: string; x: number; y: number }
  | { type: 'MOVE_CARD'; cardId: string; zone: Zone; x?: number; y?: number; libraryPosition?: 'top' | 'bottom' }
  | { type: 'TAP'; cardId: string }
  | { type: 'SET_LIFE'; amount: number; seatId?: string }
  | { type: 'CHANGE_COUNTER'; counter: string; amount: number; seatId?: string; cardId?: string }
  | { type: 'ADJUST_COMMANDER_DAMAGE'; commanderCardId: string; amount: -1 | 1 }
  | { type: 'COMMANDER_DAMAGE'; commanderCardId: string; defenderId: string; amount: number }
  | { type: 'FLIP_FACE'; cardId: string }
  | { type: 'SET_FACE_DOWN'; cardId: string; faceDown: boolean }
  | { type: 'CAST'; cardId: string; x?: number; y?: number; target?: string }
  | { type: 'CAST_ABILITY'; sourceId: string; name: string; target?: string }
  | { type: 'PASS_PRIORITY' }
  | { type: 'RESOLVE_TOP' }
  | { type: 'PHASE'; step: string }
  | { type: 'ADVANCE_TURN' }
  | { type: 'SHUFFLE' }
  | { type: 'OPEN_LIBRARY_REVEAL' | 'CLOSE_LIBRARY_REVEAL' | 'REVEAL_LIBRARY_TOP' }
  | { type: 'MOVE_LIBRARY_REVEALED'; cardIds: string[]; destination: 'top' | 'bottom' | 'hand' | 'graveyard' | 'exile'; close?: boolean }
  | { type: 'REVEAL'; cardIds: string[] }
  | { type: 'SEARCH_LIBRARY'; cardIds: string[]; destination?: Exclude<Zone, 'library' | 'revealed' | 'stack' | 'command'> }
  | { type: 'CREATE_TOKEN'; card: CardDefinition; x?: number; y?: number }
  | { type: 'TRANSFER_CONTROL'; cardId: string; seatId: string }
  | { type: 'CONCEDE' };

export const COMMANDER_STARTING_LIFE = 40;
export const INITIAL_HAND_SIZE = 7;
function opaqueCardId(): string {
  return `card-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}
export const ZONE_LABELS: Record<Zone, string> = {
  library: 'Biblioteca', revealed: 'Reveladas', hand: 'Mão', battlefield: 'Campo', graveyard: 'Cemitério',
  exile: 'Exílio', command: 'Zona de comando', stack: 'Pilha',
};

function cryptoRandom(): number {
  const sample = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(sample);
  else sample[0] = Math.floor(Math.random() * 0xffffffff);
  return sample[0] / 0x100000000;
}

export function shuffle<T>(items: T[], random: () => number = cryptoRandom): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function newMatch(input: Array<{ seatId: string; name: string; deck: DeckDefinition; participantUid?: string }>, now = Date.now(), random = cryptoRandom): MatchState {
  const seatIds = input.map(({ seatId }) => seatId);
  if (input.length < 1 || input.length > 4 || seatIds.some(id => !['northWest', 'northEast', 'southEast', 'southWest'].includes(id)) || new Set(seatIds).size !== seatIds.length) throw new Error('A partida precisa de um a quatro jogadores em lugares válidos e distintos.');
  if (new Set(input.flatMap(item => item.participantUid ? [item.participantUid] : [])).size !== input.filter(item => item.participantUid).length) throw new Error('Cada jogador precisa ter uma identidade exclusiva.');
  if (input.some(({ deck }) => totalCards(deck) !== 100 || deck.commanders.length < 1 || deck.commanders.length > 2)) {
    throw new Error('Cada deck Commander precisa de 100 cartas, incluindo um ou dois comandantes.');
  }
  const physicalOrder = ['northWest', 'northEast', 'southEast', 'southWest'];
  const orderedInput = [...input].sort((first, second) => physicalOrder.indexOf(first.seatId) - physicalOrder.indexOf(second.seatId));
  const seats: PlayerSeat[] = orderedInput.map(({ seatId, name, deck }) => {
    const commanders = deck.entries.filter(entry => entry.role === 'commander');
    const libraryCards = deck.entries.filter(entry => entry.role === 'library').flatMap(entry => Array.from({ length: Math.max(0, entry.quantity) }, () => entry.cardId));
    const participantUid = orderedInput.find(item => item.seatId === seatId)?.participantUid;
    return { id: seatId, name, ...(participantUid ? { participantUid } : {}), status: 'playing', commanderIds: commanders.map(entry => entry.cardId), library: shuffle(libraryCards, random), hand: [], mulligans: 0, keptHand: false, life: COMMANDER_STARTING_LIFE, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 };
  });
  const cards: MatchState['cards'] = {};
  seats.forEach(seat => {
    seat.commanderIds.forEach((cardId, index) => {
      const definition = input.flatMap(item => item.deck.entries).find(entry => entry.cardId === cardId)?.card;
      const instanceId = `command-${seat.id}-${index}`;
      cards[instanceId] = { id: instanceId, ownerId: seat.id, controllerId: seat.id, cardId, zone: 'command', tapped: false, faceDown: false, x: 39 + index * 12, y: 4, counters: {}, card: definition };
    });
    const deck = orderedInput.find(item => item.seatId === seat.id)!.deck;
    const entries = deck.entries.filter(entry => entry.role === 'library');
    const libraryIds: string[] = [];
    for (const entry of entries) {
      const definition = entry.card ?? deck.entries.find(other => other.cardId === entry.cardId)?.card;
      for (let copy = 0; copy < entry.quantity; copy++) {
        const instanceId = opaqueCardId();
        cards[instanceId] = { id: instanceId, ownerId: seat.id, controllerId: seat.id, cardId: entry.cardId, zone: 'library', tapped: false, faceDown: false, x: 6, y: 6, counters: {}, card: definition };
        libraryIds.push(instanceId);
      }
    }
    seat.library = shuffle(libraryIds, random);
  });
  const state: MatchState = { id: `match-${now.toString(36)}`, revision: 0, phase: 'mulligan', paused: false, activeSeatId: seats[Math.floor(random() * seats.length)].id, turn: 1, step: 'Manutenção', seats, suspendedSeatIds: [], disconnectedSeatIds: [], cards, stack: [], passes: [], log: [], updatedAt: now };
  for (const seat of state.seats) {
    seat.hand = seat.library.splice(0, INITIAL_HAND_SIZE);
    seat.hand.forEach(id => { state.cards[id].zone = 'hand'; });
  }
  return state;
}

export function totalCards(deck: DeckDefinition): number { return deck.entries.reduce((count, entry) => count + Math.max(0, entry.quantity), 0); }
export function getSeat(state: MatchState, seatId: string): PlayerSeat {
  const seat = state.seats.find(candidate => candidate.id === seatId);
  if (!seat) throw new Error('Este lugar não pertence à partida.');
  return seat;
}
export function eligibleSeats(state: MatchState): PlayerSeat[] {
  const suspended = new Set(state.suspendedSeatIds ?? []);
  return state.seats.filter(seat => seat.status === 'playing' && !suspended.has(seat.id));
}

export function advanceTurn(state: MatchState): void {
  const eligible = eligibleSeats(state);
  if (!eligible.length) return;
  const currentIndex = eligible.findIndex(seat => seat.id === state.activeSeatId);
  const physicalOrder = ['northWest', 'northEast', 'southEast', 'southWest'];
  const currentPhysicalIndex = physicalOrder.indexOf(state.activeSeatId);
  const next = currentIndex >= 0
    ? eligible[(currentIndex + 1) % eligible.length]
    : eligible.find(seat => physicalOrder.indexOf(seat.id) > currentPhysicalIndex) ?? eligible[0];
  if (!next) return;
  if (currentIndex === eligible.length - 1 || currentIndex < 0 && physicalOrder.indexOf(next.id) <= currentPhysicalIndex) state.turn++;
  else if (eligible.length === 1) state.turn++;
  state.activeSeatId = next.id;
  state.step = 'Desvirar';
  next.landPlays = 0;
  Object.values(state.cards).filter(card => card.controllerId === next.id && card.zone === 'battlefield').forEach(card => {
    card.tapped = false;
    Object.assign(card, clampCardPosition(card.x, card.y));
  });
  state.passes = [];
}
export function getCard(state: MatchState, cardId: string): CardInstance {
  const card = state.cards[cardId];
  if (!card) throw new Error('Esta carta não está na mesa.');
  return card;
}

export function isBasicLand(card?: CardDefinition): boolean {
  return /\bBasic Land\b/i.test(card?.type_line ?? '');
}

// Commander identities remain public even while their cards are in hidden zones.
export function commandersForSeat(state: MatchState, seatId: string): CommanderRosterEntry[] {
  const seat = getSeat(state, seatId);
  return seat.commanderIds.flatMap(cardId => {
    const instance = Object.values(state.cards).find(card => card.ownerId === seatId && card.cardId === cardId);
    const known = seat.commanderRoster?.find(card => card.cardId === cardId);
    return instance ? [{ id: instance.id, cardId, name: instance.card?.name ?? known?.name ?? cardId }] : known ? [known] : [];
  });
}

export function publicProjection(state: MatchState): Omit<MatchState, 'seats'> & { seats: Array<Omit<PlayerSeat, 'hand' | 'library'>>; hiddenZones: Record<string, { hand: number; library: number; graveyard: number; exile: number }> } {
  const { seats, ...publicState } = state;
  return {
    ...publicState,
    cards: Object.fromEntries(Object.entries(state.cards).filter(([, card]) => !['hand', 'library'].includes(card.zone) || card.revealed).map(([id, card]) => {
      if (!card.faceDown) return [id, card];
      const { card: _hiddenDefinition, ...visible } = card;
      return [id, { ...visible, cardId: 'face-down' }];
    })),
    log: state.log.filter(entry => entry.public),
    seats: seats.map(({ hand: _hand, library: _library, ...seat }) => ({ ...seat, commanderRoster: commandersForSeat(state, seat.id) })),
    hiddenZones: Object.fromEntries(seats.map(seat => [seat.id, { hand: seat.hand?.length ?? 0, library: seat.library?.length ?? 0, graveyard: Object.values(state.cards).filter(card => card.ownerId === seat.id && card.zone === 'graveyard').length, exile: Object.values(state.cards).filter(card => card.ownerId === seat.id && card.zone === 'exile').length }])),
  };
}

export function privateProjection(state: MatchState, seatId: string): Pick<PlayerSeat, 'hand' | 'library' | 'commanderCasts' | 'mulligans' | 'keptHand' | 'commanderIds'> & { privateCards: Record<string, CardInstance> } {
  const seat = getSeat(state, seatId);
  return { hand: seat.hand, library: seat.library, commanderCasts: seat.commanderCasts, mulligans: seat.mulligans, keptHand: seat.keptHand, commanderIds: seat.commanderIds, privateCards: Object.fromEntries(Object.entries(state.cards).filter(([, card]) => card.ownerId === seatId && (['hand', 'library'].includes(card.zone) || card.faceDown))) };
}

export function composeMatchState(publicState: MatchState, seatId: string, privateState?: ReturnType<typeof privateProjection>): MatchState {
  const state = structuredClone(publicState);
  for (const seat of state.seats) { seat.hand ??= []; seat.library ??= []; }
  if (!privateState) return state;
  const target = getSeat(state, seatId);
  Object.assign(target, { hand: [...privateState.hand], library: [...privateState.library],
    commanderCasts: privateState.commanderCasts, mulligans: privateState.mulligans, keptHand: privateState.keptHand, commanderIds: privateState.commanderIds });
  Object.assign(state.cards, privateState.privateCards);
  return state;
}

function moveCard(state: MatchState, card: CardInstance, zone: Zone, actorId: string, x?: number, y?: number): string {
  const sourceZone = card.zone;
  if (zone === 'revealed') throw new Error('Use a ação de revelar a biblioteca.');
  if ((sourceZone === 'hand' || sourceZone === 'library' || sourceZone === 'command') && card.ownerId !== actorId) throw new Error('Somente o proprietário pode mover uma carta oculta ou da zona de comando.');
  if (sourceZone === 'battlefield' && card.controllerId !== actorId) throw new Error('Somente quem controla esta permanente pode movê-la.');
  if ((sourceZone === 'graveyard' || sourceZone === 'exile') && card.ownerId !== actorId) throw new Error('Somente o proprietário pode mover esta carta entre zonas públicas.');
  if (['hand', 'library'].includes(zone) && card.ownerId !== actorId) throw new Error('Somente o proprietário pode colocar esta carta em uma zona privada.');
  if (zone === 'command' && !getSeat(state, card.ownerId).commanderIds.includes(card.cardId)) throw new Error('Somente um comandante pode voltar para a zona de comando.');
  if (zone === 'command' && sourceZone !== 'battlefield' && card.ownerId !== actorId) throw new Error('Somente o proprietário pode mover esta carta para a zona de comando.');
  const cardName = card.card?.name ?? card.cardId;
  if ((card.isToken || card.card?.type_line.includes('Token')) && ['hand', 'library', 'graveyard', 'exile'].includes(zone)) {
    const owner = getSeat(state, card.ownerId);
    owner.hand = owner.hand.filter(id => id !== card.id);
    owner.library = owner.library.filter(id => id !== card.id);
    if (sourceZone === 'stack') state.stack = state.stack.filter(item => item.sourceId !== card.id);
    delete state.cards[card.id];
    return cardName;
  }
  const owner = getSeat(state, card.ownerId);
  if (sourceZone === 'hand') owner.hand = owner.hand.filter(id => id !== card.id);
  if (sourceZone === 'library') owner.library = owner.library.filter(id => id !== card.id);
  if (sourceZone === 'revealed') { if (card.ownerId !== actorId) throw new Error('Somente o proprietário pode mover esta carta.'); owner.libraryRevealed = (owner.libraryRevealed ?? []).filter(id => id !== card.id); }
  if (zone === 'hand' && !owner.hand.includes(card.id)) owner.hand.push(card.id);
  if (zone === 'library' && !owner.library.includes(card.id)) owner.library.push(card.id);
  const position = zone === 'battlefield' && sourceZone !== 'battlefield'
    ? battlefieldPosition({ ...card, controllerId: actorId }, Object.values(state.cards), x, y) : undefined;
  card.zone = zone; card.tapped = false; card.revealed = false; card.x = position?.x ?? x ?? card.x; card.y = position?.y ?? y ?? card.y;
  if (zone === 'battlefield') card.controllerId = actorId;
  if (zone === 'command') card.controllerId = card.ownerId;
  if (zone === 'battlefield') Object.assign(card, clampCardPosition(card.x, card.y, card.tapped));
  if (zone !== 'stack' && sourceZone === 'stack') { const item = state.stack.find(entry => entry.sourceId === card.id); if (item) state.stack = state.stack.filter(entry => entry.id !== item.id); }
  return cardName;
}

export function applyAction(current: MatchState, actorId: string, action: GameAction, now = Date.now(), random = Math.random): MatchState {
  if (current.phase === 'finished') throw new Error('Esta partida terminou.');
  if (current.paused) throw new Error('A partida está pausada enquanto alguém reconecta ou aceita uma substituição.');
  const state = structuredClone(current);
  const seat = getSeat(state, actorId);
  if (seat.status !== 'playing' || (current.suspendedSeatIds ?? []).includes(actorId)) throw new Error('Este participante não pode agir enquanto não estiver ativo.');
  let message = ''; let publicAction = true; let resolvedItemName: string | undefined;
  const movedCardName = action.type === 'MOVE_CARD' ? (state.cards[action.cardId]?.zone === 'hand' && action.zone === 'library' ? 'uma carta' : state.cards[action.cardId]?.card?.name ?? state.cards[action.cardId]?.cardId) : undefined;
  const movedCardSourceZone = action.type === 'MOVE_CARD' ? state.cards[action.cardId]?.zone : undefined;
  switch (action.type) {
    case 'MULLIGAN': {
      if (state.phase !== 'mulligan' || seat.keptHand) throw new Error('Este jogador não pode mulligar agora.');
      seat.library = shuffle([...seat.library, ...seat.hand], random); seat.mulligans++;
      seat.hand = seat.library.splice(0, Math.max(0, INITIAL_HAND_SIZE - Math.max(0, seat.mulligans - 1))); 
      seat.hand.forEach(id => { state.cards[id].zone = 'hand'; });
      seat.library.forEach(id => { state.cards[id].zone = 'library'; });
      message = `${seat.name} pediu mulligan (${seat.mulligans}).`; break;
    }
    case 'KEEP_HAND': {
      if (state.phase !== 'mulligan' || seat.keptHand) throw new Error('Esta mão já foi confirmada.');
      const keepSize = Math.max(0, INITIAL_HAND_SIZE - Math.max(0, seat.mulligans - 1));
      const cardsToBottom = action.bottomCardIds ?? [];
      if (cardsToBottom.length !== Math.max(0, seat.hand.length - keepSize) || new Set(cardsToBottom).size !== cardsToBottom.length || cardsToBottom.some(id => !seat.hand.includes(id))) throw new Error(`Escolha exatamente ${Math.max(0, seat.hand.length - keepSize)} carta(s) para o fundo.`);
      seat.hand = seat.hand.filter(id => !cardsToBottom.includes(id)); seat.library.push(...cardsToBottom);
      cardsToBottom.forEach(id => { state.cards[id].zone = 'library'; });
      seat.keptHand = true;
      message = `${seat.name} confirmou a mão.`;
      if (eligibleSeats(state).every(item => item.keptHand)) { state.phase = 'playing'; message += ' Todos mantiveram; a partida começou.'; }
      break;
    }
    case 'DRAW': {
      if (state.phase === 'mulligan') throw new Error('Confirme a mão antes de comprar cartas.');
      const amount = Math.min(10, Math.max(1, action.amount ?? 1)); const drawn = seat.library.splice(0, amount); seat.hand.push(...drawn);
      drawn.forEach(id => { state.cards[id].zone = 'hand'; });
      message = `${seat.name} comprou ${drawn.length} carta(s).`; break;
    }
    case 'PLAY_LAND': {
      if (state.phase !== 'playing') throw new Error('A partida ainda não começou.');
      if (actorId !== state.activeSeatId) throw new Error('Somente o jogador do turno pode jogar um terreno.');
      if (seat.landPlays >= 1) throw new Error('A jogada de terreno deste turno já foi usada.');
      const card = getCard(state, action.cardId); if (card.ownerId !== actorId || card.zone !== 'hand' || !/\bLand\b/i.test(card.card?.type_line ?? '')) throw new Error('Escolha um terreno da sua mão.');
      moveCard(state, card, 'battlefield', actorId, action.x, action.y); seat.landPlays++;
      message = `${seat.name} jogou ${card.card?.name ?? 'um terreno'}.`; break;
    }
    case 'MOVE_CARD': {
      const card = getCard(state, action.cardId);
      const commanderToBattlefield = card.zone === 'command' && action.zone === 'battlefield';
      if (action.libraryPosition !== undefined && (action.zone !== 'library' || !['top', 'bottom'].includes(action.libraryPosition))) throw new Error('Posição de biblioteca inválida.');
      moveCard(state, card, action.zone, actorId, action.x, action.y);
      if (action.zone === 'library' && action.libraryPosition === 'top' && state.cards[card.id]) {
        const owner = getSeat(state, card.ownerId);
        owner.library = [card.id, ...owner.library.filter(id => id !== card.id)];
      }
      if (commanderToBattlefield) seat.commanderCasts[card.cardId] = (seat.commanderCasts[card.cardId] ?? 0) + 1;
      const destination = action.zone === 'library' && action.libraryPosition ? `${action.libraryPosition === 'top' ? 'o topo' : 'o fundo'} do deck` : ZONE_LABELS[action.zone];
      message = `${seat.name} moveu ${movedCardName ?? 'uma carta'} para ${destination}.`; break;
    }
    case 'REPOSITION_CARD': {
      const card = getCard(state, action.cardId);
      if (card.zone !== 'battlefield' || card.controllerId !== actorId) throw new Error('Somente cartas controladas no seu campo podem ser movidas.');
      Object.assign(card, clampCardPosition(action.x, action.y, card.tapped));
      message = `${seat.name} reposicionou ${card.card?.name ?? 'uma permanente'}.`; break;
    }
    case 'TAP': {
      const card = getCard(state, action.cardId); if (card.controllerId !== actorId || card.zone !== 'battlefield') throw new Error('Só é possível virar cartas do próprio campo.');
      card.tapped = !card.tapped;
      Object.assign(card, clampCardPosition(card.x, card.y, card.tapped));
      message = `${seat.name} ${card.tapped ? 'virou' : 'desvirou'} ${card.card?.name ?? 'uma permanente'}.`; break;
    }
    case 'SET_LIFE': {
      const target = state.seats.find(candidate => candidate.id === (action.seatId ?? actorId));
      if (!target || target.id !== actorId || !Number.isFinite(action.amount) || Math.abs(action.amount) > 1000) throw new Error('Você só pode ajustar a própria vida.');
      target.life += action.amount; message = `${seat.name} ajustou a vida de ${target.name} em ${action.amount > 0 ? '+' : ''}${action.amount}.`; break;
    }
    case 'CHANGE_COUNTER': {
      if (!Number.isFinite(action.amount) || Math.abs(action.amount) > 1000 || !/^[\w +\/\-]{1,24}$/.test(action.counter)) throw new Error('Marcador inválido.');
      if (action.cardId) {
        const permanent = getCard(state, action.cardId);
        if (permanent.controllerId !== actorId || permanent.zone !== 'battlefield') throw new Error('Escolha uma permanente controlada por você.');
        permanent.counters[action.counter] = Math.max(0, (permanent.counters[action.counter] ?? 0) + action.amount);
        if (!permanent.counters[action.counter]) delete permanent.counters[action.counter];
        message = `${seat.name} ajustou ${action.counter} em ${permanent.card?.name ?? 'uma permanente'} em ${action.amount > 0 ? '+' : ''}${action.amount}.`;
      } else {
        const target = getSeat(state, action.seatId ?? actorId);
        if (!['poison', 'energy', 'experience'].includes(action.counter)) throw new Error('Use um marcador de permanente ou selecione veneno, energia ou experiência do jogador.');
        const currentValue = (target as unknown as Record<string, number>)[action.counter] ?? 0;
        (target as unknown as Record<string, number>)[action.counter] = Math.max(0, currentValue + action.amount);
        message = `${seat.name} ajustou ${action.counter} de ${target.name} em ${action.amount > 0 ? '+' : ''}${action.amount}.`;
      }
      break;
    }
    case 'ADJUST_COMMANDER_DAMAGE': {
      const commander = state.seats.filter(candidate => candidate.id !== actorId)
        .flatMap(candidate => commandersForSeat(state, candidate.id)).find(card => card.id === action.commanderCardId);
      if (!commander || ![-1, 1].includes(action.amount)) throw new Error('Escolha um comandante adversário e ajuste de +1 ou −1.');
      const value = (seat.commanderDamage[commander.cardId] ?? 0) + action.amount;
      if (value < 0) throw new Error('O dano de comandante não pode ser negativo.');
      seat.commanderDamage[commander.cardId] = value;
      message = `${seat.name} ajustou o dano recebido de ${commander.name} em ${action.amount > 0 ? '+' : ''}${action.amount} (total: ${value}).`;
      break;
    }
    case 'COMMANDER_DAMAGE': {
      const commander = getCard(state, action.commanderCardId);
      const defender = getSeat(state, action.defenderId);
      const owner = getSeat(state, commander.ownerId);
      if (commander.zone !== 'battlefield' || commander.controllerId !== actorId || !owner.commanderIds.includes(commander.cardId) || defender.id === actorId || defender.status !== 'playing' || !Number.isFinite(action.amount) || action.amount < 1 || action.amount > 1000) throw new Error('Selecione um comandante no campo, oponente ativo e dano válido.');
      defender.life -= action.amount;
      defender.commanderDamage[commander.cardId] = (defender.commanderDamage[commander.cardId] ?? 0) + action.amount;
      message = `${seat.name} causou ${action.amount} de dano de comandante a ${defender.name}.`;
      break;
    }
    case 'FLIP_FACE': {
      const card = getCard(state, action.cardId);
      if (card.controllerId !== actorId || card.zone !== 'battlefield' || (card.card?.card_faces?.length ?? 0) < 2) throw new Error('Esta carta não tem outra face disponível no campo.');
      card.face = card.face === 1 ? 0 : 1;
      message = `${seat.name} virou a carta para ${card.card?.card_faces?.[card.face]?.name ?? 'a outra face'}.`;
      break;
    }
    case 'SET_FACE_DOWN': {
      const card = getCard(state, action.cardId);
      if (card.ownerId !== actorId || card.zone !== 'battlefield') throw new Error('Somente quem possui esta carta pode virá-la para cima ou para baixo no campo.');
      card.faceDown = action.faceDown;
      card.revealed = !action.faceDown;
      message = action.faceDown ? `${seat.name} virou uma carta para baixo.` : `${seat.name} revelou uma carta virada para baixo.`;
      break;
    }
    case 'CAST': {
      if (state.phase !== 'playing') throw new Error('A partida ainda não começou.');
      const card = getCard(state, action.cardId);
      if (card.ownerId !== actorId || !['hand', 'command'].includes(card.zone)) throw new Error('Escolha uma carta da sua mão ou zona de comando.');
      if (card.zone === 'command') {
        const castCount = seat.commanderCasts[card.cardId] ?? 0;
        seat.commanderCasts[card.cardId] = castCount + 1;
      }
      moveCard(state, card, 'stack', actorId, action.x, action.y);
      state.stack.push({ id: `${state.id}-stack-${state.revision + 1}`, sourceId: card.id, controllerId: actorId, name: card.card?.name ?? 'Magia', kind: 'spell', target: action.target, ...(action.x !== undefined || action.y !== undefined ? { battlefieldPosition: { ...(action.x !== undefined ? { x: action.x } : {}), ...(action.y !== undefined ? { y: action.y } : {}) } } : {}) });
      state.passes = []; message = `${seat.name} conjurou ${card.card?.name ?? 'uma magia'}.`; break;
    }
    case 'CAST_ABILITY': {
      const source = getCard(state, action.sourceId); if (source.controllerId !== actorId || source.zone !== 'battlefield') throw new Error('Escolha uma permanente sua no campo.');
      state.stack.push({ id: `${state.id}-stack-${state.revision + 1}`, sourceId: source.id, controllerId: actorId, name: action.name.trim() || `Habilidade de ${source.card?.name ?? 'permanente'}`, kind: 'ability', target: action.target });
      state.passes = []; message = `${seat.name} ativou uma habilidade de ${source.card?.name ?? 'uma permanente'}.`; break;
    }
    case 'PASS_PRIORITY': {
      if (!state.stack.length) throw new Error('A pilha está vazia.');
      if (state.passes.includes(actorId)) throw new Error('Você já passou prioridade nesta pilha.');
      state.passes.push(actorId);
      if (eligibleSeats(state).every(candidate => state.passes.includes(candidate.id))) {
        const item = state.stack.pop()!;
        resolvedItemName = item.name;
        const spell = state.cards[item.sourceId];
        if (item.kind === 'spell' && spell) {
          spell.zone = spell.card && /\bInstant\b|\bSorcery\b/i.test(spell.card.type_line) ? 'graveyard' : 'battlefield';
          spell.tapped = false;
          if (spell.zone === 'battlefield') Object.assign(spell, battlefieldPosition(spell, Object.values(state.cards), item.battlefieldPosition?.x, item.battlefieldPosition?.y));
        }
        state.passes = [];
        if (!state.stack.length && !eligibleSeats(state).some(candidate => candidate.id === state.activeSeatId)) advanceTurn(state);
        message = `${seat.name} passou prioridade. ${item.name} resolveu.`;
      } else message = `${seat.name} passou prioridade.`;
      break;
    }
    case 'RESOLVE_TOP': {
      if (!state.stack.length) throw new Error('A pilha está vazia.');
      const activeSeats = eligibleSeats(state);
      if (!activeSeats.every(candidate => state.passes.includes(candidate.id))) throw new Error('Todos os jogadores ativos devem passar antes de resolver.');
      const item = state.stack.pop()!; const spell = state.cards[item.sourceId];
      if (item.kind === 'spell' && spell) { spell.zone = spell.card && /\bInstant\b|\bSorcery\b/i.test(spell.card.type_line) ? 'graveyard' : 'battlefield'; spell.tapped = false; if (spell.zone === 'battlefield') Object.assign(spell, battlefieldPosition(spell, Object.values(state.cards), item.battlefieldPosition?.x, item.battlefieldPosition?.y)); }
      state.passes = [];
      if (!state.stack.length && !eligibleSeats(state).some(candidate => candidate.id === state.activeSeatId)) advanceTurn(state);
      message = `${seat.name} resolveu ${item.name}.`; break;
    }
    case 'PHASE': {
      const steps = ['Desvirar', 'Manutenção', 'Compra', 'Principal pré-combate', 'Combate', 'Principal pós-combate', 'Final'];
      if (actorId !== state.activeSeatId) throw new Error('Somente o jogador do turno pode avançar a etapa.');
      if (!steps.includes(action.step)) throw new Error('Etapa de turno inválida.');
      state.step = action.step;
      if (action.step === 'Desvirar') { seat.landPlays = 0; Object.values(state.cards).filter(card => card.controllerId === actorId && card.zone === 'battlefield').forEach(card => { card.tapped = false; Object.assign(card, clampCardPosition(card.x, card.y)); }); }
      message = `${seat.name}: ${action.step}.`; break;
    }
    case 'ADVANCE_TURN': {
      if (actorId !== state.activeSeatId || state.stack.length) throw new Error('Somente o jogador ativo pode encerrar o turno quando a pilha estiver vazia.');
      advanceTurn(state);
      message = `${seat.name} encerrou o turno. É a vez de ${getSeat(state, state.activeSeatId).name}.`; break;
    }
    case 'OPEN_LIBRARY_REVEAL': seat.libraryRevealOpen = true; seat.libraryRevealed ??= []; message = `${seat.name} abriu a área de revelação.`; break;
    case 'CLOSE_LIBRARY_REVEAL':
      if ((seat.libraryRevealed ?? []).length) throw new Error('Mova as cartas reveladas antes de fechar.');
      seat.libraryRevealOpen = false; message = `${seat.name} fechou a área de revelação.`; break;
    case 'REVEAL_LIBRARY_TOP': {
      if (!seat.libraryRevealOpen || !seat.library.length) throw new Error('Não há carta para revelar.');
      const id = seat.library.shift()!; const card = getCard(state, id);
      if (card.ownerId !== actorId || card.zone !== 'library') throw new Error('Carta inválida na biblioteca.');
      card.zone = 'revealed'; card.revealed = true; (seat.libraryRevealed ??= []).push(id);
      message = `${seat.name} revelou ${card.card?.name ?? 'uma carta'}.`; break;
    }
    case 'MOVE_LIBRARY_REVEALED': {
      const ids = action.cardIds; const revealed = seat.libraryRevealed ?? [];
      if (!seat.libraryRevealOpen || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !revealed.includes(id) || state.cards[id]?.ownerId !== actorId || state.cards[id]?.zone !== 'revealed') || (action.close && ids.length !== revealed.length)) throw new Error('Escolha cartas reveladas válidas.');
      if (!['top', 'bottom', 'hand', 'graveyard', 'exile'].includes(action.destination)) throw new Error('Destino inválido.');
      for (const id of ids) moveCard(state, state.cards[id], action.destination === 'top' || action.destination === 'bottom' ? 'library' : action.destination, actorId);
      if (action.destination === 'top') seat.library = [...ids, ...seat.library.filter(id => !ids.includes(id))];
      if (action.close) seat.libraryRevealOpen = false;
      message = `${seat.name} moveu ${ids.length} carta(s) revelada(s).`; break;
    }
    case 'SHUFFLE': seat.library = shuffle(seat.library, random); message = `${seat.name} embaralhou sua biblioteca.`; break;
    case 'REVEAL': {
      if (action.cardIds.length < 1 || action.cardIds.length > 20 || action.cardIds.some(id => !seat.hand.includes(id))) throw new Error('Escolha de uma a vinte cartas da sua mão.');
      action.cardIds.forEach(id => { state.cards[id].revealed = true; });
      message = `${seat.name} revelou ${action.cardIds.map(id => state.cards[id]?.card?.name ?? id).join(', ')}.`; break;
    }
    case 'SEARCH_LIBRARY': {
      if (!action.cardIds.length || action.cardIds.length > 20 || action.cardIds.some(id => !seat.library.includes(id))) throw new Error('Escolha de uma a vinte cartas da sua própria biblioteca.');
      const destination = action.destination ?? 'hand';
      if (!['hand', 'battlefield', 'graveyard', 'exile'].includes(destination)) throw new Error('Destino de busca inválido.');
      for (const id of action.cardIds) {
        seat.library = seat.library.filter(cardId => cardId !== id);
        if (destination === 'hand') seat.hand.push(id);
        const card = state.cards[id];
        if (!card || card.ownerId !== actorId) throw new Error('A biblioteca contém uma carta inválida.');
        card.zone = destination;
        if (destination === 'battlefield') { card.controllerId = actorId; Object.assign(card, battlefieldPosition(card, Object.values(state.cards))); }
      }
      message = `${seat.name} procurou em sua biblioteca e escolheu ${action.cardIds.length} carta(s).`;
      break;
    }
    case 'CREATE_TOKEN': {
      if (!action.card?.id || !action.card.name?.trim() || !action.card.type_line?.includes('Token') || !action.card.type_line.includes('Creature')) throw new Error('Escolha uma ficha de criatura válida.');
      const id = opaqueCardId();
      const definition = JSON.parse(JSON.stringify(action.card)) as CardDefinition;
      const token: CardInstance = { id, ownerId: actorId, controllerId: actorId, cardId: id, zone: 'battlefield', tapped: false, faceDown: false, isToken: true, x: 49, y: 45, counters: {}, card: definition };
      Object.assign(token, battlefieldPosition(token, Object.values(state.cards), action.x, action.y));
      state.cards[id] = token;
      message = `${seat.name} criou a ficha ${state.cards[id].card!.name}.`; break;
    }
    case 'TRANSFER_CONTROL': {
      const card = getCard(state, action.cardId); if (card.controllerId !== actorId || card.zone !== 'battlefield' || !state.seats.some(candidate => candidate.id === action.seatId && candidate.status === 'playing')) throw new Error('Não foi possível transferir esta permanente.');
      card.controllerId = action.seatId; message = `${seat.name} transferiu o controle de ${card.card?.name ?? 'uma permanente'}.`; break;
    }
    case 'CONCEDE': seat.status = 'eliminated'; message = `${seat.name} concedeu a partida.`; if (state.seats.filter(candidate => candidate.status === 'playing').length <= 1) state.phase = 'finished'; break;
  }
  state.revision = current.revision + 1; state.updatedAt = now;
  const logEvent = resolvedItemName ? { key: 'gameLog.resolve', params: { actor: seat.name, card: resolvedItemName } } : gameLogEvent(action, state, actorId, movedCardName);
  if (logEvent && !(action.type === 'MOVE_CARD' && movedCardSourceZone === action.zone) && action.type !== 'REPOSITION_CARD') {
    state.log.push({ id: `${state.id}-${state.revision}`, actorId, message, event: logEvent, at: now, public: publicAction });
  }
  if (state.log.length > 160) state.log = state.log.slice(-160);
  return state;
}

function gameLogEvent(action: GameAction, state: MatchState, actorId: string, movedCardName?: string): GameLogEvent | undefined {
  const actor = getSeat(state, actorId).name;
  const cardName = (id: string) => state.cards[id]?.card?.name ?? 'uma carta';
  switch (action.type) {
    case 'DRAW': return { key: 'gameLog.draw', params: { actor, count: action.amount ?? 1 } };
    case 'MULLIGAN': return { key: 'gameLog.mulligan', params: { actor, count: getSeat(state, actorId).mulligans } };
    case 'KEEP_HAND': return { key: 'gameLog.keep', params: { actor } };
    case 'PLAY_LAND': return { key: 'gameLog.playLand', params: { actor, card: cardName(action.cardId) } };
    case 'MOVE_CARD': return { key: 'gameLog.move', params: { actor, card: movedCardName ?? cardName(action.cardId), zone: action.zone === 'library' && action.libraryPosition ? `table.revealDestination.${action.libraryPosition}` : `table.zones.${action.zone}` } };
    case 'TAP': return { key: 'gameLog.tap', params: { actor, verb: state.cards[action.cardId]?.tapped ? 'table.tapped' : 'table.untapped', card: cardName(action.cardId) } };
    case 'SET_LIFE': return { key: 'gameLog.life', params: { actor, player: getSeat(state, action.seatId ?? actorId).name, amount: action.amount > 0 ? `+${action.amount}` : action.amount } };
    case 'CHANGE_COUNTER': return { key: 'gameLog.counter', params: { actor, counter: action.counter, amount: action.amount > 0 ? `+${action.amount}` : action.amount, target: action.cardId ? cardName(action.cardId) : getSeat(state, action.seatId ?? actorId).name } };
    case 'ADJUST_COMMANDER_DAMAGE': return { key: 'gameLog.commanderDamageAdjustment', params: { actor, card: cardName(action.commanderCardId), amount: action.amount > 0 ? `+${action.amount}` : action.amount, total: getSeat(state, actorId).commanderDamage[state.cards[action.commanderCardId]?.cardId ?? ''] ?? 0 } };
    case 'COMMANDER_DAMAGE': return { key: 'gameLog.commanderDamage', params: { actor, amount: action.amount, player: getSeat(state, action.defenderId).name } };
    case 'CAST': return { key: 'gameLog.cast', params: { actor, card: cardName(action.cardId) } };
    case 'CAST_ABILITY': return { key: 'gameLog.ability', params: { actor, card: cardName(action.sourceId) } };
    case 'PASS_PRIORITY': return { key: 'gameLog.pass', params: { actor } };
    case 'RESOLVE_TOP': return { key: 'gameLog.resolve', params: { actor, card: state.stack.at(-1)?.name ?? 'uma magia' } };
    case 'PHASE': return { key: 'gameLog.phase', params: { actor, step: `table.steps.${action.step}` } };
    case 'ADVANCE_TURN': return { key: 'gameLog.endTurn', params: { actor, player: state.seats.find(seat => seat.id === state.activeSeatId)?.name ?? actor } };
    case 'SHUFFLE': return { key: 'gameLog.shuffle', params: { actor } };
    case 'REVEAL_LIBRARY_TOP': return { key: 'gameLog.reveal', params: { actor, cards: cardName(getSeat(state, actorId).libraryRevealed?.at(-1) ?? '') } };
    case 'MOVE_LIBRARY_REVEALED': return { key: 'gameLog.revealedMove', params: { actor, count: action.cardIds.length, destination: `table.revealDestination.${action.destination}` } };
    case 'OPEN_LIBRARY_REVEAL': return { key: 'gameLog.revealOpen', params: { actor } };
    case 'CLOSE_LIBRARY_REVEAL': return { key: 'gameLog.revealClose', params: { actor } };
    case 'REVEAL': return { key: 'gameLog.reveal', params: { actor, cards: action.cardIds.map(cardName).join(', ') } };
    case 'SEARCH_LIBRARY': return { key: 'gameLog.search', params: { actor, count: action.cardIds.length } };
    case 'CREATE_TOKEN': return { key: 'gameLog.token', params: { actor, card: action.card.name } };
    case 'TRANSFER_CONTROL': return { key: 'gameLog.transfer', params: { actor, card: cardName(action.cardId), player: getSeat(state, action.seatId).name } };
    case 'CONCEDE': return { key: 'gameLog.concede', params: { actor } };
    case 'FLIP_FACE': return { key: 'gameLog.flipFace', params: { actor, card: cardName(action.cardId) } };
    case 'SET_FACE_DOWN': return { key: action.faceDown ? 'gameLog.faceDown' : 'gameLog.revealFaceDown', params: { actor, card: cardName(action.cardId) } };
    case 'REPOSITION_CARD': return { key: 'gameLog.reposition', params: { actor, card: cardName(action.cardId) } };
  }
}

export function patchOpponentDamage(state: MatchState, attackerId: string, defenderId: string, commanderCardId: string, amount: number, combatDamage: boolean): MatchState {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('O dano precisa ser maior que zero.');
  const result = structuredClone(state); const defender = getSeat(result, defenderId); const commander = getCard(result, commanderCardId);
  if (commander.ownerId !== attackerId || !commander.card || !getSeat(result, attackerId).commanderIds.includes(commander.cardId)) throw new Error('Escolha um dos comandantes da mesa.');
  defender.life -= amount;
  if (combatDamage) defender.commanderDamage[commander.cardId] = (defender.commanderDamage[commander.cardId] ?? 0) + amount;
  result.revision++; result.updatedAt = Date.now();
  result.log.push({ id: `${result.id}-${result.revision}`, actorId: attackerId, message: `${getSeat(result, attackerId).name} causou ${amount} de dano de comandante a ${defender.name}.`, event: { key: 'gameLog.commanderDamage', params: { actor: getSeat(result, attackerId).name, amount, player: defender.name } }, at: result.updatedAt, public: true });
  return result;
}
