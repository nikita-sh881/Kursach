import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'live.spec.ts', timeout: 360000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/live' }]],
  use: { baseURL: process.env.LIVE_BASE_URL || 'http://127.0.0.1:8080', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'live-chromium', use: { ...devices['Desktop Chrome'] } }],
});
