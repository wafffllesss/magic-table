import { expect, test } from '@playwright/test';
import { commanders, basics } from '../tests/fixtures/scryfall';
test('keeps the imported deck inspection open when the library updates', async ({ page }) => {
  const component = await (await page.request.get('/src/components/DeckWorkshop.vue')).text();
  const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1];
  await page.route('**/import-review-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><script type="module">
    import { createApp, h, ref } from '${runtime}';
    import DeckWorkshop from '/src/components/DeckWorkshop.vue';
    import { scryfall } from '/src/services/scryfall.ts';
    import { initializeLocale, i18n } from '/src/i18n/index.ts';
    i18n.global.locale.value = 'pt-BR';
    scryfall.resolve = async () => ${JSON.stringify([commanders[0], basics[0]])};
    const decks = ref([]); window.updateDecks = () => { decks.value = []; };
    const app = createApp({ setup: () => () => h(DeckWorkshop, { decks: decks.value }) }); app.use(i18n); app.mount(document.body);
  </script></body></html>` }));
  await page.goto('/import-review-harness');
  await page.getByRole('tab', { name: /import/i }).click();
  await page.getByRole('button', { name: /check list only/i }).click();
  await expect(page.getByRole('button', { name: /back to list/i })).toBeVisible();
  await expect(page.getByText('Commander exige 100 cartas; o deck tem 36.')).toBeVisible();
  await page.evaluate(() => (window as any).updateDecks());
  await expect(page.getByRole('button', { name: /back to list/i })).toBeVisible();
  await expect(page.locator('.deck-inspection-card')).toHaveCount(2);
  await page.getByRole('button', { name: /back to list/i }).click();
  await expect(page.locator('#deck-import')).toBeVisible();
});


