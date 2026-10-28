import { expect, test } from './fixtures';
import { preconFixtureDecks } from '../tests/fixtures/precons';

for (const width of [1280, 390]) test(`solo lobby and seat switching at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    for (const deck of decks) await localRepository.saveDeck(deck);
    await localRepository.setPreference('player-name', 'Lia');
    await localRepository.setPreference('selected-deck-id', decks[0].id);
    await localRepository.setPreference('hide-table-tutorial', true);
    await localRepository.setPreference('playmat-id', 'dimir');
  }, preconFixtureDecks());
  await page.reload();
  await page.getByRole('button', { name: 'SOLO', exact: true }).click();
  const start = page.getByRole('button', { name: /Iniciar partida/ });
  await expect(start).toBeDisabled();
  for (let i = 0; i < 2; i++) {
    await page.locator('.solo-seat').nth(i).getByRole('button', { name: 'Escolher deck' }).click();
    await page.locator('.starter-card').first().getByRole('button', { name: /^Escolher / }).click();
    await expect(page.locator('.solo-seat').nth(i).getByRole('button', { name: 'Trocar deck' })).toBeVisible();
  }
  await expect(start).toBeEnabled();
  await start.click();
  const control = page.getByRole('combobox', { name: 'SOLO · Controlando' });
  await expect(control).toBeVisible();
  const first = await control.inputValue();
  await page.getByRole('button', { name: 'Manter mão' }).click();
  await expect(control).not.toHaveValue(first);
  await page.waitForTimeout(700);
  const animated = await control.evaluate(async (select: HTMLSelectElement, target) => {
    select.value = target;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const scene = document.querySelector<HTMLElement>('.camera-scene')!;
    const frames: string[] = [];
    const started = performance.now();
    await new Promise<void>(resolve => {
      const frame = () => { frames.push(scene.style.transform); if (performance.now() - started < 750) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
    return new Set(frames).size;
  }, first);
  expect(animated).toBeGreaterThan(3);
  await expect(control).toHaveValue(first);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const other = await control.locator('option').evaluateAll((options, selected) => (options as HTMLOptionElement[]).find(option => option.value !== selected)!.value, first);
  const reduced = await control.evaluate(async (select: HTMLSelectElement, target) => {
    select.value = target;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const scene = document.querySelector<HTMLElement>('.camera-scene')!;
    const frames: string[] = [];
    await new Promise<void>(resolve => {
      const frame = () => { frames.push(scene.style.transform); if (frames.length < 8) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
    return new Set(frames.slice(1)).size;
  }, other);
  expect(reduced).toBe(1);
  await page.locator('button[title="Visão geral"]').click();
  const firstPlace = page.locator(`.seat-place[data-seat="${first}"]`);
  await firstPlace.locator('button.seat-life-reading').click();
  await expect(control).toHaveValue(first);
  const otherPlace = page.locator(`.seat-place[data-seat="${other}"]`);
  await page.locator('button[title="Visão geral"]').click();
  await otherPlace.locator('button.seat-nameplate').click();
  await expect(control).toHaveValue(other);
  await firstPlace.locator('button.seat-life-reading').focus();
  await page.keyboard.press('Enter');
  await expect(control).toHaveValue(first);
  await control.selectOption(other);
  const choosePlaymat = async (name: string) => {
    await page.getByRole('button', { name: 'Personalizar playmat' }).click();
    await page.locator('.playmat-choice').filter({ hasText: name }).click();
    await page.getByRole('button', { name: 'Aplicar playmat' }).click();
  };
  await choosePlaymat('Azorius');
  await expect(page.locator(`.seat-place[data-seat="${other}"] .playmat-art`)).toHaveCount(1);
  await control.selectOption(first);
  await choosePlaymat('Boros');
  await expect(page.locator(`.seat-place[data-seat="${first}"] .playmat-art`)).toHaveCount(1);
  await control.selectOption(other);
  await page.getByRole('button', { name: 'Personalizar playmat' }).click();
  await expect(page.locator('.playmat-choice.selected')).toContainText('Azorius');
  await page.getByRole('dialog', { name: 'Personalizar playmat' }).getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.locator(`.seat-place[data-seat="${first}"] .playmat-art`)).toHaveCount(1);
  await page.getByRole('button', { name: /^Aumentar vida de / }).click({ force: true });
  await expect(page.locator(`.seat-place[data-seat="${other}"] .seat-life-value`)).toHaveText('41');
  expect(await page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.getPreference('playmat-id'))).toBe('dimir');
  await page.getByRole('button', { name: /sair/i }).click();
  await expect(page.getByRole('button', { name: 'SOLO', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.getPreference('selected-deck-id'))).toBe(preconFixtureDecks()[0].id);
  await page.reload();
  await page.getByRole('button', { name: 'SOLO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Continuar partida solo?' })).toBeVisible();
  await page.getByRole('button', { name: 'Começar nova partida' }).click();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.getByRole('button', { name: 'SOLO', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar partida' }).click();
  await expect(control).toHaveValue(other);
  await expect(page.locator(`.seat-place[data-seat="${other}"] .seat-life-value`)).toHaveText('41');
  await expect(page.locator(`.seat-place[data-seat="${first}"] .playmat-art`)).toHaveCount(1);
  await expect(page.locator(`.seat-place[data-seat="${other}"] .playmat-art`)).toHaveCount(1);
  if (width === 1280) {
    const previousId = await page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.getPreference<any>('solo-match').then(saved => saved.state.id));
    await page.getByRole('button', { name: /sair/i }).click();
    await page.getByRole('button', { name: 'SOLO', exact: true }).click();
    await page.getByRole('button', { name: 'Começar nova partida' }).click();
    for (let i = 0; i < 2; i++) {
      await page.locator('.solo-seat').nth(i).getByRole('button', { name: 'Escolher deck' }).click();
      await page.locator('.starter-card').first().getByRole('button', { name: /^Escolher / }).click();
    }
    await page.getByRole('button', { name: /Iniciar partida/ }).click();
    await expect(page.getByRole('combobox', { name: 'SOLO · Controlando' })).toBeVisible();
    const newId = await page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.getPreference<any>('solo-match').then(saved => saved.state.id));
    expect(newId).not.toBe(previousId);
  }
});

test('reveals and hides an opponent hand from its context menu while playing solo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    for (const deck of decks) await localRepository.saveDeck(deck);
    await localRepository.setPreference('player-name', 'Lia');
    await localRepository.setPreference('selected-deck-id', decks[0].id);
    await localRepository.setPreference('hide-table-tutorial', true);
  }, preconFixtureDecks());
  await page.reload();
  await page.getByRole('button', { name: 'SOLO', exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.locator('.solo-seat').nth(i).getByRole('button', { name: 'Escolher deck' }).click();
    await page.locator('.starter-card').first().getByRole('button', { name: /^Escolher / }).click();
  }
  await page.getByRole('button', { name: /Iniciar partida/ }).click();
  const hand = page.locator('.opponent-hand').first();
  await hand.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Revelar mão', exact: true }).click();
  const revealed = page.locator('.revealed-hand');
  await expect(revealed).toBeVisible();
  await expect(revealed.locator('.revealed-hand-cards > button')).toHaveCount(7);
  await hand.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ocultar mão', exact: true }).click();
  await expect(revealed).toHaveCount(0);
});
