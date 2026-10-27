import { startLocalDemo } from './navigation';
import { expect, test } from './fixtures';

test.use({ locale: 'pt-BR', hasTouch: true });

test('selects a creature token from its type column on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://api.scryfall.com/cards/search**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (!query.includes('t:token')) { await route.fallback(); return; }
    if (query.includes('no-match-token')) { await route.fulfill({ status: 404, json: { object: 'error' } }); return; }
    if (query.includes('offline-token')) { await route.fulfill({ status: 500, json: { object: 'error' } }); return; }
    await route.fulfill({ json: { data: [{
      id: 'scryfall-wolf-token', oracle_id: 'oracle-wolf-token', name: 'Lobo 2/2', layout: 'token',
      color_identity: ['G'], keywords: [], mana_cost: '', type_line: 'Token Creature — Wolf', oracle_text: '',
      power: '2', toughness: '2', legalities: {}, image_uris: { small: 'https://cards.scryfall.io/small/front/token.jpg' },
    }], has_more: false } });
  });
  await page.goto('/');
  await startLocalDemo(page);

  const opener = page.getByRole('button', { name: /Criar ficha/ });
  await opener.tap();
  const dialog = page.getByRole('dialog', { name: 'Escolha uma ficha de criatura.' });
  const input = dialog.getByRole('searchbox');
  await expect(input).toBeFocused();
  await dialog.getByRole('checkbox', { name: 'Somente fichas do deck' }).uncheck();
  await expect(dialog.locator('.library-type-heading h3')).toHaveText(['Wolf']);
  const geometry = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, bottom: rect.bottom, width: window.innerWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.bottom).toBeLessThanOrEqual(844);

  await input.fill('no-match-token');
  await expect(dialog.locator('.library-no-results')).toContainText('Nenhuma ficha de criatura encontrada');
  await input.fill('offline-token');
  await expect(dialog.getByRole('alert')).toContainText('Não foi possível conectar ao Scryfall');
  await input.fill('');
  await expect(dialog.locator('.library-type-heading h3')).toHaveText(['Wolf']);

  await dialog.getByRole('button', { name: 'Criar Lobo 2/2' }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.player-mat.is-self .board-card-wrap[aria-label="Lobo 2/2"]')).toHaveCount(1);
  await expect(opener).toBeFocused();
});
