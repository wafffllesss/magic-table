import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { DeckDefinition } from '../domain/game';
import { totalCards } from '../domain/game';
import { validateDeck } from '../domain/deck';
import { getLibraryDecks, getStarterDecks } from './starters';
import { LEGACY_STARTER_IDS, PRECONS } from './precons';
import { localRepository } from './storage';
import { scryfall } from './scryfall';
import { fixtureDecks } from '../../tests/fixtures/scryfall';
import { findPreconCard, preconFixtureDecks } from '../../tests/fixtures/precons';
import hashes from '../../tests/fixtures/precon-hashes.json';

let saved: DeckDefinition[];
beforeEach(() => {
  saved = [];
  vi.spyOn(localRepository, 'getDecks').mockImplementation(async () => structuredClone(saved));
  vi.spyOn(localRepository, 'saveDeck').mockImplementation(async deck => { saved = [...saved.filter(item => item.id !== deck.id), structuredClone(deck)]; });
  vi.spyOn(localRepository, 'deleteDeck').mockImplementation(async id => { saved = saved.filter(deck => deck.id !== id); });
});
function mockCards() {
  return vi.spyOn(scryfall, 'resolve').mockImplementation(async names => names.map(name => findPreconCard({ name })!).filter(Boolean).reverse());
}

describe('official Commander precons', () => {
  it('matches all 30 published manifests, colors and 100-card quantities', () => {
    const decks = preconFixtureDecks();
    expect(decks).toHaveLength(30);
    expect(new Set(PRECONS.slice(0, 14).map(deck => [...deck.colors].sort().join(''))).size).toBe(14);
    expect(PRECONS.slice(0, 14).map(deck => deck.colors.length)).toEqual([1,1,1,1,1,2,2,2,2,2,3,3,4,5]);
    expect(PRECONS.slice(14).map(deck => deck.name)).toEqual([
      'Explorers of the Deep', 'Ahoy Mateys', 'Blood Rites', 'Veloci-Ramp-Tor',
      'Blame Game', 'Deadly Disguise', 'Deep Clue Sea', 'Revenant Recon',
      'Quick Draw', 'Desert Bloom', 'Grand Larceny', 'Most Wanted',
      'Animated Army', 'Family Matters', 'Peace Offering', 'Squirreled Away',
    ]);
    for (const [index, manifest] of PRECONS.entries()) {
      const signature = JSON.stringify(manifest.entries.map(e => [e.name, e.quantity, e.role]).sort((a,b) => String(a).localeCompare(String(b))));
      expect(createHash('sha256').update(signature).digest('hex')).toBe(hashes[manifest.id as keyof typeof hashes]);
      expect(totalCards(decks[index])).toBe(100);
      expect(decks[index].commanders.length).toBeGreaterThanOrEqual(1);
      expect(validateDeck(decks[index], new Map(decks[index].entries.map(entry => [entry.cardId, entry.card!])))).toEqual([]);
    }
    expect(decks[0].entries[0].card?.oracle_text).toContain('can be your commander');
    expect(decks[0].entries.find(entry => entry.name === 'Plains')?.quantity).toBe(32);
    expect(decks[12].entries.some(entry => entry.name === 'Trial // Error')).toBe(true);
  });

  it('resolves fixed quantities by name regardless of response order, then reuses all decks without network', async () => {
    const resolve = mockCards();
    const search = vi.spyOn(scryfall, 'search');
    const result = await getStarterDecks();
    expect(result.isFresh).toBe(true);
    expect(result.decks.map(deck => deck.id)).toEqual(PRECONS.map(deck => deck.id));
    expect(result.decks.map(totalCards)).toEqual(Array(30).fill(100));
    expect(search).not.toHaveBeenCalled();
    for (const [index, deck] of result.decks.entries()) {
      expect(deck.entries.map(({name, quantity, role}) => ({name, quantity, role}))).toEqual(PRECONS[index].entries);
      expect(deck.precon?.sourceUrl.startsWith('https://magic.wizards.com/')).toBe(true);
    }
    resolve.mockClear();
    expect((await getStarterDecks()).isFresh).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('removes exactly the four legacy IDs even while offline and preserves personal decks', async () => {
    const personal = { ...fixtureDecks()[0], id: 'personal-deck' };
    saved = [...fixtureDecks(), personal];
    expect((await getLibraryDecks()).map(deck => deck.id)).toEqual(['personal-deck']);
    expect(localRepository.deleteDeck).toHaveBeenCalledTimes(4);
    for (const id of LEGACY_STARTER_IDS) expect(localRepository.deleteDeck).toHaveBeenCalledWith(id);
    vi.spyOn(scryfall, 'resolve').mockRejectedValue(new Error('offline'));
    await expect(getStarterDecks()).rejects.toThrow('Forged in Stone: offline');
    expect(saved).toEqual([personal]);
  });

  it('rejects missing cards without saving an incomplete list', async () => {
    mockCards().mockImplementation(async names => names.filter(name => name !== 'Sol Ring').map(name => findPreconCard({name})!));
    await expect(getStarterDecks()).rejects.toThrow('Cartas não encontradas: Sol Ring');
    expect(saved).toEqual([]);
  });

  it('rejects banned cards rather than changing the published list', async () => {
    mockCards().mockImplementation(async names => names.map(name => {
      const card = structuredClone(findPreconCard({name})!);
      if (name === 'Sol Ring') card.legalities.commander = 'banned';
      return card;
    }));
    await expect(getStarterDecks()).rejects.toThrow('Sol Ring está banida');
    expect(saved).toEqual([]);
  });

  it('keeps partial progress and later cached decks, and retries only the missing precons', async () => {
    const all = preconFixtureDecks(); saved = [all[13]];
    const resolve = mockCards();
    resolve.mockImplementationOnce(async names => names.map(name => findPreconCard({ name })!));
    resolve.mockRejectedValueOnce(new Error('offline'));
    const partial = await getStarterDecks();
    expect(partial.decks.map(deck => deck.id)).toEqual([all[0].id, all[13].id]);
    expect(partial.warning).toContain('2 de 30');
    resolve.mockClear();
    const complete = await getStarterDecks();
    expect(complete.decks).toHaveLength(30);
    expect(resolve).toHaveBeenCalledTimes(28);
  }, 15_000);

  it('rebuilds stale, altered and invalid cached precons without falling back to them', async () => {
    saved = preconFixtureDecks();
    saved[0].precon!.version = 0;
    saved[1].entries[1].quantity = 2;
    saved[2].entries[1].name = 'Changed composition';
    saved[3].commanders = [];
    saved[4].entries[0].card!.legalities.commander = 'banned';
    const resolve = mockCards();
    expect((await getLibraryDecks())).toHaveLength(25);
    const complete = await getStarterDecks();
    expect(complete.decks).toHaveLength(30);
    expect(resolve).toHaveBeenCalledTimes(5);
  });

  it('honors cancellation before loading and after resolving, before saving', async () => {
    const controller = new AbortController(); controller.abort();
    const resolve = mockCards();
    await expect(getStarterDecks(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolve).not.toHaveBeenCalled();
    const during = new AbortController();
    resolve.mockImplementation(async names => { during.abort(); return names.map(name => findPreconCard({name})!); });
    await expect(getStarterDecks(during.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(localRepository.saveDeck).not.toHaveBeenCalled();
  });
});
