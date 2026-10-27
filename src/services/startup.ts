import type { CardDefinition } from '../domain/game';
import { getLibraryDecks, getStarterDecks } from './starters';
import { scryfall } from './scryfall';
import { localRepository } from './storage';
import { cardImageSource } from './imagePolicy';

export async function prepareStartupCards(signal: AbortSignal, progress: (phase: 'cards' | 'images', loaded: number, total: number) => void): Promise<boolean> {
  let incomplete = false;
  try {
    const result = await getStarterDecks(signal, (loaded, total) => progress('cards', loaded, total));
    incomplete = Boolean(result.warning);
  } catch { incomplete = true; }
  if (signal.aborted) return true;
  const decks = await getLibraryDecks();
  const missing = [...new Set(decks.flatMap(deck => deck.entries.filter(entry => !entry.card).map(entry => entry.cardId)))];
  let resolved: CardDefinition[] = [];
  if (missing.length) {
    try { resolved = await scryfall.getByIds(missing, signal); if (resolved.length !== missing.length) incomplete = true; }
    catch { incomplete = true; }
  }
  if (signal.aborted) return true;
  const byId = new Map(resolved.map(card => [card.id, card]));
  for (const deck of decks) {
    if (!deck.entries.some(entry => !entry.card && byId.has(entry.cardId))) continue;
    deck.entries = deck.entries.map(entry => entry.card ? entry : { ...entry, card: byId.get(entry.cardId) });
    await localRepository.saveDeck(deck);
  }
  const cards = [...new Map(decks.flatMap(deck => deck.entries.flatMap(entry => entry.card ? [[entry.card.id, entry.card] as const] : []))).values()];
  let completed = 0;
  progress('images', 0, cards.length);
  let index = 0;
  const worker = async () => {
    while (!signal.aborted && index < cards.length) {
      const card = cards[index++]!;
      const source = cardImageSource(card, 'small', 0);
      if (source?.size === 'small') {
        const url = await scryfall.image(card, 'small', 0, { signal, priority: 'upgrade' });
        if (url) URL.revokeObjectURL(url); else incomplete = true;
      }
      progress('images', ++completed, cards.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, cards.length) }, worker));
  return incomplete || signal.aborted;
}
