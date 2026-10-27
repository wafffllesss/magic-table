import { describe, expect, it } from 'vitest';
import { applyAction, publicProjection } from './game';
import { cardMenuOptions, indicatedSeat } from './tableInteraction';
import { startDemoMatch } from '../services/demo';
import { fixtureDecks } from '../../tests/fixtures/scryfall';

describe('table interaction permissions and indication', () => {
  it('offers one cast action without a manual payment alternative', () => {
    const state = startDemoMatch('Lia', fixtureDecks());
    const commander = Object.values(state.cards).find(card => card.zone === 'command' && card.ownerId === 'southWest')!;
    const casts = cardMenuOptions(state, commander.id, 'southWest').filter(option => option.action?.type === 'CAST');
    expect(casts).toEqual([{ id: 'cast', label: 'Conjurar', action: { type: 'CAST', cardId: commander.id }, disabled: false }]);
  });

  it('indicates the next active seat without enforcing a new priority order', () => {
    const state = startDemoMatch('Lia', fixtureDecks());
    state.stack = [{ id: 'sample', sourceId: Object.keys(state.cards)[0], controllerId: 'southWest', name: 'Magia', kind: 'spell' }];
    expect(indicatedSeat(state)).toBe('southWest');
    state.passes = ['southWest'];
    expect(indicatedSeat(state)).toBe('northWest');
    state.seats[0].status = 'eliminated';
    expect(indicatedSeat(state)).toBe('northEast');
    state.passes = state.seats.map(seat => seat.id);
    expect(indicatedSeat(state)).toBe('southWest');
    state.stack = [];
    expect(indicatedSeat(state)).toBe('southWest');
  });

  it('skips suspended participants when indicating priority', () => {
    const state = startDemoMatch('Lia', fixtureDecks());
    state.stack = [{ id: 'sample', sourceId: Object.keys(state.cards)[0], controllerId: 'southWest', name: 'Magia', kind: 'spell' }];
    state.passes = ['southWest'];
    state.suspendedSeatIds = ['northWest'];
    expect(indicatedSeat(state)).toBe('northEast');
  });

  it('never offers mutation or hidden-card inspection to opponents or spectators', () => {
    const state = startDemoMatch('Lia', fixtureDecks());
    const own = Object.values(state.cards).find(card => card.zone === 'battlefield' && card.controllerId === 'southWest')!;
    expect(cardMenuOptions(state, own.id, 'northWest').every(option => !option.action)).toBe(true);
    expect(cardMenuOptions(state, own.id, 'southWest', true).every(option => !option.action)).toBe(true);
    const hidden = state.seats.find(seat => seat.id === 'southWest')!.hand[0];
    expect(cardMenuOptions(state, hidden, 'northWest')).toEqual([]);
    own.faceDown = true;
    expect(cardMenuOptions(state, own.id, 'northWest')).toEqual([]);
  });

  it('updates actions after a zone change and disables them while paused', () => {
    const state = startDemoMatch('Lia', fixtureDecks());
    const own = Object.values(state.cards).find(card => card.zone === 'battlefield' && card.controllerId === 'southWest')!;
    expect(cardMenuOptions(state, own.id, 'southWest').some(option => option.id === 'tap')).toBe(true);
    const next = applyAction(state, 'southWest', { type: 'MOVE_CARD', cardId: own.id, zone: 'graveyard' });
    expect(cardMenuOptions(next, own.id, 'southWest').map(option => option.id)).toEqual(['inspect', 'hand']);
    next.paused = true;
    expect(cardMenuOptions(next, own.id, 'southWest').find(option => option.id === 'hand')?.disabled).toBe(true);
  });

  it('publishes tap and face changes for other participants while preserving independent states', () => {
    const state = startDemoMatch('Lia', fixtureDecks());
    const own = Object.values(state.cards).find(card => card.zone === 'battlefield' && card.controllerId === 'southWest')!;
    own.tapped = false; own.face = 0;
    own.card!.card_faces = ['Frente', 'Verso'].map(name => ({ name, mana_cost: '', type_line: 'Creature', oracle_text: '' }));
    const tapped = applyAction(state, 'southWest', { type: 'TAP', cardId: own.id });
    const flipped = applyAction(tapped, 'southWest', { type: 'FLIP_FACE', cardId: own.id });
    expect(publicProjection(flipped).cards[own.id]).toMatchObject({ tapped: true, face: 1 });
    expect(() => applyAction(flipped, 'northWest', { type: 'FLIP_FACE', cardId: own.id })).toThrow();
    const upright = applyAction(flipped, 'southWest', { type: 'TAP', cardId: own.id });
    expect(publicProjection(upright).cards[own.id]).toMatchObject({ tapped: false, face: 1 });
  });
});
