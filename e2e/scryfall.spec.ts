import { openLibrary, startLocalDemo } from './navigation';
import { expect, test, imageBytes } from './fixtures';
import { apiCards, commanders, fixtureDecks } from '../tests/fixtures/scryfall';
import { preconCards } from '../tests/fixtures/precons';
const nahiri = preconCards.find(card => card.name === 'Nahiri, the Lithomancer')!;

test('loads real-shaped decks once and reuses metadata and displayed images after reload without Scryfall', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await startLocalDemo(page);
  await expect(page.locator('.player-mat')).toHaveCount(4, { timeout: 60_000 });
  const art = page.getByRole('button', { name: `Comandante: ${nahiri.name}`, exact: true }).locator('.card-tile > img');
  await expect(art).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });
  await expect.poll(() => art.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  const saved = await page.evaluate(async () => {
    const { localRepository } = await import('/src/services/storage.ts');
    return localRepository.getDecks();
  });
  expect(saved).toHaveLength(30);
  expect(saved.map(deck => deck.entries.reduce((sum, entry) => sum + entry.quantity, 0))).toEqual(Array(30).fill(100));
  expect(saved.every(deck => deck.precon && deck.commanders.length >= 1 && deck.commanders.length <= 2)).toBe(true);
  let apiRequests = 0; const cachedImageRequests: string[] = [];
  await page.route('https://api.scryfall.com/**', route => { apiRequests++; return route.abort('failed'); });
  await page.route('https://cards.scryfall.io/**', route => {
    if (route.request().url() === nahiri.image_uris!.small) cachedImageRequests.push(route.request().url());
    return route.abort('failed');
  });
  await page.reload();
  await startLocalDemo(page);
  await expect(page.locator('.player-mat')).toHaveCount(4);
  await expect(art).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => art.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  expect(apiRequests).toBe(0);
  expect(cachedImageRequests).toEqual([]);
});

test('keeps deck selection available after a loading error and allows retry', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('https://api.scryfall.com/**', route => route.abort('failed'));
  await page.goto('/'); await openLibrary(page);
  await expect(page.locator('.workshop-notice')).toBeVisible();
  await expect(page.locator('.player-mat')).toHaveCount(0);
  await page.unroute('https://api.scryfall.com/**');
  await page.route('https://api.scryfall.com/**', async route => {
    const names = route.request().postDataJSON().identifiers.map((item: { name: string }) => item.name);
    await route.fulfill({ json: { data: names.map(name => preconCards.find(card => card.name === name)).filter(Boolean), not_found: [], has_more: false } });
  });
  await page.getByRole('button', { name: /Carregar 30 precons/ }).click();
  await expect(page.locator('.starter-card')).toHaveCount(30, { timeout: 60_000 });
  await startLocalDemo(page);
});

test('search previews use stored blobs and distinguishes no results and unresolved import names', async ({ page }) => {
  await page.goto('/');
  await openLibrary(page);
  await page.getByRole('tab', { name: 'Criar deck' }).click();
  await page.getByLabel('BUSCAR CARTAS').fill('Fixture');
  await expect(page.locator('.search-result-art img').first()).toHaveAttribute('src', /^blob:/, { timeout: 10_000 });
  await page.getByLabel('BUSCAR CARTAS').fill('no-such-card');
  await expect(page.getByText('Nenhuma carta encontrada com este termo.')).toBeVisible();
  await page.getByRole('tab', { name: 'Importar' }).click();
  const list = `Commander:\n1 ${commanders[0].name}\n\nDeck:\n35 Plains\n${Array.from({ length: 64 }, (_, i) => `1 Missing card ${i + 1}`).join('\n')}`;
  await page.getByLabel('SUA LISTA').fill(list);
  await page.getByRole('button', { name: 'Salvar e conferir' }).click();
  await expect(page.locator('.workshop-problems')).toContainText('Cartas não encontradas no Scryfall: Missing card 1');
});

test('manual refresh preserves deck printing IDs and changes the image source only after success', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const initialDeck = fixtureDecks()[0];
  // Use a small saved list here to isolate refresh behavior from Commander list generation.
  initialDeck.id = 'personal-deck'; initialDeck.entries = initialDeck.entries.slice(0, 2);
  await page.evaluate(async deck => {
    const { localRepository } = await import('/src/services/storage.ts');
    await localRepository.saveDeck(deck);
  }, initialDeck);
  await page.reload();
  await openLibrary(page);
  await expect(page.locator('.starter-card')).toHaveCount(1);
  const requestedIds: string[] = [];
  await page.route('https://api.scryfall.com/cards/*', async route => {
    const identifiers = route.request().postDataJSON().identifiers as { id: string }[];
    requestedIds.push(...identifiers.map(identifier => identifier.id));
    const cards = identifiers.map(({ id }) => apiCards.find(item => item.id === id)!);
    await route.fulfill({ json: { data: cards.map(card => ({ ...card, oracle_text: 'Updated rules.', image_uris: { small: `${card.image_uris!.small}?updated`, normal: `${card.image_uris!.normal}?updated` } })) } });
  });
  await page.locator('.starter-card').filter({ hasText: initialDeck.name }).getByRole('button', { name: /Detalhes de/ }).click();
  await page.getByRole('button', { name: 'Atualizar dados das cartas' }).click();
  await expect(page.getByText('Dados das cartas atualizados. A composição do deck foi mantida.')).toBeVisible();
  expect(requestedIds).toEqual(initialDeck.entries.map(entry => entry.cardId));
  const updated = await page.evaluate(async () => {
    const { localRepository } = await import('/src/services/storage.ts');
    return (await localRepository.getDecks())[0];
  });
  expect(updated.entries.map(entry => [entry.cardId, entry.quantity, entry.role])).toEqual(initialDeck.entries.map(entry => [entry.cardId, entry.quantity, entry.role]));
  expect(updated.entries[0].card?.image_uris?.small).toContain('?updated');
  await page.route('https://api.scryfall.com/**', route => route.abort('failed'));
  await page.getByRole('button', { name: 'Atualizar dados das cartas' }).click();
  await expect(page.locator('.workshop-problems')).toContainText('O deck salvo foi mantido.');
});

test('reports session-only storage when IndexedDB is unavailable', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
  await page.goto('/');
  await expect(page.locator('.storage-warning')).toContainText('somente em memória');
  await startLocalDemo(page);
  await expect(page.locator('.player-mat')).toHaveCount(4);
});

test('updates face images, releases object URLs and avoids downloading facedown cards', async ({ page }) => {
  await page.goto('/');
  const component = await (await page.request.get('/src/components/CardTile.vue')).text();
  const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
  expect(runtime).toBeTruthy();
  const images: string[] = [];
  await page.route('https://cards.scryfall.io/**', route => { images.push(route.request().url()); return route.fulfill({ contentType: 'image/png', body: imageBytes }); });
  await page.evaluate(async runtime => {
    const { createApp, h, ref } = await import(runtime!);
    const { default: CardTile } = await import('/src/components/CardTile.vue');
    const card = ref({ id: 'face-instance', cardId: 'face-card', face: 0, faceDown: true, card: { id: 'face-card', name: 'Front // Back', layout: 'transform', card_faces: [
      { name: 'Front', image_uris: { small: 'https://cards.scryfall.io/face-front.jpg' } },
      { name: 'Back', image_uris: { small: 'https://cards.scryfall.io/face-back.jpg' } },
    ] } });
    const host = document.createElement('div'); host.id = 'faces-test'; document.body.append(host);
    const app = createApp({ setup: () => () => h(CardTile, { card: card.value, compact: true }) }); app.mount(host);
    Object.assign(window, { faceTest: { card, unmount: () => app.unmount() } });
  }, runtime);
  expect(images).toEqual([]);
  await page.evaluate(() => { (window as any).faceTest.card.value.faceDown = false; });
  const image = page.locator('#faces-test img');
  await expect(image).toHaveAttribute('src', /^blob:/);
  const firstUrl = await image.getAttribute('src');
  await page.evaluate(() => { (window as any).faceTest.card.value.face = 1; });
  await expect.poll(() => image.getAttribute('src')).not.toBe(firstUrl);
  await expect(image).toHaveAttribute('src', /^blob:/);
  expect(images).toEqual(['https://cards.scryfall.io/face-front.jpg', 'https://cards.scryfall.io/face-back.jpg']);
  expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, firstUrl)).toBe(true);
  await page.evaluate(() => { (window as any).faceTest.unmount(); });
});
