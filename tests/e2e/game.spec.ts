import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByText('作战网络已连接')).toBeVisible();
  await page.locator('.hero-art').evaluate((image) => (image as HTMLImageElement).decode());
}
test('garage, arsenal, settings and real keyboard combat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.screenshot({ path: 'test-results/garage-desktop.png', fullPage: true });
  await expect(page.getByRole('heading', { name: '准备好，指挥官。' })).toBeVisible();
  await page.getByRole('button', { name: '军械库 ARSENAL' }).click();
  await expect(page.getByRole('heading', { name: '战术补给' })).toBeVisible();
  await expect(page.locator('.pickup-card')).toHaveCount(16);
  await page.getByRole('button', { name: '返回车库', exact: true }).last().click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '减少动态效果' }).click();
  await expect(page.getByRole('switch', { name: '减少动态效果' })).toBeChecked();
  await page.getByRole('button', { name: '完成' }).click();
  await page.getByRole('button', { name: '幽灵', exact: true }).click();
  await page.getByRole('textbox', { name: '你的呼号' }).fill('测试指挥官');
  await page.getByRole('button', { name: /快速出击/ }).click();
  await expect(page.getByTestId('battle-screen')).toBeVisible();
  await expect(page.locator('.tank-label.self')).toBeVisible();
  const start = await page.locator('.tank-label.self').getAttribute('style');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  await expect.poll(() => page.locator('.tank-label.self').getAttribute('style')).not.toBe(start);
  await page.mouse.move(880, 530);
  await page.mouse.down();
  await page.waitForTimeout(1100);
  await page.mouse.up();
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ability')).toContainText(['涡轮冲刺', '×1']);
  await page.screenshot({ path: 'test-results/battle-desktop.png' });
  await page.keyboard.press('Tab'); // release must dismiss the scoreboard
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '战场手册' })).toBeVisible();
  await page.getByRole('button', { name: '离开对战' }).click();
  await expect(page.getByRole('heading', { name: '准备好，指挥官。' })).toBeVisible();
  const external = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .filter((name) => name.startsWith('http') && new URL(name).origin !== location.origin),
  );
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('two browser sessions join the same room and start a shared match', async ({ browser }) => {
  const host = await browser.newPage(),
    guest = await browser.newPage();
  await ready(host);
  await ready(guest);
  await host.getByRole('textbox', { name: '你的呼号' }).fill('房主阿尔法');
  await host.getByRole('button', { name: '创建房间' }).click();
  const code = await host.getByTestId('room-code').textContent();
  expect(code).toBe('12345');
  await host.getByRole('button', { name: /添加电脑对手/ }).click();
  await host.getByRole('combobox', { name: '房间地图' }).selectOption('forest');
  await guest.getByRole('textbox', { name: '你的呼号' }).fill('好友布拉沃');
  await guest.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(guest.getByLabel('房间码', { exact: true })).toHaveValue('12345');
  await guest.getByRole('button', { name: '加入战场' }).click();
  await expect(host.locator('.player-row')).toHaveCount(3);
  await expect(guest.locator('.player-row')).toHaveCount(3);
  await expect(guest.getByRole('combobox', { name: '房间地图' })).toBeDisabled();
  await host.screenshot({ path: 'test-results/room-desktop.png' });
  await host.getByRole('button', { name: '开始对战' }).click();
  await expect(host.getByTestId('battle-screen')).toBeVisible();
  await expect(guest.getByTestId('battle-screen')).toBeVisible();
  await expect(host.locator('.tank-label')).toHaveCount(3);
  await expect(guest.locator('.tank-label')).toHaveCount(3);
  await expect(host.locator('.battle-brand')).toContainText('OVERGROWN');
  await expect(guest.locator('.battle-brand')).toContainText('OVERGROWN');
  await guest.keyboard.down('KeyA');
  await guest.waitForTimeout(650);
  await guest.keyboard.up('KeyA');
  await expect(host.locator('.mini-rank').filter({ hasText: '房主阿尔法' })).toBeVisible();
  await expect(host.locator('.mini-rank').filter({ hasText: '好友布拉沃' })).toBeVisible();
  await guest.close();
  await expect(host.locator('.tank-label')).toHaveCount(2);
  await host.close();
});

test('mobile garage, room errors, touch controls and no horizontal overflow', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /快速出击/ })).toBeEnabled();
  const quickBounds = await page.getByRole('button', { name: /快速出击/ }).boundingBox();
  expect(quickBounds!.y + quickBounds!.height).toBeLessThanOrEqual(844);
  await page.locator('.hero-art').evaluate((image) => (image as HTMLImageElement).decode());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/garage-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '加入房间', exact: true }).click();
  await page.getByLabel('房间码', { exact: true }).fill('ZZZZZ');
  await page.getByRole('button', { name: '加入战场' }).click();
  await expect(page.getByRole('status')).toContainText('房间不存在');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /快速出击/ }).click();
  await expect(page.getByRole('region', { name: '移动摇杆' })).toBeVisible();
  await expect(page.locator('.tank-label.self')).toBeVisible();
  const stick = page.getByRole('region', { name: '移动摇杆' });
  const bounds = await stick.boundingBox();
  const cdp = await context.newCDPSession(page);
  const start = await page.locator('.tank-label.self').getAttribute('style');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2, id: 0 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: bounds!.x + bounds!.width - 8, y: bounds!.y + bounds!.height / 2, id: 0 }],
  });
  await page.waitForTimeout(500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.locator('.tank-label.self').getAttribute('style')).not.toBe(start);
  await page.getByRole('button', { name: '地雷', exact: true }).tap();
  await expect(page.locator('.ability').nth(1)).toContainText('×1');
  await page.getByRole('button', { name: '冲刺', exact: true }).tap();
  await page.screenshot({ path: 'test-results/battle-mobile.png' });
  await page.getByRole('button', { name: '游戏菜单' }).tap();
  await expect(page.getByRole('heading', { name: '战场手册' })).toBeVisible();
  await page.getByRole('button', { name: '离开对战' }).tap();
  expect(errors).toEqual([]);
  await context.close();
});
