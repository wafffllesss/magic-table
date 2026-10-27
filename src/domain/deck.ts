import type { CardDefinition, DeckDefinition, DeckEntry } from './game';
import { totalCards } from './game';

export function parseDeckText(text: string, id = `deck-${Date.now().toString(36)}`): DeckDefinition {
  const entries = new Map<string, DeckEntry>();
  const names = new Map<string, string>();
  let commanders: string[] = [];
  let commanderSection = false;
  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.split(/\s+(?:#|\/\/)/)[0].trim();
    if (!line) continue;
    if (/^\s*(?:commander|commanders|command zone|zona de comando)\s*:?\s*$/i.test(line)) { commanderSection = true; continue; }
    if (/^\s*(?:deck|mainboard|maindeck|library|biblioteca|baralho)\s*:?\s*$/i.test(line)) { commanderSection = false; continue; }
    const match = line.match(/^(?:(\d+)\s*[xX]?\s+|[xX]\s*(\d+)\s+)?(.+?)\s*(?:\(\s*([\w-]+)\s+([\w-]+)\s*\))?\s*$/);
    if (!match?.[3]) throw new Error(`Linha ${index + 1}: use "quantidade nome da carta".`);
    const quantity = Math.max(1, Math.min(100, Number(match[1] ?? match[2] ?? 1)));
    const name = match[3].trim().replace(/\s+/g, ' ');
    const key = name.toLocaleLowerCase('pt-BR');
    if (commanderSection) {
      if (quantity !== 1 || commanders.some(item => item.toLocaleLowerCase('pt-BR') === key)) throw new Error('Cada comandante pode aparecer apenas uma vez na zona de comando.');
      commanders.push(name);
      entries.set(key, { cardId: key, name, quantity: 1, role: 'commander' });
    } else {
      if (entries.has(key) && entries.get(key)!.role === 'commander') throw new Error(`${name} já foi declarado como comandante.`);
      const existing = entries.get(key);
      entries.set(key, { cardId: key, name: existing?.name ?? name, quantity: (existing?.quantity ?? 0) + quantity, role: 'library' });
    }
  }
  if (commanders.length < 1 || commanders.length > 2) throw new Error('Declare um ou dois comandantes em uma seção "Commander:".');
  const result: DeckDefinition = { id, name: 'Deck importado', format: 'commander', commanders: commanders.map(name => name.toLocaleLowerCase('pt-BR')), entries: [...entries.values()], updatedAt: Date.now() };
  if (totalCards(result) !== 100) throw new Error(`O deck tem ${totalCards(result)} cartas. Commander exige exatamente 100, contando o(s) comandante(s).`);
  return result;
}

export function validateDeck(deck: DeckDefinition, cards: Map<string, CardDefinition>, checkFormat = true): string[] {
  const problems: string[] = [];
  if (deck.commanders.length < 1 || deck.commanders.length > 2) problems.push('O deck precisa de um ou dois comandantes.');
  if (totalCards(deck) !== 100) problems.push(`Commander exige 100 cartas; o deck tem ${totalCards(deck)}.`);
  const commanderCards = deck.commanders.map(id => findCard(deck, cards, id)).filter((card): card is CardDefinition => Boolean(card));
  if (commanderCards.length !== deck.commanders.length) problems.push('Resolva todas as cartas de comandante pela biblioteca do Scryfall.');
  for (const commander of commanderCards) {
    if (!(/\bLegendary\b/i.test(commander.type_line) && /\bCreature\b/i.test(commander.type_line)) && !/\bBackground\b/i.test(commander.type_line) && !/can be your commander/i.test(commander.oracle_text)) {
      problems.push(`${commander.name} não pode ser escolhido como comandante.`);
    }
  }
  const identity = new Set(commanderCards.flatMap(card => card.color_identity));
  const singletonCounts = new Map<string, { name: string; quantity: number; exempt: boolean }>();
  for (const cardEntry of deck.entries) {
    if (!Number.isInteger(cardEntry.quantity) || cardEntry.quantity < 1 || cardEntry.quantity > 100) problems.push(`Quantidade inválida para ${cardEntry.name}.`);
    const card = findCard(deck, cards, cardEntry.cardId);
    if (!card) { problems.push(`Carta não encontrada: ${cardEntry.name}.`); continue; }
    const legality = card.legalities.commander;
    if (checkFormat && legality === 'banned') problems.push(`${card.name} está banida em Commander.`);
    else if (checkFormat && legality === 'not_legal') problems.push(`${card.name} não é legal em Commander.`);
    if (!card.color_identity.every(color => identity.has(color))) problems.push(`${card.name} está fora da identidade de cores dos comandantes.`);
    const oracleId = card.oracle_id || card.id;
    const count = singletonCounts.get(oracleId) ?? { name: card.name, quantity: 0, exempt: false };
    count.quantity += Math.max(0, cardEntry.quantity);
    count.exempt ||= /\bBasic Land\b/i.test(card.type_line) || /(?:you can have any number|a deck can have any number)/i.test(card.oracle_text);
    singletonCounts.set(oracleId, count);
  }
  for (const copy of singletonCounts.values()) if (copy.quantity > 1 && !copy.exempt) problems.push(`${copy.name} aparece mais de uma vez em um deck singleton.`);
  if (commanderCards.length === 2 && !areValidPartners(commanderCards)) problems.push('Os comandantes não formam um par reconhecido por Partner, Partner with, Friends forever, Doctor’s companion ou Choose a Background.');
  return [...new Set(problems)];
}

export function areValidPartners([first, second]: CardDefinition[]): boolean {
  if (!first || !second) return false;
  const firstWords = `${first.keywords.join(' ')} ${first.oracle_text}`.toLowerCase();
  const secondWords = `${second.keywords.join(' ')} ${second.oracle_text}`.toLowerCase();
  const identity = new Set([...first.color_identity, ...second.color_identity]);
  if (firstWords.includes('partner') && secondWords.includes('partner')) {
    // Keyword names also contain "Partner with"; extract the actual partner only from rules text.
    const a = first.oracle_text.match(/partner with ([^(\n]+)/i)?.[1].trim().replace(/\.$/, '');
    const b = second.oracle_text.match(/partner with ([^(\n]+)/i)?.[1].trim().replace(/\.$/, '');
    return !(a || b) || Boolean(a && b && normalise(a) === normalise(second.name) && normalise(b) === normalise(first.name));
  }
  const backgroundA = /background/i.test(first.type_line) && first.type_line.includes('Legendary');
  const backgroundB = /background/i.test(second.type_line) && second.type_line.includes('Legendary');
  if (firstWords.includes('choose a background') && backgroundB || secondWords.includes('choose a background') && backgroundA) return true;
  if (firstWords.includes("doctor’s companion") || firstWords.includes("doctor's companion")) return /time lord|doctor/i.test(second.type_line);
  if (secondWords.includes("doctor’s companion") || secondWords.includes("doctor's companion")) return /time lord|doctor/i.test(first.type_line);
  if (firstWords.includes('friends forever') && secondWords.includes('friends forever')) return true;
  return false;
}

function findCard(deck: DeckDefinition, cards: Map<string, CardDefinition>, id: string): CardDefinition | undefined {
  return cards.get(id) ?? deck.entries.find(entry => entry.cardId === id)?.card ?? deck.entries.find(entry => entry.cardId.toLocaleLowerCase('pt-BR') === id.toLocaleLowerCase('pt-BR'))?.card;
}
function normalise(name: string): string { return name.trim().toLocaleLowerCase('pt-BR').replace(/[“”"'’]/g, ''); }
