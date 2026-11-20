import { defineConfig } from '@playwright/test';

// Every spec runs at three viewports against the built app (`vite preview`):
//   phone   WebKit, 390×844 (iPhone 13 size), touch
//   tablet  WebKit, 820×1180 (iPad size), touch
//   desktop Chromium, 1280×800
// WebKit is the closest stand-in for iOS Safari that Playwright has. Specs that need a
// Chromium-only API (service-worker inspection) skip the other projects and say so.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // CI only: retry twice (a flaky test shows as "flaky", not red), keep a trace of each retry, and write
  // an HTML report plus a JSON one that scripts/e2e-summary.ts prints from. Locally: no retries, list only.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list']],
  use: { baseURL: 'http://localhost:4173', trace: process.env.CI ? 'on-first-retry' : 'off' },
  projects: [
    { name: 'phone', testIgnore: /perf.spec/, use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'tablet', testIgnore: /perf.spec/, use: { browserName: 'webkit', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'desktop', testIgnore: /perf.spec/, use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    // The timing test (e2e/perf.spec.ts) runs last and alone: each perf project waits for the one before it,
    // and the first waits for every functional project, so nothing else loads the machine while it measures.
    { name: 'perf-phone', testMatch: /perf.spec/, dependencies: ['phone', 'tablet', 'desktop'], use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'perf-tablet', testMatch: /perf.spec/, dependencies: ['perf-phone'], use: { browserName: 'webkit', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'perf-desktop', testMatch: /perf.spec/, dependencies: ['perf-tablet'], use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
