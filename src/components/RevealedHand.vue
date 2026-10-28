<script setup lang="ts">
import type { CardInstance } from '../domain/game';
import CardTile from './CardTile.vue';
import { useAppI18n } from '../i18n';

defineProps<{ ownerName: string; requesterName: string; cards: CardInstance[]; canClose: boolean }>();
const emit = defineEmits<{ (event: 'close'): void }>();
const { t } = useAppI18n();
</script>

<template>
  <section class="revealed-hand" :aria-label="t('table.revealedHandLabel', { name: ownerName })">
    <header><span><b>{{ t('table.revealedHand') }}</b> · {{ ownerName }} · {{ t('table.revealedBy') }} {{ requesterName }}</span><button v-if="canClose" type="button" @click.stop="emit('close')">{{ t('table.closeReveal') }}</button></header>
    <div class="revealed-hand-cards"><button v-for="card in cards" :key="card.id" type="button" :data-menu-card="card.id" :aria-label="t('table.targetCard', { name: card.card?.name ?? t('table.card') })"><CardTile :card="card" :compact="true" /></button><span v-if="!cards.length">{{ t('table.emptyZone') }}</span></div>
  </section>
</template>

<style scoped>
.revealed-hand{position:absolute;z-index:10;left:50%;top:calc(100% + 103px);width:min(430px,90vw);max-height:144px;padding:6px;border:1px solid #98bc7b88;border-radius:7px;background:#101a15f5;box-shadow:0 5px 14px #0009;transform:translateX(-50%);pointer-events:auto}.revealed-hand header{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#b9cbb4;font:9px var(--mono)}.revealed-hand header b{color:#c6eb9e}.revealed-hand header button{flex:none;padding:3px 6px;border:1px solid #76916b;border-radius:4px;background:#263a2a;color:#e7f4dc;font:9px var(--mono);cursor:pointer}.revealed-hand-cards{display:flex;gap:5px;overflow-x:auto;padding:7px 2px 2px}.revealed-hand-cards>button{flex:none;width:50px;height:70px;padding:0;border:1px solid #879a7c;border-radius:4px;background:#18251c;cursor:pointer}.revealed-hand-cards>button:focus-visible,.revealed-hand header button:focus-visible{outline:2px solid #c6eb9e;outline-offset:2px}.revealed-hand-cards>button .card-tile{width:100%;height:100%}.revealed-hand-cards>span{padding:10px;color:#9ba99c;font:9px var(--mono)}
</style>
