<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { CardInstance } from '../domain/game';
import { scryfall } from '../services/scryfall';

const props = withDefaults(defineProps<{ card?: CardInstance; compact?: boolean }>(), { compact: false });
const imageUrl = ref('');
let objectUrl = '';
let request = 0;
watch(() => [props.card?.cardId, props.card?.face, props.card?.card?.image_uris?.small], async ([cardId, face]) => {
  const requestId = ++request;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = ''; imageUrl.value = '';
  const definition = props.card?.card;
  if (!definition || definition.id !== cardId || !definition.image_uris?.small && !definition.card_faces?.length) return;
  const result = await scryfall.image(definition, props.compact ? 'small' : 'normal', Number(face ?? props.card?.face ?? 0));
  if (requestId !== request) { if (result?.startsWith('blob:')) URL.revokeObjectURL(result); return; }
  imageUrl.value = result ?? '';
  if (result?.startsWith('blob:')) objectUrl = result;
}, { immediate: true });
onBeforeUnmount(() => { request++; if (objectUrl) URL.revokeObjectURL(objectUrl); });
</script>

<template>
  <span class="card-tile" :class="[{ compact }, `card-identity-${card?.card?.color_identity?.length ? 'color' : 'empty'}`]">
    <img v-if="imageUrl && !card?.faceDown" :src="imageUrl" :alt="card?.card?.name ?? 'Carta de Magic'" loading="lazy" draggable="false">
    <span v-else-if="card?.faceDown || !card?.card" class="card-tile-back"><i>✳</i><small>M / T</small></span>
    <span v-else class="card-tile-fallback"><b>{{ card.card.card_faces?.[card.face ?? 0]?.name ?? card.card.name }}</b><small>{{ card.card.mana_cost || card.card.type_line }}</small><i>✳</i></span>
  </span>
</template>
