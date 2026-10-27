import type { CardDefinition } from './game';

export type CreatureTokenGroup = { key: string; definitions: CardDefinition[] };

export function creatureTokenTypes(card: CardDefinition): string[] {
  const line = card.card_faces?.[0]?.type_line ?? card.type_line;
  const subtypeLine = line.split('—')[1]?.trim();
  if (!subtypeLine) return ['other'];
  const hasTimeLord = /\btime\s+lord\b/i.test(subtypeLine);
  const singleWordTypes = subtypeLine.replace(/\btime\s+lord\b/i, ' ').split(/\s+/).filter(Boolean);
  return [...singleWordTypes, ...(hasTimeLord ? ['Time Lord'] : [])];
}

export function groupCreatureTokens(cards: CardDefinition[]): CreatureTokenGroup[] {
  const groups = new Map<string, CardDefinition[]>();
  for (const card of cards) {
    for (const type of creatureTokenTypes(card)) {
      const entries = groups.get(type) ?? [];
      entries.push(card);
      groups.set(type, entries);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b))
    .map(([key, definitions]) => ({ key, definitions: definitions.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export const cardTypeGroups = [
  { key: 'creature', label: 'Criaturas' }, { key: 'planeswalker', label: 'Planeswalkers' },
  { key: 'instant', label: 'Instantâneas' }, { key: 'sorcery', label: 'Feitiços' },
  { key: 'artifact', label: 'Artefatos' }, { key: 'enchantment', label: 'Encantamentos' },
  { key: 'battle', label: 'Batalhas' }, { key: 'land', label: 'Terrenos' },
];

const classificationPriority = ['land', 'creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'battle'];

export function cardTypeKey(card?: CardDefinition): string {
  const types = (card?.card_faces?.[0]?.type_line ?? card?.type_line ?? '').split('—')[0].toLowerCase();
  return classificationPriority.find(type => types.includes(type)) ?? 'other';
}
