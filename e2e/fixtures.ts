import { test as base, expect } from '@playwright/test';
import { apiCards, findFixture, spells } from '../tests/fixtures/scryfall';

export const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2foAAAAASUVORK5CYII=', 'base64');

export const test = base.extend<{ scryfall: void }>({
  scryfall: [async ({ page }, use) => {
    await page.route('https://api.scryfall.com/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let body: unknown;
      if (path === '/cards/collection') {
        const identifiers = request.postDataJSON().identifiers as { id?: string; name?: string }[];
        body = { data: identifiers.map(findFixture).filter(Boolean), not_found: identifiers.filter(identifier => !findFixture(identifier)), has_more: false };
      } else if (path === '/cards/search') {
        const query = new URL(request.url()).searchParams.get('q') ?? '';
        if (query.includes('no-such-card')) { await route.fulfill({ status: 404, json: { object: 'error' } }); return; }
        body = { data: spells, has_more: false };
      } else {
        body = apiCards.find(card => path === `/cards/${card.id}`);
        if (!body) { await route.fulfill({ status: 404, json: { object: 'error' } }); return; }
      }
      await route.fulfill({ json: body });
    });
    await page.route('https://cards.scryfall.io/**', route => route.fulfill({ contentType: 'image/png', body: imageBytes }));
    await use();
  }, { auto: true }],
});

export { expect };
