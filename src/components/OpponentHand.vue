<script setup lang="ts">
import { computed } from 'vue';
import { useAppI18n } from '../i18n';
import { CARD_SIZE } from '../domain/tableView';

const props = defineProps<{ count: number; playerName: string }>();
const { t } = useAppI18n();
const quantity = computed(() => Math.max(0, Math.floor(props.count)));
const cards = computed(() => Array.from({ length: quantity.value }, (_, index) => {
  const offset = index - (quantity.value - 1) / 2;
  const gaps = Math.max(1, quantity.value - 1);
  return {
    transform: `translateX(${offset * Math.min(18, 120 / gaps)}px) rotate(${offset * Math.min(10, 60 / gaps)}deg) translateZ(${index * .05}px)`,
  };
}));
</script>

<template>
  <div class="opponent-hand" :class="{ 'is-empty': !quantity }" role="img" :aria-label="t('table.opponentHand', { name: playerName, count: quantity })" :style="{ '--held-card-width': `${CARD_SIZE.width}px`, '--held-card-height': `${CARD_SIZE.height}px` }">
    <div v-if="quantity" class="opponent-hand-cards" aria-hidden="true">
      <div class="opponent-hand-fan">
        <span v-for="(style, index) in cards" :key="index" class="opponent-hand-card" :style="style">
          <span class="card-tile-back"><i>✳</i><small>M / T</small></span>
        </span>
      </div>
    </div>
    <span class="opponent-hand-count" aria-hidden="true">{{ quantity }} {{ t('table.inHand') }}</span>
  </div>
</template>

<style scoped>
.opponent-hand {
  position: absolute;
  left: 50%;
  top: calc(100% + 40px);
  width: 260px;
  height: var(--held-card-height);
  transform: translateX(-50%);
  transform-style: preserve-3d;
  pointer-events: none;
  user-select: none;
}

.opponent-hand-cards {
  position: absolute;
  inset: 0;
  /* Face the centre of the table and keep the lowest card edge above it. */
  transform: translateZ(110px) rotateX(55deg);
  transform-origin: center bottom;
  transform-style: preserve-3d;
}

.opponent-hand-card {
  position: absolute;
  left: calc(50% - var(--held-card-width) / 2);
  top: 0;
  width: var(--held-card-width);
  height: var(--held-card-height);
  transform-origin: center bottom;
  border: 2px solid #607354;
  border-radius: 6px;
  background: #18251a;
  box-shadow: 0 2px 5px #0008;
  overflow: hidden;
}

.opponent-hand-fan {
  position: absolute;
  inset: 0;
  transform: rotate(180deg);
  transform-style: preserve-3d;
}

.opponent-hand-count {
  position: absolute;
  left: calc(100% + 10px);
  top: 0;
  padding: 8px 12px;
  border: 1px solid #a6cc8b28;
  border-radius: 4px;
  background: #0a140fee;
  color: #c2d4b5;
  font: 600 24px var(--mono);
  transform: rotate(180deg);
  white-space: nowrap;
}

.is-empty {
  height: 48px;
}

.is-empty .opponent-hand-count {
  left: 50%;
  transform: translateX(-50%) rotate(180deg);
}
</style>
