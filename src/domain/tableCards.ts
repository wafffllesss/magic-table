import type { CardInstance, MatchState, PlayerSeat } from './game';

export type TableZones = Record<'battlefield' | 'command' | 'graveyard' | 'exile', CardInstance[]>;

export function indexTableCards(state: MatchState): { seats: Map<string, PlayerSeat>; zones: Map<string, TableZones>; revealed: CardInstance[] } {
  const seats = new Map(state.seats.map(seat => [seat.id, seat]));
  const zones = new Map(state.seats.map(seat => [seat.id, { battlefield: [], command: [], graveyard: [], exile: [] } as TableZones]));
  const revealed: CardInstance[] = [];
  for (const card of Object.values(state.cards)) {
    if (card.zone === 'battlefield' || card.zone === 'command') zones.get(card.controllerId)?.[card.zone].push(card);
    else if (card.zone === 'graveyard' || card.zone === 'exile') zones.get(card.ownerId)?.[card.zone].push(card);
    if (card.revealed && !card.temporaryReveal && card.zone === 'hand') revealed.push(card);
  }
  return { seats, zones, revealed: revealed.slice(-6) };
}
