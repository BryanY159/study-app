import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: [['list']],
  use: { browserName: 'chromium', baseURL: 'http://localhost:4173' },
  projects: [
    // App served by `vite preview` (the same single-file build).
    { name: 'preview', testMatch: /(drill|tabs|spike|sync|migrate)\.spec\.ts/ },
    // Built dist/index.html opened straight from disk (file://).
    { name: 'file', testMatch: /build\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
