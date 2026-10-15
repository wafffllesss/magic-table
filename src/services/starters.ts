import type { DeckDefinition, DeckEntry } from '../domain/game';
import { shuffle } from '../domain/game';
import { parseDeckText, validateDeck } from '../domain/deck';
import { localRepository } from './storage';
import { scryfall } from './scryfall';

export type StarterDeckStatus = { decks: DeckDefinition[]; isFresh: boolean; warning?: string };

const STARTER_DECKS = [
  { id: 'starter-mono-white', name: 'Marcha da Vanguarda', colors: 'w', commanders: ['Adeline, Resplendent Cathar'], basics: ['Plains'] },
  { id: 'starter-mono-blue', name: 'Cartógrafos do Éter', colors: 'u', commanders: ['Talrand, Sky Summoner'], basics: ['Island'] },
  { id: 'starter-partner', name: 'Uma Sociedade Inesperada', colors: 'wg', commanders: ['Frodo, Adventurous Hobbit', 'Sam, Loyal Attendant'], basics: ['Forest', 'Plains'] },
  { id: 'starter-background', name: 'Aventura sem Fronteiras', colors: 'wb', commanders: ["Lae'zel, Vlaakith's Champion", 'Agent of the Iron Throne'], basics: ['Plains', 'Swamp'] },
] as const;

const STARTER_VERSION = 1;

export async function getStarterDecks(signal?: AbortSignal): Promise<StarterDeckStatus> {
  const saved = await Promise.all(STARTER_DECKS.map(async starter => {
    const decks = await localRepository.getDecks();
    return decks.find(deck => deck.id === starter.id && (deck as DeckDefinition & { starterVersion?: number }).starterVersion === STARTER_VERSION);
  }));
  if (saved.every(Boolean)) return { decks: saved as DeckDefinition[], isFresh: false };

  try {
    const commanders = await scryfall.resolve([...new Set(STARTER_DECKS.flatMap(deck => [...deck.commanders]))], signal);
    const definitionsByName = new Map(commanders.flatMap(card => [[normalise(card.name), card], ...(card.card_faces ?? []).map(face => [normalise(face.name), card] as const)]));
    const existingDecks: DeckDefinition[] = [];
    for (const starter of STARTER_DECKS) {
      const leaderCards = starter.commanders.map(name => definitionsByName.get(normalise(name)));
      if (leaderCards.some(card => !card)) throw new Error(`Scryfall não encontrou o comandante de ${starter.name}.`);
      const requiredColors = [...new Set(starter.colors.split(''))];
      if (leaderCards.some(card => !card!.color_identity.every(color => requiredColors.includes(color.toLowerCase())))) throw new Error(`A identidade de cores de ${starter.name} mudou. Nenhum deck foi criado.`);

      const query = `f:commander legal:commander id<=${starter.colors} -t:land -is:commander`;
      const result = await scryfall.search(query, 1, signal).catch(async () => scryfall.search(`f:commander legal:commander id<=${starter.colors} -t:land`, 1, signal));
      const commanderOracleIds = new Set(leaderCards.map(card => card!.oracle_id));
      const pool = result.data.filter(card => card.legalities.commander === 'legal' && !commanderOracleIds.has(card.oracle_id) && !/\bBasic Land\b/i.test(card.type_line));
      const uniquePool = new Map(pool.map(card => [card.oracle_id, card]));
      const requiredSpellCount = 100 - starter.commanders.length - 35;
      const spells = shuffle([...uniquePool.values()]).slice(0, requiredSpellCount);
      if (spells.length < requiredSpellCount) throw new Error(`Scryfall retornou somente ${spells.length} cartas elegíveis para ${starter.name}. Tente novamente com internet.`);

      const entries: DeckEntry[] = leaderCards.map(card => ({ cardId: card!.id, name: card!.name, quantity: 1, role: 'commander', card: card! }));
      entries.push(...spells.map(card => ({ cardId: card.id, name: card.name, quantity: 1, role: 'library' as const, card })));
      const basicNames = [...(starter.colors.length === 1 ? [starter.basics[0]] : starter.basics)];
      const basicDefinitions = await scryfall.resolve(basicNames, signal);
      if (basicDefinitions.length !== basicNames.length) throw new Error('Não foi possível carregar os terrenos básicos da biblioteca local.');
      const basicGroups = splitBasics(basicNames, starter.colors);
      basicDefinitions.forEach((basic, index) => {
        const quantity = basicGroups[index];
        if (quantity > 0) entries.push({ cardId: basic.id, name: basic.name, quantity, role: 'library', card: basic });
      });
      const deck: DeckDefinition & { starterVersion: number } = { id: starter.id, name: starter.name, format: 'commander', commanders: leaderCards.map(card => card!.id), entries, updatedAt: Date.now(), starterVersion: STARTER_VERSION };
      const validation = validateDeck(deck, new Map(entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : [])));
      if (validation.length) throw new Error(`${starter.name}: ${validation.join(' ')}`);
      await localRepository.saveDeck(deck);
      existingDecks.push(deck);
    }
    return { decks: existingDecks, isFresh: true };
  } catch (error) {
    const cachedDecks = await localRepository.getDecks();
    const starterDecks = cachedDecks.filter(deck => STARTER_DECKS.some(starter => starter.id === deck.id));
    if (starterDecks.length === STARTER_DECKS.length) return { decks: starterDecks, isFresh: false, warning: friendlyError(error) };
    throw error;
  }
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

function splitBasics(names: readonly string[], _colors: string): number[] {
  if (names.length === 1) return [35];
  const first = Math.ceil(35 / names.length);
  return names.map((_, index) => index === names.length - 1 ? 35 - first * index : first);
}

function normalise(name: string): string { return name.trim().toLocaleLowerCase('en-US'); }
function friendlyError(error: unknown): string { return error instanceof Error ? error.message : 'A biblioteca local não pôde ser atualizada.'; }
