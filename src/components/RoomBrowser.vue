<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed, ref, watch } from 'vue';
import { roomBackend, type JoinedRoom, type RoomListing } from '../services/roomBackend';
import { errorMessageKey, useAppI18n } from '../i18n';
import meuMagicLogo from '../assets/meu-magic-logo.svg';
import ScryfallProgress from './ScryfallProgress.vue';

const props = defineProps<{ playerName: string; deckName: string; inviteCode?: string; busy?: boolean; demoProgress?: { loaded: number; total: number } }>();
const { t } = useAppI18n();
const emit = defineEmits<{ entered: [room: JoinedRoom]; 'edit-name': []; 'edit-deck': []; demo: [] }>();
const rooms = ref<RoomListing[]>([]);
const roomName = ref('');
const code = ref('');
const password = ref('');
const createPassword = ref('');
const showCreate = ref(false);
const showJoin = ref(false);
const listingLoading = ref(true);
const unavailable = ref('');
const working = computed(() => busy.value || props.busy);
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
      <div class="room-profile"><button class="button button-ghost button-small" :disabled="working" @click="emit('edit-name')">{{ playerName }} · {{ t('app.editName') }}</button><button class="button button-ghost button-small" :disabled="working" @click="emit('edit-deck')">{{ deckName }} · {{ t('lobby.changeDeck') }}</button></div>
      <div class="room-browser-heading"><h1>{{ t('rooms.title') }}</h1></div>
      <section class="room-list-panel">
        <header class="room-tools"><button class="button button-secondary button-small" :disabled="working || !!unavailable || listingLoading" :aria-expanded="showCreate" @click="showCreate=!showCreate; showJoin=false">{{ t('rooms.create') }}</button><button class="button button-ghost button-small" :disabled="working || !!unavailable || listingLoading" :aria-expanded="showJoin" @click="showJoin=!showJoin; showCreate=false">{{ t('rooms.joinCode') }}</button></header>
        <form v-if="showCreate" class="room-create-form" @submit.prevent="create"><label>{{ t('rooms.roomName') }}<input v-model="roomName" maxlength="40" required /></label><label>{{ t('rooms.password') }}<input v-model="createPassword" minlength="6" maxlength="64" type="password" /></label><small v-if="createPassword" class="room-password-note">{{ t('rooms.passwordNote') }}</small><button class="button button-primary" :disabled="working">{{ t('rooms.createJoin') }}</button><button class="button button-ghost" type="button" :disabled="working" @click="showCreate=false">{{ t('common.cancel') }}</button></form>
        <form v-if="showJoin" class="room-create-form" @submit.prevent="enter()"><label>{{ t('rooms.code') }}<input v-model="code" maxlength="16" autocomplete="off" required autofocus /></label><label>{{ t('rooms.passwordIfAny') }}<input v-model="password" type="password" maxlength="64" autocomplete="off" /></label><button class="button button-primary" :disabled="working || code.trim().length < 6 || !!unavailable">{{ working ? t('rooms.entering') : t('rooms.enter') }}</button><button class="button button-ghost" type="button" :disabled="working" @click="showJoin=false">{{ t('common.cancel') }}</button></form>
        <p v-if="error" class="room-browser-error" role="alert">{{ t(error) }}</p>
        <article class="room-directory-card room-demo"><div class="room-directory-copy"><strong>{{ t('rooms.demo') }}</strong><small>{{ t('rooms.demoHint') }}</small></div><button class="button button-secondary button-small" :disabled="working" @click="emit('demo')">{{ props.busy ? t('rooms.preparing') : t('rooms.play') }}</button></article>
        <ScryfallProgress v-if="demoProgress" class="room-demo-progress" :label="t('deck.checkingCards')" :loaded="demoProgress.loaded" :total="demoProgress.total" :estimated="!demoProgress.total" />
        <p v-if="listingLoading" role="status" class="room-browser-note">{{ t('rooms.searching') }}</p>
        <p v-else-if="unavailable" role="status" class="room-browser-note">{{ t(unavailable) }}</p>
        <p v-else-if="!visibleRooms.length" class="room-browser-note">{{ t('rooms.empty') }}</p>
        <article v-for="item in visibleRooms" :key="item.id" class="room-directory-card"><div class="room-directory-copy"><strong>{{ item.name }} <span v-if="item.locked" :aria-label="t('rooms.protected')">🔒</span></strong><small>{{ t('rooms.players', { count: item.playerCount }) }} · {{ t('rooms.people', { count: item.memberCount }) }} · {{ item.phase === 'lobby' ? t('rooms.lobby') : t('rooms.playing') }}</small></div><button class="button button-secondary button-small" :disabled="working || item.memberCount >= 12" @click="code=item.code; password=''; error=''; item.locked ? (showJoin=true, showCreate=false) : enter(item.code)">{{ item.phase === 'lobby' ? t('rooms.enter') : t('rooms.watch') }}</button></article>
        <button v-if="nextCursor !== null" class="button button-ghost room-more" :disabled="moreBusy || working" @click="more">{{ moreBusy ? t('rooms.loadingMore') : t('rooms.more') }}</button>
      </section>
    </section>
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
.room-profile { display:flex; flex-wrap:wrap; gap:6px 16px; }
.room-profile button { max-width:100%; white-space:normal; text-align:left; overflow-wrap:anywhere; }
.room-tools { justify-content:flex-start!important; flex-wrap:wrap; }
.room-demo { padding:22px 0; }
.room-browser-heading h1 { font-size:42px; margin:28px 0; }
.room-directory-copy small { line-height:1.6; }
</style>
