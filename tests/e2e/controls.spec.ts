import { expect, test } from '@playwright/test';
import type { InputState } from '../../shared/types';

test('larger text, aim-assist toggle, mixed fire inputs, right-click dash and focus reset', async ({
  page,
}) => {
  const packets: InputState[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (ws) =>
    ws.on('framesent', (frame) => {
      try {
        const payload = String(frame.payload);
        if (!payload.startsWith('42[')) return;
        const [event, input] = JSON.parse(payload.slice(2));
        if (event === 'input') packets.push(input);
      } catch {}
    }),
  );
  await page.goto('/');
  await expect(page.getByText('作战网络已连接')).toBeVisible();
  expect(
    await page.locator('.page-intro p').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /快速出击/ }).click();
  await expect(page.locator('.tank-label.self')).toBeVisible();
  const assist = page.getByRole('button', { name: '辅助瞄准', exact: true });
  await expect(assist).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('KeyQ');
  await expect(assist).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.down('Space');
  await page.mouse.move(900, 500);
  await page.mouse.down();
  const beforeRelease = packets.length;
  await page.mouse.up();
  await expect.poll(() => packets.length > beforeRelease && packets.at(-1)?.fire).toBe(true);
  await page.keyboard.up('Space');
  await expect.poll(() => packets.at(-1)?.fire).toBe(false);
  await page.keyboard.down('KeyD');
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.ability.cooling')).toBeVisible();
  await expect.poll(() => packets.some((p) => p.dash && p.x === 1)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect
    .poll(() => ({ x: packets.at(-1)?.x, z: packets.at(-1)?.z, fire: packets.at(-1)?.fire }))
    .toEqual({ x: 0, z: 0, fire: false });
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '战场手册' })).toBeVisible();
  await expect(page.locator('.control-manual')).toContainText('辅助瞄准');
  await page.getByRole('button', { name: '离开对战' }).click();
  expect(errors).toEqual([]);
});
