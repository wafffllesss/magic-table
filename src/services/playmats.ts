export const PLAYMAT_SOURCE = 'https://magic.wizards.com/en/news/feature/lost-wallpapers-2012-12-06';

export const PLAYMATS = [
  { id: 'azorius', name: 'Azorius' },
  { id: 'orzhov', name: 'Orzhov' },
  { id: 'dimir', name: 'Dimir' },
  { id: 'izzet', name: 'Izzet' },
  { id: 'rakdos', name: 'Rakdos' },
  { id: 'golgari', name: 'Golgari' },
  { id: 'gruul', name: 'Gruul' },
  { id: 'boros', name: 'Boros' },
  { id: 'selesnya', name: 'Selesnya' },
].map(({ id, name }) => ({ id, name, image: `/playmats/${id}.webp`, thumbnail: `/playmats/${id}-thumb.webp`, source: PLAYMAT_SOURCE }));

export function validPlaymatId(id: string | undefined): string | undefined {
  if (!id || id.length > 2048) return undefined;
  if (PLAYMATS.some(playmat => playmat.id === id) || /^color:#[0-9a-f]{6}$/i.test(id)) return id;
  if (/^image:https?:\/\/\S+$/i.test(id)) {
    try { const url = new URL(id.slice(6)); if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) return id; } catch { /* Invalid URL. */ }
  }
  return undefined;
}

export function playmatImage(id: string | undefined): string | undefined {
  return PLAYMATS.find(playmat => playmat.id === id)?.image;
}

export function playmatColor(id: string | undefined): string | undefined { return validPlaymatId(id)?.startsWith('color:') ? id!.slice(6) : undefined; }
export function playmatCustomImage(id: string | undefined): string | undefined { return validPlaymatId(id)?.startsWith('image:') ? id!.slice(6) : undefined; }
