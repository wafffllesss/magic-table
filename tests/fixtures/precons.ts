import type { CardDefinition, DeckDefinition } from '../../src/domain/game';
import { PRECONS } from '../../src/services/precons';
import snapshot from './precon-cards.json' with { type: 'json' };
import { normaliseCardName } from '../../src/domain/cardNames';

// Real card metadata from the same published products, with test-only image URLs.
export const preconCards = snapshot as CardDefinition[];
export function findPreconCard(identifier: { id?: string; name?: string }): CardDefinition | undefined {
  return preconCards.find(card => identifier.id ? card.id === identifier.id : normaliseCardName(card.name) === normaliseCardName(identifier.name ?? ''));
}
export function preconFixtureDecks(): DeckDefinition[] {
  return structuredClone(PRECONS.map(manifest => {
    const entries = manifest.entries.map(entry => {
      const card = findPreconCard({ name: entry.name })!;
      return { ...entry, card, cardId: card.id };
    });
    return { id: manifest.id, name: manifest.name, format: 'commander', updatedAt: 0, entries,
      commanders: entries.filter(entry => entry.role === 'commander').map(entry => entry.cardId),
      source: manifest.sourceUrl,
      precon: { setCode: manifest.setCode, edition: manifest.edition, sourceUrl: manifest.sourceUrl, version: manifest.version } };
  }));
}
