import { eligibleSeats, type MatchState } from './game';
import { indicatedSeat } from './tableInteraction';

export function soloTurnSeat(state: MatchState): string | undefined {
  const seats = eligibleSeats(state);
  if (!seats.length) return undefined;
  if (state.phase === 'mulligan') {
    const start = Math.max(0, seats.findIndex(seat => seat.id === state.activeSeatId));
    return [...seats.slice(start), ...seats.slice(0, start)].find(seat => !seat.keptHand)?.id;
  }
  return indicatedSeat(state);
}

export function soloTurnKey(state: MatchState): string {
  return `${state.phase}:${state.activeSeatId}:${soloTurnSeat(state) ?? ''}`;
}
