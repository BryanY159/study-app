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
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    { name: 'phone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'tablet', use: { browserName: 'webkit', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
