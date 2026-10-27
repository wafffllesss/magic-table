<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CardInstance } from '../domain/game';
import CardTile from './CardTile.vue';

const props = defineProps<{ card: CardInstance; reducedMotion: boolean }>();
const shownFace = ref(props.card.face ?? 0);
const flipping = ref(false);
const flipSequence = ref(0);
let swapTimer: ReturnType<typeof setTimeout> | undefined;
let finishTimer: ReturnType<typeof setTimeout> | undefined;
const shownCard = computed(() => ({ ...props.card, face: shownFace.value }));
function cancel(): void { clearTimeout(swapTimer); clearTimeout(finishTimer); }
watch(() => props.card.face ?? 0, face => {
  cancel();
  if (props.reducedMotion) { shownFace.value = face; flipping.value = false; return; }
  flipping.value = true;
  flipSequence.value++;
  swapTimer = setTimeout(() => { shownFace.value = face; }, 120);
  finishTimer = setTimeout(() => { shownFace.value = face; flipping.value = false; }, 240);
});
watch(() => props.reducedMotion, reduced => {
  if (reduced) { cancel(); shownFace.value = props.card.face ?? 0; flipping.value = false; }
});
onBeforeUnmount(cancel);
</script>

<template>
  <span class="card-pose" :class="{ 'is-tapped': card.tapped, 'motion-reduced': reducedMotion }">
    <span :key="flipSequence" class="card-face-motion" :class="{ 'is-flipping': flipping }"><CardTile :card="shownCard" :compact="true" /></span>
  </span>
</template>
