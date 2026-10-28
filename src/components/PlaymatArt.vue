<script setup lang="ts">
import { computed, ref } from 'vue';
import { PLAYMATS, playmatColor, playmatCustomImage } from '../services/playmats';
import { useAdaptiveImage } from '../services/adaptiveImage';
import { downloadImage, imageQueue, type ImageOptions } from '../services/imageQueue';

const props = defineProps<{ id?: string }>();
const element = ref<HTMLElement>();
const color = computed(() => playmatColor(props.id));
const customImage = computed(() => playmatCustomImage(props.id));
const colorStyle = computed(() => color.value ? {
  backgroundColor: color.value,
  backgroundImage: `linear-gradient(135deg, ${color.value}, color-mix(in srgb, ${color.value} 75%, black))`,
} : undefined);
const source = computed(() => {
  const mat = PLAYMATS.find(item => item.id === props.id);
  return {
    key: props.id ?? '', aspect: 16 / 9,
    levels: mat ? [
      { width: 320, uri: mat.thumbnail }, { width: 1600, uri: mat.image },
    ].map(level => ({ width: level.width, load: async (options: ImageOptions) => {
      try {
        const blob = await imageQueue.request(level.uri, signal => downloadImage(level.uri, signal), options);
        return blob && !options.signal?.aborted ? URL.createObjectURL(blob) : undefined;
      } catch { return undefined; }
    } })) : [],
  };
});
const { imageUrl, resolution } = useAdaptiveImage(element, source);
</script>

<template>
  <span ref="element" class="adaptive-playmat" :style="colorStyle" :data-image-width="resolution || undefined">
    <img v-if="customImage" :src="customImage" alt="" decoding="async" draggable="false" referrerpolicy="no-referrer">
    <img v-else-if="imageUrl" :src="imageUrl" alt="" decoding="async" draggable="false">
  </span>
</template>

<style scoped>
.adaptive-playmat { display: block; position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.adaptive-playmat img { display: block; width: 100%; height: 100%; object-fit: cover; }
</style>
