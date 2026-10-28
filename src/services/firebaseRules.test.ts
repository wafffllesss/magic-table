import { createConnection } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, ref, remove, runTransaction, set, update } from 'firebase/database';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

async function findEmulator(): Promise<{ host: string; port: number } | undefined> {
  const configured = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  const [configuredHost, configuredPort] = configured?.split(':') ?? [];
  const candidates = configuredHost ? [{ host: configuredHost, port: Number(configuredPort) || 9000 }] : [{ host: '127.0.0.1', port: 9000 }];
  for (const candidate of candidates) {
    const available = await new Promise<boolean>(resolve => {
      const socket = createConnection(candidate);
      const timeout = setTimeout(() => { socket.destroy(); resolve(false); }, 350);
      socket.once('connect', () => { clearTimeout(timeout); socket.destroy(); resolve(true); });
      socket.once('error', () => { clearTimeout(timeout); resolve(false); });
    });
    if (available) return candidate;
  }
}

const emulator = await findEmulator();
const configuration = JSON.parse(readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8')) as { rules: object };
let testEnvironment: RulesTestEnvironment;

describe.skipIf(!emulator)('Realtime Database security rules', () => {
  beforeAll(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId: 'demo-magic-table',
      database: { host: emulator!.host, port: emulator!.port, rules: JSON.stringify(configuration) },
    });
  });
  afterAll(async () => { await testEnvironment?.cleanup(); });

  it('keeps hands, libraries, and deck snapshots private to the current seat occupant', async () => {
    await testEnvironment.clearDatabase();
    const privateData = { deck: { id: 'secret-deck' }, game: { matchId: 'm1', seatId: 'northWest', hand: ['secret-card'], library: ['ordered-card'], commanderCasts: { leader: 1 }, mulligans: 0, keptHand: true, privateCards: { 'secret-card': { id: 'secret-card' } } } };
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.database();
      await set(ref(database, 'rooms/main/lobby/seats/northWest'), { uid: 'player-a', name: 'Alice', seatId: 'northWest', ready: true });
      await set(ref(database, 'rooms/main/privateSeats/northWest'), privateData);
      await set(ref(database, 'rooms/main/game/public'), { id: 'm1', revision: 2, phase: 'playing', paused: false, seats: {}, cards: {}, stack: [], log: [], lastAction: { id: 'start', actorUid: 'player-a', actorSeatId: 'northWest', type: 'START_MATCH' } });
    });
    const alice = testEnvironment.authenticatedContext('player-a').database();
    const spectator = testEnvironment.authenticatedContext('player-b').database();
    expect((await assertSucceeds(get(ref(alice, 'rooms/main/privateSeats/northWest')))).val()).toEqual(privateData);
    await assertFails(get(ref(spectator, 'rooms/main/privateSeats/northWest')));
    await assertFails(set(ref(spectator, 'rooms/main/privateSeats/northWest/game'), privateData.game));
    await assertSucceeds(get(ref(spectator, 'rooms/main/game/public')));

    await testEnvironment.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), 'rooms/main/lobby/seats/northWest/uid'), 'player-b');
    });
    expect((await assertSucceeds(get(ref(spectator, 'rooms/main/privateSeats/northWest')))).val()).toEqual(privateData);
    await assertFails(get(ref(alice, 'rooms/main/privateSeats/northWest')));
  });

  it('publishes only bounded public hand poses from the current seat owner', async () => {
    await testEnvironment.clearDatabase();
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.database();
      await set(ref(database, 'rooms/main/lobby/seats/northWest'), { uid: 'player-a', name: 'Alice' });
      await set(ref(database, 'rooms/main/game/public'), { id: 'm1', revision: 2, phase: 'playing', seats: {}, cards: { publicCard: { zone: 'battlefield', faceDown: false }, privateCard: { zone: 'hand' } }, lastAction: {} });
    });
    const alice = testEnvironment.authenticatedContext('player-a').database();
    const guest = testEnvironment.authenticatedContext('player-b').database();
    const valid = { uid: 'player-a', sessionId: 'session-a', matchId: 'm1', seatId: 'northWest', sequence: 1, zone: 'table', pose: 'point', x: 1200, y: 800, gestureId: 'gesture-a', updatedAt: Date.now() };
    await assertSucceeds(set(ref(alice, 'rooms/main/tablePresence/player-a/session-a'), valid));
    await assertSucceeds(set(ref(alice, 'rooms/main/tablePresence/player-a/session-a'), { ...valid, zone: 'private', pose: 'grab', sequence: 2, x: null, y: null }));
    await assertSucceeds(set(ref(alice, 'rooms/main/tablePresence/player-a/session-a'), { ...valid, pose: 'grab', sequence: 3, cardId: 'publicCard' }));
    await assertSucceeds(get(ref(guest, 'rooms/main/tablePresence/player-a')));
    await assertFails(set(ref(guest, 'rooms/main/tablePresence/player-a/other'), valid));
    await assertFails(set(ref(alice, 'rooms/main/tablePresence/player-a/session-b'), valid));
    await assertFails(set(ref(alice, 'rooms/main/tablePresence/player-a/session-a'), { ...valid, sequence: 3, x: 2500 }));
    await assertFails(set(ref(alice, 'rooms/main/tablePresence/player-a/session-a'), { ...valid, sequence: 3, cardId: 'privateCard' }));
    await assertFails(set(ref(alice, 'rooms/main/tablePresence/player-a/session-a'), { ...valid, sequence: 3, cardId: 'notInThePublicGame' }));
    await assertFails(set(ref(alice, 'rooms/main/tablePresence/player-a/session-a'), { ...valid, sequence: 3, unexpected: true }));
  });

  it('allows one expected public revision and rejects a second write based on the stale revision', async () => {
    await testEnvironment.clearDatabase();
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.database();
      await set(ref(database, 'rooms/main/lobby/seats/northWest'), { uid: 'player-a', name: 'Alice', seatId: 'northWest' });
      await set(ref(database, 'rooms/main/game/public'), { id: 'm1', revision: 2, phase: 'playing', paused: false, seats: { northWest: { id: 'northWest' } }, cards: { c1: { id: 'c1' } }, stack: [], lastAction: { id: 'start', actorUid: 'player-a', actorSeatId: 'northWest', type: 'START_MATCH' } });
    });
    const alice = testEnvironment.authenticatedContext('player-a').database();
    const committed = { id: 'm1', revision: 3, phase: 'playing', paused: false, seats: { northWest: { id: 'northWest' } }, cards: { c1: { id: 'c1' } }, stack: [], lastAction: { id: 'action-1', actorUid: 'player-a', actorSeatId: 'northWest', type: 'DRAW' } };
    await assertSucceeds(set(ref(alice, 'rooms/main/game/public'), committed));
    await assertFails(set(ref(alice, 'rooms/main/game/public'), committed));
  });

  it('lets only the occupant select a catalog playmat', async () => {
    await testEnvironment.clearDatabase();
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.database();
      await set(ref(database, 'rooms/main/lobby/seats/northWest'), { uid: 'player-a', name: 'Alice', seatId: 'northWest', playmatId: 'orzhov' });
      await set(ref(database, 'rooms/main/lobby/coordinator'), { uid: 'player-c', leaseUntil: Date.now() + 60000 });
    });
    const path = 'rooms/main/lobby/seats/northWest/playmatId';
    const alice = testEnvironment.authenticatedContext('player-a').database();
    const bob = testEnvironment.authenticatedContext('player-b').database();
    const coordinator = testEnvironment.authenticatedContext('player-c').database();
    await assertSucceeds(set(ref(alice, path), 'azorius'));
    await assertSucceeds(set(ref(alice, path), 'color:#aabbcc'));
    await assertSucceeds(set(ref(alice, path), 'image:https://example.com/art.jpg'));
    await assertFails(set(ref(alice, path), 'image:javascript:alert(1)'));
    await assertFails(set(ref(alice, path), 'unlisted-wallpaper'));
    await assertFails(set(ref(bob, path), 'dimir'));
    await assertFails(set(ref(coordinator, path), 'izzet'));
    await assertSucceeds(set(ref(alice, path), null));
  });

  it('isolates P2P room membership and restricts signaling to the current host', async () => {
    await testEnvironment.clearDatabase();
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.database();
      await set(ref(database, 'p2pRooms/room-12345678/meta'), { hostUid: 'host', generation: 3, name: 'Mesa' });
      await set(ref(database, 'p2pRooms/room-12345678/members'), { host: { uid: 'host' }, guest: { uid: 'guest' } });
    });
    const host = testEnvironment.authenticatedContext('host').database();
    const guest = testEnvironment.authenticatedContext('guest').database();
    const outsider = testEnvironment.authenticatedContext('outsider').database();
    const metaPath = 'p2pRooms/room-12345678/meta';
    await assertSucceeds(get(ref(host, metaPath)));
    await assertSucceeds(get(ref(guest, metaPath)));
    await assertSucceeds(get(ref(outsider, metaPath)));
    await assertFails(set(ref(guest, 'p2pRooms/room-12345678/members/guest/name'), 'Changed'));
    await assertFails(set(ref(guest, 'p2pRooms/room-12345678/members/host/name'), 'Changed'));
    await assertSucceeds(set(ref(guest, 'p2pRooms/room-12345678/presence/guest/session-a'), { online: true }));
    await assertSucceeds(get(ref(host, 'p2pRooms/room-12345678/presence')));
    await assertFails(get(ref(outsider, 'p2pRooms/room-12345678/presence')));
    const signal = { roomId: 'room-12345678', senderUid: 'guest', targetUid: 'host', generation: 3, linkId: '12345678-1234-1234-1234-123456789abc', sentAt: Date.now(), description: { type: 'offer', sdp: 'candidate data' } };
    await assertSucceeds(set(ref(guest, 'p2pSignals/room-12345678/host/signal-a'), signal));
    await assertFails(set(ref(guest, 'p2pSignals/room-12345678/guest/signal-b'), { ...signal, targetUid: 'guest' }));
    const relayPacket = { roomId: 'room-12345678', generation: 3, linkId: signal.linkId, senderUid: 'guest', targetUid: 'host', sequence: 0, packet: '{"kind":"packet"}', sentAt: Date.now() };
    await assertSucceeds(set(ref(guest, `p2pRelay/room-12345678/3/host/guest/${signal.linkId}/000000000000`), relayPacket));
    await assertSucceeds(get(ref(host, `p2pRelay/room-12345678/3/host/guest/${signal.linkId}`)));
    await assertSucceeds(remove(ref(host, `p2pRelay/room-12345678/3/host/guest/${signal.linkId}/000000000000`)));
    await assertFails(get(ref(outsider, `p2pRelay/room-12345678/3/host/guest/${signal.linkId}`)));
    await assertFails(set(ref(guest, `p2pRelay/room-12345678/2/host/guest/${signal.linkId}/000000000000`), { ...relayPacket, generation: 2 }));
    await assertFails(set(ref(guest, `p2pRelay/room-12345678/3/outsider/guest/${signal.linkId}/000000000000`), { ...relayPacket, targetUid: 'outsider' }));
    await assertSucceeds(set(ref(guest, `p2pRelayPresence/room-12345678/3/host/guest/${signal.linkId}`), {
      roomId: 'room-12345678', generation: 3, linkId: signal.linkId, senderUid: 'guest', targetUid: 'host',
      payload: { uid: 'guest', sessionId: 'session', matchId: 'match', seatId: 'northWest', sequence: 1, zone: 'table', pose: 'rest', updatedAt: Date.now() }, sentAt: Date.now(),
    }));
    await assertFails(set(ref(guest, 'p2pRoomSecrets/room-12345678'), { hash: 'private' }));
  });

  it('creates a room and admits participants through bounded member and seat claims', async () => {
    await testEnvironment.clearDatabase();
    const host = testEnvironment.authenticatedContext('player-a').database();
    const guest = testEnvironment.authenticatedContext('player-b').database();
    const roomId = 'ABCDEFGH234';
    const now = Date.now();
    await assertSucceeds(set(ref(host, `p2pRooms/${roomId}`), { meta: {
      id: roomId, code: roomId, name: 'Mesa teste', createdAt: now, generation: 1,
      hostUid: 'player-a', hostLeaseUntil: now + 45_000, nextQueueAt: now,
      hasPassword: false, phase: 'lobby', closed: false,
    } }));
    await assertSucceeds(runTransaction(ref(host, `p2pRooms/${roomId}/memberClaims/1`), current => current ?? 'player-a'));
    await assertSucceeds(runTransaction(ref(host, `p2pRooms/${roomId}/seatClaims/northWest`), current => current ?? 'player-a'));
    await assertSucceeds(runTransaction(ref(host, `p2pRooms/${roomId}/members/player-a`), current => current ?? {
      uid: 'player-a', name: 'Alice', role: 'player', seatId: 'northWest', memberSlot: 1, joinedAt: now, ready: false,
    }));

    await assertSucceeds(runTransaction(ref(guest, `p2pRooms/${roomId}/memberClaims/2`), current => current ?? 'player-b'));
    await assertSucceeds(runTransaction(ref(guest, `p2pRooms/${roomId}/seatClaims/northEast`), current => current ?? 'player-b'));
    await assertSucceeds(runTransaction(ref(guest, `p2pRooms/${roomId}/members/player-b`), current => current ?? {
      uid: 'player-b', name: 'Bia', role: 'player', seatId: 'northEast', memberSlot: 2, joinedAt: now + 1, ready: false,
    }));
    await assertSucceeds(update(ref(guest, `p2pRooms/${roomId}/members/player-b`), { ready: true }));
    await assertFails(set(ref(guest, `p2pRooms/${roomId}/members/player-a/name`), 'Intruso'));
    await assertFails(set(ref(guest, `p2pRooms/${roomId}/seatClaims/southEast`), 'player-b'));
    for (let slot = 3; slot <= 12; slot++) {
      const uid = `player-${slot}`;
      const participant = testEnvironment.authenticatedContext(uid).database();
      const seat = slot === 3 ? 'southEast' : slot === 4 ? 'southWest' : null;
      await assertSucceeds(runTransaction(ref(participant, `p2pRooms/${roomId}/memberClaims/${slot}`), current => current ?? uid));
      if (seat) await assertSucceeds(runTransaction(ref(participant, `p2pRooms/${roomId}/seatClaims/${seat}`), current => current ?? uid));
      await assertSucceeds(runTransaction(ref(participant, `p2pRooms/${roomId}/members/${uid}`), current => current ?? {
        uid, name: `P${slot}`, role: seat ? 'player' : 'spectator', ...(seat ? { seatId: seat } : {}), memberSlot: slot, joinedAt: now + slot, ready: false,
      }));
    }
    expect(Object.keys((await get(ref(host, `p2pRooms/${roomId}/members`))).val()).length).toBe(12);
    const overflow = testEnvironment.authenticatedContext('player-13').database();
    await assertFails(runTransaction(ref(overflow, `p2pRooms/${roomId}/memberClaims/13`), current => current ?? 'player-13'));
  });
});
