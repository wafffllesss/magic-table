<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useAppI18n } from '../i18n';

const props = withDefaults(defineProps<{
  label: string;
  loaded?: number;
  total?: number;
  estimated?: boolean;
}>(), { loaded: 0, total: 0, estimated: false });
const { t } = useAppI18n();
const estimate = ref(4);
let timer: ReturnType<typeof setInterval> | undefined;
const determinate = () => props.total > 0 && !props.estimated;
const value = () => determinate() ? Math.min(100, Math.round((props.loaded / props.total) * 100)) : estimate.value;

function startEstimate(): void {
  if (timer) clearInterval(timer);
  estimate.value = 4;
  if (!props.estimated) return;
  timer = setInterval(() => { estimate.value = Math.min(90, estimate.value + 2); }, 500);
}
watch(() => props.estimated, startEstimate);
onMounted(startEstimate);
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="scryfall-progress" role="status" aria-live="polite" :aria-busy="true">
    <span class="scryfall-progress-label">{{ label }}<template v-if="estimated"> · {{ t('deck.progressEstimate') }}</template><template v-else-if="total"> · {{ loaded }} / {{ total }}</template></span>
    <progress :value="value()" max="100" :aria-label="estimated ? `${label} · ${t('deck.progressEstimate')}` : label" />
  </div>
</template>

<style scoped>
.scryfall-progress{display:flex;flex-direction:column;gap:6px;width:min(320px,100%);color:var(--lime);font-size:10px;line-height:1.4}
.scryfall-progress-label{overflow-wrap:anywhere}
.scryfall-progress progress{display:block;width:100%;height:6px;overflow:hidden;border:0;border-radius:99px;background:rgba(184,230,119,.12);accent-color:var(--lime)}
.scryfall-progress progress::-webkit-progress-bar{border-radius:99px;background:rgba(184,230,119,.12)}
.scryfall-progress progress::-webkit-progress-value{border-radius:99px;background:var(--lime);transition:width .35s ease}
.scryfall-progress progress::-moz-progress-bar{border-radius:99px;background:var(--lime)}
@media(prefers-reduced-motion:reduce){.scryfall-progress progress::-webkit-progress-value{transition:none}}
</style>
