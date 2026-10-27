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
  return PLAYMATS.some(playmat => playmat.id === id) ? id : undefined;
}

export function playmatImage(id: string | undefined): string | undefined {
  return PLAYMATS.find(playmat => playmat.id === id)?.image;
}
