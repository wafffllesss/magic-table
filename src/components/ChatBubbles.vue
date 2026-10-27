<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ChatMessage } from '../domain/chat';
import type { TableSeatId } from '../services/firebaseRoom';

const props = defineProps<{ messages: ChatMessage[]; anchors: Partial<Record<TableSeatId, { x: number; y: number }>> }>();
const element = ref<HTMLElement>();
const size = ref({ width: 600, height: 600 });
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(entries => {
    const box = entries[0]?.contentRect;
    if (box) size.value = { width: box.width, height: box.height };
  });
  if (element.value) observer.observe(element.value);
});
onBeforeUnmount(() => observer?.disconnect());
const groups = computed(() => {
  const grouped = new Map<string, ChatMessage[]>();
  for (const message of props.messages) grouped.set(message.seatId, [...(grouped.get(message.seatId) ?? []), message]);
  return [...grouped].flatMap(([seatId, messages]) => {
    const anchor = props.anchors[seatId as TableSeatId];
    if (!anchor) return [];
    const width = size.value.width, height = size.value.height;
    const originX = anchor.x * width, originY = anchor.y * height;
    const x = Math.max(82, Math.min(width - 82, originX));
    const below = originY < height * .45;
    const y = Math.max(20, Math.min(height - 20, originY));
    return [{ seatId, messages, below, style: {
      left: `${x}px`, top: `${y}px`, '--tail-x': `${Math.max(-58, Math.min(58, originX - x))}px`,
    } }];
  });
});
</script>

<template>
  <div ref="element" class="chat-bubble-layer" aria-live="polite" aria-relevant="additions">
    <div v-for="group in groups" :key="group.seatId" class="chat-bubble-stack" :class="group.below ? 'is-below' : 'is-above'" :style="group.style">
      <div v-for="message in group.messages" :key="message.id" class="chat-bubble"><span>{{ message.text }}</span></div>
    </div>
  </div>
</template>

<style scoped>
.chat-bubble-layer { position:absolute; inset:0; z-index:55; pointer-events:none; overflow:hidden; }
.chat-bubble-stack { position:absolute; width:max-content; max-width:min(190px, 45vw); display:flex; flex-direction:column; align-items:stretch; gap:5px; transform:translate(-50%, calc(-100% - 16px)); }
.chat-bubble-stack.is-below { transform:translate(-50%, 16px); }
.chat-bubble { position:relative; max-width:190px; min-width:65px; padding:7px 10px; border:2px solid #000; border-radius:13px; background:#fff; box-shadow:0 5px 16px #0007; color:#000; font:500 12px/1.35 var(--heading); overflow-wrap:anywhere; white-space:pre-wrap; }
.chat-bubble-stack::after { content:''; position:absolute; bottom:-8px; left:calc(50% + var(--tail-x)); width:13px; height:13px; transform:translateX(-50%) rotate(45deg); border-right:2px solid #000; border-bottom:2px solid #000; background:#fff; }
.chat-bubble-stack.is-below::after { bottom:auto; top:-8px; transform:translateX(-50%) rotate(45deg); border:0; border-left:2px solid #000; border-top:2px solid #000; }
@media (max-width:600px) { .chat-bubble-stack { max-width:min(160px, 43vw); } .chat-bubble { font-size:12px; padding:7px 9px; } }
@media (prefers-reduced-motion:no-preference) { .chat-bubble { animation:chat-appear .16s ease-out both; } @keyframes chat-appear { from { opacity:0; transform:translateY(5px); } } }
</style>
