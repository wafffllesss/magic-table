import type { DeckDefinition } from './game';

export const COMMANDER_COLORS = [
  { code: 'W', label: 'Branco', symbol: 'W' },
  { code: 'U', label: 'Azul', symbol: 'U' },
  { code: 'B', label: 'Preto', symbol: 'B' },
  { code: 'R', label: 'Vermelho', symbol: 'R' },
  { code: 'G', label: 'Verde', symbol: 'G' },
] as const;

export function commanderColorIdentity(deck: DeckDefinition): string[] {
  return [...new Set(deck.entries.filter(entry => entry.role === 'commander').flatMap(entry => entry.card?.color_identity ?? []))];
}

export function matchesCommanderColors(deck: DeckDefinition, selectedColors: readonly string[]): boolean {
  if (!selectedColors.length) return true;
  const identity = new Set(commanderColorIdentity(deck));
  return selectedColors.every(color => identity.has(color));
}
