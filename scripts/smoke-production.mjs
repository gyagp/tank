import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.argv[2] || 'http://127.0.0.1:3001';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(baseURL);
  await page.getByRole('button', { name: /快速出击/ }).click();
  await page.locator('.tank-label.self').waitFor({ state: 'visible' });
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  await page.mouse.move(900, 500);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '离开对战' }).click();
  await page.getByRole('heading', { name: '准备好，指挥官。' }).waitFor();
  const externalResources = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.startsWith('http') && new URL(name).origin !== location.origin),
  );
  const result = {
    baseURL,
    consoleErrors: errors,
    externalResources,
    passed: errors.length === 0 && externalResources.length === 0,
  };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/production-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
