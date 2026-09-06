import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      channel:
        process.env.CI || process.env.PLAYWRIGHT_BROWSER === 'chromium' ? undefined : 'msedge',
      args:
        process.env.CI || process.env.PLAYWRIGHT_SOFTWARE === '1'
          ? ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
          : [],
    },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 60000,
      },
});
