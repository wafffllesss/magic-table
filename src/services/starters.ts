import type { DeckDefinition, DeckEntry } from '../domain/game';
import { shuffle } from '../domain/game';
import { parseDeckText, validateDeck } from '../domain/deck';
import { localRepository } from './storage';
import { scryfall, type ScryfallProgress } from './scryfall';
import { cardNames, normaliseCardName as normalise } from '../domain/cardNames';
import { LEGACY_STARTER_IDS, PRECONS, type PreconManifest } from './precons';

export type StarterDeckStatus = { decks: DeckDefinition[]; isFresh: boolean; warning?: string };

export async function getLibraryDecks(): Promise<DeckDefinition[]> {
  const decks = await localRepository.getDecks();
  for (const id of LEGACY_STARTER_IDS) {
    if (decks.some(deck => deck.id === id)) await localRepository.deleteDeck(id);
  }
  return decks.filter(deck => !LEGACY_STARTER_IDS.some(id => id === deck.id)).filter(deck => {
    const manifest = PRECONS.find(item => item.id === deck.id);
    return !manifest || matchesPrecon(deck, manifest);
  });
}

export async function getStarterDecks(signal?: AbortSignal, onProgress?: ScryfallProgress): Promise<StarterDeckStatus> {
  checkAbort(signal);
  const saved = await getLibraryDecks();
  const ready: DeckDefinition[] = [];
  let isFresh = false;
  const totalNames = PRECONS.reduce((sum, item) => sum + new Set(item.entries.map(entry => normalise(entry.name))).size, 0);
  let loadedNames = 0;
  onProgress?.(0, totalNames);
  for (const manifest of PRECONS) {
    checkAbort(signal);
    const cached = saved.find(deck => matchesPrecon(deck, manifest));
    const manifestNames = new Set(manifest.entries.map(entry => normalise(entry.name)));
    if (cached) { ready.push(cached); loadedNames += manifestNames.size; onProgress?.(loadedNames, totalNames); continue; }
    try {
      const cards = await scryfall.resolve(manifest.entries.map(entry => entry.name), signal, {}, loaded => onProgress?.(loadedNames + loaded, totalNames));
      checkAbort(signal);
      const byName = new Map(cards.flatMap(card => cardNames(card).map(name => [name, card] as const)));
      const missing = manifest.entries.filter(entry => !byName.has(normalise(entry.name)));
      if (missing.length) throw new Error('Cartas não encontradas: ' + missing.map(entry => entry.name).join(', ') + '.');
      const entries: DeckEntry[] = manifest.entries.map(entry => {
        const card = byName.get(normalise(entry.name))!;
        return { ...entry, cardId: card.id, name: card.name, card };
      });
      const deck: DeckDefinition = { id: manifest.id, name: manifest.name, format: 'commander', entries,
        commanders: entries.filter(entry => entry.role === 'commander').map(entry => entry.cardId),
        updatedAt: Date.now(), source: manifest.sourceUrl,
        precon: { setCode: manifest.setCode, edition: manifest.edition, sourceUrl: manifest.sourceUrl, version: manifest.version } };
      const problems = validateDeck(deck, new Map(entries.map(entry => [entry.cardId, entry.card!])));
      for (const entry of entries) {
        if (!entry.card!.legalities.commander) problems.push(`Legalidade de Commander indisponível para ${entry.name}.`);
      }
      const identity = entries.filter(entry => entry.role === 'commander').flatMap(entry => entry.card!.color_identity);
      if ([...new Set(identity)].sort().join('') !== [...manifest.colors].sort().join('')) problems.push('A identidade de cores difere do precon original.');
      if (problems.length) throw new Error(problems.join(' '));
      checkAbort(signal);
      await localRepository.saveDeck(deck);
      ready.push(deck); isFresh = true;
      loadedNames += manifestNames.size;
      onProgress?.(loadedNames, totalNames);
    } catch (error) {
      checkAbort(signal);
      const warning = manifest.name + ': ' + friendlyError(error);
      const available = PRECONS.flatMap(item => {
        const deck = ready.find(deck => deck.id === item.id) ?? saved.find(deck => matchesPrecon(deck, item));
        return deck ? [deck] : [];
      });
      if (available.length) return { decks: available, isFresh, warning: warning + ' ' + available.length + ' de ' + PRECONS.length + ' precons disponíveis. Tente carregar novamente.' };
      throw new Error(warning, { cause: error });
    }
  }
  return { decks: ready, isFresh };
}

function matchesPrecon(deck: DeckDefinition, manifest: PreconManifest): boolean {
  if (deck.id !== manifest.id || deck.precon?.version !== manifest.version || deck.precon.setCode !== manifest.setCode) return false;
  const signature = (entries: Pick<DeckEntry, 'name' | 'quantity' | 'role'>[]) => entries.map(entry => normalise(entry.name) + '|' + entry.quantity + '|' + entry.role).sort().join('\n');
  if (signature(deck.entries) !== signature(manifest.entries)) return false;
  if (deck.entries.some(entry => !entry.card || entry.cardId !== entry.card.id || normalise(entry.name) !== normalise(entry.card.name))) return false;
  const commanders = deck.entries.filter(entry => entry.role === 'commander').map(entry => entry.cardId);
  if (commanders.length !== deck.commanders.length || !commanders.every(id => deck.commanders.includes(id))) return false;
  if (deck.entries.some(entry => entry.card!.legalities.commander !== 'legal')) return false;
  const identity = new Set(deck.entries.filter(entry => entry.role === 'commander').flatMap(entry => entry.card!.color_identity));
  if ([...identity].sort().join('') !== [...manifest.colors].sort().join('')) return false;
  return !validateDeck(deck, new Map(deck.entries.map(entry => [entry.cardId, entry.card!]))).length;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Busca cancelada.', 'AbortError');
}

export function randomCommanderDeck(cards: import('../domain/game').CardDefinition[], name: string, identity: string, count = 99): DeckDefinition {
  const leaders = cards.filter(card => /\bCreature\b/i.test(card.type_line) && /\bLegendary\b/i.test(card.type_line) && card.legalities.commander === 'legal').slice(0, 1);
  if (leaders.length !== 1) throw new Error('Escolha primeiro uma criatura lendária que pode ser comandante.');
  const commander = leaders[0];
  const pool = cards.filter(card => card.oracle_id !== commander.oracle_id && card.legalities.commander === 'legal' && card.color_identity.every(color => commander.color_identity.includes(color)) && !/\bBasic Land\b/i.test(card.type_line));
  const spells = shuffle([...new Map(pool.map(card => [card.oracle_id, card])).values()]).slice(0, Math.max(0, count - 36));
  const entries: DeckEntry[] = [{ cardId: commander.id, name: commander.name, quantity: 1, role: 'commander', card: commander }, ...spells.map(card => ({ cardId: card.id, name: card.name, quantity: 1, role: 'library' as const, card }))];
  void identity;
  return { id: `deck-${Date.now().toString(36)}`, name: name || 'Meu deck', format: 'commander', commanders: [commander.id], entries, updatedAt: Date.now() };
}

export function importTextDeck(text: string): DeckDefinition { return parseDeckText(text); }

function friendlyError(error: unknown): string { return error instanceof Error ? error.message : 'A biblioteca local não pôde ser atualizada.'; }
