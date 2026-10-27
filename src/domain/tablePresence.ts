import type { TableSeatId } from '../services/firebaseRoom';

export type HandPose = 'rest' | 'follow' | 'point' | 'grab';
export type HandZone = 'table' | 'private';
export type HandPresence = {
  uid: string;
  sessionId: string;
  matchId: string;
  seatId: TableSeatId;
  sequence: number;
  zone: HandZone;
  pose: HandPose;
  x?: number;
  y?: number;
  gestureId?: string;
  cardId?: string;
  cardBack?: boolean;
  updatedAt: number;
};
export type HandPresenceInput = Omit<HandPresence, 'uid' | 'sessionId' | 'updatedAt'>;

export function isHandPose(value: unknown): value is HandPose {
  return value === 'rest' || value === 'follow' || value === 'point' || value === 'grab';
}

export function isTableSeat(value: unknown): value is TableSeatId {
  return value === 'northWest' || value === 'northEast' || value === 'southEast' || value === 'southWest';
}

export function handPresenceStale(presence: HandPresence, now = Date.now(), timeout = 5000): boolean {
  return presence.pose !== 'rest' && now - presence.updatedAt > timeout;
}

export function shouldPublishHand(previous: HandPresenceInput | undefined, next: HandPresenceInput, elapsed: number): boolean {
  return !previous || previous.pose !== next.pose || previous.zone !== next.zone || previous.gestureId !== next.gestureId || previous.cardId !== next.cardId || elapsed >= 50;
}
