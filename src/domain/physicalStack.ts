export const MAX_STACK_HEIGHT = 22;
export const STACK_HEIGHT_PER_CARD = 0.4;
export const MAX_VISIBLE_STACK_LAYERS = 4;
export const MAX_STACK_OFFSET = 0.6;
export const MAX_STACK_ROTATION = 0.25;

export type PhysicalStackLayer = {
  sample: number;
  x: number;
  y: number;
  z: number;
  rotation: number;
};

export type PhysicalStackGeometry = {
  count: number;
  height: number;
  layers: PhysicalStackLayer[];
};

function randomValue(seed: string, sample: number, channel: number): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  let state = hash ^ Math.imul(sample + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b);
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  state ^= state >>> 16;
  return (state >>> 0) / 0x1_0000_0000 * 2 - 1;
}

/** Build a small, stable set of physical card layers for a shared tabletop stack. */
export function createPhysicalStackGeometry(count: number, seed: string): PhysicalStackGeometry {
  const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (normalizedCount === 0) return { count: 0, height: 0, layers: [] };

  const height = Math.min(MAX_STACK_HEIGHT, (normalizedCount - 1) * STACK_HEIGHT_PER_CARD);
  const layerCount = Math.min(MAX_VISIBLE_STACK_LAYERS, normalizedCount);
  const layers = Array.from({ length: layerCount }, (_, index): PhysicalStackLayer => {
    const progress = layerCount === 1 ? 0 : index / (layerCount - 1);
    const sample = layerCount === 1 ? 0 : Math.round(progress * (MAX_VISIBLE_STACK_LAYERS - 1));
    const base = index === 0;
    return {
      sample,
      x: base ? 0 : randomValue(seed, sample, 0) * MAX_STACK_OFFSET,
      y: base ? 0 : randomValue(seed, sample, 1) * MAX_STACK_OFFSET,
      z: height * progress,
      rotation: base ? 0 : randomValue(seed, sample, 2) * MAX_STACK_ROTATION,
    };
  });
  return { count: normalizedCount, height, layers };
}
