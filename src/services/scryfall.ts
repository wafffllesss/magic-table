import type { CardDefinition, DeckDefinition } from '../domain/game';
import { localRepository } from './storage';

const API = 'https://api.scryfall.com';
const MIN_REQUEST_DELAY = 210;
const CARD_BATCH_SIZE = 75;

type ScryfallList<T> = { data: T[]; has_more: boolean; next_page?: string };
type CollectionIdentifier = { id: string } | { name: string };
type QueueTask<T> = { run: () => Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };

export class ScryfallService {
  private lastRequest = 0;
  private readonly queue: QueueTask<unknown>[] = [];
  private queueActive = false;
  private readonly pendingLookups = new Map<string, Promise<CardDefinition[]>>();

  async get(id: string, signal?: AbortSignal): Promise<CardDefinition | undefined> {
    const record = await localRepository.getCachedCard(id);
    if (record && Date.now() - record.cachedAt < 86_400_000) return record.card;
    const response = await this.request<CardDefinition>(`/cards/${encodeURIComponent(id)}`, signal);
    await localRepository.putCard(response);
    return response;
  }

  async resolve(names: string[], signal?: AbortSignal): Promise<CardDefinition[]> {
    const unique = [...new Set(names.map(name => name.trim()).filter(Boolean))];
    const cards: CardDefinition[] = []; const missingNames: string[] = [];
    for (const name of unique) {
      const cached = await this.findCached(name);
      if (cached) cards.push(cached); else missingNames.push(name);
    }
    for (let start = 0; start < missingNames.length; start += CARD_BATCH_SIZE) {
      const batch = missingNames.slice(start, start + CARD_BATCH_SIZE);
      const key = batch.map(name => name.toLocaleLowerCase('pt-BR')).sort().join('|');
      let pending = this.pendingLookups.get(key);
      if (!pending) {
        pending = this.request<{ data: CardDefinition[]; not_found: Array<{ name?: string; identifier?: string }> }>('/cards/collection', signal, {
          method: 'POST', body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
        }).then(async response => {
          await Promise.all(response.data.map(card => localRepository.putCard(card)));
          return response.data;
        }).finally(() => this.pendingLookups.delete(key));
        this.pendingLookups.set(key, pending);
      }
      cards.push(...await pending);
    }
    return unique.map(name => cards.find(card => card.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR') || card.card_faces?.some(face => face.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')))).filter((card): card is CardDefinition => Boolean(card));
  }

  async search(query: string, page = 1, signal?: AbortSignal): Promise<ScryfallList<CardDefinition>> {
    const parameters = new URLSearchParams({ q: query, unique: 'cards', order: 'name', page: String(page) });
    const result = await this.request<ScryfallList<CardDefinition>>(`/cards/search?${parameters}`, signal);
    await Promise.all(result.data.map(card => localRepository.putCard(card)));
    return result;
  }

  async image(card: CardDefinition, size: 'small' | 'normal' = 'small', face = 0): Promise<string | undefined> {
    const cacheId = `${card.id}-${face}-${size}`;
    const cached = await localRepository.getImage(cacheId);
    if (cached) return URL.createObjectURL(cached);
    const uri = card.layout === 'transform' || card.layout === 'modal_dfc' || card.layout === 'double_faced_token'
      ? card.card_faces?.[face]?.image_uris?.[size] ?? card.image_uris?.[size]
      : card.image_uris?.[size] ?? card.card_faces?.[face]?.image_uris?.[size];
    if (!uri || !uri.startsWith('https://cards.scryfall.io/')) return undefined;
    try {
      const response = await this.request<Blob>(uri, undefined, undefined, 'image/jpeg');
      await localRepository.putImage(cacheId, response);
      return URL.createObjectURL(response);
    } catch { return uri; }
  }

  private async findCached(name: string): Promise<CardDefinition | undefined> {
    for (const deck of await localRepository.getDecks()) {
      for (const entry of deck.entries) {
        if (entry.card && (entry.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR') || entry.card.card_faces?.some(face => face.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')))) return entry.card;
      }
    }
    return undefined;
  }

  private request<T>(path: string, signal?: AbortSignal, init?: RequestInit, accept = 'application/json'): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ run: async () => {
        if (signal?.aborted) throw new DOMException('Busca cancelada.', 'AbortError');
        const delay = Math.max(0, this.lastRequest + MIN_REQUEST_DELAY - performance.now());
        if (delay) await new Promise(done => setTimeout(done, delay));
        if (signal?.aborted) throw new DOMException('Busca cancelada.', 'AbortError');
        this.lastRequest = performance.now();
        const url = path.startsWith('https://cards.scryfall.io/') ? path : `${API}${path}`;
        let response: Response | undefined;
        for (let attempt = 0; attempt < 4; attempt++) {
          response = await fetch(url, { ...init, signal, headers: { Accept: accept, ...(init?.headers ?? {}) } });
          if (response.status !== 429 && response.status !== 503) break;
          const retryAfter = Number(response.headers.get('Retry-After') ?? '1');
          if (attempt === 3) throw Object.assign(new Error('Scryfall limitou temporariamente as buscas. Tente novamente.'), { status: response.status });
          await new Promise(done => setTimeout(done, Math.min(30_000, Math.max(1000 * (attempt + 1), retryAfter * 1000))));
        }
        if (response?.status === 404) throw Object.assign(new Error('Carta não encontrada.'), { status: 404 });
        if (!response?.ok) throw new Error((response?.status ?? 0) >= 500 ? 'Scryfall está temporariamente indisponível.' : `A busca falhou (${response?.status ?? 0}).`);
        return (accept === 'image/jpeg' ? response.blob() : response.json()) as Promise<T>;
      }, resolve: resolve as (value: unknown) => void, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.queueActive) return;
    this.queueActive = true;
    while (this.queue.length) {
      const task = this.queue.shift()!;
      try { task.resolve(await task.run()); } catch (error) { task.reject(error); }
    }
    this.queueActive = false;
  }
}

export const scryfall = new ScryfallService();
