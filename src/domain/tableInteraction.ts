import { eligibleSeats, type GameAction, type MatchState } from './game';

export type TableMenuOption = { id: string; label: string; disabled?: boolean; action?: GameAction };

export function indicatedSeat(state: MatchState): string {
  const active = eligibleSeats(state);
  const start = Math.max(0, active.findIndex(seat => seat.id === state.activeSeatId));
  const ordered = [...active.slice(start), ...active.slice(0, start)];
  return (state.stack.length ? ordered.find(seat => !state.passes.includes(seat.id)) : undefined)?.id
    ?? ordered[0]?.id ?? state.activeSeatId;
}

export function cardMenuOptions(state: MatchState, cardId: string, seatId?: string, spectator = false, busy = false): TableMenuOption[] {
  const card = state.cards[cardId];
  if (!card || card.zone === 'library' || card.zone === 'hand' && card.ownerId !== seatId && !card.revealed && !card.temporaryReveal) return [];
  const isCommander = state.seats.some(seat => seat.id === card.ownerId && seat.commanderIds.includes(card.cardId));
  const options: TableMenuOption[] = card.card && !card.faceDown ? [{ id: 'inspect', label: 'Inspecionar' }] : [];
  const own = card.zone === 'battlefield' ? card.controllerId === seatId : card.ownerId === seatId;
  if (!seatId || spectator || !own || card.zone === 'stack') return options;
  const disabled = busy || state.paused || state.phase === 'finished' || state.seats.find(seat => seat.id === seatId)?.status !== 'playing';
  const add = (id: string, label: string, action: GameAction, blocked = false): void => { options.push({ id, label, action, disabled: disabled || blocked }); };
  if (card.zone === 'hand' || card.zone === 'command') {
    if (card.zone === 'hand' && /\bLand\b/i.test(card.card?.type_line ?? '')) {
      add('play', 'Jogar terreno', { type: 'PLAY_LAND', cardId }, state.phase !== 'playing' || state.activeSeatId !== seatId || (state.seats.find(seat => seat.id === seatId)?.landPlays ?? 0) >= 1);
    } else {
      add('cast', 'Conjurar', { type: 'CAST', cardId }, state.phase !== 'playing');
    }
    if (card.zone === 'hand') {
      add('reveal', 'Revelar esta carta', { type: 'REVEAL', cardIds: [cardId] });
      add('discard', 'Descartar para o cemitério', { type: 'MOVE_CARD', cardId, zone: 'graveyard' });
      if (isCommander) add('command', 'Enviar à zona de comando', { type: 'MOVE_CARD', cardId, zone: 'command' });
    }
  }
  if (card.zone === 'battlefield') {
    add('tap', card.tapped ? 'Desvirar' : 'Virar', { type: 'TAP', cardId });
    if ((card.card?.card_faces?.length ?? 0) > 1) add('flip', 'Trocar face', { type: 'FLIP_FACE', cardId });
    if (card.ownerId === seatId) add('face-down', card.faceDown ? 'Revelar esta carta' : 'Virar para baixo', { type: 'SET_FACE_DOWN', cardId, faceDown: !card.faceDown });
    add('counter', 'Marcador +1/+1', { type: 'CHANGE_COUNTER', cardId, counter: '+1/+1', amount: 1 });
    add('graveyard', 'Mover ao cemitério', { type: 'MOVE_CARD', cardId, zone: 'graveyard' });
    add('exile', 'Exilar', { type: 'MOVE_CARD', cardId, zone: 'exile' });
    if (isCommander) add('command', 'Enviar à zona de comando', { type: 'MOVE_CARD', cardId, zone: 'command' });
    if (card.ownerId === seatId) add('hand', 'Devolver à mão', { type: 'MOVE_CARD', cardId, zone: 'hand' });
  }
  if (card.zone === 'graveyard' || card.zone === 'exile') {
    add('hand', 'Devolver à mão', { type: 'MOVE_CARD', cardId, zone: 'hand' });
    if (isCommander) add('command', 'Enviar à zona de comando', { type: 'MOVE_CARD', cardId, zone: 'command' });
  }
  return options;
}
