import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('control mode, fixed room, tactical keyboard skills and host mode selection', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /据点争夺/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page.getByTestId('room-code')).toHaveText('12345');
  await expect(page.getByLabel('房间作战模式')).toHaveValue('control');
  await page.getByLabel('房间作战模式').selectOption('deathmatch');
  await expect(page.getByLabel('目标击毁')).toBeEnabled();
  await page.getByLabel('房间作战模式').selectOption('control');
  await expect(page.getByLabel('目标击毁')).toHaveValue('180');
  await page.getByRole('button', { name: /添加电脑对手/ }).click();
  await expect(page.locator('.team-tag')).toHaveCount(2);
  await page.getByRole('button', { name: '开始对战', exact: true }).click();
  await expect(page.getByRole('region', { name: '据点战况' })).toBeVisible();
  await expect(page.locator('.objective-list > div')).toHaveCount(3);
  await page.keyboard.press('KeyF');
  await expect(page.getByRole('button', { name: '烟幕掩护', exact: true })).toBeDisabled();
  await page.keyboard.press('KeyG');
  await expect(page.getByRole('button', { name: '战场侦察', exact: true })).toBeDisabled();
  await expect(page.locator('.recon-active')).toContainText('侦察生效');
  await page.screenshot({ path: 'test-results/tactics-desktop.png' });
  expect(errors).toEqual([]);
});

test('mobile tactical buttons work without covering either joystick', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /快速出击/ }).click();
  const smoke = page.getByRole('button', { name: '烟幕掩护', exact: true }),
    radar = page.getByRole('button', { name: '战场侦察', exact: true });
  await expect(smoke).toBeEnabled();
  await smoke.tap();
  await expect(smoke).toBeDisabled();
  await radar.tap();
  await expect(radar).toBeDisabled();
  const controls = await page.locator('.tactical-commands').boundingBox();
  for (const label of ['移动摇杆', '瞄准射击摇杆']) {
    const stick = await page.getByRole('region', { name: label }).boundingBox();
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(stick!.y);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/tactics-mobile.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('region', { name: '据点战况' })).toBeVisible();
  await page.screenshot({ path: 'test-results/tactics-landscape.png' });
  await context.close();
});

test('24 supply holograms, refill labels, smoke visibility and recon render within budget', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const load = (url: string) => import(/* @vite-ignore */ url);
    const { Arena } = await load('/shared/engine.ts');
    const { ArenaRenderer } = await load('/src/game/renderer.ts');
    const { GameAudio } = await load('/src/game/audio.ts');
    document.getElementById('root')!.style.display = 'none';
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0';
    document.body.appendChild(container);
    const game = new Arena(
      Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        name: String(i),
        bot: false,
        classId: 'vanguard',
        color: 0xef6a3b,
      })),
      { map: 'desert', mode: 'control', difficulty: 'normal', goal: 12, duration: 180 },
    );
    game.state.tanks.forEach((t: any, i: number) =>
      Object.assign(t, { x: (i % 4) * 8 - 12, z: i < 4 ? 0 : 13, invulnerableUntil: 0 }),
    );
    Object.assign(game.state.tanks[0], { x: -4, z: -5 });
    Object.assign(game.state.tanks[1], { x: 0, z: 0 });
    const empty = { x: 0, z: 0, angle: 0, fire: false, mine: false, dash: false };
    game.setInput('1', { ...empty, smoke: true });
    game.setInput('1', empty);
    game.step(1 / 30);
    for (const p of game.state.controlPoints) {
      p.owner = p.id === 'A' ? 'ember' : p.id === 'C' ? 'tide' : null;
    }
    game.state.pickups[0].active = false;
    game.state.pickups[0].respawnAt = 3;
    const sound = new GameAudio();
    sound.muted = true;
    const visual = new ArenaRenderer(container, 'desert', '0', sound);
    visual.camera.left = -31;
    visual.camera.right = 31;
    visual.camera.top = 22;
    visual.camera.bottom = -22;
    visual.camera.updateProjectionMatrix();
    visual.update(game.state);
    (window as any).__tactics = { game, visual, sound, empty };
  });
  await page.waitForTimeout(500);
  const hidden = await page.evaluate(() => {
    const { game, visual } = (window as any).__tactics;
    return {
      supplies: game.state.pickups.length,
      hidden: !visual.tanks.get('1').root.visible,
      labels: [...visual.supplies.models.values()]
        .filter((m: any) => m.label.visible)
        .map((m: any) => m.text),
    };
  });
  expect(hidden.supplies).toBe(24);
  expect(hidden.hidden).toBe(true);
  expect(hidden.labels.some((s: string) => s.includes('补充中'))).toBe(true);
  await page.screenshot({ path: 'test-results/supply-holograms.png' });
  await page.evaluate(() => {
    const { game, visual, empty } = (window as any).__tactics;
    game.setInput('0', { ...empty, radar: true });
    game.setInput('0', empty);
    game.step(1 / 30);
    visual.update(game.state);
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__tactics.visual.tanks.get('1').root.visible))
    .toBe(true);
  // Exercise the populated arena alongside the existing advanced weapon effects.
  await page.evaluate(() => {
    const { game, visual, empty } = (window as any).__tactics;
    game.state.tanks.forEach((t: any, i: number) => {
      t.hp = t.maxHp = 10000;
      game.applyPickup(
        t,
        [
          'gravity',
          'orbital',
          'lightning',
          'cluster',
          'ricochet',
          'gravity',
          'orbital',
          'lightning',
        ][i],
      );
      game.setInput(t.id, { ...empty, angle: Math.atan2(-t.x, -t.z), fire: true });
    });
    (window as any).__tactics.clock = setInterval(() => {
      game.step(1 / 30);
      visual.update(game.state);
    }, 1000 / 30);
  });
  await page.waitForTimeout(2200);
  const report = await page.evaluate(() => {
    const { game, visual } = (window as any).__tactics;
    return {
      supplies: game.state.pickups.length,
      fields: game.state.fields.length,
      tanks: game.state.tanks.length,
      calls: visual.renderer.info.render.calls,
      geometries: visual.renderer.info.memory.geometries,
      textures: visual.renderer.info.memory.textures,
    };
  });
  expect(report.calls).toBeLessThan(500);
  await writeFile('test-results/tactics-budget.json', JSON.stringify(report, null, 2));
  await page.screenshot({ path: 'test-results/tactical-supplies-combat.png' });
  await page.evaluate(() => {
    const f = (window as any).__tactics;
    clearInterval(f.clock);
    f.visual.destroy();
    f.sound.destroy();
  });
  expect(errors).toEqual([]);
});
