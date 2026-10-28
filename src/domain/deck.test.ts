import { describe, expect, it } from 'vitest';
import { parseDeckText, validateDeck, areValidPartners } from './deck';
import type { CardDefinition, DeckDefinition } from './game';
import { totalCards } from './game';

function definition(id: string, name: string, identity: string[] = ['W'], options: Partial<CardDefinition> = {}): CardDefinition {
  return { id, oracle_id: id, name, layout: 'normal', color_identity: identity, keywords: [], mana_cost: '{W}', type_line: 'Creature', oracle_text: '', legalities: { commander: 'legal' }, ...options };
}
function legalSingleCommanderDeck(): DeckDefinition {
  const commander = definition('leader', 'A New Commander', ['W'], { type_line: 'Legendary Creature' });
  const basic = definition('plains', 'Plains', [], { type_line: 'Basic Land — Plains', mana_cost: '' });
  const spells = Array.from({ length: 64 }, (_, index) => definition(`spell-${index}`, `Spell ${index}`, ['W']));
  const entries: DeckDefinition['entries'] = [
    { cardId: commander.id, name: commander.name, quantity: 1, role: 'commander', card: commander },
    ...spells.map(card => ({ cardId: card.id, name: card.name, quantity: 1, role: 'library' as const, card })),
    { cardId: basic.id, name: basic.name, quantity: 35, role: 'library', card: basic },
  ];
  return { id: 'valid', name: 'A new deck', format: 'commander', commanders: [commander.id], entries, updatedAt: 1 };
}

describe('Commander deck tools', () => {
  it('parses a 100-card list with one commander section and repeated basic lands', () => {
    const otherCards = Array.from({ length: 64 }, (_, index) => `1 Unique Card ${index}`).join('\n');
    const deck = parseDeckText(`Commander:\n1 A New Commander\n\nDeck:\n35 Plains\n${otherCards}`);
    expect(deck.commanders).toEqual(['a new commander']);
    expect(totalCards(deck)).toBe(100);
    expect(deck.entries.find(entry => entry.name === 'Plains')?.quantity).toBe(35);
  });

  it('parses incomplete lists and reports their total during validation', () => {
    const incomplete = parseDeckText('Commander:\n1 A New Commander\n\nDeck:\n35 Plains');
    expect(totalCards(incomplete)).toBe(36);
    expect(validateDeck(incomplete, new Map())).toContain('Commander exige 100 cartas; o deck tem 36.');
    const deck = parseDeckText(`Commander:\n1 A New Commander\n\nDeck:\n35 Plains\n${Array.from({ length: 64 }, (_, i) => `1 Unique ${i}`).join('\n')}`);
    expect(validateDeck(deck, new Map())).toContain('Resolva todas as cartas de comandante pela biblioteca do Scryfall.');
  });

  it('validates the 100-card singleton list against color identity and format legality', () => {
    const deck = legalSingleCommanderDeck();
    const cards = new Map(deck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []));
    expect(validateDeck(deck, cards)).toEqual([]);
    deck.entries[1].card!.color_identity = ['U'];
    expect(validateDeck(deck, cards).some(problem => problem.includes('fora da identidade'))).toBe(true);
  });

  it('requires a legal commander and catches duplicate Oracle identities across printings', () => {
    const illegalLeaderDeck = legalSingleCommanderDeck();
    illegalLeaderDeck.entries[0].card!.type_line = 'Creature';
    const illegalLeaderCards = new Map(illegalLeaderDeck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []));
    expect(validateDeck(illegalLeaderDeck, illegalLeaderCards)).toContain('A New Commander não pode ser escolhido como comandante.');

    const deck = legalSingleCommanderDeck();
    const original = deck.entries.find(entry => entry.cardId === 'spell-1')!;
    const reprint = definition('spell-1-reprint', original.name, ['W'], { oracle_id: original.card!.oracle_id });
    deck.entries.find(entry => entry.name === 'Plains')!.quantity--;
    deck.entries.push({ cardId: reprint.id, name: reprint.name, quantity: 1, role: 'library', card: reprint });
    const cards = new Map(deck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []));
    expect(validateDeck(deck, cards)).toContain(`${original.name} aparece mais de uma vez em um deck singleton.`);
  });

  it('accepts Partner pairs by matching Partner with names and Choose a Background', () => {
    const first = definition('first', 'Frodo, Scout', ['W'], { keywords: ['Partner'], oracle_text: 'Partner with Sam, Garden Friend.' });
    const second = definition('second', 'Sam, Garden Friend', ['G'], { keywords: ['Partner'], oracle_text: 'Partner with Frodo, Scout.' });
    expect(areValidPartners([first, second])).toBe(true);
    first.keywords = ['Partner with', 'Vigilance', 'Partner'];
    second.keywords = ['Partner with', 'Partner'];
    first.oracle_text = 'Partner with Sam, Garden Friend (When this creature enters, search your library.)\nVigilance';
    second.oracle_text = 'Partner with Frodo, Scout (When this creature enters, search your library.)';
    expect(areValidPartners([first, second])).toBe(true);
    const backgroundOwner = definition('laezel', 'Warrior of the Gate', ['W'], { oracle_text: 'Choose a Background.' });
    const background = definition('background', 'Quiet Scholar', ['U'], { type_line: 'Legendary Enchantment — Background' });
    expect(areValidPartners([backgroundOwner, background])).toBe(true);
  });

  it('rejects illegal pairs, color mismatches, banned cards, and singleton duplicates', () => {
    const first = definition('first', 'First Legend', ['W'], { type_line: 'Legendary Creature' });
    const second = definition('second', 'Second Legend', ['B'], { type_line: 'Legendary Creature' });
    const deck = legalSingleCommanderDeck();
    const plainsEntry = deck.entries.find(entry => entry.name === 'Plains')!;
    deck.commanders = [first.id, second.id];
    deck.entries[0] = { cardId: first.id, name: first.name, quantity: 1, role: 'commander', card: first };
    deck.entries.push({ cardId: second.id, name: second.name, quantity: 1, role: 'commander', card: second });
    plainsEntry.quantity--;
    const banned = definition('banned', 'Banned Charm', ['U'], { legalities: { commander: 'banned' } });
    const repeated = definition('repeated', 'One Copy Only');
    deck.entries.push({ cardId: banned.id, name: banned.name, quantity: 1, role: 'library', card: banned });
    deck.entries.push({ cardId: repeated.id, name: repeated.name, quantity: 2, role: 'library', card: repeated });
    plainsEntry.quantity -= 3;
    const cards = new Map(deck.entries.flatMap(entry => entry.card ? [[entry.cardId, entry.card] as const] : []));
    const issues = validateDeck(deck, cards);
    expect(issues).toEqual(expect.arrayContaining([expect.stringContaining('Partner'), expect.stringContaining('fora da identidade'), expect.stringContaining('banida'), expect.stringContaining('mais de uma vez')]));
  });
});
