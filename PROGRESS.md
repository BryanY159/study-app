# Progress: build steps 3–6 run

Plan: [`docs/plans/steps-3-6.md`](docs/plans/steps-3-6.md). Questions and the defaults chosen are in
[`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md). Nothing in this run is pushed.

Baseline (`v1.5.0`, deployed 2026-11-17): unit 143, e2e 19 (Chromium).

## Milestones

### M3.1 Retire the file:// mode — done
- The `file://` Playwright project is removed. `e2e/build.spec.ts` → `e2e/app.spec.ts`, against the served build with every non-localhost request aborted. Same checks: import, drill, mock + reload, sync export, perf, figure, pre-flags, Web Locks.
- Docs and code comments no longer promise `file://`.
- Unit 143, e2e 19 (Chromium).
### M3.2 Manifest and icons — done
- `public/icons/app-icon.svg` (the approved icon, D1 exception in `CLAUDE.md`). `scripts/make-icons.ts` renders `icon-192/512`, `icon-maskable-512` and `apple-touch-icon-180` with Playwright Chromium; maskable and Apple icons are full-bleed.
- `vite-plugin-pwa` 2.0.0 (dev). The manifest lives in `src/pwa/manifest.ts`, and the plugin injects the `<link rel="manifest">`. `index.html` has the iOS tags and `viewport-fit=cover`.
- Leak guard: an image in `public/icons/` must be ≤ 64 KB.
- Unit 149 (+6), e2e 21 (+2).
### M3.3–M3.4 Service worker (offline) and update banner — done
- Workbox `generateSW` precaches `index.html`, the manifest and the icons, with a navigation fallback; `spike/` is excluded.
- **Bug found and fixed:** the first config produced duplicate precache entries with conflicting revisions, and `index.html` had no revision. The precache came out empty, so the app would not have worked offline, and an update would never have refreshed `index.html`. Fixed with `includeManifestIcons: false` and `dontCacheBustURLsMatching` set to never match. An e2e test now checks the generated list: no duplicates, all hashed, no spike page.
- `src/pwa/updates.ts` (`UpdateSource`, `shouldShowUpdate`) and `register.ts` (`registerSW`, hourly update check). `UpdateBanner` shows only on Home; Reload applies the update and Later hides it. Nothing reloads by itself.
- e2e `offline.spec.ts` (Chromium) serves its own copy of `dist/`:
  - offline reload shows Home with the pack, and a drill works;
  - a "new version" published mid-drill waits with no banner and no reload, shows on Home, and Reload switches to it;
  - both pass 3×.
- Unit 163 (+14), e2e 24 (+3), each full run 2×.
