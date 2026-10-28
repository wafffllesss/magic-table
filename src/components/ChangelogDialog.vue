<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { version as appVersion } from '../../package.json';
import { useAppI18n } from '../i18n';
import { changelogs, changelogVersions, compareVersions, parseChangelog, type ChangelogLocale, type ChangelogNotes } from '../services/changelog';
const props = defineProps<{ version: string; update?: boolean; notes?: ChangelogNotes; url?: string }>();
const emit = defineEmits<{ close: []; download: [] }>();
const { t, locale } = useAppI18n();
const dialog = ref<HTMLDialogElement>();
const selected = ref(props.version);
const versions = computed(() => props.update ? [props.version] : changelogVersions.filter(version => compareVersions(version, appVersion) <= 0));
const content = computed(() => (props.update ? props.notes : changelogs[selected.value])?.[locale.value as ChangelogLocale]);
const blocks = computed(() => parseChangelog(content.value ?? ''));
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog ref="dialog" class="changelog-dialog" aria-labelledby="changelog-title" @close="emit('close')">
    <header><h2 id="changelog-title">{{ t('changelog.title') }}</h2><button class="button button-ghost" :aria-label="t('common.close')" @click="dialog?.close()">×</button></header>
    <label for="changelog-version">{{ t('changelog.version') }}</label>
    <select id="changelog-version" v-model="selected"><option v-for="version in versions" :key="version" :value="version">{{ version }}</option></select>
    <div class="changelog-content">
      <template v-if="content"><template v-for="(block, index) in blocks" :key="index"><h3 v-if="block.type === 'heading'">{{ block.text }}</h3><p v-else-if="block.type === 'item'" class="changelog-item">{{ block.text }}</p><p v-else>{{ block.text }}</p></template></template>
      <p v-else role="status">{{ t('changelog.unavailable') }}</p>
    </div>
    <footer><button class="button button-ghost" @click="dialog?.close()">{{ t('common.close') }}</button><button v-if="update && url" class="button button-primary" @click="emit('download')">{{ t('changelog.download') }} ↗</button></footer>
  </dialog>
</template>
<style scoped>
.changelog-dialog { width:min(680px,calc(100vw - 28px)); max-height:calc(100dvh - 28px); box-sizing:border-box; padding:24px; border:1px solid #b5d5a347; border-radius:12px; background:linear-gradient(150deg,#17251b,#0c1510); color:#e8efe6; box-shadow:0 22px 75px #0009; }
.changelog-dialog::backdrop { background:#000b; }
header, footer { display:flex; align-items:center; justify-content:space-between; gap:12px; } footer { justify-content:flex-end; flex-wrap:wrap; margin-top:20px; }
h2 { margin:0 0 16px; font:600 25px var(--heading); } h3 { margin:20px 0 10px; font:600 18px var(--heading); color:#c2e4ac; }
label { margin-right:10px; } select { padding:7px; border:1px solid #b5d5a347; border-radius:6px; background:#101c13; color:inherit; }
.changelog-content { max-height:50dvh; overflow:auto; line-height:1.55; color:#d3dfd0; } .changelog-item { padding-left:1.3em; position:relative; } .changelog-item::before { content:'•'; position:absolute; left:0; }
:focus-visible { outline:2px solid #c8ed9d; outline-offset:3px; }
@media(max-width:550px) { .changelog-dialog { padding:18px; } }
</style>
