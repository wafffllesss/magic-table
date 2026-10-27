<script setup lang="ts">
import { computed } from 'vue';
import { useAppI18n } from '../i18n';
import { MAT_HEIGHT, MAT_WIDTH, SEAT_PLACEMENT, TABLE_SIZE } from '../domain/tableView';
import { TABLE_SEATS, type RoomSnapshot, type TableSeatId } from '../services/firebaseRoom';
import PlaymatArt from './PlaymatArt.vue';
import CommanderThumbnails from './CommanderThumbnails.vue';
import ChatBubbles from './ChatBubbles.vue';
import type { ChatMessage } from '../domain/chat';

const props = defineProps<{ room: RoomSnapshot; chatMessages?: ChatMessage[] }>();
const { t } = useAppI18n();
const seats = computed(() => TABLE_SEATS.map(id => ({ id, player: props.room.seats[id] })));
const occupied = computed(() => seats.value.filter(seat => seat.player).length);
const ready = computed(() => seats.value.filter(seat => seat.player?.ready).length);
const chatAnchors = Object.fromEntries(TABLE_SEATS.map(id => [id, { x: SEAT_PLACEMENT[id].x / TABLE_SIZE, y: SEAT_PLACEMENT[id].y / TABLE_SIZE }])) as Record<TableSeatId, { x: number; y: number }>;

function seatStyle(id: TableSeatId): Record<string, string> {
  const { x, y, angle } = SEAT_PLACEMENT[id];
  const sideways = Math.abs(angle) === 90;
  return {
    left: `${x / TABLE_SIZE * 100}%`,
    top: `${y / TABLE_SIZE * 100}%`,
    width: `${(sideways ? MAT_HEIGHT : MAT_WIDTH) / TABLE_SIZE * 100}%`,
    height: `${(sideways ? MAT_WIDTH : MAT_HEIGHT) / TABLE_SIZE * 100}%`,
  };
}
</script>

<template>
  <section class="lobby-table-preview" :aria-label="t('lobbyBoard.overview')">
    <header class="lobby-board-caption"><span>⌖ &nbsp; {{ t('lobbyBoard.overview') }}</span><span>{{ ready }}/4 {{ t('lobbyBoard.ready') }}</span></header>
    <div class="lobby-board">
      <div class="lobby-seat-layout">
        <article v-for="(item, index) in seats" :key="item.id" class="lobby-seat" :class="{ 'seat-self': item.id === room.selfSeatId, 'seat-ready': item.player?.ready, 'seat-empty': !item.player, 'seat-side': Math.abs(SEAT_PLACEMENT[item.id].angle) === 90 }" :style="seatStyle(item.id)" :data-seat="item.id" :aria-label="`${t('lobbyBoard.seat')} ${index + 1}${item.id === room.selfSeatId ? `, ${t('lobbyBoard.yourSeat')}` : ''}: ${item.player?.name ?? t('lobbyBoard.available')}`">
          <PlaymatArt v-if="item.player?.playmatId" class="lobby-playmat-art" :id="item.player.playmatId" />
          <div class="seat-index">{{ t('lobbyBoard.seat') }} {{ String(index + 1).padStart(2, '0') }} <span v-if="item.id === room.selfSeatId">· {{ t('lobbyBoard.you') }}</span></div>
          <div v-if="item.player" class="seat-player">
            <CommanderThumbnails v-if="item.player.deckSummary?.length" :entries="item.player.deckSummary" />
            <span v-else class="avatar-orbit" aria-hidden="true"><b>{{ item.player.name.charAt(0).toUpperCase() }}</b></span>
            <div><strong :title="item.player.name">{{ item.player.name }}</strong><small :title="item.player.deckName">{{ item.player.deckName ?? t('lobbyBoard.choosingDeck') }}</small></div>
          </div>
          <div v-else class="seat-placeholder"><span aria-hidden="true">＋</span><strong>{{ t('lobbyBoard.available') }}</strong></div>
          <div v-if="item.player?.deckSummary?.length" class="seat-commanders"><b v-for="leader in item.player.deckSummary" :key="leader.cardId" :title="leader.name">♛ {{ leader.name }}</b></div>
          <span v-if="item.player" class="seat-presence" :class="{ 'is-online': item.player.online, 'is-ready': item.player.ready }"><i></i>{{ item.player.ready ? t('lobbyBoard.playerReady') : item.player.online ? t('lobbyBoard.online') : t('lobbyBoard.reconnecting') }}</span>
          <small v-else class="seat-available-note">{{ t('lobbyBoard.waitingPlayer') }}</small>
        </article>
        <div class="lobby-center" role="status" aria-live="polite">
          <span class="center-rings" aria-hidden="true">✳</span><b>{{ occupied }}<i>/</i>4</b><span>{{ t('lobbyBoard.playersAtTable') }}</span><div class="center-line"></div><span class="queue-total">{{ room.queue.length }} {{ t('lobbyBoard.inQueue') }}</span>
        </div>
        <ChatBubbles :messages="chatMessages ?? []" :anchors="chatAnchors" />
      </div>
    </div>
    <footer class="lobby-board-caption"><span><i class="lobby-self-key"></i> {{ t('lobbyBoard.yourSeat') }}</span><span>{{ t('lobbyBoard.footer') }}</span></footer>
  </section>
</template>

<style scoped>
.lobby-table-preview { min-width: 0; width: 100%; max-width: min(620px, max(400px, calc(100dvh - 365px))); margin: auto; }
.lobby-board-caption { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #849482; font: 8px var(--mono); letter-spacing: .07em; }
.lobby-board-caption > span { display: flex; align-items: center; gap: 6px; }
.lobby-self-key { width: 5px; height: 5px; border-radius: 50%; background: var(--lime); }
.lobby-board { position: relative; width: 100%; aspect-ratio: 1; margin: 12px 0; padding: 10px; border: 6px solid #263426; border-radius: 28px; background: radial-gradient(ellipse at center, #3d553038, transparent 65%), repeating-linear-gradient(0deg, #c4d8b703 0 1px, transparent 1px 4px), #142219; box-shadow: 0 18px 42px #0005, inset 0 0 65px #0005, 0 0 0 1px #87997540; }
.lobby-board::before { position: absolute; content: ''; inset: 5px; border: 1px solid #bdd6a51a; border-radius: 18px; pointer-events: none; }
.lobby-seat-layout { position: relative; width: 100%; height: 100%; container-type: inline-size; }
.lobby-seat { position: absolute; min-width: 0; display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 8px; padding: 20px 12px 10px; overflow: hidden; transform: translate(-50%, -50%); border: 1px solid #c5ddc629; border-radius: 8px; background: linear-gradient(135deg, #203125, #0d1912); box-shadow: 0 4px 12px #0004; }
.lobby-seat.seat-self { border-color: #b8e677a6; background: linear-gradient(130deg, #30432a, #15231a); box-shadow: 0 0 0 3px #b8e6770a, 0 5px 18px #0004; }
.lobby-seat.seat-ready { border-color: #b8e67780; }
.lobby-seat.seat-empty { border-style: dashed; background: #0b171185; box-shadow: inset 0 0 25px #0002; }
.lobby-playmat-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .18; pointer-events: none; }
.lobby-seat > :not(.lobby-playmat-art) { position: relative; }
.lobby-seat .seat-index { position: absolute; left: 10px; right: 8px; top: 8px; color: #95a58d; font: 7px var(--mono); letter-spacing: .06em; }
.seat-index span { color: var(--lime); white-space: nowrap; }
.seat-player .commander-thumbnails { --commander-thumbnail-width: 26px; }
.seat-player { display: flex; align-items: center; gap: 8px; margin: 0; }
.avatar-orbit { flex: none; width: 29px; height: 29px; display: grid; place-items: center; border: 1px solid #b8e6775c; border-radius: 50%; color: #d5ebba; font: 600 12px var(--heading); }
.seat-player > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.seat-player > div strong { overflow: hidden; color: #e0e8df; font: 600 12px var(--heading); text-overflow: ellipsis; white-space: nowrap; }
.seat-player > div small { overflow: hidden; color: #9dac98; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.seat-placeholder { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px; margin: 0; text-align: center; }
.seat-placeholder > span { display: grid; place-items: center; flex: none; width: 27px; height: 27px; border: 1px solid #b0c7b22f; border-radius: 50%; color: #8c9e87; font-size: 18px; }
.seat-placeholder strong { color: #afbea6; font: 500 10px var(--heading); }
.seat-commanders { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 0; border: 0; }
.seat-commanders b { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c4d7b2; font: 500 8px var(--heading); }
.seat-presence { display: flex; align-items: center; gap: 5px; color: #a7b59f; font: 6px var(--mono); letter-spacing: .06em; }
.seat-presence i { width: 4px; height: 4px; border-radius: 50%; background: #d2a57c; }
.seat-presence.is-online i { background: #a4c990; }
.seat-presence.is-ready { color: var(--lime); }
.seat-presence.is-ready i { background: var(--lime); }
.seat-available-note { color: #798d77; font-size: 8px; text-align: center; }
.seat-side .seat-player { flex-direction: column; align-items: flex-start; }
.seat-side .seat-player > div { width: 100%; }
.seat-side .seat-placeholder { flex-direction: column; }
.seat-side .seat-placeholder strong { max-width: 75px; }
.lobby-center { position: absolute; left: 50%; top: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 22%; height: 22%; gap: 3px; transform: translate(-50%, -50%); border: 1px solid #b8e67740; border-radius: 50%; background: radial-gradient(circle, #2c4023, #17271a); box-shadow: 0 8px 30px #0003; text-align: center; }
.center-rings { color: var(--lime); font-size: clamp(10px, 3cqw, 19px); }
.lobby-center > b { color: #eef2e9; font: 600 clamp(15px, 4cqw, 26px)/1 var(--heading); }
.lobby-center > b i { padding: 0 3px; color: #83947e; font-size: .65em; font-style: normal; }
.lobby-center > span:nth-last-of-type(2) { color: #a0b295; font: clamp(5px, 1.1cqw, 7px)/1.4 var(--mono); letter-spacing: .1em; }
.center-line { width: 40%; height: 1px; margin: 2px 0; background: #cbe4b929; }
.lobby-center .queue-total { color: #b5ce9b; font: clamp(5px, 1.1cqw, 7px) var(--mono); letter-spacing: .06em; }
@media (max-width: 900px) {
  .lobby-table-preview { max-width: 620px; }
}
@container (max-width: 470px) {
  .lobby-seat { gap: 5px; padding: 18px 8px 6px; border-radius: 6px; }
  .lobby-seat .seat-index { left: 6px; top: 6px; font-size: 6px; letter-spacing: 0; }
  .seat-player { gap: 5px; }
  .seat-player .commander-thumbnails { --commander-thumbnail-width: 21px; }
  .avatar-orbit { width: 22px; height: 22px; font-size: 10px; }
  .seat-player > div strong { font-size: 10px; }
  .seat-player > div small { font-size: 7px; }
  .seat-placeholder > span { width: 22px; height: 22px; font-size: 15px; }
  .seat-placeholder strong { font-size: 8px; }
  .seat-commanders b { font-size: 7px; }
  .lobby-seat:not(.seat-side) .seat-commanders { display: none; }
  .seat-available-note { font-size: 6px; }
  .lobby-center { gap: 2px; }
  .center-line { margin: 1px 0; }
}
</style>
