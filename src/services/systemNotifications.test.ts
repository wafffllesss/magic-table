import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchState } from '../domain/game';
import type { RoomSnapshot } from './firebaseRoom';
import { RoomNotificationTracker, showSystemNotification } from './systemNotifications';

const base = (): RoomSnapshot => ({ roomId: 'room', selfUid: 'self', selfSeatId: 'southWest', connectionState: 'connected', membersReady: true, online: true, seats: {}, queue: [] });
const spectator = (online = true) => ({ uid: 'guest', name: 'Guest', requestedAt: 1, position: 1, online });
const match = (changes: Partial<MatchState> = {}): MatchState => ({ id: 'match', phase: 'mulligan', turn: 1, activeSeatId: 'southWest', paused: false, stack: [], passes: [], seats: [{ id: 'southWest', status: 'playing' }, { id: 'northWest', status: 'playing' }], ...changes } as MatchState);

describe('room notifications', () => {
  it('tracks participants by identity, including spectators and moves between seats', () => {
    const tracker = new RoomNotificationTracker(); const room = base();
    room.queue = [spectator()]; expect(tracker.update(room)).toEqual([]);
    room.queue = [spectator(false)]; expect(tracker.update(room)).toEqual([{ type: 'disconnected', name: 'Guest' }]);
    room.queue = [spectator()]; expect(tracker.update(room)).toEqual([{ type: 'reconnected', name: 'Guest' }]);
    room.queue = []; room.seats.northWest = { uid: 'guest', name: 'Guest', online: true, joinedAt: 1 };
    expect(tracker.update(room)).toEqual([]);
    room.queue = [{ ...spectator(), uid: 'new', name: 'New' }]; expect(tracker.update(room)).toEqual([{ type: 'joined', name: 'New' }]);
    expect(tracker.update(room)).toEqual([]);
    expect(tracker.update({ ...room, roomId: 'another' })).toEqual([]);
  });
  it('announces new matches, turns and priority transitions once', () => {
    const tracker = new RoomNotificationTracker(); const room = base(); tracker.update(room);
    room.state = match(); expect(tracker.update(room)).toEqual([{ type: 'started' }]);
    room.state = match({ phase: 'playing' }); expect(tracker.update(room)).toEqual([{ type: 'turn' }]);
    room.state = match({ phase: 'playing', stack: [{}] as MatchState['stack'] }); expect(tracker.update(room)).toEqual([{ type: 'priority' }]);
    expect(tracker.update(room)).toEqual([]);
    room.state = match({ phase: 'playing', stack: [{}] as MatchState['stack'], passes: ['southWest'] }); expect(tracker.update(room)).toEqual([]);
    room.state = match({ phase: 'playing', stack: [{}] as MatchState['stack'] }); expect(tracker.update(room)).toEqual([{ type: 'priority' }]);
    room.state = match({ phase: 'playing', activeSeatId: 'northWest' }); tracker.update(room);
    room.state = match({ phase: 'playing', activeSeatId: 'southWest', turn: 2 }); expect(tracker.update(room)).toEqual([{ type: 'turn' }]);
    room.state = match({ id: 'next' }); expect(tracker.update(room)).toEqual([{ type: 'started' }]);
  });
  it('does not replay initial state or changes while reconnecting', () => {
    const tracker = new RoomNotificationTracker(); const room = base(); room.state = match({ phase: 'playing' });
    expect(tracker.update(room)).toEqual([]);
    room.connectionState = 'reconnecting'; room.online = false; room.queue = [spectator()]; tracker.update(room);
    room.online = true; room.connectionState = 'connected'; expect(tracker.update(room)).toEqual([]);
    room.connectionState = 'reconnecting'; room.queue = [spectator(false)]; expect(tracker.update(room)).toEqual([{ type: 'disconnected', name: 'Guest' }]);
    room.queue = [spectator()]; expect(tracker.update(room)).toEqual([{ type: 'reconnected', name: 'Guest' }]);
  });
});

afterEach(() => vi.unstubAllGlobals());
describe('notification delivery', () => {
  it('requires browser permission and a background tab, and focuses on click', () => {
    const focus = vi.fn(); const close = vi.fn(); const instances: Array<{ onclick?: () => void; close: typeof close }> = [];
    class MockNotification { static permission = 'granted'; onclick?: () => void; close = close; constructor(_title: string, _options: unknown) { instances.push(this); } }
    const doc = { visibilityState: 'visible', hasFocus: () => true };
    vi.stubGlobal('window', { Notification: MockNotification, focus }); vi.stubGlobal('Notification', MockNotification); vi.stubGlobal('document', doc);
    showSystemNotification('Title', 'Body'); expect(instances).toHaveLength(0);
    doc.hasFocus = () => false; showSystemNotification('Title', 'Body'); expect(instances).toHaveLength(1);
    instances[0].onclick?.(); expect(focus).toHaveBeenCalled(); expect(close).toHaveBeenCalled();
    MockNotification.permission = 'denied'; showSystemNotification('Title', 'Body'); expect(instances).toHaveLength(1);
    vi.stubGlobal('window', {}); expect(() => showSystemNotification('Title', 'Body')).not.toThrow();
  });
  it('delegates desktop focus checks to the native process', () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { meuMagicDesktop: { showNotification } });
    showSystemNotification('Title', 'Body'); expect(showNotification).toHaveBeenCalledWith('Title', 'Body');
  });
});
