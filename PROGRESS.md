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
- Unit 190, e2e 98 passed + 13 skipped (Chromium-only or single-viewport tests in other projects).

**Step 4 complete.**
### M5.1 FR-16: reviewing earlier questions during a drill — done
- A **question strip** under the drill header has one 44 px chip per question, colored correct / incorrect / on screen / not yet. The live question is outlined, later chips are disabled, it scrolls sideways on phone, and the chip on screen is kept in view.
- **Previous / Next** buttons, on phone in the bottom bar. **←/→** work only once feedback is showing, so A–D stay answer keys.
- An earlier question opens **read-only**: same feedback, no answer buttons, answer keys ignored. Flagging works. "Back to current question" returns to the live one.
- The rules are in `src/ui/drillNav.ts` (pure); `DrillRun.viewing` is optional, so nothing else changes.
- Tests:
  - unit for the rules: chips, bounds, prev/next, arrows only after feedback;
  - UI: answer 3, open 1 by chip (read-only), a key press ignored, flag it, → to 2, back to current; still exactly 3 attempts;
  - e2e at all viewports: tap the chip (phone/tablet) or ← ← (desktop), then back.
- Unit 195, e2e 101 passed + 13 skipped.
### M5.2 FR-17: weakest-topics placement — done
- The topics section is now "Weakest topics". The **Drill weakest** action is a button in the section header, above the list, at every size. It shows the **5** weakest attempted topics, with **Show all topics (n)** / **Show fewer**.
- On phone the same action is also a chip under the quick actions, visible without scrolling. It's hidden when nothing has been answered yet.
- `weakestTopics()` and the `WEAKEST_SHOWN` / `WEAKEST_DRILLED` constants are in `src/engine/progress.ts`. Q2 logs that the action drills 3, as in v1.
- Tests:
  - unit: selection (5 weakest, Show all, fewer than 5, none);
  - UI: the action is before the list, 5 → 7 → 5, and nothing when there are no answers;
  - e2e at all viewports: the action is above the first row; on phone the chip is in the first viewport and opens the drill.
- Unit 200, e2e 104 passed + 13 skipped.

**Step 5 complete.**
### M6.2 Leitner scheduler — done
- `src/engine/leitner.ts` (pure):
  - five boxes with intervals 0 / 1 / 3 / 7 / 14 days; Got it moves up one box (max 5), Again goes to box 1; a new card counts as box 1 (Q3);
  - **exam cap**: due no later than the day before the exam, except on the cap day itself and after the exam;
  - local calendar days, DST-safe;
  - daily new-card limit, counted from first reviews per local day; `buildQueue` (due-new / due / cram; cram is shuffled with the seeded RNG and doesn't change the schedule); `requeueAgain` (back after at least 3 other cards, or at the end); `deckCounts` (due / new / learned = box ≥ 4, D6).
- **`@study/pack/engine` contract addition:** `nextState`, `buildQueue`, `requeueAgain`, `deckCounts`, the date helpers and constants, and the `CardState` / `QueueMode` / `Rating` types.
- Unit 237 (+14): intervals, boxes, a new card, the exam cap (before, on and after the cap; no exam), the daily limit across midnight, queue order, Due only, cram determinism, re-queue positions 0, 1, 3 and last, and counts.
- **Process slip, fixed:** the M6.1 and M6.2 commits went in with a typecheck error in `src/pack/cards.test.ts` (a test helper typed too narrowly). My commit command didn't stop when the typecheck failed. Fixed in the next commit, and from here every commit goes through a gate script (`set -e`: leak guard, typecheck, unit, e2e, leak guard on `dist/`) that must print GATE-OK first.
### M6.3 Card state, review log and sync — done
- A new saved document, **`cards`** (`CardsDocSchema` v1):
  - `states` keyed `packId|cardId` (`box`, `dueDate`, `lastReviewedAt`, `updatedAt`, plus `fresh` for a card whose first rating was undone);
  - `reviews` (`id`, `cardKey`, `rating`, `at`, `device`, `cram`);
  - `undone` tombstones.
- It goes through `SafeStore` like the other docs: merge on write, newer-version freeze, quarantine. `docCodec` now checks each doc against its own maximum version (`MAX_DOC_VERSION`: progress 1, flags 2, cards 1).
- **Merge:**
  - reviews are unioned by id, minus undone ones (an undo is never brought back);
  - each card's state comes from the copy with the newer `updatedAt`; an undo restores the previous state with a fresh stamp, so it wins;
  - `restoredAt` behaves as for the other docs; `mergeCardsForSync` ignores it across devices.
- **Flags v2 (D3):** flags gain `itemType: 'question' | 'card'` (default `'question'`; `questionId` holds the item's id). v1 docs are upgraded on read, and an older app treats v2 as newer and leaves it alone.
- **Sync file format 3** adds `cards`, with the upgrade chain 1 → 2 → 3, so a v1.4 backup and a v1.5 sync file both import. The Merge preview adds "N card reviews"; Replace, the safety copy and the rescue file all include cards.
- `progress.settings.newCardsPerDay` defaults to 20 and is device-local. `AppProvider` gains `cards`, `cardRun`, `rateCard` (cram never changes the schedule), `undoRating` and `setNewCardsPerDay`.
- New fixture `test/fixtures/sample-pack.v1-5-sync.json` from `test/makeV15Sync.ts`.
- Tests:
  - unit: card merge (union, newest state, an undo beats an older copy both ways, merge through `SafeStore`), sync idempotent with cards and the preview count, a cards doc from a newer version refused, flags v1 → v2, and the v1.5 file upgraded to format 3;
  - existing tests updated for format 3 and flags v2.
- Gate: unit 246, e2e 104 + 13 skipped.
- A gate run once hung in e2e. A direct rerun passed in 29 s, so the gate's e2e step is now capped at 5 minutes and a hang fails it.
