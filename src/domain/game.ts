export type ManaSymbol = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type ManaPool = Record<ManaSymbol, number>;
export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack';
export type CardFace = { name: string; mana_cost: string; type_line: string; oracle_text: string; power?: string; toughness?: string; image_uris?: Record<string, string> };
export type CardDefinition = {
  id: string; oracle_id: string; name: string; printed_name?: string; layout: string;
  color_identity: string[]; keywords: string[]; mana_cost: string; type_line: string; oracle_text: string;
  image_uris?: Record<string, string>; card_faces?: CardFace[];
  power?: string; toughness?: string;
  legalities: Record<string, string>; scryfall_uri?: string;
};
export type DeckEntry = { cardId: string; name: string; quantity: number; role: 'commander' | 'library'; card?: CardDefinition };
export type DeckDefinition = { id: string; name: string; format: 'commander'; commanders: string[]; entries: DeckEntry[]; updatedAt: number; source?: string };
export type CardInstance = { id: string; ownerId: string; controllerId: string; cardId: string; zone: Zone; tapped: boolean; faceDown: boolean; revealed?: boolean; face?: number; x: number; y: number; counters: Record<string, number>; card?: CardDefinition };
export type StackItem = { id: string; sourceId: string; controllerId: string; name: string; kind: 'spell' | 'ability'; target?: string };
export type PlayerSeat = { id: string; name: string; status: 'playing' | 'waiting' | 'eliminated'; commanderIds: string[]; library: string[]; hand: string[]; mulligans: number; keptHand: boolean; life: number; poison: number; mana: ManaPool; commanderCasts: Record<string, number>; commanderDamage: Record<string, number>; landPlays: number };
export type GameLogEntry = { id: string; actorId: string; message: string; at: number; public: boolean };
export type MatchState = { id: string; revision: number; phase: 'lobby' | 'mulligan' | 'playing' | 'finished'; paused: boolean; activeSeatId: string; turn: number; step: string; seats: PlayerSeat[]; cards: Record<string, CardInstance>; stack: StackItem[]; passes: string[]; log: GameLogEntry[]; updatedAt: number; hiddenZones?: Record<string, { hand: number; library: number; graveyard: number; exile: number }> };
export type GameAction =
  | { type: 'DRAW'; amount?: number }
  | { type: 'MULLIGAN' }
  | { type: 'KEEP_HAND'; bottomCardIds?: string[] }
  | { type: 'PLAY_LAND'; cardId: string; x?: number; y?: number }
  | { type: 'REPOSITION_CARD'; cardId: string; x: number; y: number }
  | { type: 'MOVE_CARD'; cardId: string; zone: Zone; x?: number; y?: number }
  | { type: 'TAP'; cardId: string }
  | { type: 'SET_LIFE'; amount: number; seatId?: string }
  | { type: 'CHANGE_COUNTER'; counter: string; amount: number; seatId?: string; cardId?: string }
  | { type: 'COMMANDER_DAMAGE'; commanderCardId: string; defenderId: string; amount: number }
  | { type: 'FLIP_FACE'; cardId: string }
  | { type: 'ADD_MANA'; symbol: ManaSymbol; amount?: number }
  | { type: 'ADJUST_MANA'; symbol: ManaSymbol; amount: number }
  | { type: 'CLEAR_MANA' }
  | { type: 'CAST'; cardId: string; x?: number; y?: number; target?: string; adjusted?: boolean; xValue?: number }
  | { type: 'CAST_ABILITY'; sourceId: string; name: string; target?: string }
  | { type: 'PASS_PRIORITY' }
  | { type: 'RESOLVE_TOP' }
  | { type: 'PHASE'; step: string }
  | { type: 'ADVANCE_TURN' }
  | { type: 'SHUFFLE' }
  | { type: 'REVEAL'; cardIds: string[] }
  | { type: 'SEARCH_LIBRARY'; cardIds: string[]; destination?: Exclude<Zone, 'library' | 'stack' | 'command'> }
  | { type: 'CREATE_TOKEN'; name: string; x?: number; y?: number }
  | { type: 'TRANSFER_CONTROL'; cardId: string; seatId: string }
  | { type: 'CONCEDE' };

export const MANA_SYMBOLS: ManaSymbol[] = ['W', 'U', 'B', 'R', 'G', 'C'];
export const COMMANDER_STARTING_LIFE = 40;
export const INITIAL_HAND_SIZE = 7;
export const ZONE_LABELS: Record<Zone, string> = {
  library: 'Biblioteca', hand: 'Mão', battlefield: 'Campo', graveyard: 'Cemitério',
  exile: 'Exílio', command: 'Zona de comando', stack: 'Pilha',
};

export function emptyManaPool(): ManaPool { return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }; }

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

export function newMatch(input: Array<{ seatId: string; name: string; deck: DeckDefinition }>, now = Date.now(), random = cryptoRandom): MatchState {
  if (input.length !== 4) throw new Error('A partida precisa de quatro decks e quatro jogadores.');
  if (input.some(({ deck }) => totalCards(deck) !== 100 || deck.commanders.length < 1 || deck.commanders.length > 2)) {
    throw new Error('Cada deck Commander precisa de 100 cartas, incluindo um ou dois comandantes.');
  }
  const seats: PlayerSeat[] = input.map(({ seatId, name, deck }) => {
    const commanders = deck.entries.filter(entry => entry.role === 'commander');
    const libraryCards = deck.entries.filter(entry => entry.role === 'library').flatMap(entry => Array.from({ length: Math.max(0, entry.quantity) }, () => entry.cardId));
    return { id: seatId, name, status: 'playing', commanderIds: commanders.map(entry => entry.cardId), library: shuffle(libraryCards, random), hand: [], mulligans: 0, keptHand: false, life: COMMANDER_STARTING_LIFE, poison: 0, mana: emptyManaPool(), commanderCasts: {}, commanderDamage: {}, landPlays: 0 };
  });
  const cards: MatchState['cards'] = {};
  seats.forEach(seat => {
    seat.commanderIds.forEach((cardId, index) => {
      const definition = input.flatMap(item => item.deck.entries).find(entry => entry.cardId === cardId)?.card;
      const instanceId = `${seat.id}-commander-${index}`;
      cards[instanceId] = { id: instanceId, ownerId: seat.id, controllerId: seat.id, cardId, zone: 'command', tapped: false, faceDown: false, x: 39 + index * 12, y: 4, counters: {}, card: definition };
    });
    const deck = input.find(item => item.seatId === seat.id)!.deck;
    const entries = deck.entries.filter(entry => entry.role === 'library');
    for (const entry of entries) {
      const definition = entry.card ?? deck.entries.find(other => other.cardId === entry.cardId)?.card;
      for (let copy = 0; copy < entry.quantity; copy++) {
        const instanceId = `${seat.id}-${entry.cardId}-${copy}`;
        cards[instanceId] = { id: instanceId, ownerId: seat.id, controllerId: seat.id, cardId: entry.cardId, zone: 'library', tapped: false, faceDown: false, x: 6, y: 6, counters: {}, card: definition };
      }
    }
    seat.library = [];
    for (const entry of entries) for (let copy = 0; copy < entry.quantity; copy++) seat.library.push(`${seat.id}-${entry.cardId}-${copy}`);
    seat.library = shuffle(seat.library, random);
  });
  const state: MatchState = { id: `match-${now.toString(36)}`, revision: 0, phase: 'mulligan', paused: false, activeSeatId: seats[Math.floor(random() * seats.length)].id, turn: 1, step: 'Manutenção', seats, cards, stack: [], passes: [], log: [], updatedAt: now };
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
export function getCard(state: MatchState, cardId: string): CardInstance {
  const card = state.cards[cardId];
  if (!card) throw new Error('Esta carta não está na mesa.');
  return card;
}

export type ManaCost = { supported: boolean; generic: number; specific: Partial<Record<ManaSymbol, number>>; xCount: number };
export function parseManaCost(cost = ''): ManaCost {
  const specific: Partial<Record<ManaSymbol, number>> = {};
  let generic = 0; let xCount = 0; let supported = true;
  const tokens = cost.match(/\{[^}]+\}/g) ?? [];
  const remainder = cost.replace(/\{[^}]+\}/g, '');
  if (remainder.trim()) supported = false;
  for (const token of tokens) {
    const symbol = token.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(symbol)) generic += Number(symbol);
    else if (symbol === 'X') xCount++;
    else if (MANA_SYMBOLS.includes(symbol as ManaSymbol) && symbol !== 'C') specific[symbol as ManaSymbol] = (specific[symbol as ManaSymbol] ?? 0) + 1;
    else if (symbol === 'C') specific.C = (specific.C ?? 0) + 1;
    else supported = false;
  }
  return { supported, generic, specific, xCount };
}

export type ManaPayment = { supported: boolean; payable: boolean; missing: string[]; spent?: ManaPool; remaining?: ManaPool };
export function payMana(pool: ManaPool, cost: string, x = 0, tax = 0): ManaPayment {
  const parsed = parseManaCost(cost);
  if (!parsed.supported) return { supported: false, payable: false, missing: ['Custo exige ajuste manual'] };
  const remaining = { ...pool }; const spent = emptyManaPool();
  for (const symbol of MANA_SYMBOLS) {
    const required = (parsed.specific[symbol] ?? 0) + (symbol === 'C' ? 0 : 0);
    if (remaining[symbol] < required) return { supported: true, payable: false, missing: [`{${symbol}} ×${required - remaining[symbol]}`] };
    remaining[symbol] -= required; spent[symbol] += required;
  }
  let generic = parsed.generic + Math.max(0, tax) + Math.max(0, x) * parsed.xCount;
  for (const symbol of ['C', 'W', 'U', 'B', 'R', 'G'] as ManaSymbol[]) {
    const use = Math.min(generic, remaining[symbol]); remaining[symbol] -= use; spent[symbol] += use; generic -= use;
  }
  return generic > 0 ? { supported: true, payable: false, missing: [`{?} ×${generic}`] } : { supported: true, payable: true, missing: [], spent, remaining };
}

export function isBasicLand(card?: CardDefinition): boolean {
  return /\bBasic Land\b/i.test(card?.type_line ?? '');
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
    seats: seats.map(({ hand: _hand, library: _library, ...seat }) => seat),
    hiddenZones: Object.fromEntries(seats.map(seat => [seat.id, { hand: seat.hand.length, library: seat.library.length, graveyard: Object.values(state.cards).filter(card => card.ownerId === seat.id && card.zone === 'graveyard').length, exile: Object.values(state.cards).filter(card => card.ownerId === seat.id && card.zone === 'exile').length }])),
  };
}

export function privateProjection(state: MatchState, seatId: string): Pick<PlayerSeat, 'hand' | 'library' | 'mana' | 'commanderCasts' | 'mulligans' | 'keptHand' | 'commanderIds'> & { privateCards: Record<string, CardInstance> } {
  const seat = getSeat(state, seatId);
  return { hand: seat.hand, library: seat.library, mana: seat.mana, commanderCasts: seat.commanderCasts, mulligans: seat.mulligans, keptHand: seat.keptHand, commanderIds: seat.commanderIds, privateCards: Object.fromEntries(Object.entries(state.cards).filter(([, card]) => card.ownerId === seatId && ['hand', 'library'].includes(card.zone))) };
}

function moveCard(state: MatchState, card: CardInstance, zone: Zone, actorId: string, x?: number, y?: number): string {
  const sourceZone = card.zone;
  if ((sourceZone === 'hand' || sourceZone === 'library' || sourceZone === 'command') && card.ownerId !== actorId) throw new Error('Somente o proprietário pode mover uma carta oculta ou da zona de comando.');
  if (sourceZone === 'battlefield' && card.controllerId !== actorId) throw new Error('Somente quem controla esta permanente pode movê-la.');
  if ((sourceZone === 'graveyard' || sourceZone === 'exile') && card.ownerId !== actorId) throw new Error('Somente o proprietário pode mover esta carta entre zonas públicas.');
  if (['hand', 'library', 'command'].includes(zone) && card.ownerId !== actorId) throw new Error('Somente o proprietário pode colocar esta carta em uma zona privada.');
  const owner = getSeat(state, card.ownerId);
  if (sourceZone === 'hand') owner.hand = owner.hand.filter(id => id !== card.id);
  if (sourceZone === 'library') owner.library = owner.library.filter(id => id !== card.id);
  if (zone === 'hand' && !owner.hand.includes(card.id)) owner.hand.push(card.id);
  if (zone === 'library' && !owner.library.includes(card.id)) owner.library.push(card.id);
  card.zone = zone; card.tapped = false; card.revealed = false; card.x = x ?? card.x; card.y = y ?? card.y;
  if (zone !== 'stack' && sourceZone === 'stack') { const item = state.stack.find(entry => entry.sourceId === card.id); if (item) state.stack = state.stack.filter(entry => entry.id !== item.id); }
  return card.card?.name ?? card.cardId;
}

export function applyAction(current: MatchState, actorId: string, action: GameAction, now = Date.now(), random = Math.random): MatchState {
  if (current.phase === 'finished') throw new Error('Esta partida terminou.');
  if (current.paused) throw new Error('A partida está pausada enquanto alguém reconecta ou aceita uma substituição.');
  const state = structuredClone(current);
  const seat = getSeat(state, actorId);
  if (seat.status === 'eliminated') throw new Error('Um jogador eliminado não pode alterar a partida.');
  let message = ''; let publicAction = true;
  switch (action.type) {
    case 'MULLIGAN': {
      if (state.phase !== 'mulligan' || seat.keptHand) throw new Error('Este jogador não pode mulligar agora.');
      seat.library = shuffle([...seat.library, ...seat.hand], random); seat.hand = seat.library.splice(0, INITIAL_HAND_SIZE); seat.mulligans++;
      seat.hand.forEach(id => { state.cards[id].zone = 'hand'; });
      seat.library.forEach(id => { state.cards[id].zone = 'library'; });
      message = `${seat.name} pediu mulligan (${seat.mulligans}).`; break;
    }
    case 'KEEP_HAND': {
      if (state.phase !== 'mulligan' || seat.keptHand) throw new Error('Esta mão já foi confirmada.');
      const keepSize = INITIAL_HAND_SIZE - Math.max(0, seat.mulligans - 1);
      const cardsToBottom = action.bottomCardIds ?? [];
      if (cardsToBottom.length !== INITIAL_HAND_SIZE - keepSize || cardsToBottom.some(id => !seat.hand.includes(id))) throw new Error(`Escolha exatamente ${INITIAL_HAND_SIZE - keepSize} carta(s) para o fundo.`);
      seat.hand = seat.hand.filter(id => !cardsToBottom.includes(id)); seat.library.push(...cardsToBottom);
      cardsToBottom.forEach(id => { state.cards[id].zone = 'library'; });
      seat.keptHand = true;
      message = `${seat.name} confirmou a mão.`;
      if (state.seats.filter(item => item.status !== 'eliminated').every(item => item.keptHand)) { state.phase = 'playing'; message += ' Todos mantiveram; a partida começou.'; }
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
      const card = getCard(state, action.cardId); moveCard(state, card, action.zone, actorId, action.x, action.y);
      message = `${seat.name} moveu ${card.card?.name ?? 'uma carta'} para ${ZONE_LABELS[action.zone]}.`; break;
    }
    case 'REPOSITION_CARD': {
      const card = getCard(state, action.cardId);
      if (card.zone !== 'battlefield' || card.controllerId !== actorId) throw new Error('Somente cartas controladas no seu campo podem ser movidas.');
      card.x = Math.min(90, Math.max(5, action.x)); card.y = Math.min(88, Math.max(5, action.y));
      message = `${seat.name} reposicionou ${card.card?.name ?? 'uma permanente'}.`; break;
    }
    case 'TAP': {
      const card = getCard(state, action.cardId); if (card.controllerId !== actorId || card.zone !== 'battlefield') throw new Error('Só é possível virar cartas do próprio campo.');
      card.tapped = !card.tapped;
      if (card.tapped && /\bBasic Land\b/i.test(card.card?.type_line ?? '')) {
        const typeLine = card.card?.type_line ?? '';
        for (const [pattern, symbol] of [[/\bPlains\b/i, 'W'], [/\bIsland\b/i, 'U'], [/\bSwamp\b/i, 'B'], [/\bMountain\b/i, 'R'], [/\bForest\b/i, 'G']] as const) {
          if (pattern.test(typeLine)) { seat.mana[symbol]++; break; }
        }
      }
      message = `${seat.name} ${card.tapped ? 'virou' : 'desvirou'} ${card.card?.name ?? 'uma permanente'}.`; break;
    }
    case 'SET_LIFE': {
      const target = state.seats.find(candidate => candidate.id === (action.seatId ?? actorId));
      if (!target || !Number.isFinite(action.amount) || Math.abs(action.amount) > 1000) throw new Error('Variação de vida inválida.');
      target.life += action.amount; message = `${seat.name} ajustou a vida de ${target.name} em ${action.amount > 0 ? '+' : ''}${action.amount}.`; break;
    }
    case 'CHANGE_COUNTER': {
      if (!Number.isFinite(action.amount) || Math.abs(action.amount) > 1000 || !/^[\w -]{1,24}$/.test(action.counter)) throw new Error('Marcador inválido.');
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
    case 'ADD_MANA': {
      seat.mana[action.symbol] = Math.min(99, seat.mana[action.symbol] + Math.max(1, Math.min(9, action.amount ?? 1)));
      message = `${seat.name} adicionou ${action.amount ?? 1} mana {${action.symbol}} ao pool.`; break;
    }
    case 'ADJUST_MANA': {
      if (!MANA_SYMBOLS.includes(action.symbol) || !Number.isFinite(action.amount) || Math.abs(action.amount) < 1 || Math.abs(action.amount) > 20) throw new Error('Ajuste de mana inválido.');
      seat.mana[action.symbol] = Math.max(0, Math.min(99, seat.mana[action.symbol] + action.amount));
      message = `${seat.name} ajustou o pool de mana {${action.symbol}} em ${action.amount > 0 ? '+' : ''}${action.amount}.`; break;
    }
    case 'CLEAR_MANA': seat.mana = emptyManaPool(); message = `${seat.name} esvaziou o pool de mana.`; break;
    case 'CAST': {
      if (state.phase !== 'playing') throw new Error('A partida ainda não começou.');
      const card = getCard(state, action.cardId);
      if (card.ownerId !== actorId || !['hand', 'command'].includes(card.zone)) throw new Error('Escolha uma carta da sua mão ou zona de comando.');
      const xValue = Math.max(0, Math.min(100, Math.floor(action.xValue ?? 0)));
      if (card.zone === 'command') {
        const castCount = seat.commanderCasts[card.cardId] ?? 0;
        const payment = payMana(seat.mana, card.card?.mana_cost ?? '', xValue, castCount * 2);
        if (!action.adjusted && (!payment.supported || !payment.payable)) throw new Error(payment.supported ? `Mana insuficiente: ${payment.missing.join(', ')}.` : 'Este custo exige confirmação e ajuste manual de mana.');
        seat.commanderCasts[card.cardId] = castCount + 1;
      } else if (!action.adjusted) {
        const payment = payMana(seat.mana, card.card?.mana_cost ?? '', xValue);
        if (!payment.supported || !payment.payable) throw new Error(payment.supported ? `Mana insuficiente: ${payment.missing.join(', ')}.` : 'Este custo exige confirmação e ajuste manual de mana.');
      }
      if (!action.adjusted) { const payment = payMana(seat.mana, card.card?.mana_cost ?? '', xValue, card.zone === 'command' ? ((seat.commanderCasts[card.cardId] ?? 1) - 1) * 2 : 0); if (payment.remaining) seat.mana = payment.remaining; }
      moveCard(state, card, 'stack', actorId, action.x, action.y);
      state.stack.push({ id: `${state.id}-stack-${state.revision + 1}`, sourceId: card.id, controllerId: actorId, name: card.card?.name ?? 'Magia', kind: 'spell', target: action.target });
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
      state.passes.push(actorId); message = `${seat.name} passou prioridade.`; break;
    }
    case 'RESOLVE_TOP': {
      if (!state.stack.length) throw new Error('A pilha está vazia.');
      const activeSeats = state.seats.filter(candidate => candidate.status === 'playing');
      if (!activeSeats.every(candidate => state.passes.includes(candidate.id))) throw new Error('Todos os jogadores ativos devem passar antes de resolver.');
      const item = state.stack.pop()!; const spell = state.cards[item.sourceId];
      if (spell) { spell.zone = spell.card && /\bInstant\b|\bSorcery\b/i.test(spell.card.type_line) ? 'graveyard' : 'battlefield'; spell.tapped = false; }
      state.passes = []; message = `${seat.name} resolveu ${item.name}.`; break;
    }
    case 'PHASE': {
      const steps = ['Desvirar', 'Manutenção', 'Compra', 'Principal pré-combate', 'Combate', 'Principal pós-combate', 'Final'];
      if (actorId !== state.activeSeatId) throw new Error('Somente o jogador do turno pode avançar a etapa.');
      if (!steps.includes(action.step)) throw new Error('Etapa de turno inválida.');
      if (state.step !== action.step) seat.mana = emptyManaPool();
      state.step = action.step;
      if (action.step === 'Desvirar') { seat.landPlays = 0; seat.mana = emptyManaPool(); Object.values(state.cards).filter(card => card.controllerId === actorId && card.zone === 'battlefield').forEach(card => { card.tapped = false; }); }
      message = `${seat.name}: ${action.step}.`; break;
    }
    case 'ADVANCE_TURN': {
      if (actorId !== state.activeSeatId || state.stack.length) throw new Error('Somente o jogador ativo pode encerrar o turno quando a pilha estiver vazia.');
      seat.mana = emptyManaPool();
      const active = state.seats.filter(candidate => candidate.status === 'playing');
      const currentIndex = active.findIndex(candidate => candidate.id === state.activeSeatId);
      if (active.length <= 1) { state.phase = 'finished'; message = `${seat.name} encerrou a partida.`; break; }
      const next = active[(currentIndex + 1) % active.length];
      if (!next) throw new Error('Não há outro jogador ativo.');
      state.turn += currentIndex === active.length - 1 ? 1 : 0;
      state.activeSeatId = next.id; state.step = 'Desvirar'; next.landPlays = 0; next.mana = emptyManaPool();
      Object.values(state.cards).filter(card => card.controllerId === next.id && card.zone === 'battlefield').forEach(card => { card.tapped = false; });
      state.passes = [];
      message = `${seat.name} encerrou o turno. É a vez de ${next.name}.`; break;
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
      for (const id of action.cardIds) {
        seat.library = seat.library.filter(cardId => cardId !== id);
        if (destination === 'hand') seat.hand.push(id);
        const card = state.cards[id];
        if (!card || card.ownerId !== actorId) throw new Error('A biblioteca contém uma carta inválida.');
        card.zone = destination;
      }
      message = `${seat.name} procurou em sua biblioteca e escolheu ${action.cardIds.length} carta(s).`;
      break;
    }
    case 'CREATE_TOKEN': {
      const id = `${state.id}-token-${state.revision + 1}`; state.cards[id] = { id, ownerId: actorId, controllerId: actorId, cardId: id, zone: 'battlefield', tapped: false, faceDown: false, x: action.x ?? 49, y: action.y ?? 45, counters: {}, card: { id, oracle_id: id, name: action.name.trim() || 'Ficha', layout: 'normal', color_identity: [], keywords: [], mana_cost: '', type_line: 'Token Creature', oracle_text: '', legalities: {} } };
      message = `${seat.name} criou a ficha ${state.cards[id].card!.name}.`; break;
    }
    case 'TRANSFER_CONTROL': {
      const card = getCard(state, action.cardId); if (card.controllerId !== actorId || card.zone !== 'battlefield' || !state.seats.some(candidate => candidate.id === action.seatId && candidate.status === 'playing')) throw new Error('Não foi possível transferir esta permanente.');
      card.controllerId = action.seatId; message = `${seat.name} transferiu o controle de ${card.card?.name ?? 'uma permanente'}.`; break;
    }
    case 'CONCEDE': seat.status = 'eliminated'; message = `${seat.name} concedeu a partida.`; if (state.seats.filter(candidate => candidate.status === 'playing').length <= 1) state.phase = 'finished'; break;
  }
  if (action.type === 'CAST' && action.adjusted) message += ' (pagamento ajustado manualmente)';
  state.revision = current.revision + 1; state.updatedAt = now;
  state.log.push({ id: `${state.id}-${state.revision}`, actorId, message, at: now, public: publicAction });
  if (state.log.length > 160) state.log = state.log.slice(-160);
  return state;
}

export function patchOpponentDamage(state: MatchState, attackerId: string, defenderId: string, commanderCardId: string, amount: number, combatDamage: boolean): MatchState {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('O dano precisa ser maior que zero.');
  const result = structuredClone(state); const defender = getSeat(result, defenderId); const commander = getCard(result, commanderCardId);
  if (commander.ownerId !== attackerId || !commander.card || !getSeat(result, attackerId).commanderIds.includes(commander.cardId)) throw new Error('Escolha um dos comandantes da mesa.');
  defender.life -= amount;
  if (combatDamage) defender.commanderDamage[commander.cardId] = (defender.commanderDamage[commander.cardId] ?? 0) + amount;
  result.revision++; result.updatedAt = Date.now();
  result.log.push({ id: `${result.id}-${result.revision}`, actorId: attackerId, message: `${getSeat(result, attackerId).name} causou ${amount} de dano de comandante a ${defender.name}.`, at: result.updatedAt, public: true });
  return result;
}
