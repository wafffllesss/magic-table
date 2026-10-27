import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepository } from './storage';
import { normaliseCard, ScryfallService } from './scryfall';
import type { CardDefinition } from '../domain/game';
import { commanders, fixtureDecks, spells } from '../../tests/fixtures/scryfall';

let repo: LocalRepository;
let service: ScryfallService;
beforeEach(() => { repo = new LocalRepository(crypto.randomUUID()); service = new ScryfallService(repo); });
afterEach(async () => { await repo.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Scryfall integration', () => {
  it('resolves combined flip-card names through the front face and reuses the canonical cached name', async () => {
    const card = { ...commanders[0], name: 'Budoka Gardener // Dokai, Weaver of Life', layout: 'flip', card_faces: [
      { name: 'Budoka Gardener', mana_cost: '', type_line: 'Creature', oracle_text: '' },
      { name: 'Dokai, Weaver of Life', mana_cost: '', type_line: 'Legendary Creature', oracle_text: '' },
    ] };
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const names = JSON.parse(init.body as string).identifiers.map((item: { name: string }) => item.name);
      return json({ data: names.includes('Budoka Gardener') ? [card] : [] });
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await service.resolve([card.name]))[0]?.name).toBe(card.name);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await service.resolve([card.name]))[0]?.name).toBe(card.name);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not block metadata behind an image download and returns no URL to a cancelled consumer', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((url: string) => url.startsWith('https://cards.scryfall.io/')
      ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(json({ data: [], has_more: false })));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const image = service.image(commanders[0], 'small', 0, { signal: controller.signal });
    const shared = service.image(commanders[0]);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(await service.search('unblocked')).toMatchObject({ data: [] });
    controller.abort(); expect(await image).toBeUndefined();
    finish(new Response(new Blob(['image'], { type: 'image/jpeg' })));
    const url = await shared; expect(url).toMatch(/^blob:/); URL.revokeObjectURL(url!);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reuses cached metadata regardless of age by ID and name without requiring a saved deck', async () => {
    await repo.putCard(commanders[0]);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 100 * 86_400_000);
    expect(await service.get(commanders[0].id)).toEqual(commanders[0]);
    expect(await service.resolve([commanders[0].name.toUpperCase()])).toEqual([commanders[0]]);
    expect(fetcher).not.toHaveBeenCalled(); now.mockRestore();
  });

  it('reports resolved names including cached cards without counting cancelled work as complete', async () => {
    await repo.putCard(commanders[0]);
    const fetcher = vi.fn(async () => json({ data: [spells[0]], not_found: [] }));
    vi.stubGlobal('fetch', fetcher);
    const progress: [number, number][] = [];
    await service.resolve([commanders[0].name, spells[0].name], undefined, {}, (loaded, total) => progress.push([loaded, total]));
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });

  it('resolves batches of 75 with JSON headers and caches the returned definitions', async () => {
    const cards = [...spells, ...commanders];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' });
      const names = JSON.parse(init.body as string).identifiers.map((item: { name: string }) => item.name);
      expect(names.length).toBeLessThanOrEqual(75);
      return json({ data: cards.filter(card => names.includes(card.name)), not_found: [] });
    }); vi.stubGlobal('fetch', fetcher);
    expect(await service.resolve(cards.map(card => card.name))).toHaveLength(76);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await repo.getCardByName(commanders[5].name)).toEqual(commanders[5]);
    expect(await service.resolve(['Unknown card'])).toEqual([]);
  });

  it('shares lookups while cancellation only rejects the cancelling subscriber', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const first = service.resolve([commanders[0].name], controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = service.resolve([commanders[0].name]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort(); await rejected;
    finish(json({ data: [commanders[0]] }));
    expect(await second).toEqual([normaliseCard(commanders[0])]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('normalizes double-faced metadata and caches search results; an empty search is distinct from a network error', async () => {
    const raw = { id: 'dfc', name: 'Front // Back', layout: 'transform', card_faces: [{ name: 'Front' }, { name: 'Back' }] };
    const fetcher = vi.fn().mockResolvedValueOnce(json({ data: [raw], has_more: false })).mockResolvedValueOnce(json({}, 404)).mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetcher);
    const result = await service.search('front');
    expect(result.data[0].card_faces?.[1].oracle_text).toBe('');
    expect((await repo.getCardByName('Back'))?.id).toBe('dfc');
    expect(await service.search('missing')).toEqual({ data: [], has_more: false });
    await expect(service.search('offline')).rejects.toThrow('conectar');
    const controller = new AbortController(); controller.abort();
    await expect(service.search('cancelled', 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('downloads one image for simultaneous consumers, returns independent object URLs and invalidates on source changes', async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/jpeg' }))); vi.stubGlobal('fetch', fetcher);
    const urls = await Promise.all([service.image(commanders[0]), service.image(commanders[0])]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(urls[0]).toMatch(/^blob:/); expect(urls[0]).not.toBe(urls[1]);
    const cached = await service.image(commanders[0]);
    expect(fetcher).toHaveBeenCalledOnce();
    const changed = { ...commanders[0], image_uris: { small: `${commanders[0].image_uris!.small}?updated` } };
    const updated = await service.image(changed);
    expect(fetcher).toHaveBeenCalledTimes(2);
    [...urls, cached, updated].forEach(url => { if (url) URL.revokeObjectURL(url); });
  });

  it('uses the correct image per face and size and falls back on invalid or unavailable images', async () => {
    const card: CardDefinition = { ...commanders[0], image_uris: undefined, layout: 'transform', card_faces: [
      { name: 'Front', mana_cost: '', oracle_text: '', type_line: '', image_uris: { small: 'https://cards.scryfall.io/front.jpg' } },
      { name: 'Back', mana_cost: '', oracle_text: '', type_line: '', image_uris: { normal: 'https://cards.scryfall.io/back.jpg' } },
    ] };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('not an image', { headers: { 'Content-Type': 'text/html' } })).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    expect(await service.image(card, 'small', 0)).toBeUndefined();
    expect(await service.image(card, 'normal', 1)).toBeUndefined();
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://cards.scryfall.io/front.jpg', 'https://cards.scryfall.io/back.jpg']);
    expect(await service.image(card, 'normal', 0)).toBeUndefined();
  });

  it('preserves a saved deck on failed refresh and updates the same printing on success', async () => {
    const deck = fixtureDecks()[0];
    deck.entries = deck.entries.slice(0, 2);
    await repo.saveDeck(deck);
    await repo.putCards(deck.entries.map(entry => entry.card!));
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(json({ data: [{ ...commanders[0], oracle_text: 'Updated' }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.refreshDeck(deck)).rejects.toThrow('conectar');
    expect((await repo.getDecks())[0]).toEqual(deck);
    await expect(service.refreshDeck(deck)).rejects.toThrow('não encontrada');
    expect(await repo.getCard(commanders[0].id)).toEqual(commanders[0]);
    fetcher.mockImplementation(async (_url: string, init: RequestInit) => {
      const ids = JSON.parse(init.body as string).identifiers.map((item: { id: string }) => item.id);
      return json({ data: deck.entries.filter(entry => ids.includes(entry.cardId)).map(entry => ({ ...entry.card, oracle_text: 'Updated' })) });
    });
    const progress: [number, number][] = [];
    const updated = await service.refreshDeck(deck, undefined, (loaded, total) => progress.push([loaded, total]));
    expect(progress).toEqual([[0, 2], [2, 2]]);
    expect(updated.entries.map(({ cardId, quantity, role }) => ({ cardId, quantity, role }))).toEqual(deck.entries.map(({ cardId, quantity, role }) => ({ cardId, quantity, role })));
    expect(updated.commanders).toEqual(deck.commanders);
    expect(updated.entries.every(entry => entry.card?.oracle_text === 'Updated')).toBe(true);
    expect((await repo.getDecks())[0]).toEqual(updated);
  });

  it('backs off for 429 and 503 and stops after four attempts', async () => {
    vi.spyOn(repo, 'putCards').mockResolvedValue();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const fetcher = vi.fn().mockResolvedValue(json({}, 429)); vi.stubGlobal('fetch', fetcher);
    const failed = expect(service.search('query')).rejects.toThrow('temporariamente');
    await vi.runAllTimersAsync(); await failed;
    expect(fetcher).toHaveBeenCalledTimes(4);
    fetcher.mockReset().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ data: [], has_more: false }));
    const pending = service.search('query'); await vi.runAllTimersAsync();
    expect(await pending).toEqual({ data: [], has_more: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
