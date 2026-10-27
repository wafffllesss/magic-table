<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MatchState } from '../domain/game';
import type { TargetMark, TargetReference } from '../domain/tableTargets';

const props = defineProps<{ stage?: HTMLElement; state: MatchState; marks: TargetMark[]; preview?: { origin: TargetReference & { kind: 'card' }; x: number; y: number; seatId: string } }>();
const colors: Record<string, string> = { northWest: '#e89772', northEast: '#9c96e8', southEast: '#86d7a5', southWest: '#edc365' };
type Box = { x: number; y: number; width: number; height: number; cx: number; cy: number };
type Point = { x: number; y: number };
type Drawing = { id: string; seatId: string; color: string; target: Box; origin?: Box; start?: Point; end?: Point };
const drawings = ref<Drawing[]>([]);
const previewLine = ref<{ origin: Box; x: number; y: number; seatId: string; color: string }>();
let frame = 0;
let drawingSignature = '';
let previewSignature = '';
let observer: MutationObserver | undefined;
const elements = new Map<string, HTMLElement | null>();

function boxFor(reference: TargetReference, stageBox: DOMRect): Box | undefined {
  const stage = props.stage;
  if (!stage) return;
  const cardZone = reference.kind === 'card' ? props.state.cards[reference.cardId]?.zone : '';
  const cacheKey = reference.kind === 'card' ? 'c:' + reference.cardId + ':' + cardZone : 'p:' + reference.seatId;
  const cached = elements.has(cacheKey);
  let element: HTMLElement | null = elements.get(cacheKey) ?? null;
  if (cached && !element) return;
  if (element && !element.isConnected) { elements.delete(cacheKey); element = null; }
  if (!element && reference.kind === 'player') element = stage.querySelector<HTMLElement>(`.seat-place[data-seat="${CSS.escape(reference.seatId)}"] .seat-life-reading`);
  else if (!element && reference.kind === 'card') {
    const card = props.state.cards[reference.cardId];
    if (!card || !['battlefield', 'stack', 'command', 'graveyard', 'exile'].includes(card.zone)) return;
    const id = CSS.escape(reference.cardId);
    const zoneClass: Record<string, string> = { battlefield: '.board-card-wrap', stack: '.stack-back', command: '.commander-zone', graveyard: '.public-zone-fan-card', exile: '.public-zone-fan-card' };
    element = stage.querySelector<HTMLElement>(`${zoneClass[card.zone]}[data-menu-card="${id}"]`);
    if (!element && (card.zone === 'graveyard' || card.zone === 'exile')) element = stage.querySelector<HTMLElement>(`.public-zone-toggle[data-seat="${CSS.escape(card.ownerId)}"][data-drop-zone="${card.zone}"]`);
    if (!element && card.zone === 'stack') element = stage.querySelector<HTMLElement>('.stack-cards');
  }
  elements.set(cacheKey, element);
  if (!element) return;
  const bounds = element.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const x = bounds.left - stageBox.left, y = bounds.top - stageBox.top;
  return { x, y, width: bounds.width, height: bounds.height, cx: x + bounds.width / 2, cy: y + bounds.height / 2 };
}
function edgePoint(box: Box, other: Box): Point {
  const dx = other.cx - box.cx, dy = other.cy - box.cy;
  const factor = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity, 1);
  return { x: box.cx + dx * factor, y: box.cy + dy * factor };
}
function draw(): void {
  frame = 0;
  const stage = props.stage;
  if (!stage || (!props.marks.length && !props.preview)) { elements.clear(); drawingSignature = ''; previewSignature = ''; if (drawings.value.length) drawings.value = []; if (previewLine.value) previewLine.value = undefined; return; }
  const stageBox = stage.getBoundingClientRect();
  const boxes = new Map<string, Box | undefined>();
  const getBox = (reference: TargetReference): Box | undefined => {
    const key = reference.kind === 'card' ? `c:${reference.cardId}` : `p:${reference.seatId}`;
    if (!boxes.has(key)) boxes.set(key, boxFor(reference, stageBox));
    return boxes.get(key);
  };
  const nextDrawings = props.marks.flatMap(mark => {
    const target = getBox(mark.target);
    const origin = mark.kind === 'arrow' ? getBox(mark.origin) : undefined;
    return target && (mark.kind !== 'arrow' || origin) ? [{ id: mark.id, seatId: mark.seatId, color: colors[mark.seatId] ?? '#b8e677', target, origin, start: origin ? edgePoint(origin, target) : undefined, end: origin ? edgePoint(target, origin) : undefined }] : [];
  });
  const nextDrawingSignature = JSON.stringify(nextDrawings);
  if (nextDrawingSignature !== drawingSignature) { drawings.value = nextDrawings; drawingSignature = nextDrawingSignature; }
  const preview = props.preview;
  const origin = preview && getBox(preview.origin);
  const nextPreview = preview && origin ? { origin, x: preview.x - stageBox.left, y: preview.y - stageBox.top, seatId: preview.seatId, color: colors[preview.seatId] ?? '#b8e677' } : undefined;
  const nextPreviewSignature = JSON.stringify(nextPreview) ?? '';
  if (nextPreviewSignature !== previewSignature) { previewLine.value = nextPreview; previewSignature = nextPreviewSignature; }
  frame = requestAnimationFrame(draw);
}
function schedule(): void { if (!frame) frame = requestAnimationFrame(draw); }
function observeStage(): void {
  observer?.disconnect(); elements.clear();
  if (props.stage) { observer = new MutationObserver(() => { elements.clear(); schedule(); }); observer.observe(props.stage, { childList: true, subtree: true }); }
  schedule();
}
onMounted(observeStage);
watch(() => props.stage, observeStage);
watch(() => [props.marks, props.preview], schedule);
onBeforeUnmount(() => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); });
</script>

<template>
  <svg class="target-layer" aria-hidden="true">
    <defs><marker v-for="(color, seat) in colors" :id="`target-arrow-${seat}`" :key="seat" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" :fill="color" /></marker></defs>
    <g v-for="mark in drawings" :key="mark.id" :stroke="mark.color">
      <line v-if="mark.origin" :x1="mark.start!.x" :y1="mark.start!.y" :x2="mark.end!.x" :y2="mark.end!.y" class="target-line-shadow" />
      <line v-if="mark.origin" :x1="mark.origin.cx" :y1="mark.origin.cy" :x2="mark.target.cx" :y2="mark.target.cy" class="target-line" :marker-end="`url(#target-arrow-${mark.seatId})`" />
      <rect v-if="mark.origin" :x="mark.origin.x - 3" :y="mark.origin.y - 3" :width="mark.origin.width + 6" :height="mark.origin.height + 6" rx="7" class="target-outline" />
      <rect :x="mark.target.x - 3" :y="mark.target.y - 3" :width="mark.target.width + 6" :height="mark.target.height + 6" rx="7" class="target-outline" />
    </g>
    <g v-if="previewLine" :stroke="previewLine.color">
      <rect :x="previewLine.origin.x - 3" :y="previewLine.origin.y - 3" :width="previewLine.origin.width + 6" :height="previewLine.origin.height + 6" rx="7" class="target-outline" />
      <line :x1="previewLine.origin.cx" :y1="previewLine.origin.cy" :x2="previewLine.x" :y2="previewLine.y" class="target-line target-line-preview" :marker-end="`url(#target-arrow-${previewLine.seatId})`" />
    </g>
  </svg>
</template>
