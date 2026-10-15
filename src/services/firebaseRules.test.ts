import { createConnection } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, ref, set } from 'firebase/database';
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
      projectId: 'mana-table-demo',
      database: { host: emulator!.host, port: emulator!.port, rules: JSON.stringify(configuration) },
    });
  });
  afterAll(async () => { await testEnvironment?.cleanup(); });

  it('keeps hands, libraries, and deck snapshots private to the current seat occupant', async () => {
    await testEnvironment.clearDatabase();
    const privateData = { deck: { id: 'secret-deck' }, game: { matchId: 'm1', seatId: 'northWest', hand: ['secret-card'], library: ['ordered-card'], mana: { W: 1 }, commanderCasts: { leader: 1 }, mulligans: 0, keptHand: true, privateCards: { 'secret-card': { id: 'secret-card' } } } };
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
});
