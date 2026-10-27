<script setup lang="ts">
import { computed } from 'vue';
import type { CardInstance } from '../domain/game';
import { CARD_SIZE } from '../domain/tableView';
import { createPhysicalStackGeometry } from '../domain/physicalStack';
import CardTile from './CardTile.vue';

const props = defineProps<{ count: number; seed: string; topCard?: CardInstance }>();
const geometry = computed(() => createPhysicalStackGeometry(props.count, props.seed));
const metrics = computed(() => ({
  '--stack-width': `${CARD_SIZE.width}px`,
  '--stack-card-height': `${CARD_SIZE.height}px`,
  '--stack-height': `${geometry.value.height}px`,
}));
function layerStyle(layer: { x: number; y: number; z: number; rotation: number }): Record<string, string> {
  return { transform: `translate3d(${layer.x}px,${layer.y}px,${layer.z}px) rotateZ(${layer.rotation}deg)` };
}
</script>

<template>
  <span v-if="geometry.count" class="physical-stack" :style="metrics" aria-hidden="true">
    <span class="physical-stack-edge physical-stack-edge-north"></span>
    <span class="physical-stack-edge physical-stack-edge-east"></span>
    <span class="physical-stack-edge physical-stack-edge-west"></span>
    <span class="physical-stack-edge physical-stack-edge-south"></span>
    <span
      v-for="(layer, index) in geometry.layers"
      :key="layer.sample"
      class="physical-stack-layer"
      :class="{ 'is-stack-base': index === 0 }"
      :style="layerStyle(layer)"
    ></span>
    <span class="physical-stack-top" :style="layerStyle(geometry.layers.at(-1)!)">
      <CardTile :card="props.topCard" :compact="true" :zoom-enabled="false" />
      <slot name="caption"></slot>
    </span>
  </span>
</template>
