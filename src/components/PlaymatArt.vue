<script setup lang="ts">
import { computed, ref } from 'vue';
import { PLAYMATS } from '../services/playmats';
import { useAdaptiveImage } from '../services/adaptiveImage';
import { downloadImage, imageQueue, type ImageOptions } from '../services/imageQueue';

const props = defineProps<{ id?: string }>();
const element = ref<HTMLElement>();
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
  <span ref="element" class="adaptive-playmat" :data-image-width="resolution || undefined">
    <img v-if="imageUrl" :src="imageUrl" alt="" decoding="async" draggable="false">
  </span>
</template>

<style scoped>
.adaptive-playmat { display: block; position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.adaptive-playmat img { display: block; width: 100%; height: 100%; object-fit: cover; }
</style>
