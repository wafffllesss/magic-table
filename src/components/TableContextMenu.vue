<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TableMenuOption } from '../domain/tableInteraction';

const props = defineProps<{ x: number; y: number; options: TableMenuOption[]; title: string }>();
const emit = defineEmits<{ (event: 'choose', id: string): void; (event: 'close'): void }>();
const menu = ref<HTMLElement>();
const position = ref({ left: props.x, top: props.y });
function place(): void {
  if (!menu.value) return;
  position.value = { left: Math.max(8, Math.min(props.x, window.innerWidth - menu.value.offsetWidth - 8)), top: Math.max(8, Math.min(props.y, window.innerHeight - menu.value.offsetHeight - 8)) };
}
function outside(event: PointerEvent): void { if (event.target instanceof Node && !menu.value?.contains(event.target)) emit('close'); }
function keys(event: KeyboardEvent): void {
  const items = [...menu.value!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), input')];
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); emit('close'); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLInputElement) return;
  event.preventDefault(); event.stopPropagation();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
  items[next]?.focus();
}
onMounted(async () => {
  await nextTick(); place();
  (menu.value?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? menu.value)?.focus();
  window.addEventListener('pointerdown', outside, true); window.addEventListener('resize', place);
});
watch(() => [props.x, props.y, props.options.length], async () => { await nextTick(); place(); });
onBeforeUnmount(() => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', place); });
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="table-context-menu" role="menu" tabindex="-1" :aria-label="title" :style="{left:`${position.left}px`,top:`${position.top}px`}" @keydown="keys" @contextmenu.prevent>
      <strong>{{ title }}</strong>
      <button v-for="option in options" :key="option.id" role="menuitem" :disabled="option.disabled" @click="emit('choose', option.id)">{{ option.label }}</button>
    </div>
  </Teleport>
</template>
