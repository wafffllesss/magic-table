<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import CardTile from './CardTile.vue';
import ScryfallProgress from './ScryfallProgress.vue';
import { closeCardInspection, openCardInspection } from '../services/cardInspection';
import CommanderThumbnails from './CommanderThumbnails.vue';
import ManaText from './ManaText.vue';
import type { CardDefinition, DeckDefinition, DeckEntry } from '../domain/game';
import { totalCards } from '../domain/game';
import { importTextDeck } from '../services/starters';
import { PRECONS } from '../services/precons';
import { validateDeck } from '../domain/deck';
import { localRepository } from '../services/storage';
import meuMagicLogo from '../assets/meu-magic-logo.svg';
import { scryfall } from '../services/scryfall';
import { cardNames, normaliseCardName as normalise } from '../domain/cardNames';
import { COMMANDER_COLORS, matchesCommanderColors } from '../domain/deckFilter';
import { cardTypeGroups, cardTypeKey } from '../domain/cardTypes';
import { errorMessageKey, localizeError, useAppI18n } from '../i18n';

const props = withDefaults(defineProps<{
  decks: DeckDefinition[];
  selectedDeckId?: string;
  busy?: boolean;
  notice?: string;
  online?: boolean;
  selection?: boolean;
  loading?: boolean;
  loadingProgress?: { loaded: number; total: number };
}>(), { selectedDeckId: '', busy: false, notice: '', online: false });
const { t } = useAppI18n();
const emit = defineEmits<{
  (event: 'choose', deck: DeckDefinition): void;
  (event: 'refresh'): void;
  (event: 'updated', deck: DeckDefinition): void;
  (event: 'close'): void;
}>();

const tab = ref<'ready' | 'import' | 'create'>('ready');
const activeDeckId = ref(props.selectedDeckId);
const savedDecks = ref([...props.decks]);
const importText = ref('Commander:\n1 Adeline, Resplendent Cathar\n\nDeck:\n35 Plains');
const busy = ref(false);
const refreshingCards = ref(false);
const requestProgress = ref<{ label: string; loaded: number; total: number; estimated: boolean }>();
const searchQuery = ref('');
const cardResults = ref<CardDefinition[]>([]);
const selectedCommander = ref<CardDefinition>();
const secondaryCommander = ref<CardDefinition>();
const newDeckName = ref('');
const newEntries = ref<DeckEntry[]>([]);
const customProblems = ref<string[]>([]);
const importerProblems = ref<string[]>([]);
const searchError = ref('');
const successEvent = ref<{ key: string; params?: Record<string, string | number> }>();
const success = computed(() => successEvent.value ? t(successEvent.value.key, successEvent.value.params ?? {}) : '');
const selectedCard = ref<CardDefinition>();
const manaBars = ['W', 'U', 'B', 'R', 'G', 'C'];
let activeSearch: AbortController | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => { clearTimeout(searchTimer); activeSearch?.abort(); });
function beginProgress(label = 'deck.checkingCards'): void { requestProgress.value = { label, loaded: 0, total: 0, estimated: true }; }
function endProgress(): void { requestProgress.value = undefined; }

const knownCards = computed(() => new Map([...savedDecks.value.flatMap(deck => deck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : [])), ...newEntries.value.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : [])]));
const activeDeck = computed(() => savedDecks.value.find(deck => deck.id === activeDeckId.value));
const deckDetailOpen = ref(false);
const selectionOverview = computed(() => props.selection && tab.value === 'ready' && !deckDetailOpen.value);
const detailColumns = computed(() => activeDeck.value ? groupDeckEntries(activeDeck.value) : []);
const loadedPrecons = computed(() => savedDecks.value.filter(deck => PRECONS.some(item => item.id === deck.id)).length);
const selectedColors = ref<string[]>([]);
const visibleDecks = computed(() => savedDecks.value.filter(deck => matchesCommanderColors(deck, selectedColors.value)));
const importedDeckCount = computed(() => activeDeck.value ? totalCards(activeDeck.value) : 0);
const searchBusy = ref(false);
const saveBusy = ref(false);

watch(() => props.decks, next => {
  savedDecks.value = [...next];
  if (!next.some(deck => deck.id === activeDeckId.value)) { activeDeckId.value = next[0]?.id ?? ''; deckDetailOpen.value = false; }
}, { immediate: true });

function openDeck(deck: DeckDefinition): void {
  activeDeckId.value = deck.id; deckDetailOpen.value = true; successEvent.value = undefined; importerProblems.value = [];
}
function returnToLibrary(): void { closeInspection(); deckDetailOpen.value = false; }
function inspectEntry(entry: DeckEntry, event: MouseEvent): void {
  const opener = event.currentTarget as HTMLElement;
  const element = opener.querySelector<HTMLElement>('.card-tile');
  if (element) openCardInspection({ element, opener, read: () => ({ definition: entry.card, quantity: entry.quantity }) });
}
function closeInspection(): void { closeCardInspection(); }
function groupDeckEntries(deck: DeckDefinition): { key: string; label: string; entries: DeckEntry[]; copies: number }[] {
  const groups = new Map<string, DeckEntry[]>();
  const order = ['commander', ...cardTypeGroups.map(group => group.key), 'other'];
  for (const entry of deck.entries) {
    const key = entry.role === 'commander' ? 'commander' : cardTypeKey(entry.card);
    const items = groups.get(key) ?? []; items.push(entry); groups.set(key, items);
  }
  const labels = new Map([['commander', t('cardTypes.commander')], ...cardTypeGroups.map(group => [group.key, t(`cardTypes.${group.key}`)] as [string, string]), ['other', t('cardTypes.other')]]);
  return order.flatMap(key => {
    const entries = groups.get(key);
    return entries?.length ? [{ key, label: labels.get(key) ?? 'Outros', entries: entries.sort((a, b) => a.name.localeCompare(b.name)), copies: entries.reduce((sum, entry) => sum + entry.quantity, 0) }] : [];
  });
}

watch(searchQuery, value => {
  if (searchTimer) clearTimeout(searchTimer);
  activeSearch?.abort();
  searchBusy.value = false;
  if (requestProgress.value?.label === 'deck.searching') endProgress();
  if (value.trim().length < 2) { cardResults.value = []; searchError.value = ''; return; }
  searchTimer = setTimeout(() => { void searchCards(value.trim()); }, 320);
});

async function searchCards(query = searchQuery.value.trim()): Promise<void> {
  if (query.length < 2) return;
  const controller = new AbortController();
  activeSearch?.abort(); activeSearch = controller; searchBusy.value = true; searchError.value = '';
  requestProgress.value = { label: 'deck.searching', loaded: 0, total: 0, estimated: true };
  try {
    const result = await scryfall.search(`f:commander ${query}`, 1, controller.signal);
    if (controller.signal.aborted) return;
    cardResults.value = result.data.slice(0, 14);
    if (!cardResults.value.length) searchError.value = 'deck.noSearchMatch';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    searchError.value = friendly(error);
    cardResults.value = [];
  } finally { if (activeSearch === controller) { searchBusy.value = false; endProgress(); } }
}

async function refreshActiveDeck(): Promise<void> {
  if (!activeDeck.value || busy.value || props.busy) return;
  busy.value = true; refreshingCards.value = true; importerProblems.value = []; successEvent.value = undefined;
  requestProgress.value = { label: 'deck.updating', loaded: 0, total: 0, estimated: false };
  try {
    const updated = await scryfall.refreshDeck(activeDeck.value, undefined, (loaded, total) => { requestProgress.value = { label: 'deck.updating', loaded, total, estimated: false }; });
    saveToList(updated); emit('updated', updated);
    successEvent.value = { key: 'deck.deckUpdated' };
  } catch (error) { importerProblems.value = [`${friendly(error)} ${t('deck.savedDeckKept')}`]; }
  finally { busy.value = false; refreshingCards.value = false; endProgress(); }
}

async function choosePrepared(deck: DeckDefinition): Promise<void> {
  if (busy.value || props.busy) return;
  busy.value = true; importerProblems.value = []; successEvent.value = undefined;
  beginProgress();
  try {
    const hydrated = await resolveDeck(deck);
    const issues = validateDeck(hydrated, knownCardsFor(hydrated));
    importerProblems.value = issues;
    if (issues.length) return;
    activeDeckId.value = hydrated.id;
    await prepareSelection(hydrated);
  } catch (error) { importerProblems.value = [friendly(error)]; }
  finally { busy.value = false; endProgress(); }
}

async function importList(): Promise<void> {
  busy.value = true; importerProblems.value = []; successEvent.value = undefined;
  beginProgress('deck.fetchingCards');
  try {
    const parsed = importTextDeck(importText.value);
    const resolved = await resolveDeck(parsed);
    const checks = validateDeck(resolved, knownCardsFor(resolved));
    if (checks.length) { importerProblems.value = checks; return; }
    resolved.name = parsed.name === 'Deck importado' ? 'Deck importado' : parsed.name;
    await localRepository.saveDeck(resolved); saveToList(resolved); activeDeckId.value = resolved.id; deckDetailOpen.value = true;
    emit('updated', resolved); tab.value = 'ready';
    successEvent.value = { key: 'deck.savedWith', params: { name: resolved.name, count: totalCards(resolved) } };
  } catch (error) { importerProblems.value = [friendly(error)]; }
  finally { busy.value = false; endProgress(); }
}

function setCommander(card: CardDefinition, position: 0 | 1): void {
  if (position === 0) selectedCommander.value = card;
  else secondaryCommander.value = card;
  customProblems.value = [];
  selectedCard.value = card;
}

function addCardToDraft(card: CardDefinition, role: DeckEntry['role'] = 'library'): void {
  if (role === 'commander') {
    if (!selectedCommander.value) setCommander(card, 0);
    else setCommander(card, 1);
    return;
  }
  const existing = newEntries.value.find(entry => entry.cardId === card.id);
  if (existing) existing.quantity = Math.min(99, existing.quantity + 1);
  else newEntries.value.push({ cardId: card.id, name: card.name, quantity: 1, role: 'library', card });
  customProblems.value = [];
}

function removeCardFromDraft(entry: DeckEntry): void {
  const existing = newEntries.value.find(item => item.cardId === entry.cardId);
  if (!existing) return;
  if (existing.quantity > 1) existing.quantity--;
  else newEntries.value = newEntries.value.filter(item => item.cardId !== entry.cardId);
}

async function saveCreatedDeck(): Promise<void> {
  const leaders = [selectedCommander.value, secondaryCommander.value].filter((item): item is CardDefinition => Boolean(item));
  if (!leaders.length) { customProblems.value = ['Escolha o comandante no resultado da busca.']; return; }
  const entries: DeckEntry[] = leaders.map(card => ({ cardId: card.id, name: card.name, quantity: 1, role: 'commander', card }));
  entries.push(...newEntries.value);
  const draft: DeckDefinition = { id: `deck-${crypto.randomUUID?.() ?? Date.now().toString(36)}`, name: newDeckName.value.trim() || t('deck.defaultName'), format: 'commander', commanders: leaders.map(card => card.id), entries, updatedAt: Date.now() };
  const cards = new Map(entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []));
  const issues = validateDeck(draft, cards);
  if (issues.length) { customProblems.value = issues; return; }
  saveBusy.value = true;
  beginProgress();
  try {
    const resolved = await resolveDeck(draft);
    const finalProblems = validateDeck(resolved, knownCardsFor(resolved));
    if (finalProblems.length) { customProblems.value = finalProblems; return; }
    await localRepository.saveDeck(resolved); saveToList(resolved); activeDeckId.value = resolved.id; deckDetailOpen.value = true;
    emit('updated', resolved); tab.value = 'ready'; successEvent.value = { key: 'deck.savedWith', params: { name: resolved.name, count: totalCards(resolved) } };
  } catch (error) { customProblems.value = [friendly(error)]; }
  finally { saveBusy.value = false; endProgress(); }
}

async function addRecommendedBasics(): Promise<void> {
  if (!selectedCommander.value) { customProblems.value = ['Escolha seu comandante antes de adicionar terrenos.']; return; }
  busy.value = true; customProblems.value = [];
  beginProgress();
  try {
    const identity = [...new Set([...(selectedCommander.value.color_identity ?? []), ...(secondaryCommander.value?.color_identity ?? [])])];
    const names = identity.map(color => ({ W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }[color] ?? '')).filter(Boolean);
    if (!names.length) names.push('Wastes');
    const basics = await scryfall.resolve(names);
    if (basics.length !== names.length) throw new Error('Não encontrei todos os terrenos básicos no Scryfall.');
    const each = Math.floor(35 / basics.length); let leftover = 35 - each * basics.length;
    for (const card of basics) {
      const targetQuantity = each + (leftover-- > 0 ? 1 : 0);
      const current = newEntries.value.find(entry => entry.cardId === card.id);
      if (current) current.quantity = Math.max(current.quantity, targetQuantity);
      else newEntries.value.push({ cardId: card.id, name: card.name, quantity: targetQuantity, role: 'library', card });
    }
    successEvent.value = { key: 'deck.basicsAdded' };
  } catch (error) { customProblems.value = [friendly(error)]; }
  finally { busy.value = false; endProgress(); }
}

async function resolveImport(): Promise<void> {
  busy.value = true; importerProblems.value = [];
  beginProgress();
  try {
    const resolved = await resolveDeck(importTextDeck(importText.value));
    const checks = validateDeck(resolved, knownCardsFor(resolved));
    if (checks.length) importerProblems.value = checks;
    else { activeDeckId.value = resolved.id; successEvent.value = { key: 'deck.recognized', params: { count: totalCards(resolved) } }; }
  } catch (error) { importerProblems.value = [friendly(error)]; }
  finally { busy.value = false; endProgress(); }
}

async function continueWithDeck(): Promise<void> {
  if (activeDeck.value) await choosePrepared(activeDeck.value);
}

async function deleteActiveDeck(): Promise<void> {
  if (!activeDeck.value || activeDeck.value.precon) return;
  await localRepository.deleteDeck(activeDeck.value.id);
  savedDecks.value = savedDecks.value.filter(deck => deck.id !== activeDeck.value?.id);
  activeDeckId.value = savedDecks.value[0]?.id ?? '';
  emit('refresh');
}

async function downloadActiveDeck(): Promise<void> {
  if (!activeDeck.value) return;
  const commanderLines = activeDeck.value.entries.filter(entry => entry.role === 'commander').map(entry => `1 ${entry.name}`);
  const cardLines = activeDeck.value.entries.filter(entry => entry.role === 'library').map(entry => `${entry.quantity} ${entry.name}`);
  const contents = `Commander:\n${commanderLines.join('\n')}\n\nDeck:\n${cardLines.join('\n')}\n`;
  const downloadUrl = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = downloadUrl; anchor.download = `${activeDeck.value.name.replace(/[^\p{L}\p{N}-]+/gu, '-')}.txt`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
}

function saveToList(deck: DeckDefinition): void {
  const index = savedDecks.value.findIndex(item => item.id === deck.id);
  if (index === -1) savedDecks.value = [deck, ...savedDecks.value];
  else savedDecks.value.splice(index, 1, deck);
}

async function prepareSelection(deck: DeckDefinition): Promise<void> {
  const refreshed = { ...deck, updatedAt: Date.now() };
  await localRepository.saveDeck(refreshed);
  saveToList(refreshed);
  emit('choose', refreshed);
}

async function resolveDeck(deck: DeckDefinition): Promise<DeckDefinition> {
  const names = [...new Set(deck.entries.filter(entry => !entry.card).map(entry => entry.name))];
  const results = await scryfall.resolve(names);
  const byName = new Map(results.flatMap(card => cardNames(card).map(name => [name, card] as const)));
  const missing = names.filter(name => !byName.has(normalise(name)));
  if (missing.length) throw new Error(`Cartas não encontradas no Scryfall: ${missing.join(', ')}.`);
  const entries = await Promise.all(deck.entries.map(async entry => {
    const card = entry.card ? await localRepository.getCard(entry.cardId) ?? entry.card : byName.get(normalise(entry.name));
    return { ...entry, cardId: card?.id ?? entry.cardId, name: card?.name ?? entry.name, card };
  }));
  const commanderIds = entries.filter(entry => entry.role === 'commander').map(entry => entry.cardId);
  return { ...deck, commanders: commanderIds, entries, updatedAt: Date.now() };
}

function knownCardsFor(deck: DeckDefinition): Map<string, CardDefinition> {
  return new Map(deck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []));
}

function formatColor(card?: CardDefinition): string {
  if (!card?.color_identity?.length) return 'Colorless';
  return card.color_identity.join(' · ');
}
function commanderIdentity(deck: DeckDefinition): string[] {
  return [...new Set(deck.entries.filter(entry => entry.role === 'commander').flatMap(entry => entry.card?.color_identity ?? []))];
}
function deckColor(deck: DeckDefinition): string {
  const identity = commanderIdentity(deck);
  return identity.length === 1 ? `identity-${identity[0].toLowerCase()}` : identity.length ? 'identity-multi' : 'identity-colorless';
}
function deckColorLabel(deck: DeckDefinition): string {
  const labels: Record<string, string> = { W: 'BRANCO', U: 'AZUL', B: 'PRETO', R: 'VERMELHO', G: 'VERDE', C: 'INCOLOR' };
  return commanderIdentity(deck).map(color => labels[color] ?? color).join(' / ') || 'INCOLOR';
}
function totalFor(entries: DeckEntry[]): number { return entries.reduce((count, entry) => count + entry.quantity, 0); }
function commanderNames(deck?: DeckDefinition): string { return deck?.commanders.map(commander => deck.entries.find(entry => entry.cardId === commander)?.name).filter(Boolean).join(' e ') ?? ''; }
function friendly(error: unknown): string { return errorMessageKey(error); }
function problemText(problem: string): string { return problem.includes('.') ? t(problem) : localizeError(problem); }
function clearSuccess(): void { successEvent.value = undefined; }
</script>

<template>
  <main class="workshop-shell" :class="{ 'selection-mode': selectionOverview }">
    <header class="workshop-header">
      <button class="wordmark back-button" type="button" @click="emit('close')" :aria-label="t('common.back')">
        <img class="brand-logo" :src="meuMagicLogo" alt="" aria-hidden="true"/><span>{{ t('app.name') }}</span>
      </button>
      <div class="workshop-header-meta"><span class="connection-mark" :class="online ? 'is-live' : ''"></span><span>{{ online ? t('deck.synced') : t('deck.storedLocally') }}</span></div>
      <slot name="header-actions" />
      <button class="button button-small button-ghost workshop-back" type="button" :disabled="busy || props.busy" @click="emit('close')">{{ selection ? t('deck.cancel') : t('deck.backToTable') }} <span aria-hidden="true">↗</span></button>
    </header>

    <div class="workshop-main" :class="{ 'is-deck-detail': deckDetailOpen && tab === 'ready' }">
      <aside class="collection-rail">
        <div class="eyebrow">{{ t('deck.library') }}</div>
        <div class="collection-heading"><h1>{{ t('deck.decks') }}</h1><span class="collection-count">{{ savedDecks.length.toString().padStart(2, '0') }}</span></div>
        <button class="collection-new" type="button" @click="tab = 'ready'; activeDeckId = ''; deckDetailOpen = false">
          <span class="collection-plus">＋</span><span>{{ t('deck.new') }}</span><span aria-hidden="true">↗</span>
        </button>
        <div class="deck-collection-list">
          <button v-for="deck in savedDecks" :key="deck.id" class="collection-row" :class="activeDeckId === deck.id ? 'is-selected' : ''" type="button" @click="tab = 'ready'; openDeck(deck)">
            <span class="deck-orbit" :class="deckColor(deck)"><i></i><i></i><i></i></span>
            <span class="collection-row-copy"><span>{{ deck.name }}</span><small>{{ deck.commanders.length === 2 ? t('deck.partnerSummary') : t('deck.commanderSummary') }}</small></span>
            <span class="collection-chevron">{{ activeDeckId === deck.id ? '↗' : '·' }}</span>
          </button>
          <p v-if="!savedDecks.length" class="empty-library">{{ t('deck.empty') }}</p>
        </div>
        <div class="collection-sidebar-foot"><span class="data-dot"></span><span>{{ t('deck.localData') }}</span></div>
      </aside>

      <section class="workshop-editor" :class="{ 'deck-inspection-page': deckDetailOpen && tab === 'ready' }">
        <div v-if="notice" class="workshop-notice" role="status"><span>✳</span> {{ notice }}</div>
        <div v-if="success" class="workshop-success" role="status"><span>✓</span> {{ success }}</div>
        <div v-if="importerProblems.length" class="workshop-problems" role="alert">
          <span class="problem-symbol">!</span><div><strong>{{ t('deck.reviewBeforePlay') }}</strong><p v-for="problem in importerProblems.slice(0, 5)" :key="problem">{{ problemText(problem) }}</p></div>
        </div>
        <div v-if="deckDetailOpen && tab === 'ready' && activeDeck">
          <div class="deck-inspection-heading">
            <div><button class="button button-small button-ghost" type="button" @click="returnToLibrary">← {{ t('deck.backToLibrary') }}</button><div class="eyebrow">{{ activeDeck.precon ? `${t('deck.officialPrecon')} · ${activeDeck.precon.edition}` : t('deck.inspectDeck') }}</div><h2>{{ activeDeck.name }}</h2><p>{{ t('deck.cardCount', { count: totalCards(activeDeck) }) }} · {{ commanderNames(activeDeck) || t('deck.noCommander') }}</p></div>
            <div class="deck-inspection-actions"><button class="button button-small button-ghost" type="button" @click="downloadActiveDeck">{{ t('deck.export') }}</button><button class="button button-small button-primary" type="button" :disabled="busy || props.busy" @click="continueWithDeck">{{ props.busy || busy ? t('deck.syncing') : t('deck.useDeck') }} <span aria-hidden="true">↗</span></button></div>
          </div>
          <div class="deck-columns-scroll" :aria-label="t('deck.cardsGrouped')">
            <section v-for="column in detailColumns" :key="column.key" class="deck-type-column" :aria-label="`${column.label}: ${t('deck.copies', { count: column.copies })}`">
              <header class="deck-type-heading"><strong>{{ column.label }}</strong><span>{{ column.copies }}</span></header>
              <div class="deck-type-cards">
                <button v-for="(entry, index) in column.entries" :key="entry.cardId" class="deck-inspection-card" :style="{ zIndex: index + 1 }" type="button" :aria-label="t('deck.inspectCard', { card: entry.name }) + (entry.quantity > 1 ? `, ${t('deck.copies', { count: entry.quantity })}` : '')" @click="inspectEntry(entry, $event)">
                  <CardTile v-if="entry.card" :definition="entry.card" :quantity="entry.quantity" /><span v-else class="deck-inspection-placeholder"><b>{{ entry.name }}</b></span>
                  <span v-if="entry.quantity > 1" class="deck-card-quantity">{{ entry.quantity }}×</span>
                </button>
              </div>
            </section>
          </div>
          <div class="deck-inspection-tools"><button class="preview-remove" type="button" :disabled="busy || props.busy" @click="refreshActiveDeck"><span v-if="refreshingCards" class="scryfall-spinner" aria-hidden="true"></span>{{ refreshingCards ? t('deck.updating') : t('deck.refreshCards') }} <span v-if="!refreshingCards">↻</span></button><button v-if="!activeDeck.precon" class="preview-remove" type="button" :disabled="busy || props.busy" @click="deleteActiveDeck">{{ t('deck.removeSaved') }} <span>×</span></button><a v-if="activeDeck.precon" class="preview-source" :href="activeDeck.precon.sourceUrl" target="_blank" rel="noopener noreferrer">{{ t('deck.officialSource') }} ↗</a></div>
        </div>
        <div v-else>
        <div class="workshop-toolbar">
          <div class="editor-tabs" role="tablist" :aria-label="t('deck.deckSource')">
            <button :class="tab === 'ready' ? 'active' : ''" role="tab" type="button" @click="tab = 'ready'; clearSuccess(); importerProblems = []">{{ t('deck.ready') }}</button>
            <button :class="tab === 'import' ? 'active' : ''" role="tab" type="button" @click="tab = 'import'; clearSuccess(); importerProblems = []">{{ t('deck.import') }}</button>
            <button :class="tab === 'create' ? 'active' : ''" role="tab" type="button" @click="tab = 'create'; clearSuccess(); importerProblems = []">{{ t('deck.create') }}</button>
          </div>
          <button class="format-pill" type="button"><span>♛</span> {{ t('deck.format') }} <span>⌄</span></button>
        </div>
        <ScryfallProgress v-if="requestProgress" :label="t(requestProgress.label)" :loaded="requestProgress.loaded" :total="requestProgress.total" :estimated="requestProgress.estimated" />

        <div v-if="tab === 'ready'">
          <div class="deck-page-title"><div><h2>{{ t('deck.chooseDeck') }}</h2><button v-if="loadedPrecons < PRECONS.length && savedDecks.length" class="button button-small button-ghost" :disabled="loading" @click="emit('refresh')">{{ loading ? t('deck.loading') : t('deck.loadMore') }}</button><ScryfallProgress v-if="loading" :label="t('deck.checkingCards')" :loaded="props.loadingProgress?.loaded ?? 0" :total="props.loadingProgress?.total ?? 0" :estimated="!(props.loadingProgress?.total)" /></div></div>
          <div v-if="!savedDecks.length" class="starter-loading">
            <span class="loading-glyph">✳</span><h3>{{ busy || props.busy || loading ? t('deck.checkingCards') : t('deck.emptyLibrary') }}</h3>
            <p>{{ t('deck.firstVisit') }}</p>
            <button class="button button-primary" type="button" :disabled="busy || props.busy || loading" @click="emit('refresh')">{{ busy || props.busy || loading ? t('deck.loadCards') : t('deck.loadPrecons', { count: PRECONS.length }) }}</button>
            <ScryfallProgress v-if="loading" :label="t('deck.checkingCards')" :loaded="props.loadingProgress?.loaded ?? 0" :total="props.loadingProgress?.total ?? 0" :estimated="!(props.loadingProgress?.total)" />
            <small>{{ t('deck.cached') }}</small>
          </div>
          <div v-else>
          <div class="deck-color-filter" role="group" :aria-label="t('deck.colorFilter')">
            <span class="deck-color-filter-label">{{ t('deck.colors') }}</span>
            <button v-for="color in COMMANDER_COLORS" :key="color.code" class="deck-color-option" :class="[`identity-${color.code.toLowerCase()}`, { 'is-active': selectedColors.includes(color.code) }]" type="button" :aria-pressed="selectedColors.includes(color.code)" :aria-label="t(`colors.${color.code}`)" @click="selectedColors = selectedColors.includes(color.code) ? selectedColors.filter(value => value !== color.code) : [...selectedColors, color.code]">{{ color.symbol }}</button>
            <span class="deck-color-filter-count" role="status" aria-live="polite">{{ t('deck.deckCount', { shown: visibleDecks.length, total: savedDecks.length }) }}</span>
            <button v-if="selectedColors.length" class="deck-color-filter-clear" type="button" @click="selectedColors = []">{{ t('deck.clearFilter') }}</button>
          </div>
          <div v-if="visibleDecks.length" class="starter-deck-grid">
            <article v-for="(deck, index) in visibleDecks" :key="deck.id" class="starter-card" :class="[deckColor(deck), activeDeckId === deck.id ? 'is-active' : '']">
              <span class="starter-art" :class="`starter-art-${index + 1}`"><CommanderThumbnails :entries="deck.entries.filter(entry => entry.role === 'commander')" /><span class="art-stamp">{{ deck.commanders.length === 2 ? 'DUO' : deckColorLabel(deck) }}</span><span class="art-index">{{ String(index + 1).padStart(2, '0') }} <i>·</i> {{ String(deck.entries.length).padStart(2, '0') }}</span><span class="art-sig">M / T</span></span>
              <span class="starter-copy"><span class="starter-kicker">{{ deck.precon ? `${t('deck.officialPrecon')} · ${deck.precon.setCode}` : deck.commanders.length === 2 ? (deck.entries.some(entry => entry.role === 'commander' && entry.card?.type_line.includes('Background')) ? t('deck.chooseBackground') : t('deck.commanderPair')) : deckColorLabel(deck) + ' · ' + t('deck.leader') }}</span><strong>{{ deck.name }}</strong><span class="starter-commander">{{ deck.entries.filter(entry => entry.role === 'commander').map(entry => entry.name).join('  /  ') }}</span><span class="starter-meta"><span>{{ t('deck.cardCount', { count: totalCards(deck) }).toUpperCase() }}</span><span>{{ deck.precon?.edition ?? t('deck.personalList') }}</span></span></span>
              <div class="selection-actions"><button class="button button-small button-primary" :disabled="busy || props.busy" :aria-label="t('deck.chooseNamed', { name: deck.name })" @click="choosePrepared(deck)">{{ t('deck.choose') }}</button><button class="button button-small button-ghost" :disabled="busy || props.busy" :aria-label="t('deck.detailsNamed', { name: deck.name })" @click="openDeck(deck)">{{ t('deck.details') }}</button></div>
            </article>
          </div>
          <div v-else class="starter-loading deck-filter-empty" role="status"><span class="loading-glyph">⌕</span><h3>{{ t('deck.noColorDecks') }}</h3><p>{{ t('deck.clearOrChoose') }}</p><button class="button button-small button-ghost" type="button" @click="selectedColors = []">{{ t('deck.clearFilter') }}</button></div>
          </div>
          <div v-if="activeDeck" class="selected-deck-bar">
            <div><span class="selected-check">✓</span><span><strong>{{ activeDeck.name }}</strong><small>{{ t('deck.cardCount', { count: totalCards(activeDeck) }) }} · {{ commanderNames(activeDeck) }}</small></span></div>
            <div class="selected-actions"><button class="button button-small button-ghost" type="button" @click="openDeck(activeDeck)">{{ t('deck.inspectCards') }}</button><button class="button button-small button-ghost" type="button" @click="downloadActiveDeck">{{ t('deck.export') }}</button><button class="button button-small button-primary" type="button" :disabled="busy || props.busy" @click="continueWithDeck">{{ props.busy || busy ? t('deck.syncing') : t('deck.useDeck') }} <span aria-hidden="true">↗</span></button></div>
          </div>
        </div>

        <div v-else-if="tab === 'import'">
          <div class="deck-page-title"><div><div class="eyebrow">{{ t('deck.import') }}</div><h2>{{ t('deck.importTitle') }}</h2><p>{{ t('deck.importHint') }}</p></div></div>
          <div class="import-format"><span class="format-label">{{ t('deck.acceptedFormat') }}</span><code>Commander:<br>1 Commander name<br><br>Deck:<br>35 Plains<br>64 other cards</code><span>{{ t('deck.importFormatHelp') }}</span></div>
          <label class="field-label" for="deck-import">{{ t('deck.yourList') }}</label><textarea id="deck-import" v-model="importText" class="deck-textarea" spellcheck="false" placeholder="Commander:&#10;1 Commander name&#10;&#10;Deck:&#10;1 Other card name"></textarea>
          <div class="import-actions"><span>{{ t('deck.importSavedWhileOpen') }}</span><div><button class="button button-small button-ghost" type="button" :disabled="busy" @click="resolveImport">{{ busy ? t('deck.checking') : t('deck.checkList') }}</button><button class="button button-small button-primary" type="button" :disabled="busy" @click="importList">{{ busy ? t('deck.fetchingCards') : t('deck.saveAndCheck') }} <span aria-hidden="true">↗</span></button></div></div>
        </div>

        <div v-else>
          <div class="deck-page-title"><div><div class="eyebrow">{{ t('deck.builder') }}</div><h2>{{ t('deck.buildFromCard') }}</h2><p>{{ t('deck.builderHelp') }}</p></div></div>
          <label class="field-label" for="deck-name">{{ t('deck.deckName') }}</label><input id="deck-name" v-model="newDeckName" class="deck-name-input" :placeholder="t('deck.defaultName')" maxlength="60">
          <div class="card-search-field"><label class="field-label" for="card-search">{{ t('deck.searchCards') }}</label><div class="search-with-button"><span class="search-glass">⌕</span><input id="card-search" v-model="searchQuery" :placeholder="t('deck.searchPlaceholder')"><button class="button button-small button-ghost" type="button" :disabled="searchBusy" @click="searchCards()">{{ searchBusy ? t('deck.searching') : t('deck.search') }}</button></div><div class="search-helper">{{ t('deck.searchHelp') }}</div></div>
          <div v-if="searchError" class="inline-error">{{ t(searchError) }}</div>
          <div v-if="cardResults.length" class="card-result-grid">
            <article v-for="card in cardResults" :key="card.id" class="search-result" :class="card.id === selectedCard?.id ? 'is-selected' : ''" @click="selectedCard = card">
              <div class="search-result-art"><CardTile :definition="card" compact /></div>
              <div class="search-result-info"><strong>{{ card.name }}</strong><span><ManaText :text="card.mana_cost || '◇'" /> · {{ card.type_line }}</span><small>{{ card.color_identity.join(' · ') || t('deck.colorless') }} <template v-if="card.legalities.commander === 'banned'">· {{ t('deck.banned') }}</template></small></div>
              <div class="search-result-actions"><button class="tiny-icon-button" :title="t('deck.setPrimaryCommander')" type="button" @click.stop="setCommander(card, 0)">♛</button><button v-if="selectedCommander && secondaryCommander?.id !== card.id" class="tiny-icon-button" :title="t('deck.setSecondaryCommander')" type="button" @click.stop="setCommander(card, 1)">＋</button><button v-if="card.legalities.commander !== 'banned'" class="add-card-button" type="button" @click.stop="addCardToDraft(card)">{{ t('deck.add') }}</button></div>
            </article>
          </div>
          <div v-if="selectedCommander" class="commander-choices">
            <div class="commander-slot"><span>{{ t('deck.commanderOne') }}</span><strong>{{ selectedCommander.name }}</strong><small>{{ t('deck.identity', { colors: formatColor(selectedCommander) }) }}</small><button type="button" @click="selectedCommander = undefined; customProblems = []">{{ t('deck.remove') }}</button></div>
            <div v-if="secondaryCommander" class="commander-slot commander-secondary"><span>{{ t('deck.commanderTwo') }}</span><strong>{{ secondaryCommander.name }}</strong><small>{{ t('deck.partnershipCheck') }}</small><button type="button" @click="secondaryCommander = undefined; customProblems = []">{{ t('deck.remove') }}</button></div>
          </div>
          <button class="button button-ghost basics-button" type="button" :disabled="busy || !selectedCommander" @click="addRecommendedBasics">{{ t('deck.addBasics') }}</button>
          <div class="draft-table-head"><span>{{ t('deck.inDeck') }}</span><span>{{ t('deck.cardCount', { count: totalFor(newEntries) }) }}</span></div>
          <div v-if="newEntries.length" class="draft-card-list"><div v-for="entry in [...newEntries].sort((a, b) => a.name.localeCompare(b.name))" :key="entry.cardId" class="draft-row"><span class="mana-pill"><ManaText :text="entry.card?.mana_cost || '◇'" /></span><strong>{{ entry.name }}</strong><span>{{ entry.quantity }}×</span><button class="tiny-icon-button" :title="t('deck.removeCopy')" type="button" @click="removeCardFromDraft(entry)">−</button><button class="tiny-icon-button" :title="t('deck.addCopy')" type="button" @click="entry.card && addCardToDraft(entry.card)">＋</button></div></div>
          <div v-else class="draft-empty">{{ t('deck.noCardsYet') }}</div>
          <div class="draft-footer"><div><span class="draft-total" :class="totalFor(newEntries) + (selectedCommander ? 1 : 0) + (secondaryCommander ? 1 : 0) === 100 ? 'is-valid' : ''">{{ totalFor(newEntries) + (selectedCommander ? 1 : 0) + (secondaryCommander ? 1 : 0) }}</span><span>/ 100 {{ t('deck.cardsWord') }}</span></div><button class="button button-small button-primary" type="button" :disabled="saveBusy" @click="saveCreatedDeck">{{ saveBusy ? t('deck.validating') : t('deck.validateSave') }} <span aria-hidden="true">↗</span></button></div>
          <div v-if="customProblems.length" class="workshop-problems" role="alert"><span class="problem-symbol">!</span><div><strong>{{ t('deck.deckNeedsChanges') }}</strong><p v-for="problem in customProblems.slice(0, 5)" :key="problem">{{ problemText(problem) }}</p></div></div>
        </div>
        </div>
      </section>

        <template v-if="!deckDetailOpen">
      <aside v-if="tab === 'ready' && activeDeck" class="deck-preview">
        <div class="preview-top"><span>{{ t('deck.tablePreview') }}</span><span>01 / 04</span></div>
        <div class="preview-mat"><div class="preview-permanent preview-left"><span class="preview-card-shape"></span><span class="preview-pip"></span></div><div class="preview-permanent preview-right"><span class="preview-card-shape"></span><span class="preview-pip"></span></div><span class="preview-orbit preview-orbit-one"></span><span class="preview-orbit preview-orbit-two"></span><div class="preview-commander-seal"><CommanderThumbnails :entries="activeDeck.entries.filter(entry => entry.role === 'commander')" /><span>{{ activeDeck.commanders.length === 2 ? t('deck.commanders') : t('deck.commander') }}</span><strong>{{ activeDeck.entries.find(entry => entry.role === 'commander')?.name ?? activeDeck.name }}</strong><small>{{ activeDeck.commanders.length === 2 ? t('deck.commanderTax') : t('deck.commandZone') }}</small></div><div class="preview-watermark">M / T</div></div>
        <div class="preview-stats"><div><strong>{{ totalCards(activeDeck) }}</strong><span>{{ t('deck.cardsWord').toUpperCase() }}</span></div><div><strong>{{ activeDeck.commanders.length === 2 ? '02' : '01' }}</strong><span>{{ activeDeck.commanders.length === 2 ? t('deck.commanders') : t('deck.commander') }}</span></div><div><strong>40</strong><span>{{ t('table.life') }}</span></div></div>
        <div class="preview-identity"><span>{{ t('deck.deckColors') }}</span><div class="identity-dots"> <span v-for="color in commanderIdentity(activeDeck)" :key="color" class="identity-dot" :class="`color-${color.toLowerCase()}`">{{ color }}</span><small>{{ commanderIdentity(activeDeck).join(' + ') || '◇' }}</small></div></div>
        <div class="preview-land-line"><span>{{ totalFor(activeDeck.entries.filter(entry => /\bBasic Land\b/.test(entry.card?.type_line ?? ''))) }}</span><i></i><span>{{ t('deck.basicLands') }}</span></div>
        <div class="preview-action"><button class="preview-remove" type="button" :disabled="busy || props.busy" @click="refreshActiveDeck"><span v-if="refreshingCards" class="scryfall-spinner" aria-hidden="true"></span>{{ refreshingCards ? t('deck.updating') : t('deck.refreshCards') }} <span v-if="!refreshingCards">↻</span></button><button v-if="!activeDeck.precon" class="preview-remove" type="button" :disabled="busy || props.busy" @click="deleteActiveDeck">{{ t('deck.removeSaved') }} <span>×</span></button><a v-if="activeDeck.precon" class="preview-source" :href="activeDeck.precon.sourceUrl" target="_blank" rel="noopener noreferrer">{{ t('deck.officialPrecon') }} · {{ activeDeck.precon.edition }} ↗</a><span v-else class="preview-source">{{ t('deck.officialCardsScryfall') }}</span></div>
      </aside>

      <aside v-else-if="tab === 'ready'" class="deck-preview preview-empty"><div class="eyebrow">{{ t('deck.tableForFour') }}</div><div class="empty-orbit">♛</div><strong>{{ t('deck.nextTurn1') }}<br>{{ t('deck.nextTurn2') }}</strong><span>{{ t('deck.chooseList') }}</span><div class="preview-source">COMMANDER · MULTIPLAYER</div></aside>
      <aside v-else-if="tab === 'create'" class="deck-preview preview-empty workshop-tips"><div class="eyebrow">{{ t('deck.deckDraft') }}</div><div class="empty-orbit">⌘</div><strong>{{ t('deck.possibilities1') }}<br>{{ t('deck.possibilities2') }}</strong><span>{{ t('deck.deckRules') }}</span><div class="tip-stats"><span><b>01</b>–<b>02</b> {{ t('deck.commandersCount') }}</span><span><b>100</b> {{ t('deck.totalCards') }}</span><span><b>0</b> {{ t('deck.bannedCards') }}</span></div></aside>
      <aside v-else class="deck-preview preview-empty workshop-tips"><div class="eyebrow">{{ t('deck.yourFile') }}</div><div class="empty-orbit">⇧</div><strong>{{ t('deck.pasteList1') }}<br>{{ t('deck.pasteList2') }}</strong><span>{{ t('deck.fileHelp') }}</span><div class="preview-source">{{ t('deck.quantityName') }}</div></aside>
        </template>
    </div>

    <footer class="workshop-footer"><span><span class="footer-spark">✳</span> Scryfall · {{ t('deck.officialDataOnDemand') }}</span><span>{{ t('deck.footerSaved') }} <i>·</i> {{ t('deck.footerSync') }}</span><button type="button" @click="emit('close')">{{ t('deck.close') }} ↗</button></footer>
  </main>
</template>


<style scoped>
.scryfall-spinner { display:inline-block; width:12px; height:12px; margin-right:6px; vertical-align:-2px; border:2px solid rgba(184,230,119,.3); border-top-color:var(--lime); border-radius:50%; animation:scryfall-spin .8s linear infinite; }
@keyframes scryfall-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .scryfall-spinner { animation:none; border-top-color:var(--lime); } }
.workshop-main.is-deck-detail { grid-template-columns:minmax(0,1fr); }
.deck-preview { position:sticky; top:12px; align-self:start; height:min(650px, calc(100dvh - 110px)); min-height:360px; }
.deck-color-filter { display:flex; align-items:center; flex-wrap:wrap; gap:7px; margin:0 0 13px; }
.deck-color-filter-label { margin-right:4px; color:#87968b; font:8px var(--mono); letter-spacing:.12em; }
.deck-color-option { display:grid; place-items:center; width:31px; height:31px; border:1px solid #d4e5d51f; border-radius:50%; background:#141d18; color:#b8c6b8; font:700 11px var(--mono); cursor:pointer; transition:transform .15s,border .15s,background .15s; }
.deck-color-option:hover { transform:translateY(-1px); border-color:#b8e67780; }
.deck-color-option.is-active { border-color:#b8e677; background:#b8e67724; color:#e7f4d8; box-shadow:0 0 0 2px #b8e67713; }
.deck-color-filter-count { margin-left:auto; color:#829087; font:9px var(--mono); }
.deck-color-filter-clear { padding:5px 8px; border:1px solid #d4e5d526; border-radius:5px; background:transparent; color:#b4c0b4; font:9px var(--heading); cursor:pointer; }
.deck-filter-empty { min-height:190px; }
.is-deck-detail > .collection-rail,.is-deck-detail > .deck-preview { display:none; }
.workshop-editor.deck-inspection-page { min-width:0; grid-column:1/-1; }
.deck-inspection-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding:3px 0 20px; border-bottom:1px solid var(--line); }
.deck-inspection-heading .button { margin-bottom:15px; }
.deck-inspection-heading .eyebrow { margin-top:4px; font-size:8px; }
.deck-inspection-heading h2 { margin:7px 0 5px; color:#e2ecdd; font:500 clamp(23px,3vw,34px)/1.1 var(--heading); letter-spacing:-.04em; }
.deck-inspection-heading p { margin:0; color:#94a38e; font-size:11px; }
.deck-inspection-actions { display:flex; flex-wrap:wrap; gap:8px; }
.deck-inspection-actions .button { margin:0; }
.deck-columns-scroll { display:flex; align-items:stretch; gap:12px; min-height:0; flex:1; overflow-x:auto; overflow-y:hidden; padding:17px 2px 20px; overscroll-behavior-x:contain; scrollbar-color:#647a50 #111a13; }
.deck-type-column { display:flex; flex:0 0 clamp(156px,17vw,220px); flex-direction:column; min-height:0; overflow:hidden; border:1px solid #c5ddc61c; border-radius:7px; background:#111a14a8; }
.deck-type-heading { position:sticky; z-index:3; top:0; display:flex; flex:none; align-items:center; justify-content:space-between; padding:12px 13px; border-bottom:1px solid #c5ddc61c; background:#152019; color:#d5e3cf; }
.deck-type-heading strong { font:600 12px var(--heading); }
.deck-type-heading span { display:grid; place-items:center; min-width:23px; height:23px; padding:0 5px; border:1px solid #b8e67736; border-radius:12px; color:#c6e59f; font:10px var(--mono); }
.deck-type-cards { min-height:0; overflow-y:auto; padding:12px 14px 18px; scrollbar-color:#526b47 transparent; }
.deck-inspection-card { position:relative; display:block; width:100%; aspect-ratio:146/204; margin:0 0 8px; padding:0; overflow:visible; border:0; border-radius:7px; background:#162219; color:#dbe7d5; cursor:pointer; text-align:left; filter:drop-shadow(0 4px 7px #0008); }
.deck-inspection-card + .deck-inspection-card { margin-top:calc(38px - 139.73%); }
.deck-inspection-card .card-tile,.deck-inspection-placeholder { display:block; width:100%; height:100%; overflow:hidden; border:1px solid #91a98575; border-radius:7px; background:linear-gradient(145deg,#263829,#111812); }
.deck-inspection-placeholder { padding:12px; }
.deck-inspection-placeholder b { color:#e5efde; font:600 12px var(--heading); }
.deck-inspection-card:focus-visible { outline:2px solid #b8e677; outline-offset:2px; }
.deck-inspection-tools { display:flex; flex-wrap:wrap; align-items:center; gap:15px; padding-top:12px; border-top:1px solid var(--line); }
.deck-inspection-tools .preview-remove { width:auto; }
.deck-card-modal-backdrop { position:fixed; z-index:1000; inset:0; display:grid; place-items:center; padding:22px; background:#050806d9; backdrop-filter:blur(5px); }
.deck-card-modal { position:relative; display:grid; grid-template-columns:minmax(180px,280px) minmax(220px,1fr); align-items:center; gap:clamp(20px,4vw,42px); width:min(780px,100%); max-height:calc(100dvh - 36px); overflow:auto; padding:clamp(20px,4vw,38px); border:1px solid #77936880; border-radius:12px; background:#111a14; color:#e1ecda; box-shadow:0 20px 90px #000c; outline:none; }
.deck-card-modal-close { position:absolute; z-index:2; top:10px; right:10px; }
.deck-card-modal-art { width:100%; max-width:280px; margin:auto; }
.deck-card-modal-art .card-tile { width:100%; aspect-ratio:146/204; border-radius:4%; box-shadow:0 12px 30px #0008; }
.deck-card-modal-copy { display:flex; flex-direction:column; gap:15px; }
.deck-card-modal-copy>.eyebrow { color:#a8c391; font-size:9px; line-height:1.6; }
.deck-card-modal-title { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
.deck-card-modal-title h2 { margin:0; font:500 clamp(20px,3vw,28px)/1.2 var(--heading); }
.deck-card-modal-title>b { flex:none; color:#cbdbbe; font:11px var(--mono); }
.deck-card-modal-copy>p { max-height:36vh; overflow:auto; margin:0; color:#bfccb7; font:12px/1.75 var(--heading); white-space:pre-line; }
.deck-card-stats { align-self:flex-end; padding:5px 9px; border:1px solid #d5e5cc38; border-radius:5px; color:#e2ecd9; font:12px var(--mono); }
.deck-card-faces { display:flex; flex-wrap:wrap; gap:7px; }
.deck-card-faces button { padding:7px 9px; border:1px solid #d5e5cc35; border-radius:5px; background:transparent; color:#b9c9b0; cursor:pointer; font:10px var(--heading); }
.deck-card-faces button.active { border-color:#b8e677aa; background:#b8e67716; color:#e0f0d3; }
.deck-card-modal-copy .inspection-hint { color:#879983; font:8px var(--mono); letter-spacing:.04em; }
.starter-art .commander-thumbnails { position: relative; z-index: 1; --commander-thumbnail-width: 36px; }
.preview-commander-seal .commander-thumbnails { position: relative; display: block; width: 158px; height: 150px; margin-bottom: 4px; }
.preview-commander-seal :deep(.commander-thumbnail) { position: absolute; width: 92px; }
.preview-commander-seal :deep(.commander-thumbnail:first-child) { z-index: 1; top: 4px; left: 50%; transform: translateX(-50%); }
.preview-commander-seal :deep(.commander-thumbnail:first-child:nth-last-child(2)) { top: 4px; left: 10px; transform: rotate(-6deg); }
.preview-commander-seal :deep(.commander-thumbnail:nth-child(2)) { z-index: 2; top: 16px; left: 64px; transform: rotate(5deg); }
@media (max-width: 700px) {
  .deck-inspection-heading { align-items:flex-start; flex-direction:column; gap:12px; padding-bottom:14px; }
  .deck-inspection-heading .button { margin-bottom:10px; }
  .deck-inspection-actions { width:100%; }
  .deck-inspection-actions .button-primary { margin-left:auto; }
  .deck-columns-scroll { min-height:55vh; gap:9px; padding:12px 1px 15px; }
  .deck-type-column { flex-basis:clamp(145px,58vw,195px); }
  .deck-type-heading { padding:10px; }
  .deck-type-cards { padding:10px; }
  .deck-inspection-card + .deck-inspection-card { margin-top:calc(35px - 139.73%); }
  .deck-card-modal-backdrop { padding:12px; }
  .deck-card-modal { grid-template-columns:minmax(90px,38%) minmax(0,1fr); align-items:start; gap:14px; max-height:calc(100dvh - 24px); padding:30px 14px 16px; }
  .deck-card-modal-copy { gap:10px; }
  .deck-card-modal-copy>.eyebrow { font-size:7px; }
  .deck-card-modal-title h2 { font-size:16px; }
  .deck-card-modal-title>b { font-size:8px; }
  .deck-card-modal-copy>p { font-size:10px; }
  .deck-card-faces { flex-direction:column; }
  .deck-card-faces button { text-align:left; }
  .starter-art .commander-thumbnails { --commander-thumbnail-width: 28px; }
}

.selection-mode .workshop-footer, .selection-mode .collection-rail, .selection-mode .deck-preview, .selection-mode .workshop-header-meta, .selection-mode .format-pill, .selection-mode .selected-deck-bar, .selection-mode .starter-kicker, .selection-mode .starter-commander, .selection-mode .starter-meta, .selection-mode .art-stamp, .selection-mode .art-index, .selection-mode .art-sig { display:none; }
.selection-mode .workshop-main { display:block; max-width:1100px; margin:auto; padding:28px 24px; }
.selection-mode .workshop-editor { width:100%; padding:0; }
.selection-mode .starter-deck-grid { grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); }
.selection-mode .starter-art { min-height:120px; height:140px; }
.selection-mode .starter-art .commander-thumbnails { --commander-thumbnail-width:72px; }
.selection-mode .starter-art :deep(.commander-thumbnail:not(:only-child)) { width:32px; }
.selection-mode .starter-copy { padding:16px; }
.selection-mode .starter-card { grid-template-columns:76px minmax(0,1fr); min-height:180px; }
.selection-mode .starter-art { width:76px; height:120px; min-height:120px; }
.selection-mode .starter-copy strong { white-space:normal; overflow-wrap:anywhere; line-height:1.4; }
.selection-mode .selection-actions { grid-column:1/-1; align-items:center; padding:8px 12px 12px; }
.selection-mode .workshop-header .wordmark { display:flex; align-items:center; gap:8px; }
.selection-actions { display:flex; gap:6px; flex-wrap:wrap; padding:0 16px 16px; }
.starter-card { cursor:default; }
.selection-mode .deck-page-title { margin:22px 0; min-height:0; }
.workshop-shell .workshop-back { display:inline-flex; }
@media(max-width:500px) { .selection-mode .workshop-main { padding:20px 16px; } .selection-mode .starter-deck-grid { grid-template-columns:1fr; } }
</style>
