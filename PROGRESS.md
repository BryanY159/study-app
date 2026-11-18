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
