<script setup lang="ts">
import './gameTableControls.css';
import './librarySearch.css';
import meuMagicLogo from '../assets/meu-magic-logo.svg';
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { commandersForSeat, eligibleSeats } from '../domain/game';
import type { GameAction, MatchState, PlayerSeat, Zone } from '../domain/game';
import type { HandPresence, HandPresenceInput, HandPose } from '../domain/tablePresence';
import type { TableSeatId } from '../services/firebaseRoom';
import CardTile from './CardTile.vue';
import ScryfallProgress from './ScryfallProgress.vue';
import PhysicalCardStack from './PhysicalCardStack.vue';
import TableField from './TableField.vue';
import TableMotionLayer from './TableMotionLayer.vue';
import TableTargetLayer from './TableTargetLayer.vue';
import { targetReferenceValid, type TargetIntent, type TargetMark, type TargetReference } from '../domain/tableTargets';
import { indexTableCards } from '../domain/tableCards';
import { useTableCameraLayer } from '../services/tableCameraLayer';
import { cardInspection, closeCardInspection, inspectionDisabledKey, inspectionOpen, inspectionPending, openCardInspection } from '../services/cardInspection';
import ManaText from './ManaText.vue';
import PlaymatArt from './PlaymatArt.vue';
import { scheduleImageMeasurements } from '../services/imageVisibility';
import TableContextMenu from './TableContextMenu.vue';
import TableTutorial from './TableTutorial.vue';
import { localRepository } from '../services/storage';
import OpponentHand from './OpponentHand.vue';
import RevealedHand from './RevealedHand.vue';
import ChatBubbles from './ChatBubbles.vue';
import type { ChatMessage } from '../domain/chat';
import type { HandRevealRequest, HandRevealView } from '../domain/handReveal';
import { CARD_AREA, CARD_SIZE, FOV_LIMITS, MAT_HEIGHT, MAT_WIDTH, TABLE_SIZE, ZONE_GAP, ZONE_STEP, clampCameraPitch, clampCardPosition, createTableView, projectPoint, screenToCardPosition, screenToMat, screenToTable, SEAT_PLACEMENT, type SeatPosition, type ViewMode } from '../domain/tableView';
import { handPresenceStale } from '../domain/tablePresence';
import { cardMenuOptions, indicatedSeat, type TableMenuOption } from '../domain/tableInteraction';
import { PLAYMATS, validPlaymatId } from '../services/playmats';
import { cardTypeGroups, cardTypeKey, groupCreatureTokens } from '../domain/cardTypes';
import type { CardDefinition } from '../domain/game';
import { scryfall } from '../services/scryfall';
import { formatGameLogEvent, useAppI18n } from '../i18n';

const props = defineProps<{ state: MatchState; seatId?: TableSeatId; appVersion: string; updateAvailable?: boolean; playmatIds: Partial<Record<TableSeatId, string>>; customPlaymatsDisabled?: boolean; online: boolean; multiplayer?: boolean; roomCode?: string; spectator?: boolean; busy?: boolean; isHost?: boolean; onlineSeats?: Partial<Record<TableSeatId, { uid: string; online: boolean }>>; handPresence?: HandPresence[]; chatMessages?: ChatMessage[]; targetMarks?: TargetMark[]; handReveals?: HandRevealView[]; handRevealPrompt?: HandRevealRequest }>();
const { t, locale } = useAppI18n();
const emit = defineEmits<{ (event: 'open-update'): void; (event: 'actions', actions: GameAction[]): void; (event: 'set-playmat', id: string | undefined): void; (event: 'set-custom-playmats-disabled', disabled: boolean): void; (event: 'leave'): void; (event: 'copy-room-code'): void; (event: 'hand-presence', presence: HandPresenceInput): void; (event: 'target', target: TargetIntent): void; (event: 'continue-without', seatId: string): void; (event: 'undo'): void; (event: 'redo'): void; (event: 'request-hand-reveal', seatId: TableSeatId): void; (event: 'respond-hand-reveal', requestId: string, accept: boolean): void; (event: 'end-hand-reveal'): void }>();
const seatOrder: TableSeatId[] = ['northWest', 'northEast', 'southEast', 'southWest'];
const selfSeat = computed(() => props.state.seats.find(seat => seat.id === props.seatId));
type RevealDestination = 'top' | 'bottom' | 'hand' | 'graveyard' | 'exile';
const revealOrderPrompt = ref<{ destination: 'top' | 'bottom'; ids: string[]; close: boolean; choosing: boolean }>();
const revealSinglePrompt = ref<string>();
function revealedFor(seat: PlayerSeat): MatchState['cards'][string][] {
  return (seat.libraryRevealed ?? []).flatMap(id => props.state.cards[id] ? [props.state.cards[id]] : []);
}
function moveRevealed(destination: RevealDestination, ids = [...(selfSeat.value?.libraryRevealed ?? [])], close = false): void {
  if (!ids.length) { if (close) emitAction({ type: 'CLOSE_LIBRARY_REVEAL' }); return; }
  if (destination === 'top' || destination === 'bottom') { revealOrderPrompt.value = { destination, ids, close, choosing: false }; return; }
  emitAction({ type: 'MOVE_LIBRARY_REVEALED', cardIds: ids, destination, close });
}
function confirmRevealOrder(): void {
  const prompt = revealOrderPrompt.value; if (!prompt) return;
  emitAction({ type: 'MOVE_LIBRARY_REVEALED', cardIds: prompt.ids, destination: prompt.destination, close: prompt.close });
  revealOrderPrompt.value = undefined;
}
function shiftRevealOrder(index: number, delta: number): void {
  const ids = revealOrderPrompt.value?.ids; const next = index + delta;
  if (!ids || next < 0 || next >= ids.length) return;
  [ids[index], ids[next]] = [ids[next], ids[index]];
}
const activeSeats = computed(() => eligibleSeats(props.state));
const disconnectedPlayers = computed(() => (props.state.disconnectedSeatIds ?? []).flatMap(id => {
  const seat = props.state.seats.find(candidate => candidate.id === id);
  return seat ? [{ id, name: seat.name, suspended: (props.state.suspendedSeatIds ?? []).includes(id) }] : [];
}));
const selectedCardId = ref('');
let clearSelectionTimer: ReturnType<typeof setTimeout> | undefined;
function clearSelectionOutsideCards(event: MouseEvent): void {
  if (showTutorial.value) return;
  if (altTargetMode.value || targetSource.value || suppressTargetClick) return;
  if (event.target instanceof Element && event.target.closest('.board-card-wrap, .fan-card, .commander-zone')) {
    clearTimeout(clearSelectionTimer);
    return;
  }
  const selectedId = selectedCardId.value;
  if (!selectedId) return;
  clearTimeout(clearSelectionTimer);
  // Let a clicked control use the selected card before dismissing its selection.
  clearSelectionTimer = setTimeout(() => {
    if (selectedCardId.value === selectedId) selectedCardId.value = '';
  }, 0);
}
const selectedBottom = ref<string[]>([]);
const showHelp = ref(false);
const showTutorial = ref(false);
const hideTutorial = ref(false);
let tutorialRequest = 0;
let tutorialOpener: HTMLElement | undefined;
async function loadTutorialPreference(): Promise<void> {
  const request = ++tutorialRequest;
  const hidden = (await localRepository.getPreference<boolean>('hide-table-tutorial')) === true;
  if (request !== tutorialRequest) return;
  hideTutorial.value = hidden;
  if (!hidden) openTutorial();
}
function openTutorial(): void {
  tutorialOpener = showHelp.value ? document.querySelector<HTMLElement>('.help-top') ?? undefined : document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  showHelp.value = false;
  showTutorial.value = true;
  blurTargets();
  closeCardInspection(true);
}
function closeTutorial(hidden: boolean, openShortcuts = false): void {
  hideTutorial.value = hidden;
  void localRepository.setPreference('hide-table-tutorial', hidden);
  showTutorial.value = false;
  showHelp.value = openShortcuts;
  if (openShortcuts) void nextTick(() => document.querySelector<HTMLElement>('.help-modal .modal-close')?.focus());
  else void nextTick(() => tutorialOpener?.isConnected && tutorialOpener.focus());
}
const showSettings = ref(false);
const settingsTab = ref<'table'>('table');
const showLog = ref(false);
const logDialog = ref<HTMLElement>();
const logOpener = ref<HTMLElement>();
const stageElement = ref<HTMLElement>();
const sceneViewport = ref<HTMLElement>();
const cameraScene = ref<HTMLElement>();
const stageSize = ref({ width: 1200, height: 800 });
const cameraMode = ref<ViewMode>(props.seatId ? 'seat' : 'overview');
const cameraFov = ref(55);
let requestedFov = 55;
let zoomFrame = 0;
let zoomFrameAt = 0;
const cameraLook = ref({ yaw: 0, pitch: 0, lean: 0 });
const requestedLook = { yaw: 0, pitch: 0, lean: 0 };
const reducedMotion = ref(false);
const resolvingFlight = ref<{ card: MatchState['cards'][string]; x: number; y: number; width: number; height: number; dx: number; dy: number; scaleX: number; scaleY: number }>();
const arrivingCardId = ref('');
let flightTimer: ReturnType<typeof setTimeout> | undefined;
// Leave screen space for the controls and commander note beside the local mat.
const controlSpace = computed(() => props.seatId && !props.spectator && cameraMode.value === 'seat' ? (stageSize.value.width <= 700 ? Math.min(400, stageSize.value.width) : 240) : 0);
const cameraView = computed(() => createTableView(stageSize.value.width, stageSize.value.height, props.seatId, cameraMode.value, cameraLook.value.yaw, cameraLook.value.pitch, cameraFov.value, controlSpace.value, cameraLook.value.lean));
watch(cameraView, scheduleImageMeasurements, { flush: 'post' });
const geometryStyle = {
  '--table-size': `${TABLE_SIZE}px`, '--mat-width': `${MAT_WIDTH}px`, '--mat-height': `${MAT_HEIGHT}px`,
  '--card-width': `${CARD_SIZE.width}px`, '--card-height': `${CARD_SIZE.height}px`, '--zone-gap': `${ZONE_GAP}px`, '--zone-step': `${ZONE_STEP}px`,
  '--field-left': `${CARD_AREA.left}px`, '--field-top': `${CARD_AREA.top}px`, '--field-width': `${CARD_AREA.width}px`, '--field-height': `${CARD_AREA.height}px`,
};
useTableCameraLayer(stageElement, sceneViewport, cameraScene, cameraView, cameraLook);
const showPlaymats = ref(false);
const playmatDraft = ref<string>();
let cameraFrame = 0;
let cameraFrameAt = 0;
let resizeObserver: ResizeObserver | undefined;
let motionQuery: MediaQueryList | undefined;
const boundsCache = new Map<HTMLElement, DOMRect>();
let boundsFrame = 0;
function frameBounds(element: HTMLElement | undefined): DOMRect | undefined {
  if (!element) return;
  let bounds = boundsCache.get(element);
  if (!bounds) { bounds = element.getBoundingClientRect(); boundsCache.set(element, bounds); }
  if (!boundsFrame) boundsFrame = requestAnimationFrame(() => { boundsCache.clear(); boundsFrame = 0; });
  return bounds;
}
function invalidateBounds(): void { boundsCache.clear(); }

const dragCard = ref<{ id: string; zone: Zone; seatId?: SeatPosition; startX: number; startY: number; moved: boolean; offset: { x: number; y: number } }>();
const dragGhost = ref<{ x: number; y: number; width: number; height: number; offsetX: number; offsetY: number }>();
const hoveredDropKey = ref('');
type TransferPrompt = { kind: 'transfer'; cardId: string; seatId: string; name: string } | { kind: 'commander'; cardId: string; action: GameAction };
const transferPrompt = ref<TransferPrompt>();
const transferDialog = ref<HTMLElement>();
const transferPosition = ref({ left: 12, top: 12 });
let transferOpener: HTMLElement | undefined;
async function openTransferPrompt(cardId: string, seatId: string, name: string, x: number, y: number): Promise<void> {
  transferOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  transferPrompt.value = { kind: 'transfer', cardId, seatId, name };
  await positionTransferPrompt(x, y);
}
async function openCommanderPrompt(cardId: string, action: GameAction, x: number, y: number): Promise<void> {
  transferOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  transferPrompt.value = { kind: 'commander', cardId, action };
  await positionTransferPrompt(x, y);
}
async function positionTransferPrompt(x: number, y: number): Promise<void> {
  transferPosition.value = { left: x, top: y };
  freezeCamera();
  await nextTick();
  const dialog = transferDialog.value;
  if (!dialog) return;
  const bounds = dialog.getBoundingClientRect();
  const left = x + bounds.width + 16 <= window.innerWidth ? x + 12 : x - bounds.width - 12;
  const top = y + bounds.height + 16 <= window.innerHeight ? y + 12 : y - bounds.height - 12;
  transferPosition.value = {
    left: Math.max(12, Math.min(left, window.innerWidth - bounds.width - 12)),
    top: Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12)),
  };
  dialog.querySelector<HTMLElement>('.transfer-cancel')?.focus();
}
function closeTransferPrompt(): void {
  const pending = transferPrompt.value;
  transferPrompt.value = undefined;
  if (transferOpener?.isConnected) transferOpener.focus({ preventScroll: true });
  transferOpener = undefined;
  if (pending?.kind === 'commander') emitAction(pending.action, true);
}
function confirmTransferPrompt(): void {
  const pending = transferPrompt.value;
  if (!pending) return;
  if (pending.kind === 'commander') {
    clearTransferPrompt();
    emitAction({ type: 'MOVE_CARD', cardId: pending.cardId, zone: 'command' }, true);
    return;
  }
  const card = props.state.cards[pending.cardId];
  const targetActive = props.state.seats.some(seat => seat.id === pending.seatId && seat.status === 'playing');
  clearTransferPrompt();
  if (card?.zone === 'battlefield' && card.controllerId === props.seatId && targetActive) {
    emitAction({ type: 'TRANSFER_CONTROL', cardId: pending.cardId, seatId: pending.seatId });
  }
}
function clearTransferPrompt(): void {
  transferPrompt.value = undefined;
  if (transferOpener?.isConnected) transferOpener.focus({ preventScroll: true });
  transferOpener = undefined;
}
function onTransferPromptKeys(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); closeTransferPrompt(); return; }
  if (event.key !== 'Tab') return;
  const controls = transferDialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled)');
  if (!controls?.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function dropKey(zone: Zone | 'command', seatId?: string): string { return `${zone}:${seatId ?? ''}`; }
function canDropOn(zone: Zone | 'command', seatId?: string): boolean {
  const drag = dragCard.value;
  const card = drag && props.state.cards[drag.id];
  if (!drag?.moved || !card) return false;
  if (zone === 'battlefield') {
    if (seatId === props.seatId) return drag.zone !== 'battlefield' || drag.seatId === seatId;
    return drag.zone === 'battlefield' && card.controllerId === props.seatId
      && props.state.seats.some(seat => seat.id === seatId && seat.status === 'playing');
  }
  if (zone === 'command') return card.ownerId === seatId
    && Boolean(props.state.seats.find(seat => seat.id === card.ownerId)?.commanderIds.includes(card.cardId))
    && (drag.zone === 'battlefield' ? card.controllerId === props.seatId : ['hand', 'graveyard', 'exile'].includes(drag.zone));
  if (zone === 'stack') return ['hand', 'command'].includes(drag.zone) && props.state.phase === 'playing';
  if (zone === 'library') return drag.zone === 'revealed' && seatId === card.ownerId;
  if (zone === 'graveyard' || zone === 'exile' || zone === 'hand') return drag.zone !== zone && seatId === card.ownerId;
  return false;
}
function dropTargetAt(x: number, y: number): { zone: Zone | 'command'; seatId?: string } | undefined {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-zone]');
  const zone = target?.dataset.dropZone as (Zone | 'command' | undefined);
  const seatId = target?.dataset.seat;
  return zone && canDropOn(zone, seatId) ? { zone, seatId } : undefined;
}
function dropReady(zone: Zone | 'command', seatId?: string): boolean { return canDropOn(zone, seatId); }
function dropHovered(zone: Zone | 'command', seatId?: string): boolean { return hoveredDropKey.value === dropKey(zone, seatId); }
type LocalHandState = { x: number; y: number; zone: 'table' | 'private'; pose: HandPose; pointerX?: number; pointerY?: number; gestureId?: string; cardId?: string; cardBack?: boolean };
const localHand = ref<LocalHandState>();
const handNow = ref(Date.now());
let handTapTimer: ReturnType<typeof setTimeout> | undefined;
let handPublishTimer: ReturnType<typeof setTimeout> | undefined;
let lastHandPointerTapAt = 0;
const handledPointerUps = new WeakSet<PointerEvent>();
let handClockTimer: ReturnType<typeof setInterval> | undefined;
let pendingHandPublish: HandPresenceInput | undefined;
let lastHandPublishAt = 0;
let handSequence = 0;
const suppressClickId = ref('');
let lastMousePoint: { x: number; y: number } | undefined;
const touchLook = ref<{ x: number; y: number; yaw: number; pitch: number; lean: number }>();
const openPublicZone = ref<string>();
const zoneFanKey = (seatId: string, zone: 'graveyard' | 'exile'): string => `${seatId}:${zone}`;
function zoneFanOpen(seatId: string, zone: 'graveyard' | 'exile'): boolean { return openPublicZone.value === zoneFanKey(seatId, zone); }
function zoneColumns(count: number): number { return Math.min(4, Math.max(1, 1 + Math.ceil(Math.max(0, count - 10) / 15))); }
function zoneRows(count: number): number { return Math.max(15, Math.ceil((count + 5) / zoneColumns(count))); }
function zoneCardPosition(index: number, count: number): Record<string, number> {
  const rows = zoneRows(count);
  const firstColumnCount = rows - 5;
  return index < firstColumnCount
    ? { gridColumn: 1, gridRow: index + 6, zIndex: index + 1 }
    : { gridColumn: 2 + Math.floor((index - firstColumnCount) / rows), gridRow: 1 + (index - firstColumnCount) % rows, zIndex: index + 1 };
}
function toggleZoneFan(seatId: TableSeatId, zone: 'graveyard' | 'exile', button: HTMLElement): void {
  const key = zoneFanKey(seatId, zone);
  if (openPublicZone.value === key) {
    if (button.closest('.zone-pile-wrap')?.querySelector('.public-zone-fan')?.contains(document.activeElement)) button.focus({ preventScroll: true });
    openPublicZone.value = undefined;
  } else openPublicZone.value = key;
}
function closeZoneFans(): void {
  const focusedFan = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.public-zone-fan') : null;
  const opener = focusedFan?.closest('.zone-pile-wrap')?.querySelector<HTMLElement>('.public-zone-toggle');
  openPublicZone.value = undefined;
  opener?.focus({ preventScroll: true });
}
type MenuTarget = { kind: 'card'; cardId: string } | { kind: 'player'; seatId: TableSeatId } | { kind: 'hand'; seatId: TableSeatId } | { kind: 'deck'; seatId: string } | { kind: 'background' };
const contextMenu = ref<{ x: number; y: number; target: MenuTarget }>();
provide(inspectionDisabledKey, computed(() => Boolean(contextMenu.value || dragCard.value || showTutorial.value)));
let menuOpener: HTMLElement | undefined;
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let longPressPoint: { x: number; y: number; target: HTMLElement } | undefined;
let suppressTouchClick = false;
let suppressTouchTimer: ReturnType<typeof setTimeout> | undefined;
const searchOpen = ref(false);
const publicZoneSearch = ref<{ seatId: TableSeatId; zone: 'graveyard' | 'exile' }>();
const publicZoneSearchQuery = ref('');
const publicZoneSearchInput = ref<HTMLInputElement>();
let publicZoneSearchOpener: HTMLElement | undefined;
watch(publicZoneSearch, async search => {
  if (search) {
    await nextTick();
    publicZoneSearchInput.value?.focus();
  } else if (publicZoneSearchOpener?.isConnected) publicZoneSearchOpener.focus({ preventScroll: true });
});
function openPublicZoneSearch(seatId: TableSeatId, zone: 'graveyard' | 'exile', opener: HTMLElement): void {
  publicZoneSearchOpener = opener;
  publicZoneSearchQuery.value = '';
  publicZoneSearch.value = { seatId, zone };
  closeZoneFans();
  freezeCamera();
}
function activatePublicZone(seatId: TableSeatId, zone: 'graveyard' | 'exile', button: HTMLElement): void {
  if (seatId === props.seatId && isMine.value) void toggleZoneFan(seatId, zone, button);
  else openPublicZoneSearch(seatId, zone, button);
}
const publicZoneSearchCards = computed(() => {
  const search = publicZoneSearch.value;
  const seat = search && seatAt(search.seatId);
  if (!search || !seat) return [];
  const query = publicZoneSearchQuery.value.trim().toLocaleLowerCase(locale.value);
  return ownerCardsFor(seat, search.zone).filter(card => {
    const definition = card.card;
    return !query || Boolean(definition && `${definition.name} ${definition.type_line} ${definition.oracle_text}`.toLocaleLowerCase(locale.value).includes(query));
  });
});
const publicZoneSearchColumns = computed(() => [...cardTypeGroups, { key: 'other', label: 'Outros' }].flatMap(type => {
  const cards = publicZoneSearchCards.value.filter(card => card.card && cardTypeKey(card.card) === type.key);
  return cards.length ? [{ key: type.key, label: t(`cardTypes.${cardTypeLabelKey[type.key] ?? 'other'}`), cards }] : [];
}));
const searchDialog = ref<HTMLElement>();
const searchInput = ref<HTMLInputElement>();
let searchOpener: HTMLElement | undefined;
watch(searchOpen, async open => {
  if (open) {
    searchOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    await nextTick();
    searchInput.value?.focus();
  } else if (searchOpener?.isConnected) searchOpener.focus({ preventScroll: true });
});
watch(showLog, async open => {
  if (open) {
    logOpener.value = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    await nextTick();
    logDialog.value?.querySelector<HTMLElement>('.log-close')?.focus();
  } else if (logOpener.value?.isConnected) logOpener.value.focus({ preventScroll: true });
});
function onSearchKeys(event: KeyboardEvent): void {
  if (event.key === 'Escape') { if (tokenLibraryOpen.value) tokenLibraryOpen.value = false; else searchOpen.value = false; return; }
  if (event.key !== 'Tab') return;
  const controls = (tokenLibraryOpen.value ? tokenDialog.value : searchDialog.value)?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select');
  const first = controls?.[0], last = controls?.[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
function onPublicZoneSearchKeys(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); publicZoneSearch.value = undefined; return; }
  if (event.key !== 'Tab') return;
  const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), input')];
  if (!controls.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function inspectLibraryChoice(definition: CardDefinition, quantity: number, event: MouseEvent): void {
  const opener = event.currentTarget as HTMLElement;
  const element = opener.parentElement?.querySelector<HTMLElement>('.card-tile');
  if (element) openCardInspection({ element, opener, read: () => ({ definition, quantity }) });
}
const searchQuery = ref('');
const searchSelection = ref<string[]>([]);
const searchDestination = ref<'hand' | 'battlefield' | 'graveyard' | 'exile'>('hand');
const tokenLibraryOpen = ref(false);
const tokenDialog = ref<HTMLElement>();
const tokenSearchInput = ref<HTMLInputElement>();
const tokenSearchQuery = ref('');
const onlyDeckTokens = ref(true);
const creatureTokens = ref<CardDefinition[]>([]);
const tokenLoading = ref(false);
const tokenLoadingMore = ref(false);
const tokenHasMore = ref(false);
const tokenError = ref('');
const tokenPage = ref(0);
const tokenProgress = ref({ loaded: 0, total: 0, estimated: true });
let tokenSearchTimer: ReturnType<typeof setTimeout> | undefined;
let tokenSearchController: AbortController | undefined;
const creatureTokenColumns = computed(() => groupCreatureTokens(creatureTokens.value));
const deckCreatureTokenIds = computed(() => [...new Set(Object.values(props.state.cards)
  .filter(card => card.ownerId === props.seatId && !card.isToken)
  .flatMap(card => card.card?.all_parts ?? [])
  .filter(part => part.component === 'token' && /\btoken\b/i.test(part.type_line) && /\bcreature\b/i.test(part.type_line))
  .map(part => part.id))]);
watch(tokenLibraryOpen, async open => {
  if (open) {
    searchOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    void loadCreatureTokens(1);
    await nextTick();
    tokenSearchInput.value?.focus();
  } else {
    tokenSearchController?.abort();
    if (tokenSearchTimer) clearTimeout(tokenSearchTimer);
    if (searchOpener?.isConnected) searchOpener.focus({ preventScroll: true });
  }
});
watch([tokenSearchQuery, onlyDeckTokens], () => {
  if (tokenSearchTimer) clearTimeout(tokenSearchTimer);
  tokenSearchController?.abort();
  tokenLoading.value = false; tokenLoadingMore.value = false;
  tokenProgress.value = { loaded: 0, total: 0, estimated: true };
  tokenSearchTimer = setTimeout(() => { void loadCreatureTokens(1); }, 320);
});
async function loadCreatureTokens(page: number, append = false): Promise<void> {
  tokenSearchController?.abort();
  const controller = new AbortController();
  tokenSearchController = controller;
  tokenError.value = '';
  tokenProgress.value = { loaded: 0, total: 0, estimated: !onlyDeckTokens.value };
  if (append) tokenLoadingMore.value = true;
  else { tokenLoading.value = true; creatureTokens.value = []; }
  if (onlyDeckTokens.value) {
    try {
      const cards = await scryfall.getByIds(deckCreatureTokenIds.value, controller.signal, (loaded, total) => { tokenProgress.value = { loaded, total, estimated: false }; });
      if (controller.signal.aborted) return;
      const terms = tokenSearchQuery.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      creatureTokens.value = cards.filter(card => {
        const haystack = `${card.name} ${card.type_line}`.toLocaleLowerCase();
        return card.layout === 'token' && /\bcreature\b/i.test(card.type_line) && terms.every(term => haystack.includes(term));
      });
      tokenPage.value = 1;
      tokenHasMore.value = false;
    } catch {
      if (!controller.signal.aborted) tokenError.value = t('errors.scryfallNetwork');
    } finally {
      if (!controller.signal.aborted) { tokenLoading.value = false; tokenLoadingMore.value = false; }
    }
    return;
  }
  const query = `t:token t:creature ${tokenSearchQuery.value.trim()}`.trim();
  try {
    const result = await scryfall.search(query, page, controller.signal);
    if (controller.signal.aborted) return;
    const merged = append ? [...creatureTokens.value, ...result.data] : result.data;
    creatureTokens.value = [...new Map(merged.map(card => [card.id, card])).values()];
    tokenPage.value = page;
    tokenHasMore.value = result.has_more;
  } catch {
    if (!controller.signal.aborted) tokenError.value = t('errors.scryfallNetwork');
  } finally {
    if (!controller.signal.aborted) { tokenLoading.value = false; tokenLoadingMore.value = false; }
  }
}
function createCreatureToken(card: CardDefinition): void {
  if (!isMine.value || props.busy || props.state.paused || props.state.phase === 'finished') return;
  emitAction({ type: 'CREATE_TOKEN', card, x: 48, y: 48 });
  tokenLibraryOpen.value = false;
}
const ownHand = computed(() => selfSeat.value?.hand.map(id => props.state.cards[id]).filter(Boolean) ?? []);
const ownHandElement = ref<HTMLElement>();
const pendingDraw = ref<{ handIds: Set<string>; timeout: ReturnType<typeof setTimeout> }>();
function clearPendingDraw(): void {
  if (pendingDraw.value) clearTimeout(pendingDraw.value.timeout);
  pendingDraw.value = undefined;
}
const ownHandCardsElement = ref<HTMLElement>();
const handPeek = 28;
const handRetreat = ref(400);
const handAreaHeight = ref(225);
const handPointerInside = ref(false);
const handTouchOpen = ref(false);
const handKeyboardFocus = ref(false);
const handWindowActive = ref(true);
const localCursorVisible = ref(true);
let keyboardInput = false;
const stageSpaceFocus = ref(false);
let revealTouchPointer: number | undefined;
let revealTouchClickPointer: number | undefined;
let revealTouchClickTimer: ReturnType<typeof setTimeout> | undefined;
let handResizeObserver: ResizeObserver | undefined;
const handInteractionOpen = computed(() => {
  const target = contextMenu.value?.target;
  return Boolean(ownHandElement.value && cardInspection.value?.source.element.closest('.own-hand-fan') === ownHandElement.value)
    || target?.kind === 'card' && ownHand.value.some(card => card.id === target.cardId);
});
const handDragCanReopen = ref(true);
const ownHandExpanded = computed(() => handWindowActive.value && (dragCard.value?.moved
  ? handPointerInside.value && handDragCanReopen.value
  : handPointerInside.value || handTouchOpen.value || handKeyboardFocus.value || handInteractionOpen.value));

function measureOwnHand(): void {
  const fan = ownHandElement.value;
  const layer = ownHandCardsElement.value;
  if (!fan || !layer || !layer.children.length) return;
  // Remove only the layer's current retreat, including an in-flight transition.
  // Card rotation and selection lifts still count towards the visible envelope.
  const transform = getComputedStyle(layer).transform;
  const retreat = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
  const top = Math.min(...[...layer.children].map(card => card.getBoundingClientRect().top - retreat));
  const bounds = fan.getBoundingClientRect();
  handRetreat.value = Math.max(0, Math.ceil(bounds.bottom - top - handPeek));
  handAreaHeight.value = Math.max(bounds.height, bounds.bottom - top);
}
function pointerInOwnHand(x: number, y: number, expanded = ownHandExpanded.value): boolean {
  const bounds = frameBounds(ownHandElement.value);
  if (!bounds) return false;
  const height = expanded ? handAreaHeight.value : handPeek;
  return x >= bounds.left && x <= bounds.right && y >= bounds.bottom - height && y <= bounds.bottom;
}
function updateHandExpansion(event: PointerEvent): void {
  if (revealTouchPointer !== undefined || event.pointerType === 'touch' && !dragCard.value?.moved) return;
  handPointerInside.value = pointerInOwnHand(event.clientX, event.clientY);
}
function resetHandExpansion(): void {
  handPointerInside.value = false;
  handTouchOpen.value = false;
  handKeyboardFocus.value = false;
  handDragCanReopen.value = true;
  revealTouchPointer = undefined;
  keyboardInput = false;
}
function blurHand(): void { resetHandExpansion(); handWindowActive.value = false; }
function focusHandWindow(): void { handWindowActive.value = true; }
function leaveHandWindow(event: PointerEvent): void { if (!event.relatedTarget) handPointerInside.value = false; }
function focusOwnHand(event: FocusEvent): void {
  handKeyboardFocus.value = keyboardInput && event.target instanceof Element && Boolean(event.target.closest('.fan-card'));
}
function blurOwnHand(event: FocusEvent): void {
  if (!(event.relatedTarget instanceof Node) || !ownHandElement.value?.contains(event.relatedTarget)) handKeyboardFocus.value = false;
}
function trackHandOutsidePointerDown(event: PointerEvent): void {
  if (event.target instanceof Element && event.target.closest('.table-shell')) return;
  keyboardInput = false;
  handKeyboardFocus.value = false;
  if (event.pointerType === 'touch') handTouchOpen.value = false;
}
const isMine = computed(() => !props.spectator && Boolean(props.seatId));
const emptyTargets: TargetMark[] = [];
const altTargetMode = ref(false);
const targetSource = ref<(TargetReference & { kind: 'card' })>();
const targetPreviewPoint = ref<{ x: number; y: number }>();
let targetPointer: { pointerId: number; source?: TargetReference; startX: number; startY: number; moved: boolean; mode: 'alt' | 'pending' } | undefined;
let suppressTargetClick = false;
let targetClickTimer: ReturnType<typeof setTimeout> | undefined;
const targetPreview = computed(() => {
  const origin = targetSource.value ?? (targetPointer?.source?.kind === 'card' && targetPointer.moved ? targetPointer.source : undefined);
  const point = targetPreviewPoint.value;
  return origin && point && props.seatId ? { origin, ...point, seatId: props.seatId } : undefined;
});
const targetAnnouncement = ref('');
const revealedHandIds = computed(() => new Set((props.handReveals ?? []).flatMap(reveal => reveal.cards.map(card => card.id))));
function validTableTarget(value: unknown): value is TargetReference { return targetReferenceValid(value, props.state, revealedHandIds.value); }
function targetName(reference: TargetReference): string {
  if (reference.kind === 'player') return t('table.lifeOf', { name: props.state.seats.find(seat => seat.id === reference.seatId)?.name ?? '' });
  const card = props.state.cards[reference.cardId];
  return !card || card.faceDown ? t('table.faceDownCard') : card.card?.name ?? t('table.card');
}
watch(() => props.targetMarks?.at(-1)?.id, id => {
  if (!id) { targetAnnouncement.value = ''; return; }
  const mark = props.targetMarks?.at(-1);
  if (!mark) return;
  const author = props.state.seats.find(seat => seat.id === mark.seatId)?.name ?? '';
  targetAnnouncement.value = mark.kind === 'arrow' ? t('table.targetAnnounceArrow', { author, origin: targetName(mark.origin), target: targetName(mark.target) }) : t('table.targetAnnounceHighlight', { author, target: targetName(mark.target) });
});
function updateTargetCursor(): void {
  document.body.classList.toggle('has-target-mode', isMine.value && (altTargetMode.value || Boolean(targetSource.value)));
}
watch([altTargetMode, targetSource, isMine], updateTargetCursor);
function cancelTarget(): void { targetPointer = undefined; targetSource.value = undefined; targetPreviewPoint.value = undefined; }
function targetAt(element: Element | null): TargetReference | undefined {
  if (!element || !stageElement.value?.contains(element)) return;
  const cardId = element.closest<HTMLElement>('[data-menu-card]')?.dataset.menuCard;
  if (cardId) {
    const reference: TargetReference = { kind: 'card', cardId };
    return validTableTarget(reference) ? reference : undefined;
  }
  const seatId = element.closest<HTMLElement>('.seat-life-panel')?.closest<HTMLElement>('.seat-place')?.dataset.seat as TableSeatId | undefined;
  if (seatId) { const reference: TargetReference = { kind: 'player', seatId }; if (validTableTarget(reference)) return reference; }
}
function publishTarget(target: TargetReference, origin?: TargetReference & { kind: 'card' }): void {
  if (!isMine.value || !validTableTarget(target) || (origin && (!validTableTarget(origin) || target.kind === 'card' && target.cardId === origin.cardId))) return;
  const common = { id: crypto.randomUUID(), matchId: props.state.id, target };
  emit('target', origin ? { ...common, kind: 'arrow', origin } : { ...common, kind: 'highlight' });
}
function beginTargetPointer(event: PointerEvent): boolean {
  if (!isMine.value || event.button !== 0 || !(event.target instanceof Element) || !event.target.closest('.table-stage') || (!event.altKey && !targetSource.value)) return false;
  const reference = targetAt(event.target);
  targetPointer = { pointerId: event.pointerId, source: reference, startX: event.clientX, startY: event.clientY, moved: false, mode: targetSource.value ? 'pending' : 'alt' };
  if (!reference && targetSource.value) cancelTarget();
  else {
    targetPreviewPoint.value = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }
  event.preventDefault(); event.stopPropagation();
  suppressTargetClick = true;
  clearTimeout(targetClickTimer);
  targetClickTimer = setTimeout(() => { suppressTargetClick = false; }, 500);
  return true;
}
function moveTargetPointer(event: PointerEvent): boolean {
  if (!targetPointer && !targetSource.value) return false;
  targetPreviewPoint.value = { x: event.clientX, y: event.clientY };
  if (targetPointer?.pointerId === event.pointerId) {
    targetPointer.moved ||= Math.hypot(event.clientX - targetPointer.startX, event.clientY - targetPointer.startY) > 4;
    // The gesture is non-reactive, so replace the point to update the preview.
    targetPreviewPoint.value = { x: event.clientX, y: event.clientY };
    event.preventDefault(); event.stopPropagation(); return true;
  }
  return false;
}
function endTargetPointer(event: PointerEvent): boolean {
  const gesture = targetPointer;
  if (!gesture || gesture.pointerId !== event.pointerId) return false;
  if (event.type !== 'pointercancel') {
    const destination = targetAt(document.elementFromPoint(event.clientX, event.clientY));
    if (gesture.mode === 'pending') { if (destination && targetSource.value) publishTarget(destination, targetSource.value); }
    else if (gesture.moved) { if (gesture.source?.kind === 'card' && destination) publishTarget(destination, gesture.source); }
    else if (gesture.source) publishTarget(gesture.source);
  }
  cancelTarget(); event.preventDefault(); event.stopPropagation();
  clearTimeout(targetClickTimer); targetClickTimer = setTimeout(() => { suppressTargetClick = false; }, 500);
  return true;
}
function targetKeyDown(event: KeyboardEvent): void {
  if (showTutorial.value) return;
  if (event.key === 'Escape' && (targetSource.value || targetPointer)) { event.preventDefault(); event.stopImmediatePropagation(); cancelTarget(); return; }
  if (targetSource.value && (event.key === 'Enter' || event.key === ' ') && event.target instanceof Element) {
    const destination = targetAt(event.target);
    if (destination) { event.preventDefault(); event.stopImmediatePropagation(); publishTarget(destination, targetSource.value); cancelTarget(); }
    return;
  }
  if (event.key === 'Alt' && isMine.value && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable))) { event.preventDefault(); altTargetMode.value = true; }
}
function targetKeyUp(event: KeyboardEvent): void { if (event.key === 'Alt') { altTargetMode.value = false; if (targetPointer?.mode === 'alt') cancelTarget(); } }
function blurTargets(): void { altTargetMode.value = false; cancelTarget(); }
function handleTablePointerUp(event: PointerEvent): void { if (showTutorial.value) return; if (!endTargetPointer(event)) { endPointer(event); endLongPress(); } }

function handlePointerDown(event: PointerEvent): void {
  if (showTutorial.value) return;
  if (beginTargetPointer(event)) return;
  suppressTargetClick = false;
  flushPointer();
  keyboardInput = false;
  handKeyboardFocus.value = false;
  if (event.pointerType === 'touch') {
    const inside = pointerInOwnHand(event.clientX, event.clientY);
    if (inside && !ownHandExpanded.value) {
      handTouchOpen.value = true;
      revealTouchPointer = event.pointerId;
      cancelLongPress();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handTouchOpen.value = inside;
    handPointerInside.value = false;
  } else updateHandExpansion(event);
  startLongPress(event);
}
const selectedCard = computed(() => props.state.cards[selectedCardId.value]);
const hasVirtualCursor = computed(() => isMine.value && selfSeat.value?.status === 'playing');
const phaseSteps = ['Desvirar', 'Manutenção', 'Compra', 'Principal pré-combate', 'Combate', 'Principal pós-combate', 'Final'];
const ownTurnActive = computed(() => props.state.phase === 'playing' && props.state.activeSeatId === props.seatId && selfSeat.value?.status === 'playing');
const ownStepIndex = computed(() => ownTurnActive.value ? phaseSteps.indexOf(props.state.step) : -1);
const timelineStepIndex = computed(() => props.state.phase === 'playing' ? phaseSteps.indexOf(props.state.step) : -1);
const displayedLog = computed(() => [...props.state.log]);
const logPreview = computed(() => displayedLog.value.slice(-5));
const stackTop = computed(() => props.state.stack.at(-1));
watch(stackTop, async (next, previous) => {
  if (!previous || previous.id === next?.id || previous.kind !== 'spell' || reducedMotion.value) return;
  const card = props.state.cards[previous.sourceId];
  if (!card || card.zone === 'stack') return;
  await nextTick();
  const source = cameraScene.value?.querySelector<HTMLElement>('.stack-cards')?.getBoundingClientRect();
  const destination = card.zone === 'battlefield'
    ? cameraScene.value?.querySelector<HTMLElement>(`.board-card-wrap[data-card-id="${CSS.escape(card.id)}"]`)
    : cameraScene.value?.querySelector<HTMLElement>(`.physical-graveyard[data-seat="${CSS.escape(card.ownerId)}"]`);
  const target = destination?.getBoundingClientRect();
  if (!source || !target || !target.width || !target.height) return;
  if (flightTimer) clearTimeout(flightTimer);
  const width = Math.min(90, source.width / 3);
  const height = width * 118 / 84;
  const x = source.left + source.width / 2 - width / 2;
  const y = source.top + source.height / 2 - height / 2;
  resolvingFlight.value = { card, x, y, width, height, dx: target.left + target.width / 2 - x - width / 2, dy: target.top + target.height / 2 - y - height / 2, scaleX: target.width / width, scaleY: target.height / height };
  arrivingCardId.value = card.zone === 'battlefield' ? card.id : '';
  flightTimer = setTimeout(() => { resolvingFlight.value = undefined; arrivingCardId.value = ''; flightTimer = undefined; }, 550);
}, { flush: 'post' });
const stack = computed(() => props.state.stack);
const prioritySeat = computed(() => indicatedSeat(props.state));
const stackAngle = ref(SEAT_PLACEMENT[prioritySeat.value as TableSeatId]?.angle ?? 0);
const tableCards = computed(() => indexTableCards(props.state));
const revealedCards = computed(() => tableCards.value.revealed);
const ownLibrary = computed(() => selfSeat.value?.library?.map(id => props.state.cards[id]).filter((card): card is NonNullable<typeof card> => Boolean(card)) ?? []);
const handColors: Record<TableSeatId, string> = { northWest: '#e89772', northEast: '#9c96e8', southEast: '#86d7a5', southWest: '#edc365' };
function tableSeatPoint(seatId: TableSeatId): { x: number; y: number; z: number } {
  const seat = SEAT_PLACEMENT[seatId]; const angle = seat.angle * Math.PI / 180; const dx = -MAT_WIDTH / 2; const dy = MAT_HEIGHT / 2 + 25;
  return { x: seat.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: seat.y + dx * Math.sin(angle) + dy * Math.cos(angle), z: 3 };
}
function tableScreen(point: { x: number; y: number; z?: number }): { x: number; y: number } { return projectPoint(cameraView.value, { x: point.x, y: point.y, z: point.z ?? 3 }); }
function restScreen(seatId: TableSeatId): { x: number; y: number } { return tableScreen(tableSeatPoint(seatId)); }
const chatAnchors = computed(() => Object.fromEntries(seatOrder.map(id => {
  const point = restScreen(id);
  return [id, { x: point.x / stageSize.value.width, y: point.y / stageSize.value.height }];
})) as Record<TableSeatId, { x: number; y: number }>);
function handAngle(x: number, y: number, wrist: { x: number; y: number }): number { return Math.atan2(wrist.x - x, wrist.y - y) * 180 / Math.PI; }
function localHandAngle(x: number, y: number, wrist: { x: number; y: number }): number { return cameraMode.value === 'seat' ? 0 : handAngle(x, y, wrist); }
const handsOnTable = computed(() => {
  const presence = new Map((props.handPresence ?? []).map(hand => [hand.seatId, hand]));
  return props.state.seats.filter(seat => seat.status === 'playing' && (!props.multiplayer || Boolean(props.onlineSeats?.[seat.id as TableSeatId]?.online))).map(seat => {
    const seatId = seat.id as TableSeatId;
    if (seatId === props.seatId) {
      const hand = localHand.value;
      if (!hand) { const point = restScreen(seatId); return { seatId, name: seat.name, ...point, angle: handAngle(point.x, point.y, point), pose: 'rest' as HandPose, color: handColors[seatId], gestureId: undefined, cardId: undefined, cardBack: false, local: true }; }
      const point = hand.zone === 'private' ? { x: hand.x, y: hand.y } : tableScreen({ x: hand.x, y: hand.y, z: 0 });
      const anchor = restScreen(seatId);
      return { seatId, name: seat.name, ...point, angle: localHandAngle(point.x, point.y, anchor), pose: hand.pose, color: handColors[seatId], gestureId: hand.gestureId, cardId: hand.cardId, cardBack: false, local: true };
    }
    const remote = presence.get(seatId);
    const stale = remote && handPresenceStale(remote, handNow.value);
    const pose = !remote || stale ? 'rest' as const : remote.pose;
    const point = pose === 'rest' || remote?.zone === 'private' ? restScreen(seatId) : tableScreen({ x: remote!.x!, y: remote!.y!, z: 0 });
    const anchor = restScreen(seatId);
    return { seatId, name: seat.name, ...point, angle: handAngle(point.x, point.y, anchor), pose, color: handColors[seatId], gestureId: stale ? undefined : remote?.gestureId, cardId: stale ? undefined : remote?.cardId, cardBack: !stale && pose === 'grab' && (remote?.zone === 'private' || remote?.cardBack === true), local: false };
  });
});
const localTableHand = computed(() => handsOnTable.value.find(hand => hand.local));
const localHandCursorStyle = computed(() => {
  const bounds = frameBounds(stageElement.value);
  return { left: '0px', top: '0px', transform: 'translate3d(' + ((bounds?.left ?? 0) + (localTableHand.value?.x ?? 0) - 14) + 'px,' + ((bounds?.top ?? 0) + (localTableHand.value?.y ?? 0)) + 'px,0)' };
});
// App.vue owns the single global pointer cursor; retain this layer for remote hands and card drag visuals.
const localCursorEnabled = computed(() => false);
const motionLayer = { hands: handsOnTable, local: localTableHand, cursor: localHandCursorStyle, drag: dragCard, ghost: dragGhost, enabled: localCursorEnabled, cards: computed(() => props.state.cards) };
const opposingCommanders = computed(() => seatOrder
  .filter(id => id !== props.seatId && seatAt(id))
  .map(id => ({ seat: seatAt(id)!, commanders: commandersForSeat(props.state, id) })));
const commanderDamageDisabled = computed(() => props.busy || props.state.paused || props.state.phase === 'finished' || selfSeat.value?.status !== 'playing');
const libraryChoices = computed(() => {
  const search = searchQuery.value.trim().toLocaleLowerCase('pt-BR');
  const groups = new Map<string, { cardId: string; name: string; definition: CardDefinition; ids: string[] }>();
  for (const card of ownLibrary.value) {
    const definition = card.card;
    if (!definition || search && !`${definition.name} ${definition.type_line} ${definition.oracle_text}`.toLocaleLowerCase('pt-BR').includes(search)) continue;
    const group = groups.get(card.cardId) ?? { cardId: card.cardId, name: definition.name, definition, ids: [] };
    group.ids.push(card.id); groups.set(card.cardId, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
});
const cardTypeLabelKey: Record<string, string> = { creature: 'creature', planeswalker: 'planeswalker', instant: 'instant', sorcery: 'sorcery', artifact: 'artifact', enchantment: 'enchantment', battle: 'battle', land: 'land', other: 'other' };
const libraryColumns = computed(() => [...cardTypeGroups, { key: 'other', label: 'Outros' }].flatMap(type => {
  const choices = libraryChoices.value.filter(choice => cardTypeKey(choice.definition) === type.key);
  return choices.length ? [{ ...type, label: t(`cardTypes.${cardTypeLabelKey[type.key] ?? 'other'}`), choices, copies: choices.reduce((sum, choice) => sum + choice.ids.length, 0) }] : [];
}));

function emitAction(action: GameAction, skipCommanderPrompt = false): void {
  if (!props.busy && !props.state.paused && props.state.phase !== 'finished' && selfSeat.value?.status === 'playing' && isMine.value) {
    if (!skipCommanderPrompt && action.type === 'MOVE_CARD' && action.zone !== 'battlefield' && action.zone !== 'command') {
      const card = props.state.cards[action.cardId];
      if (card && props.state.seats.some(seat => seat.id === card.ownerId && seat.commanderIds.includes(card.cardId))) {
        void openCommanderPrompt(card.id, action, window.innerWidth / 2, window.innerHeight / 2);
        return;
      }
    }
    if (action.type === 'DRAW') {
      clearPendingDraw();
      const handIds = new Set(selfSeat.value.hand);
      const timeout = setTimeout(() => { pendingDraw.value = undefined; }, 10000);
      pendingDraw.value = { handIds, timeout };
    }
    emit('actions', [action]);
  }
}
function seatAt(id: string): PlayerSeat | undefined { return tableCards.value.seats.get(id); }
function cardsFor(seat: PlayerSeat, zone: 'battlefield' | 'command'): MatchState['cards'][string][] {
  return tableCards.value.zones.get(seat.id)![zone];
}
function ownerCardsFor(seat: PlayerSeat, zone: 'graveyard' | 'exile'): MatchState['cards'][string][] {
  return tableCards.value.zones.get(seat.id)![zone];
}
function hiddenCount(seat: PlayerSeat, zone: 'library' | 'hand'): number {
  const hidden = props.state.hiddenZones?.[seat.id];
  if (seat.id !== props.seatId || props.spectator) return hidden?.[zone] ?? seat[zone]?.length ?? 0;
  return zone === 'library' ? seat.library?.length ?? hidden?.library ?? 0 : seat.hand?.length ?? hidden?.hand ?? 0;
}
function draw(): void { emitAction({ type: 'DRAW' }); }
function select(id: string): void { selectedCardId.value = id; }
function toggleBottom(id: string): void {
  selectedBottom.value = selectedBottom.value.includes(id) ? selectedBottom.value.filter(item => item !== id) : [...selectedBottom.value, id];
}
function keepHand(): void { emitAction({ type: 'KEEP_HAND', bottomCardIds: [...selectedBottom.value] }); selectedBottom.value = []; }
function passPriority(): void { emitAction({ type: 'PASS_PRIORITY' }); }
function nextStep(): void {
  if (props.state.step === 'Final') { emitAction({ type: 'ADVANCE_TURN' }); return; }
  const current = Math.max(0, phaseSteps.indexOf(props.state.step));
  emitAction({ type: 'PHASE', step: phaseSteps[(current + 1) % phaseSteps.length] });
}
function previousStep(): void {
  const current = phaseSteps.indexOf(props.state.step);
  if (current > 0) emitAction({ type: 'PHASE', step: phaseSteps[current - 1] });
}
function selectTimelineStep(step: string): void {
  if (!ownTurnActive.value || props.busy || props.state.paused || props.state.phase === 'finished' || step === props.state.step) return;
  emitAction({ type: 'PHASE', step });
}
function cardAction(): void {
  if (!selectedCard.value || !selfSeat.value) return;
  const card = selectedCard.value;
  if (card.zone === 'hand' && /\bLand\b/i.test(card.card?.type_line ?? '')) emitAction({ type: 'PLAY_LAND', cardId: card.id, x: 12 + Math.random() * 34, y: 35 + Math.random() * 25 });
  else if (card.zone === 'hand' || card.zone === 'command') emitAction({ type: 'CAST', cardId: card.id });
  else if (card.zone === 'battlefield') emitAction({ type: 'MOVE_CARD', cardId: card.id, zone: 'graveyard' });
  else if (card.zone === 'graveyard' || card.zone === 'exile') emitAction({ type: 'MOVE_CARD', cardId: card.id, zone: 'hand' });
  selectedCardId.value = '';
}
function selectedOption(id: string): void {
  const option = cardMenuOptions(props.state, selectedCardId.value, props.seatId, props.spectator, props.busy).find(item => item.id === id);
  if (option?.action && !option.disabled) emitAction(option.action);
}
function tapSelected(): void { selectedOption('tap'); }
function tapCard(id: string): void {
  const option = cardMenuOptions(props.state, id, props.seatId, props.spectator, props.busy).find(item => item.id === 'tap');
  if (option?.action && !option.disabled) emitAction(option.action);
}
function adjustCardCounter(id: string, amount: number): void {
  const option = cardMenuOptions(props.state, id, props.seatId, props.spectator, props.busy).find(item => item.id === 'counter');
  if (option?.action?.type === 'CHANGE_COUNTER' && !option.disabled) emitAction({ ...option.action, amount });
}
function hoveredBattlefieldCard(): string | undefined {
  if (!lastMousePoint) return;
  const target = document.elementFromPoint(lastMousePoint.x, lastMousePoint.y);
  const card = target?.closest<HTMLElement>('.board-card-wrap[data-card-id]');
  if (!card || !stageElement.value?.contains(card)) return;
  return card.dataset.cardId;
}
function flipSelected(): void { selectedOption('flip'); }
function moveSelectedTo(zone: 'graveyard' | 'exile' | 'hand'): void {
  if (!selectedCard.value) return;
  emitAction({ type: 'MOVE_CARD', cardId: selectedCard.value.id, zone }); selectedCardId.value = '';
}
function matStyle(seatId: TableSeatId): Record<string, string> {
  const place = SEAT_PLACEMENT[seatId];
  return { left: `${place.x}px`, top: `${place.y}px`, transform: `translate(-50%,-50%) rotate(${place.angle}deg)` };
}
function openPlaymats(): void { playmatDraft.value = validPlaymatId(props.seatId ? props.playmatIds[props.seatId] : undefined); showPlaymats.value = true; }
function applyPlaymat(): void { emit('set-playmat', playmatDraft.value); showPlaymats.value = false; }
function openSettings(): void { settingsTab.value = 'table'; showSettings.value = true; }
function updateStageSize(): void {
  invalidateBounds();
  if (!stageElement.value) return;
  stageSize.value = { width: stageElement.value.clientWidth, height: stageElement.value.clientHeight };
}
function cameraTick(now: number): void {
  const elapsed = cameraFrameAt ? Math.min(64, now - cameraFrameAt) : 16;
  cameraFrameAt = now;
  const factor = reducedMotion.value ? 1 : 1 - Math.exp(-elapsed / 55);
  const yaw = cameraLook.value.yaw + (requestedLook.yaw - cameraLook.value.yaw) * factor;
  const pitch = cameraLook.value.pitch + (requestedLook.pitch - cameraLook.value.pitch) * factor;
  const lean = cameraLook.value.lean + (requestedLook.lean - cameraLook.value.lean) * factor;
  cameraLook.value = { yaw, pitch, lean };
  if (Math.abs(yaw - requestedLook.yaw) + Math.abs(pitch - requestedLook.pitch) + Math.abs(lean - requestedLook.lean) * 100 > 0.02) cameraFrame = requestAnimationFrame(cameraTick);
  else { cameraLook.value = { ...requestedLook }; cameraFrame = 0; cameraFrameAt = 0; }
}
function setLook(yaw: number, pitch: number, lean = requestedLook.lean): void {
  requestedLook.yaw = Math.max(-18, Math.min(18, yaw));
  requestedLook.pitch = clampCameraPitch(pitch);
  requestedLook.lean = Math.max(0, Math.min(1, lean));
  if (reducedMotion.value) { cameraLook.value = { ...requestedLook }; return; }
  if (!cameraFrame) cameraFrame = requestAnimationFrame(cameraTick);
}
function freezeCamera(): void {
  if (cameraFrame) cancelAnimationFrame(cameraFrame);
  cameraFrame = 0; cameraFrameAt = 0;
  Object.assign(requestedLook, cameraLook.value);
}
function leaveStage(event: PointerEvent): void {
  discardPointer();
  if (dragCard.value || touchLook.value || contextMenu.value || inspectionOpen.value) return;
  if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.game-sidebar, .table-topbar, .modal-scrim')) return;
  setLook(0, 0, 0);
}
function cameraCoordinates(event: PointerEvent): { x: number; y: number } {
  const bounds = frameBounds(stageElement.value);
  return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) };
}
function flushHandPresence(): void {
  if (!pendingHandPublish) return;
  const pending = pendingHandPublish; pendingHandPublish = undefined;
  pending.sequence = ++handSequence;
  lastHandPublishAt = performance.now();
  emit('hand-presence', pending);
}
function queueHandPresence(next: LocalHandState): void {
  if (!props.seatId || !isMine.value) return;
  const previous = localHand.value;
  localHand.value = next;
  const cardId = next.cardId && props.state.cards[next.cardId]?.zone !== 'hand' && props.state.cards[next.cardId]?.zone !== 'library' && !props.state.cards[next.cardId]?.faceDown ? next.cardId : undefined;
  const payload: HandPresenceInput = { matchId: props.state.id, seatId: props.seatId, sequence: handSequence, zone: next.zone, pose: next.pose,
    ...(next.zone === 'table' ? { x: Math.max(0, Math.min(TABLE_SIZE, next.x)), y: Math.max(0, Math.min(TABLE_SIZE, next.y)) } : {}),
    ...(next.gestureId ? { gestureId: next.gestureId } : {}), ...(cardId ? { cardId } : {}), ...(next.cardBack && next.pose === 'grab' ? { cardBack: true } : {}) };
  pendingHandPublish = payload;
  const changedPose = !previous || previous.pose !== next.pose || previous.zone !== next.zone || previous.gestureId !== next.gestureId || previous.cardId !== next.cardId;
  const elapsed = performance.now() - lastHandPublishAt;
  if (changedPose || elapsed >= 50) {
    if (handPublishTimer) clearTimeout(handPublishTimer);
    handPublishTimer = undefined;
    flushHandPresence();
  } else if (!handPublishTimer) handPublishTimer = setTimeout(() => { handPublishTimer = undefined; flushHandPresence(); }, Math.max(0, 50 - elapsed));
}
function restOwnHand(): void {
  if (!props.seatId || !isMine.value) return;
  const point = restScreen(props.seatId);
  queueHandPresence({ ...point, zone: 'table', pose: 'rest' });
}
function handTargetAllowed(target: EventTarget | null): target is Element {
  if (!(target instanceof Element) || !target.closest('.table-stage') || inspectionOpen.value || contextMenu.value || showHelp.value || searchOpen.value || showPlaymats.value) return false;
  if (target.closest('.game-sidebar,.table-topbar,.modal-scrim,.inspection-overlay,.seat-life-panel,.stage-shortcuts,.table-context-menu')) return false;
  const button = target.closest('button');
  return !button || Boolean(button.closest('.fan-card,.physical-zone,.public-zone-fan-card'));
}
function handCursorSurface(target: EventTarget | null): target is Element {
  if (!(target instanceof Element)) return false;
  if (target.closest('.shared-card-inspection')) return true;
  return Boolean(target.closest('.table-shell'));
}
function followLocalCursor(event: PointerEvent): void {
  const stage = event.target instanceof Element ? event.target.closest<HTMLElement>('.table-stage') ?? stageElement.value : stageElement.value;
  if (!hasVirtualCursor.value || !stage) return;
  localCursorVisible.value = true;
  const bounds = frameBounds(stage)!;
  localHand.value = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, zone: 'private', pose: 'follow' };
}
function updateOwnHand(event: PointerEvent, pose: HandPose, cardId?: string, gestureId?: string, cardBack = false): void {
  const stage = event.target instanceof Element ? event.target.closest<HTMLElement>('.table-stage') : undefined;
  if (!props.seatId || !isMine.value || !stage) return;
  const bounds = frameBounds(stage)!;
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
  const target = event.target;
  if (!handTargetAllowed(target)) return;
  const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  if (target.closest('.own-hand-fan')) {
    queueHandPresence({ ...pointer, zone: 'private', pose, ...(cardId ? { cardId } : {}), ...(gestureId ? { gestureId } : {}), ...(cardBack ? { cardBack } : {}) });
    return;
  }
  const world = screenToTable(cameraView.value, pointer.x, pointer.y);
  if (!world || world.x < 0 || world.y < 0 || world.x > TABLE_SIZE || world.y > TABLE_SIZE) return;
  queueHandPresence({ ...world, zone: 'table', pose, pointerX: pointer.x, pointerY: pointer.y, ...(cardId ? { cardId } : {}), ...(gestureId ? { gestureId } : {}), ...(cardBack ? { cardBack } : {}) });
}
function handPointerClick(event: MouseEvent): void {
  if (event.detail === 0 || performance.now() - lastHandPointerTapAt < 500 || !handTargetAllowed(event.target)) return;
  const pointer = event as MouseEvent;
  const synthetic = { clientX: pointer.clientX, clientY: pointer.clientY, target: pointer.target } as PointerEvent;
  const gestureId = `${props.seatId}-${Date.now().toString(36)}-${(++handSequence).toString(36)}`;
  updateOwnHand(synthetic, 'point', undefined, gestureId);
  if (handTapTimer) clearTimeout(handTapTimer);
  handTapTimer = setTimeout(() => {
    const current = localHand.value;
    if (current?.gestureId === gestureId) queueHandPresence({ x: current.x, y: current.y, zone: current.zone, pose: 'follow', ...(current.pointerX === undefined ? {} : { pointerX: current.pointerX, pointerY: current.pointerY }) });
  }, 720);
}
function trackCameraPointer(event: PointerEvent): void {
  if (event.pointerType !== 'mouse' || (event.target instanceof Element && event.target.closest('.stage-shortcuts,.general-actions,.deck-actions')) || reducedMotion.value || cameraMode.value !== 'seat' || showPlaymats.value || searchOpen.value || tokenLibraryOpen.value || showHelp.value) return;
  const pointer = cameraCoordinates(event);
  const vertical = 1 - pointer.y / Math.max(1, stageSize.value.height) * 2;
  setLook((pointer.x / Math.max(1, stageSize.value.width) * 2 - 1) * 18, vertical * 18, Math.max(0, vertical));
}
function pointerOnControl(event: PointerEvent): boolean {
  return event.target instanceof Element && Boolean(event.target.closest('button, input, select, .board-card-wrap, .table-hub, .seat-life-panel, .own-hand-fan, .public-zone-fan'));
}
function startDrag(event: PointerEvent, id: string): void {
  const card = props.state.cards[id];
  if (!card || event.button !== 0 || !isMine.value || card.zone === 'library' || card.zone === 'stack') return;
  const canMove = card.zone === 'battlefield' ? card.controllerId === props.seatId : card.ownerId === props.seatId;
  if (!canMove) return;
  updateOwnHand(event, 'follow');
  closeCardInspection(true);
  const seatId = (event.currentTarget as HTMLElement).closest<HTMLElement>('.player-mat, .seat-place')?.dataset.seat as SeatPosition | undefined;
  const pointer = cameraCoordinates(event);
  const point = card.zone === 'battlefield' && seatId ? screenToMat(cameraView.value, pointer.x, pointer.y, seatId) : undefined;
  const position = clampCardPosition(card.x, card.y, card.tapped);
  const offset = point ? { x: point.x - CARD_AREA.left - position.x / 100 * CARD_AREA.width, y: point.y - CARD_AREA.top - position.y / 100 * CARD_AREA.height } : { x: 0, y: 0 };
  const source = event.currentTarget as HTMLElement;
  const cardElement = source.matches('.board-card-wrap') ? source : source.querySelector<HTMLElement>('.card-tile') ?? source;
  const bounds = cardElement.getBoundingClientRect();
  // Battlefield cards are projected through the table camera, so their screen
  // bounds are foreshortened. Use those bounds to derive scale, then restore
  // the card's real aspect ratio for the floating copy.
  const scale = Math.sqrt((bounds.width * bounds.height) / (CARD_SIZE.width * CARD_SIZE.height));
  const width = CARD_SIZE.width * scale;
  const height = CARD_SIZE.height * scale;
  dragCard.value = { id, zone: card.zone, seatId, startX: event.clientX, startY: event.clientY, moved: false, offset };
  dragGhost.value = {
    x: event.clientX - (event.clientX - bounds.left) / Math.max(1, bounds.width) * width,
    y: event.clientY - (event.clientY - bounds.top) / Math.max(1, bounds.height) * height,
    width, height,
    offsetX: (event.clientX - bounds.left) / Math.max(1, bounds.width) * width,
    offsetY: (event.clientY - bounds.top) / Math.max(1, bounds.height) * height,
  };
  event.preventDefault();
  selectedCardId.value = id; (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}
function finishDrag(event: PointerEvent): void {
  if (!dragCard.value) return;
  const { id, zone: sourceZone, seatId: sourceSeatId, moved, offset } = dragCard.value;
  const pointer = cameraCoordinates(event);
  const target = dropTargetAt(event.clientX, event.clientY);
  const destination = target?.zone;
  const targetSeatId = target?.seatId as SeatPosition | undefined;
  if (moved && destination === 'library' && sourceZone === 'revealed') {
    revealSinglePrompt.value = id; suppressClickId.value = id;
  } else if (moved && destination === 'battlefield' && targetSeatId && targetSeatId === props.seatId) {
    const card = props.state.cards[id];
    const position = screenToCardPosition(cameraView.value, pointer.x, pointer.y, targetSeatId, card?.tapped, sourceZone === 'battlefield' && targetSeatId === sourceSeatId ? offset : { x: 0, y: 0 });
    if (position && sourceZone === 'battlefield' && targetSeatId === sourceSeatId) emitAction({ type: 'REPOSITION_CARD', cardId: id, ...position });
    else if (position && card && card.zone !== 'battlefield') emitAction({ type: 'MOVE_CARD', cardId: id, zone: 'battlefield', ...position });
    suppressClickId.value = id;
  } else if (moved && destination === 'battlefield' && targetSeatId && targetSeatId !== props.seatId) {
    const targetSeat = props.state.seats.find(seat => seat.id === targetSeatId && seat.status === 'playing');
    const movingCard = props.state.cards[id];
    suppressClickId.value = id;
    if (sourceZone === 'battlefield' && targetSeat && movingCard && props.state.seats.some(seat => seat.id === movingCard.ownerId && seat.commanderIds.includes(movingCard.cardId))) {
      void openCommanderPrompt(id, { type: 'TRANSFER_CONTROL', cardId: id, seatId: targetSeatId }, event.clientX, event.clientY);
    } else if (sourceZone === 'battlefield' && targetSeat) void openTransferPrompt(id, targetSeatId, targetSeat.name, event.clientX, event.clientY);
  } else if (moved && destination === 'command' && targetSeatId) {
    emitAction({ type: 'MOVE_CARD', cardId: id, zone: 'command' });
    suppressClickId.value = id;
  } else if (moved && destination === 'stack' && ['hand', 'command'].includes(sourceZone)) {
    emitAction({ type: 'CAST', cardId: id });
    suppressClickId.value = id;
  } else if (moved && (destination === 'graveyard' || destination === 'exile')) {
    emitAction({ type: 'MOVE_CARD', cardId: id, zone: destination });
    suppressClickId.value = id;
  } else if (moved && destination === 'hand') {
    emitAction({ type: 'MOVE_CARD', cardId: id, zone: 'hand' });
    suppressClickId.value = id;
  }
  if (suppressClickId.value === id) {
    suppressClickId.value = id; window.setTimeout(() => { suppressClickId.value = ''; }, 120);
  }
  dragCard.value = undefined;
  dragGhost.value = undefined;
  hoveredDropKey.value = '';

}
function startPan(event: PointerEvent): void {
  if (event.pointerType !== 'touch' || pointerOnControl(event) || cameraMode.value !== 'seat' || contextMenu.value || reducedMotion.value) return;
  touchLook.value = { x: event.clientX, y: event.clientY, ...requestedLook };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}
function updatePointer(event: PointerEvent): void {
  if (contextMenu.value) {
    if (event.pointerType === 'mouse' && hasVirtualCursor.value && handCursorSurface(event.target)) followLocalCursor(event);
    return;
  }
  // Hovering a card or another control must not stop camera tracking. Only an
  // open inspection overlay owns the pointer and freezes the camera.
  if (!dragCard.value && (inspectionOpen.value || inspectionPending.value)) {
    freezeCamera();
    if (event.pointerType === 'mouse' && hasVirtualCursor.value && handCursorSurface(event.target)) followLocalCursor(event);
    return;
  }
  if (dragCard.value) {
    if (!dragCard.value.moved && Math.hypot(event.clientX - dragCard.value.startX, event.clientY - dragCard.value.startY) > 4) {
      dragCard.value.moved = true;
      if (dragCard.value.zone === 'hand') {
        handPointerInside.value = false;
        handDragCanReopen.value = false;
      }
    }
    if (dragCard.value.moved) {
      const target = dropTargetAt(event.clientX, event.clientY);
      const nextDropKey = target ? dropKey(target.zone, target.seatId) : '';
      if (hoveredDropKey.value !== nextDropKey) hoveredDropKey.value = nextDropKey;
      if (dragCard.value.zone === 'hand') {
        if (!handDragCanReopen.value && !pointerInOwnHand(event.clientX, event.clientY, true)) handDragCanReopen.value = true;
        handPointerInside.value = handDragCanReopen.value && pointerInOwnHand(event.clientX, event.clientY);
      }
      if (dragGhost.value) {
        dragGhost.value.x = event.clientX - dragGhost.value.offsetX;
        dragGhost.value.y = event.clientY - dragGhost.value.offsetY;
      }
      if (handTargetAllowed(event.target)) {
        const card = props.state.cards[dragCard.value.id];
        const cardBack = ['hand', 'library'].includes(dragCard.value.zone) || Boolean(card?.faceDown);
        const publicCardId = card && !cardBack ? card.id : undefined;
        updateOwnHand(event, 'grab', publicCardId, undefined, cardBack);
      }
      trackCameraPointer(event);
    }
    return;
  }
  if (touchLook.value && event.pointerType === 'touch') {
    setLook(touchLook.value.yaw + (event.clientX - touchLook.value.x) * 0.15, touchLook.value.pitch, touchLook.value.lean + (touchLook.value.y - event.clientY) / (stageSize.value.height / 2));
    return;
  }
  if (event.pointerType === 'mouse' && hasVirtualCursor.value) {
    if (handCursorSurface(event.target)) {
      if (handTargetAllowed(event.target)) updateOwnHand(event, 'follow');
      else followLocalCursor(event);
    } else if (event.target instanceof Element && event.target.closest('.table-stage') && localHand.value?.pose !== 'rest') restOwnHand();
  } else if (handTargetAllowed(event.target)) updateOwnHand(event, 'follow');
  trackCameraPointer(event);
}
function endPointer(event: PointerEvent): void {
  flushPointer();
  if (event.pointerId === revealTouchPointer) {
    revealTouchPointer = undefined;
    revealTouchClickPointer = event.pointerId;
    clearTimeout(revealTouchClickTimer);
    revealTouchClickTimer = setTimeout(() => { revealTouchClickPointer = undefined; }, 400);
    if (event.type === 'pointercancel') resetHandExpansion();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (handledPointerUps.has(event)) return;
  handledPointerUps.add(event);
  const wasDragging = dragCard.value?.moved;
  const endedInsideHand = Boolean(wasDragging && pointerInOwnHand(event.clientX, event.clientY));
  if (event.type === 'pointercancel') { dragCard.value = undefined; dragGhost.value = undefined; hoveredDropKey.value = ''; if (wasDragging) restOwnHand(); }
  else {
    finishDrag(event);
    if (wasDragging && !contextMenu.value) {
      const bounds = frameBounds(stageElement.value);
      if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom && handTargetAllowed(event.target)) updateOwnHand(event, 'follow');
      else restOwnHand();
    } else if (!wasDragging && !touchLook.value && event.button === 0 && handTargetAllowed(event.target)) {
      const gestureId = `${props.seatId}-${Date.now().toString(36)}-${(++handSequence).toString(36)}`;
      lastHandPointerTapAt = performance.now();
      updateOwnHand(event, 'point', undefined, gestureId);
      if (handTapTimer) clearTimeout(handTapTimer);
      handTapTimer = setTimeout(() => {
        const current = localHand.value;
        if (current?.gestureId === gestureId) queueHandPresence({ x: current.x, y: current.y, zone: current.zone, pose: 'follow', ...(current.pointerX === undefined ? {} : { pointerX: current.pointerX, pointerY: current.pointerY }) });
      }, 720);
    }
  }
  touchLook.value = undefined;
  if (event.type === 'pointercancel') resetHandExpansion();
  else if (wasDragging) {
    handPointerInside.value = endedInsideHand;
    if (event.pointerType === 'touch') handTouchOpen.value = handPointerInside.value;
  }
  handDragCanReopen.value = true;
}
function setZoomImmediately(fov: number): void {
  if (zoomFrame) cancelAnimationFrame(zoomFrame);
  zoomFrame = 0;
  zoomFrameAt = 0;
  requestedFov = cameraFov.value = fov;
}
function zoomTick(now: number): void {
  const elapsed = zoomFrameAt ? Math.min(64, now - zoomFrameAt) : 16;
  zoomFrameAt = now;
  cameraFov.value += (requestedFov - cameraFov.value) * (1 - Math.exp(-elapsed / 90));
  if (Math.abs(requestedFov - cameraFov.value) > 0.01) zoomFrame = requestAnimationFrame(zoomTick);
  else setZoomImmediately(requestedFov);
}
function changeZoom(amount: number): void {
  if (dragCard.value || contextMenu.value) return;
  requestedFov = Math.min(FOV_LIMITS.max, Math.max(FOV_LIMITS.min, requestedFov + amount));
  if (reducedMotion.value) setZoomImmediately(requestedFov);
  else if (!zoomFrame && requestedFov !== cameraFov.value) zoomFrame = requestAnimationFrame(zoomTick);
}
function zoom(event: WheelEvent): void {
  if (!(event.target instanceof Element)) { changeZoom(event.deltaY < 0 ? -4 : 4); return; }
  if (event.target.closest('.own-hand-fan, .modal-scrim, .inspection-overlay')) return;
  changeZoom(event.deltaY < 0 ? -4 : 4);
}
function focusOwnSeat(): void { cameraMode.value = props.seatId ? 'seat' : 'overview'; setZoomImmediately(stageSize.value.width <= 700 ? 70 : 55); setLook(0, 0, 0); }
function focusTable(): void { cameraMode.value = 'overview'; setZoomImmediately(stageSize.value.width <= 700 ? 70 : 55); setLook(0, 0, 0); }
function clickCard(id: string): void { if (suppressClickId.value === id) return; select(id); }
function selectFieldCard(id: string, event?: MouseEvent): void { clickCard(id); if (event) handPointerClick(event); }
function clickHandCard(id: string): void {
  if (suppressClickId.value === id) return;
  if (props.state.phase === 'mulligan') toggleBottom(id); else select(id);
}
function doubleClickCard(id: string): void {
  if (suppressClickId.value === id) return;
  const card = props.state.cards[id];
  if (card?.zone === 'battlefield' && card.controllerId === props.seatId) emitAction({ type: 'TAP', cardId: id });
  selectedCardId.value = id;
}
function inspectCard(id: string, event?: MouseEvent): void {
  if (!cardMenuOptions(props.state, id, props.seatId, props.spectator).some(option => option.id === 'inspect')) return;
  closeCardInspection(true);
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : menuOpener?.dataset.menuCard === id ? menuOpener : undefined;
  const element = (trigger ?? [...document.querySelectorAll<HTMLElement>('[data-menu-card]')].find(item => item.dataset.menuCard === id && item.getClientRects().length))?.querySelector<HTMLElement>('.card-tile');
  if (!element) return;
  const opener = element.closest<HTMLElement>('button, [tabindex]') ?? element;
  openCardInspection({ element, opener, read: () => ({ card: props.state.cards[id] }) });
  freezeCamera();
}
function closeInspection(): void { closeCardInspection(); }
function menuTargetFor(element: Element): MenuTarget | undefined {
  const card = element.closest<HTMLElement>('[data-menu-card]')?.dataset.menuCard;
  if (card) return { kind: 'card', cardId: card };
  const hand = element.closest<HTMLElement>('[data-menu-hand-seat]')?.dataset.menuHandSeat as TableSeatId | undefined;
  if (hand && hand !== props.seatId && props.state.seats.some(seat => seat.id === hand)) return { kind: 'hand', seatId: hand };
  const player = element.closest<HTMLElement>('.seat-life-panel')?.closest<HTMLElement>('.seat-place')?.dataset.seat as TableSeatId | undefined;
  if (player && validTableTarget({ kind: 'player', seatId: player })) return { kind: 'player', seatId: player };
  const deck = element.closest<HTMLElement>('[data-menu-deck]')?.dataset.menuDeck;
  if (deck) return { kind: 'deck', seatId: deck };
  if (element.closest('.table-stage') && !element.closest('button, input, select, .own-hand-fan, [data-menu-hand-seat]')) return { kind: 'background' };
}
const menuOptions = computed<TableMenuOption[]>(() => {
  const target = contextMenu.value?.target;
  if (!target) return [];
  if (target.kind === 'hand') return isMine.value && props.online && !(props.handReveals ?? []).some(reveal => reveal.ownerSeatId === target.seatId)
    ? [{ id: 'request-hand-reveal', label: t('table.requestHandReveal'), disabled: Boolean(props.busy) || props.state.phase === 'finished' }]
    : [];
  if (target.kind === 'player') return isMine.value ? [{ id: 'target-select', label: t('table.targetSelect') }] : [];
  if (target.kind === 'card') return [...cardMenuOptions(props.state, target.cardId, props.seatId, props.spectator, props.busy).map(option => {
    const card = props.state.cards[target.cardId];
    const key = option.id === 'tap' ? card.tapped ? 'table.menuTap' : 'table.menuUntap' : option.id === 'face-down' ? card.faceDown ? 'table.menuRevealFaceDown' : 'table.menuFaceDown' : `table.menu${option.id[0].toUpperCase()}${option.id.slice(1)}`;
    return { ...option, label: t(key) };
  }), ...(isMine.value && validTableTarget({ kind: 'card', cardId: target.cardId }) ? [{ id: 'target-select', label: t('table.targetSelect') }, { id: 'target-from', label: t('table.targetFrom') }] : [])];
  if (target.kind === 'deck') {
    if (target.seatId !== props.seatId || !isMine.value) return [{ id: 'private', label: t('table.menuPrivateLibrary'), disabled: true }];
    const disabled = Boolean(props.busy || props.state.paused || props.state.phase === 'finished' || selfSeat.value?.status !== 'playing');
    return [{ id: 'draw', label: t('table.buyCard'), disabled: disabled || props.state.phase === 'mulligan', action: { type: 'DRAW' } }, { id: 'search', label: t('table.searchLibraryMenu'), disabled }, { id: 'shuffle', label: t('table.shuffleLibraryMenu'), disabled, action: { type: 'SHUFFLE' } }];
  }
  return [
    { id: 'own-seat', label: t('table.ownSeat'), disabled: !props.seatId }, { id: 'overview', label: t('table.overview') },
    ...(isMine.value ? [{ id: 'playmat', label: t('table.personalizePlaymat') }] : []),
  ];
});
const menuCard = computed(() => contextMenu.value?.target.kind === 'card' ? props.state.cards[contextMenu.value.target.cardId] : undefined);
const menuTitle = computed(() => contextMenu.value?.target.kind === 'player' ? t('table.lifeOf', { name: seatAt(contextMenu.value.target.seatId)?.name }) : contextMenu.value?.target.kind === 'hand' ? t('table.opponentHand', { name: seatAt(contextMenu.value.target.seatId)?.name, count: hiddenCount(seatAt(contextMenu.value.target.seatId)!, 'hand') }, hiddenCount(seatAt(contextMenu.value.target.seatId)!, 'hand')) : menuCard.value ? menuCard.value.faceDown || !menuCard.value.card ? t('table.faceDownCard') : menuCard.value.card.name : contextMenu.value?.target.kind === 'deck' ? t('table.zones.library') : t('table.gameTable'));
function closeMenu(): void {
  contextMenu.value = undefined;
  if (menuOpener?.isConnected) menuOpener.focus({ preventScroll: true });
}
function openContext(element: HTMLElement, x: number, y: number): void {
  const target = menuTargetFor(element);
  if (!target) return;
  freezeCamera();
  dragCard.value = undefined; dragGhost.value = undefined; hoveredDropKey.value = ''; touchLook.value = undefined;
  closeCardInspection(true);
  menuOpener = element.closest<HTMLElement>('[data-menu-card], [data-menu-deck], [tabindex], button') ?? stageElement.value;
  contextMenu.value = { target, x, y };
}
function onContext(event: MouseEvent): void {
  event.preventDefault();
  if (event.target instanceof HTMLElement) openContext(event.target, event.clientX, event.clientY);
}
async function chooseMenu(id: string): Promise<void> {
  // Read the current options again: a synchronized action may have changed the zone or controller.
  const option = menuOptions.value.find(item => item.id === id);
  if (!option || option.disabled) return;
  const cardId = menuCard.value?.id;
  const menuTarget = contextMenu.value?.target;
  const menuPoint = contextMenu.value ? { x: contextMenu.value.x, y: contextMenu.value.y } : undefined;
  closeMenu();
  await nextTick();
  if (option.action) {
    if (cardId) {
      const current = cardMenuOptions(props.state, cardId, props.seatId, props.spectator, props.busy).find(item => item.id === id);
      if (current?.action && !current.disabled) emitAction(current.action);
    } else emitAction(option.action);
    return;
  }
  if (id === 'target-select' && menuTarget?.kind === 'player') publishTarget({ kind: 'player', seatId: menuTarget.seatId });
  if (id === 'request-hand-reveal' && menuTarget?.kind === 'hand') emit('request-hand-reveal', menuTarget.seatId);
  if (id === 'target-select' && cardId) publishTarget({ kind: 'card', cardId });
  if (id === 'target-from' && cardId) { targetSource.value = { kind: 'card', cardId }; targetPreviewPoint.value = menuPoint; }
  if (id === 'inspect' && cardId) inspectCard(cardId);
  if (id === 'search') searchOpen.value = true;
  if (id === 'own-seat') focusOwnSeat();
  if (id === 'overview') focusTable();
  if (id === 'playmat') openPlaymats();
}
function cancelLongPress(): void { clearTimeout(longPressTimer); longPressPoint = undefined; }
function startLongPress(event: PointerEvent): void {
  if (event.pointerType !== 'touch' || !(event.target instanceof HTMLElement) || event.target.closest('.card-counter-controls') || !menuTargetFor(event.target)) return;
  cancelLongPress();
  longPressPoint = { x: event.clientX, y: event.clientY, target: event.target };
  longPressTimer = setTimeout(() => {
    if (!longPressPoint) return;
    suppressTouchClick = true;
    openContext(longPressPoint.target, longPressPoint.x, longPressPoint.y);
    cancelLongPress();
  }, 500);
}
function moveLongPress(event: PointerEvent): void {
  if (longPressPoint && Math.hypot(event.clientX - longPressPoint.x, event.clientY - longPressPoint.y) > 8) cancelLongPress();
}
let pointerFrame = 0;
let pendingPointer: { event: PointerEvent; table: boolean } | undefined;
function discardPointer(): void {
  if (pointerFrame) cancelAnimationFrame(pointerFrame);
  pointerFrame = 0; pendingPointer = undefined;
}
function flushPointer(): void {
  const pending = pendingPointer;
  discardPointer();
  if (!pending) return;
  updateHandExpansion(pending.event);
  if (pending.table) updatePointer(pending.event);
  else followCursorOutsideTable(pending.event);
}
function queuePointer(event: PointerEvent, table: boolean): void {
  pendingPointer = { event, table };
  if (!pointerFrame) pointerFrame = requestAnimationFrame(flushPointer);
}
const cardTooltip = ref<{ cardId: string; x: number; y: number }>();
const tooltipFace = computed(() => {
  const card = cardTooltip.value && props.state.cards[cardTooltip.value.cardId];
  if (!card?.card || card.faceDown) return undefined;
  const face = card.card.card_faces?.[card.face ?? 0];
  return { name: face?.name || card.card.name, mana: face?.mana_cost || card.card.mana_cost, type: face?.type_line || card.card.type_line };
});
function updateCardTooltip(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const element = target?.closest<HTMLElement>('[data-menu-card]');
  const cardId = element?.dataset.menuCard;
  if (event.pointerType !== 'mouse' || event.buttons || !target?.closest('.table-stage .card-tile') || !cardId || !props.state.cards[cardId]?.card || props.state.cards[cardId]?.faceDown || contextMenu.value || inspectionOpen.value || dragCard.value) {
    cardTooltip.value = undefined;
    return;
  }
  cardTooltip.value = { cardId, x: Math.max(8, Math.min(window.innerWidth - 8, event.clientX)), y: Math.min(window.innerHeight - 48, event.clientY + 35) };
}
function handlePointerMove(event: PointerEvent): void {
  updateCardTooltip(event);
  if (showTutorial.value) return;
  if (moveTargetPointer(event)) return;
  if (event.pointerType === 'mouse') lastMousePoint = { x: event.clientX, y: event.clientY };
  if (event.pointerId === revealTouchPointer) { event.stopPropagation(); return; }
  moveLongPress(event);
  queuePointer(event, true);
}
function followCursorWhileInspecting(event: PointerEvent): void {
  if (showTutorial.value) return;
  queuePointer(event, false);
}
function followCursorOutsideTable(event: PointerEvent): void {
  if (event.pointerType !== 'mouse' || !hasVirtualCursor.value) return;
  if (!handCursorSurface(event.target)) { localCursorVisible.value = false; return; }
  if (dragCard.value) { localCursorVisible.value = true; return; }
  followLocalCursor(event);
}
function endLongPress(): void {
  cancelLongPress();
  if (suppressTouchClick) { clearTimeout(suppressTouchTimer); suppressTouchTimer = setTimeout(() => { suppressTouchClick = false; }, 400); }
}
function handleTableClick(event: MouseEvent): void {
  if (showTutorial.value) return;
  captureClick(event);
  if (!event.defaultPrevented) handPointerClick(event);
}
function captureClick(event: MouseEvent): void {
  if (suppressTargetClick) { event.preventDefault(); event.stopPropagation(); suppressTargetClick = false; return; }
  if (event instanceof PointerEvent && event.pointerId === revealTouchClickPointer) {
    revealTouchClickPointer = undefined;
    event.preventDefault(); event.stopPropagation(); return;
  }
  if (suppressTouchClick) { event.preventDefault(); event.stopPropagation(); suppressTouchClick = false; }
}
function toggleLibraryChoice(ids: string[]): void {
  const allSelected = ids.every(id => searchSelection.value.includes(id));
  searchSelection.value = allSelected ? searchSelection.value.filter(id => !ids.includes(id)) : [...new Set([...searchSelection.value, ...ids])];
}
function finishSearch(): void {
  if (!searchSelection.value.length || searchSelection.value.length > 20 || props.state.paused || props.busy) return;
  emit('actions', [{ type: 'SEARCH_LIBRARY', cardIds: [...searchSelection.value], destination: searchDestination.value }, { type: 'SHUFFLE' }]);
  searchOpen.value = false; searchSelection.value = []; searchQuery.value = '';
}
function concede(): void {
  if (isMine.value && window.confirm(t('table.confirmConcede'))) emitAction({ type: 'CONCEDE' });
}
function commanderTax(seat: PlayerSeat, cardId: string): number { return (seat.commanderCasts?.[cardId] ?? 0) * 2; }
function seatIsOnline(seatId: string): boolean { return Boolean(props.multiplayer && props.onlineSeats?.[seatId as TableSeatId]?.online); }
function seatTurnStatus(seat: PlayerSeat): string {
  return seat.status === 'eliminated' ? t('table.eliminatedStatus')
    : props.state.phase === 'finished' ? t('table.finished')
      : props.state.phase === 'mulligan' ? t('table.preparingHand')
        : seat.id === props.state.activeSeatId ? t('table.currentTurn') : t('table.waiting');
}
function onKeys(event: KeyboardEvent): void {
  if (showTutorial.value) return;
  if (event.key === 'Tab') stageSpaceFocus.value = false;
  keyboardInput = true;
  if (ownHandElement.value?.contains(document.activeElement)) handKeyboardFocus.value = true;
  if (contextMenu.value) return;
  if ((event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') && event.target instanceof HTMLElement && menuTargetFor(event.target)) {
    event.preventDefault(); const box = event.target.getBoundingClientRect(); openContext(event.target, box.left + box.width / 2, box.top + box.height / 2); return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
  if (event.key === 'Escape' && (inspectionOpen.value || inspectionPending.value)) return;
  if (event.key === 'Escape' && showLog.value) { event.preventDefault(); showLog.value = false; return; }
  if (event.key === 'Escape' && openPublicZone.value) { event.preventDefault(); closeZoneFans(); return; }
  if (event.key === 'Escape') { selectedCardId.value = ''; showHelp.value = false; searchOpen.value = false; closeInspection(); return; }
  if (showHelp.value || showSettings.value || showPlaymats.value || searchOpen.value || tokenLibraryOpen.value || showLog.value || inspectionOpen.value || inspectionPending.value) return;
  if (event.key === '?' || (event.shiftKey && event.key === '/')) { showHelp.value = !showHelp.value; event.preventDefault(); return; }
  if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
    event.preventDefault();
    if (event.key.toLowerCase() === 'y' || event.shiftKey) emit('redo');
    else emit('undo');
    return;
  }
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'd') { event.preventDefault(); draw(); return; }
  if (event.ctrlKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) return;
  if (event.ctrlKey || event.altKey || event.metaKey || !isMine.value) return;
  if (event.key === ' ' && !event.shiftKey && !event.defaultPrevented && stackTop.value) {
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, [role="button"]')) return;
    event.preventDefault();
    if (target === stageElement.value) stageSpaceFocus.value = true;
    if (!event.repeat && !props.busy && !props.state.paused && !props.state.passes.includes(props.seatId ?? '')) passPriority();
    return;
  }
  if (event.key.toLowerCase() === 't' && !event.repeat) {
    const hovered = hoveredBattlefieldCard();
    if (hovered) tapCard(hovered);
    else tapSelected();
  }
  if (event.key.toLowerCase() === 'f') flipSelected();
}
function onLogDialogKeys(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); showLog.value = false; return; }
  if (event.key !== 'Tab') return;
  const controls = logDialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])');
  if (!controls?.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function onMotionChange(event: MediaQueryListEvent): void { reducedMotion.value = event.matches; if (event.matches) { setZoomImmediately(requestedFov); freezeCamera(); setLook(0, 0, 0); } }
onMounted(() => {
  void loadTutorialPreference();
  window.addEventListener('click', clearSelectionOutsideCards, true);
  window.addEventListener('scroll', invalidateBounds, true);
  window.addEventListener('keydown', targetKeyDown, true);
  window.addEventListener('keyup', targetKeyUp, true);
  window.addEventListener('blur', blurTargets);
  window.addEventListener('keydown', onKeys);
  window.addEventListener('blur', blurHand);
  window.addEventListener('focus', focusHandWindow);
  window.addEventListener('pointerout', leaveHandWindow);
  window.addEventListener('pointerdown', trackHandOutsidePointerDown, true);
  window.addEventListener('pointermove', followCursorWhileInspecting, true);
  updateStageSize();
  if (stageSize.value.width <= 700) setZoomImmediately(70);
  resizeObserver = new ResizeObserver(updateStageSize);
  if (stageElement.value) resizeObserver.observe(stageElement.value);
  handResizeObserver = new ResizeObserver(measureOwnHand);
  if (ownHandElement.value) handResizeObserver.observe(ownHandElement.value);
  measureOwnHand();
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = motionQuery.matches;
  motionQuery.addEventListener('change', onMotionChange);
  handClockTimer = setInterval(() => { handNow.value = Date.now(); }, 1000);
});
onBeforeUnmount(() => {
  tutorialRequest++;
  clearTimeout(clearSelectionTimer);
  window.removeEventListener('click', clearSelectionOutsideCards, true);
  if (tokenSearchTimer) clearTimeout(tokenSearchTimer);
  tokenSearchController?.abort();
  discardPointer();
  if (boundsFrame) cancelAnimationFrame(boundsFrame);
  boundsCache.clear();
  window.removeEventListener('scroll', invalidateBounds, true);
  window.removeEventListener('keydown', targetKeyDown, true);
  window.removeEventListener('keyup', targetKeyUp, true);
  window.removeEventListener('blur', blurTargets);
  document.body.classList.remove('has-target-mode');
  clearTimeout(targetClickTimer);
  window.removeEventListener('keydown', onKeys);
  window.removeEventListener('blur', blurHand);
  window.removeEventListener('focus', focusHandWindow);
  window.removeEventListener('pointerout', leaveHandWindow);
  window.removeEventListener('pointerdown', trackHandOutsidePointerDown, true);
  window.removeEventListener('pointermove', followCursorWhileInspecting, true);
  resizeObserver?.disconnect(); motionQuery?.removeEventListener('change', onMotionChange);
  handResizeObserver?.disconnect();
  if (cameraFrame) cancelAnimationFrame(cameraFrame);
  closeCardInspection(true);
  clearTimeout(handTapTimer); clearTimeout(handPublishTimer); clearPendingDraw(); clearInterval(handClockTimer);
  cancelLongPress(); clearTimeout(suppressTouchTimer);
  clearTimeout(revealTouchClickTimer);
  clearTimeout(flightTimer);
});
watch(() => [targetSource.value && props.state.cards[targetSource.value.cardId]?.zone, props.handReveals?.map(reveal => reveal.cards.map(card => card.id).join(',')).join('|')], () => { if (targetSource.value && !validTableTarget(targetSource.value)) cancelTarget(); });
watch(() => props.state.id, () => { void loadTutorialPreference(); blurTargets(); selectedCardId.value = ''; selectedBottom.value = []; clearPendingDraw(); closeMenu(); openPublicZone.value = undefined; closeInspection(); restOwnHand(); });
watch(() => props.seatId, () => { focusOwnSeat(); restOwnHand(); });
watch([() => props.state.id, () => props.seatId], resetHandExpansion);
watch(() => ownHand.value.map(card => card.id).join(','), async () => {
  const pending = pendingDraw.value;
  if (!pending) return;
  const drawn = ownHand.value.find(card => !pending.handIds.has(card.id));
  if (!drawn) return;
  clearTimeout(pending.timeout);
  pendingDraw.value = undefined;
  await nextTick();
  const opener = [...(ownHandElement.value?.querySelectorAll<HTMLElement>('.fan-card') ?? [])]
    .find(element => element.dataset.menuCard === drawn.id);
  const element = opener?.querySelector<HTMLElement>('.card-tile');
  if (element && opener) openCardInspection({ element, opener, read: () => ({ card: props.state.cards[drawn.id] }) });
});
watch(ownHandElement, (element, previous) => {
  if (previous) handResizeObserver?.unobserve(previous);
  if (element) handResizeObserver?.observe(element);
  measureOwnHand();
});
watch([() => ownHand.value.map(card => card.id).join(','), selectedCardId, () => selectedBottom.value.join(','), stageSize], () => {
  if (!ownHand.value.length) resetHandExpansion();
  measureOwnHand();
}, { flush: 'post' });
watch(cameraView, () => {
  if (localHand.value?.zone !== 'table' || localHand.value.pose === 'rest' || localHand.value.pointerX === undefined || localHand.value.pointerY === undefined) return;
  const previous = localHand.value;
  const world = screenToTable(cameraView.value, previous.pointerX ?? 0, previous.pointerY ?? 0);
  if (world) queueHandPresence({ ...world, zone: 'table', pose: previous.pose, pointerX: previous.pointerX, pointerY: previous.pointerY, ...(previous.cardId ? { cardId: previous.cardId } : {}), ...(previous.gestureId ? { gestureId: previous.gestureId } : {}) });
}, { flush: 'post' });
watch(prioritySeat, seatId => {
  const angle = SEAT_PLACEMENT[seatId as TableSeatId]?.angle ?? 0;
  stackAngle.value += ((angle - stackAngle.value) % 360 + 540) % 360 - 180;
});
watch(inspectionPending, pending => { if (pending) freezeCamera(); });
watch([showPlaymats, showHelp, showTutorial, searchOpen, tokenLibraryOpen, inspectionOpen], () => {
  if (showPlaymats.value || showHelp.value || showTutorial.value || searchOpen.value || tokenLibraryOpen.value || inspectionOpen.value) freezeCamera();
});
</script>

<template>
  <main class="table-shell" :class="{ 'motion-reduced': reducedMotion, 'has-virtual-cursor': hasVirtualCursor }" :style="geometryStyle" @contextmenu="onContext" @dragstart.prevent @pointermove.capture="handlePointerMove" @pointerleave="cardTooltip = undefined" @pointerdown.capture="cardTooltip = undefined; handlePointerDown($event)" @pointerup.capture="handleTablePointerUp" @pointercancel.capture="handleTablePointerUp" @click.capture="handleTableClick">
    <header class="table-topbar">
      <div class="table-brand"><img class="brand-logo" :src="meuMagicLogo" alt="" aria-hidden="true"/><span>{{ t('app.name') }}</span></div>
      <button v-if="multiplayer && roomCode" class="room-code-badge table-room-code" @click="emit('copy-room-code')"><span>{{ t('lobby.inviteCode') }}</span><strong>{{ roomCode }}</strong><small>{{ t('lobby.copyCode') }}</small></button>
      <div class="match-meta"><span class="connection-mark" :class="online ? 'is-live' : ''"></span><span>{{ online ? t('table.liveRoom') : t('table.localDemo') }}</span><i></i><span>COMMANDER</span><i></i><span>{{ t('table.round', { count: state.turn }) }}</span></div>
      <div class="topbar-actions"><button class="icon-button" :title="t('table.overview')" @click="focusTable">⌖</button><button class="icon-button" :title="t('table.ownSeat')" @click="focusOwnSeat">◎</button><button class="icon-button settings-top" :aria-label="t('table.settings')" :title="t('table.settings')" @click="openSettings">⚙</button><button v-if="isMine" class="playmat-top-button" @click="openPlaymats">{{ t('table.personalizePlaymat') }}</button><button class="icon-button help-top" :title="t('table.shortcuts')" @click="showHelp = true">?</button><button class="leave-button" @click="emit('leave')">{{ t('table.leave') }} <span>↗</span></button><slot name="header-actions" /></div>
    </header>
    <div v-if="state.paused || disconnectedPlayers.length" class="table-pause-banner"><span>Ⅱ</span><div><strong>{{ t('table.paused') }}</strong><small>{{ state.paused ? t('table.pausedDescription', { name: disconnectedPlayers.find(player => !player.suspended)?.name ?? '' }) : disconnectedPlayers.map(player => `${player.name} · ${t('table.suspended')}`).join(' · ') }}</small><button v-for="player in disconnectedPlayers.filter(player => !player.suspended)" v-show="isHost && state.phase === 'playing'" :key="player.id" class="button button-ghost" :disabled="busy" @click.stop="emit('continue-without', player.id)">{{ t('table.continueWithout', { name: player.name }) }}</button></div><span>{{ t('table.synced') }}</span></div>

    <div class="game-layout">
      <section ref="stageElement" class="table-stage" :class="{ 'space-focus': stageSpaceFocus }" tabindex="0" :aria-label="t('table.gameTable')" @blur="stageSpaceFocus = false" @wheel.prevent="zoom" @pointerdown="startPan" @pointerup="endPointer" @pointercancel="endPointer" @pointerleave="leaveStage">
        <div ref="sceneViewport" class="scene-viewport">
        <div ref="cameraScene" class="camera-scene">
          <div class="felt-board">
            <div v-for="seatId in seatOrder" :key="seatId" class="seat-place" :style="matStyle(seatId)" :data-seat="seatId">
            <div v-if="seatId === (props.seatId ?? 'southEast')" class="table-app-version">
              <span>{{ t('table.appVersion', { version: appVersion }) }}</span>
              <button v-if="updateAvailable" type="button" @pointerdown.stop @click.stop="emit('open-update')">{{ t('table.updateApp') }} ↗</button>
            </div>
            <div v-if="seatId !== props.seatId" class="seat-nameplate" :class="{ 'is-empty': !seatAt(seatId) }" :aria-label="seatAt(seatId)?.name ?? t('table.emptySeat')">
              <span class="player-dot" :class="seatAt(seatId) && seatIsOnline(seatId) ? 'is-online' : 'is-offline'" role="img" :aria-label="seatAt(seatId) && seatIsOnline(seatId) ? t('table.online') : t('table.offline')"></span>
              <strong :title="seatAt(seatId)?.name ?? t('table.emptySeat')">{{ seatAt(seatId)?.name ?? t('table.emptySeat') }}</strong>
            </div>
            <section v-if="seatAt(seatId)" class="seat-life-panel" :class="{ 'is-self': seatId === props.seatId }" :aria-label="t('table.lifeOf', { name: seatAt(seatId)?.name })">
              <button v-if="isMine && seatId === props.seatId" class="seat-life-adjust" :aria-label="t('table.decreaseLife', { name: seatAt(seatId)?.name })" :disabled="busy || state.paused || state.phase === 'finished'" @click.stop="emitAction({type:'SET_LIFE',amount:-1,seatId})">−</button>
              <div class="seat-life-reading" tabindex="0" role="group" :aria-label="t('table.lifeOf', { name: seatAt(seatId)?.name })"><strong class="seat-life-value" aria-live="polite" aria-atomic="true">{{ seatAt(seatId)?.life }}</strong><span>{{ seatAt(seatId)?.name }} <i>·</i> {{ t('table.life') }}</span><small v-if="seatAt(seatId)?.poison" class="seat-poison">☠ {{ seatAt(seatId)?.poison }} {{ t('table.poison') }}</small></div>
              <button v-if="isMine && seatId === props.seatId" class="seat-life-adjust" :aria-label="t('table.increaseLife', { name: seatAt(seatId)?.name })" :disabled="busy || state.paused || state.phase === 'finished'" @click.stop="emitAction({type:'SET_LIFE',amount:1,seatId})">+</button>
            </section>
            <nav v-if="seatId === props.seatId && isMine && seatAt(seatId)" class="phase-navigation" :aria-label="t('table.phaseNavigation')">
              <button type="button" :disabled="!ownTurnActive || ownStepIndex <= 0 || busy || state.paused || state.phase === 'finished'" :aria-label="t('table.previousStep')" @click.stop="previousStep"><span aria-hidden="true">‹</span>{{ t('table.previousStep') }}</button>
              <button type="button" :disabled="!ownTurnActive || busy || state.paused || state.phase === 'finished'" :aria-label="state.step === 'Final' ? t('table.endTurn') : t('table.nextStep')" @click.stop="nextStep">{{ state.step === 'Final' ? t('table.endTurn') : t('table.nextStep') }}<span aria-hidden="true">›</span></button>
            </nav>
            <section v-if="seatId === props.seatId && isMine && seatAt(seatId)" class="turn-timeline" :class="{ 'is-own-turn': ownTurnActive }" :aria-label="t('table.turnSteps')">
              <header><span>{{ t('table.stepsHeading') }}</span></header>
              <ol><li v-for="(step, index) in phaseSteps" :key="step" :class="{ 'is-current': index === timelineStepIndex, 'is-complete': timelineStepIndex > index }"><button class="timeline-step-button" type="button" :aria-current="index === timelineStepIndex ? 'step' : undefined" :disabled="!ownTurnActive || busy || state.paused || state.phase === 'finished'" :title="t(`table.steps.${step}`)" @click.stop="selectTimelineStep(step)"><span class="timeline-node">{{ String(index + 1).padStart(2, '0') }}</span><b>{{ t(`table.steps.${step}`) }}</b></button></li></ol>
            </section>
            <section class="player-mat" :class="[`mat-${seatId}`, seatId === props.seatId ? 'is-self' : '', { 'is-drop-ready': dropReady('battlefield', seatId), 'is-drop-hovered': dropHovered('battlefield', seatId) }]" data-drop-zone="battlefield" :data-seat="seatId">
              <PlaymatArt v-if="!customPlaymatsDisabled && validPlaymatId(playmatIds[seatId])" class="playmat-art" :id="playmatIds[seatId]" />
              <template v-if="seatAt(seatId)">
                <TableField :cards="cardsFor(seatAt(seatId)!, 'battlefield')" :seat-id="seatId" :selected-id="selectedCardId" :arriving-id="arrivingCardId" :drag-id="dragCard?.id" :drag-moved="dragCard?.moved" :reduced-motion="reducedMotion" :can-adjust-counters="!busy && !state.paused && state.phase !== 'finished' && selfSeat?.status === 'playing'" :spectator="spectator" @drag="startDrag" @select="selectFieldCard" @activate="doubleClickCard" @tap="tapCard" @counter="adjustCardCounter" />
                <section v-if="seatAt(seatId)!.libraryRevealOpen" class="library-reveal-mat" data-drop-zone="revealed" :data-seat="seatId" :aria-label="t('table.libraryRevealTitle', { name: seatAt(seatId)!.name })" @pointerdown.stop>
                  <header><strong>{{ t('table.libraryRevealTitle', { name: seatAt(seatId)!.name }) }}</strong><template v-if="seatId === props.seatId && isMine"><button type="button" :disabled="busy || state.paused || !selfSeat?.library.length" @click.stop="emitAction({ type: 'REVEAL_LIBRARY_TOP' })">{{ t('table.revealNext') }}</button><button type="button" :disabled="busy || state.paused" :aria-label="t('common.close')" @click.stop="moveRevealed('top', undefined, true)">×</button></template></header>
                  <div class="library-reveal-cards"><button v-for="card in revealedFor(seatAt(seatId)!)" :key="card.id" type="button" :data-menu-card="card.id" :aria-label="card.card?.name ?? t('table.card')" @pointerdown.stop="startDrag($event, card.id)" @click.stop="select(card.id)" @dblclick.stop="inspectCard(card.id, $event)"><CardTile :card="card" :compact="true" /></button></div>
                  <footer v-if="seatId === props.seatId && isMine"><span>{{ t('table.revealActions') }}</span><button v-for="destination in (['top', 'bottom', 'graveyard', 'exile', 'hand'] as const)" :key="destination" type="button" :disabled="busy || state.paused || !seatAt(seatId)!.libraryRevealed?.length" @click.stop="moveRevealed(destination)">{{ t(`table.revealDestination.${destination}`) }}</button></footer>
                  <footer v-if="seatId === props.seatId && isMine && selectedCard?.zone === 'revealed' && selectedCard.ownerId === seatId"><span>{{ selectedCard.card?.name }}</span><button type="button" @click.stop="inspectCard(selectedCard.id)">{{ t('table.menuInspect') }}</button><button type="button" :disabled="busy || state.paused" @click.stop="emitAction({ type: 'MOVE_CARD', cardId: selectedCard!.id, zone: 'battlefield' })">{{ t('table.zones.battlefield') }}</button><button v-for="destination in (['top', 'bottom', 'graveyard', 'exile', 'hand'] as const)" :key="destination" type="button" :disabled="busy || state.paused" @click.stop="moveRevealed(destination, [selectedCard!.id])">{{ t(`table.revealDestination.${destination}`) }}</button></footer>
                </section>
                <div v-if="seatId === props.seatId && !spectator" class="hand-count" data-drop-zone="hand" :data-seat="seatId"><span>{{ hiddenCount(seatAt(seatId)!, 'hand') }} {{ t('table.handCount') }}</span></div>
                <div class="mat-mark">{{ seatId === 'southWest' ? '01' : seatId === 'southEast' ? '02' : seatId === 'northEast' ? '03' : '04' }} <i>·</i> {{ t('table.gameZone') }}</div>
              </template>
              <div v-else class="empty-seat"><span>＋</span><strong>{{ t('table.waitingPlayer') }}</strong><small>{{ t('table.invitePlayer') }}</small></div>
            </section>
            <template v-if="seatAt(seatId)">
              <OpponentHand v-if="spectator || seatId !== props.seatId" :count="hiddenCount(seatAt(seatId)!, 'hand')" :player-name="seatAt(seatId)!.name" :seat-id="seatId" />
              <RevealedHand v-if="handReveals?.find(reveal => reveal.ownerSeatId === seatId)" v-bind="handReveals.find(reveal => reveal.ownerSeatId === seatId)!" :can-close="seatId === props.seatId && isMine" @close="emit('end-hand-reveal')" />
              <div class="seat-zones-left">
                <div class="library-zone-group">
                  <div v-if="seatId === props.seatId && isMine" class="deck-actions" :aria-label="t('table.libraryActions')">
                    <button class="deck-action" :disabled="busy || state.paused || state.phase === 'finished' || selfSeat?.status !== 'playing' || state.phase === 'mulligan'" :title="t('table.drawCard')" :aria-label="t('table.drawCard')" @click.stop="draw"><span>↧</span><small>{{ t('table.draw') }}</small></button>
                    <button class="deck-action" :disabled="busy || state.paused || state.phase === 'finished' || selfSeat?.status !== 'playing'" :title="t('table.searchLibrary')" :aria-label="t('table.searchLibrary')" @click.stop="searchOpen = true"><span>⌕</span><small>{{ t('table.search') }}</small></button>
                    <button class="deck-action" :disabled="busy || state.paused || state.phase === 'finished' || selfSeat?.status !== 'playing' || selfSeat?.libraryRevealOpen" :title="t('table.revealLibrary')" :aria-label="t('table.revealLibrary')" @click.stop="emitAction({ type: 'OPEN_LIBRARY_REVEAL' })"><span>◉</span><small>{{ t('table.reveal') }}</small></button>
                    <button class="deck-action" :disabled="busy || state.paused || state.phase === 'finished' || selfSeat?.status !== 'playing'" :title="t('table.shuffleLibrary')" :aria-label="t('table.shuffleLibrary')" @click.stop="emitAction({type:'SHUFFLE'})"><span>⤨</span><small>{{ t('table.shuffle') }}</small></button>
                  </div>
                  <button class="physical-zone library-pile" data-drop-zone="library" :data-seat="seatId" :class="{ 'is-stacked': hiddenCount(seatAt(seatId)!, 'library') > 0 }" :data-menu-deck="seatId" :aria-label="t('table.libraryOf', { name: seatAt(seatId)?.name, count: hiddenCount(seatAt(seatId)!, 'library') }, hiddenCount(seatAt(seatId)!, 'library'))" @click.stop="seatId === props.seatId && isMine ? draw() : undefined">
                    <PhysicalCardStack v-if="hiddenCount(seatAt(seatId)!, 'library') > 0" :count="hiddenCount(seatAt(seatId)!, 'library')" :seed="`${seatId}:library`">
                      <template #caption><span class="zone-caption">{{ t('table.zones.library').toUpperCase() }} <b>{{ hiddenCount(seatAt(seatId)!, 'library') }}</b></span></template>
                    </PhysicalCardStack>
                    <span v-else class="empty-zone-mark" aria-hidden="true">∅</span>
                    <span v-if="hiddenCount(seatAt(seatId)!, 'library') === 0" class="zone-caption">{{ t('table.zones.library').toUpperCase() }} <b>0</b></span>
                  </button>
                </div>
                <div v-for="zone in (['graveyard','exile'] as const)" :key="zone" class="zone-pile-wrap" :style="{ '--zone-index': zone === 'graveyard' ? 1 : 2 }" :data-zone-key="zoneFanKey(seatId, zone)" :class="{ 'fan-is-open': zoneFanOpen(seatId, zone) }">
                  <button class="physical-zone public-zone-toggle" :class="[`physical-${zone}`, { 'is-stacked': ownerCardsFor(seatAt(seatId)!, zone).length > 0, 'is-zone-open': zoneFanOpen(seatId, zone), 'is-drop-ready': dropReady(zone, seatId), 'is-drop-hovered': dropHovered(zone, seatId) }]" :data-drop-zone="zone" :data-seat="seatId" :data-menu-card="ownerCardsFor(seatAt(seatId)!, zone).at(-1)?.id" :aria-expanded="seatId === props.seatId && isMine ? zoneFanOpen(seatId, zone) : undefined" :aria-label="zone === 'graveyard' ? t('table.graveyardOf', { name: seatAt(seatId)?.name, count: ownerCardsFor(seatAt(seatId)!, zone).length }, ownerCardsFor(seatAt(seatId)!, zone).length) : t('table.exileOf', { name: seatAt(seatId)?.name, count: ownerCardsFor(seatAt(seatId)!, zone).length }, ownerCardsFor(seatAt(seatId)!, zone).length)" @click.stop="activatePublicZone(seatId, zone, $event.currentTarget as HTMLElement)">
                    <PhysicalCardStack v-if="ownerCardsFor(seatAt(seatId)!, zone).length" :count="ownerCardsFor(seatAt(seatId)!, zone).length" :seed="`${seatId}:${zone}`" :top-card="ownerCardsFor(seatAt(seatId)!, zone).at(-1)">
                      <template #caption><span class="zone-caption">{{ (zone === 'graveyard' ? t('table.graveyard') : t('table.exile')).toUpperCase() }} <b>{{ ownerCardsFor(seatAt(seatId)!, zone).length }}</b></span></template>
                    </PhysicalCardStack>
                    <span v-else class="empty-zone-mark" aria-hidden="true">{{ zone === 'graveyard' ? '⌑' : '⟁' }}</span>
                    <span v-if="ownerCardsFor(seatAt(seatId)!, zone).length === 0" class="zone-caption">{{ (zone === 'graveyard' ? t('table.graveyard') : t('table.exile')).toUpperCase() }} <b>0</b></span>
                  </button>
                  <div v-if="seatId === props.seatId && isMine" class="public-zone-actions">
                    <button type="button" :aria-label="t('table.openZoneAside', { zone: t(`table.zones.${zone}`) })" :title="t('table.openZoneAside', { zone: t(`table.zones.${zone}`) })" :aria-pressed="zoneFanOpen(seatId, zone)" @click.stop="toggleZoneFan(seatId, zone, $event.currentTarget as HTMLElement)"><span aria-hidden="true">⇤</span></button>
                    <button type="button" :aria-label="t('table.searchZone', { zone: t(`table.zones.${zone}`) })" :title="t('table.searchZone', { zone: t(`table.zones.${zone}`) })" @click.stop="openPublicZoneSearch(seatId, zone, $event.currentTarget as HTMLElement)"><span aria-hidden="true">⌕</span></button>
                  </div>
                  <div v-if="zoneFanOpen(seatId, zone)" class="public-zone-fan" :class="[`fan-${zone}`, { 'is-drop-ready': dropReady(zone, seatId), 'is-drop-hovered': dropHovered(zone, seatId) }]" :data-zone-key="zoneFanKey(seatId, zone)" :data-drop-zone="zone" :data-seat="seatId" role="group" :aria-label="`${zone === 'graveyard' ? t('table.graveyard') : t('table.exile')} · ${seatAt(seatId)?.name}`" @wheel.stop @pointerdown.stop>
                    <div v-if="!ownerCardsFor(seatAt(seatId)!, zone).length" class="public-zone-fan-empty">{{ t('table.zoneEmpty') }}</div>
                    <div v-else class="public-zone-fan-grid" :style="{ '--zone-columns': zoneColumns(ownerCardsFor(seatAt(seatId)!, zone).length), '--zone-rows': zoneRows(ownerCardsFor(seatAt(seatId)!, zone).length) }">
                      <button v-for="(card, index) in ownerCardsFor(seatAt(seatId)!, zone)" :key="card.id" class="public-zone-fan-card" :style="zoneCardPosition(index, ownerCardsFor(seatAt(seatId)!, zone).length)" :class="{ 'is-dragging-source': dragCard?.id === card.id && dragCard?.moved }" :data-menu-card="card.id" :aria-label="card.faceDown ? t('table.faceDownCard') : card.card?.name ?? t('table.card')" @pointerdown.stop="startDrag($event, card.id)" @click.stop="suppressClickId !== card.id && inspectCard(card.id, $event)"><CardTile :card="card" /></button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="seat-zones-right">
                <button v-for="card in cardsFor(seatAt(seatId)!, 'command')" :key="card.id" class="physical-zone commander-zone" :data-menu-card="card.id" data-drop-zone="command" :data-seat="seatId" :class="{ 'is-dragging-source': dragCard?.id === card.id && dragCard?.moved, 'is-drop-ready': dropReady('command', seatId), 'is-drop-hovered': dropHovered('command', seatId) }" :aria-label="t('table.commanderLabel', { name: card.card?.name ?? t('table.card') })" @pointerdown.stop="startDrag($event, card.id)" @click.stop="select(card.id)"><CardTile :card="card" :compact="true" /><span class="zone-caption">{{ t('table.commander').toUpperCase() }} <b>+{{ commanderTax(seatAt(seatId)!, card.cardId) }}</b></span></button>
                <div v-if="!cardsFor(seatAt(seatId)!, 'command').length" class="physical-zone empty-command" data-drop-zone="command" :data-seat="seatId" :class="{ 'is-drop-ready': dropReady('command', seatId), 'is-drop-hovered': dropHovered('command', seatId) }"><span class="empty-zone-mark">♛</span><span class="zone-caption">{{ t('table.commander').toUpperCase() }}</span></div>
              </div>
              <div v-if="seatId === props.seatId && isMine" class="general-actions" :aria-label="t('table.generalActions')">
                <button class="deck-action" :disabled="busy || state.paused || state.phase === 'finished' || selfSeat?.status !== 'playing'" :title="t('table.createToken')" :aria-label="t('table.createToken')" @click.stop="tokenLibraryOpen = true"><span>＋</span><small>{{ t('table.createToken') }}</small></button>
                <button class="deck-action" :disabled="busy || state.paused || state.phase === 'finished' || selfSeat?.status !== 'playing'" :title="t('table.concede')" @click.stop="concede"><span>⚑</span><small>{{ t('table.concede') }}</small></button>
              </div>
              <div v-if="seatId === props.seatId && isMine" class="self-table-tools" :aria-label="t('table.yourPlaymatControls')">
                <section class="sidebar-section opponent-lines commander-note" :aria-label="t('table.commanderDamageLabel')">
                  <div class="section-heading"><span>{{ t('table.commanderDamage') }}</span><span class="action-public">{{ t('table.eliminationAt') }}</span></div>
                  <div v-for="group in opposingCommanders" :key="group.seat.id" class="commander-damage-group">
                    <h3>{{ group.seat.name }}</h3>
                    <div v-for="commander in group.commanders" :key="commander.id" class="commander-damage-row" :class="{ 'is-lethal': (selfSeat?.commanderDamage[commander.cardId] ?? 0) >= 21 }" :data-commander-id="commander.id">
                      <span>{{ commander.name }}</span>
                      <div class="commander-damage-counter">
                        <button :aria-label="t('table.reduceCommanderDamage', { commander: commander.name, player: group.seat.name })" :disabled="commanderDamageDisabled || !(selfSeat?.commanderDamage[commander.cardId] ?? 0)" @click.stop="emitAction({type:'ADJUST_COMMANDER_DAMAGE',commanderCardId:commander.id,amount:-1})">−</button>
                        <output :aria-label="t('table.damageReceived', { commander: commander.name, player: group.seat.name })" aria-live="polite">{{ selfSeat?.commanderDamage[commander.cardId] ?? 0 }}</output>
                        <button :aria-label="t('table.increaseCommanderDamage', { commander: commander.name, player: group.seat.name })" :disabled="commanderDamageDisabled" @click.stop="emitAction({type:'ADJUST_COMMANDER_DAMAGE',commanderCardId:commander.id,amount:1})">+</button>
                      </div>
                    </div>
                  </div>
                </section>
                <div v-if="state.phase==='mulligan' && selfSeat && !selfSeat.keptHand" class="mulligan-controls table-mulligan-controls"><span>{{ t('table.mulligan', { count: selfSeat.mulligans, cards: 7 - Math.max(0,selfSeat.mulligans-1) }) }}</span><button class="button button-ghost" @click.stop="emitAction({type:'MULLIGAN'})">{{ t('table.mulliganAction') }}</button><button class="button button-primary" :disabled="selectedBottom.length !== Math.max(0, selfSeat.hand.length - (7-Math.max(0,selfSeat.mulligans-1)))" @click.stop="keepHand">{{ t('table.keepHand') }}</button></div>
              </div>
            </template>
            </div>
            <div class="table-hub" :class="{ 'is-local-priority': isMine && stack.length > 0 && prioritySeat === props.seatId }" :data-priority-seat="prioritySeat" :style="{transform:`translate(-50%,-50%) translateZ(18px) rotate(${stackAngle}deg)`}">
              <svg class="hub-shape" viewBox="0 0 460 400" aria-hidden="true"><path d="M230 12 C120 12 24 52 16 142 C7 226 94 256 156 309 C187 336 195 355 230 382 C265 355 273 336 304 309 C366 256 453 226 444 142 C436 52 340 12 230 12 Z" /></svg>
              <div class="hub-content">
                <header class="hub-heading"><strong>{{ stack.length ? t('table.stack') : t('table.resolved') }}</strong><span v-if="stack.length" class="stack-count">{{ stack.length }}</span></header>
                <span class="priority-player">{{ seatAt(prioritySeat)?.name }}<small v-if="!stack.length">{{ t('table.turnPlayer') }}</small></span>
                <div class="stack-cards" :class="{ 'is-drop-ready': dropReady('stack'), 'is-drop-hovered': dropHovered('stack') }" data-drop-zone="stack">
                  <button v-for="(item, index) in stack.slice(-3)" :key="item.id" class="stack-back" :style="{'--stack-shift':`${(index - (Math.min(stack.length,3)-1)/2)*56}px`,'--stack-angle':`${(index - (Math.min(stack.length,3)-1)/2)*12}deg`}" :data-menu-card="item.sourceId" :aria-label="item.name" @click.stop="inspectCard(item.sourceId, $event)"><CardTile :card="state.cards[item.sourceId]" :compact="true" /><i>{{ item.kind === 'ability' ? 'HABILIDADE' : 'MAGIA' }}</i></button>
                  <span v-if="!stack.length" class="stack-empty"><span>◇</span>{{ t('table.noPending') }}</span>
                </div>
                <button v-if="stackTop && isMine" class="resolve-button" :disabled="busy || state.paused || state.passes.includes(seatId ?? '')" @click.stop="passPriority">{{ state.passes.includes(seatId ?? '') ? t('table.youPassed') : t('table.passPriority') }} <kbd>SPACE</kbd></button>
                <span v-else-if="!stack.length" class="hub-empty-note">{{ t('table.waitingCast') }}</span>
                <div v-if="stack.length" class="pass-dots"><i v-for="seat in activeSeats" :key="seat.id" :class="{passed: state.passes.includes(seat.id)}" :title="seat.name"></i></div>
              </div>
              <div v-if="revealedCards.length" class="revealed-cards"><span>{{ t('table.revealedCards') }}</span><button v-for="card in revealedCards" :key="card.id" :data-menu-card="card.id"><CardTile :card="card" :compact="true" /></button></div>
            </div>
            <span class="board-watermark">M<span>/</span>T</span>
          </div>
        </div>
        </div>
        <ChatBubbles :messages="chatMessages ?? []" :anchors="chatAnchors" />
        <TableMotionLayer :model="motionLayer" />
        <div class="target-announcement" role="status" aria-live="polite" aria-atomic="true">{{ targetAnnouncement }}</div>
        <TableTargetLayer :stage="stageElement" :state="state" :marks="targetMarks ?? emptyTargets" :preview="targetPreview" />
        <div v-if="targetSource" class="target-prompt" role="status"><span>{{ t('table.targetChoose') }}</span><button type="button" @click.stop="cancelTarget">{{ t('common.cancel') }}</button></div>
        <Teleport to="body"><div v-if="resolvingFlight" class="resolving-card-flight" :style="{ left: `${resolvingFlight.x}px`, top: `${resolvingFlight.y}px`, width: `${resolvingFlight.width}px`, height: `${resolvingFlight.height}px`, '--flight-x': `${resolvingFlight.dx}px`, '--flight-y': `${resolvingFlight.dy}px`, '--flight-scale-x': resolvingFlight.scaleX, '--flight-scale-y': resolvingFlight.scaleY }" aria-hidden="true"><CardTile :card="resolvingFlight.card" :compact="true" :zoom-enabled="false" /></div></Teleport>
        <div v-if="ownHand.length" ref="ownHandElement" class="own-hand-fan" :class="{ 'is-expanded': ownHandExpanded }" :style="{ '--hand-retreat': `${handRetreat}px`, '--hand-area-height': `${handAreaHeight}px`, '--hand-peek': `${handPeek}px` }" data-drop-zone="hand" :data-seat="props.seatId" :aria-label="t('table.hand', { count: ownHand.length })" @focusin="focusOwnHand" @focusout="blurOwnHand">
          <div class="own-hand-hit-area" aria-hidden="true"></div>
          <div ref="ownHandCardsElement" class="own-hand-cards" @transitionend="measureOwnHand">
          <button v-for="(card, index) in ownHand" :key="card.id" class="fan-card" data-drop-zone="hand" :data-seat="props.seatId" :data-menu-card="card.id" :class="{selected:selectedCardId===card.id, 'mulligan-bottom': state.phase === 'mulligan' && selectedBottom.includes(card.id), 'is-dragging-source': dragCard?.id === card.id && dragCard?.moved}" :style="{'--fan-width-scale': Math.max(.5, Math.min(1, Math.sqrt(7 / ownHand.length))), '--fan-offset': `${(index - (ownHand.length - 1) / 2) * Math.min(5.5, 40 / Math.max(1, ownHand.length - 1))}%`, '--fan-angle': `${(index - (ownHand.length - 1) / 2) * Math.min(3.2, 22 / Math.max(1, ownHand.length - 1))}deg`, '--fan-drop': `${Math.pow(Math.abs(index - (ownHand.length - 1) / 2) / Math.max(1, (ownHand.length - 1) / 2), 2) * 14}px`, 'z-index': index + 1}" :aria-label="card.card?.name ?? t('table.handCard')" @pointerdown.stop="startDrag($event, card.id)" @click.stop="clickHandCard(card.id)"><span v-if="card.card?.mana_cost" class="fan-card-mana"><ManaText :text="card.card.mana_cost" /></span><CardTile :card="card" /></button>
          </div>
        </div>
        <div class="stage-info">
          <div class="stage-shortcuts" :aria-label="t('table.tableShortcuts')">
            <div><span><kbd>CTRL</kbd><kbd>Z</kbd> {{ t('table.undoShortcut') }}</span><span><kbd>CTRL</kbd><kbd>Y</kbd> {{ t('table.redoShortcut') }}</span></div>
            <div><span><kbd>CTRL</kbd><kbd>D</kbd> {{ t('table.buyShortcut') }}</span><span><kbd>ALT</kbd> {{ t('table.targetShortLabel') }}</span></div>
            <div><span><kbd>T</kbd> {{ t('table.tapShortcut') }}</span><span><kbd>?</kbd> {{ t('table.shortcuts').toUpperCase() }}</span></div>
          </div>
        <section class="action-log-preview" :aria-label="t('table.recentActions')">
          <button ref="logOpener" class="action-log-open" :aria-label="t('table.openActionLog', { count: logPreview.length })" @click.stop="showLog = true"><strong>{{ t('table.recentActions') }}</strong><span aria-hidden="true">↗</span></button>
          <span v-for="item in logPreview" :key="item.id" class="action-log-preview-entry"><small>{{ new Date(item.at).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'}) }}</small><span><ManaText :text="item.event ? formatGameLogEvent(item.event) : item.message" /></span></span>
          <span v-if="!logPreview.length" class="log-empty">{{ t('table.noActions') }}</span>
        </section>
        </div>
        <Teleport to="body"><div v-if="showLog" class="modal-scrim action-log-scrim" @click.self="showLog = false">
          <section ref="logDialog" class="log-dialog" role="dialog" aria-modal="true" :aria-label="t('table.actionHistory')" @keydown="onLogDialogKeys">
            <button class="log-close" :aria-label="t('table.closeHistory')" @click="showLog = false">×</button>
            <span class="eyebrow">{{ t('table.actionHistory') }}</span>
            <div class="log-dialog-list">
              <div v-for="item in displayedLog" :key="item.id" class="log-entry"><small>{{ new Date(item.at).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'}) }}</small><span><ManaText :text="item.event ? formatGameLogEvent(item.event) : item.message" /></span></div>
              <div v-if="!displayedLog.length" class="log-empty">{{ t('table.noActions') }}</div>
            </div>
          </section>
        </div></Teleport>
      </section>

    </div>

    <TableContextMenu v-if="contextMenu" :x="contextMenu.x" :y="contextMenu.y" :options="menuOptions" :title="menuTitle" @choose="chooseMenu" @close="closeMenu" />
    <div v-if="handRevealPrompt" class="modal-scrim hand-reveal-scrim"><section class="table-settings-dialog" role="dialog" aria-modal="true" :aria-label="t('table.handRevealRequestTitle')"><span class="eyebrow">{{ t('table.handRevealRequestTitle') }}</span><h2>{{ t('table.handRevealRequestBody', { name: handRevealPrompt.requesterName }) }}</h2><footer class="hand-reveal-actions"><button class="button button-ghost" @click="emit('respond-hand-reveal', handRevealPrompt.id, false)">{{ t('common.cancel') }}</button><button class="button button-primary" @click="emit('respond-hand-reveal', handRevealPrompt.id, true)">{{ t('table.acceptReveal') }}</button></footer></section></div>
    <div v-if="revealSinglePrompt" class="modal-scrim" @click.self="revealSinglePrompt = undefined"><section class="reveal-order-dialog" role="dialog" aria-modal="true" :aria-label="t('table.revealChooseDestination')"><h2>{{ t('table.revealChooseDestination') }}</h2><button v-for="destination in (['top', 'bottom'] as const)" :key="destination" @click="emitAction({ type: 'MOVE_LIBRARY_REVEALED', cardIds: [revealSinglePrompt!], destination }); revealSinglePrompt = undefined">{{ t(`table.revealDestination.${destination}`) }}</button><button @click="revealSinglePrompt = undefined">{{ t('common.cancel') }}</button></section></div>
    <div v-if="revealOrderPrompt" class="modal-scrim" @click.self="revealOrderPrompt = undefined"><section class="reveal-order-dialog" role="dialog" aria-modal="true" :aria-label="t('table.revealOrderTitle')"><h2>{{ t('table.revealOrderTitle') }}</h2><p>{{ t('table.revealOrderDescription') }}</p><template v-if="!revealOrderPrompt.choosing"><button @click="confirmRevealOrder">{{ t('table.revealKeepOrder') }}</button><button @click="revealOrderPrompt.choosing = true">{{ t('table.revealChooseOrder') }}</button></template><template v-else><ol><li v-for="(id, index) in revealOrderPrompt.ids" :key="id"><span>{{ state.cards[id]?.card?.name ?? t('table.card') }}</span><button :disabled="index === 0" :aria-label="t('table.revealMoveEarlier')" @click="shiftRevealOrder(index, -1)">↑</button><button :disabled="index === revealOrderPrompt.ids.length - 1" :aria-label="t('table.revealMoveLater')" @click="shiftRevealOrder(index, 1)">↓</button></li></ol><button @click="confirmRevealOrder">{{ t('table.revealConfirmOrder') }}</button></template><button @click="revealOrderPrompt = undefined">{{ t('common.cancel') }}</button></section></div>
    <div v-if="showSettings" class="modal-scrim table-settings-scrim" @click.self="showSettings=false" @keydown.esc="showSettings=false"><section class="table-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="table-settings-title"><button class="modal-close" :aria-label="t('common.close')" @click="showSettings=false">×</button><span class="eyebrow">{{ t('table.settings') }}</span><h2 id="table-settings-title">{{ t('table.settings') }}</h2><div class="settings-tabs" role="tablist" :aria-label="t('table.settingsSections')"><button id="settings-tab-table" role="tab" type="button" :aria-selected="settingsTab==='table'" aria-controls="settings-panel-table" @click="settingsTab='table'">{{ t('table.settingsTableTab') }}</button></div><section v-if="settingsTab==='table'" id="settings-panel-table" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-table"><label class="settings-toggle"><span><strong>{{ t('table.disableCustomPlaymats') }}</strong><small>{{ t('table.disableCustomPlaymatsDescription') }}</small></span><input type="checkbox" :checked="customPlaymatsDisabled" @change="emit('set-custom-playmats-disabled', ($event.target as HTMLInputElement).checked)"></label></section></section></div>
    <div v-if="showPlaymats" class="modal-scrim" @click.self="showPlaymats=false"><section class="playmat-modal" role="dialog" :aria-label="t('table.playmatDialog')"><button class="modal-close" :aria-label="t('common.close')" @click="showPlaymats=false">×</button><span class="eyebrow">{{ t('table.playmatEyebrow') }}</span><h2>{{ t('table.choosePlaymat') }}</h2><div class="playmat-preview"><PlaymatArt v-if="playmatDraft" :id="playmatDraft" class="playmat-preview-art" /><span>{{ PLAYMATS.find(item=>item.id===playmatDraft)?.name ?? t('table.greenFelt') }}</span></div><div class="playmat-options"><button class="playmat-choice felt-choice" :class="{selected:!playmatDraft}" @click="playmatDraft=undefined"><span class="playmat-choice-art">✳</span><strong>{{ t('table.greenFelt') }}</strong></button><button v-for="playmat in PLAYMATS" :key="playmat.id" class="playmat-choice" :class="{selected:playmatDraft===playmat.id}" @click="playmatDraft=playmat.id"><img :src="playmat.thumbnail" alt=""><strong>{{ playmat.name }}</strong></button></div><footer><a :href="PLAYMATS[0].source" target="_blank" rel="noreferrer">{{ t('table.officialMagicArt') }} ↗</a><button class="button button-primary" :disabled="busy" @click="applyPlaymat">{{ t('table.applyPlaymat') }}</button></footer></section></div>
    <div v-if="searchOpen" class="modal-scrim library-search-scrim" @click.self="searchOpen = false" @keydown.stop="onSearchKeys">
      <section ref="searchDialog" class="library-search-modal" role="dialog" aria-modal="true" aria-labelledby="library-search-title" aria-describedby="library-search-description">
        <header class="library-search-heading">
          <button class="modal-close" type="button" :aria-label="t('common.close')" @click="searchOpen = false">×</button>
          <span class="eyebrow">{{ t('table.searchDialog') }}</span>
          <h2 id="library-search-title">{{ t('table.findCard') }}</h2>
          <p id="library-search-description">{{ t('table.privateSearchDescription') }}</p>
          <label class="library-search-field"><span class="eyebrow">{{ t('table.searchLabel') }}</span><input ref="searchInput" v-model="searchQuery" class="library-search-input" type="search" :aria-label="t('table.searchNameLabel')" :placeholder="t('table.searchPlaceholder')" /></label>
        </header>
        <div class="library-search-results" role="region" :aria-label="t('table.groupedCards')" tabindex="0">
          <section v-for="column in libraryColumns" :key="column.key" class="library-type-column" :aria-label="`${column.label}: ${column.copies} cartas`">
            <header class="library-type-heading"><h3>{{ column.label }}</h3><span>{{ column.copies }}</span></header>
            <div class="library-type-cards">
              <div v-for="(group, index) in column.choices" :key="group.cardId" class="library-search-entry" :style="{ '--card-order': index + 1 }">
                <button class="library-search-result" :class="{ selected: group.ids.every(id => searchSelection.includes(id)) }" type="button" :aria-pressed="group.ids.every(id => searchSelection.includes(id))" :aria-label="`${group.name}, ${group.ids.length} ${group.ids.length === 1 ? 'cópia' : 'cópias'}`" @click="toggleLibraryChoice(group.ids)">
                  <CardTile :definition="group.definition" :quantity="group.ids.length" />
                </button>
                <button class="library-choice-zoom" type="button" :aria-label="t('deck.inspectCard', { card: group.name })" :title="t('deck.inspectCard', { card: group.name })" @click="inspectLibraryChoice(group.definition, group.ids.length, $event)"><span aria-hidden="true">⌕</span></button>
              </div>
            </div>
          </section>
          <div v-if="!libraryChoices.length" class="library-no-results" role="status">{{ searchQuery.trim() ? t('table.noSearchResults') : t('table.emptyLibrary') }}</div>
        </div>
        <footer class="library-search-footer">
          <label class="search-destination"><span class="eyebrow">{{ t('table.destination') }}</span><select v-model="searchDestination"><option value="hand">{{ t('table.yourHand') }}</option><option value="battlefield">{{ t('table.battlefield') }}</option><option value="graveyard">{{ t('table.zones.graveyard') }}</option><option value="exile">{{ t('table.zones.exile') }}</option></select></label>
          <span class="library-selection-count" role="status">{{ searchSelection.length }} {{ t('table.selectedCards') }}<small v-if="searchSelection.length > 20">{{ t('table.maxSearchCards') }}</small></span>
          <button class="button button-primary" :disabled="!searchSelection.length || searchSelection.length > 20 || busy || state.paused" @click="finishSearch">{{ t('table.finishSearch') }} <span aria-hidden="true">↗</span></button>
        </footer>
      </section>
    </div>
    <div v-if="publicZoneSearch" class="modal-scrim library-search-scrim" @click.self="publicZoneSearch = undefined" @keydown.stop="onPublicZoneSearchKeys">
      <section class="library-search-modal public-zone-search-modal" role="dialog" aria-modal="true" aria-labelledby="public-zone-search-title">
        <header class="library-search-heading">
          <button class="modal-close" type="button" :aria-label="t('common.close')" @click="publicZoneSearch = undefined">×</button>
          <span class="eyebrow">{{ seatAt(publicZoneSearch.seatId)?.name }} · {{ publicZoneSearchCards.length }} {{ t('table.cardsCount') }}</span>
          <h2 id="public-zone-search-title">{{ t('table.searchZone', { zone: t(`table.zones.${publicZoneSearch.zone}`) }) }}</h2>
          <label class="library-search-field"><span class="eyebrow">{{ t('table.searchLabelPublic') }}</span><input ref="publicZoneSearchInput" v-model="publicZoneSearchQuery" class="library-search-input" type="search" :aria-label="t('table.searchLabelPublic')" :placeholder="t('table.searchPlaceholder')" /></label>
        </header>
        <div class="library-search-results" role="region" :aria-label="t('table.searchZone', { zone: t(`table.zones.${publicZoneSearch.zone}`) })" tabindex="0">
          <section v-for="column in publicZoneSearchColumns" :key="column.key" class="library-type-column" :aria-label="`${column.label}: ${column.cards.length}`">
            <header class="library-type-heading"><h3>{{ column.label }}</h3><span>{{ column.cards.length }}</span></header>
            <div class="library-type-cards">
              <div v-for="(card, index) in column.cards" :key="card.id" class="library-search-entry" :style="{ '--card-order': index + 1 }">
                <button class="library-search-result" type="button" :data-menu-card="card.id" :aria-label="card.card?.name ?? t('table.card')" @click="inspectCard(card.id, $event)"><CardTile :card="card" /></button>
              </div>
            </div>
          </section>
          <div v-if="!publicZoneSearchCards.length" class="library-no-results" role="status">{{ publicZoneSearchQuery.trim() ? t('table.noSearchResults') : t('table.zoneEmpty') }}</div>
        </div>
      </section>
    </div>
    <div v-if="tokenLibraryOpen" class="modal-scrim library-search-scrim" @click.self="tokenLibraryOpen = false" @keydown.stop="onSearchKeys">
      <section ref="tokenDialog" class="library-search-modal" role="dialog" aria-modal="true" aria-labelledby="token-library-title" aria-describedby="token-library-description">
        <header class="library-search-heading">
          <button class="modal-close" type="button" :aria-label="t('common.close')" @click="tokenLibraryOpen = false">×</button>
          <span class="eyebrow">{{ t('table.tokenLibraryEyebrow') }}</span>
          <h2 id="token-library-title">{{ t('table.tokenLibraryTitle') }}</h2>
          <p id="token-library-description">{{ t('table.tokenLibraryDescription') }}</p>
          <label class="library-search-field"><span class="eyebrow">{{ t('table.tokenSearchLabel') }}</span><input ref="tokenSearchInput" v-model="tokenSearchQuery" class="library-search-input" type="search" :aria-label="t('table.tokenSearchLabel')" :placeholder="t('table.tokenSearchPlaceholder')" /></label>
          <label class="token-deck-filter"><input v-model="onlyDeckTokens" type="checkbox" /><span>{{ t('table.onlyDeckTokens') }}</span></label>
        </header>
        <div class="library-search-results token-library-results" role="region" :aria-label="t('table.tokenGroups')" tabindex="0" aria-live="polite">
          <div v-if="tokenError" class="library-no-results" role="alert">{{ tokenError }} <button class="button button-secondary" type="button" @click="loadCreatureTokens(1)">{{ t('common.retry') }}</button></div>
          <div v-else-if="tokenLoading && !creatureTokens.length" class="library-no-results"><ScryfallProgress :label="t('table.tokenLoading')" :loaded="tokenProgress.loaded" :total="tokenProgress.total" :estimated="tokenProgress.estimated" /></div>
          <template v-else>
            <section v-for="column in creatureTokenColumns" :key="column.key" class="library-type-column" :aria-label="`${column.key}: ${column.definitions.length} ${t('table.tokenCount')}`">
              <header class="library-type-heading"><h3>{{ column.key === 'other' ? t('cardTypes.other') : column.key }}</h3><span>{{ column.definitions.length }}</span></header>
              <div class="library-type-cards">
                <div v-for="(definition, index) in column.definitions" :key="definition.id" class="library-search-entry" :style="{ '--card-order': index + 1 }">
                  <button class="library-search-result token-library-choice" type="button" :aria-label="t('table.createNamedToken', { card: definition.name })" @click="createCreatureToken(definition)">
                    <CardTile :definition="definition" />
                  </button>
                </div>
              </div>
            </section>
            <div v-if="!creatureTokens.length && !tokenLoading" class="library-no-results" role="status">{{ tokenSearchQuery.trim() ? t('table.noTokenResults') : onlyDeckTokens ? t('table.noDeckTokens') : t('table.noTokens') }}</div>
          </template>
          <div v-if="tokenLoadingMore" class="token-library-progress"><ScryfallProgress :label="t('table.tokenLoading')" :loaded="tokenProgress.loaded" :total="tokenProgress.total" :estimated="tokenProgress.estimated" /></div>
          <button v-if="tokenHasMore && !tokenError" class="button button-secondary token-library-more" type="button" :disabled="tokenLoadingMore" @click="loadCreatureTokens(tokenPage + 1, true)">{{ t('table.loadMoreTokens') }}</button>
        </div>
      </section>
    </div>
    <div v-if="transferPrompt" class="transfer-prompt-layer" @click.self="closeTransferPrompt">
      <section ref="transferDialog" class="transfer-prompt" :style="{ left: `${transferPosition.left}px`, top: `${transferPosition.top}px` }" role="dialog" aria-modal="true" aria-labelledby="transfer-prompt-title" @keydown="onTransferPromptKeys">
        <span class="eyebrow">{{ props.state.cards[transferPrompt.cardId]?.card?.name ?? t('table.card') }}</span>
        <h2 id="transfer-prompt-title">{{ transferPrompt.kind === 'commander' ? t('table.commanderZoneQuestion', { name: props.state.cards[transferPrompt.cardId]?.card?.name ?? t('table.card') }) : t('table.confirmTransferControl', { name: transferPrompt.name }) }}</h2>
        <div class="transfer-prompt-actions">
          <button v-if="transferPrompt.kind === 'transfer'" class="button button-secondary transfer-cancel" type="button" @click="closeTransferPrompt">{{ t('common.cancel') }}</button>
          <button v-else class="button button-secondary transfer-cancel" type="button" @click="closeTransferPrompt">{{ t('table.keepDestination') }}</button>
          <button class="button button-primary" type="button" @click="confirmTransferPrompt">{{ transferPrompt.kind === 'commander' ? t('table.sendToCommand') : t('table.passControl') }}</button>
        </div>
      </section>
    </div>
    <Teleport to="body"><div v-if="cardTooltip && tooltipFace && !inspectionOpen && !contextMenu && !dragCard" class="table-card-tooltip" :style="{ left: `clamp(8px, ${cardTooltip.x + 8}px, max(8px, calc(100vw - 368px)))`, top: cardTooltip.y + 'px' }" aria-hidden="true"><span class="table-card-tooltip-copy"><strong>{{ tooltipFace.name }}</strong><small v-if="tooltipFace.type">{{ tooltipFace.type }}</small></span><ManaText v-if="tooltipFace.mana" :text="tooltipFace.mana" /></div></Teleport>
    <TableTutorial v-if="showTutorial" :hidden-preference="hideTutorial" @close="closeTutorial($event)" @shortcuts="closeTutorial($event, true)" />
    <div v-if="showHelp" class="modal-scrim" @click.self="showHelp=false"><section class="help-modal"><button class="modal-close" :aria-label="t('common.close')" @click="showHelp=false">×</button><span class="eyebrow">{{ t('table.commanderControls') }}</span><h2>{{ t('table.playYourWay') }}</h2><p>{{ t('table.helpIntro') }}</p><div class="shortcut-list"><div><kbd>ENTER</kbd><span>{{ t('chat.shortcut') }}</span></div><div><kbd>CTRL</kbd><kbd>D</kbd><span>{{ t('table.drawOne') }}</span></div><div><kbd>CTRL</kbd><kbd>Z</kbd><span>{{ t('table.undoAction') }}</span></div><div><kbd>CTRL</kbd><kbd>Y</kbd><span>{{ t('table.redoAction') }} (Ctrl + Shift + Z)</span></div><div><kbd>T</kbd><span>{{ t('table.tapSelected') }}</span></div><div><kbd>{{ t('table.middleMouse') }}</kbd><span>{{ t('table.tapMouse') }}</span></div><div><kbd>{{ t('table.doubleClick') }}</kbd><span>{{ t('table.tapMouse') }}</span></div><div><kbd>F</kbd><span>{{ t('table.flipSelected') }}</span></div><div><kbd>ALT</kbd><span>{{ t('table.targetShortcut') }}</span></div><div><kbd>LEFT MOUSE</kbd><span>{{ t('table.selectMove') }}</span></div><div><kbd>MOUSE</kbd><span>{{ t('table.lookAround') }}</span></div><div><kbd>SCROLL</kbd><span>{{ t('table.scrollHelp') }}</span></div><div><kbd>{{ t('table.rightMouse') }}</kbd><span>{{ t('table.contextHelp') }}</span></div><div><kbd>TOUCH</kbd><span>{{ t('table.touchPan') }}</span></div><div><kbd>ESC</kbd><span>{{ t('table.cancelSelection') }}</span></div></div><button class="button button-ghost tutorial-reopen" @click="openTutorial">{{ t('tutorial.reopen') }}</button><button class="button button-primary" @click="showHelp=false">{{ t('table.understood') }} <kbd>↵</kbd></button></section></div>
  </main>
</template>
