import { expect, test } from '@playwright/test';
import { preconFixtureDecks } from '../tests/fixtures/precons';
import { startLocalDemo } from './navigation';

test('renders shared physical stacks in overview and narrow layouts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    for (const deck of decks) await localRepository.saveDeck(deck);
  }, preconFixtureDecks());
  await startLocalDemo(page);

  const stage = page.locator('.table-stage');
  const stacks = page.locator('.physical-stack');
  await expect(stacks).toHaveCount(4);
  await expect(page.getByRole('button', { name: /Deck de .+ · \d+ cartas/ })).toHaveCount(4);
  await expect(page.locator('.physical-stack-layer')).toHaveCount(16);

  const stackGeometry = await stacks.evaluateAll(elements => elements.map(element => {
    const top = element.querySelector<HTMLElement>('.physical-stack-top')!;
    const box = top.getBoundingClientRect();
    return {
      height: getComputedStyle(top).transform,
      layerCount: element.querySelectorAll('.physical-stack-layer').length,
      sides: element.querySelectorAll('.physical-stack-edge').length,
      x: Math.round(box.x),
      y: Math.round(box.y),
    };
  }));
  expect(stackGeometry.every(stack => stack.layerCount === 4 && stack.sides === 4)).toBe(true);
  expect(new Set(stackGeometry.map(stack => `${stack.x},${stack.y}`)).size).toBeGreaterThan(1);
  expect(await stage.evaluate(element => getComputedStyle(element).getPropertyValue('--deck-southWest-tilt-x'))).toBe('');

  await page.screenshot({ path: testInfo.outputPath('stacks-overview-desktop.png'), fullPage: false });
  const cameraScene = page.locator('.camera-scene');
  const seatTransform = await cameraScene.evaluate(element => getComputedStyle(element).transform);
  await page.getByTitle('Visão geral', { exact: true }).click();
  await expect.poll(() => cameraScene.evaluate(element => getComputedStyle(element).transform)).not.toBe(seatTransform);
  await page.screenshot({ path: testInfo.outputPath('stacks-overview.png'), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(stacks).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('stacks-narrow.png'), fullPage: false });
});
