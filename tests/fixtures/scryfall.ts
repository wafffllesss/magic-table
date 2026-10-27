import type { CardDefinition, DeckDefinition } from '../../src/domain/game';
import { normaliseCardName } from '../../src/domain/cardNames';
import { preconCards } from './precons';

function card(number: number, name: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  const id = `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
  return { id, oracle_id: id, name, layout: 'normal', mana_cost: '{1}', type_line: 'Creature', oracle_text: 'Test fixture.',
    color_identity: [], keywords: [], legalities: { commander: 'legal' }, power: '2', toughness: '2',
    image_uris: { small: `https://cards.scryfall.io/small/front/${id}.jpg`, normal: `https://cards.scryfall.io/normal/front/${id}.jpg` }, ...overrides };
}

export const commanders = [
  card(1, 'Adeline, Resplendent Cathar', { type_line: 'Legendary Creature — Human Knight', color_identity: ['W'] }),
  card(2, 'Talrand, Sky Summoner', { type_line: 'Legendary Creature — Merfolk Wizard', color_identity: ['U'] }),
  card(3, 'Frodo, Adventurous Hobbit', { type_line: 'Legendary Creature — Halfling Scout', color_identity: ['W', 'B'], keywords: ['Partner with'], oracle_text: 'Partner with Sam, Loyal Attendant.' }),
  card(4, 'Sam, Loyal Attendant', { type_line: 'Legendary Creature — Halfling Peasant', color_identity: ['W', 'G'], keywords: ['Partner with'], oracle_text: 'Partner with Frodo, Adventurous Hobbit.' }),
  card(5, "Lae'zel, Vlaakith's Champion", { type_line: 'Legendary Creature — Gith Warrior', color_identity: ['W'], oracle_text: 'Choose a Background.' }),
  card(6, 'Agent of the Iron Throne', { type_line: 'Legendary Enchantment — Background', color_identity: ['B'] }),
];
export const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((name, index) => card(10 + index, name, { type_line: `Basic Land — ${name}`, mana_cost: '', oracle_text: '{T}: Add mana.' }));
export const spells = Array.from({ length: 70 }, (_, index) => card(100 + index, `Fixture creature ${index + 1}`));
export const apiCards = [...commanders, ...basics, ...spells, ...preconCards];
export function findFixture(identifier: { id?: string; name?: string }): CardDefinition | undefined {
  return apiCards.find(item => identifier.id ? item.id === identifier.id : normaliseCardName(item.name) === normaliseCardName(identifier.name ?? ''));
}

export function fixtureDecks(): DeckDefinition[] {
  const recipes = [
    { id: 'starter-mono-white', name: 'Marcha da Vanguarda', leaders: commanders.slice(0, 1), lands: [basics[0]] },
    { id: 'starter-mono-blue', name: 'Cartógrafos do Éter', leaders: commanders.slice(1, 2), lands: [basics[1]] },
    { id: 'starter-partner', name: 'Uma Sociedade Inesperada', leaders: commanders.slice(2, 4), lands: [basics[4], basics[0], basics[2]] },
    { id: 'starter-background', name: 'Aventura sem Fronteiras', leaders: commanders.slice(4, 6), lands: [basics[0], basics[2]] },
  ];
  return structuredClone(recipes.map(recipe => ({ id: recipe.id, name: recipe.name, format: 'commander' as const, starterVersion: 2,
    commanders: recipe.leaders.map(card => card.id), updatedAt: 0,
    entries: [
      ...recipe.leaders.map(card => ({ cardId: card.id, name: card.name, quantity: 1, role: 'commander' as const, card })),
      ...spells.slice(0, 65 - recipe.leaders.length).map(card => ({ cardId: card.id, name: card.name, quantity: 1, role: 'library' as const, card })),
      ...recipe.lands.map((card, index) => ({ cardId: card.id, name: card.name, quantity: index === recipe.lands.length - 1 ? 35 - Math.ceil(35 / recipe.lands.length) * index : Math.ceil(35 / recipe.lands.length), role: 'library' as const, card })),
    ] })));
}
