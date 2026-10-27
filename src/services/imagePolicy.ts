import type { CardDefinition } from '../domain/game';

export const CARD_IMAGE_SIZES = ['small', 'normal', 'large'] as const;
export type CardImageSize = typeof CARD_IMAGE_SIZES[number];

export function imagePixelWidth(width: number, height: number, aspect: number, density = 1): number {
  return Math.max(width, height * aspect) * Math.min(1.5, Math.max(1, density));
}

export function cardImageSource(card: CardDefinition, requested: CardImageSize, face = 0): { size: CardImageSize; uri: string } | undefined {
  const target = CARD_IMAGE_SIZES.indexOf(requested);
  const available = CARD_IMAGE_SIZES.flatMap((size, rank) => {
    const uri = card.image_uris?.[size] ?? card.card_faces?.[face]?.image_uris?.[size];
    return uri?.startsWith('https://cards.scryfall.io/') ? [{ size, uri, rank }] : [];
  });
  available.sort((a, b) => Math.abs(a.rank - target) - Math.abs(b.rank - target) || a.rank - b.rank);
  return available[0];
}
