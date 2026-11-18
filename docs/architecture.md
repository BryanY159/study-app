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
  module's minimum share of a mock exam);
- `modules[]` → `topics[]`;
- `scenarios[]`: shared stems that several questions refer to by `scenarioId`;
- `questions[]`: a stable `id` (`q-<prefix>-NNNN`), `topicIds`, `stem`, options
  `A, B, C…` (each with `correct` and an `explanation`), `level`
  (recall / application / clinical), `sources[]` (file + locator), and `status`
  (`draft`, `verified`, `flagged-fixed`, or `unconfirmed` with a `preflag` note).

**Figures** (`figure: { file, caption }`) must be embedded as `data:` URIs. The app
has no folder of figure files, so a figure given as a file path shows a "Figure not
included in this pack" placeholder.

`checkPack` reports errors (duplicate IDs, unknown topics or scenarios, a
single-answer question without exactly one correct option, topics spanning
modules) and warnings (duplicate stems, one answer letter correct in more than
40% of questions).

See [`test/fixtures/sample-pack.json`](../test/fixtures/sample-pack.json) for a complete example.

## Storage

- Two documents: **progress** (attempts, sessions, settings, an active mock) and
  **flags**. Their schemas live in `src/storage/docs.ts`.
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
{ "kind": "studyapp-sync", "formatVersion": 2, "appVersion": "1.5.0",
  "device": "Laptop", "createdAt": "…", "progress": { … }, "flags": { … } }
```

- **Format 1** is the v1.4 backup (`kind: "studyapp-backup"`). It is accepted and
  upgraded on import. Each future format adds one upgrade step.
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

- `@study/pack`: `PackSchema` and the other schemas, their TypeScript types,
  `parsePack`, `checkPack`, `zodIssues`, `normalizeText`, `formatIssues`.
- `@study/pack/engine`: `indexPack`, `toUnits`, `assembleMock`, `mulberry32`,
  `shuffle`, `randomSeed`.
- It ships TypeScript source (consumers use `tsx`/Vitest). Its only runtime
  dependency is `zod`, and there's deliberately no `prepare` script, so a git
  install doesn't pull in the app's dev tooling.
- Any change to these exports is a format change: release a new tag, and update
  the content repo's pinned tag in the same change set.
