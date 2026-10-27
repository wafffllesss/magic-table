<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ text?: string; class?: string }>();
const parts = computed(() => (props.text ?? '').split(/(\{[^}]+\})/g).filter(Boolean));
function symbolUrl(part: string): string {
  const symbol = part.slice(1, -1).trim().toUpperCase().replaceAll('/', '');
  return `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(symbol)}.svg`;
}
</script>

<template>
  <span :class="['mana-text', props.class]">
    <template v-for="(part, index) in parts" :key="index">
      <img v-if="/^\{[^{}]+\}$/.test(part)" class="mana-symbol" :src="symbolUrl(part)" :alt="part" :title="part" loading="lazy" />
      <template v-else>{{ part }}</template>
    </template>
  </span>
</template>

<style scoped>
.mana-text { white-space: pre-line; }
.mana-symbol { display: inline-block; width: 2em; height: 2em; margin: 0 .08em; vertical-align: -.55em; }
</style>
