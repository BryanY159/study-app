import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: [['list']],
  use: { browserName: 'chromium', baseURL: 'http://localhost:4173' },
  projects: [
    // The built app served by `vite preview`. (The file:// project was retired in step 3.)
    { name: 'preview' },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
