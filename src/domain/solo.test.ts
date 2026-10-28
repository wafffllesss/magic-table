import { describe, expect, it } from 'vitest';
import { applyAction, newMatch } from './game';
import { soloTurnKey, soloTurnSeat } from './solo';
import { fixtureDecks } from '../../tests/fixtures/scryfall';

describe('solo turn guidance', () => {
  it.each([2, 3, 4])('starts a real game with %i seats and guides each mulligan', count => {
    const ids = ['northWest', 'northEast', 'southEast', 'southWest'];
    const deck = fixtureDecks()[0];
    let state = newMatch(ids.slice(0, count).map(seatId => ({ seatId, name: deck.name, deck })), 100, () => 0);
    expect(state.phase).toBe('mulligan');
    expect(state.seats).toHaveLength(count);
    expect(state.seats.every(seat => seat.hand.length === 7)).toBe(true);
    expect(state.stack).toHaveLength(0);
    for (let i = 0; i < count; i++) {
      const seat = soloTurnSeat(state)!;
      const previous = soloTurnKey(state);
      state = applyAction(state, seat, { type: 'KEEP_HAND' });
      expect(soloTurnKey(state)).not.toBe(previous);
    }
    expect(state.phase).toBe('playing');
    expect(soloTurnSeat(state)).toBe(state.activeSeatId);
  });

  it('tracks priority changes without reacting to unrelated state changes', () => {
    const deck = fixtureDecks()[0];
    let state = newMatch(['northWest', 'southWest'].map(seatId => ({ seatId, name: deck.name, deck })), 100, () => 0);
    for (const seat of state.seats) state = applyAction(state, seat.id, { type: 'KEEP_HAND' });
    const initial = soloTurnKey(state);
    state = applyAction(state, state.activeSeatId, { type: 'DRAW' });
    expect(soloTurnKey(state)).toBe(initial);
    state.stack.push({ id: 'test', sourceId: '', controllerId: state.activeSeatId, name: 'Test', kind: 'ability' });
    const active = soloTurnSeat(state)!;
    state = applyAction(state, active, { type: 'PASS_PRIORITY' });
    expect(soloTurnSeat(state)).not.toBe(active);
  });
});
