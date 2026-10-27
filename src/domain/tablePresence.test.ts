import { describe, expect, it } from 'vitest';
import { handPresenceStale, shouldPublishHand, type HandPresence, type HandPresenceInput } from './tablePresence';

const presence = (overrides: Partial<HandPresence> = {}): HandPresence => ({ uid: 'uid', sessionId: 'session', matchId: 'match', seatId: 'northWest', sequence: 1, zone: 'table', pose: 'follow', x: 300, y: 500, updatedAt: 1000, ...overrides });
const input = (overrides: Partial<HandPresenceInput> = {}): HandPresenceInput => ({ matchId: 'match', seatId: 'northWest', sequence: 1, zone: 'table', pose: 'follow', x: 300, y: 500, ...overrides });

describe('table hand presence', () => {
  it('expires moving and private-hand poses after five seconds but preserves a resting hand', () => {
    expect(handPresenceStale(presence(), 6001)).toBe(true);
    expect(handPresenceStale(presence({ pose: 'grab', zone: 'private' }), 6001)).toBe(true);
    expect(handPresenceStale(presence({ pose: 'rest' }), 6001)).toBe(false);
  });

  it('publishes pose and click changes immediately and throttles cursor-only changes to 20Hz', () => {
    const previous = input();
    expect(shouldPublishHand(undefined, previous, 0)).toBe(true);
    expect(shouldPublishHand(previous, input({ x: 310 }), 25)).toBe(false);
    expect(shouldPublishHand(previous, input({ x: 310 }), 50)).toBe(true);
    expect(shouldPublishHand(previous, input({ pose: 'grab', zone: 'private' }), 5)).toBe(true);
    expect(shouldPublishHand(previous, input({ gestureId: 'tap-2' }), 5)).toBe(true);
  });
});
