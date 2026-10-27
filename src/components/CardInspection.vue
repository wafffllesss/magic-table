<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useAppI18n } from '../i18n';
import CardTile from './CardTile.vue';
import ManaText from './ManaText.vue';
import { canInspect, cardInspection, closeCardInspection, enterCardInspection, inspectionHover, inspectionPending, leaveCardInspection, openCardInspection } from '../services/cardInspection';
import { inspectionSourceTransform } from '../services/cardInspectionGeometry';

const active = cardInspection;
const { t } = useAppI18n();
const art = ref<HTMLElement>();
const dialog = ref<HTMLElement>();
const face = ref(0);
const content = computed(() => active.value?.source.read());
const definition = computed(() => content.value?.definition ?? content.value?.card?.card);
const shownFace = computed(() => definition.value?.card_faces?.[face.value] ?? definition.value);
const details = computed(() => active.value?.phase === 'details');
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
const layout = computed(() => {
  const { width, height } = viewport.value;
  const narrow = width < 700;
  const cardHeight = Math.max(80, Math.min(720, height * (narrow ? .52 : .82), (width - 32) * 204 / 146));
  const cardWidth = cardHeight * 146 / 204;
  const copyWidth = narrow ? cardWidth : Math.min(350, Math.max(180, width - cardWidth - 80));
  const totalWidth = narrow ? cardWidth : cardWidth + 28 + copyWidth;
  return { width: cardWidth, height: cardHeight, left: (width - totalWidth) / 2, top: narrow ? 20 : (height - cardHeight) / 2, copyWidth, narrow };
});
const artStyle = computed(() => ({ width: `${layout.value.width}px`, height: `${layout.value.height}px`, transform: `translate(${layout.value.left}px, ${layout.value.top}px)` }));
const copyStyle = computed(() => ({ width: `${layout.value.copyWidth}px`, left: `${layout.value.narrow ? layout.value.left : layout.value.left + layout.value.width + 28}px`, top: `${layout.value.narrow ? layout.value.top + layout.value.height + 18 : layout.value.top}px`, maxHeight: `${layout.value.narrow ? viewport.value.height - layout.value.top - layout.value.height - 34 : layout.value.height}px` }));
let animation: Animation | undefined;
let observer: MutationObserver | undefined;
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

watch(() => active.value?.sequence, async sequence => {
  animation?.cancel();
  if (!sequence || !active.value) return;
  face.value = content.value?.face ?? content.value?.card?.face ?? 0;
  const current = active.value;
  await nextTick();
  if (active.value?.sequence !== sequence || !art.value) return;
  const destination = artStyle.value.transform;
  if (!motion.matches) animation = art.value.animate([
    { transform: inspectionSourceTransform(current.source.element, layout.value.width, layout.value.height), filter: 'drop-shadow(0 2px 3px #0006)' },
    { transform: destination, filter: 'drop-shadow(0 24px 38px #000a)' },
  ], { duration: 400, easing: 'cubic-bezier(.2,.75,.25,1)' });
  if (current.pinned) dialog.value?.focus({ preventScroll: true });
});
watch(() => active.value?.phase, phase => {
  if (phase !== 'closing' || !art.value || !active.value) return;
  const transform = getComputedStyle(art.value).transform;
  animation?.cancel();
  animation = art.value.animate([
    { transform, opacity: 1 },
    { transform: !motion.matches && active.value.source.element.isConnected ? inspectionSourceTransform(active.value.source.element, layout.value.width, layout.value.height) : transform, opacity: active.value.source.element.isConnected && !motion.matches ? 1 : 0 },
  ], { duration: 250, easing: 'ease-in', fill: 'forwards' });
});
watch(content, () => {
  if (active.value && !canInspect(active.value.source)) closeCardInspection(true);
});
watch(() => content.value?.face ?? content.value?.card?.face, value => { if (value !== undefined) face.value = value; });
function onKeys(event: KeyboardEvent): void {
  if (event.target instanceof Element && event.target.closest('.tutorial-dialog')) return;
  if (event.key.toLowerCase() === 'z' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (active.value) {
      event.preventDefault();
      closeCardInspection();
      return;
    }
    const target = event.target;
    const editing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (!editing && inspectionHover.value && canInspect(inspectionHover.value)) {
      event.preventDefault();
      openCardInspection(inspectionHover.value);
      return;
    }
  }
  if (event.key === 'Escape' && inspectionPending.value) { closeCardInspection(true); return; }
  if (!active.value) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeCardInspection(); return; }
  if (event.key !== 'Tab' || !active.value.pinned || !dialog.value) return;
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); dialog.value.focus(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first.focus(); }
}
function onWheel(event: WheelEvent): void {
  if (!active.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.deltaY > 0) closeCardInspection();
}
function onPointerDown(event: PointerEvent): void {
  if (active.value?.pinned || (event.target instanceof Element && event.target.closest('.shared-card-inspection'))) return;
  closeCardInspection(true);
}
function onPointerMove(event: PointerEvent): void {
  if (event.pointerType !== 'mouse') return;
  const source = inspectionPending.value ?? (!active.value?.pinned ? active.value?.source : undefined);
  if (!source?.pointerOrigin || Math.hypot(event.clientX - source.pointerOrigin.x, event.clientY - source.pointerOrigin.y) <= 12) return;
  if (inspectionPending.value) closeCardInspection(true);
  else if (active.value) closeCardInspection();
}
function onContextMenu(event: MouseEvent): void {
  const source = active.value?.source.element;
  const forward = source?.closest('.table-shell') && event.target instanceof Element && event.target.closest('.shared-inspection-art');
  closeCardInspection(true);
  if (forward && source?.isConnected) {
    event.preventDefault();
    source.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: 2 }));
  }
}
function onResize(): void { closeCardInspection(true); viewport.value = { width: window.innerWidth, height: window.innerHeight }; }
onMounted(() => {
  window.addEventListener('keydown', onKeys, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('resize', onResize);
  observer = new MutationObserver(() => {
    if (active.value && !active.value.source.element.isConnected) closeCardInspection();
  });
  observer.observe(document.body, { childList: true, subtree: true });
});
onBeforeUnmount(() => {
  closeCardInspection(true); animation?.cancel(); observer?.disconnect();
  window.removeEventListener('keydown', onKeys, true);
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('pointermove', onPointerMove, true);
  window.removeEventListener('contextmenu', onContextMenu, true);
  window.removeEventListener('wheel', onWheel, true);
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="shared-card-inspection" :class="{ 'has-details': details, 'is-pinned': active.pinned, 'is-closing': active.phase === 'closing' }" :data-phase="active.phase">
      <div class="shared-inspection-backdrop" @click="closeCardInspection()"></div>
      <section ref="dialog" class="shared-inspection-dialog" :role="active.pinned ? 'dialog' : undefined" :aria-modal="active.pinned || undefined" :aria-label="t('inspection.label', { card: shownFace?.name ?? t('table.card') })" tabindex="-1">
        <div ref="art" class="shared-inspection-art" :style="artStyle" @pointerenter="enterCardInspection()" @pointerleave="leaveCardInspection()">
          <CardTile :definition="definition" :face="face" inspection :zoom-enabled="false" />
        </div>
        <div class="shared-inspection-copy" :style="copyStyle" :inert="!details" @pointerenter="enterCardInspection()" @pointerleave="leaveCardInspection()">
          <button class="shared-inspection-close" type="button" :aria-label="t('inspection.close')" @click="closeCardInspection()">×</button>
          <span class="eyebrow">{{ shownFace?.type_line }}</span>
          <h2>{{ shownFace?.name }}</h2>
          <ManaText :text="shownFace?.mana_cost" />
          <p><ManaText :text="shownFace?.oracle_text || t('inspection.unavailable')" /></p>
          <strong v-if="shownFace?.power || shownFace?.toughness">{{ shownFace?.power ?? '—' }} / {{ shownFace?.toughness ?? '—' }}</strong>
          <div v-if="(definition?.card_faces?.length ?? 0) > 1" class="shared-inspection-faces"><button v-for="(item, index) in definition?.card_faces" :key="index" type="button" :aria-pressed="face === index" @click="face = index">{{ item.name }}</button></div>
          <small v-if="content?.quantity">{{ t('inspection.deckQuantity', { count: content.quantity }) }}</small>
          <small>{{ t('inspection.escapeClose') }}</small>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style>
.card-tile.inspection-source-hidden { opacity: 0 !important; }
.card-tile > .inspection-corner { position:absolute; width:0; height:0; padding:0; border:0; pointer-events:none; }
.shared-card-inspection { position:fixed; inset:0; z-index:10000; pointer-events:none; }
.shared-inspection-backdrop { position:absolute; inset:0; background:#060b09ba; opacity:0; transition:opacity 200ms; }
.shared-card-inspection.has-details .shared-inspection-backdrop { opacity:1; }
.shared-card-inspection.is-pinned .shared-inspection-backdrop { pointer-events:auto; }
.shared-inspection-dialog { position:absolute; inset:0; outline:none; pointer-events:none; }
.shared-inspection-art { position:absolute; left:0; top:0; transform-origin:0 0; pointer-events:none; filter:drop-shadow(0 24px 38px #000a); }
.shared-inspection-art .card-tile-fallback b { font-size:clamp(18px,2vw,28px); }
.shared-inspection-art .card-tile-fallback small { font-size:clamp(12px,1.4vw,18px); }
.shared-inspection-art .card-tile-fallback i { font-size:32px; }
.shared-inspection-copy { position:absolute; padding:36px 20px 24px; border:1px solid #c1d4b52b; border-radius:12px; background:#111c17f5; color:#e8ece7; overflow:auto; visibility:hidden; opacity:0; transition:opacity 200ms, visibility 200ms; pointer-events:none; }
.shared-card-inspection.has-details .shared-inspection-copy { user-select:none; -webkit-user-select:none; }
.has-details .shared-inspection-copy { visibility:visible; opacity:1; pointer-events:auto; }
.shared-inspection-copy h2 { margin:16px 0 12px; font:600 clamp(20px,2.2vw,32px)/1.15 var(--heading); }
.shared-inspection-copy p { white-space:pre-line; font-size:14px; line-height:1.65; }
.shared-inspection-copy small { display:block; margin-top:20px; color:#97aa9c; font:10px var(--mono); }
.shared-inspection-close { position:absolute; right:8px; top:6px; width:30px; height:30px; border:0; background:none; font-size:24px; cursor:pointer; }
.shared-inspection-faces { display:flex; flex-wrap:wrap; gap:8px; margin-top:20px; }
.shared-inspection-faces button { padding:7px 10px; border:1px solid #b8e67750; border-radius:5px; background:#243127; font-size:12px; cursor:pointer; }
.shared-inspection-faces button[aria-pressed=true] { border-color:var(--lime); color:var(--lime); }
.shared-card-inspection.is-closing .shared-inspection-backdrop,.shared-card-inspection.is-closing .shared-inspection-copy { opacity:0; pointer-events:none; }
@media(prefers-reduced-motion:reduce) { .shared-inspection-copy,.shared-inspection-backdrop { transition:none; } }
</style>
