import type { MatchState } from '../domain/game';
import { publicProjection } from '../domain/game';

// The SDK rejects undefined optional fields, including those on Scryfall cards.
export function firebaseValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Realtime Database removes empty arrays and objects from JSON trees.
export function restorePublicMatch(raw: MatchState): MatchState {
  return {
    ...raw,
    suspendedSeatIds: raw.suspendedSeatIds ?? [], disconnectedSeatIds: raw.disconnectedSeatIds ?? [],
    seats: (raw.seats ?? []).map(seat => ({ ...seat, hand: [], library: [], commanderIds: seat.commanderIds ?? [],
      commanderCasts: seat.commanderCasts ?? {}, commanderDamage: seat.commanderDamage ?? {},
      mulligans: seat.mulligans ?? 0, keptHand: seat.keptHand ?? false, landPlays: seat.landPlays ?? 0 })),
    cards: restoreCards(raw.cards),
    stack: raw.stack ?? [], passes: raw.passes ?? [], log: raw.log ?? [], hiddenZones: raw.hiddenZones ?? {},
  };
}

export function restoreCards(cards: MatchState['cards'] = {}): MatchState['cards'] {
  return Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, { ...card, counters: card.counters ?? {},
    card: card.card ? { ...card.card, keywords: card.card.keywords ?? [], color_identity: card.card.color_identity ?? [], legalities: card.card.legalities ?? {} } : undefined }]));
}

export function publicGameUpdate(state: MatchState, ownSeatId?: string): ReturnType<typeof publicProjection> {
  const view = publicProjection(state);
  for (const seat of state.seats) {
    const remote = state.hiddenZones?.[seat.id];
    if (seat.id !== ownSeatId && remote) Object.assign(view.hiddenZones[seat.id], { hand: remote.hand ?? 0, library: remote.library ?? 0 });
  }
  return view;
}

export function firebaseConnectionError(error: unknown): Error {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed') {
    return new Error('Ative Authentication e o provedor Anônimo no console do Firebase para conectar jogadores.');
  }
  if (code === 'auth/invalid-api-key') return new Error('A chave de configuração do Firebase é inválida. Confira o arquivo .env.local.');
  if (code === 'auth/network-request-failed') return new Error('Não foi possível conectar ao Firebase. Verifique sua conexão.');
  if (/permission|denied/i.test(code || (error as Error)?.message || '')) return new Error('O Firebase negou acesso à sala. Confira as regras do Realtime Database.');
  return error instanceof Error ? error : new Error('Não foi possível conectar à sala do Firebase.');
}
