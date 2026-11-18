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
- **Browser storage** is always written. A **data folder** (File System Access API,
  Chrome/Edge only) is optional and mirrored through a write queue.
- **Saving merges, it never overwrites** (`src/storage/sync.ts`):
  - attempts and sessions are combined by ID;
  - flags are combined by ID, and the newer `updatedAt` wins;
  - removed flags leave tombstones, so an older copy can't bring them back;
  - a restore from backup stamps `restoredAt` and is treated as a replacement.
- **Safety rules:**
  - data written by a newer app version is never written over;
  - a copy that fails to parse is set aside as `*.corrupt-<time>.json`;
  - a startup error screen explains what failed.
- **One tab at a time** (Web Locks). A second tab offers "Use this tab instead".
- Imported packs are kept in IndexedDB (`src/storage/packStore.ts`).

## Build

Vite + React, built by `vite-plugin-singlefile` into one self-contained
`dist/index.html` (fonts inlined, relative base). It works both from GitHub Pages
and opened straight from disk.

## Tests

- **Unit (Vitest + jsdom):** engine, pack checks, storage merge and resilience,
  UI flows, and the leak guard.
- **End-to-end (Playwright, Chromium):**
  - against `vite preview`: drill, data folder via OPFS, two tabs;
  - against the built file over `file://` with the network blocked: import,
    drill, mock exam, backup, figures, pre-flags, a 600-question performance run.
- **Fixtures:** `test/fixtures/sample-pack.json` (invented subject) and
  `test/makePack.ts` (generated packs of any size).

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
