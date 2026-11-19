# Architecture notes

## Layers

```
src/pack     schema (Zod) + semantic checks        ← exported as @study/pack
src/engine   pure logic: indexing, selection,       ← parts exported as @study/pack/engine
             scoring, mock assembly, seeded RNG
src/storage  persisted documents, merge rules,
             browser store, optional folder store, tab lock, backups
src/state    AppProvider: React context that wires engine + storage
src/ui       screens and components
```

Dependencies only point downward: `ui → state → storage/engine → pack`. Nothing
under `src/pack` or `src/engine` imports React or touches storage, so the same
code runs in the browser, in Vitest, and in a content repo's Node scripts.

## Content packs

A pack is one JSON file, validated by `PackSchema` and then by `checkPack`:

- `packId` (kebab-case), `version` (integer, raised on each release of the pack),
  `title`, an optional `examDate`;
- `examBlueprint`: `questionCount`, `timeLimitMinutes`, and `minModuleShare` (each
  module's minimum share of a mock exam), plus optional `sections` (below);
- `modules[]` → `topics[]`;
- optional `groups[]`: `{ id, name, moduleIds }`, a named set of modules (for example one
  exam's worth). Every module is in at most one group and every ID must exist. Modules
  in no group are fine. A pack without groups behaves exactly as before;
- `scenarios[]`: shared stems that several questions refer to by `scenarioId`;
- `questions[]`: a stable `id` (`q-<prefix>-NNNN`), `topicIds`, `stem`, options
  `A, B, C…` (each with `correct` and an `explanation`), `level`
  (recall / application / clinical), `sources[]` (file + locator), and `status`
  (`draft`, `verified`, `flagged-fixed`, or `unconfirmed` with a `preflag` note).

**Mock exam sections.** `examBlueprint.sections` is an optional list of
`{ name, groupIds | moduleIds, count }` (exactly one of the two lists). Rules, all checked by `checkPack`:

- the counts add up to `questionCount`;
- every group or module ID exists, and a module is in at most one section;
- modules in no section get a warning (a mock never includes them), and so does
  `minModuleShare > 0`, which is ignored when sections are set.

With sections, `assembleMock` draws exactly each section's count from its own modules (and
groups' modules), keeping scenario sets whole. Unconfirmed and excluded questions are left
out. It looks for a combination of whole units that adds up to the count; if no exact fit
exists, the section is short and the mock shows the usual "Only N … available" warning, with
nothing borrowed from other sections. Without sections the mock is unchanged.

**Figures** (`figure: { file, caption }`) must be embedded as `data:` URIs. The app
has no folder of figure files, so a figure given as a file path shows a "Figure not
included in this pack" placeholder.

`checkPack` reports errors (duplicate IDs, unknown topics or scenarios, a
single-answer question without exactly one correct option, topics spanning
modules) and warnings (duplicate stems, one answer letter correct in more than
40% of questions).

See [`test/fixtures/sample-pack.json`](../test/fixtures/sample-pack.json) for a complete example.

## Flashcards

- **In the pack:** an optional `flashcards` array. Each card has an `id` (`c-<prefix>-NNNN`),
  `topicIds`, a `type` (term, concept, cloze or diagram), `front`, `back`, an optional
  `image` (a `data:` URI with alt text and labels at x/y fractions), `label` (diagram
  cards: which label is asked about), `relatedQuestionIds`, `sources` and `status`
  (`draft`, `verified`, `flagged-fixed` with an optional `fixedIn`, or `unconfirmed` with a
  `preflag`). `flagged-fixed` cards work like questions: a flag made before `fixedIn` shows
  "Resolved — re-check", and the card is studied like a verified one.
  `checkPack` validates the cross-references, image size (≤ 400 KB) and the cloze /
  diagram rules.
- **Scheduler** (`src/engine/leitner.ts`, pure):
  - five boxes, with intervals of 0 / 1 / 3 / 7 / 14 days;
  - Got it moves a card up one box and Again sends it to box 1;
  - the exam cap keeps due dates no later than the day before the exam;
  - a daily new-card limit (device setting, default 20);
  - cram sessions never change the schedule.
- **Saved progress:** a third document, `cards` (state per `packId|cardId`, a review log,
  and tombstones for undone reviews). It merges like the others: reviews by id,
  each card's state from its latest review.
- **Screens:**
  - `#/cards` (deck setup) and `#/cards/run` (review with flip, rating, swipe,
    undo, flag, and a summary);
  - a Cards-due tile on Home, and card progress per topic;
  - related cards are offered after a wrong drill answer.

  Cards never change question scores or mock assembly; a test guards this.
- **Flags v2:** flags carry `itemType` (`question` or `card`). Unconfirmed cards get pre-flags.

## Topic tree

Drill setup, card deck setup and Home show topics as a collapsible **group → module → topic**
tree (`src/ui/components/TopicTree.tsx`, model in `src/ui/topicTree.ts`). A pack without groups
shows module → topic; modules in no group follow the groups at the top level.

- Every level is collapsed by default. Open branches are remembered **per device** in
  `localStorage` (`study-ui:tree:<screen>:<packId>`, never synced or backed up); blocked storage
  just means the tree forgets. A preselected topic (from a link) opens its path for that visit only.
- Setup screens have cascading checkboxes (a branch is "partly selected" when only some topics
  below it are ticked) and a count at every level. Home shows accuracy and "seen of available".
  Weakest topics show their path ("First season › Glowroots").
- Branches are native buttons (`aria-expanded`) and checkboxes, so Tab, Enter and Space work
  with no extra key handling. Rows and buttons are at least 44 px tall.

## Storage

- Three documents, with schemas in `src/storage/docs.ts`:
  - **progress**: attempts, sessions, settings and an active mock;
  - **flags** (v2);
  - **cards**: flashcard progress.

  `MAX_DOC_VERSION` holds the highest version this app reads for each document.
- **Everything is in IndexedDB** (`src/storage/IdbDataStore.ts`), database
  `studyapp-data` with three stores:
  - `docs`: the two documents;
  - `setAside`: unreadable copies, at most 3 per document;
  - `meta`: device-local values (device name, last export, reminder snooze,
    persistence answer, migration stamp). They are never synced.

  Imported packs keep their own database (`src/storage/packStore.ts`). iOS caps
  `localStorage` at about 5 MB, so nothing new goes there.
- **Every save goes through `SafeStore`** (`src/storage/SafeStore.ts`). On IndexedDB
  each save is **one read-merge-write transaction**, so there's no gap between
  reading and writing. A save lands a few milliseconds after the change; from then
  on a reload or a closed app keeps it.
- **Saving merges, it never overwrites** (`src/storage/sync.ts`):
  - attempts and sessions are combined by ID;
  - flags are combined by ID, and the newer `updatedAt` wins;
  - removed flags leave tombstones, so an older copy can't bring them back;
  - a restore (Replace) stamps `restoredAt`; an older copy of this device's data
    merged later only contributes what came after it.
- **Safety rules:**
  - data written by a newer app version is never written over;
  - a copy that fails to parse is set aside as `*.corrupt-<time>.json` and offered
    as a download;
  - a startup error screen explains what failed. It offers a rescue file: an
    importable sync file, plus every raw entry it could read.
- **One tab at a time** (Web Locks). A second tab offers "Use this tab instead",
  and the first tab then stops saving.
- **Moving from v1.4** (`src/storage/legacy.ts`):
  - on the first start, the old `localStorage` documents (`studyapp:*`) are merged
    into IndexedDB once;
  - `meta.legacyMigratedAt` records that it ran;
  - the old keys are left as they were, and nothing writes to them.
- **`navigator.storage.persist()`** is requested on each start until granted. The
  Data page shows the answer.

## Sync file (backup and moving between devices)

`src/storage/syncFile.ts`. One format serves both:

```jsonc
{ "kind": "studyapp-sync", "formatVersion": 3, "appVersion": "2.0.0",
  "device": "Laptop", "createdAt": "…", "progress": { … }, "flags": { … }, "cards": { … } }
```

- **Older formats are upgraded on import, one step at a time (1 → 2 → 3):**
  - format 1 is the v1.4 backup (`kind: "studyapp-backup"`);
  - format 2 is the v1.5 sync file;
  - each future format adds one upgrade step.
- A file or document from a newer app version is refused, with a message to update.
- **Export** builds the file before the click handler's first `await`, so iOS still
  opens the Share sheet. Touch devices share; desktops download.
- **Merge** (`mergeProgressForSync` / `mergeFlagsForSync`) uses the same ID rules,
  with two differences for a file from another device:
  - `restoredAt` is not applied across devices, because it would drop the other
    device's older answers;
  - `settings` and the exam in progress stay this device's.

  Tombstones still apply. Merging is pure and idempotent, so importing the same
  file twice changes nothing. A preview (`previewMerge`) lists what will be added
  before anything is written.
- **Replace** saves a safety copy first, then confirms with both counts.
- **Backup reminder** (`src/storage/reminder.ts`): Home shows it when this device
  has answers and hasn't exported for more than `REMINDER_DAYS` (3) days.
  Dismissing it hides it for a day.

## Build

Vite + React, built by `vite-plugin-singlefile` into one self-contained
`dist/index.html` (fonts inlined, relative base), served from GitHub Pages. Opening it
straight from disk (`file://`) was retired in step 3 and is no longer tested. `public/` (the iOS storage spike page) is copied
into `dist/` as is.

## Layout and theming

- **Breakpoints:**
  - phone < 640 px;
  - tablet 640–1023 px;
  - laptop ≥ 1024 px, which keeps the v1 layout.

  Most of it is CSS media queries. `useBreakpoint()` (`src/ui/useBreakpoint.ts`) is
  used only where the structure differs: navigation, and the run screens' bars.
- **Phone:**
  - a bottom tab bar (Home · Drill · Mock · More);
  - run screens get a sticky top bar and a bottom action bar;
  - the mock exam's question grid is a slide-up sheet, and tables become stacked rows;
  - text is 16 px, touch targets are ≥ 44 px, and safe areas use
    `env(safe-area-inset-*)` and `dvh` units.
- **Tablet:** the top nav, two-column Home, and the mock grid as a side column.
- **Tokens:** every color is in `src/ui/tokens.css`. Dark mode is a token swap under
  `prefers-color-scheme: dark`. `tokens.test.ts` checks WCAG AA contrast for the
  text pairings in both themes and that no hex color appears anywhere else.
- **Reduced motion** turns transitions and animations off. Keyboard hints show only on laptop.

## PWA (installable, offline)

- **Manifest** (`src/pwa/manifest.ts`, injected by `vite-plugin-pwa`):
  standalone, with icons rendered from `public/icons/app-icon.svg` by
  `scripts/make-icons.ts`. Maskable and Apple icons are full-bleed. `index.html`
  carries the iOS home-screen tags.
- **Service worker** (Workbox `generateSW`) precaches the app shell: `index.html`,
  the manifest and the icons. Every entry has a content hash; an e2e test checks
  there are no duplicates and no unhashed entries. Navigations fall back to
  `index.html`, so the app opens offline after the first load. The `spike/` page
  isn't cached.
- **Updates** (`src/pwa/updates.ts`, `register.ts`):
  - `registerType: 'prompt'`, so a new version waits and the app never reloads
    by itself;
  - the banner shows only on Home, never during a drill, mock exam or card
    session; "Later" hides it until the next start;
  - an open app checks for a new version hourly;
  - `register.ts` is imported only by `main.tsx`, so unit tests use a fake
    `UpdateSource`.

## Tests

- **Unit (Vitest + jsdom, `fake-indexeddb`):**
  - engine, pack checks, and the leak guard;
  - storage: IndexedDB, merge and sync rules, migration, sync file, reminder;
  - resilience and UI flows.
- **End-to-end (Playwright, Chromium):**
  - against `vite preview`:
    - drill and two tabs;
    - sync between two browser contexts: Merge, repeat, Replace, and a v1.4 backup;
    - the reminder, with a fake clock;
    - the move from v1.4 `localStorage`;
    - the iOS storage spike page;
  - the built app with every other host blocked (`e2e/app.spec.ts`): import,
    drill, mock exam, sync export, figures, pre-flags, and a 600-question
    performance run.
- **Fixtures:**
  - `test/fixtures/sample-pack.json`: an invented subject;
  - `test/fixtures/sample-pack.v1-4-backup.json`: a v1.4 backup of answers to it,
    built by `test/makeV14Backup.ts`;
  - `test/makePack.ts`: generated packs of any size.

## Leak guard

`scripts/leak-guard.ts` runs in CI on every tracked file and on `dist/`. It
works by allowlist, so it never names real content:

- pack-shaped JSON is allowed only under `test/fixtures/`;
- the only pack IDs allowed anywhere are the fixtures' IDs;
- each tracked file must be ≤ 256 KB (`package-lock.json` is exempt);
- no `.pdf`, `.txt`, `.png`/`.jpg`/… or Office files, except a future
  `public/icons/` folder.

## CI and deploy

`.github/workflows/ci.yml`:

- On pushes to `main` and on PRs: `npm ci` → leak guard → typecheck → unit → e2e
  (builds) → leak guard on `dist/`.
- On a `v*` tag, the same job also uploads `dist/`, and a second job deploys it
  to GitHub Pages.

## `@study/pack` contract

- `@study/pack`:
  - `PackSchema` and the other schemas, with their TypeScript types;
  - `parsePack`, `checkPack`, `zodIssues`, `normalizeText`, `formatIssues`;
  - since v2.0.0, flashcards: `FlashcardSchema`, `CardImageSchema`,
    `CardLabelSchema`, `CARD_TYPES`, `CARD_ID_RE`, `CLOZE_BLANK`, `cardsOf`,
    `MAX_CARD_IMAGE_BYTES`, `PACK_WARN_BYTES`;
  - since v2.1.0 (all optional, so older packs still load): `GroupSchema`, `ExamSectionSchema`,
    `groupsOf`, the optional `groups` on a pack and `examBlueprint.sections`, the card status
    `flagged-fixed` with `fixedIn`, and the checks for them.
- `@study/pack/engine`:
  - `indexPack`, `toUnits`, `assembleMock`, `mulberry32`, `shuffle`, `randomSeed`;
  - since v2.0.0, the Leitner scheduler: `nextState`, `buildQueue`, `requeueAgain`,
    `deckCounts`, `dueDateFor`, `localDay`, `addDays`, and the box constants;
  - since v2.1.0, `PackIndex` has `group` and `groupOf`, and `assembleMock` follows
    `examBlueprint.sections` when a pack has them (same results as before when it has none).
- It ships TypeScript source (consumers use `tsx`/Vitest). Its only runtime
  dependency is `zod`, and there's deliberately no `prepare` script, so a git
  install doesn't pull in the app's dev tooling.
- Any change to these exports is a format change: release a new tag, and update
  the content repo's pinned tag in the same change set.
