import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';
import { manifest } from './src/pwa/manifest.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Relative base so the app works under /study-app/ on GitHub Pages.
  base: './',
  // Written into every exported sync file.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    viteSingleFile(),
    // PWA: manifest + a service worker that precaches the app shell (offline after the first load).
    // registerType 'prompt': a new version never takes over by itself; the app shows an
    // update banner (only on Home) and activates it when she taps Reload.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest,
      manifestFilename: 'manifest.webmanifest',
      includeManifestIcons: false,
      workbox: {
        globPatterns: ['index.html', 'icons/*.{png,svg}'],
        // Never treat a URL as self-versioned: every entry gets a content hash, so a
        // changed index.html is fetched again on update. (/(?!)/ matches nothing.)
        dontCacheBustURLsMatching: /(?!)/,
        globIgnores: ['spike/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/?spike\//],
        // The single-file app is ~0.5 MB; leave room to grow.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
