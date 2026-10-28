<script setup lang="ts">
import { version as appVersion } from '../package.json';
import { computed, onBeforeUnmount, onMounted, nextTick, ref, toRaw, watch } from 'vue';
import LanguageSelector from './components/LanguageSelector.vue';
import DeckWorkshop from './components/DeckWorkshop.vue';
import GameTable from './components/GameTable.vue';
import LobbyTable from './components/LobbyTable.vue';
import RoomBrowser from './components/RoomBrowser.vue';
import CardInspection from './components/CardInspection.vue';
import AppCursor from './components/AppCursor.vue';
import ChatComposer from './components/ChatComposer.vue';
import AgentPromptDialog from './components/AgentPromptDialog.vue';
import { visibleChat, type ChatMessage } from './domain/chat';
import { TARGET_DURATION, targetReferenceValid, validTargetIntent, type TargetIntent, type TargetMark } from './domain/tableTargets';
import meuMagicLogo from './assets/meu-magic-logo.svg';
import type { DeckDefinition, GameAction, MatchState } from './domain/game';
import { applyAction } from './domain/game';
import { MatchHistory, restoreHistorySnapshot } from './domain/history';
import { localRepository } from './services/storage';
import { TABLE_SEATS, type ReplacementOffer, type RoomSnapshot, type TableSeatId } from './services/firebaseRoom';
import { getLibraryDecks, getStarterDecks } from './services/starters';
import { prepareStartupCards } from './services/startup';
import { addStressObjects, startDemoMatch } from './services/demo';
import { validPlaymatId } from './services/playmats';
import { firebaseConnectionError } from './services/firebaseState';
import type { HandPresence, HandPresenceInput } from './domain/tablePresence';
import type { HandRevealRequest, HandRevealView } from './domain/handReveal';
import { roomBackend, type JoinedRoom } from './services/roomBackend';
import { peerRoom } from './services/peerRoom';
import { RoomNotificationTracker, showSystemNotification } from './services/systemNotifications';
import { mcpAgents } from './services/mcpAgents';
import { validateDeck } from './domain/deck';
import { errorMessageKey, initialPreference, initializeLocale, normalizePreference, useAppI18n, type LanguagePreference } from './i18n';

type Page = 'home' | 'rooms' | 'lobby' | 'workshop' | 'table';
const page = ref<Page>('home');
const name = ref('');
const nameDraft = ref('');
const nameInput = ref<HTMLInputElement>();
const initialized = ref(false);
const splashVisible = ref(Boolean(window.meuMagicDesktop));
const splashReady = ref(false);
let startupSkipped = false;
const splashIncomplete = ref(false);
const splashProgress = ref<{ phase: 'cards' | 'images'; loaded: number; total: number }>({ phase: 'cards', loaded: 0, total: 0 });
const availableUpdate = ref<{ currentVersion: string; version: string; url: string } | null>(null);
const startupController = new AbortController();
function continueStartup(): void {
  if (!splashReady.value) { startupSkipped = true; startupController.abort(); }
  else splashVisible.value = false;
}
async function openUpdate(): Promise<void> {
  try { await window.meuMagicDesktop?.openUpdate(); } catch { /* The player can continue and retry on the next launch. */ }
}
const languagePreference = ref<LanguagePreference>(initialPreference);
const { t } = useAppI18n();
watch(() => initialized.value && page.value === 'home', visible => { if (visible) void nextTick(() => nameInput.value?.focus()); });
const editingName = ref(false);
const deckSyncFailed = ref(false);
const libraryNotice = ref('');
const localDecks = ref<DeckDefinition[]>([]);
const selectedDeck = ref<DeckDefinition>();
const state = ref<MatchState>();
const handPresence = ref<HandPresence[]>([]);
const handReveals = ref<HandRevealView[]>([]);
const handRevealPrompt = ref<HandRevealRequest>();
function visibleTableState(base: MatchState | undefined): MatchState | undefined {
  if (!base || !handReveals.value.length) return base;
  const next = structuredClone(base);
  for (const reveal of handReveals.value) for (const card of reveal.cards) {
    if (card.ownerId === reveal.ownerSeatId && card.zone === 'hand' && (!next.cards[card.id] || next.cards[card.id].zone === 'hand')) next.cards[card.id] = { ...structuredClone(card), temporaryReveal: true };
  }
  return next;
}
function withoutTemporaryHandReveals(value: MatchState): MatchState {
  const next = structuredClone(value);
  for (const [id, card] of Object.entries(next.cards)) if (card.temporaryReveal) {
    delete card.temporaryReveal;
    if (!room.value.state?.cards[id]) delete next.cards[id];
  }
  return next;
}
const chatMessages = ref<ChatMessage[]>([]);
const targetMarks = ref<TargetMark[]>([]);
const targetTimers = new Map<string, ReturnType<typeof setTimeout>>();
function clearTargets(): void {
  targetTimers.forEach(clearTimeout); targetTimers.clear(); targetMarks.value = [];
}
function receiveTargetEvent(event: Event): void {
  const mark = (event as CustomEvent<TargetMark>).detail;
  if (mark.matchId !== state.value?.id || targetTimers.has(mark.id)) return;
  targetMarks.value = [...targetMarks.value, mark];
  targetTimers.set(mark.id, setTimeout(() => {
    targetMarks.value = targetMarks.value.filter(item => item.id !== mark.id);
    targetTimers.delete(mark.id);
  }, TARGET_DURATION));
}
function receiveHandRevealState(event: Event): void {
  handReveals.value = (event as CustomEvent<HandRevealView[]>).detail ?? [];
  state.value = visibleTableState(room.value.state);
}
function receiveHandRevealPrompt(event: Event): void { handRevealPrompt.value = (event as CustomEvent<HandRevealRequest | undefined>).detail; }
function receiveHandRevealResult(event: Event): void {
  const result = (event as CustomEvent<{ accepted?: boolean; ownerName?: string; cancelled?: boolean }>).detail;
  if (result && !result.accepted) notifyMessage(result.cancelled ? t('table.handRevealCancelled', { name: result.ownerName ?? '' }) : t('table.handRevealDeclined', { name: result.ownerName ?? '' }), false);
}
async function requestHandReveal(ownerSeatId: TableSeatId): Promise<void> {
  try { await peerRoom.requestHandReveal(ownerSeatId); notifyMessage(t('table.handRevealRequested'), false); }
  catch (error) { notifyError(error); }
}
async function respondHandReveal(requestId: string, accept: boolean): Promise<void> {
  try { await peerRoom.respondHandReveal(requestId, accept); }
  catch (error) { notifyError(error); }
}
async function endHandReveal(): Promise<void> {
  try { await peerRoom.endOwnHandReveal(); }
  catch (error) { notifyError(error); }
}
async function sendTarget(intent: TargetIntent): Promise<void> {
  if (!selfSeatId.value || !state.value) return;
  if (onlineMode.value) {
    const visibleHands = new Set(handReveals.value.flatMap(reveal => reveal.cards.map(card => card.id)));
    if (!validTargetIntent(intent, state.value, visibleHands)) return;
    try { await peerRoom.sendTarget(intent); } catch (error) { notifyError(error); }
  } else receiveTargetEvent(new CustomEvent('target-mark', { detail: { ...intent, uid: 'local', seatId: selfSeatId.value, at: Date.now() } }));
}
watch(() => state.value?.id, clearTargets);
watch([() => targetMarks.value.map(mark => {
  const reference = (value: typeof mark.target) => value.kind === 'card' ? state.value?.cards[value.cardId]?.zone ?? 'missing' : state.value?.seats.some(seat => seat.id === value.seatId) ? 'player' : 'missing';
  return reference(mark.target) + (mark.kind === 'arrow' ? reference(mark.origin) : '');
}).join('|'), () => handReveals.value.map(reveal => reveal.cards.map(card => card.id).join(',')).join('|')], () => {
  const current = state.value;
  const visibleHands = new Set(handReveals.value.flatMap(reveal => reveal.cards.map(card => card.id)));
  if (!current) return;
  const validMarks = targetMarks.value.filter(mark => targetReferenceValid(mark.target, current, visibleHands) && (mark.kind !== 'arrow' || targetReferenceValid(mark.origin, current, visibleHands)));
  if (validMarks.length !== targetMarks.value.length) targetMarks.value = validMarks;
});
const chatNow = ref(Date.now());
const activeChat = computed(() => visibleChat(chatMessages.value, chatNow.value));
const room = ref<RoomSnapshot>({ seats: {}, queue: [], online: false });
const onlineMode = ref(false);
const notificationTracker = new RoomNotificationTracker();
const notificationPermission = ref(window.meuMagicDesktop ? 'granted' : typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
const notificationsEnabled = ref(true);
async function enableNotifications(): Promise<void> {
  if (typeof Notification === 'undefined') return;
  try { notificationPermission.value = await Notification.requestPermission(); } catch { notificationPermission.value = 'unsupported'; }
  if (notificationPermission.value === 'granted') { notificationsEnabled.value = true; await localRepository.setPreference('notifications-enabled', true); }
}
async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  if (enabled && !window.meuMagicDesktop && notificationPermission.value !== 'granted') { await enableNotifications(); return; }
  notificationsEnabled.value = enabled;
  await localRepository.setPreference('notifications-enabled', enabled);
}
const showNotificationButton = computed(() => !window.meuMagicDesktop && notificationPermission.value === 'default');
watch(() => room.value.connectionState, value => { if (onlineMode.value && (value === 'reconnecting' || value === 'disconnected')) clearTargets(); });
const loading = ref(false);
const libraryLoading = ref(false);
const starterProgress = ref({ loaded: 0, total: 0 });
const busy = ref(false);
const history = new MatchHistory();
const preferredPlaymat = ref<string>();
const customPlaymatsDisabled = ref(false);
const feedbackEvent = ref<{ key: string; params?: Record<string, string | number>; raw?: boolean }>();
const feedback = computed(() => feedbackEvent.value ? feedbackEvent.value.raw ? feedbackEvent.value.key : t(feedbackEvent.value.key, feedbackEvent.value.params ?? {}) : '');
const fatalError = ref('');
const storageWarning = ref(!localRepository.persistenceAvailable);
const inviteCode = ref('');
const activeRoomCode = ref('');
const mcpEndpoint = ref('');
const mcpError = ref('');
const showAgentPrompt = ref(false);
let removeMcpListener: (() => void) | undefined;
function showStorageWarning(): void { storageWarning.value = true; }
localRepository.addEventListener('persistence-unavailable', showStorageWarning);
const workshopReturn = ref<Page>('home');
const offerSeconds = ref(30);
const offer = computed(() => room.value.offer);
const localizedWorkshopNotice = computed(() => {
  const message = libraryNotice.value || room.value.lastError;
  return message ? t(message.includes('.') ? message : errorMessageKey(message)) : '';
});
const selfSeatId = computed(() => room.value.selfSeatId as TableSeatId | undefined);
const mySeat = computed(() => selfSeatId.value ? room.value.seats[selfSeatId.value] : undefined);
const isReady = computed(() => mySeat.value?.ready === true);
const playmatIds = computed(() => Object.fromEntries(TABLE_SEATS.flatMap(id => {
  const choice = validPlaymatId(onlineMode.value ? room.value.seats[id]?.playmatId : id === selfSeatId.value ? preferredPlaymat.value : undefined);
  return choice ? [[id, choice]] : [];
})) as Partial<Record<TableSeatId, string>>);
let offerTicker: ReturnType<typeof setInterval> | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
let removeInviteListener: (() => void) | undefined;
let removeQuitListener: (() => void) | undefined;
let chatTicker: ReturnType<typeof setInterval> | undefined;
function receiveChatEvent(event: Event): void {
  const message = (event as CustomEvent<ChatMessage>).detail;
  chatNow.value = Date.now();
  chatMessages.value = [...activeChat.value, message];
}
async function sendChat(text: string): Promise<void> {
  try { await peerRoom.sendChat(text); }
  catch (error) { notifyError(error); }
}

onMounted(async () => {
  const desktop = window.meuMagicDesktop;
  const updatePromise = desktop?.checkForUpdate().catch(() => null) ?? Promise.resolve(null);
  const startupTimer = desktop ? setTimeout(() => startupController.abort(), 45_000) : undefined;
  const preparation = desktop ? prepareStartupCards(startupController.signal, (phase, loaded, total) => {
    splashProgress.value = { phase, loaded, total };
  }).catch(() => true) : Promise.resolve(false);
  peerRoom.addEventListener('chat-message', receiveChatEvent);
  peerRoom.addEventListener('target-mark', receiveTargetEvent);
  peerRoom.addEventListener('hand-reveal-state', receiveHandRevealState);
  peerRoom.addEventListener('hand-reveal-prompt', receiveHandRevealPrompt);
  peerRoom.addEventListener('hand-reveal-result', receiveHandRevealResult);
  chatTicker = setInterval(() => { chatNow.value = Date.now(); if (chatMessages.value.length !== activeChat.value.length) chatMessages.value = activeChat.value; }, 500);
  removeInviteListener = window.meuMagicDesktop?.onInvite(code => {
    inviteCode.value = code;
    if (initialized.value && name.value && selectedDeck.value && !onlineMode.value && !editingName.value) page.value = 'rooms';
  });
  splashIncomplete.value = await preparation;
  if (startupTimer) clearTimeout(startupTimer);
  availableUpdate.value = await updatePromise;
  localDecks.value = await getLibraryDecks();
  const storedName = await localRepository.getPreference<string>('player-name');
  name.value = (storedName ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
  nameDraft.value = name.value;
  const deckId = await localRepository.getPreference<string>('selected-deck-id');
  selectedDeck.value = localDecks.value.find(deck => deck.id === deckId && deckIsValid(deck));
  preferredPlaymat.value = validPlaymatId(await localRepository.getPreference<string>('playmat-id'));
  customPlaymatsDisabled.value = (await localRepository.getPreference<boolean>('disable-custom-playmats')) === true;
  notificationsEnabled.value = (await localRepository.getPreference<boolean>('notifications-enabled')) !== false;
  languagePreference.value = normalizePreference(await localRepository.getPreference('language-preference'));
  languagePreference.value = initializeLocale(languagePreference.value, navigator.languages?.length ? navigator.languages : [navigator.language]);
  initialized.value = true;
  splashReady.value = true;
  if (!availableUpdate.value && (!splashIncomplete.value || startupSkipped)) splashVisible.value = false;
  if (name.value.length >= 2) {
    if (selectedDeck.value) page.value = 'rooms';
    else if (desktop && splashIncomplete.value) { workshopReturn.value = 'home'; page.value = 'workshop'; }
    else void openWorkshop('home');
  }
  removeMcpListener = window.meuMagicDesktop?.onMcpToolCall(payload => {
    void mcpAgents.invoke(payload.tool, payload.args).then(result => window.meuMagicDesktop?.resolveMcpTool(payload.id, result))
      .catch(error => window.meuMagicDesktop?.resolveMcpTool(payload.id, undefined, error instanceof Error ? error.message : 'Não foi possível executar a ferramenta MCP.'));
  });
  removeQuitListener = window.meuMagicDesktop?.onBeforeQuit(() => { void shutdownRoom().finally(() => window.meuMagicDesktop?.completeBeforeQuit()); });
  window.addEventListener('languagechange', updateAutomaticLocale);
});
onBeforeUnmount(() => {
  startupController.abort();
  peerRoom.removeEventListener('chat-message', receiveChatEvent);
  peerRoom.removeEventListener('target-mark', receiveTargetEvent);
  peerRoom.removeEventListener('hand-reveal-state', receiveHandRevealState);
  peerRoom.removeEventListener('hand-reveal-prompt', receiveHandRevealPrompt);
  peerRoom.removeEventListener('hand-reveal-result', receiveHandRevealResult);
  clearTargets();
  if (chatTicker) clearInterval(chatTicker);
  localRepository.removeEventListener('persistence-unavailable', showStorageWarning);
  window.removeEventListener('languagechange', updateAutomaticLocale);
  removeInviteListener?.(); removeQuitListener?.(); removeMcpListener?.();
  if (offerTicker) clearInterval(offerTicker);
  if (feedbackTimer) clearTimeout(feedbackTimer);
  void shutdownRoom();
});

function updateAutomaticLocale(): void {
  if (languagePreference.value !== 'auto') return;
  initializeLocale('auto', navigator.languages?.length ? navigator.languages : [navigator.language]);
}
async function changeLanguage(preference: LanguagePreference): Promise<void> {
  languagePreference.value = initializeLocale(preference, navigator.languages?.length ? navigator.languages : [navigator.language]);
  await localRepository.setPreference('language-preference', preference);
}

function notify(key: string, error = false, params?: Record<string, string | number>): void {
  feedbackEvent.value = { key, params }; fatalError.value = error ? key : '';
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { feedbackEvent.value = undefined; if (!error) fatalError.value = ''; }, error ? 9000 : 4800);
}
function notifyMessage(message: string, error = true): void {
  feedbackEvent.value = { key: message, raw: true }; fatalError.value = error ? message : '';
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { feedbackEvent.value = undefined; if (!error) fatalError.value = ''; }, error ? 9000 : 4800);
}
function notifyError(error: unknown): void { notify(errorMessageKey(error), true); }
function receiveRoom(next: RoomSnapshot): void {
  for (const event of notificationTracker.update(next)) {
    if (notificationsEnabled.value) showSystemNotification(t('app.name'), t(`notifications.${event.type}`, 'name' in event ? { name: event.name } : {}));
  }
  room.value = next;
  if (!next.state) { handReveals.value = []; handRevealPrompt.value = undefined; }
  state.value = visibleTableState(next.state);
  if (onlineMode.value) {
    const destination = next.state ? 'table' : 'lobby';
    if (page.value === 'workshop') workshopReturn.value = destination;
    else page.value = destination;
  }
  if (next.offer) updateOfferCountdown(next.offer);
  if (next.lastError) notifyMessage(next.lastError);
}
function resetHistory(): void { history.clear(); }
function updateOfferCountdown(current: ReplacementOffer): void {
  if (offerTicker) clearInterval(offerTicker);
  const refresh = () => { offerSeconds.value = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000)); };
  refresh(); offerTicker = setInterval(refresh, 1000);
}
async function validateName(): Promise<boolean> {
  const clean = name.value.trim().replace(/\s+/g, ' ').slice(0, 28);
  if (clean.length < 2) { notify('app.nameInvalid', true); return false; }
  name.value = clean; await localRepository.setPreference('player-name', clean); return true;
}
function deckIsValid(deck: DeckDefinition): boolean {
  return validateDeck(deck, new Map(deck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []))).length === 0;
}
// Match state and P2P checkpoints must contain serializable data, without Vue proxies.
function deckSnapshot(deck: DeckDefinition): DeckDefinition { return JSON.parse(JSON.stringify(deck)) as DeckDefinition; }
async function continueName(): Promise<void> {
  const previous = name.value;
  name.value = nameDraft.value;
  if (!await validateName()) { name.value = previous; return; }
  nameDraft.value = name.value; editingName.value = false;
  if (selectedDeck.value) page.value = 'rooms';
  else await openWorkshop('home');
}
function editName(): void {
  nameDraft.value = name.value; editingName.value = true; page.value = 'home';
}
async function syncSelectedDeck(): Promise<void> {
  if (!selectedDeck.value || state.value) return;
  busy.value = true; deckSyncFailed.value = true;
  try { await peerRoom.saveDeck(deckSnapshot(selectedDeck.value)); deckSyncFailed.value = false; }
  catch (error) { notifyError(error); }
  finally { busy.value = false; }
}
async function enterRoom(joined: JoinedRoom): Promise<void> {
  notificationTracker.reset();
  chatMessages.value = []; clearTargets();
  resetHistory(); loading.value = true; fatalError.value = ''; onlineMode.value = true; activeRoomCode.value = joined.code;
  try {
    const connected = await peerRoom.connect(joined, name.value, receiveRoom, hands => { handPresence.value = hands; });
    receiveRoom(connected);
    deckSyncFailed.value = false;
    // A returning ready player may still be waiting for the running match snapshot.
    if (!connected.state && !joined.member.ready && joined.member.role === 'player' && selectedDeck.value) await syncSelectedDeck();
    localDecks.value = await getLibraryDecks();
    if (joined.hostUid === roomBackend.uid && window.meuMagicDesktop) {
      try { mcpAgents.activate(); mcpEndpoint.value = await window.meuMagicDesktop.startMcpServer(); mcpError.value = ''; }
      catch (error) { mcpError.value = error instanceof Error ? error.message : 'O servidor MCP não pôde iniciar.'; }
    }
    if (!deckSyncFailed.value) notify(joined.member.seatId ? 'app.joinedAsPlayer' : 'app.joinedAsSpectator', false, { code: joined.code });
    inviteCode.value = '';
  } catch (error) {
    await roomBackend.leave().catch(() => peerRoom.closeTransport());
    onlineMode.value = false; page.value = 'rooms'; notifyError(firebaseConnectionError(error));
  } finally { loading.value = false; }
}
async function loadStarters(): Promise<void> {
  if (libraryLoading.value) return;
  libraryLoading.value = true;
  starterProgress.value = { loaded: 0, total: 0 };
  libraryNotice.value = '';
  try {
    const result = await getStarterDecks(undefined, (loaded, total) => { starterProgress.value = { loaded, total }; });
    localDecks.value = await getLibraryDecks();
    if (result.warning) libraryNotice.value = result.warning;
  } catch (error) { libraryNotice.value = errorMessageKey(error); }
    finally { localDecks.value = await getLibraryDecks(); libraryLoading.value = false; }
}
async function openWorkshop(returnPage: Page = page.value): Promise<void> {
  workshopReturn.value = returnPage; page.value = 'workshop';
  if (!localDecks.value.length && !libraryLoading.value) await loadStarters();
}
async function chooseDeck(deck: DeckDefinition): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    if (onlineMode.value) await peerRoom.saveDeck(deckSnapshot(deck));
    deckSyncFailed.value = false;
    selectedDeck.value = deck;
    await localRepository.setPreference('selected-deck-id', deck.id);
    localDecks.value = await getLibraryDecks();
    if (onlineMode.value) {
      notify(selfSeatId.value ? 'app.deckReady' : 'app.deckQueued');
      page.value = state.value ? 'table' : 'lobby';
    } else {
      page.value = 'rooms';
    }
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}
function closeWorkshop(): void { page.value = workshopReturn.value; }
function deckUpdated(deck: DeckDefinition): void {
  if (selectedDeck.value?.id === deck.id) selectedDeck.value = deck;
  void getLibraryDecks().then(decks => { localDecks.value = decks; });
}
async function startDemo(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  starterProgress.value = { loaded: 0, total: 0 };
  try {
    if (!await validateName()) return;
    const result = await getStarterDecks(undefined, (loaded, total) => { starterProgress.value = { loaded, total }; });
    localDecks.value = await getLibraryDecks();
    const demoState = startDemoMatch(name.value, result.decks, selectedDeck.value ? deckSnapshot(selectedDeck.value) : undefined);
    state.value = import.meta.env.DEV && new URLSearchParams(window.location.search).get('stress') === '200' ? addStressObjects(demoState, 200) : demoState;
    resetHistory();
    room.value = { seats: {}, queue: [], online: false, selfSeatId: 'southWest', state: state.value, gameReady: true };
    onlineMode.value = false; page.value = 'table';
    if (result.warning) notifyError(result.warning);
  } catch (error) { notifyError(error); }
  finally { loading.value = false; }
}
async function performActions(actions: GameAction[]): Promise<void> {
  const actorSeatId = selfSeatId.value;
  const currentState = state.value;
  if (!currentState || busy.value || !actorSeatId) return;
  busy.value = true;
  try {
    for (const action of actions) {
      const before = toRaw(state.value ?? currentState);
      const next = onlineMode.value ? visibleTableState(await peerRoom.act(action))! : applyAction(before, actorSeatId, action);
      state.value = next;
      history.record(withoutTemporaryHandReveals(before), withoutTemporaryHandReveals(toRaw(next)));
      if (!onlineMode.value) room.value = { ...room.value, state: next };
    }
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}
async function continueWithout(seatId: string): Promise<void> {
  if (!onlineMode.value || busy.value) return;
  busy.value = true;
  try { await peerRoom.continueWithout(seatId); }
  catch (error) { notifyError(error); }
  finally { busy.value = false; }
}
async function undoLastAction(): Promise<void> { await restoreHistory(false); }
async function redoLastAction(): Promise<void> { await restoreHistory(true); }
async function restoreHistory(redo: boolean): Promise<void> {
  const current = state.value; const seatId = selfSeatId.value;
  if (!current || !seatId || busy.value) return;
  const historySnapshot = history.target(redo, current.revision);
  const snapshot = historySnapshot ? withoutTemporaryHandReveals(historySnapshot) : undefined;
  if (!snapshot) return;
  busy.value = true;
  try {
    if (onlineMode.value) state.value = await peerRoom.restoreHistoryState(snapshot, current.revision, redo ? 'REDO' : 'UNDO');
    else state.value = restoreHistorySnapshot(snapshot, current, seatId, redo ? 'REDO' : 'UNDO', `history-${crypto.randomUUID()}`);
    history.restored(redo, state.value.revision);
    if (!onlineMode.value) room.value = { ...room.value, state: state.value };
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}
async function applyPlaymat(id: string | undefined): Promise<void> {
  if (busy.value || !selfSeatId.value) return;
  busy.value = true;
  try {
    if (onlineMode.value) await peerRoom.setPlaymat(id);
    await localRepository.setPreference('playmat-id', id ?? null);
    preferredPlaymat.value = id;
    notify(id ? 'app.playmatApplied' : 'app.playmatReset');
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}
async function setCustomPlaymatsDisabled(disabled: boolean): Promise<void> {
  customPlaymatsDisabled.value = disabled;
  await localRepository.setPreference('disable-custom-playmats', disabled);
}
async function toggleReady(): Promise<void> {
  if (!onlineMode.value || deckSyncFailed.value || busy.value || !mySeat.value?.deckName) return;
  busy.value = true;
  try { await peerRoom.markReady(!isReady.value); }
  catch (error) { notifyError(error); }
  finally { busy.value = false; }
}
async function respondToOffer(accept: boolean): Promise<void> {
  if (!offer.value) return;
  busy.value = true;
  try {
    if (accept) { notify('app.offerAccepted'); }
    else notify('app.offerDeclined');
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}
async function leaveRoom(): Promise<void> {
  notificationTracker.reset();
  if (onlineMode.value) await shutdownRoom().catch(notifyError);
  resetHistory(); onlineMode.value = false; activeRoomCode.value = ''; state.value = undefined; handPresence.value = []; chatMessages.value = []; room.value = { seats: {}, queue: [], online: false }; deckSyncFailed.value = false; page.value = 'rooms';
}
async function shutdownRoom(): Promise<void> {
  await window.meuMagicDesktop?.stopMcpServer().catch(() => {});
  await mcpAgents.closeAll();
  mcpEndpoint.value = ''; mcpError.value = ''; showAgentPrompt.value = false;
  await peerRoom.leave().catch(() => peerRoom.closeTransport());
}
async function copyMcpEndpoint(): Promise<void> {
  try { await navigator.clipboard.writeText(mcpEndpoint.value); notify('app.mcpCopied'); }
  catch { notify('app.mcpCopyFailed', true); }
}
async function copyRoomCode(): Promise<void> {
  if (!activeRoomCode.value) return;
  try { await navigator.clipboard.writeText(activeRoomCode.value); notify('lobby.codeCopied'); }
  catch { notify('lobby.codeCopyFailed', true); }
}
function publishHandPresence(presence: HandPresenceInput): void {
  if (onlineMode.value) peerRoom.publishHand(presence);
}
</script>

<template>
  <main v-if="splashVisible" class="startup-shell" :aria-busy="!splashReady">
    <header class="entry-header"><span class="table-brand"><img class="brand-logo" :src="meuMagicLogo" alt="" aria-hidden="true"/><span>{{ t('app.name') }}</span></span><LanguageSelector v-model="languagePreference" @update:model-value="changeLanguage"/></header>
    <section class="startup-panel">
      <img class="startup-logo" :src="meuMagicLogo" alt="" aria-hidden="true" />
      <h1>{{ t('app.name') }}</h1>
      <div v-if="!splashReady" role="status" aria-live="polite">
        <p>{{ t(splashProgress.phase === 'cards' ? 'startup.cards' : 'startup.images') }}</p>
        <progress v-if="splashProgress.total" :value="splashProgress.loaded" :max="splashProgress.total" :aria-label="t('startup.progress')" />
        <p v-if="splashProgress.total">{{ splashProgress.loaded }} / {{ splashProgress.total }}</p>
      </div>
      <p v-if="splashReady && splashIncomplete" role="status">{{ t('startup.incomplete') }}</p>
      <div v-if="splashReady && availableUpdate" class="startup-update" role="status">
        <h2>{{ t('startup.update') }}</h2><p>{{ t('startup.versions', { current: availableUpdate.currentVersion, latest: availableUpdate.version }) }}</p>
        <button class="button button-primary" @click="openUpdate">{{ t('startup.download') }}</button>
      </div>
      <button class="button button-ghost" @click="continueStartup">{{ t(splashReady ? 'common.continue' : 'startup.skip') }}</button>
    </section>
  </main>
  <main v-else-if="!initialized" class="entry-shell" aria-busy="true"><header class="entry-header"><span class="table-brand"><img class="brand-logo" :src="meuMagicLogo" alt="" aria-hidden="true"/><span>{{ t('app.name') }}</span></span><LanguageSelector v-model="languagePreference" @update:model-value="changeLanguage"/></header><p role="status">{{ t('common.loading') }}</p></main>
  <RoomBrowser v-else-if="page === 'rooms'" :player-name="name" :deck-name="selectedDeck?.name ?? ''" :invite-code="inviteCode" :busy="loading || busy" :demo-progress="loading ? starterProgress : undefined" @entered="enterRoom" @edit-name="editName" @edit-deck="openWorkshop('rooms')" @demo="startDemo">
    <template #header-actions><button v-if="showNotificationButton" class="button button-ghost button-small" @click="enableNotifications">{{ t('notifications.enable') }}</button><LanguageSelector v-model="languagePreference" @update:model-value="changeLanguage" /></template>
  </RoomBrowser>
  <DeckWorkshop v-else-if="page === 'workshop'" selection :decks="localDecks" :selected-deck-id="selectedDeck?.id" :busy="busy" :loading="libraryLoading" :loading-progress="starterProgress" :online="onlineMode && room.online" :notice="localizedWorkshopNotice" @choose="chooseDeck" @refresh="loadStarters" @updated="deckUpdated" @close="closeWorkshop">
    <template #header-actions><button v-if="showNotificationButton" class="button button-ghost button-small" @click="enableNotifications">{{ t('notifications.enable') }}</button><LanguageSelector v-model="languagePreference" @update:model-value="changeLanguage" /></template>
  </DeckWorkshop>

  <GameTable v-else-if="page === 'table' && state" :state="state" :seat-id="selfSeatId" :app-version="appVersion" :update-available="Boolean(availableUpdate)" :playmat-ids="playmatIds" :custom-playmats-disabled="customPlaymatsDisabled" :notifications-enabled="notificationsEnabled" :notification-permission="notificationPermission" :online="onlineMode && room.online" :multiplayer="onlineMode" :room-code="activeRoomCode" :online-seats="room.seats" :hand-presence="handPresence" :chat-messages="activeChat" :target-marks="targetMarks" :hand-reveals="handReveals" :hand-reveal-prompt="handRevealPrompt" :spectator="!selfSeatId" :busy="busy" :is-host="onlineMode && room.hostUid === roomBackend.uid" @open-update="openUpdate" @actions="performActions" @undo="undoLastAction" @redo="redoLastAction" @set-playmat="applyPlaymat" @set-custom-playmats-disabled="setCustomPlaymatsDisabled" @set-notifications-enabled="setNotificationsEnabled" @hand-presence="publishHandPresence" @target="sendTarget" @request-hand-reveal="requestHandReveal" @respond-hand-reveal="respondHandReveal" @end-hand-reveal="endHandReveal" @continue-without="continueWithout" @copy-room-code="copyRoomCode" @leave="leaveRoom">
    <template #header-actions><button v-if="showNotificationButton" class="button button-ghost button-small" @click="enableNotifications">{{ t('notifications.enable') }}</button><LanguageSelector v-model="languagePreference" @update:model-value="changeLanguage" /></template>
  </GameTable>

  <main v-else-if="page === 'lobby'" class="lobby-shell">
    <header class="lobby-header"><button class="table-brand" :aria-label="t('app.name')" @click="leaveRoom"><img class="brand-logo" :src="meuMagicLogo" alt="" aria-hidden="true"/><span>{{ t('app.name') }}</span></button><button v-if="activeRoomCode" class="room-code-badge" @click="copyRoomCode"><span>{{ t('lobby.inviteCode') }}</span><strong>{{ activeRoomCode }}</strong><small>{{ t('lobby.copyCode') }}</small></button><div class="lobby-header-actions"><span class="connection-badge" :title="room.transport === 'firebase' ? t('app.firebaseRelay') : room.transport === 'mixed' ? t('app.mixedTransport') : t('app.webrtc')"><i :class="room.online ? 'is-live' : ''"></i>{{ room.online ? t('app.connected') : t('app.reconnecting') }}<small v-if="room.transport === 'firebase'">· {{ t('app.firebaseRelay') }}</small><small v-else-if="room.transport === 'mixed'">· {{ t('app.mixedTransport') }}</small><small v-else-if="room.transport === 'p2p'">· {{ t('app.webrtc') }}</small></span><button v-if="showNotificationButton" class="button button-ghost button-small" @click="enableNotifications">{{ t('notifications.enable') }}</button><LanguageSelector v-model="languagePreference" @update:model-value="changeLanguage"/><button class="button button-ghost button-small" @click="leaveRoom">{{ t('app.leaveRoom') }} ↗</button></div></header>
    <section class="lobby-content"><div class="lobby-intro"><div><span class="eyebrow">{{ t('lobby.beforeTurn') }} · {{ t('table.gameTable').toUpperCase() }} · 4</span><h1>{{ t('lobby.heading') }}<br><em>{{ t('lobby.subheading') }}</em></h1><p>{{ selfSeatId ? t('lobby.chooseDeckDescription') : room.queuePosition ? t('lobby.waitingPosition', { position: room.queuePosition }) : t('lobby.watching') }}</p></div><div class="room-seal"><span>♛</span><small>COMMANDER<br>40 · 100 · 4</small></div></div>
      <div v-if="onlineMode" class="lobby-connections" role="status" aria-live="polite"><span v-for="peer in room.connectionPeers" :key="peer.uid">{{ t('app.connectionWith', { name: peer.name, route: t(`app.connectionRoutes.${peer.route}`) }) }}</span><span v-if="!room.connectionPeers?.length">{{ t(room.hostUid === room.selfUid ? 'app.connectionWaiting' : 'app.connectionChecking') }}</span></div>
      <div class="lobby-layout">
        <LobbyTable :room="room" :chat-messages="activeChat" />
        <aside class="lobby-setup"><span class="eyebrow">{{ selfSeatId ? t('lobby.beforeTurn') : t('lobby.watchRoom') }}</span><h2>{{ selfSeatId ? t('lobby.prepareSeat') : t('lobby.followTable') }}</h2><p class="lobby-setup-description">{{ selfSeatId ? t('lobby.readyDescription') : t('lobby.queueDescription') }}</p>
      <div class="lobby-bottom"><div class="your-place-card"><div class="place-icon">{{ selfSeatId ? '♛' : '⌛' }}</div><div><strong>{{ selfSeatId ? t('lobby.greeting', { name: mySeat?.name ?? name }) : t('lobby.waitingQueue') }}</strong><small>{{ selfSeatId ? (mySeat?.deckName ? t('lobby.deckReady') : t('lobby.chooseDeckPrompt')) : room.queuePosition ? t('lobby.queueWatching', { position: room.queuePosition }) : t('lobby.offerWaiting') }}</small></div></div><p v-if="deckSyncFailed" role="alert">{{ t('errors.unknown') }} <button class="button button-secondary" :disabled="busy" @click="syncSelectedDeck">{{ t('common.retry') }}</button></p><div class="lobby-actions"><button class="button button-secondary" @click="openWorkshop('lobby')">{{ selectedDeck || mySeat?.deckName ? t('lobby.changeDeck') : t('lobby.chooseDeck') }} <span aria-hidden="true">↗</span></button><button v-if="selfSeatId" class="button button-primary" :disabled="busy || deckSyncFailed || !mySeat?.deckName" @click="toggleReady">{{ isReady ? t('lobby.ready') : t('lobby.confirmSeat') }} <span aria-hidden="true">↗</span></button><button v-else class="button button-secondary" @click="openWorkshop('lobby')">{{ t('lobby.prepareDeck') }} <span aria-hidden="true">↗</span></button></div></div><p class="lobby-footnote"><span>✳</span> {{ t('lobby.offerNote') }}</p>
        <div v-if="mcpEndpoint || mcpError" class="mcp-endpoint" aria-label="Servidor MCP">
          <span class="mcp-endpoint-status"><i :class="mcpEndpoint ? 'is-live' : ''"></i>{{ mcpEndpoint ? t('app.mcpActive') : t('app.mcpUnavailable') }}</span>
          <p v-if="mcpEndpoint">{{ t('app.mcpInstructions') }}</p>
          <code v-if="mcpEndpoint">{{ mcpEndpoint }}</code>
          <p v-if="mcpError" role="alert">{{ mcpError }}</p>
          <div v-if="mcpEndpoint" class="mcp-actions"><button class="button button-secondary button-small" @click="copyMcpEndpoint">{{ t('app.mcpCopy') }}</button><button class="button button-primary button-small" @click="showAgentPrompt = true">{{ t('app.agentTitle') }}</button></div>
        </div>
        </aside>
      </div>
    </section>
    <AgentPromptDialog v-if="showAgentPrompt && mcpEndpoint" :endpoint="mcpEndpoint" @close="showAgentPrompt = false" @copied="notify('app.agentCopied')" @copy-failed="notify('app.agentCopyFailed', true)" />
    <div v-if="offer" class="modal-scrim"><section class="offer-modal"><span class="offer-symbol">♛</span><span class="eyebrow">{{ t('lobby.offerTitle') }}</span><h2>{{ t('lobby.offerTitle') }}</h2><p>{{ t('lobby.offerIntro', { candidate: offer.candidateName, seat: room.seats[offer.seatId]?.name ?? t('table.card') }) }}</p><div class="offer-count"><strong>{{ offerSeconds.toString().padStart(2,'0') }}</strong><span>{{ t('lobby.offerTimer') }}</span></div><div class="offer-actions"><button class="button button-ghost" :disabled="busy" @click="respondToOffer(false)">{{ t('lobby.decline') }}</button><button class="button button-primary" :disabled="busy || offerSeconds===0" @click="respondToOffer(true)">{{ busy ? t('lobby.entering') : t('lobby.accept') }} <span aria-hidden="true">↗</span></button></div><small>{{ t('lobby.offerNote') }}</small></section></div>
  </main>

  <main v-else class="entry-shell">
    <header class="entry-header"><span class="table-brand"><img class="brand-logo" :src="meuMagicLogo" alt="" aria-hidden="true"/><span>{{ t('app.name') }}</span></span><LanguageSelector v-model="languagePreference" @update:model-value="changeLanguage"/></header>
    <form class="entry-form" @submit.prevent="continueName">
      <label for="player-name">{{ t('app.playerName') }}</label>
      <input ref="nameInput" id="player-name" v-model="nameDraft" maxlength="28" :placeholder="t('app.playerNamePlaceholder')" autocomplete="nickname" autofocus />
      <button class="button button-primary" type="submit">{{ t('app.nameContinue') }} <span aria-hidden="true">→</span></button>
      <button v-if="editingName" class="button button-ghost" type="button" @click="editingName=false; page='rooms'">{{ t('common.cancel') }}</button>
    </form>
  </main>
  <p v-if="storageWarning" class="storage-warning" role="status">{{ t('app.storageWarning') }}</p>
  <div v-if="feedback" class="toast-message" :class="fatalError?'is-error':''" role="status"><span>{{ fatalError ? '!' : '✳' }}</span>{{ feedback }}<button :aria-label="t('common.close')" @click="feedbackEvent=undefined;fatalError=''">×</button></div>
  <CardInspection />
  <ChatComposer :active="onlineMode && (page === 'lobby' || page === 'table')" :can-send="Boolean(selfSeatId && room.online)" @send="sendChat" />
  <AppCursor :player-name="name || t('app.name')" />
</template>

<style scoped>
.entry-shell { min-height:100dvh; display:flex; flex-direction:column; align-items:center; padding:0 24px 24px; background:#101810; color:#e7eee2; }
.entry-header { width:min(100%,1280px); height:78px; flex:none; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); }
.entry-form { width:min(100%,360px); display:flex; flex-direction:column; gap:18px; margin:auto; }
.entry-form label { font:500 28px var(--heading); }
.entry-form input { width:100%; padding:16px; border:1px solid #b5c9a844; border-radius:8px; background:#182219; color:#eef3e9; font:16px var(--body); }
.entry-form input:focus-visible { outline:2px solid var(--lime); outline-offset:3px; }
.mcp-endpoint { width:100%; margin-top:20px; display:grid; gap:9px; padding:14px; border:1px solid rgba(184,230,119,.22); border-radius:9px; background:linear-gradient(145deg,#16231b99,#0d171399); }
.mcp-endpoint-status { display:flex; align-items:center; gap:7px; color:#b8e677; font:9px var(--mono); letter-spacing:.1em; }
.mcp-endpoint-status i { width:6px; height:6px; border-radius:50%; background:#d2a57c; }
.mcp-endpoint-status i.is-live { background:#b8e677; box-shadow:0 0 8px #b8e67788; }
.mcp-endpoint p { margin:0; color:#aab8ab; font-size:11px; line-height:1.45; }
.mcp-endpoint code { overflow-wrap:anywhere; color:#e1ebda; font:10px var(--mono); }
.mcp-actions { display:flex; flex-wrap:wrap; gap:8px; }
.lobby-invite { display:flex; align-items:center; gap:14px; width:fit-content; max-width:100%; margin-top:22px; padding:10px 12px; border:1px solid #b8e67738; border-radius:8px; background:#17231b; }
.lobby-invite > span { display:flex; flex-direction:column; gap:4px; }
.lobby-invite small { color:#9aaa91; font:8px var(--mono); letter-spacing:.1em; }
.lobby-invite strong { color:var(--lime); font:600 19px var(--mono); letter-spacing:.12em; }
</style>
