import { describe, expect, it } from 'vitest';
import { totalCards } from '../domain/game';
import { startDemoMatch } from './demo';
import { fixtureDecks } from '../../tests/fixtures/scryfall';
import { validateDeck } from '../domain/deck';
import { preconFixtureDecks } from '../../tests/fixtures/precons';
import { DEFAULT_PRECON_ID, DEMO_OPPONENT_IDS } from './precons';

describe('local Commander demo', () => {
  it('uses four distinct seats from the precon catalogue and avoids repeating a selected opponent deck', () => {
    const decks = preconFixtureDecks();
    const state = startDemoMatch('Lia', decks);
    expect(state.seats).toHaveLength(4);
    expect(state.seats[3].commanderIds).toEqual(decks.find(deck => deck.id === DEFAULT_PRECON_ID)!.commanders);
    expect(state.seats.slice(0, 3).map(seat => seat.commanderIds)).toEqual(DEMO_OPPONENT_IDS.slice(0, 3).map(id => decks.find(deck => deck.id === id)!.commanders));
    const chosen = decks.find(deck => deck.id === DEMO_OPPONENT_IDS[0])!;
    const selected = startDemoMatch('Lia', decks, chosen);
    expect(selected.seats[3].commanderIds).toEqual(chosen.commanders);
    expect(new Set(selected.seats.flatMap(seat => seat.commanderIds)).size).toBe(4);
    expect(selected.seats[2].commanderIds).toEqual(decks.find(deck => deck.id === DEMO_OPPONENT_IDS[3])!.commanders);
  });
  it('provides four exactly 100-card lists, including a Partner pair and a Background', () => {
    const decks = fixtureDecks();
    expect(decks).toHaveLength(4);
    expect(decks.map(totalCards)).toEqual([100, 100, 100, 100]);
    expect(decks.map(deck => deck.commanders.length)).toEqual([1, 1, 2, 2]);
    expect(decks[2].entries.some(entry => entry.card?.keywords.includes('Partner with'))).toBe(true);
    expect(decks[3].entries.some(entry => entry.card?.type_line.includes('Background'))).toBe(true);
    for (const deck of decks) expect(validateDeck(deck, new Map(deck.entries.map(entry => [entry.cardId, entry.card!])))).toEqual([]);
    const state = startDemoMatch('Lia', decks);
    expect(state.seats).toHaveLength(4);
    expect(state.seats.every(seat => seat.hand.length === 7)).toBe(true);
    expect(Object.values(state.cards).every(card => card.card?.image_uris?.normal)).toBe(true);
  });

  it('requires the four loaded decks and honors the chosen deck', () => {
    expect(() => startDemoMatch('Lia', [])).toThrow('quatro decks');
    const decks = fixtureDecks();
    const state = startDemoMatch('Lia', decks, decks[1]);
    expect(state.seats.find(seat => seat.id === 'southWest')?.commanderIds).toEqual(decks[1].commanders);
  });
});
