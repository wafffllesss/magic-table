import type { CardInstance } from './game';
import { clampCardPosition } from './tableView';

function category(card: CardInstance): 'land' | 'support' | 'creature' {
  const type = card.card?.card_faces?.[card.face ?? 0]?.type_line ?? card.card?.type_line ?? '';
  if (/\bLand\b/i.test(type)) return 'land';
  if (/\bCreature\b|\bPlaneswalker\b/i.test(type)) return 'creature';
  return 'support';
}

// Coordinates are percentages of the player's card area. Lands may overlap
// vertically; other permanents prefer separate slots and all groups avoid each other.
export function battlefieldPosition(card: CardInstance, cards: Iterable<CardInstance>, x?: number, y?: number): { x: number; y: number } {
  const kind = category(card);
  const occupied = Array.from(cards).filter(other => other.id !== card.id && other.zone === 'battlefield' && other.controllerId === card.controllerId);
  const columns = kind === 'land' ? [9, 24, 39, 54, 69, 84] : [39, 54, 69, 84, 24, 9];
  const rows = kind === 'land' ? [18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 82] : kind === 'support' ? [18, 50, 82] : [82, 50, 18];
  let best = { x: 49, y: 50 }; let bestScore = Infinity;
  for (const column of columns) for (const row of rows) {
    const candidate = clampCardPosition(x ?? column, y ?? row);
    let score = 0;
    for (const other of occupied) {
      const dx = Math.abs(candidate.x - other.x); const dy = Math.abs(candidate.y - other.y);
      const sameLandColumn = kind === 'land' && category(other) === 'land' && dx < 2;
      if (sameLandColumn) score += Math.max(0, 6 - dy) * 100;
      else score += Math.max(0, (other.tapped ? 15 : 11) - dx) * Math.max(0, (other.tapped ? 27 : 31) - dy);
    }
    if (score < bestScore) { best = candidate; bestScore = score; }
    if (score === 0) return candidate;
  }
  return best;
}
