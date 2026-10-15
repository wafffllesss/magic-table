import type { CardDefinition, DeckDefinition, MatchState } from '../domain/game';
import { newMatch } from '../domain/game';
import { localRepository } from './storage';
import type { TableSeatId } from './firebaseRoom';

const BASIC_LANDS = { w: 'Plains', u: 'Island', b: 'Swamp', r: 'Mountain', g: 'Forest' } as const;
type SampleCommander = { name: string; color: string; text: string; type?: string; cost?: string };
type SampleDeck = { id: string; name: string; colors: string; commanders: SampleCommander[] };

const SAMPLE_DECKS: SampleDeck[] = [
  { id: 'demo-white', name: 'Vanguarda do Distrito', colors: 'w', commanders: [{ name: 'Adeline, Resplendent Cathar', color: 'W', type: 'Legendary Creature — Human Knight', cost: '{1}{W}{W}', text: 'Vigilance. Whenever Adeline attacks, for each opponent, create a 1/1 white Human creature token that’s tapped and attacking that player or a planeswalker they control.' }] },
  { id: 'demo-blue', name: 'Cartógrafos do Éter', colors: 'u', commanders: [{ name: 'Talrand, Sky Summoner', color: 'U', type: 'Legendary Creature — Merfolk Wizard', cost: '{2}{U}{U}', text: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.' }] },
  { id: 'demo-partners', name: 'Uma Sociedade Inesperada', colors: 'wg', commanders: [
    { name: 'Frodo, Adventurous Hobbit', color: 'W', type: 'Legendary Creature — Halfling Scout', cost: '{W}', text: 'Whenever you attack with Frodo, if it’s the first combat phase of the turn, target legendary creature gains indestructible until end of turn. Partner with Sam, Loyal Attendant.' },
    { name: 'Sam, Loyal Attendant', color: 'G', type: 'Legendary Creature — Halfling Peasant', cost: '{1}{G}', text: 'Vigilance. Food tokens you control have “{2}, {T}, Sacrifice this token: You gain 3 life.” Partner with Frodo, Adventurous Hobbit.' },
  ] },
  { id: 'demo-background', name: 'Aventura sem Fronteiras', colors: 'wb', commanders: [
    { name: 'Lae’zel, Vlaakith’s Champion', color: 'W', type: 'Legendary Creature — Gith Warrior', cost: '{1}{W}', text: 'If you would put one or more counters on a creature or planeswalker you control, that many plus one of each of those kinds of counters are put on that permanent instead. Choose a Background.' },
    { name: 'Agent of the Iron Throne', color: 'B', type: 'Legendary Enchantment — Background', cost: '{2}{B}', text: 'Commander creatures you own have “Whenever an artifact or creature you control is put into a graveyard from the battlefield, each opponent loses 1 life.”' },
  ] },
];

function sampleCard(id: string, name: string, cost: string, typeLine: string, colors: string[], text = '', power?: string, toughness?: string): CardDefinition {
  return { id, oracle_id: id, name, layout: 'normal', color_identity: colors, keywords: [], mana_cost: cost, type_line: typeLine, oracle_text: text, power, toughness, legalities: { commander: 'legal' } };
}

export function makeDemoDeckSet(): DeckDefinition[] {
  return SAMPLE_DECKS.map((recipe, recipeIndex) => {
    const commanders = recipe.commanders.map((leader, index) => ({
      cardId: `${recipe.id}-commander-${index}`, name: leader.name, quantity: 1,
      role: 'commander' as const,
      card: {
        ...sampleCard(`${recipe.id}-commander-${index}`, leader.name, leader.cost ?? '', leader.type ?? 'Legendary Creature', [leader.color], leader.text, '3', '3'),
        keywords: /\bPartner\b/i.test(leader.text) ? ['Partner'] : [],
      },
    }));
    const availableSymbols = recipe.colors.split('');
    const spellEntries = Array.from({ length: 100 - commanders.length - 35 }, (_, index) => {
      const color = availableSymbols[index % availableSymbols.length];
      const role = index % 4;
      const names = ['Guardiã do Portal', 'Oráculo das Marés', 'Torre do Vigia', 'Feiticeira Errante', 'Cavaleiro da Campina', 'Conselheira da Corte', 'Elemental da Aurora', 'Patrulheira do Bosque'];
      const name = `${names[(index + recipeIndex) % names.length]} ${String(index + 1).padStart(2, '0')}`;
      const card = sampleCard(`${recipe.id}-spell-${index}`, name, index % 3 === 0 ? `{1}{${color.toUpperCase()}}` : `{${color.toUpperCase()}}`, role === 0 ? 'Creature' : role === 1 ? 'Instant' : role === 2 ? 'Sorcery' : 'Enchantment', [color.toUpperCase()], role === 0 ? 'Quando esta criatura entra no campo, scry 1.' : 'Efeito de demonstração. Faça uma escolha e registre o resultado com a mesa.', '2', '2');
      return { cardId: card.id, name, quantity: 1, role: 'library' as const, card };
    });
    const basicPerColor = Math.floor(35 / availableSymbols.length);
    let extraBasics = 35 % availableSymbols.length;
    const basicEntries = availableSymbols.map(color => {
      const landName = BASIC_LANDS[color as keyof typeof BASIC_LANDS];
      const card = sampleCard(`${recipe.id}-${landName}`, landName, '', `Basic Land — ${landName}`, [], '({T}: Add mana of the matching color.)');
      const lands = basicPerColor + (extraBasics-- > 0 ? 1 : 0);
      return { cardId: card.id, name: landName, quantity: lands, role: 'library' as const, card };
    });
    return { id: recipe.id, name: recipe.name, format: 'commander', commanders: commanders.map(entry => entry.cardId), entries: [...commanders, ...spellEntries, ...basicEntries], updatedAt: 0, source: 'demonstração local' } satisfies DeckDefinition;
  });
}

export function startDemoMatch(playerName: string, ownDeck?: DeckDefinition): MatchState {
  const templates = makeDemoDeckSet();
  const seats: Array<{ seatId: TableSeatId; name: string; deck: DeckDefinition }> = [
    { seatId: 'northWest', name: 'Yara', deck: templates[1] },
    { seatId: 'northEast', name: 'Mateus', deck: templates[3] },
    { seatId: 'southEast', name: 'Bia', deck: templates[2] },
    { seatId: 'southWest', name: playerName.trim() || 'Você', deck: ownDeck ?? templates[0] },
  ];
  const state = newMatch(seats, Date.now());
  state.phase = 'playing'; state.turn = 3; state.step = 'Principal pré-combate'; state.activeSeatId = 'southWest';
  for (const seat of state.seats) seat.keptHand = true;
  const seeds: Array<[TableSeatId, number[]]> = [['northWest', [0, 8]], ['northEast', [3, 10]], ['southEast', [1, 14]], ['southWest', [11, 2, 19]]];
  for (const [seatId, indices] of seeds) {
    const seat = state.seats.find(current => current.id === seatId)!;
    for (const index of indices) {
      const cardId = seat.library.splice(index, 1)[0]; const card = state.cards[cardId];
      if (!card) continue;
      card.zone = 'battlefield'; card.x = 11 + indices.indexOf(index) * 20; card.y = 14 + (indices.indexOf(index) % 2) * 14;
      card.tapped = card.card?.type_line.includes('Basic Land') === true && index % 3 === 1;
      if (card.card?.type_line.includes('Plains') && card.tapped) seat.mana.W++;
      if (card.card?.type_line.includes('Island') && card.tapped) seat.mana.U++;
      if (card.card?.type_line.includes('Swamp') && card.tapped) seat.mana.B++;
      if (card.card?.type_line.includes('Mountain') && card.tapped) seat.mana.R++;
      if (card.card?.type_line.includes('Forest') && card.tapped) seat.mana.G++;
    }
    if (seatId !== 'southWest') seat.life -= (seatId === 'northWest' ? 5 : 2);
  }
  const opposingSpell = Object.values(state.cards).find(card => card.ownerId === 'northEast' && card.zone === 'battlefield' && /Enchantment|Creature/i.test(card.card?.type_line ?? ''));
  if (opposingSpell) {
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

export async function warmDemoDecks(): Promise<DeckDefinition[]> {
  const decks = makeDemoDeckSet();
  await Promise.all(decks.map(deck => localRepository.saveDeck(deck)));
  return decks;
}
