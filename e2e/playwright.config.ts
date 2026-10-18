// Browser smoke tests: the real web build (`npm run e2e:build`) driven through
// key flows in Chromium at phone size, with Supabase answered by
// support/fake-supabase.ts. See docs/testing-strategy.md.
import { defineConfig } from '@playwright/test';

const PORT = 8123;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  workers: isCI ? 2 : undefined,
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // A phone-sized window.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    // The club is in Western Australia; CI runs in UTC.
    locale: 'en-AU',
    timezoneId: 'Australia/Perth',
    // Shortens the opening FirstPass animation.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node serve.mjs web-build ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
});
