import { describe, expect, it } from 'vitest';
import type { CardDefinition, DeckDefinition, MatchState } from './game';
import { advanceTurn, applyAction, commandersForSeat, eligibleSeats, newMatch, publicProjection, privateProjection } from './game';
import { restoreHistorySnapshot } from './history';

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
  it.each(['top', 'bottom'] as const)('returns cards from different zones to the %s of their library', position => {
    let game = keepAllHands(newFourPlayerGame());
    const actor = game.seats[0].id;
    const ids = game.seats[0].hand.slice(0, 4);
    for (const [index, zone] of (['hand', 'battlefield', 'graveyard', 'exile'] as const).entries()) {
      if (zone !== 'hand') game = applyAction(game, actor, { type: 'MOVE_CARD', cardId: ids[index], zone });
      const previous = [...game.seats[0].library];
      game = applyAction(game, actor, { type: 'MOVE_CARD', cardId: ids[index], zone: 'library', libraryPosition: position });
      expect(game.seats[0].library).toEqual(position === 'top' ? [ids[index], ...previous] : [...previous, ids[index]]);
      expect(game.cards[ids[index]].zone).toBe('library');
      expect(game.log.at(-1)?.event).toMatchObject({ key: 'gameLog.move', params: { zone: `table.revealDestination.${position}` } });
      expect(game.log.at(-1)?.message).toContain(position === 'top' ? 'topo do deck' : 'fundo do deck');
      if (zone === 'hand') expect(game.log.at(-1)?.message).not.toContain(game.cards[ids[index]].card!.name);
    }
  });
  it('removes a spell from the stack when returning it to the library', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actor = game.activeSeatId;
    const id = game.seats.find(seat => seat.id === actor)!.hand[0];
    game = applyAction(game, actor, { type: 'CAST', cardId: id });
    game = applyAction(game, actor, { type: 'MOVE_CARD', cardId: id, zone: 'library', libraryPosition: 'top' });
    expect(game.stack.some(item => item.sourceId === id)).toBe(false);
    expect(game.seats.find(seat => seat.id === actor)!.library[0]).toBe(id);
  });
  it('reveals the library top publicly and returns cards in the chosen order', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actor = game.seats[0].id; const original = [...game.seats[0].library];
    game = applyAction(game, actor, { type: 'OPEN_LIBRARY_REVEAL' });
    game = applyAction(game, actor, { type: 'REVEAL_LIBRARY_TOP' });
    const afterFirst = game;
    game = applyAction(game, actor, { type: 'REVEAL_LIBRARY_TOP' });
    const undone = restoreHistorySnapshot(afterFirst, game, actor, 'UNDO', 'reveal-undo');
    expect(undone.seats[0].libraryRevealed).toEqual(original.slice(0, 1));
    expect(undone.seats[0].library[0]).toBe(original[1]);
    const redone = restoreHistorySnapshot(game, undone, actor, 'REDO', 'reveal-redo');
    expect(redone.seats[0].libraryRevealed).toEqual(original.slice(0, 2));
    expect(game.seats[0].libraryRevealed).toEqual(original.slice(0, 2));
    expect(game.seats[0].library).toEqual(original.slice(2));
    const view = publicProjection(game);
    expect(view.cards[original[0]]?.zone).toBe('revealed');
    expect(view.cards[original[2]]).toBeUndefined();
    expect(() => applyAction(game, game.seats[1].id, { type: 'MOVE_CARD', cardId: original[0], zone: 'hand' })).toThrow();
    expect(() => applyAction(game, actor, { type: 'CLOSE_LIBRARY_REVEAL' })).toThrow();
    game = applyAction(game, actor, { type: 'MOVE_LIBRARY_REVEALED', cardIds: [original[1], original[0]], destination: 'top', close: true });
    expect(game.seats[0].library.slice(0, 3)).toEqual([original[1], original[0], original[2]]);
    expect(game.seats[0].libraryRevealOpen).toBe(false);
    expect(publicProjection(game).cards[original[0]]).toBeUndefined();
  });

  it('moves individual and grouped reveals without losing the bottom order', () => {
    let game = keepAllHands(newFourPlayerGame()); const actor = game.seats[0].id;
    const original = [...game.seats[0].library];
    game = applyAction(game, actor, { type: 'OPEN_LIBRARY_REVEAL' });
    for (let i = 0; i < 3; i++) game = applyAction(game, actor, { type: 'REVEAL_LIBRARY_TOP' });
    game = applyAction(game, actor, { type: 'MOVE_CARD', cardId: original[0], zone: 'battlefield' });
    expect(game.seats[0].libraryRevealed).toEqual(original.slice(1, 3));
    expect(() => applyAction(game, actor, { type: 'MOVE_LIBRARY_REVEALED', cardIds: [original[1], original[1]], destination: 'bottom' })).toThrow();
    game = applyAction(game, actor, { type: 'MOVE_LIBRARY_REVEALED', cardIds: original.slice(1, 3), destination: 'bottom' });
    expect(game.seats[0].library.slice(-2)).toEqual(original.slice(1, 3));
    expect(game.cards[original[0]].zone).toBe('battlefield');
    game.seats[0].library = [];
    expect(() => applyAction(game, actor, { type: 'REVEAL_LIBRARY_TOP' })).toThrow();
  });
  it.each([1, 2, 3, 4])('starts with exactly %i real players, even when occupied places are not consecutive', count => {
    const ids = ['northWest', 'southEast', 'southWest', 'northEast'].slice(0, count);
    const game = newMatch(ids.map(id => ({ seatId: id, name: id, deck: deckFor(id), participantUid: `uid-${id}` })), 1000, () => 0);
    expect(game.seats.map(seat => seat.id)).toEqual(['northWest', 'northEast', 'southEast', 'southWest'].filter(id => ids.includes(id)));
    expect(game.seats.every(seat => seat.hand.length === 7 && seat.library.length === 92 && seat.participantUid)).toBe(true);
    expect(game.activeSeatId).toBe(game.seats[0].id);
  });

  it('cycles one eligible player without ending the game and skips a suspended player in round order', () => {
    let solo = newMatch([{ seatId: 'southEast', name: 'Solo', deck: deckFor('solo') }], 1000, () => 0);
    solo = applyAction(solo, solo.seats[0].id, { type: 'KEEP_HAND' }, 2000);
    solo = applyAction(solo, solo.activeSeatId, { type: 'ADVANCE_TURN' }, 3000);
    expect(solo.phase).toBe('playing');
    expect(solo.turn).toBe(2);
    expect(solo.activeSeatId).toBe('southEast');

    const game = newMatch(['northWest', 'southEast', 'southWest'].map(id => ({ seatId: id, name: id, deck: deckFor(id) })), 1000, () => 0);
    const turn = structuredClone(game);
    turn.phase = 'playing';
    turn.suspendedSeatIds = ['southEast'];
    expect(eligibleSeats(turn).map(seat => seat.id)).toEqual(['northWest', 'southWest']);
    advanceTurn(turn);
    expect(turn.activeSeatId).toBe('southWest');
    advanceTurn(turn);
    expect(turn.activeSeatId).toBe('northWest');
    expect(turn.turn).toBe(2);
  });

  it('builds four 100-card decks with seven private opening cards per seat', () => {
    const game = newFourPlayerGame();
    expect(game.phase).toBe('mulligan');
    expect(game.seats).toHaveLength(4);
    expect(game.seats.every(seat => seat.hand.length === 7 && seat.library.length === 92)).toBe(true);
    expect(game.seats.every(seat => !('mana' in seat))).toBe(true);
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

  it('keeps a face-down public card opaque until its owner reveals it', () => {
    const game = newFourPlayerGame();
    const owner = game.seats[0];
    const instanceId = owner.hand[0];
    const card = game.cards[instanceId];
    owner.hand = owner.hand.filter(id => id !== instanceId);
    card.zone = 'battlefield';
    card.faceDown = true;
    const hidden = publicProjection(game);
    expect(hidden.cards[instanceId]).toMatchObject({ id: instanceId, cardId: 'face-down', faceDown: true });
    expect(hidden.cards[instanceId]).not.toHaveProperty('card');
    expect(JSON.stringify(hidden)).not.toContain(card.card?.id);
    const revealed = applyAction(game, owner.id, { type: 'SET_FACE_DOWN', cardId: instanceId, faceDown: false }, 2050);
    expect(publicProjection(revealed).cards[instanceId]?.card?.name).toBe(card.card?.name);
  });

  it('keeps the first multiplayer mulligan free and draws one fewer card on each subsequent mulligan', () => {
    let game = newFourPlayerGame();
    const player = game.seats[0];
    game = applyAction(game, player.id, { type: 'MULLIGAN' }, 2100, () => 0);
    expect(game.log.at(-1)?.event).toMatchObject({ key: 'gameLog.mulligan', params: { actor: player.name, count: 1 } });
    expect(game.log.at(-1)?.message).toContain('mulligan');
    expect(game.seats[0].hand).toHaveLength(7);
    expect(game.seats[0].library).toHaveLength(92);
    game = applyAction(game, player.id, { type: 'MULLIGAN' }, 2200, () => 0);
    expect(game.seats[0].hand).toHaveLength(6);
    game = applyAction(game, player.id, { type: 'MULLIGAN' }, 2250, () => 0);
    expect(game.seats[0].hand).toHaveLength(5);
    game = applyAction(game, player.id, { type: 'KEEP_HAND', bottomCardIds: [] }, 2300, () => 0);
    expect(game.log.at(-1)?.event).toMatchObject({ key: 'gameLog.keep', params: { actor: player.name } });
    expect(game.seats[0].keptHand).toBe(true);
    expect(game.seats[0].hand).toHaveLength(5);
    expect(game.seats[0].library).toHaveLength(94);
  });

  it('taps and untaps a basic land without tracking mana', () => {
    let game = keepAllHands(newFourPlayerGame());
    const playerId = game.activeSeatId;
    const seat = game.seats.find(item => item.id === playerId)!;
    const basicId = seat.library.find(id => game.cards[id].card?.type_line.includes('Basic Land'))!;
    seat.library = seat.library.filter(id => id !== basicId); seat.hand.push(basicId); game.cards[basicId].zone = 'hand';
    game = applyAction(game, playerId, { type: 'PLAY_LAND', cardId: basicId, x: 20, y: 25 }, 3000);
    game = applyAction(game, playerId, { type: 'TAP', cardId: basicId }, 3100);
    expect(game.cards[basicId].tapped).toBe(true);
    expect(game.seats.find(item => item.id === playerId)).not.toHaveProperty('mana');
    game = applyAction(game, playerId, { type: 'TAP', cardId: basicId }, 3200);
    expect(game.cards[basicId].tapped).toBe(false);
    expect(game.seats.find(item => item.id === playerId)).not.toHaveProperty('mana');
  });

  it('advances phases and turns without a mana pool', () => {
    let game = keepAllHands(newFourPlayerGame());
    const playerId = game.activeSeatId;
    game = applyAction(game, playerId, { type: 'PHASE', step: 'Compra' }, 3400);
    expect(game.step).toBe('Compra');
    game = applyAction(game, playerId, { type: 'ADVANCE_TURN' }, 3600);
    expect(game.activeSeatId).not.toBe(playerId);
    expect(game.step).toBe('Desvirar');
    expect(game.seats.every(seat => !('mana' in seat))).toBe(true);
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

  it.each(['{2}{G}', '{C}', '{X}{G}', '{W/U}', '{B/P}'])('casts a spell with cost %s without validating payment', cost => {
    const game = keepAllHands(newFourPlayerGame());
    const player = game.seats[0];
    const spellId = player.hand.find(id => !game.cards[id].card?.type_line.includes('Land'))!;
    game.cards[spellId].card!.mana_cost = cost;
    const next = applyAction(game, player.id, { type: 'CAST', cardId: spellId });
    expect(next.cards[spellId].zone).toBe('stack');
    expect(next.seats[0].hand).not.toContain(spellId);
    expect(next.stack.at(-1)).toMatchObject({ sourceId: spellId, controllerId: player.id });
    expect(() => applyAction(game, game.seats[1].id, { type: 'CAST', cardId: spellId })).toThrow(/sua mão/);
  });

  it('keeps commander cast counts without requiring payment for repeated casts', () => {
    let game = keepAllHands(newFourPlayerGame());
    const player = game.seats[0];
    const commander = Object.values(game.cards).find(card => card.ownerId === player.id && card.zone === 'command')!;
    for (let count = 1; count <= 3; count++) {
      game = applyAction(game, player.id, { type: 'CAST', cardId: commander.id });
      expect(game.seats[0].commanderCasts[commander.cardId]).toBe(count);
      expect(game.cards[commander.id].zone).toBe('stack');
      game = applyAction(game, player.id, { type: 'MOVE_CARD', cardId: commander.id, zone: 'command' });
    }
  });

  it('counts a commander moved directly from the command zone to the battlefield', () => {
    let game = keepAllHands(newFourPlayerGame());
    const player = game.seats[0];
    const commander = Object.values(game.cards).find(card => card.ownerId === player.id && card.zone === 'command')!;
    for (let count = 1; count <= 2; count++) {
      game = applyAction(game, player.id, { type: 'MOVE_CARD', cardId: commander.id, zone: 'battlefield' });
      game = applyAction(game, player.id, { type: 'MOVE_CARD', cardId: commander.id, zone: 'command' });
      expect(game.seats[0].commanderCasts[commander.cardId]).toBe(count);
    }
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

  it('resolves the top item automatically when the last active seat passes', () => {
    let game = keepAllHands(newFourPlayerGame());
    const playerId = game.activeSeatId;
    const seat = game.seats.find(item => item.id === playerId)!;
    const spellId = seat.hand.find(id => !game.cards[id].card?.type_line.includes('Land'))!;
    game.cards[spellId].card!.type_line = 'Instant';
    game = applyAction(game, playerId, { type: 'CAST', cardId: spellId }, 5000);
    expect(() => applyAction(game, playerId, { type: 'RESOLVE_TOP' }, 5001)).toThrow(/passar/);
    for (const activeSeat of game.seats.slice(0, -1)) game = applyAction(game, activeSeat.id, { type: 'PASS_PRIORITY' }, 5100);
    expect(game.stack).toHaveLength(1);
    game = applyAction(game, game.seats.at(-1)!.id, { type: 'PASS_PRIORITY' }, 5200);
    expect(game.stack).toHaveLength(0);
    expect(game.cards[spellId].zone).toBe('graveyard');
  });

  it('adjusts received commander counters independently without changing life or eliminating players', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actor = game.seats[0];
    const commanders = game.seats.slice(1).map(seat => commandersForSeat(game, seat.id)[0]);
    const life = game.seats.map(seat => seat.life);
    const adjust = (commanderCardId: string, amount: -1 | 1) => {
      game = applyAction(game, actor.id, { type: 'ADJUST_COMMANDER_DAMAGE', commanderCardId, amount });
    };
    for (let index = 0; index < 21; index++) adjust(commanders[0].id, 1);
    adjust(commanders[1].id, 1);
    expect(game.seats[0].commanderDamage).toEqual({ [commanders[0].cardId]: 21, [commanders[1].cardId]: 1 });
    expect(game.seats[0].status).toBe('playing');
    adjust(commanders[1].id, -1);
    expect(game.seats[0].commanderDamage[commanders[1].cardId]).toBe(0);
    expect(() => adjust(commanders[1].id, -1)).toThrow(/negativo/);
    expect(game.seats.map(seat => seat.life)).toEqual(life);
    expect(game.seats.slice(1).every(seat => Object.keys(seat.commanderDamage).length === 0)).toBe(true);
    expect(game.log.at(-1)?.message).toContain('em -1 (total: 0)');
  });

  it('rejects invalid commander counter adjustments', () => {
    const game = keepAllHands(newFourPlayerGame());
    const actor = game.seats[0];
    const own = commandersForSeat(game, actor.id)[0];
    const opponent = commandersForSeat(game, game.seats[1].id)[0];
    const common = Object.values(game.cards).find(card => card.ownerId !== actor.id && card.zone === 'library')!;
    for (const commanderCardId of [own.id, common.id, 'missing']) {
      expect(() => applyAction(game, actor.id, { type: 'ADJUST_COMMANDER_DAMAGE', commanderCardId, amount: 1 })).toThrow(/comandante adversário/);
    }
    for (const amount of [0, 2, -2, .5, NaN, Infinity]) {
      expect(() => applyAction(game, actor.id, { type: 'ADJUST_COMMANDER_DAMAGE', commanderCardId: opponent.id, amount: amount as 1 })).toThrow(/ajuste/);
    }
  });

  it('retains public commander identities and counters through hidden zones and eliminated owners', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actor = game.seats[0];
    const owner = game.seats[1];
    const commander = commandersForSeat(game, owner.id)[0];
    game.cards[commander.id].zone = 'hand';
    game.cards[commander.id].controllerId = actor.id;
    owner.status = 'eliminated';
    const projected = publicProjection(game);
    expect(projected.cards[commander.id]).toBeUndefined();
    game = { ...projected, seats: projected.seats.map(seat => ({ ...seat, hand: [], library: [] })) };
    expect(commandersForSeat(game, owner.id)).toEqual([commander]);
    game = applyAction(game, actor.id, { type: 'ADJUST_COMMANDER_DAMAGE', commanderCardId: commander.id, amount: 1 });
    expect(game.seats[0].commanderDamage[commander.cardId]).toBe(1);
    expect(publicProjection(game).seats[1].commanderRoster).toEqual([commander]);
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

  it('allows manual life changes only for the acting player while commander damage still lowers opponent life', () => {
    const game = keepAllHands(newFourPlayerGame());
    const actor = game.seats[0]; const opponent = game.seats[1];
    const changed = applyAction(game, actor.id, { type: 'SET_LIFE', amount: -2 }, 6200);
    expect(changed.seats.find(item => item.id === actor.id)?.life).toBe(actor.life - 2);
    expect(() => applyAction(game, actor.id, { type: 'SET_LIFE', amount: -2, seatId: opponent.id }, 6201)).toThrow(/própria vida/i);
  });

  const creatureToken = (name = 'Wolf'): CardDefinition => ({
    id: `scryfall-${name.toLowerCase()}`, oracle_id: `oracle-${name.toLowerCase()}`, name, layout: 'token', color_identity: ['G'], keywords: [],
    mana_cost: '', type_line: 'Token Creature — Wolf', oracle_text: '', power: '2', toughness: '2', image_uris: { small: 'https://cards.scryfall.io/small/front/example.jpg' }, legalities: {},
  });

  it('organizes lands in a column and separates support cards from creatures', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actor = game.activeSeatId;
    const lands = Object.values(game.cards).filter(item => item.ownerId === actor && item.zone === 'library' && item.card?.type_line.includes('Land')).slice(0, 2);
    const support = Object.values(game.cards).find(item => item.ownerId === actor && item.zone === 'library' && !lands.includes(item))!;
    support.card = card('artifact', 'Artifact', 'Artifact');
    for (const item of [...lands, support]) game = applyAction(game, actor, { type: 'MOVE_CARD', cardId: item.id, zone: 'battlefield' });
    game = applyAction(game, actor, { type: 'CREATE_TOKEN', card: creatureToken() });
    const [first, second] = lands.map(item => game.cards[item.id]);
    const artifact = game.cards[support.id];
    const token = Object.values(game.cards).find(item => item.isToken)!;
    expect(first.x).toBe(second.x);
    expect(Math.abs(second.y - first.y)).toBeGreaterThanOrEqual(6);
    expect(token.y).toBeLessThan(artifact.y);
    expect(artifact.x).toBeLessThan(first.x);
  });

  it('positions resolved spells against the current field and respects explicit cast coordinates', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actor = game.activeSeatId;
    const ids = game.seats.find(seat => seat.id === actor)!.hand.filter(id => game.cards[id].card?.type_line.includes('Creature')).slice(0, 2);
    expect(ids).toHaveLength(2);
    game = applyAction(game, actor, { type: 'CAST', cardId: ids[0] });
    game = applyAction(game, actor, { type: 'CAST', cardId: ids[1], x: 70, y: 50 });
    for (const seat of game.seats) game = applyAction(game, seat.id, { type: 'PASS_PRIORITY' });
    expect(game.cards[ids[1]]).toMatchObject({ zone: 'battlefield', x: 70, y: 50 });
    for (const seat of game.seats) game = applyAction(game, seat.id, { type: 'PASS_PRIORITY' });
    expect(game.cards[ids[0]].zone).toBe('battlefield');
    expect([game.cards[ids[0]].x, game.cards[ids[0]].y]).not.toEqual([70, 50]);
  });

  it('places multiple library-search results in distinct slots', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actor = game.activeSeatId;
    const ids = game.seats.find(seat => seat.id === actor)!.library.filter(id => game.cards[id].card?.type_line.includes('Creature')).slice(0, 2);
    game = applyAction(game, actor, { type: 'SEARCH_LIBRARY', cardIds: ids, destination: 'battlefield' });
    expect(ids.map(id => game.cards[id].zone)).toEqual(['battlefield', 'battlefield']);
    expect([game.cards[ids[0]].x, game.cards[ids[0]].y]).not.toEqual([game.cards[ids[1]].x, game.cards[ids[1]].y]);
  });

  it('creates a selected creature token with its full card data', () => {
    const start = keepAllHands(newFourPlayerGame());
    const card = creatureToken();
    const next = applyAction(start, start.activeSeatId, { type: 'CREATE_TOKEN', card, x: 41, y: 52 }, 6300);
    const token = Object.values(next.cards).find(item => item.isToken)!;
    expect(token).toMatchObject({ zone: 'battlefield', isToken: true, x: 41, y: 52, card });
    expect(next.log.at(-1)?.event).toMatchObject({ key: 'gameLog.token', params: { card: 'Wolf' } });
  });

  it.each(['hand', 'graveyard', 'exile'] as const)('deletes a token moved to %s and preserves its name in the action log', zone => {
    const start = keepAllHands(newFourPlayerGame());
    const ownerId = start.activeSeatId;
    const created = applyAction(start, ownerId, { type: 'CREATE_TOKEN', card: creatureToken('Spirit') }, 6400);
    const token = Object.values(created.cards).find(item => item.isToken)!;
    const moved = applyAction(created, ownerId, { type: 'MOVE_CARD', cardId: token.id, zone }, 6401);
    expect(moved.cards[token.id]).toBeUndefined();
    expect(moved.seats.find(seat => seat.id === ownerId)?.hand).not.toContain(token.id);
    expect(Object.values(moved.cards).some(card => card.id === token.id && card.zone === zone)).toBe(false);
    expect(moved.log.at(-1)?.event).toMatchObject({ key: 'gameLog.move', params: { card: 'Spirit', zone: `table.zones.${zone}` } });
  });

  it('keeps ordinary cards when they move to exile', () => {
    const start = keepAllHands(newFourPlayerGame());
    const ownerId = start.activeSeatId;
    const cardId = Object.values(start.cards).find(item => item.ownerId === ownerId && item.zone === 'library')!.id;
    const battlefield = applyAction(start, ownerId, { type: 'MOVE_CARD', cardId, zone: 'battlefield' }, 6500);
    const exiled = applyAction(battlefield, ownerId, { type: 'MOVE_CARD', cardId, zone: 'exile' }, 6501);
    expect(exiled.cards[cardId].zone).toBe('exile');
    expect(exiled.cards[cardId].isToken).toBeUndefined();
  });

  it('retains the table and supports a public stress field of 200 permanents', () => {
    let game = keepAllHands(newFourPlayerGame());
    const actorId = game.activeSeatId;
    for (let index = 0; index < 200; index++) game = applyAction(game, actorId, { type: 'CREATE_TOKEN', card: { ...creatureToken(), id: `scryfall-${index}`, oracle_id: `oracle-${index}`, name: `Token ${index}` }, x: index % 90, y: index % 80 }, 7000 + index);
    expect(Object.values(publicProjection(game).cards).filter(item => item.zone === 'battlefield')).toHaveLength(200);
  });
});
