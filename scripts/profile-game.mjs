import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const software = process.argv.includes('--software');
const name = process.argv.find((arg) => arg.startsWith('--name='))?.slice(7) || 'profile';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  args: software ? ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] : [],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const profile = { frames: [], calls: [], draws: 0, active: false, previous: 0, longTasks: 0 };
    window.__gameProfile = profile;
    for (const name of [
      'drawElements',
      'drawArrays',
      'drawElementsInstanced',
      'drawArraysInstanced',
    ]) {
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        if (profile.active) profile.draws++;
        return original.apply(this, args);
      };
    }
    new PerformanceObserver((list) => {
      if (profile.active) profile.longTasks += list.getEntries().length;
    }).observe({ type: 'longtask', buffered: false });
    const sample = (now) => {
      if (profile.active && profile.previous) {
        profile.frames.push(now - profile.previous);
        profile.calls.push(profile.draws);
      }
      profile.draws = 0;
      profile.previous = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: /快速出击/ }).click();
  await page.locator('.tank-label.self').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__gameProfile.active = true;
  });
  await page.keyboard.down('KeyD');
  await page.mouse.move(1050, 450);
  await page.mouse.down();
  await page.waitForTimeout(6000);
  await page.keyboard.up('KeyD');
  await page.mouse.up();
  const result = await page.evaluate(() => {
    const p = window.__gameProfile;
    p.active = false;
    const values = p.frames.sort((a, b) => a - b);
    const canvas =
      document.querySelector(
        '.battle-viewport canvas[data-renderer]:not([style*="display: none"])',
      ) || document.querySelector('.battle-viewport canvas');
    const gl = canvas.dataset.renderer === 'canvas' ? null : canvas.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      gpu:
        canvas.dataset.gpu ||
        (debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable'),
      renderMode: canvas.dataset.renderer || 'webgl',
      frames: values.length,
      renderScale: canvas.width / canvas.clientWidth,
      fps: +((1000 * values.length) / values.reduce((a, b) => a + b, 0)).toFixed(1),
      frameP50: values[Math.floor(values.length * 0.5)],
      frameP95: values[Math.floor(values.length * 0.95)],
      averageDrawCalls: Math.round(p.calls.reduce((a, b) => a + b, 0) / p.calls.length),
      longTasks: p.longTasks,
    };
  });
  await mkdir('test-results/performance', { recursive: true });
  result.errors = errors;
  if (errors.length) process.exitCode = 1;
  await writeFile(`test-results/performance/${name}.json`, JSON.stringify(result, null, 2));
  await page.screenshot({ path: `test-results/performance/${name}.png` });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
