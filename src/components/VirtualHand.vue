<script setup lang="ts">
import { computed } from 'vue';
import type { HandPose } from '../domain/tablePresence';
import handCursorUrl from './mouse-hand-cursor.svg';

const props = defineProps<{ pose: HandPose; color: string; playerName: string; angle: number; gestureId?: string; visible?: boolean; cardBack?: boolean }>();
const classes = computed(() => ({ [`pose-${props.pose}`]: true, 'is-visible': props.visible !== false, 'has-gesture': Boolean(props.gestureId), 'holds-card': props.cardBack }));
</script>

<template>
  <div class="virtual-hand" :class="classes" :style="{ '--hand-color': color, '--hand-angle': `${angle}deg` }" :aria-label="`Mão de ${playerName}`">
    <span v-if="pose === 'point' && gestureId" :key="gestureId" class="hand-tap-ring" aria-hidden="true"></span>
    <span class="hand-rest-dot" aria-hidden="true"></span>
    <span v-if="pose === 'grab' && cardBack" class="hand-private-card" aria-hidden="true">
      <span class="hand-held-back"></span>
    </span>
    <img class="hand-art" :src="handCursorUrl" alt="" draggable="false" />
    <span class="hand-name">{{ playerName }}</span>
  </div>
</template>
