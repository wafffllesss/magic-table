import { describe, expect, it } from 'vitest';
import type { DeckDefinition } from './game';
import { matchesCommanderColors } from './deckFilter';

function deck(identities: string[][]): DeckDefinition {
  const entries = identities.map((color_identity, index) => ({
    cardId: `commander-${index}`, name: `Commander ${index}`, quantity: 1, role: 'commander' as const,
    card: { id: `commander-${index}`, oracle_id: `commander-${index}`, name: `Commander ${index}`, layout: 'normal', color_identity, keywords: [], mana_cost: '', type_line: 'Legendary Creature', oracle_text: '', legalities: { commander: 'legal' } },
  }));
  return { id: 'test', name: 'Test', format: 'commander', commanders: entries.map(entry => entry.cardId), entries, updatedAt: 0 };
}

describe('Commander color filter', () => {
  it('shows every deck when no colors are selected and requires every selected color', () => {
    const mono = deck([['W']]); const multi = deck([['U'], ['B']]);
    expect(matchesCommanderColors(mono, [])).toBe(true);
    expect(matchesCommanderColors(multi, ['U', 'B'])).toBe(true);
    expect(matchesCommanderColors(multi, ['U', 'R'])).toBe(false);
  });

  it('unions the identity of multiple commanders', () => {
    expect(matchesCommanderColors(deck([['W', 'U'], ['B']]), ['W', 'B'])).toBe(true);
    expect(matchesCommanderColors(deck([['W'], []]), ['U'])).toBe(false);
  });
});
