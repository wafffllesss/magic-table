<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CHAT_EMOJIS, CHAT_LIMIT, chatCharacters, chatText } from '../domain/chat';
import { useAppI18n } from '../i18n';

const props = defineProps<{ active: boolean; canSend: boolean }>();
const emit = defineEmits<{ (event: 'send', text: string): void }>();
const { t } = useAppI18n();
const open = ref(false);
const emojisOpen = ref(false);
const draft = ref('');
const input = ref<HTMLInputElement>();
const count = computed(() => chatCharacters(draft.value).length);
const valid = computed(() => Boolean(chatText(draft.value)));
let opener: HTMLElement | undefined;

function openComposer(): void {
  if (!props.active || !props.canSend || open.value) return;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  open.value = true;
  void nextTick(() => input.value?.focus());
}
function closeComposer(): void {
  open.value = false; emojisOpen.value = false; draft.value = '';
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  opener = undefined;
}
function send(): void {
  const text = chatText(draft.value);
  if (!text) return;
  emit('send', text);
  closeComposer();
}
function appendEmoji(emoji: string): void {
  const target = input.value;
  if (!target) return;
  const start = target.selectionStart ?? draft.value.length, end = target.selectionEnd ?? draft.value.length;
  const next = draft.value.slice(0, start) + emoji + draft.value.slice(end);
  if (chatCharacters(next).length > CHAT_LIMIT) return;
  draft.value = next; emojisOpen.value = false;
  void nextTick(() => { target.focus(); target.setSelectionRange(start + emoji.length, start + emoji.length); });
}
function enforceLimit(): void { if (count.value > CHAT_LIMIT) draft.value = chatCharacters(draft.value).slice(0, CHAT_LIMIT).join(''); }
function onWindowKey(event: KeyboardEvent): void {
  if (!props.active || !props.canSend || event.key !== 'Enter' || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || open.value) return;
  if (document.querySelector('.modal-scrim, [role="dialog"]')) return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, button, a, [role="dialog"], [contenteditable="true"], [role="button"], [role="menuitem"]')) return;
  event.preventDefault(); openComposer();
}
function onComposerKey(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); closeComposer(); }
  else if (event.key === 'Enter' && event.target === input.value && !event.isComposing) { event.preventDefault(); send(); }
}
watch(() => [props.active, props.canSend], () => { if ((!props.active || !props.canSend) && open.value) closeComposer(); });
onMounted(() => window.addEventListener('keydown', onWindowKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey));
</script>

<template>
  <div v-if="active && canSend" class="chat-composer-root">
    <button v-if="!open" class="chat-open-button" type="button" :aria-label="t('chat.open')" :title="t('chat.open')" @click="openComposer">◉ <span>{{ t('chat.open') }}</span> <kbd>↵</kbd></button>
    <div v-else class="chat-composer" role="dialog" :aria-label="t('chat.compose')" @keydown="onComposerKey">
      <div class="chat-composer-heading"><strong>{{ t('chat.compose') }}</strong><button type="button" :aria-label="t('common.close')" @click="closeComposer">×</button></div>
      <div class="chat-composer-line"><input ref="input" v-model="draft" type="text" :placeholder="t('chat.placeholder')" :aria-label="t('chat.message')" @input="enforceLimit" /><button type="button" :aria-label="t('chat.emoji')" :aria-expanded="emojisOpen" @click="emojisOpen = !emojisOpen">☺</button></div>
      <div v-if="emojisOpen" class="chat-emojis" :aria-label="t('chat.emoji')"><button v-for="emoji in CHAT_EMOJIS" :key="emoji" type="button" :aria-label="emoji" @click="appendEmoji(emoji)">{{ emoji }}</button></div>
      <div class="chat-composer-footer"><span :aria-label="t('chat.characters', { count, limit: CHAT_LIMIT })">{{ count }}/{{ CHAT_LIMIT }}</span><button type="button" :disabled="!valid" @click="send">{{ t('chat.send') }} ↗</button></div>
    </div>
  </div>
</template>

<style scoped>
.chat-composer-root { position:fixed; z-index:250; left:18px; bottom:18px; max-width:calc(100vw - 36px); color:#edf5e7; }
.chat-open-button, .chat-composer { border:1px solid #b8e6778c; background:#19291fef; box-shadow:0 10px 28px #0009; }
.chat-open-button { display:flex; align-items:center; gap:9px; padding:9px 13px; border-radius:22px; color:#eaf5dd; cursor:pointer; font:600 12px var(--heading); }
.chat-open-button kbd { color:var(--lime); font:10px var(--mono); }
.chat-composer { width:min(350px, calc(100vw - 36px)); padding:12px; border-radius:12px; }
.chat-composer-heading, .chat-composer-line, .chat-composer-footer { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.chat-composer-heading { margin-bottom:10px; font:600 13px var(--heading); }
.chat-composer-heading button, .chat-composer-line button, .chat-emojis button { border:0; background:transparent; color:#e8f3dd; cursor:pointer; }
.chat-composer-heading button { font-size:20px; }
.chat-composer-line { border:1px solid #b8e67773; border-radius:7px; padding:4px 7px; }
.chat-composer-line input { width:100%; min-width:0; border:0; outline:0; background:transparent; color:white; font:13px var(--heading); }
.chat-composer-line button { font-size:20px; }
.chat-emojis { display:grid; grid-template-columns:repeat(8, 1fr); gap:2px; padding:8px 0; }
.chat-emojis button { min-height:32px; border-radius:5px; font-size:18px; }
.chat-emojis button:hover, .chat-emojis button:focus-visible { background:#b8e67733; }
.chat-composer-footer { margin-top:9px; color:#b4c7a8; font:10px var(--mono); }
.chat-composer-footer button { padding:6px 10px; border:0; border-radius:5px; background:var(--lime); color:#17211b; cursor:pointer; font:600 11px var(--heading); }
.chat-composer-footer button:disabled { opacity:.45; cursor:default; }
.chat-composer-root :focus-visible { outline:2px solid var(--lime); outline-offset:2px; }
@media (max-width:600px) { .chat-composer-root { left:10px; bottom:10px; max-width:calc(100vw - 20px); } }
</style>
