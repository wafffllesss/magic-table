import { describe, expect, it } from 'vitest';
import type { CardDefinition } from './game';
import { creatureTokenTypes, groupCreatureTokens } from './cardTypes';

function token(id: string, name: string, typeLine: string): CardDefinition {
  return { id, oracle_id: id, name, layout: 'token', color_identity: [], keywords: [], mana_cost: '', type_line: typeLine, oracle_text: '', legalities: {} };
}

describe('creature token grouping', () => {
  it('places multi-type tokens in every matching type column', () => {
    const humanSoldier = token('human-soldier', 'Human Soldier', 'Token Creature — Human Soldier');
    const vampire = token('vampire', 'Vampire', 'Token Creature — Vampire');
    const groups = groupCreatureTokens([humanSoldier, vampire]);
    expect(groups.map(group => group.key)).toEqual(['Human', 'Soldier', 'Vampire']);
    expect(groups.find(group => group.key === 'Human')?.definitions).toEqual([humanSoldier]);
    expect(groups.find(group => group.key === 'Soldier')?.definitions).toEqual([humanSoldier]);
  });

  it('keeps the multiword Time Lord creature type together', () => {
    expect(creatureTokenTypes(token('time-lord', 'Time Lord', 'Token Creature — Human Time Lord'))).toEqual(['Human', 'Time Lord']);
  });

  it('groups a token with no subtype under other', () => {
    expect(groupCreatureTokens([token('plain', 'Creature Token', 'Token Creature')])).toMatchObject([{ key: 'other' }]);
  });
});
