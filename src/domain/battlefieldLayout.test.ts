import { describe, expect, it } from 'vitest';
import { battlefieldPosition } from './battlefieldLayout';
import type { CardInstance } from './game';

function permanent(id: string, type: string): CardInstance {
  return { id, controllerId: 'southWest', ownerId: 'southWest', cardId: id, zone: 'battlefield', tapped: false, faceDown: false, x: 0, y: 0, counters: {}, card: { id, oracle_id: id, name: id, layout: 'normal', color_identity: [], keywords: [], mana_cost: '', type_line: type, oracle_text: '', legalities: {} } };
}

describe('automatic battlefield layout', () => {
  it('fills the front row with creatures and puts support left and lands right behind them', () => {
    const placed: CardInstance[] = [];
    const place = (id: string, type: string) => {
      const card = permanent(id, type);
      Object.assign(card, battlefieldPosition(card, placed));
      placed.push(card);
      return card;
    };
    const creature = place('creature', 'Creature — Human');
    const artifactCreature = place('artifact-creature', 'Artifact Creature — Golem');
    const artifact = place('artifact', 'Artifact');
    const enchantment = place('enchantment', 'Enchantment');
    const land = place('land', 'Basic Land — Forest');
    expect(artifactCreature.y).toBe(creature.y);
    expect(artifactCreature.x).toBeGreaterThan(creature.x);
    expect(artifact.y).toBeGreaterThan(creature.y);
    expect(enchantment.y).toBe(artifact.y);
    expect(artifact.x).toBeLessThan(land.x);
    expect(enchantment.x).toBeLessThan(land.x);
    expect(land.y).toBeGreaterThan(creature.y);
  });

  it('keeps explicit coordinates', () => {
    expect(battlefieldPosition(permanent('creature', 'Creature'), [], 70, 50)).toEqual({ x: 70, y: 50 });
  });
});
