<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CardDefinition, DeckDefinition, DeckEntry } from '../domain/game';
import { totalCards } from '../domain/game';
import { importTextDeck } from '../services/starters';
import { validateDeck } from '../domain/deck';
import { localRepository } from '../services/storage';
import { scryfall } from '../services/scryfall';

const props = withDefaults(defineProps<{
  decks: DeckDefinition[];
  selectedDeckId?: string;
  busy?: boolean;
  notice?: string;
  online?: boolean;
}>(), { selectedDeckId: '', busy: false, notice: '', online: false });
const emit = defineEmits<{
  (event: 'choose', deck: DeckDefinition): void;
  (event: 'refresh'): void;
  (event: 'close'): void;
}>();

const tab = ref<'ready' | 'import' | 'create'>('ready');
const activeDeckId = ref(props.selectedDeckId);
const savedDecks = ref([...props.decks]);
const importText = ref('Commander:\n1 Adeline, Resplendent Cathar\n\nDeck:\n35 Plains');
const busy = ref(false);
const searchQuery = ref('');
const cardResults = ref<CardDefinition[]>([]);
const selectedCommander = ref<CardDefinition>();
const secondaryCommander = ref<CardDefinition>();
const newDeckName = ref('Meu deck de Commander');
const newEntries = ref<DeckEntry[]>([]);
const customProblems = ref<string[]>([]);
const importerProblems = ref<string[]>([]);
const searchError = ref('');
const success = ref('');
const selectedCard = ref<CardDefinition>();
const manaBars = ['W', 'U', 'B', 'R', 'G', 'C'];
let activeSearch: AbortController | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const knownCards = computed(() => new Map([...savedDecks.value.flatMap(deck => deck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : [])), ...newEntries.value.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : [])]));
const activeDeck = computed(() => savedDecks.value.find(deck => deck.id === activeDeckId.value));
const importedDeckCount = computed(() => activeDeck.value ? totalCards(activeDeck.value) : 0);
const searchBusy = ref(false);
const saveBusy = ref(false);

watch(() => props.decks, next => {
  savedDecks.value = [...next];
  if (!activeDeckId.value && next.length) activeDeckId.value = next[0].id;
}, { immediate: true });

watch(searchQuery, value => {
  if (searchTimer) clearTimeout(searchTimer);
  activeSearch?.abort();
  if (value.trim().length < 2) { cardResults.value = []; searchError.value = ''; return; }
  searchTimer = setTimeout(() => { void searchCards(value.trim()); }, 320);
});

async function searchCards(query = searchQuery.value.trim()): Promise<void> {
  if (query.length < 2) return;
  activeSearch = new AbortController(); searchBusy.value = true; searchError.value = '';
  try {
    const result = await scryfall.search(`f:commander ${query}`, 1, activeSearch.signal);
    cardResults.value = result.data.slice(0, 14);
    if (!cardResults.value.length) searchError.value = 'Nenhuma carta encontrada com este termo.';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    searchError.value = friendly(error);
    cardResults.value = [];
  } finally { searchBusy.value = false; }
}

async function choosePrepared(deck: DeckDefinition): Promise<void> {
  if (props.busy) return;
  busy.value = true; importerProblems.value = []; success.value = '';
  try {
    const hydrated = await resolveDeck(deck);
    const issues = validateDeck(hydrated, knownCardsFor(hydrated));
    importerProblems.value = issues;
    if (issues.length) return;
    await localRepository.saveDeck(hydrated);
    saveToList(hydrated);
    activeDeckId.value = hydrated.id;
    await prepareSelection(hydrated);
  } catch (error) { importerProblems.value = [friendly(error)]; }
  finally { busy.value = false; }
}

async function importList(): Promise<void> {
  busy.value = true; importerProblems.value = []; success.value = '';
  try {
    const parsed = importTextDeck(importText.value);
    const resolved = await resolveDeck(parsed);
    const checks = validateDeck(resolved, knownCardsFor(resolved));
    if (checks.length) { importerProblems.value = checks; return; }
    resolved.name = parsed.name === 'Deck importado' ? 'Deck importado' : parsed.name;
    await localRepository.saveDeck(resolved); saveToList(resolved); activeDeckId.value = resolved.id;
    await prepareSelection(resolved);
    success.value = `“${resolved.name}” salvo com ${totalCards(resolved)} cartas.`;
  } catch (error) { importerProblems.value = [friendly(error)]; }
  finally { busy.value = false; }
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
  const draft: DeckDefinition = { id: `deck-${crypto.randomUUID?.() ?? Date.now().toString(36)}`, name: newDeckName.value.trim() || 'Meu deck', format: 'commander', commanders: leaders.map(card => card.id), entries, updatedAt: Date.now() };
  const cards = new Map(entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []));
  const issues = validateDeck(draft, cards);
  if (issues.length) { customProblems.value = issues; return; }
  saveBusy.value = true;
  try {
    const resolved = await resolveDeck(draft);
    const finalProblems = validateDeck(resolved, knownCardsFor(resolved));
    if (finalProblems.length) { customProblems.value = finalProblems; return; }
    await localRepository.saveDeck(resolved); saveToList(resolved); activeDeckId.value = resolved.id;
    await prepareSelection(resolved); success.value = `“${resolved.name}” salvo com ${totalCards(resolved)} cartas.`;
  } catch (error) { customProblems.value = [friendly(error)]; }
  finally { saveBusy.value = false; }
}

async function addRecommendedBasics(): Promise<void> {
  if (!selectedCommander.value) { customProblems.value = ['Escolha seu comandante antes de adicionar terrenos.']; return; }
  busy.value = true; customProblems.value = [];
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
    success.value = '35 terrenos básicos foram adicionados. Complete as outras cartas até chegar a 100.';
  } catch (error) { customProblems.value = [friendly(error)]; }
  finally { busy.value = false; }
}

async function resolveImport(): Promise<void> {
  busy.value = true; importerProblems.value = [];
  try {
    const resolved = await resolveDeck(importTextDeck(importText.value));
    const checks = validateDeck(resolved, knownCardsFor(resolved));
    if (checks.length) importerProblems.value = checks;
    else { activeDeckId.value = resolved.id; success.value = `Deck reconhecido. ${totalCards(resolved)} cartas, pronto para salvar.`; }
  } catch (error) { importerProblems.value = [friendly(error)]; }
  finally { busy.value = false; }
}

async function continueWithDeck(): Promise<void> {
  if (!activeDeck.value || props.busy) return;
  busy.value = true;
  try { await prepareSelection(activeDeck.value); }
  catch (error) { importerProblems.value = [friendly(error)]; }
  finally { busy.value = false; }
}

async function deleteActiveDeck(): Promise<void> {
  if (!activeDeck.value || activeDeck.value.id.startsWith('starter-')) return;
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
  const names = [...new Set(deck.entries.map(entry => entry.name))];
  const results = await scryfall.resolve(names);
  const byName = new Map(results.flatMap(card => [[normalise(card.name), card] as const, ...(card.card_faces ?? []).map(face => [normalise(face.name), card] as const)]));
  const entries = deck.entries.map(entry => {
    const card = byName.get(normalise(entry.name)) ?? entry.card;
    return { ...entry, cardId: card?.id ?? entry.cardId, name: card?.name ?? entry.name, card };
  });
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
function normalise(name: string): string { return name.trim().toLocaleLowerCase('en-US'); }
function friendly(error: unknown): string { return error instanceof Error ? error.message : 'Não foi possível carregar os dados desta carta.'; }
</script>

<template>
  <main class="workshop-shell">
    <header class="workshop-header">
      <button class="wordmark back-button" type="button" @click="emit('close')" aria-label="Voltar para a sala">
        <span class="brand-mark">M</span><span>MANA<span class="brand-soft">/</span>TABLE</span>
      </button>
      <div class="workshop-header-meta"><span class="connection-mark" :class="online ? 'is-live' : ''"></span><span>{{ online ? 'Sincronizado com a mesa' : 'Seus decks ficam neste computador' }}</span></div>
      <button v-if="activeDeck" class="button button-small button-ghost workshop-back" type="button" @click="emit('close')">Voltar à mesa <span>↗</span></button>
    </header>

    <div class="workshop-main">
      <aside class="collection-rail">
        <div class="eyebrow">SUA BIBLIOTECA</div>
        <div class="collection-heading"><h1>Decks</h1><span class="collection-count">{{ savedDecks.length.toString().padStart(2, '0') }}</span></div>
        <button class="collection-new" type="button" @click="tab = 'ready'; activeDeckId = ''">
          <span class="collection-plus">＋</span><span>Novo deck</span><span>↗</span>
        </button>
        <div class="deck-collection-list">
          <button v-for="deck in savedDecks" :key="deck.id" class="collection-row" :class="activeDeckId === deck.id ? 'is-selected' : ''" type="button" @click="activeDeckId = deck.id; tab = 'ready'; success = ''; importerProblems = []">
            <span class="deck-orbit" :class="deckColor(deck)"><i></i><i></i><i></i></span>
            <span class="collection-row-copy"><span>{{ deck.name }}</span><small>{{ deck.commanders.length === 2 ? 'PARTNER · 100 CARTAS' : 'COMMANDER · 100 CARTAS' }}</small></span>
            <span class="collection-chevron">{{ activeDeckId === deck.id ? '↗' : '·' }}</span>
          </button>
          <p v-if="!savedDecks.length" class="empty-library">Nenhum deck salvo. Comece com uma lista pronta ou importe a sua.</p>
        </div>
        <div class="collection-sidebar-foot"><span class="data-dot"></span><span>Cartas e imagens buscadas sob demanda</span></div>
      </aside>

      <section class="workshop-editor">
        <div class="workshop-toolbar">
          <div class="editor-tabs" role="tablist" aria-label="Origem do deck">
            <button :class="tab === 'ready' ? 'active' : ''" role="tab" type="button" @click="tab = 'ready'; success = ''; importerProblems = []">Prontos</button>
            <button :class="tab === 'import' ? 'active' : ''" role="tab" type="button" @click="tab = 'import'; success = ''; importerProblems = []">Importar</button>
            <button :class="tab === 'create' ? 'active' : ''" role="tab" type="button" @click="tab = 'create'; success = ''; importerProblems = []">Criar deck</button>
          </div>
          <button class="format-pill" type="button"><span>♛</span> COMMANDER <span>⌄</span></button>
        </div>

        <div v-if="notice" class="workshop-notice" role="status"><span>✳</span> {{ notice }}</div>
        <div v-if="success" class="workshop-success" role="status"><span>✓</span> {{ success }}</div>
        <div v-if="importerProblems.length" class="workshop-problems" role="alert">
          <span class="problem-symbol">!</span><div><strong>Confira estes pontos antes de jogar</strong><p v-for="problem in importerProblems.slice(0, 5)" :key="problem">{{ problem }}</p></div>
        </div>

        <template v-if="tab === 'ready'">
          <div class="deck-page-title"><div><div class="eyebrow">PRONTOS PARA A MESA</div><h2>Escolha seu próximo deck.</h2><p>Quatro listas de Commander válidas, incluindo um par Partner e um deck com Background.</p></div><span class="page-count">{{ savedDecks.length }} LISTAS</span></div>
          <div v-if="!savedDecks.length" class="starter-loading">
            <span class="loading-glyph">✳</span><h3>{{ busy || props.busy ? 'Conferindo cartas com o Scryfall…' : 'Sua biblioteca está vazia.' }}</h3>
            <p>Na primeira visita, buscamos as listas de Commander e guardamos as cartas usadas neste computador.</p>
            <button class="button button-primary" type="button" :disabled="busy || props.busy" @click="emit('refresh')">{{ busy || props.busy ? 'Carregando cartas' : 'Carregar quatro decks' }}</button>
            <small>400 cartas na biblioteca inteira não precisam ser baixadas.</small>
          </div>
          <div v-else class="starter-deck-grid">
            <button v-for="(deck, index) in savedDecks" :key="deck.id" type="button" class="starter-card" :class="[deckColor(deck), activeDeckId === deck.id ? 'is-active' : '']" @click="choosePrepared(deck)">
              <span class="starter-art" :class="`starter-art-${index + 1}`"><span class="art-glow"></span><span class="art-orbit" :class="deckColor(deck)"></span><span class="art-stamp">{{ deck.commanders.length === 2 ? 'DUO' : deckColorLabel(deck) }}</span><span class="art-index">{{ String(index + 1).padStart(2, '0') }} <i>·</i> {{ String(deck.entries.length).padStart(2, '0') }}</span><span class="art-sig">M / T</span></span>
              <span class="starter-copy"><span class="starter-kicker">{{ deck.commanders.length === 2 ? (index === 3 ? 'CHOOSE A BACKGROUND' : 'PARTNER · PAR DE COMANDANTES') : deckColorLabel(deck) + ' · LEADER' }}</span><strong>{{ deck.name }}</strong><span class="starter-commander">{{ deck.entries.filter(entry => entry.role === 'commander').map(entry => entry.name).join('  /  ') }}</span><span class="starter-meta"><span>100 CARTAS</span><span>♛ LEGALITY VERIFICADA</span></span></span>
              <span class="starter-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
          <div v-if="activeDeck" class="selected-deck-bar">
            <div><span class="selected-check">✓</span><span><strong>{{ activeDeck.name }}</strong><small>{{ totalCards(activeDeck) }} cartas · {{ commanderNames(activeDeck) }}</small></span></div>
            <div class="selected-actions"><button class="button button-small button-ghost" type="button" @click="downloadActiveDeck">Exportar .txt</button><button class="button button-small button-primary" type="button" :disabled="busy || props.busy" @click="continueWithDeck">{{ props.busy || busy ? 'Sincronizando…' : 'Usar este deck' }} <span>↗</span></button></div>
          </div>
        </template>

        <template v-else-if="tab === 'import'">
          <div class="deck-page-title"><div><div class="eyebrow">LISTA DE CARTAS</div><h2>Seu deck já está montado.</h2><p>Cole o deck como texto, com os comandantes em uma seção separada.</p></div></div>
          <div class="import-format"><span class="format-label">FORMATO ACEITO</span><code>Commander:<br>1 Nome do comandante<br><br>Deck:<br>35 Plains<br>64 outras cartas</code><span>Duplique a linha do líder para adicionar um segundo comandante. O total deve fechar em 100.</span></div>
          <label class="field-label" for="deck-import">SUA LISTA</label><textarea id="deck-import" v-model="importText" class="deck-textarea" spellcheck="false" placeholder="Commander:&#10;1 Comandante, Nome Completo&#10;&#10;Deck:&#10;1 Nome de outra carta"></textarea>
          <div class="import-actions"><span>O texto continua salvo enquanto este editor estiver aberto.</span><div><button class="button button-small button-ghost" type="button" :disabled="busy" @click="resolveImport">{{ busy ? 'Verificando…' : 'Só conferir a lista' }}</button><button class="button button-small button-primary" type="button" :disabled="busy" @click="importList">{{ busy ? 'Buscando cartas…' : 'Salvar e conferir' }} <span>↗</span></button></div></div>
        </template>

        <template v-else>
          <div class="deck-page-title"><div><div class="eyebrow">CONSTRUTOR DE COMMANDER</div><h2>Monte a partir de uma carta.</h2><p>Busque no Scryfall e adicione cartas ao deck. Deixamos as exceções visíveis.</p></div></div>
          <label class="field-label" for="deck-name">NOME DO DECK</label><input id="deck-name" v-model="newDeckName" class="deck-name-input" placeholder="Meu deck de Commander" maxlength="60">
          <div class="card-search-field"><label class="field-label" for="card-search">BUSCAR CARTAS</label><div class="search-with-button"><span class="search-glass">⌕</span><input id="card-search" v-model="searchQuery" placeholder="Nome, carta ou habilidade…"><button class="button button-small button-ghost" type="button" :disabled="searchBusy" @click="searchCards()">{{ searchBusy ? 'Buscando…' : 'Buscar' }}</button></div><div class="search-helper">A busca consulta cartas liberadas para Commander. Metadados encontrados ficam no cache local.</div></div>
          <div v-if="searchError" class="inline-error">{{ searchError }}</div>
          <div v-if="cardResults.length" class="card-result-grid">
            <article v-for="card in cardResults" :key="card.id" class="search-result" :class="card.id === selectedCard?.id ? 'is-selected' : ''" @click="selectedCard = card">
              <div class="search-result-art"><img v-if="card.image_uris?.small" :src="card.image_uris.small" :alt="card.name" loading="lazy"><span v-else class="card-back-mini">M</span></div>
              <div class="search-result-info"><strong>{{ card.name }}</strong><span>{{ card.mana_cost || '◇' }} · {{ card.type_line }}</span><small>{{ card.color_identity.join(' · ') || 'Colorless' }} <template v-if="card.legalities.commander === 'banned'">· BANIDA</template></small></div>
              <div class="search-result-actions"><button class="tiny-icon-button" title="Definir como comandante principal" type="button" @click.stop="setCommander(card, 0)">♛</button><button v-if="selectedCommander && secondaryCommander?.id !== card.id" class="tiny-icon-button" title="Definir como segundo comandante" type="button" @click.stop="setCommander(card, 1)">＋</button><button v-if="card.legalities.commander !== 'banned'" class="add-card-button" type="button" @click.stop="addCardToDraft(card)">Adicionar</button></div>
            </article>
          </div>
          <div v-if="selectedCommander" class="commander-choices">
            <div class="commander-slot"><span>COMANDANTE 1</span><strong>{{ selectedCommander.name }}</strong><small>Identidade: {{ formatColor(selectedCommander) }}</small><button type="button" @click="selectedCommander = undefined; customProblems = []">Remover</button></div>
            <div v-if="secondaryCommander" class="commander-slot commander-secondary"><span>COMANDANTE 2</span><strong>{{ secondaryCommander.name }}</strong><small>A parceria será conferida pelo texto e tipo das cartas.</small><button type="button" @click="secondaryCommander = undefined; customProblems = []">Remover</button></div>
          </div>
          <button class="button button-ghost basics-button" type="button" :disabled="busy || !selectedCommander" @click="addRecommendedBasics">＋ Adicionar 35 terrenos básicos pela identidade</button>
          <div class="draft-table-head"><span>NO SEU DECK</span><span>{{ totalFor(newEntries) }} cartas</span></div>
          <div v-if="newEntries.length" class="draft-card-list"><div v-for="entry in [...newEntries].sort((a, b) => a.name.localeCompare(b.name))" :key="entry.cardId" class="draft-row"><span class="mana-pill">{{ entry.card?.mana_cost || '◇' }}</span><strong>{{ entry.name }}</strong><span>{{ entry.quantity }}×</span><button class="tiny-icon-button" title="Remover uma cópia" type="button" @click="removeCardFromDraft(entry)">−</button><button class="tiny-icon-button" title="Adicionar uma cópia" type="button" @click="entry.card && addCardToDraft(entry.card)">＋</button></div></div>
          <div v-else class="draft-empty">Nenhuma carta no deck ainda. Busque seu comandante para começar.</div>
          <div class="draft-footer"><div><span class="draft-total" :class="totalFor(newEntries) + (selectedCommander ? 1 : 0) + (secondaryCommander ? 1 : 0) === 100 ? 'is-valid' : ''">{{ totalFor(newEntries) + (selectedCommander ? 1 : 0) + (secondaryCommander ? 1 : 0) }}</span><span>/ 100 cartas</span></div><button class="button button-small button-primary" type="button" :disabled="saveBusy" @click="saveCreatedDeck">{{ saveBusy ? 'Validando…' : 'Validar e salvar' }} <span>↗</span></button></div>
          <div v-if="customProblems.length" class="workshop-problems" role="alert"><span class="problem-symbol">!</span><div><strong>Seu deck ainda precisa de ajustes</strong><p v-for="problem in customProblems.slice(0, 5)" :key="problem">{{ problem }}</p></div></div>
        </template>
      </section>

      <aside v-if="tab === 'ready' && activeDeck" class="deck-preview">
        <div class="preview-top"><span>VISUALIZAÇÃO DA MESA</span><span>01 / 04</span></div>
        <div class="preview-mat"><div class="preview-permanent preview-left"><span class="preview-card-shape"></span><span class="preview-pip"></span></div><div class="preview-permanent preview-right"><span class="preview-card-shape"></span><span class="preview-pip"></span></div><span class="preview-orbit preview-orbit-one"></span><span class="preview-orbit preview-orbit-two"></span><div class="preview-commander-seal"><span class="seal-glyph">♛</span><span>SEU COMANDANTE</span><strong>{{ activeDeck.entries.find(entry => entry.role === 'commander')?.name ?? activeDeck.name }}</strong><small>{{ activeDeck.commanders.length === 2 ? 'TAXA DE CONJURAÇÃO · INDIVIDUAL' : 'ZONA DE COMANDO' }}</small></div><div class="preview-watermark">M / T</div></div>
        <div class="preview-stats"><div><strong>100</strong><span>CARTAS</span></div><div><strong>{{ activeDeck.commanders.length === 2 ? '02' : '01' }}</strong><span>{{ activeDeck.commanders.length === 2 ? 'COMANDANTES' : 'COMANDANTE' }}</span></div><div><strong>40</strong><span>VIDA</span></div></div>
        <div class="preview-identity"><span>IDENTIDADE DE CORES</span><div class="identity-dots"> <span v-for="color in commanderIdentity(activeDeck)" :key="color" class="identity-dot" :class="`color-${color.toLowerCase()}`">{{ color }}</span><small>{{ commanderIdentity(activeDeck).join(' + ') || '◇' }}</small></div></div>
        <div class="preview-land-line"><span>35</span><i></i><span>TERRENOS BÁSICOS</span></div>
        <div class="preview-action"><button v-if="activeDeck.id.startsWith('starter-')" class="preview-remove" type="button" @click="emit('refresh')">Atualizar dados das cartas <span>↻</span></button><button v-else-if="activeDeck" class="preview-remove" type="button" @click="deleteActiveDeck">Remover deck salvo <span>×</span></button><span class="preview-source">CARTAS OFICIAIS · SCRYFALL</span></div>
      </aside>

      <aside v-else-if="tab === 'ready'" class="deck-preview preview-empty"><div class="eyebrow">MESA PARA QUATRO</div><div class="empty-orbit">♛</div><strong>O próximo turno<br>começa por aqui.</strong><span>Escolha uma lista para ver a distribuição de cores e os dados do seu comandante.</span><div class="preview-source">COMMANDER · MULTIPLAYER</div></aside>
      <aside v-else-if="tab === 'create'" class="deck-preview preview-empty workshop-tips"><div class="eyebrow">RASCUNHO DO DECK</div><div class="empty-orbit">⌘</div><strong>Uma mesa.<br>Muitas possibilidades.</strong><span>Decks Commander têm 100 cartas contando os comandantes. Terrenos básicos podem se repetir; confirme a identidade das cores e a legalidade.</span><div class="tip-stats"><span><b>01</b> a <b>02</b> comandantes</span><span><b>35</b> lands no starter</span><span><b>0</b> cartas banidas</span></div></aside>
      <aside v-else class="deck-preview preview-empty workshop-tips"><div class="eyebrow">SEU ARQUIVO</div><div class="empty-orbit">⇧</div><strong>Cole sua lista.<br>A mesa confere.</strong><span>Resolvemos cartas com várias impressões, checamos restrições de Commander e mantemos a lista no cache local.</span><div class="preview-source">.TXT · QUANTIDADE + NOME</div></aside>
    </div>

    <footer class="workshop-footer"><span><span class="footer-spark">✳</span> Scryfall · dados e imagens sob demanda</span><span>DECKS SALVOS NO DISPOSITIVO <i>·</i> SINCRONIZAÇÃO PÚBLICA DA MESA AO CONFIRMAR</span><button type="button" @click="emit('close')">FECHAR ↗</button></footer>
  </main>
</template>

