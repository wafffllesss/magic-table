import { describe, expect, it } from 'vitest';
import { newMatch, publicProjection } from '../domain/game';
import { fixtureDecks } from '../../tests/fixtures/scryfall';
import { firebaseConnectionError, firebaseValue, publicGameUpdate, restorePublicMatch } from './firebaseState';
import { FirebaseRoom } from './firebaseRoom';

describe('Firebase configuration and wire data', () => {
  it('recognizes the required configuration and reports missing values', () => {
    expect(new FirebaseRoom({}).missingConfig).toContain('databaseURL');
    expect(new FirebaseRoom({ VITE_FIREBASE_API_KEY: 'key', VITE_FIREBASE_AUTH_DOMAIN: 'project.firebaseapp.com', VITE_FIREBASE_DATABASE_URL: 'https://project.firebaseio.com', VITE_FIREBASE_PROJECT_ID: 'project', VITE_FIREBASE_APP_ID: 'app' }).isConfigured).toBe(true);
  });
  it('omits undefined fields while retaining null deletions and server timestamps', () => {
    expect(firebaseValue({ card: { name: 'Card', card_faces: undefined }, deleted: null, at: { '.sv': 'timestamp' } })).toEqual({ card: { name: 'Card' }, deleted: null, at: { '.sv': 'timestamp' } });
  });
  it('restores data omitted by RTDB without leaking hands into the public state', () => {
    const decks = fixtureDecks();
    const ids = ['northWest', 'northEast', 'southEast', 'southWest'];
    const state = newMatch(decks.map((deck, index) => ({ deck, seatId: ids[index], name: `Player ${index}` })));
    const publicState = publicProjection(state);
    const wire = JSON.parse(JSON.stringify(publicState, (_key, value) => Array.isArray(value) && !value.length || value && typeof value === 'object' && !Object.keys(value).length ? undefined : value));
    const restored = restorePublicMatch(wire);
    expect(restored.stack).toEqual([]); expect(restored.passes).toEqual([]);
    expect(restored.seats[0].hand).toEqual([]); expect(restored.seats[0].library).toEqual([]);
    expect(restored.seats[0].commanderCasts).toEqual({});
    expect(publicGameUpdate(restored).hiddenZones.northWest.hand).toBe(7);
    expect(Object.values(restored.cards).every(card => card.counters && card.card?.color_identity && card.card?.keywords)).toBe(true);
    restored.seats[0].hand = state.seats[0].hand;
    restored.seats[0].library = state.seats[0].library;
    const next = publicGameUpdate(restored, 'northWest');
    expect(next.hiddenZones.northEast.hand).toBe(7);
    expect(next.hiddenZones.northEast.library).toBe(state.seats[1].library.length);
    expect('hand' in next.seats[0]).toBe(false);
  });
  it('explains missing anonymous authentication and denied database access', () => {
    expect(firebaseConnectionError({ code: 'auth/configuration-not-found' }).message).toContain('Anônimo');
    expect(firebaseConnectionError({ code: 'PERMISSION_DENIED' }).message).toContain('regras');
  });
});
