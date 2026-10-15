<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from 'vue';
import DeckWorkshop from './components/DeckWorkshop.vue';
import GameTable from './components/GameTable.vue';
import type { DeckDefinition, GameAction, MatchState } from './domain/game';
import { applyAction } from './domain/game';
import { localRepository } from './services/storage';
import { firebaseRoom, TABLE_SEATS, type ReplacementOffer, type RoomSnapshot, type TableSeatId } from './services/firebaseRoom';
import { getStarterDecks } from './services/starters';
import { addStressObjects, startDemoMatch } from './services/demo';

type Page = 'home' | 'lobby' | 'workshop' | 'table';
const page = ref<Page>('home');
const name = ref('');
const localDecks = ref<DeckDefinition[]>([]);
const selectedDeck = ref<DeckDefinition>();
const state = ref<MatchState>();
const room = ref<RoomSnapshot>({ seats: {}, queue: [], online: false });
const onlineMode = ref(false);
const loading = ref(false);
const busy = ref(false);
const feedback = ref('');
const fatalError = ref('');
const workshopReturn = ref<Page>('home');
const offerSeconds = ref(30);
const offer = computed(() => room.value.offer);
const selfSeatId = computed(() => room.value.selfSeatId as TableSeatId | undefined);
const mySeat = computed(() => selfSeatId.value ? room.value.seats[selfSeatId.value] : undefined);
const occupiedSeats = computed(() => TABLE_SEATS.map(id => ({ id, player: room.value.seats[id] })));
const isReady = computed(() => mySeat.value?.ready === true);
let offerTicker: ReturnType<typeof setInterval> | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  localDecks.value = await localRepository.getDecks();
  name.value = (await localRepository.getPreference<string>('player-name')) ?? '';
});
onBeforeUnmount(() => {
  if (offerTicker) clearInterval(offerTicker);
  if (feedbackTimer) clearTimeout(feedbackTimer);
  void firebaseRoom.disconnectListeners();
});

function notify(message: string, error = false): void {
  feedback.value = message; fatalError.value = error ? message : '';
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { feedback.value = ''; if (!error) fatalError.value = ''; }, error ? 9000 : 4800);
}
function receiveRoom(next: RoomSnapshot): void {
  room.value = next;
  if (next.state) { state.value = next.state; page.value = 'table'; }
  else if (onlineMode.value && page.value !== 'workshop') page.value = 'lobby';
  if (next.offer) updateOfferCountdown(next.offer);
  if (next.lastError) notify(next.lastError, true);
}
function updateOfferCountdown(current: ReplacementOffer): void {
  if (offerTicker) clearInterval(offerTicker);
  const refresh = () => { offerSeconds.value = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000)); };
  refresh(); offerTicker = setInterval(refresh, 1000);
}
async function validateName(): Promise<boolean> {
  const clean = name.value.trim().replace(/\s+/g, ' ').slice(0, 28);
  if (clean.length < 2) { notify('Escolha um nome com pelo menos duas letras.', true); return false; }
  name.value = clean; await localRepository.setPreference('player-name', clean); return true;
}
async function connect(): Promise<void> {
  if (!await validateName()) return;
  loading.value = true; fatalError.value = '';
  try {
    onlineMode.value = true;
    const connected = await firebaseRoom.connect(name.value, receiveRoom);
    room.value = connected; page.value = 'lobby';
    localDecks.value = await localRepository.getDecks();
    notify(connected.selfSeatId ? 'Você ocupou um lugar. Escolha um deck para confirmar a vaga.' : 'Você está na fila e pode acompanhar a partida.');
  } catch (error) {
    await firebaseRoom.leave().catch(() => firebaseRoom.disconnectListeners());
    onlineMode.value = false; notify(friendly(error), true);
  }
  finally { loading.value = false; }
}
async function loadStarters(): Promise<void> {
  loading.value = true;
  try {
    const result = await getStarterDecks();
    localDecks.value = await localRepository.getDecks();
    if (result.warning) notify(`Usando listas em cache. ${result.warning}`);
    else notify(result.isFresh ? 'Quatro decks Commander válidos foram montados e salvos neste dispositivo.' : 'Biblioteca de decks pronta para jogar.');
  } catch (error) { notify(friendly(error), true); }
  finally { loading.value = false; }
}
function openWorkshop(returnPage: Page = page.value): void { workshopReturn.value = returnPage; page.value = 'workshop'; }
async function chooseDeck(deck: DeckDefinition): Promise<void> {
  selectedDeck.value = deck;
  localDecks.value = await localRepository.getDecks();
  if (onlineMode.value) {
    try { await firebaseRoom.saveDeck(deck); notify(selfSeatId.value ? 'Deck pronto. Confirme o lugar para iniciar a partida.' : 'Deck salvo localmente. Você entrará com esta lista quando uma vaga abrir.'); }
    catch (error) { notify(friendly(error), true); }
    page.value = 'lobby';
  } else {
    notify(`“${deck.name}” selecionado. Abra a demonstração local para testar a mesa com esta lista.`);
    page.value = workshopReturn.value;
  }
}
function closeWorkshop(): void { page.value = workshopReturn.value; }
function startDemo(): void {
  if (name.value.trim().length < 2) { notify('Digite seu nome antes de começar.', true); return; }
  void localRepository.setPreference('player-name', name.value.trim());
  const demoState = startDemoMatch(name.value, selectedDeck.value);
  state.value = import.meta.env.DEV && new URLSearchParams(window.location.search).get('stress') === '200' ? addStressObjects(demoState, 200) : demoState;
  room.value = { seats: {}, queue: [], online: false, selfSeatId: 'southWest', state: state.value, gameReady: true };
  onlineMode.value = false; page.value = 'table';
}
async function performActions(actions: GameAction[]): Promise<void> {
  if (!state.value || busy.value || !selfSeatId.value) return;
  busy.value = true;
  try {
    for (const action of actions) {
      if (onlineMode.value) await firebaseRoom.act(action);
      else state.value = applyAction(toRaw(state.value), selfSeatId.value, action);
      if (!onlineMode.value) room.value = { ...room.value, state: state.value };
    }
  } catch (error) { notify(friendly(error), true); }
  finally { busy.value = false; }
}
async function toggleReady(): Promise<void> {
  if (!onlineMode.value) return;
  busy.value = true;
  try { await firebaseRoom.markReady(!isReady.value); }
  catch (error) { notify(friendly(error), true); }
  finally { busy.value = false; }
}
async function respondToOffer(accept: boolean): Promise<void> {
  if (!offer.value) return;
  busy.value = true;
  try {
    if (accept) { await firebaseRoom.acceptOffer(offer.value); page.value = 'lobby'; notify('Vaga aceita. Você assumiu o estado completo deste lugar. Escolha seu deck antes da próxima partida.'); }
    else await firebaseRoom.declineOffer(offer.value);
  } catch (error) { notify(friendly(error), true); }
  finally { busy.value = false; }
}
async function leaveRoom(): Promise<void> {
  if (onlineMode.value) await firebaseRoom.leave().catch(error => notify(friendly(error), true));
  onlineMode.value = false; state.value = undefined; room.value = { seats: {}, queue: [], online: false }; page.value = 'home';
}
function friendly(error: unknown): string { return error instanceof Error ? error.message : 'Não foi possível concluir a ação.'; }
</script>

<template>
  <DeckWorkshop v-if="page === 'workshop'" :decks="localDecks" :selected-deck-id="selectedDeck?.id" :busy="loading" :online="onlineMode && room.online" :notice="room.lastError ?? ''" @choose="chooseDeck" @refresh="loadStarters" @close="closeWorkshop" />

  <GameTable v-else-if="page === 'table' && state" :state="state" :seat-id="selfSeatId" :online="onlineMode && room.online" :spectator="!selfSeatId" :busy="busy" @actions="performActions" @leave="leaveRoom" />

  <main v-else-if="page === 'lobby'" class="lobby-shell">
    <header class="lobby-header"><button class="table-brand" @click="page='home'"><span class="brand-mark">M</span><span>MANA<span class="brand-soft">/</span>TABLE</span></button><span class="connection-badge"><i :class="room.online ? 'is-live' : ''"></i>{{ room.online ? 'CONECTADO' : 'RECONECTANDO' }}</span><button class="button button-ghost button-small" @click="leaveRoom">Sair da sala ↗</button></header>
    <section class="lobby-content"><div class="lobby-intro"><div><span class="eyebrow">SALA PRINCIPAL · UMA MESA · QUATRO LUGARES</span><h1>A mesa se prepara.<br><em>Seu lugar está aqui.</em></h1><p>{{ selfSeatId ? 'Escolha uma lista Commander e confirme quando estiver pronto.' : `Você está assistindo. ${room.queuePosition ? `Sua posição na fila é ${room.queuePosition}.` : 'Um lugar abrirá quando a partida terminar.'}` }}</p></div><div class="room-seal"><span>♛</span><small>COMMANDER<br>40 · 100 · 4</small></div></div>
      <div class="lobby-board"><div class="lobby-seat-grid"><article v-for="(item,index) in occupiedSeats" :key="item.id" class="lobby-seat" :class="[{ 'seat-self': item.id === selfSeatId, 'seat-ready': item.player?.ready, 'seat-empty': !item.player }, `seat-slot-${index}`]"><div class="seat-index">LUGAR {{ String(index+1).padStart(2,'0') }}<span v-if="item.id===selfSeatId">· SEU LUGAR</span></div><div v-if="item.player" class="seat-player"><span class="avatar-orbit"><i></i><b>{{ item.player.name.charAt(0).toUpperCase() }}</b></span><div><strong>{{ item.player.name }}</strong><small>{{ item.player.deckName ?? (item.player.ready ? 'Deck pronto' : 'Escolhendo deck') }}</small></div><span class="seat-presence" :class="item.player.online?'is-online':''">{{ item.player.ready ? 'PRONTO' : item.player.online ? 'ONLINE' : 'RECONEXÃO' }}</span></div><div v-else class="seat-placeholder"><span>＋</span><strong>Lugar disponível</strong><small>O próximo jogador ocupa este lugar</small></div><div v-if="item.player?.deckSummary?.length" class="seat-commanders"><span>♛</span><b v-for="leader in item.player.deckSummary" :key="leader.cardId">{{ leader.name }}</b><span class="seat-count">100 CARTAS</span></div><div v-else class="seat-commanders empty-commander">Sem comandante confirmado</div></article></div><div class="lobby-center"><span class="center-rings">✳</span><b>{{ occupiedSeats.filter(item=>item.player).length }}<i>/</i>4</b><span>JOGADORES<br>NA MESA</span><div class="center-line"></div><span class="queue-total">{{ room.queue.length }} NA FILA</span></div></div>
      <div class="lobby-bottom"><div class="your-place-card"><div class="place-icon">{{ selfSeatId ? '♛' : '⌛' }}</div><div><strong>{{ selfSeatId ? `Olá, ${mySeat?.name ?? name}` : 'Você está na fila de espera' }}</strong><small>{{ selfSeatId ? (mySeat?.deckName ? 'Deck selecionado · pronto para revisar' : 'Escolha um deck para liberar seu lugar') : room.queuePosition ? `Posição ${room.queuePosition} · você continua vendo a mesa` : 'Você receberá uma oferta quando alguém sair' }}</small></div></div><div class="lobby-actions"><button class="button button-secondary" @click="openWorkshop('lobby')">{{ selectedDeck || mySeat?.deckName ? 'Trocar deck' : 'Escolher deck' }} <span>↗</span></button><button v-if="selfSeatId" class="button button-primary" :disabled="busy || !mySeat?.deckName" @click="toggleReady">{{ isReady ? '✓ Confirmado' : 'Confirmar meu lugar' }} <span>↗</span></button><button v-else class="button button-secondary" @click="openWorkshop('lobby')">Preparar um deck <span>↗</span></button></div></div><p class="lobby-footnote"><span>✳</span> Convites para substituição duram 30 segundos. Uma conexão perdida reserva o lugar por 2 minutos.</p>
    </section>
    <div v-if="offer" class="modal-scrim"><section class="offer-modal"><span class="offer-symbol">♛</span><span class="eyebrow">SEU LUGAR NA FILA CHEGOU</span><h2>Uma vaga está aberta.</h2><p>{{ offer.candidateName }} saiu de <b>{{ room.seats[offer.seatId]?.name ?? 'um jogador' }}</b>. Ao aceitar, você herda a mão, o deck e as permanentes desse lugar.</p><div class="offer-count"><strong>{{ offerSeconds.toString().padStart(2,'0') }}</strong><span>SEGUNDOS PARA RESPONDER</span></div><div class="offer-actions"><button class="button button-ghost" :disabled="busy" @click="respondToOffer(false)">Recusar oferta</button><button class="button button-primary" :disabled="busy || offerSeconds===0" @click="respondToOffer(true)">{{ busy ? 'Entrando…' : 'Aceitar vaga' }} <span>↗</span></button></div><small>Ao recusar, sua posição fica mantida para a próxima vaga.</small></section></div>
  </main>

  <main v-else class="home-shell">
    <header class="home-header"><div class="table-brand"><span class="brand-mark">M</span><span>MANA<span class="brand-soft">/</span>TABLE</span></div><div class="home-nav"><span>COMMANDER · QUATRO JOGADORES</span><i></i><span>MESA ASSISTIDA</span></div><span class="home-build"><b>POC</b> · BUILD 0.1</span></header>
    <section class="home-hero"><div class="hero-copy"><span class="eyebrow"><i></i> UMA MESA COMPARTILHADA</span><h1>A partida acontece<br>em <em>volta da mesa.</em></h1><p>Jogue Commander com quem está longe. Organize o seu campo, acompanhe a pilha e deixe as regras mais repetitivas por nossa conta.</p><div class="home-form"><label for="player-name">COMO PODEMOS TE CHAMAR?</label><div class="name-entry"><span>♙</span><input id="player-name" v-model="name" maxlength="28" placeholder="Seu nome na mesa" @keyup.enter="onlineMode ? undefined : startDemo()"><kbd>{{ name.trim().length < 2 ? 'SEU NOME' : 'PRONTO' }}</kbd></div><div class="home-actions"><button class="button button-primary button-wide" :disabled="loading" @click="onlineMode ? page='lobby' : startDemo()">{{ loading ? 'Preparando sua mesa…' : 'Entrar na mesa' }} <span>↗</span></button><button v-if="firebaseRoom.isConfigured" class="button button-secondary button-wide" :disabled="loading" @click="connect">Conectar com jogadores <span>◎</span></button><button v-else class="button button-secondary button-wide" :disabled="loading" @click="connect">Conectar com jogadores <span>◎</span></button></div><span class="home-form-note"><i :class="firebaseRoom.isConfigured ? 'is-live':''"></i>{{ firebaseRoom.isConfigured ? 'Firebase pronto · sala principal' : 'Demonstração pronta · configure Firebase para jogar online' }}</span></div><button class="home-deck-link" @click="openWorkshop('home')"><span>▤</span><span><b>Biblioteca de decks</b><small>Importe, crie ou escolha uma lista salva</small></span><span>↗</span></button></div>
      <div class="hero-visual"><div class="visual-grid"></div><div class="ambient-glow"></div><div class="visual-arc visual-arc-a"></div><div class="visual-arc visual-arc-b"></div><div class="mini-table"><span class="mini-mat mini-nw"><i>♙</i><b></b><b></b><small>01 · VIDA 38</small></span><span class="mini-mat mini-ne"><i>♙</i><b></b><b></b><small>02 · VIDA 40</small></span><span class="mini-mat mini-se"><i>♙</i><b></b><b></b><small>03 · VIDA 35</small></span><span class="mini-mat mini-sw"><i>♙</i><b></b><b></b><small>04 · VOCÊ</small></span><span class="mini-hub"><i>✳</i><b>PILHA</b><small>2 RESPOSTAS</small></span><span class="mini-card mini-card-a">♛</span><span class="mini-card mini-card-b">✦</span></div><div class="visual-caption"><span>CAMPO DE BATALHA · VISTA ISOMÉTRICA</span><i></i><span>4 LUGARES</span><i></i><span>UMA PILHA COMPARTILHADA</span></div><span class="orbit-label orbit-label-a">CTRL + D <i>·</i> COMPRAR</span><span class="orbit-label orbit-label-b">T <i>·</i> VIRAR</span></div></section>
    <section class="home-features"><article><span class="feature-no">01 / 04</span><span class="feature-glyph">♙</span><strong>Quatro lugares.<br>Uma partida.</strong><small>Quem chegar depois assiste e entra na fila.</small></article><article><span class="feature-no">02 / 04</span><span class="feature-glyph">⌘</span><strong>Seu campo,<br>suas regras.</strong><small>Arraste as permanentes para onde quiser.</small></article><article><span class="feature-no">03 / 04</span><span class="feature-glyph">◈</span><strong>Menos conta.<br>Mais jogo.</strong><small>Mana, vida e pilha ficam sincronizadas.</small></article><article><span class="feature-no">04 / 04</span><span class="feature-glyph">▤</span><strong>Os decks<br>são seus.</strong><small>Cache local. Importe ou monte o seu.</small></article></section>
    <footer class="home-footer"><span><i>✳</i> MANA / TABLE</span><span>UMA EXPERIÊNCIA CASUAL DE COMMANDER</span><button @click="openWorkshop('home')">VER BIBLIOTECA DE DECKS ↗</button></footer>
  </main>
  <div v-if="feedback" class="toast-message" :class="fatalError?'is-error':''" role="status"><span>{{ fatalError ? '!' : '✳' }}</span>{{ feedback }}<button @click="feedback='';fatalError=''">×</button></div>
</template>
