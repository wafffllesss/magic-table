<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { GameAction, ManaSymbol, MatchState, PlayerSeat } from '../domain/game';
import type { TableSeatId } from '../services/firebaseRoom';
import CardTile from './CardTile.vue';

const props = defineProps<{ state: MatchState; seatId?: TableSeatId; online: boolean; spectator?: boolean; busy?: boolean }>();
const emit = defineEmits<{ (event: 'actions', actions: GameAction[]): void; (event: 'leave'): void }>();
const seatOrder: TableSeatId[] = ['northWest', 'northEast', 'southEast', 'southWest'];
const selfSeat = computed(() => props.state.seats.find(seat => seat.id === props.seatId));
const activeSeats = computed(() => props.state.seats.filter(seat => seat.status === 'playing'));
const selectedCardId = ref('');
const selectedBottom = ref<string[]>([]);
const showHelp = ref(false);
const showLog = ref(false);
const camera = ref({ x: 0, y: 0, zoom: 0.86, yaw: 0, tilt: 28 });
const cameraStyle = computed(() => ({ transform: `translate(${camera.value.x}px, ${camera.value.y}px) scale(${camera.value.zoom}) rotateZ(${camera.value.yaw}deg)` }));
const hoverId = ref('');
const inspectionId = ref('');
const inspectionHovered = ref(false);
const pendingCommander = ref('');
const dragCard = ref<{ id: string; mat: HTMLElement; startX: number; startY: number; moved: boolean }>();
const suppressClickId = ref('');
const panOrigin = ref<{ x: number; y: number; cameraX: number; cameraY: number }>();
const searchOpen = ref(false);
const searchQuery = ref('');
const searchSelection = ref<string[]>([]);
const searchDestination = ref<'hand' | 'battlefield' | 'graveyard' | 'exile'>('hand');
const xValue = ref(0);
let hoverTimeout: ReturnType<typeof setTimeout> | undefined;
const ownHand = computed(() => selfSeat.value?.hand.map(id => props.state.cards[id]).filter(Boolean) ?? []);
const selectedCard = computed(() => props.state.cards[selectedCardId.value]);
const isMine = computed(() => !props.spectator && Boolean(props.seatId));
const phaseSteps = ['Desvirar', 'Manutenção', 'Compra', 'Principal pré-combate', 'Combate', 'Principal pós-combate', 'Final'];
const manaSymbols: ManaSymbol[] = ['W', 'U', 'B', 'R', 'G', 'C'];
const displayedLog = computed(() => [...props.state.log].slice(-8).reverse());
const stackTop = computed(() => props.state.stack.at(-1));
const stack = computed(() => props.state.stack);
const revealedCards = computed(() => Object.values(props.state.cards).filter(card => card.revealed && card.zone === 'hand').slice(-6));
const ownLibrary = computed(() => selfSeat.value?.library?.map(id => props.state.cards[id]).filter((card): card is NonNullable<typeof card> => Boolean(card)) ?? []);
const controlledCommanders = computed(() => {
  if (!props.seatId) return [];
  const commanderIds = new Set(props.state.seats.flatMap(seat => seat.commanderIds));
  return Object.values(props.state.cards).filter(card => commanderIds.has(card.cardId) && card.controllerId === props.seatId && card.zone === 'battlefield');
});
const libraryChoices = computed(() => {
  const search = searchQuery.value.trim().toLocaleLowerCase('pt-BR');
  const groups = new Map<string, { cardId: string; name: string; type: string; ids: string[] }>();
  for (const card of ownLibrary.value) {
    const definition = card.card;
    if (!definition || search && !`${definition.name} ${definition.type_line} ${definition.oracle_text}`.toLocaleLowerCase('pt-BR').includes(search)) continue;
    const group = groups.get(card.cardId) ?? { cardId: card.cardId, name: definition.name, type: definition.type_line, ids: [] };
    group.ids.push(card.id); groups.set(card.cardId, group);
  }
  return [...groups.values()].slice(0, 30);
});

function emitAction(action: GameAction): void {
  if (!props.busy && !props.state.paused && isMine.value) emit('actions', [action]);
}
function seatAt(id: string): PlayerSeat | undefined { return props.state.seats.find(seat => seat.id === id); }
function cardsFor(seat: PlayerSeat, zone: 'battlefield' | 'command'): MatchState['cards'][string][] {
  return Object.values(props.state.cards).filter(card => card.controllerId === seat.id && card.zone === zone);
}
function ownerCardsFor(seat: PlayerSeat, zone: 'graveyard' | 'exile'): MatchState['cards'][string][] {
  return Object.values(props.state.cards).filter(card => card.ownerId === seat.id && card.zone === zone);
}
function hiddenCount(seat: PlayerSeat, zone: 'library' | 'hand'): number {
  const hidden = props.state.hiddenZones?.[seat.id];
  return zone === 'library' ? seat.library?.length ?? hidden?.library ?? 0 : seat.hand?.length ?? hidden?.hand ?? 0;
}
function draw(): void { emitAction({ type: 'DRAW' }); }
function select(id: string): void { selectedCardId.value = selectedCardId.value === id ? '' : id; }
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
function cardAction(): void {
  if (!selectedCard.value || !selfSeat.value) return;
  const card = selectedCard.value;
  if (card.zone === 'hand' && /\bLand\b/i.test(card.card?.type_line ?? '')) emitAction({ type: 'PLAY_LAND', cardId: card.id, x: 12 + Math.random() * 34, y: 35 + Math.random() * 25 });
  else if (card.zone === 'hand' || card.zone === 'command') emitAction({ type: 'CAST', cardId: card.id, xValue: xValue.value });
  else if (card.zone === 'battlefield') emitAction({ type: 'MOVE_CARD', cardId: card.id, zone: 'graveyard' });
  else if (card.zone === 'graveyard' || card.zone === 'exile') emitAction({ type: 'MOVE_CARD', cardId: card.id, zone: 'hand' });
  selectedCardId.value = '';
}
function tapSelected(): void { if (selectedCard.value?.zone === 'battlefield') emitAction({ type: 'TAP', cardId: selectedCard.value.id }); }
function flipSelected(): void { if (selectedCard.value?.zone === 'battlefield') emitAction({ type: 'FLIP_FACE', cardId: selectedCard.value.id }); }
function moveSelectedTo(zone: 'graveyard' | 'exile' | 'hand'): void {
  if (!selectedCard.value) return;
  emitAction({ type: 'MOVE_CARD', cardId: selectedCard.value.id, zone }); selectedCardId.value = '';
}
function startHover(id: string): void {
  hoverId.value = id; inspectionId.value = '';
  inspectionHovered.value = false;
  if (hoverTimeout) clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => { if (hoverId.value === id) inspectionId.value = id; }, 2000);
}
function endHover(id: string): void {
  if (hoverId.value === id) hoverId.value = '';
  if (hoverTimeout) clearTimeout(hoverTimeout);
  if (inspectionId.value === id) hoverTimeout = setTimeout(() => { if (!inspectionHovered.value) inspectionId.value = ''; }, 1200);
}
function startDrag(event: PointerEvent, id: string): void {
  const card = props.state.cards[id];
  if (!card || card.zone !== 'battlefield' || card.controllerId !== props.seatId || event.button !== 0) return;
  endHover(id);
  dragCard.value = { id, mat: (event.currentTarget as HTMLElement).closest('.player-mat') as HTMLElement, startX: event.clientX, startY: event.clientY, moved: false };
  selectedCardId.value = id; (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}
function finishDrag(event: PointerEvent): void {
  if (!dragCard.value) return;
  const { id, mat, moved } = dragCard.value; const bounds = mat.getBoundingClientRect();
  if (moved && bounds.width && bounds.height) {
    emitAction({ type: 'REPOSITION_CARD', cardId: id, x: Math.min(88, Math.max(5, ((event.clientX - bounds.left) / bounds.width) * 100)), y: Math.min(82, Math.max(8, ((event.clientY - bounds.top) / bounds.height) * 100)) });
    suppressClickId.value = id; window.setTimeout(() => { suppressClickId.value = ''; }, 120);
  }
  dragCard.value = undefined;
}
function startPan(event: PointerEvent): void {
  if (event.button !== 2 && event.target !== event.currentTarget) return;
  panOrigin.value = { x: event.clientX, y: event.clientY, cameraX: camera.value.x, cameraY: camera.value.y };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}
function updatePointer(event: PointerEvent): void {
  if (dragCard.value && Math.hypot(event.clientX - dragCard.value.startX, event.clientY - dragCard.value.startY) > 4) dragCard.value.moved = true;
  if (panOrigin.value) { camera.value.x = panOrigin.value.cameraX + event.clientX - panOrigin.value.x; camera.value.y = panOrigin.value.cameraY + event.clientY - panOrigin.value.y; }
}
function zoom(event: WheelEvent): void { camera.value.zoom = Math.min(1.15, Math.max(0.58, camera.value.zoom + (event.deltaY < 0 ? 0.035 : -0.035))); }
function focusOwnSeat(): void { camera.value = { x: 0, y: 0, zoom: 0.94, yaw: 0, tilt: 28 }; }
function focusTable(): void { camera.value = { x: 0, y: 0, zoom: 0.78, yaw: 0, tilt: 28 }; }
function rotateCamera(degrees: number): void { camera.value.yaw = Math.min(18, Math.max(-18, camera.value.yaw + degrees)); }
function tiltCamera(degrees: number): void { camera.value.tilt = Math.min(42, Math.max(18, camera.value.tilt + degrees)); }
function clickCard(id: string): void { if (suppressClickId.value === id) return; select(id); }
function toggleLibraryChoice(ids: string[]): void {
  const allSelected = ids.every(id => searchSelection.value.includes(id));
  searchSelection.value = allSelected ? searchSelection.value.filter(id => !ids.includes(id)) : [...new Set([...searchSelection.value, ...ids])];
}
function finishSearch(): void {
  if (!searchSelection.value.length || props.state.paused || props.busy) return;
  emit('actions', [{ type: 'SEARCH_LIBRARY', cardIds: [...searchSelection.value], destination: searchDestination.value }, { type: 'SHUFFLE' }]);
  searchOpen.value = false; searchSelection.value = []; searchQuery.value = '';
}
function forceCastSelected(): void {
  if (!selectedCard.value || !['hand', 'command'].includes(selectedCard.value.zone)) return;
  emitAction({ type: 'CAST', cardId: selectedCard.value.id, adjusted: true, xValue: xValue.value });
  selectedCardId.value = '';
}
function concede(): void {
  if (isMine.value && window.confirm('Conceder a partida? Seu lugar será marcado como eliminado e a mesa continuará.')) emitAction({ type: 'CONCEDE' });
}
function enterInspection(): void { inspectionHovered.value = true; if (hoverTimeout) clearTimeout(hoverTimeout); }
function leaveInspection(): void { inspectionHovered.value = false; inspectionId.value = ''; }
function commanderTax(seat: PlayerSeat, cardId: string): number { return (seat.commanderCasts?.[cardId] ?? 0) * 2; }
function tapManaLabel(seat: PlayerSeat): string { return Object.entries(seat.mana ?? {}).filter(([, count]) => count > 0).map(([symbol, count]) => `${symbol} ${count}`).join(' · ') || 'Pool vazio'; }
function manaAt(seatId: string, symbol: ManaSymbol): number { return seatAt(seatId)?.mana[symbol] ?? 0; }
function onKeys(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
  if (event.key === '?' || (event.shiftKey && event.key === '/')) { showHelp.value = !showHelp.value; event.preventDefault(); return; }
  if (event.key === 'Escape') { selectedCardId.value = ''; showHelp.value = false; searchOpen.value = false; pendingCommander.value = ''; inspectionId.value = ''; return; }
  if (event.ctrlKey && event.key.toLowerCase() === 'd') { event.preventDefault(); draw(); return; }
  if (event.ctrlKey || event.altKey || event.metaKey || !isMine.value) return;
  if (event.key.toLowerCase() === 't') tapSelected();
  if (event.key.toLowerCase() === 'f') flipSelected();
}
function preventMenu(event: MouseEvent): void { event.preventDefault(); }
function resolveConfirmed(): void { emitAction({ type: 'RESOLVE_TOP' }); }
onMounted(() => { window.addEventListener('keydown', onKeys); });
onBeforeUnmount(() => { window.removeEventListener('keydown', onKeys); if (hoverTimeout) clearTimeout(hoverTimeout); });
watch(() => props.state.id, () => { selectedCardId.value = ''; selectedBottom.value = []; });
</script>

<template>
  <main class="table-shell" @contextmenu="preventMenu">
    <header class="table-topbar">
      <div class="table-brand"><span class="brand-mark">M</span><span>MANA<span class="brand-soft">/</span>TABLE</span></div>
      <div class="match-meta"><span class="connection-mark" :class="online ? 'is-live' : ''"></span><span>{{ online ? 'SALA AO VIVO' : 'DEMONSTRAÇÃO LOCAL' }}</span><i></i><span>COMMANDER</span><i></i><span>RODADA {{ state.turn }}</span></div>
      <div class="topbar-actions"><button class="icon-button" title="Visão geral" @click="focusTable">⌖</button><button class="icon-button" title="Meu lugar" @click="focusOwnSeat">◎</button><button class="icon-button help-top" title="Atalhos" @click="showHelp = true">?</button><button class="leave-button" @click="emit('leave')">SAIR DA MESA <span>↗</span></button></div>
    </header>
    <div v-if="state.paused" class="table-pause-banner"><span>Ⅱ</span><div><strong>Partida pausada</strong><small>Um lugar está reconectando ou esperando uma substituição.</small></div><span>ESTADO SINCRONIZADO</span></div>

    <div class="game-layout">
      <section class="table-stage" @wheel.prevent="zoom" @pointerdown="startPan" @pointermove="updatePointer" @pointerup="finishDrag($event); panOrigin = undefined">
        <div class="camera-scene" :style="cameraStyle">
          <div class="felt-board" :style="{ transform: `rotateX(${camera.tilt}deg) rotateZ(-0.4deg)` }">
            <section v-for="seatId in seatOrder" :key="seatId" class="player-mat" :class="[`mat-${seatId}`, seatId === props.seatId ? 'is-self' : '']" :data-seat="seatId">
              <template v-if="seatAt(seatId)">
                <header class="mat-player-bar"><span class="player-dot" :class="{ 'is-active': state.activeSeatId === seatId }"></span><strong>{{ seatAt(seatId)?.name }}</strong><span v-if="seatId === props.seatId" class="you-pill">VOCÊ</span><span v-if="seatAt(seatId)?.status === 'eliminated'" class="out-pill">FORA</span><span class="life-total">{{ seatAt(seatId)?.life }} <small>VIDA</small></span><button v-if="isMine" class="life-adjust" aria-label="Aumentar vida" @click.stop="emitAction({type:'SET_LIFE', amount: 1, seatId})">+</button><button v-if="isMine" class="life-adjust" aria-label="Diminuir vida" @click.stop="emitAction({type:'SET_LIFE', amount: -1, seatId})">−</button></header>
                <div class="mat-information"><span>{{ seatAt(seatId)?.status === 'eliminated' ? 'ELIMINADO' : state.step.toUpperCase() }}</span><span v-if="seatId === state.activeSeatId" class="active-turn">· TURNO</span><span class="mana-pool">◈ {{ tapManaLabel(seatAt(seatId)!) }}</span></div>
                <div class="command-row"><button v-for="card in cardsFor(seatAt(seatId)!, 'command')" :key="card.id" class="command-chip" :class="{ selected: selectedCardId === card.id }" @click.stop="select(card.id)" @mouseenter="startHover(card.id)" @mouseleave="endHover(card.id)"><span>♛</span>{{ card.card?.name ?? 'Comandante' }}<small>+{{ commanderTax(seatAt(seatId)!, card.cardId) }} TAXA</small></button></div>
                <button class="zone-stack library-pile" :class="{ 'pile-own': seatId === props.seatId }" :disabled="seatId !== props.seatId || !isMine" @click.stop="seatId === props.seatId ? draw() : undefined"><span class="pile-back"><i>✳</i></span><span class="pile-name">{{ seatId === props.seatId ? 'BIBLIOTECA' : 'DECK' }}</span><b>{{ hiddenCount(seatAt(seatId)!, 'library') }}</b><small v-if="seatId === props.seatId">CTRL + D · COMPRAR</small></button>
                <div class="public-zones"><button v-for="zone in (['graveyard','exile'] as const)" :key="zone" class="zone-pile" :title="zone === 'graveyard' ? 'Cemitério' : 'Exílio'" @click.stop="select(ownerCardsFor(seatAt(seatId)!, zone).at(-1)?.id ?? '')"><span>{{ zone === 'graveyard' ? '⌑' : '⟁' }}</span><b>{{ ownerCardsFor(seatAt(seatId)!, zone).length }}</b><small>{{ zone === 'graveyard' ? 'CEMITÉRIO' : 'EXÍLIO' }}</small></button></div>
                <div class="battlefield-cards"><div v-for="card in cardsFor(seatAt(seatId)!, 'battlefield')" :key="card.id" class="board-card-wrap" :data-card-id="card.id" :style="{left:`${card.x}%`,top:`${card.y}%`}" :class="{ 'is-picked': selectedCardId === card.id }" @pointerdown.stop="startDrag($event, card.id)" @click.stop="clickCard(card.id)" @mouseenter="startHover(card.id)" @mouseleave="endHover(card.id)"><CardTile :card="card" :compact="true" /><span v-if="card.tapped" class="tap-sigil">↻</span><span v-if="Object.values(card.counters).some(value => value > 0)" class="counter-badge">{{ Object.values(card.counters).reduce((sum,value)=>sum+value,0) }}</span></div></div>
                <div class="hand-count"><span v-for="index in Math.min(seatId === props.seatId ? 0 : hiddenCount(seatAt(seatId)!, 'hand'), 5)" :key="index" class="hidden-card-fan" :style="{transform:`translateX(${(index-1)*9}px) rotate(${(index-3)*6}deg)`}"></span><span>{{ hiddenCount(seatAt(seatId)!, 'hand') }} NA MÃO</span></div>
                <div class="mana-orbs"><span v-for="symbol in manaSymbols" :key="symbol" class="mana-orb" :class="`mana-${symbol.toLowerCase()}`"><b>{{ symbol }}</b><i>{{ manaAt(seatId, symbol) }}</i><template v-if="seatId === props.seatId && isMine"><button aria-label="Adicionar mana ao pool" @click.stop="emitAction({type:'ADJUST_MANA',symbol,amount:1})">+</button><button aria-label="Remover mana do pool" @click.stop="emitAction({type:'ADJUST_MANA',symbol,amount:-1})">−</button></template></span><button v-if="seatId === props.seatId && isMine" class="mana-clear" title="Esvaziar o pool" @click.stop="emitAction({type:'CLEAR_MANA'})">×</button></div>
                <div v-if="seatAt(seatId)?.poison" class="poison-mark">☠ {{ seatAt(seatId)?.poison }} VENENO</div>
                <div class="mat-mark">{{ seatId === 'southWest' ? '01' : seatId === 'southEast' ? '02' : seatId === 'northEast' ? '03' : '04' }} <i>·</i> ZONA DE JOGO</div>
              </template>
              <div v-else class="empty-seat"><span>＋</span><strong>ESPERANDO JOGADOR</strong><small>Convide alguém para a mesa</small></div>
            </section>
            <div class="table-hub"><span class="hub-kicker">CENTRO DA MESA</span><strong>{{ stack.length ? 'PILHA' : 'RESOLVIDO' }}</strong><div class="stack-cards"><span v-for="item in stack.slice(-3)" :key="item.id" class="stack-back" @mouseenter="startHover(item.sourceId)" @mouseleave="endHover(item.sourceId)"><CardTile :card="state.cards[item.sourceId]" :compact="true" /><i>{{ item.kind === 'ability' ? 'HABILIDADE' : 'MAGIA' }}</i></span><span v-if="!stack.length" class="stack-empty">· · ·</span></div><span class="priority-label">{{ stackTop?.name ?? 'SEM RESPOSTAS PENDENTES' }}</span><button v-if="stackTop && isMine" class="resolve-button" :disabled="busy || state.passes.includes(seatId ?? '')" @click.stop="passPriority">{{ state.passes.includes(seatId ?? '') ? 'VOCÊ PASSOU' : 'PASSAR PRIORIDADE' }} <kbd>SPACE</kbd></button><button v-else-if="!stack.length" class="resolve-button muted" disabled>ESPERANDO CONJURAÇÃO</button><div v-if="stack.length" class="pass-dots"><i v-for="seat in activeSeats" :key="seat.id" :class="{passed: state.passes.includes(seat.id)}"></i></div><div v-if="revealedCards.length" class="revealed-cards"><span>CARTAS REVELADAS</span><button v-for="card in revealedCards" :key="card.id" @mouseenter="startHover(card.id)" @mouseleave="endHover(card.id)"><CardTile :card="card" :compact="true" /></button></div></div>
            <span class="board-watermark">M<span>/</span>T</span>
          </div>
        </div>
        <div class="camera-controls"><span>BOTÃO DIREITO + ARRASTE · MOVER CÂMERA</span><span>RODA · ZOOM</span><button title="Inclinar para cima" @click="tiltCamera(-3)">⌃</button><button title="Girar para esquerda" @click="rotateCamera(-4)">↶</button><button title="Girar para direita" @click="rotateCamera(4)">↷</button><button title="Inclinar para baixo" @click="tiltCamera(3)">⌄</button></div>
        <div class="stage-shortcuts"><kbd>CTRL</kbd><kbd>D</kbd><span>COMPRAR</span><i>·</i><kbd>T</kbd><span>VIRAR</span><i>·</i><kbd>?</kbd><span>ATALHOS</span></div>
      </section>

      <aside class="game-sidebar">
        <div class="sidebar-section turn-card"><div class="sidebar-eyebrow"><span class="turn-pulse"></span> TURNO ATUAL</div><div class="turn-number">{{ String(state.turn).padStart(2,'0') }}<span> / {{ seatAt(state.activeSeatId)?.name ?? '—' }}</span></div><div class="turn-step"><span>ETAPA</span><strong>{{ state.step }}</strong></div><div class="turn-controls"><button class="button button-secondary" :disabled="!isMine || busy || state.phase !== 'playing' || state.activeSeatId !== props.seatId" @click="nextStep">{{ state.step === 'Final' ? 'Encerrar turno' : 'Próxima etapa' }} <kbd>↵</kbd></button></div></div>
        <div class="sidebar-section hand-section"><div class="section-heading"><span>SUA MÃO</span><b>{{ ownHand.length.toString().padStart(2,'0') }}</b></div><div v-if="ownHand.length" class="hand-card-row"><button v-for="card in ownHand" :key="card.id" class="hand-card" :class="{selected:selectedCardId===card.id, 'mulligan-bottom': state.phase === 'mulligan' && selectedBottom.includes(card.id)}" @click="state.phase==='mulligan' ? toggleBottom(card.id) : select(card.id)" @mouseenter="startHover(card.id)" @mouseleave="endHover(card.id)"><CardTile :card="card" /></button></div><div v-else class="empty-hand">{{ spectator ? 'A mão dos jogadores é privada.' : 'Sua mão está vazia.' }}</div><div v-if="state.phase==='mulligan' && selfSeat && !selfSeat.keptHand" class="mulligan-controls"><span>MULLIGAN {{ selfSeat.mulligans }} · ESCOLHA ATÉ {{ 7 - Math.max(0,selfSeat.mulligans-1) }} CARTAS</span><button class="button button-ghost" @click="emitAction({type:'MULLIGAN'})">Mulligan</button><button class="button button-primary" :disabled="selectedBottom.length !== Math.max(0, selfSeat.hand.length - (7-Math.max(0,selfSeat.mulligans-1)))" @click="keepHand">Manter mão</button></div></div>
        <div v-if="selectedCard" class="selected-card-controls"><div><span class="sidebar-eyebrow">CARTA SELECIONADA</span><strong>{{ selectedCard.card?.name }}</strong><small>{{ selectedCard.card?.mana_cost || selectedCard.card?.type_line }}</small></div><label v-if="selectedCard.card?.mana_cost?.includes('{X}')" class="x-payment">X <input v-model.number="xValue" type="number" min="0" max="100"></label><button @click="cardAction">{{ selectedCard.zone === 'battlefield' ? 'Mover ao cemitério' : selectedCard.zone === 'graveyard' || selectedCard.zone === 'exile' ? 'Trazer para a mão' : /\bLand\b/i.test(selectedCard.card?.type_line??'') ? 'Jogar terreno' : 'Conjurar' }} <kbd>↵</kbd></button><button v-if="selectedCard.zone==='command' || selectedCard.zone==='hand' && !/\bLand\b/i.test(selectedCard.card?.type_line??'')" class="plain-action manual-cast" @click="forceCastSelected">Conjurar e registrar custo manual</button><button v-if="selectedCard.zone==='hand'" class="plain-action" @click="moveSelectedTo('graveyard')">Descartar para o cemitério</button><button v-if="selectedCard.zone==='hand'" class="plain-action" @click="emitAction({type:'REVEAL',cardIds:[selectedCard.id]})">Revelar esta carta</button><button v-if="selectedCard.zone==='battlefield'" class="plain-action" @click="tapSelected">{{ selectedCard.tapped ? 'Desvirar' : 'Virar' }} <kbd>T</kbd></button><button v-if="selectedCard.zone==='battlefield' && (selectedCard.card?.card_faces?.length??0)>1" class="plain-action" @click="flipSelected">Virar face <kbd>F</kbd></button><button v-if="selectedCard.zone==='battlefield'" class="plain-action" @click="moveSelectedTo('exile')">Exilar</button><button v-if="selectedCard.zone==='battlefield'" class="plain-action" @click="emitAction({type:'CHANGE_COUNTER',counter:'+1/+1',amount:1,cardId:selectedCard.id})">Marcador +1/+1</button><button class="plain-action" @click="selectedCardId=''">Cancelar <kbd>ESC</kbd></button></div>
        <div class="sidebar-section quick-actions"><div class="section-heading"><span>AÇÕES RÁPIDAS</span><span class="action-public">● PÚBLICAS</span></div><div class="quick-button-grid"><button :disabled="!isMine || busy || state.phase==='mulligan'" @click="draw"><span>↧</span><b>Comprar carta</b><kbd>CTRL + D</kbd></button><button :disabled="!isMine || busy" @click="searchOpen=true"><span>⌕</span><b>Buscar biblioteca</b><kbd>PRIVADO + EMBARALHAR</kbd></button><button :disabled="!isMine || busy" @click="emitAction({type:'CREATE_TOKEN',name:'Ficha 1/1',x:48,y:48})"><span>✣</span><b>Criar ficha</b><kbd>+ MARCADOR</kbd></button><button :disabled="!isMine || busy || !stackTop || !activeSeats.every(candidate=>state.passes.includes(candidate.id))" @click="stackTop && emitAction({type:'RESOLVE_TOP'})"><span>⌄</span><b>Resolver topo</b><kbd>APÓS TODOS PASSAREM</kbd></button><button :disabled="!isMine || busy" @click="emitAction({type:'SHUFFLE'})"><span>⤨</span><b>Embaralhar</b><kbd>SUA BIBLIOTECA</kbd></button><button :disabled="!isMine || busy" @click="showLog = !showLog"><span>☷</span><b>Histórico</b><kbd>ÚLTIMAS AÇÕES</kbd></button></div></div>
        <div v-if="showLog" class="log-panel"><button class="log-close" @click="showLog=false">×</button><div v-for="item in displayedLog" :key="item.id" class="log-entry"><small>{{ new Date(item.at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) }}</small><span>{{ item.message }}</span></div></div>
        <div class="sidebar-section opponent-lines">
          <div class="section-heading"><span>DANO DE COMANDANTE</span><span class="action-public">21 = ELIMINAÇÃO</span></div>
          <template v-for="opponent in activeSeats.filter(candidate => candidate.id !== seatId)" :key="opponent.id">
            <div v-for="commander in controlledCommanders" :key="`${opponent.id}-${commander.id}`" class="commander-damage-row">
              <span>{{ opponent.name }} · {{ commander.card?.name }}</span>
              <button @click="pendingCommander = pendingCommander === `${commander.id}|${opponent.id}` ? '' : `${commander.id}|${opponent.id}`">{{ opponent.commanderDamage?.[commander.cardId] ?? 0 }} <small>DMG</small></button>
              <div v-if="pendingCommander === `${commander.id}|${opponent.id}`" class="damage-confirm">
                <span>Registrar dano deste comandante.</span>
                <button @click="emitAction({type:'COMMANDER_DAMAGE',commanderCardId:commander.id,defenderId:opponent.id,amount:1});pendingCommander=''">+1</button>
                <button @click="emitAction({type:'COMMANDER_DAMAGE',commanderCardId:commander.id,defenderId:opponent.id,amount:3});pendingCommander=''">+3</button>
              </div>
            </div>
          </template>
          <button class="concede-button" :disabled="!isMine || busy" @click="concede">Conceder a partida</button>
        </div>
        <div class="sidebar-spacer"></div><footer class="sidebar-footer"><span>ASSISTÊNCIA DE REGRAS ATIVA</span><span>EFEITOS, ALVOS E COMBATE SÃO MANUAIS</span><span class="revision-label">REV. {{ state.revision.toString().padStart(3,'0') }} <i>·</i> {{ online ? 'SINCRONIZADO' : 'LOCAL' }}</span></footer>
      </aside>
    </div>

    <div v-if="inspectionId && state.cards[inspectionId]?.card" class="inspection-overlay" @mouseenter="inspectionId = inspectionId" @mouseleave="inspectionId=''">
      <div class="inspection-art"><CardTile :card="state.cards[inspectionId]" /></div><div class="inspection-copy" @mouseenter="enterInspection" @mouseleave="leaveInspection"><span class="sidebar-eyebrow">{{ state.cards[inspectionId].card?.type_line }}</span><div class="inspection-title"><h2>{{ state.cards[inspectionId].card?.card_faces?.[state.cards[inspectionId].face??0]?.name??state.cards[inspectionId].card?.name }}</h2><b>{{ state.cards[inspectionId].card?.card_faces?.[state.cards[inspectionId].face??0]?.mana_cost??state.cards[inspectionId].card?.mana_cost }}</b></div><p>{{ state.cards[inspectionId].card?.card_faces?.[state.cards[inspectionId].face??0]?.oracle_text??state.cards[inspectionId].card?.oracle_text }}</p><span class="inspection-hint">ESC PARA FECHAR · IMAGEM EM CACHE LOCAL</span></div>
    </div>
    <div v-if="searchOpen" class="modal-scrim" @click.self="searchOpen=false"><section class="library-search-modal"><button class="modal-close" @click="searchOpen=false">×</button><span class="eyebrow">BUSCA PRIVADA · SÓ SUA BIBLIOTECA</span><h2>Encontre uma carta.</h2><p>Os nomes escolhidos não aparecem no histórico público. Ao concluir, sua biblioteca será embaralhada.</p><input v-model="searchQuery" class="library-search-input" placeholder="Nome, tipo ou texto Oracle"><div class="library-search-results"><button v-for="group in libraryChoices" :key="group.cardId" class="library-search-result" :class="{selected:group.ids.every(id=>searchSelection.includes(id))}" @click="toggleLibraryChoice(group.ids)"><span class="search-check">{{ group.ids.every(id=>searchSelection.includes(id))?'✓':'' }}</span><strong>{{ group.name }}</strong><small>{{ group.type }}</small><i>× {{ group.ids.length }}</i></button><div v-if="!libraryChoices.length" class="library-no-results">Nenhuma carta encontrada neste trecho da biblioteca.</div></div><label class="search-destination">DESTINO <select v-model="searchDestination"><option value="hand">Sua mão</option><option value="battlefield">Campo de batalha</option><option value="graveyard">Cemitério</option><option value="exile">Exílio</option></select></label><footer><span>{{ searchSelection.length }} carta(s) selecionada(s)</span><button class="button button-primary" :disabled="!searchSelection.length || busy" @click="finishSearch">Concluir e embaralhar <span>↗</span></button></footer></section></div>
    <div v-if="showHelp" class="modal-scrim" @click.self="showHelp=false"><section class="help-modal"><button class="modal-close" @click="showHelp=false">×</button><span class="eyebrow">MESA DE COMMANDER · CONTROLES</span><h2>Jogue do seu jeito.</h2><p>A mesa acompanha estados e ações comuns. Efeitos das cartas, alvos e combate continuam sob decisão dos jogadores.</p><div class="shortcut-list"><div><kbd>CTRL</kbd><kbd>D</kbd><span>Comprar uma carta</span></div><div><kbd>T</kbd><span>Virar / desvirar a carta selecionada</span></div><div><kbd>F</kbd><span>Alternar a face selecionada</span></div><div><kbd>BOTÃO ESQUERDO</kbd><span>Selecionar ou mover permanentes</span></div><div><kbd>BOTÃO DIREITO</kbd><span>Mover a câmera da mesa</span></div><div><kbd>RODA</kbd><span>Controlar o zoom</span></div><div><kbd>ESC</kbd><span>Cancelar seleção</span></div></div><button class="button button-primary" @click="showHelp=false">Entendi <kbd>↵</kbd></button></section></div>
  </main>
</template>
