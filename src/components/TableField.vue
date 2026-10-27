<script setup lang="ts">
import type { CardInstance } from '../domain/game';
import { clampCardPosition } from '../domain/tableView';
import CardPose from './CardPose.vue';

defineProps<{ cards: CardInstance[]; seatId: string; selectedId: string; arrivingId?: string; dragId?: string; dragMoved?: boolean; reducedMotion: boolean }>();
const emit = defineEmits<{
  (event: 'drag', pointer: PointerEvent, id: string): void;
  (event: 'select', id: string, pointer?: MouseEvent): void;
  (event: 'activate', id: string): void;
  (event: 'tap', id: string): void;
}>();
function position(card: CardInstance): Record<string, string> {
  const point = clampCardPosition(card.x, card.y, card.tapped);
  return { left: point.x + '%', top: point.y + '%' };
}
function counters(card: CardInstance): number { return Object.values(card.counters).reduce((sum, value) => sum + value, 0); }
function auxiliaryClick(event: MouseEvent, id: string): void {
  if (event.button !== 1) return;
  event.preventDefault();
  emit('tap', id);
}
function pointerDown(event: PointerEvent, id: string): void {
  if (event.button === 1) event.preventDefault();
  emit('drag', event, id);
}
</script>

<template>
  <div class="battlefield-cards" data-drop-zone="battlefield" :data-seat="seatId">
    <div v-for="card in cards" :key="card.id" class="board-card-wrap" role="button" tabindex="0"
      :aria-label="card.card?.name ?? 'Carta virada para baixo'" :data-menu-card="card.id" :data-card-id="card.id"
      :style="position(card)" :class="{ 'is-picked': selectedId === card.id, 'is-arriving': arrivingId === card.id, 'is-dragging-source': dragId === card.id && dragMoved }"
      @pointerdown.stop="pointerDown($event, card.id)" @click.stop="emit('select', card.id, $event)"
      @auxclick.stop="auxiliaryClick($event, card.id)"
      @dblclick.stop.prevent="emit('activate', card.id)" @keydown.enter.prevent="emit('select', card.id)"
      @keydown.space.prevent="emit('select', card.id)">
      <CardPose :card="card" :reduced-motion="reducedMotion" />
      <span v-if="Object.values(card.counters).some(value => value > 0)" class="counter-badge">{{ counters(card) }}</span>
    </div>
  </div>
</template>
