import { describe, expect, it } from 'vitest';
import { totalCards } from '../domain/game';
import { makeDemoDeckSet } from './demo';

describe('local Commander demo', () => {
  it('provides four exactly 100-card lists, including a Partner pair and a Background', () => {
    const decks = makeDemoDeckSet();
    expect(decks).toHaveLength(4);
    expect(decks.map(totalCards)).toEqual([100, 100, 100, 100]);
    expect(decks.map(deck => deck.commanders.length)).toEqual([1, 1, 2, 2]);
    expect(decks[2].entries.some(entry => entry.card?.keywords.includes('Partner'))).toBe(true);
    expect(decks[3].entries.some(entry => entry.card?.type_line.includes('Background'))).toBe(true);
  });
});
