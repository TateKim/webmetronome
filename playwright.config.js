// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3456',
    headless: true,
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npx serve src -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
