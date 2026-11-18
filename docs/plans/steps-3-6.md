# Plan: build steps 3–6 (PWA, responsive layout, feedback fixes, flashcards)

Status: **DRAFT, waiting for review.** Nothing in it has been built.
Starting point: `main` at `v1.5.0` (IndexedDB storage, sync file).
Release at the end: **`v2.0.0`**, prepared locally and **not pushed**.

This plan is written for **one long unattended run**: a checklist of milestones,
each ending in a commit once its checks pass. It covers app code only. Examples
and test data come only from the Orrin fixture, and nothing is copied from the
spec or mockups. They were read for behavior and layout, and everything here is
written fresh.

---

## 0. Run rules (apply to every milestone)

1. **Milestones in order.** M3.1 … M6.9. Each one ends with:
   - `npm run leak-guard`, `npm run typecheck` and `npm test`;
   - `npm run e2e` (from M4.1 on, at all three viewports, §0.3);
   - one commit on `main`: `Step N.M: <what>`. **No commit while anything is red.**
2. **Nothing is pushed:** no `git push`, no tag push, and no change to the content
   repo (it stays read-only). The run ends with the summary in §7.
3. **Logs, kept up to date in the repo root:**
   - `PROGRESS.md`: one entry per milestone with date, what was done, test counts
     (unit / e2e per viewport), commit SHA, and anything skipped. The final summary
     goes here too.
   - `OPEN_QUESTIONS.md`: any question that comes up. Each entry has the question,
     the options, **the default I chose**, and where it's used. Then the run
     **carries on with the default**. You review them at the end.
   - Both files stay generic: no course names, terms or content.
4. **When something can't be made green** after a few honest attempts (typically
   a flaky e2e at one viewport or a browser quirk):
   - log it in `OPEN_QUESTIONS.md` with the failing output;
   - keep the test, but mark it `test.fixme` with a link to the entry;
   - carry on, and list it in the final summary.

   Never weaken an assertion to get green.
5. **Contract changes:** anything in `src/pack/index.ts` / `src/engine/public.ts` is
   noted in `PROGRESS.md` under "Content repo must change".
6. **Small steps:** if a milestone grows past roughly a day's diff, split it and
   log the split.
7. **Things the run doesn't decide:** the iOS spike result (`REMINDER_DAYS` stays 3
   until you report it) and anything in §8 that you haven't answered.

### 0.1 Test baseline
- `v1.5.0`: unit 143, e2e 19 (Chromium; `preview` + `file` projects).

### 0.2 New devDependencies (all build-time; `zod` stays the only runtime dependency)
- `vite-plugin-pwa` (pulls in Workbox). Bundled into the app, so it's a devDependency.
- Playwright **WebKit** browser (no npm change; CI installs it, §0.3).
- No image library: PNG icons are rendered from the SVG with the Playwright
  Chromium that's already installed (M3.2).

### 0.3 Three viewports in e2e (from M4.1)
Playwright projects, all against `vite preview`:

| Project | Browser | Viewport | Touch |
|---|---|---|---|
| `phone` | WebKit | 390×844 (iPhone 13), `isMobile` | yes |
| `tablet` | WebKit | 820×1180 (iPad) | yes |
| `desktop` | Chromium | 1280×800 | no |

- WebKit for phone and tablet is the closest available stand-in for iOS Safari
  (see D4).
- Every flow spec runs in all three, and specs that are about one size are tagged
  (`@phone`, `@desktop`).
- Tests that need a Chromium-only API (service-worker inspection, Web Locks
  stealing) run in `desktop` only, and say so.
- CI: `npx playwright install --with-deps chromium webkit`.
- The `file://` project is retired in M3.1 (spec: the single-file `file://` build is
  retired). Its tests move to the served build.

---

## Step 3: PWA

### M3.1 Retire the `file://` mode
- `e2e/build.spec.ts` moves to the served build (`preview` project), with the same
  checks: offline import, drill, mock, export, figures, pre-flags, perf.
- The build stays a single inlined `index.html` for now. It's simplest, and the
  service worker precaches it as one file. Opening it from `file://` is no longer
  tested or promised.
- `README.md`/`architecture.md` updated.
- **Tests:** the moved e2e tests, same count.

### M3.2 Manifest and icons
- Icons: see **D1** (where the icon comes from). They are generated into
  `public/icons/`, the folder the leak guard already allows for images:
  - `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (artwork inside the
    safe zone on a full-bleed background), `apple-touch-icon-180.png`,
    `favicon.svg`;
  - `scripts/make-icons.ts` renders the PNGs from the SVG with Playwright
    Chromium, so they can be rebuilt. The script and the SVG are committed.
- Manifest via `vite-plugin-pwa`:
  - `name` "Study", `short_name` "Study";
  - `display: standalone`, `start_url: ./`, `scope: ./`;
  - theme and background colors from the tokens;
  - the icons above (`purpose: any` and `maskable`).
- `index.html` gets the iOS tags: `apple-touch-icon`,
  `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`
  (`default`), `apple-mobile-web-app-title`, and `viewport-fit=cover`.
- The leak guard gets one rule: PNGs under `public/icons/` must be ≤ 64 KB each.
- **Tests:**
  - unit: the manifest is valid JSON with the required fields and icon sizes,
    and each icon file exists with the stated pixel size (PNG header read);
  - e2e: `link[rel=manifest]` resolves, and the iOS meta tags are present;
  - leak guard: an icon over 64 KB fails, and a PNG outside `public/icons/` still fails.

### M3.3 Service worker: offline after the first load
- `vite-plugin-pwa` with `registerType: 'prompt'` and `injectRegister: false`. The
  app registers through `virtual:pwa-register` so it controls the update flow.
- The Workbox precache holds the app shell: `index.html`, the manifest and icons.
  The `spike/` page is excluded.
- Navigation falls back to `index.html`, and there is no runtime caching of other
  origins (there are none).
- The service worker isn't registered on `file://` or when
  `navigator.serviceWorker` is missing. The app works without it.
- **Tests:**
  - e2e (desktop/Chromium, because it inspects the service worker): first load
    registers it; after `context.setOffline(true)` a reload still shows Home with
    the imported pack and saved answers; a drill works offline;
  - phone/tablet: an offline reload after the service worker is active, if WebKit
    supports it in Playwright. If not, it's logged and kept desktop-only.

### M3.4 Update banner (never interrupts a session)
- A new service worker waiting → `needRefresh` → the banner "A new version is
  ready" with **Reload** and **Later**.
- **Shown only on Home**, never during a drill, a mock exam run or a card session.
  If the update arrives mid-session, it waits and appears on the next visit to Home.
- "Later" hides it until the next start. Reload calls `updateServiceWorker(true)`.
- Nothing ever reloads by itself. With `registerType: 'prompt'`, a new worker only
  activates when the user taps Reload.
- Pure helper `shouldShowUpdate({ needRefresh, route, activeMock, inCardSession })`.
- **Tests:**
  - unit for the helper (every route, with and without an active mock);
  - UI test with a faked `useRegisterSW`: during a drill and a mock run there's no
    banner; back on Home it appears; Reload calls the update; Later hides it;
  - e2e (desktop): build twice with different versions, serve the first, load it,
    swap in the second, trigger an update check. Mid-drill nothing shows; on Home
    the banner shows; Reload brings up the new version (checked through a version
    string in the page). If this can't be made reliable, it's logged (rule 4).

### M3.5 Install help and first-run welcome
- Route `#/install`. It detects the platform and shows the matching steps first,
  with the others under "Other devices":
  - iPhone/iPad Safari (detected including iPadOS presenting itself as a Mac with touch);
  - other iOS browsers (step: open in Safari);
  - Chrome/Edge on desktop (the install icon in the address bar, or the menu);
  - Android Chrome.
- Already running standalone → "Installed" with nothing to do.
- Pure `detectPlatform(ua, maxTouchPoints, standalone)` (tested by table).
- Links to it from the Data page, the "More" menu (M4.1), and the welcome screen.
- **Welcome screen** (no pack loaded) replaces the current No-pack screen. It has
  two numbered steps: add to the Home Screen (with a link to install help) and
  import a pack. A smaller link imports a sync file from another device.
- **Tests:**
  - unit: the platform table (iPhone Safari, iPad-as-Mac, iOS Chrome, desktop
    Chrome/Edge/Firefox, Android, standalone);
  - UI: the welcome screen shows on first run; its import works; the
    install-help link routes;
  - e2e (all viewports once M4.1 lands; phone + desktop here): welcome →
    import → Home.

---

## Step 4: Responsive layouts

Breakpoints from the spec:
- phone < 640 px;
- tablet 640–1023 px;
- laptop ≥ 1024 px.

The laptop layout stays as v1.

### M4.1 Foundations and the three-viewport e2e projects
- `src/ui/tokens.css`: every color, radius and spacing value moves to custom
  properties, with a **dark** set under `prefers-color-scheme: dark` (see **D5**).
  `styles.css` uses only tokens, and a unit check fails on any hex color outside
  `tokens.css`.
- Base:
  - `100dvh` instead of `100vh`;
  - `env(safe-area-inset-*)` padding on the app shell and sticky bars;
  - body text 16 px on phones (stops iOS zooming into inputs);
  - all buttons and links in nav ≥ 44 px;
  - `prefers-reduced-motion` turns transitions off.
- **Navigation:**
  - phone: a bottom tab bar with Home · Drill · Mock · More (Cards is added in M6.5).
    "More" opens a sheet with Flagged, History & data, Install help;
  - tablet and laptop: the top nav, as in v1;
  - one `useBreakpoint()` hook (matchMedia), so layout logic isn't scattered.
- Keyboard-shortcut hints show only on laptop (pointer: fine and ≥ 1024 px).
- Switch Playwright to the three projects (§0.3) and run every existing spec in all three.
- **Tests:**
  - unit: `useBreakpoint` at the three widths; the token check;
  - e2e: at each viewport, nav works (bottom bar on phone, top nav otherwise);
    no horizontal scroll on any main screen (`scrollWidth <= innerWidth`); every
    visible button/link is ≥ 44 px tall on phone; the dark scheme
    (`colorScheme: 'dark'`) renders with no hard-coded light background.

### M4.2 Dashboard
- Phone: one column, in this order: reminder, (cards tile in M6.6), quick actions
  stacked, topics, recent sessions collapsed behind "Show recent sessions".
- Tablet: two columns.
- Laptop: as in v1.
- **Tests:** e2e screenshots per viewport (kept as artifacts, not pixel-compared);
  order of sections on phone; sessions toggle.

### M4.3 Drill and question views
- Phone:
  - full-width options with tall touch targets;
  - a sticky bottom bar with Flag · Next (Next appears after answering);
  - feedback scrolls into view.
- Tablet: wider margins.
- **Tests:** e2e at each viewport: the drill flow by tap (phone/tablet) and by
  keyboard (desktop); the sticky bar stays visible at the bottom on phone with a
  long question.

### M4.4 Mock exam
- Phone:
  - a sticky top bar (timer, question n of N);
  - a sticky bottom bar with Prev · Mark · Next;
  - the question grid in a **slide-up panel** with answered / marked / not-answered
    states, "Back to question n" and Submit. The panel traps focus, closes on Esc
    and on backdrop tap, and works with a screen reader (`role="dialog"`).
- Tablet: the grid as a side column.
- Laptop: as in v1.
- **Tests:** e2e: open the grid on phone, jump to a question, mark it, submit;
  on tablet the grid is always visible; the timer is visible while scrolled.

### M4.5 Other screens
- Flags, History & data (sync section included), Mock results, Install help, Welcome.
- Each gets a single-column phone layout, with tables turned into stacked rows
  on phone.
- **Tests:** e2e: each screen at each viewport has no horizontal scroll, and its
  main action is reachable without hover.

---

## Step 5: Feedback fixes

### M5.1 FR-16: reviewing earlier questions during a drill
- **A question strip** under the drill header has one numbered chip per question:
  - colored by state: correct, incorrect, current, not yet;
  - it scrolls sideways on phone and keeps the current chip in view;
  - each chip has an `aria-label` with its number and state.
- **Previous / Next** buttons step through. With the keyboard, ←/→ do the same
  **only once feedback is showing**, so A–D stay answer keys.
- **An earlier question opens read-only:**
  - it shows the chosen answer, the correct one, the explanations and the source,
    exactly as at the time;
  - the options are disabled, and **an answer is never recorded twice**;
  - flagging still works.
- **"Back to current question"** returns to the live one. Score and progress don't
  change while reviewing.
- State: `DrillRun` gets `viewing: number | null`. Answers are already kept per
  question in `DrillRun.answers`.
- **Tests:**
  - unit: navigation reducer (bounds, ←/→ disabled before feedback, viewing an
    answered question never adds an attempt);
  - UI: answer 3, go back to 1 (read-only, same feedback), flag it, "Back to
    current" returns to 3, the attempt count is still 3;
  - e2e (all viewports): the strip by tap on phone and keys on desktop.

### M5.2 FR-17: weakest-topics placement
- The **"Drill weakest topics"** action moves into the topics section header, on
  every screen size. It's never below the list.
- The section shows the **5 weakest** by default, with **Show all topics** /
  **Show fewer** to toggle.
- Phone: the same action also appears as a chip under the Home quick actions.
- With no attempts yet, the action is hidden (as today).
- **Tests:**
  - unit: weakest-5 selection (ties, fewer than 5 attempted);
  - UI: the action is in the header, before the list, and expand/collapse works;
  - e2e: on phone the chip is visible without scrolling (bounding box within the
    first viewport).

---

## Step 6: Flashcards

### M6.1 Pack schema: `flashcards` (`@study/pack` contract change)
- `FlashcardSchema` in `src/pack/schema.ts`. The pack's top-level `flashcards` is
  **optional**, so a pack without it still loads.
- Fields: `id`, `topicIds`, `type` (`term | concept | cloze | diagram`), `front`,
  `back`, `image` (`{ data, alt, labels: [{ key, x, y }] }` or null),
  `relatedQuestionIds?`, `sources`, `status` (`draft | verified | unconfirmed`)
  and `preflag?` (same rules as questions).
- The diagram card's answer label: see **D2**. The default is a field `label` on
  the card naming one of `image.labels[].key`.
- `checkPack` adds:
  - **errors:**
    - duplicate card IDs, or an ID not matching `c-<prefix>-NNNN`;
    - an unknown topic;
    - a cloze card without exactly one `____`;
    - a diagram card without `image`, `alt`, at least one label, or with a
      `label` that isn't one of them;
    - `x`/`y` outside 0–1;
    - an image that isn't a `data:` URI, or is over **400 KB** encoded;
    - `relatedQuestionIds` that don't resolve;
    - `unconfirmed` without `preflag`;
  - **warning:** the whole pack is over **15 MB**.
- `src/pack/index.ts` exports `FlashcardSchema` and the `Flashcard` type.
  `src/engine/public.ts` gains nothing until M6.2.
- **Content repo must change:** bump the pin to `#v2.0.0`. Nothing else is
  required, because cards are optional. The validator now also checks cards when
  present.
- **Tests:** a unit test for each check above (valid and invalid); a pack with no
  `flashcards` still parses; the pack-size warning.

### M6.2 Leitner scheduler (pure, `src/engine/leitner.ts`)
- Boxes 1–5 with intervals of **0 (same day), 1, 3, 7, 14 days**.
- **Got it:** box + 1 (max 5). **Again:** box 1. A new card enters box 1 at its
  first rating.
- Dates are **local calendar days** (`YYYY-MM-DD`); "due" means `dueDate <= today`.
- **Exam cap:** with an `examDate`, the next due date is
  `min(today + interval, examDate − 1 day)`.
  - If today is already on or after `examDate − 1`, the cap doesn't apply and
    there's no due date in the past.
  - After the exam date, there's no cap.
- **Daily new-card limit**, default 20. A card counts as new until its first
  review, and the count is of new cards first rated today. The setting is
  device-local, in `progress.settings.newCardsPerDay`.
- **Session queue:** due cards first (oldest due first, then box), then new cards
  up to the remaining limit. "Due only" leaves out new cards. **Cram** takes every
  card in the selection, shuffled with the seeded RNG, and never changes the
  schedule.
- **Again re-queue:** the card comes back after at least 3 other cards. If fewer
  than 3 remain, it goes to the end.
- **Undo:** reverts the last rating (state and review log) until the next card is
  shown.
- Exported from `@study/pack/engine` (`nextState`, `buildQueue`), so the content
  repo can test decks. That is a contract addition.
- **Tests:**
  - every interval;
  - Got it at box 5 stays 5;
  - Again from each box;
  - exam cap (before, on, and after the cap day; no exam date);
  - the daily limit across midnight;
  - due-first ordering;
  - Due only and Cram (no state change);
  - Again re-queue at positions 0–5 with fewer than 3 cards left;
  - undo;
  - deterministic with a fixed seed.

### M6.3 Card state, review log, and sync (storage)
- A third document, **`cards`**, stored in the same `docs` IndexedDB store:
  - `{ schemaVersion: 1, updatedAt, restoredAt, states: { [cardKey]: { box, dueDate, lastReviewedAt, updatedAt } }, reviews: [{ id, cardKey, rating, at, device }] }`;
  - `cardKey = packId|cardId`.
- `SafeStore`/`docCodec` cover it: merge-by-ID, newer-version freeze and quarantine
  all apply.
- **Merge:** reviews are unioned by `id`. Each card's state comes from the copy
  whose `updatedAt` (its latest review) is newer. Undo removes the review and
  restores the previous state with a fresh `updatedAt`, so undo wins over the
  undone copy.
- **Sync file format 3:**
  - adds `cards`;
  - the upgrade 2 → 3 adds an empty cards doc, so v1.4 and v1.5 files still import;
  - the Merge preview adds "+N card reviews";
  - Replace covers cards;
  - the rescue file includes cards.
- **Flags on cards:** a flag gains `itemType: 'question' | 'card'` (default
  `'question'`) and `itemId`. Because an older app would strip `itemType` and
  misread card flags, the **flags doc moves to `schemaVersion: 2`**, so a v1.5
  copy leaves it untouched instead of corrupting it (the existing newer-version
  protection). The upgrade 1 → 2 is automatic on load and on import. See **D3**.
- **Tests:**
  - unit: cards doc merge (review union, newest state wins, undo across
    devices); idempotent sync with cards; format 2 → 3 upgrade (the v1.4 fixture
    still imports); a flags v1 → v2 upgrade keeps every flag; a v1.5-shaped app
    (docCodec with max version 1) refuses a v2 flags doc;
  - fixture: `test/fixtures/sample-pack.v1-5-sync.json` (a format-2 file),
    generated like the v1.4 one.

### M6.4 Fixture cards (Orrin)
- `test/fixtures/sample-pack.json` gets about 10 invented cards:
  - all four types;
  - **one diagram card** with a tiny inline SVG `data:` image and three labels;
  - one cloze card;
  - one card with `relatedQuestionIds`;
  - one `unconfirmed` card with a preflag.
- `checks.test.ts` keeps asserting zero errors and warnings for the fixture.
- **Tests:** the fixture parses clean; leak guard clean.

### M6.5 Deck setup (Cards tab)
- Route `#/cards`, plus the **Cards** tab in the phone bar and a "Cards" link in
  the top nav.
- Module and topic pickers as in drill setup. Each topic shows **due · new ·
  learned** (learned = box ≥ 4; see **D6**).
- Mode: **Due + new** (default) · Due only · Cram. An optional card-type filter.
- The start button states the counts ("Start · 6 due + 4 new").
- Disabled with a reason when nothing is due or new.
- The daily new-card limit is adjustable on the Data page.
- **Tests:**
  - UI: counts per topic from a seeded cards doc; the mode changes the start
    count; the type filter; the empty state;
  - e2e (all viewports): open the Cards tab, pick a topic, start.

### M6.6 Card review and summary
- **Front:** type badge, topic, and the image if any (diagram labels drawn as
  positioned markers at `x`/`y`).
- Tap, Space or Enter flips it, with a short flip animation (none under reduced
  motion). An `aria-live` region announces the back.
- **Back:** answer and source.
- **Rating:**
  - **Again** / **Got it** buttons, each saying where the card goes ("box 3 · in
    3 days");
  - keys 1/2 or ←/→;
  - **swipe** left/right with a drag threshold, **only after flipping**;
  - buttons always work, and there's a sticky bottom bar on phone.
- **Flag** opens the existing dialog with `itemType: 'card'`. **Undo** for the
  last rating until the next card.
- Each rating saves right away: a review plus the new state, in one transaction
  per doc (as in v1.5).
- **Summary:**
  - reviewed, Got it % (first try), cards still in box 1, the box distribution,
    and the next due date with its count;
  - "Drill these topics" goes to drill setup preselected; "Review again" starts a
    Cram of the box-1 cards.
- Layout per breakpoint:
  - phone: full-width card;
  - tablet: centered, max 640 px;
  - laptop: centered, with a side panel of session counts and shortcuts shown.
- **Tests:**
  - unit: swipe gesture recognizer (threshold, direction, ignored before flip);
  - UI:
    - flip by key;
    - rate by key and by button;
    - Again comes back after 3 cards;
    - undo restores state and removes the review;
    - flag saves `itemType: 'card'`;
    - reduced motion means no animation class;
    - aria-live text after flip;
  - e2e:
    - phone: tap to flip, swipe right = Got it, swipe left before flip does nothing;
    - desktop: keyboard-only session;
    - tablet: the diagram card shows its labels;
    - all: the summary counts match.

### M6.7 Links between cards and questions, and the dashboard
- **Dashboard:**
  - a **Cards due today** tile (due count, "+N new", a rough time estimate, Start),
    shown only when the pack has cards;
  - topic rows show learned/total cards next to the accuracy bar.
- **After a wrong drill answer:** "Review cards for this topic", or "Review the N
  related cards" when `relatedQuestionIds` point at that question. It starts a
  Cram of those cards.
- **Summary → "Drill these topics"** (M6.6).
- Flashcards never change question scores, mock assembly or drill selection. A
  test guards this.
- **Tests:**
  - UI: the tile counts; topic card progress; the related-cards link appears only
    after a wrong answer with related cards;
  - unit: question stats are identical with and without a cards doc;
  - e2e: wrong answer → related cards → session → summary → drill these topics.

### M6.8 Flags screen and exports with cards
- The Flags screen lists card flags with the card front, and filters by
  question/card.
- The markdown and JSON flag exports include `itemType`/`itemId`.
- **Tests:** UI list and filter; export snapshot (Orrin data).

### M6.9 Release prep: `v2.0.0` (not pushed)
- `package.json` 2.0.0.
- Docs:
  - `README.md`: install, cards, the sync format 3 note;
  - `architecture.md`: PWA, layouts, cards, the flags v2 note;
  - the `@study/pack` section with the new exports and the content-repo note.
- Full run:
  - leak guard (sources and `dist/`), typecheck, unit;
  - e2e at three viewports, **3× in a row**;
  - `npm pack --dry-run` file list.
- The final summary goes into `PROGRESS.md` (§7). **Stop.** No tag is created or
  pushed until you say so.

---

## 7. What the final summary contains
- **Per milestone:** done / skipped / `fixme`, with commit SHA.
- **Tests:**
  - unit count vs 143;
  - e2e per viewport (phone, tablet, desktop), 3 runs;
  - any `fixme` with its `OPEN_QUESTIONS.md` entry.
- **Contract changes for the content repo:** `FlashcardSchema`, `nextState`,
  `buildQueue`, and the pin bump to `#v2.0.0`.
- **Data format changes:** sync format 3, flags doc v2, the new cards doc, and
  which older files still import (v1.4 backup, v1.5 sync file).
- **A manual check list for you:**
  - laptop: install the PWA, use it offline, the update banner;
  - iPhone: Add to Home Screen, offline, a card session with swipe, export → import Merge;
  - iPad: the diagram card.
- **Open questions** that need your answer before the `v2.0.0` push.

## 8. Decisions before the run starts (defaults the run uses if unanswered)
- **D1: the app icon.** The approved icon SVG lives in the content repo's docs, and
  `CLAUDE.md` says nothing (images included) is copied from there.
  - **Default:** you confirm that copying `app-icon.svg` into `public/icons/` is
    allowed. It's a generic quiz-card graphic with no course content. The run then
    generates every size from it.
  - Alternative: I draw a fresh SVG to the same description (pastel-yellow card
    with a check mark), which may not match exactly.
  - Without an answer, the run uses the alternative, so nothing is copied.
- **D2: diagram card answer.** The spec's card example doesn't say which label a
  diagram card asks about.
  - **Default:** a `label` field on the card, which must match one of
    `image.labels[].key`.
  - This is part of the `@study/pack` contract, so the content repo's card
    pipeline will use it.
- **D3: flags doc → `schemaVersion: 2`** for card flags, so an older app copy
  leaves the flags alone instead of corrupting them. Default: **yes**.
- **D4: WebKit for the phone and tablet e2e projects** (closer to iOS Safari; slower
  CI, about +2 min). Alternative: Chromium with device emulation. Default: **WebKit**.
- **D5: dark mode colors.** The approved tokens are light only.
  - **Default:** I derive a dark set (same accent hue, raised surfaces, contrast
    checked to WCAG AA), and you review it at the end.
  - Alternative: ship light only and leave dark mode for later.
- **D6: "learned"** for the per-topic count = a card in box 4 or 5. Default: **yes**.
- **D7: pack library and pack switcher** (spec §3.3: Remove, several packs, a
  switcher per mode) aren't in steps 3–6 of the build order.
  - **Default:** not built in this run. The existing pack list only gains card
    counts.
  - Logged for a later step.
- **D8: the single-file build** stays (inlined `index.html`, now served and
  cached by the service worker). Code-splitting the cards screens isn't needed
  at this size. Default: **keep**.
