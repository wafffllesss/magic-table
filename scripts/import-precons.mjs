// Refresh the checked-in manifests and offline card fixtures from MTGJSON.
// Only commander + mainBoard belong to the playable 100-card list.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const selections = [
  ['ForgedInStone_C14', 'Forged in Stone'], ['PeerThroughTime_C14', 'Peer Through Time'],
  ['SwornToDarkness_C14', 'Sworn to Darkness'], ['BuiltFromScratch_C14', 'Built from Scratch'],
  ['GuidedByNature_C14', 'Guided by Nature'], ['FirstFlight_SCD', 'First Flight'],
  ['GraveDanger_SCD', 'Grave Danger'], ['ChaosIncarnate_SCD', 'Chaos Incarnate'],
  ['DraconicDestruction_SCD', 'Draconic Destruction'], ['TokenTriumph_SCD', 'Token Triumph'],
  ['NatureSVengeance_C18', "Nature's Vengeance"], ['ArcaneMaelstrom_C20', 'Arcane Maelstrom'],
  ['InventSuperiority_C16', 'Invent Superiority'], ['DraconicDomination_C17', 'Draconic Domination'],
  ['ExplorersOfTheDeep_LCC', 'Explorers of the Deep'], ['AhoyMateys_LCC', 'Ahoy Mateys'],
  ['BloodRites_LCC', 'Blood Rites'], ['VelociRampTor_LCC', 'Veloci-Ramp-Tor'],
  ['BlameGame_MKC', 'Blame Game'], ['DeadlyDisguise_MKC', 'Deadly Disguise'],
  ['DeepClueSea_MKC', 'Deep Clue Sea'], ['RevenantRecon_MKC', 'Revenant Recon'],
  ['QuickDraw_OTC', 'Quick Draw'], ['DesertBloom_OTC', 'Desert Bloom'],
  ['GrandLarceny_OTC', 'Grand Larceny'], ['MostWanted_OTC', 'Most Wanted'],
  ['AnimatedArmy_BLC', 'Animated Army'], ['FamilyMatters_BLC', 'Family Matters'],
  ['PeaceOffering_BLC', 'Peace Offering'], ['SquirreledAway_BLC', 'Squirreled Away'],
];
const sources = {
  C14: 'https://magic.wizards.com/en/news/feature/release-notes-2014-11-10',
  SCD: 'https://magic.wizards.com/en/news/announcements/starter-commander-decks-decklists-2022-10-20',
  C16: 'https://magic.wizards.com/en/news/announcements/commander-2016-edition-decklists-2016-10-28',
  C17: 'https://magic.wizards.com/en/news/feature/commander-2017-edition-decklists-2017-08-11',
  C18: 'https://magic.wizards.com/en/news/feature/commander-2018-edition-decklists-and-tokens-2018-07-27',
  C20: 'https://magic.wizards.com/en/news/announcements/arcane-maelstrom-2020-04-06',
  LCC: 'https://magic.wizards.com/en/news/announcements/the-lost-caverns-of-ixalan-commander-decklists',
  MKC: 'https://magic.wizards.com/en/news/announcements/murders-at-karlov-manor-commander-decklists',
  OTC: 'https://magic.wizards.com/en/news/announcements/outlaws-of-thunder-junction-commander-decklists',
  BLC: 'https://magic.wizards.com/en/news/announcements/bloomburrow-commander-decklists',
};
const editions = { C14: 'Commander 2014', SCD: 'Starter Commander 2022', C16: 'Commander 2016', C17: 'Commander 2017', C18: 'Commander 2018', C20: 'Commander 2020', LCC: 'The Lost Caverns of Ixalan', MKC: 'Murders at Karlov Manor', OTC: 'Outlaws of Thunder Junction', BLC: 'Bloomburrow' };
const catalogue = [], cards = new Map(), hashes = {};
await mkdir(new URL('.cache/precons/', root), { recursive: true });
for (const [file, name] of selections) {
  const dataUrl = `https://mtgjson.com/api/v5/decks/${file}.json`;
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const raw = await response.json();
  await writeFile(new URL(`.cache/precons/${file}.json`, root), JSON.stringify(raw));
  const deck = raw.data;
  const id = `precon-${deck.code.toLowerCase()}-${name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-')}`;
  const entries = [];
  for (const [role, board] of [['commander', deck.commander], ['library', deck.mainBoard]]) {
    for (const card of board) {
      // MTGJSON can include separate faces; these products only contain normal/split cards.
      const existing = entries.find(entry => entry.name === card.name && entry.role === role);
      if (existing) existing.quantity += card.count;
      else entries.push({ name: card.name, quantity: card.count, role });
      if (!cards.has(card.name)) {
        const cardId = card.identifiers.scryfallId;
        cards.set(card.name, { id: cardId, oracle_id: card.identifiers.scryfallOracleId ?? cardId,
          name: card.name, layout: card.layout, color_identity: card.colorIdentity,
          keywords: card.keywords ?? [], mana_cost: card.manaCost ?? '', type_line: card.type,
          oracle_text: card.text ?? '', legalities: { commander: card.legalities.commander?.toLowerCase() ?? 'not_legal' },
          ...(card.power ? { power: card.power, toughness: card.toughness } : {}),
          image_uris: { small: `https://cards.scryfall.io/small/front/${cardId}.jpg`, normal: `https://cards.scryfall.io/normal/front/${cardId}.jpg` } });
      }
    }
  }
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  if (total !== 100) throw new Error(`${name}: ${total} cards`);
  catalogue.push({ id, name, setCode: deck.code, edition: editions[deck.code], sourceUrl: sources[deck.code] ?? deck.source,
    dataUrl, version: 1, colors: [...new Set(deck.commander.flatMap(card => card.colorIdentity))], entries });
  hashes[id] = createHash('sha256').update(JSON.stringify(entries.map(e => [e.name, e.quantity, e.role]).sort((a,b) => String(a).localeCompare(String(b))))).digest('hex');
  console.log(`${name}: ${total} cards; ${deck.commander.map(c => c.name).join(' / ')}`);
}
await mkdir(new URL('src/data/', root), { recursive: true });
await writeFile(new URL('src/data/precons.json', root), JSON.stringify(catalogue, null, 2) + '\n');
await writeFile(new URL('tests/fixtures/precon-cards.json', root), JSON.stringify([...cards.values()], null, 2) + '\n');
await writeFile(new URL('tests/fixtures/precon-hashes.json', root), JSON.stringify(hashes, null, 2) + '\n');
console.log(`${catalogue.length} decks, ${cards.size} unique cards`);
