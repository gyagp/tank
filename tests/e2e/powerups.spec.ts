import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('a player can collect and fire the new opening lightning weapon', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /快速出击/ }).click();
  await expect(page.locator('.tank-label.self')).toBeVisible();
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(650);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyS');
  await expect(page.locator('.weapon-slot')).toContainText('雷霆电弧');
  await page.mouse.move(1050, 480);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/lightning-combat.png' });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('all advanced effects render together within a bounded draw budget', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const load = (url: string) => import(/* @vite-ignore */ url);
    const { Arena } = (await load('/shared/engine.ts')) as typeof import('../../shared/engine');
    const { ArenaRenderer } = (await load(
      '/src/game/renderer.ts',
    )) as typeof import('../../src/game/renderer');
    const { GameAudio } = (await load(
      '/src/game/audio.ts',
    )) as typeof import('../../src/game/audio');
    document.getElementById('root')!.style.display = 'none';
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0';
    document.body.appendChild(container);
    const colors = [0xef6a3b, 0x54c9c3, 0xabb863, 0xc291e3, 0x6caff1, 0xe8b947, 0xe375a8, 0xd1d7ca];
    const game = new Arena(
      colors.map((color, i) => ({
        id: `p${i}`,
        name: `FX ${i}`,
        bot: false,
        classId: 'vanguard' as const,
        color,
      })),
      { map: 'arctic', difficulty: 'normal', goal: 50, duration: 180 },
    );
    game.state.time = 3;
    game.state.obstacles = [];
    game.state.pickups = [];
    const weapons = [
      'gravity',
      'orbital',
      'lightning',
      'cluster',
      'ricochet',
      'gravity',
      'orbital',
      'lightning',
    ] as const;
    game.state.tanks.forEach((t, i) => {
      Object.assign(t, {
        x: Math.sin((i * Math.PI) / 4) * 6.5,
        z: Math.cos((i * Math.PI) / 4) * 6.5,
        hp: 10000,
        maxHp: 10000,
        invulnerableUntil: 0,
      });
      game.applyPickup(t, weapons[i]);
      game.inputs.set(t.id, {
        x: 0,
        z: 0,
        angle: Math.atan2(-t.x, -t.z),
        fire: true,
        dash: false,
        mine: false,
      });
    });
    const sound = new GameAudio();
    sound.muted = true;
    const visual = new ArenaRenderer(container, 'arctic', 'p0', sound);
    visual.update(game.state);
    let tick = 0;
    const clock = setInterval(() => {
      game.step(1 / 30);
      if (++tick % 30 === 0) game.applyPickup(game.state.tanks[0], 'frost');
      if (tick % 2 === 0) visual.update(game.state);
    }, 1000 / 30);
    (window as any).__powerupFixture = { game, visual, clock, sound };
  });
  await page.waitForTimeout(3200);
  const report = await page.evaluate(() => {
    const { game, visual } = (window as any).__powerupFixture;
    return {
      fields: game.state.fields.length,
      events: [...new Set(game.state.events.map((e: any) => e.type))],
      calls: visual.renderer.info.render.calls,
      bullets: game.state.bullets.length,
    };
  });
  expect(report.fields).toBeGreaterThan(0);
  expect(report.fields).toBeLessThanOrEqual(8);
  expect(report.bullets).toBeLessThanOrEqual(256);
  expect(report.events).toContain('arc');
  expect(report.events).toContain('strike');
  expect(report.events).toContain('frost');
  expect(report.calls).toBeLessThan(500);
  await writeFile('test-results/powerups-budget.json', JSON.stringify(report, null, 2));
  await page.screenshot({ path: 'test-results/advanced-effects.png' });
  await page.evaluate(() => {
    const fixture = (window as any).__powerupFixture;
    clearInterval(fixture.clock);
    fixture.visual.destroy();
    fixture.sound.destroy();
  });
  expect(errors).toEqual([]);
});
