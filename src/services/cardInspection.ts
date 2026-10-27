import { computed, shallowRef, type ComputedRef, type InjectionKey } from 'vue';
import type { CardDefinition, CardInstance } from '../domain/game';

export type InspectionContent = { card?: CardInstance; definition?: CardDefinition; face?: number; quantity?: number };
export type InspectionSource = { element: HTMLElement; read: () => InspectionContent; opener?: HTMLElement; pointerOrigin?: { x: number; y: number } };
export const inspectionDisabledKey: InjectionKey<ComputedRef<boolean>> = Symbol('inspection-disabled');
type Inspection = { source: InspectionSource; pinned: boolean; phase: 'opening' | 'zoomed' | 'details' | 'closing'; sequence: number };
export const cardInspection = shallowRef<Inspection>();
export const inspectionPending = shallowRef<InspectionSource>();
export const inspectionHover = shallowRef<InspectionSource>();
export const inspectionOpen = computed(() => Boolean(cardInspection.value));
let sequence = 0;
let stageTimer: ReturnType<typeof setTimeout> | undefined;
let detailsTimer: ReturnType<typeof setTimeout> | undefined;
let leaveTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function clearTimers(): void {
  clearTimeout(stageTimer); clearTimeout(detailsTimer); clearTimeout(leaveTimer); clearTimeout(closeTimer);
}
export function canInspect(source: InspectionSource): boolean {
  const content = source.read();
  return source.element.isConnected && !content.card?.faceDown && Boolean(content.definition ?? content.card?.card);
}
export function closeCardInspection(immediate = false): void {
  if (!immediate && cardInspection.value?.phase === 'closing') return;
  clearTimers(); inspectionPending.value = undefined;
  const current = cardInspection.value;
  if (!current) return;
  const finish = () => {
    cardInspection.value = undefined;
    if (current.pinned && current.source.opener?.isConnected) current.source.opener.focus({ preventScroll: true });
  };
  if (immediate) { finish(); return; }
  cardInspection.value = { ...current, phase: 'closing' };
  closeTimer = setTimeout(finish, 250);
}
export function openCardInspection(source: InspectionSource, pinned = true): void {
  if (!canInspect(source)) return;
  closeCardInspection(true);
  inspectionPending.value = undefined;
  const current: Inspection = { source, pinned, phase: 'opening', sequence: ++sequence };
  cardInspection.value = current;
  stageTimer = setTimeout(() => {
    if (cardInspection.value?.sequence === current.sequence) cardInspection.value = { ...current, phase: pinned ? 'details' : 'zoomed' };
  }, 400);
  if (!pinned) detailsTimer = setTimeout(() => {
    if (cardInspection.value?.sequence === current.sequence) cardInspection.value = { ...current, phase: 'details' };
  }, 1400);
}
export function enterCardInspection(source?: InspectionSource): void {
  clearTimeout(leaveTimer);
  const active = cardInspection.value;
  if (!source || active?.pinned || active?.phase === 'closing') return;
  if (!canInspect(source)) return;
  inspectionHover.value = source;
  if (active && active.source.element !== source.element) closeCardInspection();
}
export function leaveCardInspection(element?: HTMLElement): void {
  if (!element || inspectionHover.value?.element === element) inspectionHover.value = undefined;
  const active = cardInspection.value;
  if (!active || active.pinned || active.phase === 'closing' || element && active.source.element !== element) return;
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => closeCardInspection(), 600);
}
export function releaseCardInspection(element: HTMLElement, immediate = true): void {
  if (inspectionPending.value?.element === element || cardInspection.value?.source.element === element) closeCardInspection(immediate);
}
