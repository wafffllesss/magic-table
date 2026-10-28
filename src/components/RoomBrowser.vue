<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed, ref, watch } from 'vue';
import { roomBackend, type JoinedRoom, type RoomListing } from '../services/roomBackend';
import { errorMessageKey, useAppI18n } from '../i18n';
import meuMagicLogo from '../assets/meu-magic-logo.svg';
import ScryfallProgress from './ScryfallProgress.vue';
import CardTile from './CardTile.vue';
import PlaymatArt from './PlaymatArt.vue';
import PlaymatPicker from './PlaymatPicker.vue';
import { playmatColor, validPlaymatId } from '../services/playmats';
import type { DeckDefinition, DeckEntry } from '../domain/game';

const props = defineProps<{ playerName: string; playmatId?: string; customPlaymatsDisabled?: boolean; playmatColorsDisabled?: boolean; deck?: DeckDefinition; inviteCode?: string; busy?: boolean; demoProgress?: { loaded: number; total: number } }>();
const { t } = useAppI18n();
const emit = defineEmits<{ entered: [room: JoinedRoom]; 'edit-name': []; 'edit-deck': []; 'set-playmat': [id: string | undefined]; demo: []; solo: [] }>();
const rooms = ref<RoomListing[]>([]);
const roomName = ref('');
const code = ref('');
const password = ref('');
const createPassword = ref('');
const showPlaymats = ref(false);
const showCreate = ref(false);
const showJoin = ref(false);
const listingLoading = ref(true);
const unavailable = ref('');
const working = computed(() => busy.value || props.busy);
const commanders = computed(() => props.deck?.commanders.map(id => props.deck?.entries.find(entry => entry.cardId === id)).filter((entry): entry is DeckEntry => !!entry) ?? []);
const visibleRooms = computed(() => rooms.value.filter(room => !room.closed));
const busy = ref(false);
const error = ref('');
const nextCursor = ref<number | null>(null);
const moreBusy = ref(false);
let stopDirectory: (() => void) | undefined;
let active = true;

onMounted(async () => {
  roomName.value = `Mesa de ${props.playerName}`;
  try {
    if (!import.meta.env.DEV && !window.meuMagicDesktop) throw new Error(t('rooms.unavailable'));
    if (!roomBackend.isConfigured) throw new Error(t('rooms.unavailable'));
    await roomBackend.connectIdentity(props.playerName);
    if (!active) return;
    stopDirectory = roomBackend.watchDirectory(next => { rooms.value = next; });
    const result = await roomBackend.list();
    nextCursor.value = result.nextCursor;
    if (!rooms.value.length) rooms.value = result.rooms;
  } catch (cause) { unavailable.value = messageOf(cause); }
  finally { listingLoading.value = false; }
});
watch(() => props.inviteCode, value => { if (value) { code.value = value.toUpperCase(); password.value = ''; showJoin.value = true; } }, { immediate: true });
onBeforeUnmount(() => { active = false; stopDirectory?.(); });

async function enter(targetCode = code.value): Promise<void> {
  if (working.value) return;
  busy.value = true; error.value = '';
  try { emit('entered', await roomBackend.join(targetCode.trim(), props.playerName, password.value)); }
  catch (cause) { error.value = messageOf(cause); }
  finally { busy.value = false; }
}
async function create(): Promise<void> {
  if (working.value) return;
  busy.value = true; error.value = '';
  try { emit('entered', await roomBackend.create(roomName.value, props.playerName, createPassword.value)); }
  catch (cause) { error.value = messageOf(cause); }
  finally { busy.value = false; }
}
async function more(): Promise<void> {
  if (nextCursor.value === null || moreBusy.value) return;
  moreBusy.value = true;
  try {
    const result = await roomBackend.list(nextCursor.value);
    const known = new Set(rooms.value.map(room => room.id));
    rooms.value.push(...result.rooms.filter(room => !known.has(room.id)));
    nextCursor.value = result.nextCursor;
  } catch (cause) { error.value = messageOf(cause); }
  finally { moreBusy.value = false; }
}
function messageOf(value: unknown): string {
  const message = value instanceof Error ? value.message : 'Não foi possível acessar as mesas.';
  const code = typeof value === 'object' && value !== null && 'code' in value ? String((value as { code: unknown }).code) : '';
  if (message.includes('permission-denied')) return 'rooms.passwordError';
  if (/permission_denied|permission-denied/i.test(code + message)) return 'rooms.genericError';
  if (/network|unavailable|failed to fetch|offline/i.test(code + message)) return 'rooms.network';
  if (message === 'Não foi possível acessar as mesas.') return 'rooms.genericError';
  return errorMessageKey(value);
}
</script>

<template>
  <main class="room-browser-shell">
    <header class="room-browser-header"><span class="table-brand"><img class="brand-logo" :src="meuMagicLogo" alt="" aria-hidden="true"/><span>{{ t('app.name') }}</span></span><slot name="header-actions" /></header>
    <section class="room-browser-content">
      <div class="room-profile">
        <PlaymatArt v-if="validPlaymatId(playmatId) && (playmatColor(playmatId) ? !playmatColorsDisabled : !customPlaymatsDisabled)" class="profile-playmat" :id="playmatId" />
        <div class="profile-cards" :class="{ 'has-partner': commanders.length > 1 }" aria-hidden="true">
          <div v-for="entry in commanders" :key="entry.cardId" class="profile-card"><CardTile v-if="entry.card" :definition="entry.card" :quantity="entry.quantity" compact /><span v-else>♛</span></div>
          <div v-if="!commanders.length" class="profile-card"><span>♛</span></div>
        </div>
        <div class="profile-details">
          <div class="profile-player"><strong>{{ playerName }}</strong><button class="profile-edit" type="button" :disabled="working" :aria-label="t('app.editName')" :title="t('app.editName')" @click="emit('edit-name')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.83 2.83 0 0 0-4-4L4 16v4Zm9.5-13.5 4 4" /></svg></button></div>
          <span class="profile-deck">{{ deck?.name }}</span>
          <span class="profile-commanders">{{ commanders.map(entry => entry.name).join(' / ') || t('deck.noCommander') }}</span>
          <div class="profile-actions"><button class="button button-secondary button-small profile-change" type="button" :disabled="working" @click="emit('edit-deck')">{{ t('lobby.changeDeck') }} <span aria-hidden="true">↗</span></button><button class="button button-secondary button-small" type="button" :disabled="working" @click="showPlaymats=true">{{ t('table.personalizePlaymat') }}</button></div>
        </div>
      </div>
      <div class="room-browser-heading"><h1>{{ t('rooms.title') }}</h1></div>
      <section class="room-list-panel">
        <header class="room-tools"><div class="room-online-actions"><button class="button button-secondary button-small" :disabled="working || !!unavailable || listingLoading" :aria-expanded="showCreate" @click="showCreate=!showCreate; showJoin=false">{{ t('rooms.create') }}</button><button class="button button-ghost button-small" :disabled="working || !!unavailable || listingLoading" :aria-expanded="showJoin" @click="showJoin=!showJoin; showCreate=false">{{ t('rooms.joinCode') }}</button></div><button class="button button-secondary button-small room-demo-button" type="button" :disabled="working" :title="t('rooms.demoHint')" @click="emit('demo')">{{ props.busy ? t('rooms.preparing') : 'DEMO' }}</button><button class="button button-secondary button-small" type="button" :disabled="working" :title="t('solo.hint')" @click="emit('solo')">SOLO</button></header>
        <form v-if="showCreate" class="room-create-form" @submit.prevent="create"><label>{{ t('rooms.roomName') }}<input v-model="roomName" maxlength="40" required /></label><label>{{ t('rooms.password') }}<input v-model="createPassword" minlength="6" maxlength="64" type="password" /></label><small v-if="createPassword" class="room-password-note">{{ t('rooms.passwordNote') }}</small><button class="button button-primary" :disabled="working">{{ t('rooms.createJoin') }}</button><button class="button button-ghost" type="button" :disabled="working" @click="showCreate=false">{{ t('common.cancel') }}</button></form>
        <form v-if="showJoin" class="room-create-form" @submit.prevent="enter()"><label>{{ t('rooms.code') }}<input v-model="code" maxlength="16" autocomplete="off" required autofocus /></label><label>{{ t('rooms.passwordIfAny') }}<input v-model="password" type="password" maxlength="64" autocomplete="off" /></label><button class="button button-primary" :disabled="working || code.trim().length < 6 || !!unavailable">{{ working ? t('rooms.entering') : t('rooms.enter') }}</button><button class="button button-ghost" type="button" :disabled="working" @click="showJoin=false">{{ t('common.cancel') }}</button></form>
        <p v-if="error" class="room-browser-error" role="alert">{{ t(error) }}</p>
        <ScryfallProgress v-if="demoProgress" class="room-demo-progress" :label="t('deck.checkingCards')" :loaded="demoProgress.loaded" :total="demoProgress.total" :estimated="!demoProgress.total" />
        <p v-if="listingLoading" role="status" class="room-browser-note">{{ t('rooms.searching') }}</p>
        <p v-else-if="unavailable" role="status" class="room-browser-note">{{ t(unavailable) }}</p>
        <p v-else-if="!visibleRooms.length" class="room-browser-note">{{ t('rooms.empty') }}</p>
        <article v-for="item in visibleRooms" :key="item.id" class="room-directory-card"><div class="room-directory-copy"><strong>{{ item.name }} <span v-if="item.locked" :aria-label="t('rooms.protected')">🔒</span></strong><small>{{ t('rooms.players', { count: item.playerCount }) }} · {{ t('rooms.people', { count: item.memberCount }) }} · {{ item.phase === 'lobby' ? t('rooms.lobby') : t('rooms.playing') }}</small></div><button class="button button-secondary button-small" :disabled="working || item.memberCount >= 12" @click="code=item.code; password=''; error=''; item.locked ? (showJoin=true, showCreate=false) : enter(item.code)">{{ item.phase === 'lobby' ? t('rooms.enter') : t('rooms.watch') }}</button></article>
        <button v-if="nextCursor !== null" class="button button-ghost room-more" :disabled="moreBusy || working" @click="more">{{ moreBusy ? t('rooms.loadingMore') : t('rooms.more') }}</button>
      </section>
    </section>
    <PlaymatPicker v-if="showPlaymats" :id="playmatId" :busy="working" @close="showPlaymats=false" @apply="emit('set-playmat', $event)" />
  </main>
</template>

<style scoped>
.room-browser-shell { min-height: 100dvh; background: radial-gradient(ellipse at 82% 18%, #31452d2b, transparent 38%), #10130f; }
.room-browser-header { min-height: 70px; display:flex; align-items:center; justify-content:space-between; padding: 0 clamp(20px,6vw,90px); border-bottom:1px solid #d6e1d411; }
.room-browser-content { max-width:1180px; margin:auto; padding: clamp(42px,8vh,82px) 28px; }
.room-browser-heading h1 { margin:14px 0; color:#edf2e8; font:500 clamp(38px,5vw,66px)/.98 var(--heading); letter-spacing:-.045em; }
.room-browser-heading h1 em { color:var(--lime); font-style:normal; }
.room-browser-heading p { max-width:500px; color:#96a48e; }
.room-browser-columns { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(290px,.75fr); gap:22px; margin-top:34px; }
.room-list-panel,.room-join-panel { min-width:0; padding:22px; border:1px solid #bacbb01a; border-radius:12px; background:linear-gradient(145deg,#1b271e,#111a13); }
.room-list-panel>header { display:flex; align-items:center; justify-content:space-between; gap:14px; padding-bottom:18px; border-bottom:1px solid #d6e1d411; }
.room-list-panel h2,.room-join-panel h2 { margin:8px 0; color:#e7eee2; font:500 23px var(--heading); }
.room-directory-card { display:flex; align-items:center; gap:12px; padding:14px 0; border-bottom:1px solid #d6e1d40c; }
.room-directory-icon { width:34px;height:34px;display:grid;place-items:center;flex:none;border:1px solid #b8e67733;border-radius:50%;color:var(--lime); }
.room-directory-copy { display:flex;flex:1;min-width:0;flex-direction:column;gap:4px; }
.room-directory-copy strong { overflow:hidden;color:#e1eadc;text-overflow:ellipsis;white-space:nowrap; }
.room-directory-copy strong span { color:var(--lime); }
.room-directory-copy small,.room-browser-note { color:#899782;font-size:11px; }
.room-empty { display:flex;min-height:200px;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:#9bab95;text-align:center; }
.room-empty>span { color:var(--lime);font-size:24px; }
.room-empty small { color:#7f8d79; }
.room-join-panel>p { color:#9aa994;font-size:13px;line-height:1.6; }
.room-join-panel form,.room-create-form { display:flex;flex-direction:column;gap:14px;margin-top:18px; }
.room-join-panel label,.room-create-form label { display:flex;flex-direction:column;gap:7px;color:#a8b79f;font:9px var(--mono);letter-spacing:.07em; }
.room-join-panel input,.room-create-form input { width:100%;padding:12px;border:1px solid #d6e1d426;border-radius:6px;outline:0;background:#0d1510;color:#e5ede0;font:13px var(--body);letter-spacing:normal; }
.room-join-panel input:focus,.room-create-form input:focus { border-color:#b8e67780; }
.room-create-form { padding:16px 0;border-bottom:1px solid #d6e1d411; }
.room-browser-error { padding:10px;border-radius:6px;background:#783e302d;color:#ffc1ae!important; }
.room-password-note { color:#899782;font-size:11px;line-height:1.5; }
.room-browser-note { display:block;margin-top:18px;line-height:1.6; }
.room-more { width:100%;margin-top:12px; }
@media (max-width:760px) { .room-browser-columns { grid-template-columns:1fr; } .room-browser-content { padding:38px 18px; } }
.room-browser-content { max-width:900px; padding-top:32px; }
.room-profile { position:relative; isolation:isolate; overflow:hidden; display:flex; align-items:center; gap:24px; padding:20px 24px; border:1px solid #bacbb026; border-radius:12px; background:linear-gradient(115deg,#253526,#151e17 72%); }
.profile-playmat { opacity:.48; z-index:-2; }
.room-profile:has(.profile-playmat)::before { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(90deg, rgba(10,20,13,.82), rgba(10,20,13,.52)); pointer-events:none; }
.profile-cards { position:relative; flex:none; width:100px; height:140px; }
.profile-cards.has-partner { width:125px; }
.profile-card { position:absolute; top:0; left:0; width:100px; height:140px; overflow:hidden; border:1px solid #c5dfac66; border-radius:7px; background:#15231a; box-shadow:0 7px 18px #0008; }
.profile-card:nth-child(2) { left:25px; top:4px; transform:rotate(5deg); }
.profile-card:first-child { z-index:1; }
.profile-card :deep(.card-tile) { display:block; width:100%; height:100%; border-radius:0; }
.profile-card > span { display:grid; place-items:center; height:100%; color:var(--lime); font-size:28px; }
.profile-details { display:flex; flex-direction:column; align-items:flex-start; min-width:0; gap:5px; }
.profile-player { display:flex; align-items:center; gap:8px; min-width:0; }
.profile-player strong { color:#edf2e8; font:500 23px var(--heading); overflow-wrap:anywhere; }
.profile-edit { display:grid; place-items:center; flex:none; width:32px; height:32px; padding:7px; border:1px solid #bacbb033; border-radius:6px; background:#ffffff08; color:#c7d6bd; cursor:pointer; }
.profile-edit:hover:not(:disabled) { color:var(--lime); border-color:#b8e67780; }
.profile-edit:focus-visible { outline:2px solid var(--lime); outline-offset:2px; }
.profile-edit:disabled { opacity:.5; cursor:default; }
.profile-edit svg { width:100%; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.profile-deck { color:#dce8d5; font-size:14px; overflow-wrap:anywhere; }
.profile-commanders { color:#99aa91; font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.profile-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
@media (max-width:480px) { .room-profile { gap:16px; padding:16px; } .profile-cards { width:75px; height:105px; } .profile-cards.has-partner { width:90px; } .profile-card { width:75px; height:105px; } .profile-card:nth-child(2) { left:15px; } .profile-player strong { font-size:19px; } }
.room-tools { flex-wrap:wrap; }
.room-online-actions { display:flex; flex-wrap:wrap; gap:14px; }
.room-demo-button { margin-left:auto; }
.room-browser-heading h1 { font-size:42px; margin:28px 0; }
.room-directory-copy small { line-height:1.6; }
</style>
