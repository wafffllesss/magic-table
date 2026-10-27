<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import VirtualHand from './VirtualHand.vue';

defineProps<{ playerName: string }>();

const position = ref({ x: 0, y: 0 });
const visible = ref(false);
let pointerInside = false;
let frame = 0;
let pendingPosition = { x: 0, y: 0 };

function syncCursor(): void {
  frame = 0;
  position.value = pendingPosition;
  visible.value = pointerInside;
  document.body.classList.toggle('has-app-virtual-cursor', visible.value);
}

function trackPointer(event: PointerEvent): void {
  if (event.pointerType !== 'mouse') return;
  pointerInside = true;
  pendingPosition = { x: event.clientX - 14, y: event.clientY };
  if (!frame) frame = requestAnimationFrame(syncCursor);
}

function hideOnExit(event: PointerEvent): void {
  if (event.relatedTarget) return;
  pointerInside = false;
  if (!frame) frame = requestAnimationFrame(syncCursor);
}

onMounted(() => {
  window.addEventListener('pointermove', trackPointer, true);
  window.addEventListener('pointerdown', trackPointer, true);
  window.addEventListener('pointerout', hideOnExit, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', trackPointer, true);
  window.removeEventListener('pointerdown', trackPointer, true);
  window.removeEventListener('pointerout', hideOnExit, true);
  if (frame) cancelAnimationFrame(frame);
  document.body.classList.remove('has-app-virtual-cursor');
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="target-global-cursor" :style="{ transform: `translate3d(${position.x + 14}px, ${position.y}px, 0)` }" aria-hidden="true"><span></span></div>
    <VirtualHand
      v-if="visible"
      class="is-local app-global-cursor"
      pose="follow"
      color="#b8e677"
      :player-name="playerName"
      :angle="0"
      :style="{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }"
      aria-hidden="true"
    />
  </Teleport>
</template>
