import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareStartupCards } from './startup';
import { getLibraryDecks, getStarterDecks } from './starters';
import { scryfall } from './scryfall';
import { localRepository } from './storage';
import type { CardDefinition, DeckDefinition } from '../domain/game';
vi.mock('./starters', () => ({ getLibraryDecks: vi.fn(), getStarterDecks: vi.fn() }));
vi.mock('./scryfall', () => ({ scryfall: { getByIds: vi.fn(), image: vi.fn() } }));
vi.mock('./storage', () => ({ localRepository: { saveDeck: vi.fn() } }));
const card = { id: 'a', name: 'A', image_uris: { small: 'https://cards.scryfall.io/a.jpg' } } as unknown as CardDefinition;
const deck = () => ({ id: 'deck', entries: [{ cardId: 'a', name: 'A', quantity: 1, role: 'library', card }, { cardId: 'a', name: 'A', quantity: 1, role: 'library', card }] }) as DeckDefinition;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getStarterDecks).mockResolvedValue({ decks: [], isFresh: false }); vi.mocked(getLibraryDecks).mockResolvedValue([deck()]); vi.mocked(scryfall.image).mockResolvedValue('blob:test'); vi.stubGlobal('URL', { revokeObjectURL: vi.fn() }); });
describe('startup card preparation', () => {
  it('deduplicates images and reuses saved card definitions', async () => {
    const progress = vi.fn();
    expect(await prepareStartupCards(new AbortController().signal, progress)).toBe(false);
    expect(scryfall.getByIds).not.toHaveBeenCalled();
    expect(scryfall.image).toHaveBeenCalledTimes(1);
    expect(scryfall.image).toHaveBeenCalledWith(card, 'small', 0, expect.objectContaining({ priority: 'upgrade' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(progress).toHaveBeenLastCalledWith('images', 1, 1);
  });
  it('restores missing definitions and saves them', async () => {
    const saved = deck(); saved.entries[0]!.card = undefined; saved.entries[1]!.card = undefined;
    vi.mocked(getLibraryDecks).mockResolvedValue([saved]); vi.mocked(scryfall.getByIds).mockResolvedValue([card]);
    expect(await prepareStartupCards(new AbortController().signal, vi.fn())).toBe(false);
    expect(localRepository.saveDeck).toHaveBeenCalledWith(expect.objectContaining({ entries: expect.arrayContaining([expect.objectContaining({ card })]) }));
  });
  it('continues with cached decks when starter or image requests fail', async () => {
    vi.mocked(getStarterDecks).mockRejectedValue(Error('offline')); vi.mocked(scryfall.image).mockResolvedValue(undefined);
    expect(await prepareStartupCards(new AbortController().signal, vi.fn())).toBe(true);
    expect(scryfall.image).toHaveBeenCalledTimes(1);
  });
  it('stops when cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    expect(await prepareStartupCards(controller.signal, vi.fn())).toBe(true);
    expect(scryfall.image).not.toHaveBeenCalled();
  });
});
