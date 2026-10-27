import type { CardDefinition, CardFace, DeckDefinition } from '../domain/game';
import { cardNames, normaliseCardName } from '../domain/cardNames';
import { localRepository, LocalRepository, MAX_SINGLE_IMAGE_BYTES } from './storage';
import { downloadImage, imageQueue, type ImageOptions } from './imageQueue';
import { cardImageSource, type CardImageSize } from './imagePolicy';

const API = 'https://api.scryfall.com';
const MIN_REQUEST_DELAY = 210;
const CARD_BATCH_SIZE = 75;
let imageServiceSequence = 0;
export type LookupOptions = { refresh?: boolean };
export type ScryfallList<T> = { data: T[]; has_more: boolean; next_page?: string };
export type ScryfallProgress = (loaded: number, total: number) => void;
type RawCard = Partial<CardDefinition> & Pick<CardDefinition, 'id' | 'name'>;
type QueueTask = { run: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (reason?: unknown) => void };

export class ScryfallService {
  private readonly imageQueueKey = ++imageServiceSequence;
  private lastRequest = -Infinity;
  private readonly queue: QueueTask[] = [];
  private queueActive = false;
  private readonly pendingLookups = new Map<string, Promise<CardDefinition[]>>();
  private readonly pendingCards = new Map<string, Promise<CardDefinition>>();

  constructor(private readonly repository: LocalRepository = localRepository) {}

  async get(id: string, signal?: AbortSignal, options: LookupOptions = {}): Promise<CardDefinition | undefined> {
    checkAbort(signal);
    const record = await this.repository.getCachedCard(id);
    checkAbort(signal);
    if (record && !options.refresh) { checkAbort(signal); return record.card; }
    let pending = this.pendingCards.get(id);
    if (!pending) {
      pending = this.request<RawCard>(`/cards/${encodeURIComponent(id)}`).then(async raw => {
        const card = normaliseCard(raw);
        await this.repository.putCard(card);
        return card;
      }).finally(() => this.pendingCards.delete(id));
      this.pendingCards.set(id, pending);
    }
    return cancellable(pending, signal);
  }

  async resolve(names: string[], signal?: AbortSignal, options: LookupOptions = {}, onProgress?: ScryfallProgress): Promise<CardDefinition[]> {
    checkAbort(signal);
    const unique = [...new Map(names.map(name => [normaliseCardName(name), name.trim()])).values()].filter(Boolean);
    const cached = options.refresh ? new Map<string, CardDefinition>() : await this.repository.getCardsByNames(unique);
    checkAbort(signal);
    const byName = new Map<string, CardDefinition>();
    const include = (cards: CardDefinition[]) => {
      for (const card of cards) for (const name of cardNames(card)) if (!byName.has(name)) byName.set(name, card);
    };
    include([...cached.values()]);
    const reportProgress = () => onProgress?.(unique.filter(name => byName.has(normaliseCardName(name))).length, unique.length);
    reportProgress();
    const missingNames = unique.filter(name => !byName.has(normaliseCardName(name)));
    for (let start = 0; start < missingNames.length; start += CARD_BATCH_SIZE) {
      checkAbort(signal);
      const batch = missingNames.slice(start, start + CARD_BATCH_SIZE);
      const key = JSON.stringify(batch.map(normaliseCardName).sort());
      let pending = this.pendingLookups.get(key);
      if (!pending) {
        // A subscriber may cancel without cancelling another subscriber's shared request.
        pending = this.request<{ data: RawCard[] }>('/cards/collection', undefined, {
          method: 'POST', body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
        }).then(async response => {
          const resolved = response.data.map(normaliseCard);
          await this.repository.putCards(resolved);
          return resolved;
        }).finally(() => this.pendingLookups.delete(key));
        this.pendingLookups.set(key, pending);
      }
      include(await cancellable(pending, signal));
      reportProgress();
    }
    // Collection lookup does not recognize some combined flip-card names.
    // Looking up the front face returns the full canonical card, including both faces.
    const missingCombined = unique.filter(name => name.includes(' // ') && !byName.has(normaliseCardName(name)));
    if (missingCombined.length) {
      include(await this.resolve(missingCombined.map(name => name.split(' // ')[0]), signal, options));
      reportProgress();
    }
    checkAbort(signal);
    return unique.map(name => byName.get(normaliseCardName(name)))
      .filter((card): card is CardDefinition => Boolean(card));
  }

  async search(query: string, page = 1, signal?: AbortSignal): Promise<ScryfallList<CardDefinition>> {
    const parameters = new URLSearchParams({ q: query, unique: 'cards', order: 'name', page: String(page) });
    try {
      const result = await this.request<ScryfallList<RawCard>>(`/cards/search?${parameters}`, signal);
      checkAbort(signal);
      const cards = result.data.map(normaliseCard);
      await this.repository.putCards(cards);
      return { ...result, data: cards };
    } catch (error) {
      if ((error as { status?: number }).status === 404) return { data: [], has_more: false };
      throw error;
    }
  }

  async getByIds(ids: string[], signal?: AbortSignal, onProgress?: ScryfallProgress): Promise<CardDefinition[]> {
    const unique = [...new Set(ids.filter(Boolean))];
    const cards = new Map<string, CardDefinition>();
    const missing: string[] = [];
    for (const id of unique) {
      checkAbort(signal);
      const cached = await this.repository.getCachedCard(id);
      if (cached) cards.set(id, cached.card);
      else missing.push(id);
      onProgress?.(cards.size, unique.length);
    }
    for (let start = 0; start < missing.length; start += CARD_BATCH_SIZE) {
      checkAbort(signal);
      const batch = missing.slice(start, start + CARD_BATCH_SIZE);
      const response = await this.request<{ data: RawCard[] }>('/cards/collection', signal, {
        method: 'POST', body: JSON.stringify({ identifiers: batch.map(id => ({ id })) }),
      });
      const resolved = response.data.map(normaliseCard);
      resolved.forEach(card => cards.set(card.id, card));
      await this.repository.putCards(resolved);
      onProgress?.(cards.size, unique.length);
    }
    checkAbort(signal);
    return unique.flatMap(id => cards.has(id) ? [cards.get(id)!] : []);
  }

  async refreshDeck(deck: DeckDefinition, signal?: AbortSignal, onProgress?: (loaded: number, total: number) => void): Promise<DeckDefinition> {
    // Stage every printing before replacing metadata or the saved list.
    const definitions = new Map<string, CardDefinition>();
    const ids = [...new Set(deck.entries.map(entry => entry.cardId))];
    onProgress?.(0, ids.length);
    for (let start = 0; start < ids.length; start += CARD_BATCH_SIZE) {
      checkAbort(signal);
      const batch = ids.slice(start, start + CARD_BATCH_SIZE);
      const result = await this.request<{ data: RawCard[] }>('/cards/collection', signal, {
        method: 'POST', body: JSON.stringify({ identifiers: batch.map(id => ({ id })) }),
      });
      result.data.map(normaliseCard).forEach(card => definitions.set(card.id, card));
      for (const id of batch) if (!definitions.has(id)) throw new Error(`Carta não encontrada: ${deck.entries.find(entry => entry.cardId === id)?.name ?? id}.`);
      onProgress?.(definitions.size, ids.length);
    }
    checkAbort(signal);
    const updated = { ...deck, entries: deck.entries.map(entry => ({ ...entry, name: definitions.get(entry.cardId)!.name, card: definitions.get(entry.cardId)! })), updatedAt: Date.now() };
    await this.repository.putCards([...definitions.values()]);
    await this.repository.saveDeck(updated);
    return updated;
  }

  async image(card: CardDefinition, size: CardImageSize = 'small', face = 0, options: ImageOptions = {}): Promise<string | undefined> {
    const source = cardImageSource(card, size, face);
    if (!source || options.signal?.aborted) return undefined;
    const { uri } = source;
    const cacheId = JSON.stringify([card.id, face, source.size, uri]);
    try {
      const blob = await imageQueue.request(`scryfall:${this.imageQueueKey}:${cacheId}`, async signal => {
        const cached = await this.repository.getImage(cacheId);
        if (signal.aborted) throw new DOMException('Imagem cancelada.', 'AbortError');
        if (cached) return cached;
        const downloaded = await downloadImage(uri, signal);
        if (!downloaded.size || downloaded.size > MAX_SINGLE_IMAGE_BYTES || !/^image\/(jpeg|png|webp)$/.test(downloaded.type)) throw new Error('Imagem inválida.');
        if (!signal.aborted) await this.repository.putImage(cacheId, downloaded);
        return downloaded;
      }, options);
      return blob && !options.signal?.aborted ? URL.createObjectURL(blob) : undefined;
    } catch { return undefined; }
  }

  private request<T>(path: string, signal?: AbortSignal, init?: RequestInit, accept = 'application/json'): Promise<T> {
    const pending = new Promise<T>((resolve, reject) => {
      this.queue.push({ run: async () => {
        const url = path.startsWith('https://cards.scryfall.io/') ? path : `${API}${path}`;
        let response: Response | undefined;
        for (let attempt = 0; attempt < 4; attempt++) {
          checkAbort(signal);
          await pause(Math.max(0, this.lastRequest + MIN_REQUEST_DELAY - performance.now()), signal);
          checkAbort(signal);
          this.lastRequest = performance.now();
          try {
            response = await fetch(url, { ...init, signal, headers: { Accept: accept, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
          } catch (error) {
            checkAbort(signal);
            throw new Error('Não foi possível conectar ao Scryfall. Verifique sua conexão.', { cause: error });
          }
          if (response.status !== 429 && response.status !== 503) break;
          if (attempt === 3) throw Object.assign(new Error('Scryfall está temporariamente indisponível. Tente novamente.'), { status: response.status });
          const header = response.headers.get('Retry-After');
          const seconds = header ? Number(header) : 0;
          const retry = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(header!) - Date.now());
          await pause(Math.min(30_000, Math.max(1000 * (attempt + 1), retry || 0)), signal);
        }
        if (response?.status === 404) throw Object.assign(new Error('Carta não encontrada.'), { status: 404 });
        if (!response?.ok) throw new Error((response?.status ?? 0) >= 500 ? 'Scryfall está temporariamente indisponível.' : `A busca falhou (${response?.status ?? 0}).`);
        return accept.startsWith('image/') ? response.blob() : response.json();
      }, resolve: resolve as (value: unknown) => void, reject });
      void this.pump();
    });
    return cancellable(pending, signal);
  }

  private async pump(): Promise<void> {
    if (this.queueActive) return;
    this.queueActive = true;
    try {
      while (this.queue.length) {
        const task = this.queue.shift()!;
        try { task.resolve(await task.run()); } catch (error) { task.reject(error); }
      }
    } finally { this.queueActive = false; }
  }
}

export const scryfall = new ScryfallService();

export function normaliseCard(raw: RawCard): CardDefinition {
  if (!raw.id || !raw.name) throw new Error('Scryfall retornou dados de carta inválidos.');
  const faces = raw.card_faces?.map((face): CardFace => ({ ...face, mana_cost: face.mana_cost ?? '', type_line: face.type_line ?? '', oracle_text: face.oracle_text ?? '' }));
  return { ...raw, oracle_id: raw.oracle_id ?? raw.id, layout: raw.layout ?? 'normal', color_identity: raw.color_identity ?? [], keywords: raw.keywords ?? [],
    mana_cost: raw.mana_cost ?? '', type_line: raw.type_line ?? faces?.map(face => face.type_line).join(' // ') ?? '',
    oracle_text: raw.oracle_text ?? faces?.map(face => face.oracle_text).join('\n\n') ?? '', legalities: raw.legalities ?? {}, card_faces: faces };
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Busca cancelada.', 'AbortError');
}

function cancellable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Busca cancelada.', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) { checkAbort(signal); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Busca cancelada.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
