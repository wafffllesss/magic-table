import { describe, expect, it } from 'vitest';
import { applyAction, newMatch, type MatchState } from './game';
import { MatchHistory, canRestoreHistory, restoreHistorySnapshot } from './history';

function game(): MatchState {
  return newMatch(['northWest', 'northEast', 'southEast', 'southWest'].map(id => ({
    seatId: id, name: id, deck: { id, name: id, format: 'commander' as const, commanders: [`${id}-commander`], updatedAt: 1,
      entries: [
        { cardId: `${id}-commander`, name: 'Commander', quantity: 1, role: 'commander' as const },
        { cardId: `${id}-library`, name: 'Library card', quantity: 99, role: 'library' as const },
      ] },
  })), 17, () => 0);
}

describe('match history snapshots', () => {
  it('restores a deleted token with its card data when undoing, then removes it again on redo', () => {
    const history = new MatchHistory();
    let state = game();
    for (const seat of state.seats) state = applyAction(state, seat.id, { type: 'KEEP_HAND' });
    const actor = state.activeSeatId;
    const card = { id: 'scryfall-token', oracle_id: 'oracle-token', name: 'Wolf', layout: 'token', color_identity: ['G'], keywords: [], mana_cost: '', type_line: 'Token Creature — Wolf', oracle_text: '', power: '2', toughness: '2', legalities: {} };
    const created = applyAction(state, actor, { type: 'CREATE_TOKEN', card });
    const tokenId = Object.values(created.cards).find(item => item.isToken)!.id;
    const deleted = applyAction(created, actor, { type: 'MOVE_CARD', cardId: tokenId, zone: 'graveyard' });
    history.record(created, deleted);

    const restored = restoreHistorySnapshot(history.target(false, deleted.revision)!, deleted, actor, 'UNDO', 'undo-token');
    history.restored(false, restored.revision);
    expect(restored.cards[tokenId]).toMatchObject({ isToken: true, zone: 'battlefield', card: { name: 'Wolf' } });

    const redone = restoreHistorySnapshot(history.target(true, restored.revision)!, restored, actor, 'REDO', 'redo-token');
    history.restored(true, redone.revision);
    expect(redone.cards[tokenId]).toBeUndefined();
  });

  it('only allows restoring the current revision when the latest action was local', () => {
    const start = game();
    const current = applyAction(start, 'northWest', { type: 'SET_LIFE', amount: -1 }, 100);
    expect(canRestoreHistory(current, current.revision, 'northWest')).toBe(true);
    expect(canRestoreHistory(current, current.revision - 1, 'northWest')).toBe(false);
    expect(canRestoreHistory(current, current.revision, 'northEast')).toBe(false);
  });

  it('restores exact private data while advancing the shared revision for undo and redo', () => {
    let before = game();
    for (const seat of before.seats) before = applyAction(before, seat.id, { type: 'KEEP_HAND' }, before.updatedAt + 1);
    const owner = before.seats[0]!;
    const cardId = owner.library[0]!;
    const drawn = applyAction(before, owner.id, { type: 'DRAW' }, 100, () => 0);
    expect(drawn.seats[0]?.hand).toContain(cardId);

    const undone = restoreHistorySnapshot(before, drawn, owner.id, 'UNDO', 'undo-id', 200);
    expect(undone.seats[0]?.hand).toEqual(before.seats[0]?.hand);
    expect(undone.seats[0]?.library).toEqual(before.seats[0]?.library);
    expect(undone.cards[cardId]?.zone).toBe('library');
    expect(undone.revision).toBe(drawn.revision + 1);
    expect(undone.lastActionId).toBe('undo-id');
    expect(undone.log.at(-1)?.event).toMatchObject({ key: 'gameLog.undo', source: { key: 'gameLog.draw' } });

    const redone = restoreHistorySnapshot(drawn, undone, owner.id, 'REDO', 'redo-id', 300);
    expect(redone.seats[0]?.hand).toEqual(drawn.seats[0]?.hand);
    expect(redone.seats[0]?.library).toEqual(drawn.seats[0]?.library);
    expect(redone.cards[cardId]?.zone).toBe('hand');
    expect(redone.revision).toBe(undone.revision + 1);
    expect(redone.log.at(-1)?.event).toMatchObject({ key: 'gameLog.redo', source: { key: 'gameLog.draw' } });
  });
});

describe('bounded match history', () => {
  it('restores the exact shuffled library and draw when undoing and redoing', () => {
    const history = new MatchHistory();
    let state = game();
    for (const seat of state.seats) state = applyAction(state, seat.id, { type: 'KEEP_HAND' });
    const original = state;
    const shuffled = applyAction(state, 'northWest', { type: 'SHUFFLE' }, 100, () => .73);
    history.record(state, shuffled);
    const drawn = applyAction(shuffled, 'northWest', { type: 'DRAW' }, 101);
    history.record(shuffled, drawn);
    state = drawn;
    for (const target of [shuffled, original]) {
      const snapshot = history.target(false, state.revision)!;
      expect(snapshot.seats[0].library).toEqual(target.seats[0].library);
      expect(snapshot.seats[0].hand).toEqual(target.seats[0].hand);
      state = restoreHistorySnapshot(snapshot, state, 'northWest', 'UNDO', 'undo');
      history.restored(false, state.revision);
    }
    for (const target of [shuffled, drawn]) {
      const snapshot = history.target(true, state.revision)!;
      expect(snapshot.seats[0].library).toEqual(target.seats[0].library);
      expect(snapshot.seats[0].hand).toEqual(target.seats[0].hand);
      state = restoreHistorySnapshot(snapshot, state, 'northWest', 'REDO', 'redo');
      history.restored(true, state.revision);
    }
  });

  it('shares the ten-entry budget between undo and redo and discards an abandoned branch', () => {
    const history = new MatchHistory();
    let state = game();
    for (let i = 0; i < 15; i++) {
      const next = applyAction(state, 'northWest', { type: 'SET_LIFE', amount: -1 });
      history.record(state, next); state = next;
    }
    expect(history.size).toBe(10);
    for (let i = 0; i < 10; i++) {
      state = restoreHistorySnapshot(history.target(false, state.revision)!, state, 'northWest', 'UNDO', 'undo-' + i);
      history.restored(false, state.revision);
    }
    expect(state.seats[0].life).toBe(35);
    expect(history.target(false, state.revision)).toBeUndefined();
    expect(history.size).toBe(10);
    state = restoreHistorySnapshot(history.target(true, state.revision)!, state, 'northWest', 'REDO', 'redo');
    history.restored(true, state.revision);
    const next = applyAction(state, 'northWest', { type: 'SET_LIFE', amount: 1 });
    history.record(state, next);
    expect(history.target(true, next.revision)).toBeUndefined();
    expect(history.size).toBe(2);
    expect(history.target(false, next.revision + 1)).toBeUndefined();
    expect(history.size).toBe(0);
  });

  it('preserves private order and definitions independently of live and restored objects', () => {
    const history = new MatchHistory();
    let before = game();
    for (const seat of before.seats) before = applyAction(before, seat.id, { type: 'KEEP_HAND' });
    const id = before.seats[0].library[0];
    before.cards[id].card = { id: 'definition', oracle_id: 'definition', name: 'Original', layout: 'normal',
      color_identity: [], keywords: [], mana_cost: '', type_line: 'Creature', oracle_text: '', legalities: {} };
    const after = applyAction(before, 'northWest', { type: 'DRAW' });
    history.record(before, after);
    before.cards[id].card!.name = 'Changed outside history';
    const target = history.target(false, after.revision)!;
    expect(target.seats[0].library).toEqual(before.seats[0].library);
    expect(target.seats[0].hand).toEqual(before.seats[0].hand);
    expect(target.cards[id].card!.name).toBe('Original');
    target.cards[id].card!.name = 'Changed after restoration';
    expect(history.target(false, after.revision)!.cards[id].card!.name).toBe('Original');
    expect(history.definitionCount).toBe(1);
  });

  it('releases definitions from discarded snapshots through 1000 actions', () => {
    const history = new MatchHistory();
    let state = game();
    const id = Object.keys(state.cards)[0];
    for (let i = 0; i < 1000; i++) {
      const next = applyAction(state, 'northWest', { type: 'SET_LIFE', amount: i % 2 ? 1 : -1 });
      next.cards[id].card = { id: 'same-printing', oracle_id: 'same-printing', name: 'Version ' + i, layout: 'normal',
        color_identity: [], keywords: [], mana_cost: '', type_line: 'Creature', oracle_text: '', legalities: {} };
      history.record(state, next); state = next;
    }
    expect(history.size).toBe(10);
    expect(history.definitionCount).toBe(11);
    history.clear();
    expect(history.definitionCount).toBe(0);
  }, 30_000);
});
