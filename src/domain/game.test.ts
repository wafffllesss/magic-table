import { describe, expect, it } from 'vitest';
import type { CardDefinition, DeckDefinition, MatchState } from './game';
import { applyAction, newMatch, payMana, publicProjection, privateProjection, type ManaPool } from './game';

function card(id: string, name: string, typeLine = 'Creature', cost = '{1}{G}'): CardDefinition {
  return { id, oracle_id: id, name, layout: 'normal', color_identity: typeLine.includes('Land') ? [] : ['G'], keywords: [], mana_cost: cost, type_line: typeLine, oracle_text: '', legalities: { commander: 'legal' } };
}
function deckFor(seatId: string): DeckDefinition {
  const leader = card(`${seatId}-leader`, `${seatId} Commander`, 'Legendary Creature — Human', '{1}{G}');
  const spells = Array.from({ length: 64 }, (_, index) => card(`${seatId}-spell-${index}`, `${seatId} Spell ${index}`));
  const plains = card(`${seatId}-forest`, `${seatId} Forest`, 'Basic Land — Forest', '');
  const entries: DeckDefinition['entries'] = [
    { cardId: leader.id, name: leader.name, quantity: 1, role: 'commander', card: leader },
    ...spells.map(definition => ({ cardId: definition.id, name: definition.name, quantity: 1, role: 'library' as const, card: definition })),
    { cardId: plains.id, name: plains.name, quantity: 35, role: 'library', card: plains },
  ];
  return { id: `deck-${seatId}`, name: `${seatId} deck`, format: 'commander', commanders: [leader.id], entries, updatedAt: 1 };
}
function newFourPlayerGame(now = 1000): MatchState {
  return newMatch(['northWest', 'northEast', 'southEast', 'southWest'].map(seatId => ({ seatId, name: seatId, deck: deckFor(seatId) })), now, () => 0);
}
function keepAllHands(state: MatchState): MatchState {
  let result = state;
  for (const seat of result.seats) result = applyAction(result, seat.id, { type: 'KEEP_HAND', bottomCardIds: [] }, 2000, () => 0);
  return result;
}

describe('Commander table domain', () => {
  it('builds four 100-card decks with seven private opening cards per seat', () => {
    const game = newFourPlayerGame();
    expect(game.phase).toBe('mulligan');
    expect(game.seats).toHaveLength(4);
    expect(game.seats.every(seat => seat.hand.length === 7 && seat.library.length === 92)).toBe(true);
    expect(game.paused).toBe(false);
  });

  it('projects hidden cards and private hand/library data away from spectators', () => {
    const game = newFourPlayerGame();
    const own = game.seats[0];
    const projection = publicProjection(game);
    expect(projection.hiddenZones[own.id]).toMatchObject({ hand: 7, library: 92 });
    expect(projection.seats[0]).not.toHaveProperty('hand');
    expect(projection.seats[0]).not.toHaveProperty('library');
    expect(own.hand.every(id => !projection.cards[id])).toBe(true);
    expect(own.library.every(id => !projection.cards[id])).toBe(true);
    expect(Object.keys(privateProjection(game, own.id).privateCards)).toHaveLength(99);
    expect(JSON.stringify(projection)).not.toContain(own.library[0]);
  });

  it('keeps the first multiplayer mulligan free and moves the next bottomed card into the library', () => {
    let game = newFourPlayerGame();
    const player = game.seats[0];
    game = applyAction(game, player.id, { type: 'MULLIGAN' }, 2100, () => 0);
    expect(game.seats[0].hand).toHaveLength(7);
    expect(game.seats[0].library).toHaveLength(92);
    game = applyAction(game, player.id, { type: 'MULLIGAN' }, 2200, () => 0);
    const toBottom = game.seats[0].hand[0];
    game = applyAction(game, player.id, { type: 'KEEP_HAND', bottomCardIds: [toBottom] }, 2300, () => 0);
    expect(game.seats[0].keptHand).toBe(true);
    expect(game.seats[0].hand).toHaveLength(6);
    expect(game.seats[0].library).toContain(toBottom);
    expect(game.cards[toBottom].zone).toBe('library');
  });

  it('adds mana once when a basic land is tapped and keeps it when the land is untapped', () => {
    let game = keepAllHands(newFourPlayerGame());
    const playerId = game.activeSeatId;
    const seat = game.seats.find(item => item.id === playerId)!;
    const basicId = seat.library.find(id => game.cards[id].card?.type_line.includes('Basic Land'))!;
    seat.library = seat.library.filter(id => id !== basicId); seat.hand.push(basicId); game.cards[basicId].zone = 'hand';
    game = applyAction(game, playerId, { type: 'PLAY_LAND', cardId: basicId, x: 20, y: 25 }, 3000);
    game = applyAction(game, playerId, { type: 'TAP', cardId: basicId }, 3100);
    expect(game.seats.find(item => item.id === playerId)?.mana.G).toBe(1);
    game = applyAction(game, playerId, { type: 'TAP', cardId: basicId }, 3200);
    expect(game.seats.find(item => item.id === playerId)?.mana.G).toBe(1);
  });

  it('clears the active mana pool when a phase changes and when the turn ends', () => {
    let game = keepAllHands(newFourPlayerGame());
    const playerId = game.activeSeatId;
    game = applyAction(game, playerId, { type: 'ADJUST_MANA', symbol: 'G', amount: 2 }, 3300);
    game = applyAction(game, playerId, { type: 'PHASE', step: 'Compra' }, 3400);
    expect(game.seats.find(item => item.id === playerId)?.mana.G).toBe(0);
    game = applyAction(game, playerId, { type: 'ADJUST_MANA', symbol: 'G', amount: 2 }, 3500);
    game = applyAction(game, playerId, { type: 'ADVANCE_TURN' }, 3600);
    expect(game.seats.find(item => item.id === playerId)?.mana.G).toBe(0);
  });

  it('keeps hand membership, public reveals, and hidden zones in sync when moving a card', () => {
    let game = keepAllHands(newFourPlayerGame());
    const player = game.seats.find(seat => seat.id === game.activeSeatId)!;
    const cardId = player.hand[0];
    game = applyAction(game, player.id, { type: 'REVEAL', cardIds: [cardId] }, 3700);
    expect(publicProjection(game).cards[cardId]?.card?.name).toBe(game.cards[cardId].card?.name);
    game = applyAction(game, player.id, { type: 'MOVE_CARD', cardId, zone: 'graveyard' }, 3800);
    expect(game.seats.find(seat => seat.id === player.id)?.hand).not.toContain(cardId);
    expect(publicProjection(game).hiddenZones[player.id].hand).toBe(6);
    expect(game.cards[cardId].revealed).toBe(false);
    game = applyAction(game, player.id, { type: 'MOVE_CARD', cardId, zone: 'hand' }, 3900);
    expect(game.seats.find(seat => seat.id === player.id)?.hand).toContain(cardId);
    expect(publicProjection(game).hiddenZones[player.id].hand).toBe(7);
    expect(publicProjection(game).cards[cardId]).toBeUndefined();
  });

  it('validates colored, generic, colorless, X, and commander-tax payments', () => {
    const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 1 };
    expect(payMana(pool, '{2}{G}')).toMatchObject({ payable: true, remaining: { G: 0, C: 0 } });
    expect(payMana(pool, '{C}')).toMatchObject({ payable: true, remaining: { C: 0, G: 2 } });
    expect(payMana({ ...pool, C: 0 }, '{C}').payable).toBe(false);
    expect(payMana(pool, '{X}{G}', 3).payable).toBe(false);
    expect(payMana({ ...pool, G: 3, C: 2 }, '{X}{G}', 2).payable).toBe(true);
    expect(payMana({ ...pool, G: 1 }, '{1}{G}', 0, 2).payable).toBe(false);
  });

  it('keeps library search private, exposes the public count and records manual shuffle', () => {
    let game = keepAllHands(newFourPlayerGame());
    const own = game.seats.find(seat => seat.id === game.activeSeatId)!;
    const chosen = own.library[0];
    game = applyAction(game, own.id, { type: 'SEARCH_LIBRARY', cardIds: [chosen], destination: 'hand' }, 4000);
    const publicSearch = publicProjection(game);
    expect(game.cards[chosen].zone).toBe('hand');
    expect(publicSearch.cards[chosen]).toBeUndefined();
    expect(publicSearch.hiddenZones[own.id].hand).toBe(8);
    expect(publicSearch.log.at(-1)?.message).not.toContain(game.cards[chosen].card?.name);
    game = applyAction(game, own.id, { type: 'SHUFFLE' }, 4100, () => 0);
    expect(publicProjection(game).log.at(-1)?.message).toContain('embaralhou');
  });

  it('requires all active seats to pass before the top item resolves', () => {
    let game = keepAllHands(newFourPlayerGame());
    const playerId = game.activeSeatId;
    const seat = game.seats.find(item => item.id === playerId)!;
    const spellId = seat.hand.find(id => !game.cards[id].card?.type_line.includes('Land'))!;
    game.cards[spellId].card!.type_line = 'Instant';
    game = applyAction(game, playerId, { type: 'CAST', cardId: spellId, adjusted: true }, 5000);
    expect(() => applyAction(game, playerId, { type: 'RESOLVE_TOP' }, 5001)).toThrow(/passar/);
    for (const activeSeat of game.seats) game = applyAction(game, activeSeat.id, { type: 'PASS_PRIORITY' }, 5100);
    game = applyAction(game, playerId, { type: 'RESOLVE_TOP' }, 5200);
    expect(game.stack).toHaveLength(0);
    expect(game.cards[spellId].zone).toBe('graveyard');
  });

  it('records commander damage independently by commander and defender', () => {
    let game = keepAllHands(newFourPlayerGame());
    const attacker = game.seats[0]; const defender = game.seats[1];
    const commander = Object.values(game.cards).find(item => item.ownerId === attacker.id && item.zone === 'command')!;
    commander.zone = 'battlefield';
    game = applyAction(game, attacker.id, { type: 'TRANSFER_CONTROL', cardId: commander.id, seatId: defender.id }, 6000);
    const next = applyAction(game, defender.id, { type: 'COMMANDER_DAMAGE', commanderCardId: commander.id, defenderId: attacker.id, amount: 7 }, 6100);
    expect(next.seats.find(item => item.id === attacker.id)?.commanderDamage[commander.cardId]).toBe(7);
    expect(next.seats.find(item => item.id === attacker.id)?.life).toBe(33);
  });

  it('retains the table and supports a public stress field of 200 permanents', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actorId = game.activeSeatId;
    for (let index = 0; index < 200; index++) game = applyAction(game, actorId, { type: 'CREATE_TOKEN', name: `Token ${index}`, x: index % 90, y: index % 80 }, 7000 + index);
    expect(Object.values(publicProjection(game).cards).filter(item => item.zone === 'battlefield')).toHaveLength(200);
  });
});
