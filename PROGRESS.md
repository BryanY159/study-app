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
### M3.5 Install help and first-run welcome — done
- `src/pwa/platform.ts` `detectPlatform` covers iPhone/iPad Safari (including iPadOS presenting as a Mac), other iOS browsers, Android, desktop Chrome/Edge, other desktop browsers, and the installed state.
- `#/install` shows this device's steps first; the others are folded. Linked from the welcome screen and the Data page (the "More" menu comes in M4.1).
- **Welcome screen** (D7: included) replaces the old "No question pack loaded" screen everywhere a pack is needed. Step 1 adds the app to the Home Screen (hidden once installed); step 2 imports a pack and lands on Home. A link covers sync files.
- **D7 condition:** importing a newer pack version is covered by a new e2e test (v1 → v2 replaces and keeps progress; the older file is then refused), on top of the existing unit test.
- Unit 177 (+14), e2e 26 (+2).

**Step 3 complete.**
### M4.1 Foundations and three-viewport e2e — done
- `src/ui/tokens.css` holds every color: the approved light set plus a **derived dark set (D5)**. `styles.css` and components use only tokens; the Header check icon uses `currentColor`. `theme-color` is set per scheme.
- **Unit `tokens.test.ts`:**
  - 22 text/background pairs meet WCAG AA (4.5:1) in **both** themes (the light palette passes too);
  - the dark set defines every light token;
  - no hex color anywhere in `src/**/*.css|tsx` outside `tokens.css`;
  - breakpoint table.
- Base: `100dvh`, safe-area padding (header, pages, tab bar, sheet), 16 px text/inputs on phone, reduced motion turns off transitions, and keyboard hints only on laptop.
- **Phone nav:** a bottom tab bar (Home · Drill · Mock · More, with Cards added in M6.5). "More" is a sheet with Flagged, History & data, and Install help; it gets focus and closes on Esc or backdrop tap. Tablet and laptop keep the top nav. One `useBreakpoint()` hook.
- **Playwright:** projects `phone` (WebKit 390×844, touch), `tablet` (WebKit 820×1180, touch) and `desktop` (Chromium 1280×800). CI installs WebKit too.
- `e2e/responsive.spec.ts`: nav per viewport, no sideways scroll on any main screen, ≥ 44 px touch targets on phone, and dark mode colors.
- **Fixed while doing this:**
  - drill checkbox rows were 40 px; they are now 44 px everywhere;
  - test-only races: a hash navigation measured the previous screen, a navigation raced "End drill", and parallel projects shared a temp file name.
- Unit 189 (+12); e2e 84 passed + 6 skipped (Chromium-only service-worker tests on phone and tablet) per run, 3 runs.
### M4.2 Dashboard — done
- Phone: one column (reminder → quick actions → topics → overall / by module), and recent sessions folded behind "Show recent sessions". Tablet: two columns (quick actions 2-up, with the odd card full width; topics beside overall). Laptop: as in v1.
- e2e `dashboard.spec.ts` checks grid columns per viewport, section order on phone, and the sessions toggle; it attaches a screenshot per viewport.
- Unit 189, e2e 87 passed + 6 skipped.
### M4.3 Drill and question views — done
- Phone:
  - full-width options with ≥ 56 px rows;
  - a sticky run header with a safe-area top;
  - a **bottom bar** fixed to the screen with Flag, and Next once answered. The in-page Next and the duplicate Flag are hidden on phone;
  - the page pads for the bar.
- After answering, the verdict scrolls into view. Tablet gets wider page margins.
- e2e `drill-layout.spec.ts`:
  - all viewports: answer by tap (phone/tablet) or key (desktop), feedback, Next;
  - phone: with a long invented question the bar stays at the bottom while scrolled, Next appears only after answering, and the last option isn't hidden behind the bar.
- Unit 189, e2e 91 passed + 8 skipped.
### M4.4 Mock exam — done (with a storage durability fix)
- **Phone:**
  - a sticky top bar (position, timer, "All questions");
  - a bottom bar with Prev · Mark · Next;
  - the question grid in a **slide-up sheet** (`role="dialog"`, focus starts on the current question, Tab is trapped, Esc and backdrop tap close it, "Back to question n"), with Submit inside it.
- **Tablet:** the grid is a sticky side column. **Laptop:** as in v1. One `QuestionGrid` component serves both.
- e2e `mock-layout.spec.ts`:
  - phone: the timer and position stay in view while scrolled; jump via the sheet, mark, answer, Next; the cell reads "answered, marked"; Esc closes the sheet; submit from it;
  - tablet/laptop: the grid sits beside the question.
- **Fix: IndexedDB writes now ask for `durability: 'strict'`.** On WebKit the existing "answer, reload, exam resumes" test failed about 2 in 5 runs under load: a save that had reported success was gone after a reload. Strict durability makes "complete" wait until the data is on disk, which also matters when the app is closed right after answering on a phone. Now 3 full runs plus 20 repeats of that test are green. A unit test checks every write transaction is strict. Logged in `OPEN_QUESTIONS.md` (Q1) to confirm on a real iPhone.
- Unit 190, e2e 94 per run (3 runs).
### M4.5 Other screens — done
- On phone the confirm table (Replace) becomes stacked, labelled rows (`data-label`). Flags, mock results, Data, Install help and Welcome are one column on phone, with no hover-only actions.
- The phone sheet no longer repeats the "Questions" title. Visual check in the browser pane at phone size, light and dark: Home, and the mock grid sheet.
- `architecture.md`: a new "Layout and theming" section.
- e2e `screens-layout.spec.ts`: mock results and flags have no sideways scroll at any size and their actions are visible buttons; on phone, the Replace confirmation shows stacked rows with labels.
- Unit 190, e2e 98 passed + 10 skipped.

**Step 4 complete.**
