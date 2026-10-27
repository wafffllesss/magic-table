import { describe, expect, it } from 'vitest';
import { createPhysicalStackGeometry, MAX_STACK_HEIGHT, MAX_STACK_OFFSET, MAX_STACK_ROTATION, MAX_VISIBLE_STACK_LAYERS } from './physicalStack';

describe('physical card stack geometry', () => {
  it.each([0, 1, 2, 6, 7, 40, 99, 500])('builds a bounded stack for %i cards', count => {
    const geometry = createPhysicalStackGeometry(count, 'southWest:library');
    expect(geometry.count).toBe(count);
    expect(geometry.layers).toHaveLength(Math.min(count, MAX_VISIBLE_STACK_LAYERS));
    expect(geometry.height).toBe(count === 0 ? 0 : Math.min(MAX_STACK_HEIGHT, (count - 1) * 0.4));
    if (count === 0) expect(geometry.layers).toEqual([]);
    if (count > 0) {
      expect(geometry.layers[0]).toEqual({ sample: 0, x: 0, y: 0, z: 0, rotation: 0 });
      expect(geometry.layers.at(-1)?.z).toBe(geometry.height);
      for (const layer of geometry.layers) {
        expect(Math.abs(layer.x)).toBeLessThanOrEqual(MAX_STACK_OFFSET);
        expect(Math.abs(layer.y)).toBeLessThanOrEqual(MAX_STACK_OFFSET);
        expect(Math.abs(layer.rotation)).toBeLessThanOrEqual(MAX_STACK_ROTATION);
      }
    }
  });

  it('is deterministic per owner and zone, independent of viewpoint', () => {
    const first = createPhysicalStackGeometry(99, 'southWest:library');
    const second = createPhysicalStackGeometry(99, 'southWest:library');
    const otherZone = createPhysicalStackGeometry(99, 'southWest:graveyard');
    expect(first).toEqual(second);
    expect(otherZone.layers.map(layer => [layer.x, layer.y, layer.rotation])).not.toEqual(first.layers.map(layer => [layer.x, layer.y, layer.rotation]));
  });

  it('keeps the bottom and top samples stable as the pile grows', () => {
    const small = createPhysicalStackGeometry(2, 'northEast:exile');
    const full = createPhysicalStackGeometry(99, 'northEast:exile');
    expect(small.layers[0]).toEqual(full.layers[0]);
    expect(small.layers.at(-1)).toMatchObject({ sample: MAX_VISIBLE_STACK_LAYERS - 1, x: full.layers.at(-1)?.x, y: full.layers.at(-1)?.y, rotation: full.layers.at(-1)?.rotation });
    expect(full.layers.map(layer => layer.x).some((value, index) => index > 1 && Math.sign(value) !== Math.sign(full.layers[index - 1].x))).toBe(true);
  });

  it('normalizes invalid counts to an empty stack', () => {
    expect(createPhysicalStackGeometry(-2, 'x')).toEqual({ count: 0, height: 0, layers: [] });
    expect(createPhysicalStackGeometry(Number.NaN, 'x')).toEqual({ count: 0, height: 0, layers: [] });
  });
});
