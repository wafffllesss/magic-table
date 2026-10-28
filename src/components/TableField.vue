<script setup lang="ts">
import { computed } from 'vue';
import type { CardInstance } from '../domain/game';
import { clampCardPosition } from '../domain/tableView';
import CardPose from './CardPose.vue';
import { useAppI18n } from '../i18n';

const props = defineProps<{ cards: CardInstance[]; seatId: string; selectedId: string; arrivingId?: string; dragId?: string; dragMoved?: boolean; reducedMotion: boolean; canAdjustCounters: boolean; spectator?: boolean }>();
const { t } = useAppI18n();
const emit = defineEmits<{
  (event: 'drag', pointer: PointerEvent, id: string): void;
  (event: 'select', id: string, pointer?: MouseEvent): void;
  (event: 'activate', id: string): void;
  (event: 'tap', id: string): void;
  (event: 'counter', id: string, amount: number): void;
}>();
const cardLayers = computed(() => new Map(
  props.cards.map((card, index) => ({ card, index, y: clampCardPosition(card.x, card.y, card.tapped).y }))
    .sort((a, b) => a.y - b.y || a.index - b.index)
    .map(({ card }, index) => [card.id, index + 1]),
));
function position(card: CardInstance): Record<string, string | number> {
  const point = clampCardPosition(card.x, card.y, card.tapped);
  return { left: point.x + '%', top: point.y + '%', zIndex: cardLayers.value.get(card.id) ?? 1 };
}
function plusCounters(card: CardInstance): number { return card.counters['+1/+1'] ?? 0; }
function auxiliaryClick(event: MouseEvent, id: string): void {
  if (event.button !== 1) return;
  event.preventDefault();
  emit('tap', id);
}
function pointerDown(event: PointerEvent, id: string): void {
  if (event.button === 1) event.preventDefault();
  emit('drag', event, id);
}
function activateCard(event: MouseEvent, id: string): void {
  if (event.target instanceof Element && event.target.closest('.card-counter-controls')) return;
  emit('activate', id);
}
</script>

<template>
  <div class="battlefield-cards" data-drop-zone="battlefield" :data-seat="seatId">
    <div v-for="card in cards" :key="card.id" class="board-card-wrap" role="group" tabindex="0"
      :aria-label="card.card?.name ?? 'Carta virada para baixo'" :data-menu-card="card.id" :data-card-id="card.id"
      :style="position(card)" :class="{ 'is-picked': selectedId === card.id, 'is-arriving': arrivingId === card.id, 'is-dragging-source': dragId === card.id && dragMoved }"
      @pointerdown.stop="pointerDown($event, card.id)" @click.stop="emit('select', card.id, $event)"
      @auxclick.stop="auxiliaryClick($event, card.id)"
      @dblclick.stop.prevent="activateCard($event, card.id)" @keydown.enter.prevent="emit('select', card.id)"
      @keydown.space.prevent="emit('select', card.id)">
      <CardPose :card="card" :reduced-motion="reducedMotion">
        <div v-if="plusCounters(card) > 0" class="card-counter-controls" @pointerdown.stop @click.stop @dblclick.stop.prevent>
          <button v-if="card.controllerId === seatId && !spectator" type="button" :aria-label="t('table.decreaseCounter', { card: card.card?.name ?? t('table.handCard') })" :disabled="plusCounters(card) === 0 || !canAdjustCounters" @click="emit('counter', card.id, -1)">−</button>
          <output :aria-label="t('table.counterCount', { count: plusCounters(card) })">+{{ plusCounters(card) }}/+{{ plusCounters(card) }}</output>
          <button v-if="card.controllerId === seatId && !spectator" type="button" :aria-label="t('table.increaseCounter', { card: card.card?.name ?? t('table.handCard') })" :disabled="!canAdjustCounters" @click="emit('counter', card.id, 1)">+</button>
        </div>
      </CardPose>
      <span v-if="Object.entries(card.counters).some(([name, value]) => name !== '+1/+1' && value > 0)" class="counter-badge">{{ Object.entries(card.counters).filter(([name]) => name !== '+1/+1').reduce((sum, [, value]) => sum + value, 0) }}</span>
    </div>
  </div>
</template>

<style scoped>
.board-card-wrap { pointer-events: none; }
.board-card-wrap > .card-pose, .board-card-wrap > .counter-badge { pointer-events: auto; }
.card-counter-controls {
  position: absolute;
  z-index: 12;
  left: 50%;
  bottom: -20px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 19px;
  padding: 2px;
  border: 1px solid rgba(202, 229, 176, .38);
  border-radius: 7px;
  background: rgba(11, 20, 13, .96);
  box-shadow: 0 2px 7px rgba(0, 0, 0, .55);
  white-space: nowrap;
}
.card-counter-controls button {
  width: 20px;
  height: 20px;
  flex: none;
  padding: 0;
  border: 1px solid rgba(205, 226, 193, .2);
  border-radius: 4px;
  background: rgba(184, 230, 119, .1);
  color: #d6efb8;
  font: 600 14px/1 var(--mono);
  cursor: pointer;
  touch-action: manipulation;
}
.card-counter-controls button:hover:not(:disabled) { border-color: var(--lime); background: rgba(184, 230, 119, .2); }
.card-counter-controls output { min-width: 35px; color: #e1f1cf; text-align: center; font: 600 8px var(--mono); }
.card-counter-controls button:disabled { opacity: .42; }
@media (max-width: 550px) {
  .card-counter-controls { bottom: -19px; gap: 2px; }
  .card-counter-controls button { width: 22px; height: 22px; }
  .card-counter-controls output { min-width: 36px; font-size: 8px; }
}
</style>
