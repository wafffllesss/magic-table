<script setup lang="ts">
import type { DeckEntry } from '../domain/game';
import CardTile from './CardTile.vue';

defineProps<{ entries: DeckEntry[] }>();
</script>

<template>
  <span class="commander-thumbnails">
    <span v-for="entry in entries" :key="entry.cardId" class="commander-thumbnail" :title="entry.name" :aria-label="`Comandante: ${entry.name}`">
      <CardTile v-if="entry.card" :definition="entry.card" :quantity="entry.quantity" compact />
      <span v-else class="commander-thumbnail-fallback" aria-hidden="true">♛</span>
    </span>
  </span>
</template>

<style scoped>
.commander-thumbnails { display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none; }
.commander-thumbnail { display: block; flex: none; width: var(--commander-thumbnail-width, 30px); aspect-ratio: 5 / 7; overflow: hidden; border: 1px solid #c5dfac55; border-radius: 4px; background: #15231a; box-shadow: 0 3px 7px #0005; }
.commander-thumbnail :deep(.card-tile) { display: block; width: 100%; height: 100%; border-radius: 0; }
.commander-thumbnail-fallback { display: grid; place-items: center; width: 100%; height: 100%; color: var(--lime); }
</style>
