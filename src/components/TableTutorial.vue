<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useAppI18n } from '../i18n';
import './tableTutorial.css';

const props = defineProps<{ hiddenPreference: boolean }>();
const emit = defineEmits<{ (event: 'close', hide: boolean): void; (event: 'shortcuts', hide: boolean): void }>();
const { t } = useAppI18n();
const steps = ['look', 'tableZoom', 'cardZoom', 'menu', 'tap', 'target', 'keys'] as const;
const index = ref(0);
const hide = ref(props.hiddenPreference);
const dialog = ref<HTMLElement>();
const closeButton = ref<HTMLButtonElement>();
onMounted(() => nextTick(() => closeButton.value?.focus()));
function keys(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); emit('close', hide.value); return; }
  if (event.key !== 'Tab') return;
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
</script>

<template>
  <div class="modal-scrim tutorial-scrim" @pointerdown.stop @pointerup.stop @click.stop @wheel.stop @contextmenu.prevent.stop>
    <section ref="dialog" class="tutorial-dialog" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-description" @keydown="keys">
      <button ref="closeButton" class="modal-close tutorial-close" type="button" :aria-label="t('tutorial.close')" @click="emit('close', hide)">×</button>
      <div class="tutorial-heading"><span class="eyebrow">{{ t('tutorial.title') }}</span><span class="tutorial-progress">{{ t('tutorial.step', { current: index + 1, total: steps.length }) }}</span></div>
      <div :key="steps[index]" class="tutorial-illustration" :class="`tutorial-${steps[index]}`" aria-hidden="true">
        <div class="tutorial-board"><div class="tutorial-board-line"></div><div class="tutorial-card tutorial-card-one"><span>✦</span></div><div class="tutorial-card tutorial-card-two"><span>✦</span></div></div>
        <div v-if="steps[index] === 'menu'" class="tutorial-context-menu"><i></i><i></i><i></i></div>
        <div v-if="steps[index] === 'target'" class="tutorial-arrow">➜</div>
        <div v-if="steps[index] === 'keys'" class="tutorial-key-list"><kbd>CTRL</kbd><kbd>D</kbd><kbd>T</kbd><kbd>?</kbd></div>
        <div class="tutorial-pointer">↖</div>
        <div class="tutorial-input"><template v-if="steps[index] === 'look'">↔</template><template v-else-if="steps[index] === 'tableZoom' || steps[index] === 'cardZoom'">↕ SCROLL</template><template v-else-if="steps[index] === 'menu'">RIGHT CLICK</template><template v-else-if="steps[index] === 'tap'">● &nbsp; 2× &nbsp; T</template><template v-else-if="steps[index] === 'target'">ALT + ↗</template><template v-else>?</template></div>
      </div>
      <div class="tutorial-copy" aria-live="polite"><h2 id="tutorial-title">{{ t(`tutorial.${steps[index]}Title`) }}</h2><p id="tutorial-description">{{ t(`tutorial.${steps[index]}`) }}</p></div>
      <label class="tutorial-hide"><input v-model="hide" type="checkbox"> {{ t('tutorial.hide') }}</label>
      <div class="tutorial-actions"><button v-if="index > 0" type="button" class="button button-ghost" @click="index--">{{ t('tutorial.previous') }}</button><span class="tutorial-dots" aria-hidden="true"><i v-for="(_, number) in steps" :key="number" :class="{ active: number === index }"></i></span><button v-if="index < steps.length - 1" type="button" class="button button-primary" @click="index++">{{ t('tutorial.next') }}</button><button v-else type="button" class="button button-primary" @click="emit('shortcuts', hide)">{{ t('tutorial.shortcuts') }}</button><button v-if="index === steps.length - 1" type="button" class="button button-ghost" @click="emit('close', hide)">{{ t('tutorial.finish') }}</button></div>
    </section>
  </div>
</template>
