import type { CardDefinition } from './game';

export function normaliseCardName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/[’‘]/g, "'").toLocaleLowerCase('en-US');
}

export function cardNames(card: CardDefinition): string[] {
  return [...new Set([card.name, card.printed_name, ...(card.card_faces ?? []).map(face => face.name)]
    .filter((name): name is string => Boolean(name)).map(normaliseCardName))];
}
