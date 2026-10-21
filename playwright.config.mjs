// Playwright runner for tests/e2e: Chromium as an iPhone (375x667, DPR 2, touch, Safari's user agent)
// against the harness that each test starts itself (tests/e2e/fixtures.mjs), so there is no webServer.
// Chromium is launched without the automation flag (navigator.webdriver stays false, so a real visit is
// not a bot) and with autoplay allowed without a gesture, as a muted playsinline clip is on the phones.
// Never run `playwright install` here: the browser is at PLAYWRIGHT_BROWSERS_PATH.

import { defineConfig } from 'playwright/test';
import { DEFAULT_MOBILE_UA } from './tests/fixtures/user-agents.mjs';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.mjs$/,
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: DEFAULT_MOBILE_UA,
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    colorScheme: 'light',
    ignoreHTTPSErrors: false,
    actionTimeout: 10_000,
    navigationTimeout: 10_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required']
    }
  },
  projects: [{ name: 'iphone-chromium' }]
});
