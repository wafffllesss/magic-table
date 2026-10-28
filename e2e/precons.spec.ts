import { openLibrary, startLocalDemo } from './navigation';
import { expect, test } from './fixtures';
import { preconCards, preconFixtureDecks } from '../tests/fixtures/precons';
import { fixtureDecks } from '../tests/fixtures/scryfall';
import { LEGACY_STARTER_IDS, PRECONS } from '../src/services/precons';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`shows and selects all 30 official precons at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(async decks => {
      const { localRepository } = await import('/src/services/storage.ts');
      for (const deck of decks) await localRepository.saveDeck(deck);
    }, preconFixtureDecks());
    await page.reload();
    await openLibrary(page);
    await expect(page.locator('.starter-card')).toHaveCount(30);
    await expect(page.locator('.starter-card button:disabled')).toHaveCount(0);
    for (const precon of PRECONS) {
      await expect(page.locator('.starter-card').filter({ hasText: precon.name })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('catalogue.png'), fullPage: true });
    const dragon = page.locator('.starter-card').filter({ hasText: 'Draconic Domination' });
    await dragon.scrollIntoViewIfNeeded();
    await dragon.getByRole('button', { name: /Detalhes de/ }).click();
    await expect(page.getByRole('heading', { name: 'Draconic Domination', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /FONTE OFICIAL/ })).toHaveAttribute('href', PRECONS[13].sourceUrl);
    await page.getByRole('button', { name: /Usar este deck/ }).click();
    await expect(page.locator('.profile-deck').filter({ hasText: 'Draconic Domination' })).toBeVisible();
  });
}

test('migrates the four old starters offline while preserving cached precons and personal decks', async ({ page }) => {
  await page.goto('/');
  const personal = { ...fixtureDecks()[0], id: 'personal-keep', name: 'Meu deck pessoal' };
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    for (const deck of decks) await localRepository.saveDeck(deck);
  }, [...fixtureDecks(), ...preconFixtureDecks(), personal]);
  let requests = 0;
  await page.route('https://api.scryfall.com/**', route => { requests++; return route.abort('failed'); });
  await page.reload();
  await openLibrary(page);
  await expect(page.locator('.starter-card')).toHaveCount(31);
  await expect(page.locator('.starter-card button:disabled')).toHaveCount(0);
  const ids = await page.evaluate(async () => {
    const { localRepository } = await import('/src/services/storage.ts');
    return (await localRepository.getDecks()).map(deck => deck.id);
  });
  for (const id of LEGACY_STARTER_IDS) expect(ids).not.toContain(id);
  expect(ids).toContain('personal-keep');
  expect(requests).toBe(0);
});

test('filters personal and official lists by all selected commander colors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const personal = { ...fixtureDecks()[0], id: 'personal-white', name: 'Meu deck branco' };
  await page.goto('/');
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    for (const deck of decks) await localRepository.saveDeck(deck);
  }, [...preconFixtureDecks(), personal]);
  await page.reload();
  await openLibrary(page);
  await expect(page.locator('.starter-card')).toHaveCount(31);
  const whiteDecks = PRECONS.filter(deck => deck.colors.includes('W')).length + 1;
  const filter = page.getByRole('group', { name: 'Filtrar decks por identidade de cores' });
  await filter.getByRole('button', { name: 'Branco', exact: true }).click();
  await expect(page.locator('.starter-card')).toHaveCount(whiteDecks);
  await expect(page.locator('.starter-card').filter({ hasText: 'Meu deck branco' })).toHaveCount(1);
  await filter.getByRole('button', { name: 'Azul', exact: true }).click();
  const whiteBlueDecks = PRECONS.filter(deck => deck.colors.includes('W') && deck.colors.includes('U')).length;
  await expect(page.locator('.starter-card')).toHaveCount(whiteBlueDecks);
  await expect(page.locator('.deck-color-filter-count')).toHaveText(`${whiteBlueDecks} de 31 decks`);
  await filter.getByRole('button', { name: 'Limpar filtro' }).click();
  await expect(page.locator('.starter-card')).toHaveCount(31);
});

test('shows an empty filter state and lets the player clear it', async ({ page }) => {
  await page.route('https://api.scryfall.com/**', route => route.abort('failed'));
  const personal = { ...fixtureDecks()[0], id: 'personal-white-only', name: 'Meu deck branco' };
  await page.goto('/');
  await page.evaluate(async deck => {
    const { localRepository } = await import('/src/services/storage.ts');
    await localRepository.saveDeck(deck);
  }, personal);
  await openLibrary(page);
  await expect(page.locator('.starter-card')).toHaveCount(1);
  await page.getByRole('group', { name: 'Filtrar decks por identidade de cores' }).getByRole('button', { name: 'Azul', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum deck com essas cores.' })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtro', exact: true }).last().click();
  await expect(page.locator('.starter-card')).toHaveCount(1);
});

test('offers a retry after a partial load and retains the completed precon', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('https://api.scryfall.com/cards/collection', async route => {
    const names = route.request().postDataJSON().identifiers.map((item: { name: string }) => item.name);
    if (names.includes('Teferi, Temporal Archmage')) return route.abort('failed');
    return route.fallback();
  });
  await page.goto('/');
  await openLibrary(page);
  await expect(page.locator('.starter-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Carregar mais decks' })).toBeEnabled();
  await expect(page.locator('.workshop-notice')).toContainText('Peer Through Time');
  await page.unroute('https://api.scryfall.com/cards/collection');
  await page.route('https://api.scryfall.com/cards/collection', async route => {
    const names = route.request().postDataJSON().identifiers.map((item: { name: string }) => item.name);
    const cards = names.map(name => preconCards.find(card => card.name === name)).filter(Boolean);
    await route.fulfill({ json: { data: cards } });
  });
  await page.getByRole('button', { name: 'Carregar mais decks' }).click();
  await expect(page.locator('.starter-card')).toHaveCount(30, { timeout: 60_000 });
  await expect(page.locator('.starter-card button:disabled')).toHaveCount(0);
});
