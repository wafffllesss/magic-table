import type { CardInstance } from './game';
import type { TableSeatId } from '../services/firebaseRoom';

export type HandRevealRequest = { id: string; matchId: string; requesterSeatId: TableSeatId; ownerSeatId: TableSeatId; requesterName: string };
export type HandRevealView = { ownerSeatId: TableSeatId; ownerName: string; requesterName: string; cards: CardInstance[] };
