<script setup lang="ts">
import { useAppI18n } from '../i18n';
import type { LanguagePreference } from '../i18n';

defineProps<{ modelValue: LanguagePreference }>();
const emit = defineEmits<{ 'update:modelValue': [value: LanguagePreference] }>();
const { t } = useAppI18n();

function change(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value as LanguagePreference);
}
</script>

<template>
  <label class="language-selector">
    <span aria-hidden="true">◎</span>
    <select :value="modelValue" :aria-label="t('language.selector')" @change="change">
      <option value="auto">{{ t('language.auto') }}</option>
      <option value="en">{{ t('language.english') }}</option>
      <option value="pt-BR">{{ t('language.portuguese') }}</option>
    </select>
  </label>
</template>

<style scoped>
.language-selector { position:static; z-index:auto; flex:none; display:flex; align-items:center; gap:6px; min-height:32px; margin-left:auto; padding:0 8px; border:1px solid rgba(190,215,184,.2); border-radius:6px; background:rgba(13,21,16,.94); color:#c8d7c0; box-shadow:0 5px 18px #0004; }
.language-selector>span { color:#b8e677; font-size:12px; }
.language-selector select { max-width:118px; border:0; outline:0; background:transparent; color:inherit; font:inherit; font-size:10px; cursor:pointer; }
.language-selector select option { background:#152018; color:#e7eee2; }
.language-selector:focus-within { outline:2px solid #b8e677; outline-offset:2px; }
@media (max-width:700px) { .language-selector { min-height:28px; gap:4px; padding:0 6px; } .language-selector select { max-width:92px; font-size:9px; } }
</style>
