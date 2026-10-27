import manifests from '../data/precons.json' with { type: 'json' };
import type { DeckEntry } from '../domain/game';

export type PreconManifest = {
  id: string; name: string; setCode: string; edition: string; sourceUrl: string;
  dataUrl: string; version: number; colors: string[];
  entries: Pick<DeckEntry, 'name' | 'quantity' | 'role'>[];
};

export const PRECONS = manifests as PreconManifest[];
export const LEGACY_STARTER_IDS = ['starter-mono-white', 'starter-mono-blue', 'starter-partner', 'starter-background'] as const;
export const DEFAULT_PRECON_ID = 'precon-c14-forged-in-stone';
export const DEMO_OPPONENT_IDS = ['precon-scd-first-flight', 'precon-scd-grave-danger', 'precon-scd-draconic-destruction', 'precon-c20-arcane-maelstrom'];
