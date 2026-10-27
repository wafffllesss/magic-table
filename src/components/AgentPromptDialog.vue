<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAppI18n } from '../i18n';
import { agentPrompt } from '../services/agentPrompt';

const props = defineProps<{ endpoint: string }>();
const emit = defineEmits<{ close: []; copied: []; copyFailed: [] }>();
const { t, locale } = useAppI18n();
const dialog = ref<HTMLDialogElement>();
const prompt = computed(() => agentPrompt(props.endpoint, locale.value));
onMounted(() => dialog.value?.showModal());
async function copy(): Promise<void> {
  try { await navigator.clipboard.writeText(prompt.value); emit('copied'); }
  catch { emit('copyFailed'); }
}
</script>

<template>
  <dialog ref="dialog" class="agent-dialog" aria-labelledby="agent-dialog-title" @close="emit('close')" @click="(event) => { if (event.target === dialog) dialog?.close(); }">
    <header><div><span class="eyebrow">MCP · MEU MAGIC</span><h2 id="agent-dialog-title">{{ t('app.agentTitle') }}</h2></div><button class="agent-close" :aria-label="t('common.close')" @click="dialog?.close()">×</button></header>
    <p>{{ t('app.agentInstructions') }}</p>
    <label for="agent-prompt">{{ t('app.agentPromptLabel') }}</label>
    <textarea id="agent-prompt" readonly :value="prompt" spellcheck="false" />
    <footer><button class="button button-ghost" @click="dialog?.close()">{{ t('common.close') }}</button><button class="button button-primary" @click="copy">{{ t('app.agentCopy') }}</button></footer>
  </dialog>
</template>

<style scoped>
.agent-dialog { width:min(680px,calc(100vw - 28px)); max-height:calc(100dvh - 28px); box-sizing:border-box; padding:24px; border:1px solid #b5d5a347; border-radius:12px; background:linear-gradient(150deg,#17251b,#0c1510); color:#e8efe6; box-shadow:0 22px 75px #0009; }
.agent-dialog::backdrop { background:#000b; }
.agent-dialog header { display:flex; justify-content:space-between; gap:16px; }
.agent-dialog h2 { margin:8px 0 0; font:600 25px var(--heading); }
.agent-dialog p { color:#c0cebf; font-size:13px; line-height:1.55; }
.agent-dialog label { display:block; margin:18px 0 7px; color:#b8e677; font:10px var(--mono); }
.agent-dialog textarea { display:block; box-sizing:border-box; width:100%; height:min(42dvh,360px); resize:vertical; padding:14px; border:1px solid #b5d5a333; border-radius:7px; background:#09110d; color:#dce8d9; font:12px/1.55 var(--mono); }
.agent-dialog footer { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin-top:16px; }
.agent-close { align-self:start; border:0; background:transparent; color:#dce8d9; cursor:pointer; font-size:25px; }
.agent-dialog :focus-visible { outline:2px solid #c8ed9d; outline-offset:3px; }
@media(max-width:550px) { .agent-dialog { padding:18px; } .agent-dialog h2 { font-size:21px; } .agent-dialog textarea { height:36dvh; } }
</style>
