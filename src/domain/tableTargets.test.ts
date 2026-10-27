import { describe, expect, it } from 'vitest';
import { startDemoMatch } from '../services/demo';
import { fixtureDecks } from '../../tests/fixtures/scryfall';
import { targetReferenceValid, validTargetIntent } from './tableTargets';

describe('table targets', () => {
  it('accepts public cards, including face-down cards, but rejects private and missing references', () => {
    const state = startDemoMatch('Lia', fixtureDecks());
    const cards = Object.values(state.cards);
    const card = cards.find(item => item.zone === 'command')!;
    const hand = cards.find(item => item.zone === 'hand')!;
    expect(targetReferenceValid({ kind: 'card', cardId: card.id }, state)).toBe(true);
    card.faceDown = true;
    expect(targetReferenceValid({ kind: 'card', cardId: card.id }, state)).toBe(true);
    expect(targetReferenceValid({ kind: 'card', cardId: hand.id }, state)).toBe(false);
    expect(targetReferenceValid({ kind: 'card', cardId: 'missing' }, state)).toBe(false);
  });
  it('rejects the wrong match, self arrows, private origins and non-card origins', () => {
    const state = startDemoMatch('Lia', fixtureDecks());
    const card = Object.values(state.cards).find(item => item.zone === 'command')!;
    const hand = Object.values(state.cards).find(item => item.zone === 'hand')!;
    const base = { id: crypto.randomUUID(), matchId: state.id, kind: 'arrow', origin: { kind: 'card', cardId: card.id }, target: { kind: 'player', seatId: state.seats[0].id } };
    expect(validTargetIntent(base, state)).toBe(true);
    expect(validTargetIntent({ ...base, matchId: 'old' }, state)).toBe(false);
    expect(validTargetIntent({ ...base, target: base.origin }, state)).toBe(false);
    expect(validTargetIntent({ ...base, origin: { kind: 'card', cardId: hand.id } }, state)).toBe(false);
    expect(validTargetIntent({ ...base, origin: base.target }, state)).toBe(false);
  });
});
