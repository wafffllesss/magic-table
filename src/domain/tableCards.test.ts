import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { startDemoMatch, addStressObjects } from '../services/demo';
import { fixtureDecks } from '../../tests/fixtures/scryfall';
import { applyAction } from './game';
import { indexTableCards } from './tableCards';

describe('table card index', () => {
  it('groups controlled and owned zones and follows transfers without exposing hidden cards', () => {
    let state = addStressObjects(startDemoMatch('Lia', fixtureDecks()), 200);
    const own = Object.values(state.cards).find(card => card.zone === 'battlefield' && card.controllerId === 'southWest')!;
    state = applyAction(state, 'southWest', { type: 'TRANSFER_CONTROL', cardId: own.id, seatId: 'northEast' });
    let index = indexTableCards(state);
    expect(index.zones.get('northEast')!.battlefield.some(card => card.id === own.id)).toBe(true);
    expect(index.zones.get('southWest')!.battlefield.some(card => card.id === own.id)).toBe(false);
    state = applyAction(state, 'northEast', { type: 'MOVE_CARD', cardId: own.id, zone: 'graveyard' });
    index = indexTableCards(state);
    expect(index.zones.get('southWest')!.graveyard.some(card => card.id === own.id)).toBe(true);
    expect([...index.zones.values()].flatMap(zones => Object.values(zones).flat()).every(card => !['hand', 'library'].includes(card.zone))).toBe(true);
  });

  it('does not rebuild for camera-only changes, but rebuilds when cards change', () => {
    const state = ref(startDemoMatch('Lia', fixtureDecks()));
    const camera = ref(0), build = vi.fn(indexTableCards);
    const index = computed(() => build(state.value));
    const view = computed(() => ({ index: index.value, camera: camera.value }));
    for (let i = 0; i < 40; i++) { camera.value = i; void view.value; }
    expect(build).toHaveBeenCalledTimes(1);
    const card = Object.values(state.value.cards).find(card => card.zone === 'battlefield')!;
    card.zone = 'exile';
    expect(view.value.index.zones.get(card.ownerId)!.exile.some(item => item.id === card.id)).toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
