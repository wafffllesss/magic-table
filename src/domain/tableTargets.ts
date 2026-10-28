import type { MatchState } from './game';
import { isTableSeat } from './tablePresence';
import type { TableSeatId } from '../services/firebaseRoom';

export const TARGET_DURATION = 10_000;
export type TargetReference = { kind: 'card'; cardId: string } | { kind: 'player'; seatId: TableSeatId };
export type TargetIntent = { id: string; matchId: string; kind: 'highlight'; target: TargetReference } | { id: string; matchId: string; kind: 'arrow'; origin: TargetReference & { kind: 'card' }; target: TargetReference };
export type TargetMark = TargetIntent & { uid: string; seatId: TableSeatId; at: number };

export function targetReferenceValid(value: unknown, state: MatchState, temporarilyRevealedHands: ReadonlySet<string> = new Set()): value is TargetReference {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Record<string, unknown>;
  if (ref.kind === 'player') return isTableSeat(ref.seatId) && state.seats.some(seat => seat.id === ref.seatId);
  if (ref.kind !== 'card' || typeof ref.cardId !== 'string') return false;
  const card = state.cards[ref.cardId];
  if (!card) return temporarilyRevealedHands.has(ref.cardId);
  return Boolean(['battlefield', 'stack', 'command', 'graveyard', 'exile', 'revealed'].includes(card.zone) || card.zone === 'hand' && (card.revealed || card.temporaryReveal || temporarilyRevealedHands.has(card.id)));
}

export function validTargetIntent(value: unknown, state: MatchState, temporarilyRevealedHands: ReadonlySet<string> = new Set()): value is TargetIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Record<string, unknown>;
  if (typeof intent.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(intent.id) || intent.matchId !== state.id || !targetReferenceValid(intent.target, state, temporarilyRevealedHands)) return false;
  if (intent.kind === 'highlight') return intent.origin === undefined;
  if (intent.kind !== 'arrow' || !targetReferenceValid(intent.origin, state, temporarilyRevealedHands) || intent.origin.kind !== 'card') return false;
  const destination = intent.target as TargetReference;
  return destination.kind !== 'card' || destination.cardId !== intent.origin.cardId;
}

export function validTargetMark(value: unknown, state: MatchState, temporarilyRevealedHands: ReadonlySet<string> = new Set()): value is TargetMark {
  if (!validTargetIntent(value, state, temporarilyRevealedHands)) return false;
  const mark = value as TargetMark;
  return typeof mark.uid === 'string' && mark.uid.length > 0 && isTableSeat(mark.seatId) && Number.isFinite(mark.at);
}
