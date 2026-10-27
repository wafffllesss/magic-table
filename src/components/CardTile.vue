<script setup lang="ts">
import ManaText from './ManaText.vue';
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { cardInspection, closeCardInspection, enterCardInspection, inspectionDisabledKey, leaveCardInspection, openCardInspection, releaseCardInspection, type InspectionSource } from '../services/cardInspection';
import type { CardDefinition, CardInstance } from '../domain/game';
import { scryfall } from '../services/scryfall';
import { useAdaptiveImage } from '../services/adaptiveImage';
import { CARD_IMAGE_SIZES, cardImageSource } from '../services/imagePolicy';
import type { ImageOptions } from '../services/imageQueue';

const props = withDefaults(defineProps<{ card?: CardInstance; definition?: CardDefinition; compact?: boolean; inspection?: boolean; face?: number; zoomEnabled?: boolean; quantity?: number }>(), { compact: false, inspection: false, face: undefined, zoomEnabled: true });
const element = ref<HTMLElement>();
const inspectionDisabled = inject(inspectionDisabledKey, computed(() => false));
function inspectionSource(pointerOrigin?: { x: number; y: number }): InspectionSource | undefined {
  if (!element.value || !props.zoomEnabled || props.inspection) return;
  return { element: element.value, pointerOrigin, read: () => ({ card: props.card, definition: props.definition, face: props.face, quantity: props.quantity }) };
}
function enter(event: PointerEvent): void {
  if (event.pointerType !== 'mouse' || event.buttons || inspectionDisabled.value) return;
  const source = inspectionSource({ x: event.clientX, y: event.clientY });
  if (source) enterCardInspection(source);
}
function inspectByWheel(event: WheelEvent): void {
	if (inspectionDisabled.value || !props.zoomEnabled || props.inspection || !event.deltaY) return;
	if (event.deltaY < 0) {
		const source = inspectionSource({ x: event.clientX, y: event.clientY });
		if (source) openCardInspection(source);
	} else if (cardInspection.value?.source.element === element.value) closeCardInspection();
}
function leave(): void { if (element.value) leaveCardInspection(element.value); }
const lifted = computed(() => cardInspection.value?.source.element === element.value);
watch([() => props.card?.id, () => props.card?.faceDown, () => props.card?.card?.id, () => props.definition?.id, () => props.zoomEnabled], () => {
  if (element.value) releaseCardInspection(element.value);
});
onBeforeUnmount(() => { if (element.value) releaseCardInspection(element.value, false); });
const shownDefinition = computed(() => props.definition ?? props.card?.card);
const source = computed(() => {
  const definition = shownDefinition.value;
  const face = props.face ?? props.card?.face ?? 0;
  const levels = !definition || props.card?.faceDown ? [] : CARD_IMAGE_SIZES.flatMap((size, index) => {
    const available = cardImageSource(definition, size, face);
    return available?.size === size ? [{ width: [146, 488, 672][index], load: (options: ImageOptions) => scryfall.image(definition, size, face, options) }] : [];
  });
  return { key: JSON.stringify([definition?.id, definition?.image_uris, definition?.card_faces?.map(face => face.image_uris), face, props.card?.faceDown]), levels, aspect: 146 / 204, inspection: props.inspection };
});
const { imageUrl, resolution } = useAdaptiveImage(element, source);
</script>

<template>
  <span ref="element" class="card-tile" :data-image-width="resolution || undefined" :class="[{ compact, 'inspection-source-hidden': lifted }, `card-identity-${card?.card?.color_identity?.length ? 'color' : 'empty'}`]" @pointerenter="enter" @pointermove="enter" @pointerleave="leave" @wheel.prevent.stop="inspectByWheel">
    <span v-if="zoomEnabled && !inspection" class="inspection-corner" data-inspection-corner style="left:0;top:0" aria-hidden="true"></span>
    <span v-if="zoomEnabled && !inspection" class="inspection-corner" data-inspection-corner style="left:100%;top:0" aria-hidden="true"></span>
    <span v-if="zoomEnabled && !inspection" class="inspection-corner" data-inspection-corner style="left:100%;top:100%" aria-hidden="true"></span>
    <span v-if="zoomEnabled && !inspection" class="inspection-corner" data-inspection-corner style="left:0;top:100%" aria-hidden="true"></span>
    <img v-if="imageUrl && !card?.faceDown" :src="imageUrl" :alt="shownDefinition?.card_faces?.[face ?? card?.face ?? 0]?.name ?? shownDefinition?.name ?? 'Carta de Magic'" decoding="async" draggable="false">
    <span v-else-if="card?.faceDown || !shownDefinition" class="card-tile-back"><i>✳</i><small>M / T</small></span>
    <span v-else class="card-tile-fallback"><b>{{ shownDefinition.card_faces?.[face ?? card?.face ?? 0]?.name ?? shownDefinition.name }}</b><small><ManaText :text="shownDefinition.card_faces?.[face ?? card?.face ?? 0]?.mana_cost || shownDefinition.mana_cost || shownDefinition.type_line" /></small><i>✳</i></span>
  </span>
</template>
