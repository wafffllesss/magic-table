<script setup lang="ts">
import type { CSSProperties, Ref } from 'vue';
import type { MatchState, Zone } from '../domain/game';
import type { HandPose } from '../domain/tablePresence';
import CardTile from './CardTile.vue';
import VirtualHand from './VirtualHand.vue';

type Hand = { seatId: string; name: string; x: number; y: number; angle: number; pose: HandPose; color: string; gestureId?: string; cardId?: string; cardBack: boolean; local: boolean };
type Model = {
  hands: Readonly<Ref<Hand[]>>; local: Readonly<Ref<Hand | undefined>>; cursor: Readonly<Ref<CSSProperties>>;
  enabled: Readonly<Ref<boolean>>; cards: Readonly<Ref<MatchState['cards']>>;
  drag: Readonly<Ref<{ id: string; zone: Zone; moved: boolean } | undefined>>;
  ghost: Readonly<Ref<{ x: number; y: number; width: number; height: number } | undefined>>;
};
defineProps<{ model: Model }>();
</script>

<template>
  <div class="hand-stage-layer" aria-hidden="true">
    <template v-for="hand in model.hands.value" :key="hand.seatId">
      <div v-if="hand.cardId && !hand.local && hand.pose === 'grab' && model.cards.value[hand.cardId]" class="remote-hand-card"
        :style="{ left: 0, top: 0, transform: 'translate3d(' + (hand.x - 20) + 'px,' + (hand.y - 25) + 'px,0)' }">
        <CardTile :card="model.cards.value[hand.cardId]" :compact="true" :zoom-enabled="false" />
      </div>
      <VirtualHand v-if="!hand.local"
        :pose="hand.pose === 'grab' && hand.cardId && model.cards.value[hand.cardId] ? 'follow' : hand.pose" :color="hand.color" :player-name="hand.name" :angle="hand.angle" :gesture-id="hand.gestureId" :card-back="hand.cardBack"
        class="is-remote" :data-seat="hand.seatId" :style="{ left: 0, top: 0, transform: 'translate3d(' + (hand.x - 14) + 'px,' + hand.y + 'px,0)' }" />
    </template>
  </div>
  <Teleport to="body">
    <VirtualHand v-if="model.enabled.value && model.local.value && !model.drag.value?.moved" class="is-local local-hand-cursor"
      :pose="model.local.value.pose" :color="model.local.value.color" :player-name="model.local.value.name"
      :angle="model.local.value.angle" :gesture-id="model.local.value.gestureId" :style="model.cursor.value" />
    <div v-if="model.drag.value?.moved && model.ghost.value && model.cards.value[model.drag.value.id]" class="drag-floating-card"
      :class="{ 'is-tapped': model.cards.value[model.drag.value.id].tapped && model.drag.value.zone === 'battlefield' }"
      :style="{ left: 0, top: 0, transform: 'translate3d(' + model.ghost.value.x + 'px,' + model.ghost.value.y + 'px,0)' + (model.cards.value[model.drag.value.id].tapped && model.drag.value.zone === 'battlefield' ? ' rotate(90deg)' : ''), width: model.ghost.value.width + 'px', height: model.ghost.value.height + 'px', willChange: 'transform' }" aria-hidden="true">
      <CardTile :zoom-enabled="false" :card="model.cards.value[model.drag.value.id]" :compact="model.drag.value.zone === 'battlefield' || model.drag.value.zone === 'command'" />
    </div>
  </Teleport>
</template>
