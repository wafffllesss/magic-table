import { describe, expect, it } from 'vitest';
import { cardImageSource, imagePixelWidth } from './imagePolicy';
import { commanders } from '../../tests/fixtures/scryfall';
import type { CardDefinition } from '../domain/game';

describe('adaptive image policy', () => {
  it('caps pixel density and accounts for cover cropping', () => {
    expect(imagePixelWidth(100, 100, 1, 3)).toBe(150);
    expect(imagePixelWidth(100, 300, 16 / 9, 1)).toBeCloseTo(533.33);
  });
  it('uses the nearest available size without leaking images between faces', () => {
    expect(cardImageSource(commanders[0], 'large')?.size).toBe('normal');
    const card: CardDefinition = { ...commanders[0], image_uris: undefined, card_faces: [
      { name: 'Front', mana_cost: '', type_line: '', oracle_text: '', image_uris: { small: 'https://cards.scryfall.io/front.jpg', large: 'https://cards.scryfall.io/front-large.jpg' } },
      { name: 'Back', mana_cost: '', type_line: '', oracle_text: '', image_uris: { normal: 'https://cards.scryfall.io/back.jpg' } },
    ] };
    expect(cardImageSource(card, 'normal', 0)?.size).toBe('small');
    expect(cardImageSource(card, 'small', 1)?.uri).toContain('back.jpg');
    expect(cardImageSource(card, 'small', 2)).toBeUndefined();
    expect(cardImageSource({ ...commanders[0], image_uris: { small: 'http://untrusted/image.jpg' } }, 'small')).toBeUndefined();
  });
});
