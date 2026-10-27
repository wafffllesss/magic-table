import type { DeckDefinition, MatchState } from '../domain/game';
import { newMatch } from '../domain/game';
import { DEFAULT_PRECON_ID, DEMO_OPPONENT_IDS } from './precons';
import type { TableSeatId } from './firebaseRoom';

export function startDemoMatch(playerName: string, templates: DeckDefinition[], ownDeck?: DeckDefinition): MatchState {
  if (templates.length < 4) throw new Error('Carregue os quatro decks antes de iniciar a demonstração.');
  const playerDeck = ownDeck ?? templates.find(deck => deck.id === DEFAULT_PRECON_ID) ?? templates[0];
  const opponents = [...DEMO_OPPONENT_IDS.flatMap(id => templates.filter(deck => deck.id === id)), ...templates]
    .filter((deck, index, all) => deck.id !== playerDeck.id && all.findIndex(item => item.id === deck.id) === index).slice(0, 3);
  if (opponents.length < 3) throw new Error('Carregue quatro decks distintos antes de iniciar a demonstração.');
  const seats: Array<{ seatId: TableSeatId; name: string; deck: DeckDefinition }> = [
    { seatId: 'northWest', name: 'Yara', deck: opponents[0] },
    { seatId: 'northEast', name: 'Mateus', deck: opponents[1] },
    { seatId: 'southEast', name: 'Bia', deck: opponents[2] },
    { seatId: 'southWest', name: playerName.trim() || 'Você', deck: playerDeck },
  ];
  const state = newMatch(seats, Date.now());
  state.phase = 'playing'; state.turn = 3; state.step = 'Principal pré-combate'; state.activeSeatId = 'southWest';
  for (const seat of state.seats) seat.keptHand = true;
  const seeds: Array<[TableSeatId, number[]]> = [['northWest', [0, 8]], ['northEast', [3, 10]], ['southEast', [1, 14]], ['southWest', [11, 2, 19]]];
  for (const [seatId, indices] of seeds) {
    const seat = state.seats.find(current => current.id === seatId)!;
    for (const index of indices) {
      const isPermanent = (id: string) => /\b(Creature|Artifact|Enchantment|Planeswalker|Battle|Land)\b/i.test(state.cards[id].card?.type_line ?? '');
      let slot = seat.library.findIndex((id, slot) => slot >= index && isPermanent(id));
      if (slot < 0) slot = seat.library.findIndex(isPermanent);
      if (slot < 0) continue;
      const cardId = seat.library.splice(slot, 1)[0]; const card = state.cards[cardId];
      if (!card) continue;
      card.zone = 'battlefield'; card.x = 11 + indices.indexOf(index) * 20; card.y = 14 + (indices.indexOf(index) % 2) * 14;
      card.tapped = card.card?.type_line.includes('Basic Land') === true && index % 3 === 1;
    }
    if (seatId !== 'southWest') seat.life -= (seatId === 'northWest' ? 5 : 2);
  }
  const opposingSpell = Object.values(state.cards).find(card => card.ownerId === 'northEast' && card.zone === 'battlefield' && /Enchantment|Creature/i.test(card.card?.type_line ?? ''))
    ?? Object.values(state.cards).find(card => card.ownerId === 'northEast' && card.zone === 'library' && !/\bLand\b/i.test(card.card?.type_line ?? ''));
  if (opposingSpell) {
    if (opposingSpell.zone === 'library') {
      const owner = state.seats.find(seat => seat.id === opposingSpell.ownerId)!;
      owner.library = owner.library.filter(id => id !== opposingSpell.id);
    }
    opposingSpell.zone = 'stack';
    state.stack.push({ id: `${state.id}-sample-stack`, sourceId: opposingSpell.id, controllerId: 'northEast', name: opposingSpell.card?.name ?? 'Uma magia', kind: 'spell' });
  }
  state.passes = ['northWest', 'northEast', 'southEast'];
  state.log.push({ id: `${state.id}-welcome`, actorId: 'system', message: 'Uma partida de demonstração está em andamento. Explore a mesa e experimente os atalhos.', at: Date.now(), public: true });
  return state;
}

export function addStressObjects(source: MatchState, count = 200): MatchState {
  const state = structuredClone(source);
  const seats = state.seats.filter(seat => seat.status === 'playing');
  for (let index = 0; index < Math.max(0, count); index++) {
    const seat = seats[index % seats.length];
    const localIndex = Math.floor(index / seats.length);
    const id = `${state.id}-stress-${index}`;
    const name = `Permanente de teste ${index + 1}`;
    state.cards[id] = {
      id, ownerId: seat.id, controllerId: seat.id, cardId: id, zone: 'battlefield',
      tapped: false, faceDown: false, x: 7 + localIndex % 8 * 10.5,
      y: 13 + Math.floor(localIndex / 8) * 10, counters: {},
      card: { id, oracle_id: id, name, layout: 'normal', color_identity: [], keywords: [], mana_cost: '', type_line: 'Token Creature', oracle_text: '', legalities: {} },
    };
  }
  return state;
}
