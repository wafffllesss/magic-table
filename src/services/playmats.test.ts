import { describe, expect, it } from 'vitest';
import { playmatColor, playmatCustomImage, validPlaymatId } from './playmats';

describe('playmat choices', () => {
  it('accepts catalog art, solid colors and web image URLs', () => {
    expect(validPlaymatId('azorius')).toBe('azorius');
    expect(playmatColor('color:#123abc')).toBe('#123abc');
    expect(playmatCustomImage('image:https://example.com/art.jpg?a=1')).toBe('https://example.com/art.jpg?a=1');
  });
  it('rejects invalid or unsafe choices', () => {
    for (const id of ['color:red', 'image:javascript:alert(1)', 'image:https://user:password@example.com/x', 'image:https://example.com/a b', 'image:https://example.com/' + 'a'.repeat(2048)]) expect(validPlaymatId(id)).toBeUndefined();
  });
});
