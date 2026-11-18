# Plan: build step 2 — storage on IndexedDB, manual sync

Status: **APPROVED 2026-11-17**, D1–D6 as proposed, with three confirmations
(tombstones across devices, a spike manifest, migrate-once with no later writes to
the old keys). See §12.
Scope: all saved data moves to IndexedDB, the data-folder code goes away, and a
sync file (export, then import with Merge or Replace) carries data between devices.
Release: `v1.5.0`, tagged and deployed to GitHub Pages.

This plan is about app code only and uses no course material. Examples use the
Orrin fixture (`test/fixtures/sample-pack.json`).

## 0. Where the code stands (v1.4.1)

| Area | Today | After step 2 |
|---|---|---|
| Progress + flags docs | `localStorage` (`studyapp:progress`, `studyapp:flags`) via `BrowserDataStore` | IndexedDB, via a new `IdbDataStore` |
| Set-aside (corrupt) copies | `localStorage` (`studyapp:set-aside:*`, max 3 per doc) | IndexedDB `setAside` store, same limit |
| Packs | IndexedDB (`studyapp-packs` / `packs`, idb-keyval) | unchanged |
| Merge-on-write, newer-version freeze, quarantine | `MirroredDataStore` (mixed with the folder queue) | a smaller `SafeStore` with the folder parts removed |
| Data folder | `FsAccessDataStore`, `folderConnection.ts`, `ConnectFolder.tsx`, `BackupOffer`, Data page section, Boot step 3 | removed |
| Backup file | `studyapp-backup` (progress + flags + `createdAt`) | replaced by a sync file (§3); the old format is still accepted on import |
| Restore | "Restore from backup…" → safety backup → confirm with counts → replace | becomes **Import sync file → Replace** (same flow) |
| Emergency backup on error screens | reads `localStorage` synchronously | reads IndexedDB (async), falls back to legacy `localStorage` |

The `@study/pack` exports (`src/pack/index.ts`, `src/engine/public.ts`) are **not
touched** by this step. The content repo needs no change and keeps its pinned tag.

## 1. Storage on IndexedDB

### 1.1 Database layout

One new database, `studyapp-data`, version 1, with three object stores:

- `docs`: key = `DocName` (`'progress' | 'flags'`), value = the doc object (stored
  as structured data, not a JSON string);
- `setAside`: key = copy name (`progress.corrupt-<time>.json`), value = `{ doc, text, reason }`;
- `meta`: small device-local values (key → value): `deviceLabel`, `lastExportAt`,
  `reminderSnoozedUntil`, `persisted`, `legacyMigratedAt`.

Packs stay in their existing `studyapp-packs` database, so already-imported packs
survive the upgrade with no migration.

**Why one store per kind, not one key per doc in idb-keyval:** each write is a
single IndexedDB transaction, and `meta` changes (like the snooze) never rewrite
the big progress doc. It's still small enough to write with the raw IndexedDB API
plus a ~40-line promise wrapper, so **no new dependency** (idb-keyval stays for packs).

**`meta` is never synced.** The device label, the reminder state and the persist
result belong to one device and are not part of the sync file.

### 1.2 `IdbDataStore` and `SafeStore`

- `IdbDataStore implements DataStore` (`kind: 'browser'`): `read`, `write`,
  `keepCopy`, plus `readMeta` / `writeMeta`. Opening the DB fails → Boot shows the
  existing startup error screen (same as blocked `localStorage` today).
- `SafeStore` wraps it and keeps every v1.4 protection that lived in `MirroredDataStore`:
  - **merge on write**: each write reads the saved doc and merges into it
    (`docCodec.merge`), unless `{ replace: true }` (restore / Replace import);
  - **newer-schema freeze**: a saved doc whose `schemaVersion` is higher than this
    app's is never written over; the app shows the existing "newer version" notice;
  - **quarantine**: a saved doc that fails to parse is kept in `setAside` and never
    used; a fresh doc starts and the startup report lists it;
  - **refuses to save an invalid doc** (schema check before every write).
- The folder queue, retries, status events, `attach/detach` and `flush` are deleted.
  Without a slow second copy, writes go straight through; `AppProvider` keeps its
  existing write chain so writes stay in order.

**Why keep merge-on-write when there's only one copy:** it still protects against
a stale in-memory copy (for example a tab that lost the lock, or a write racing a
sync import). It costs one read per write, which IndexedDB does in a few ms.

### 1.3 One-time move from `localStorage`

On startup, before loading docs, `migrateLegacy()` runs once:

1. If `meta.legacyMigratedAt` is set, skip.
2. Read `studyapp:progress` and `studyapp:flags` from `localStorage` (if any).
3. Write each one through `SafeStore` as a normal **merge** write, so parse
   failures are quarantined and newer-version data is left alone, as today.
4. Copy any `studyapp:set-aside:*` entries into `setAside`.
5. Set `meta.legacyMigratedAt`. **The `localStorage` keys are not deleted** in this
   release; they are a free fallback copy. Step 8 (release) removes them.
6. **Nothing writes to the old keys after this.** `BrowserDataStore` is reduced to
   a read-only `readLegacy()` helper; no code path calls `localStorage.setItem` with
   a `studyapp:` key.

A failure in steps 2–4 leaves `legacyMigratedAt` unset, so it retries next launch.

### 1.4 Single-tab rule

Unchanged: `TabLock` (Web Locks) is taken before any store is opened. The sync
import runs inside the tab that holds the lock, like every other write.

### 1.5 `navigator.storage.persist()`

- On startup (after the lock, not blocking it): if `navigator.storage?.persisted`
  says false, call `persist()` once per launch until granted. Store the result in
  `meta.persisted`.
- Data page shows one line: storage is persistent, or the browser may clear it,
  with a short hint to export a sync file regularly. If the API is missing, it says
  the browser didn't report its storage policy.
- Injected as a dependency (`storageManager`) so tests can fake granted / denied / missing.

### Tests (§1)

- `IdbDataStore` (Vitest + `fake-indexeddb`, already a dev dependency):
  round-trips both docs; `null` for a fresh DB; `meta` read/write; `keepCopy`
  keeps at most 3 copies per doc and skips duplicates.
- `SafeStore` (ported from `folder.test.ts`, folder parts dropped):
  - a stale write from memory merges and doesn't wipe newer saved answers;
  - `replace` replaces, and later writes build on it;
  - a removed flag stays removed when a write still carries it;
  - an unreadable saved doc is set aside and a fresh doc starts;
  - a doc with `schemaVersion: 2` is never written over and `newerVersionData` is true;
  - an invalid doc is refused.
- `migrateLegacy`:
  - v1.4.1 `localStorage` progress + flags (built from the Orrin fixture) end up in
    IndexedDB unchanged, including v1 attempts with no `id` (they get legacy ids);
  - runs only once; a second launch doesn't re-merge;
  - IndexedDB already has data + `localStorage` has more → merged, nothing lost;
  - corrupt `localStorage` progress → quarantined, flags still migrated;
  - newer-version `localStorage` data → not migrated, notice shown;
  - `localStorage` keys are still there afterwards;
  - **no writes to the old keys:** after migration, answering a question, flagging,
    importing a sync file and restoring leave every `studyapp:*` `localStorage` value
    byte-identical (a spy on `Storage.prototype.setItem` / `removeItem` sees no
    `studyapp:` key), and a second launch doesn't re-read them.
- `persist`: granted → "persistent"; denied → "may be cleared"; missing API → neutral line; called again on next launch only while not granted.
- Startup error screen: the rescue download reads IndexedDB; when IndexedDB is
  blocked it falls back to `localStorage` (ported C-4 test).
- Single tab: existing C-2 test still passes against the new Boot.

## 2. Removing the data-folder code

**Deleted:** `src/storage/FsAccessDataStore.ts`, `src/storage/folderConnection.ts`,
`src/storage/MirroredDataStore.ts` (replaced by `SafeStore`),
`src/ui/screens/ConnectFolder.tsx` (incl. `BackupOffer`), `test/fakeFs.ts`,
`src/storage/folder.test.ts` (after its non-folder tests move to `SafeStore`),
`e2e/folder.spec.ts`.

**Edited:**
- `Boot.tsx`: steps become 1 open IndexedDB → 2 take the lock → 3 migrate legacy
  → 4 AppProvider loads. `folderDeps`, `folderTimeoutMs`, `mirrorOptions` go away.
- `main.tsx`: passes `makeStore: () => new IdbDataStore()`.
- `AppProvider.tsx`: drop `folder`, `folderState`, `folderName`, `mirrorStatus`,
  `backupOfferPending`, `connectFolder`, `reconnectFolder`, `skipFolder`,
  `disconnectFolder`, `dismissBackupOffer`, and the folder subscription effect.
- `App.tsx`: no `ConnectFolder` first-run screen.
- `Dashboard.tsx`: no `BackupOffer`.
- `DataPage.tsx`: no "Data folder" section; the backup text no longer mentions a folder.
- `Header.tsx` / any save-status indicator that shows folder states.
- `resilience.test.tsx`: the two N-2 folder-timeout tests are removed.
- `docs/architecture.md` and `README.md`: storage section rewritten.

**Check:** `grep -ri "folder\|showDirectoryPicker\|FileSystem" src e2e test` finds
nothing except unrelated words (each hit reviewed). Typecheck proves no dangling imports.

### Tests (§2)

- `ui.test.tsx`: a first run goes straight to the No-pack screen (replaces the
  "connect-folder" expectation).
- Tests removed, with reasons, listed in the execution log (folder queue, retry,
  reconnect, OPFS e2e, N-2 timeouts).

## 3. Sync file: export

### 3.1 Format

```jsonc
{
  "kind": "studyapp-sync",
  "formatVersion": 2,          // v1.4 backups are format 1 (see §5)
  "appVersion": "1.5.0",       // from package.json, injected by Vite `define`
  "device": "Laptop",          // the device label, or "" if not set
  "createdAt": "2026-…Z",
  "progress": { …ProgressDoc… },
  "flags":    { …FlagsDoc… }
}
```

- A new Zod schema `SyncFileSchema` in `src/storage/syncFile.ts`. It lives in
  storage, **not** in `@study/pack`, so the package contract doesn't change.
- Step 6 adds `cards` (flashcard state) as an optional field. The format already
  has `formatVersion`, so that's an additive bump with an upgrade function.
- `activeMock` and `settings` are exported (they're in the doc) but ignored on
  Merge (see §4.2).

### 3.2 Export button

- Data page: **Export sync file**. File name `study-sync-<device>-<YYYY-MM-DD>.json`,
  where `<device>` is the label lowercased and reduced to `[a-z0-9-]` (fallback `device`).
- If no device label is set, the first export asks for one inline (text field +
  a few suggestions such as "Phone", "Tablet", "Laptop"). It can be changed later
  on the Data page.
- **How the file leaves the device:** if `navigator.canShare({ files: [file] })` is
  true (iOS/iPadOS Safari, some Android), call `navigator.share({ files })`, which
  opens the Share sheet. Otherwise use the existing `downloadFile` link.
  - The `File` is built before the click handler awaits anything, because
    `share()` needs the user's click to still count.
  - A cancelled share (`AbortError`) is not an error and doesn't count as an export.
- On success, `meta.lastExportAt` = now.
- **The old "Download backup" button goes away**; Export is the backup. The error
  screens' rescue download also writes the sync format (plus the `raw` entries).

### Tests (§3)

- `makeSyncFile` → `parseSyncFile` round-trips; includes `appVersion`, `device`, both docs.
- File name: label "My Laptop!" → `study-sync-my-laptop-2026-11-17.json`; empty label → `study-sync-device-…`.
- Export uses `share()` when `canShare` is true, the download link otherwise; a
  rejected share with `AbortError` leaves `lastExportAt` unchanged; success sets it.
- First export with no label shows the label prompt; the label is saved in `meta` and is **not** in the progress or flags doc.

## 4. Sync file: import

**Data page → Import sync file…** opens a file picker, parses the file (§5 upgrade
first), then shows a panel with two choices. **Merge** is preselected.

### 4.1 Preview (Merge)

Before anything is written, `previewMerge(local, incoming)` runs the merge in
memory and compares the result with the local docs:

- new answers = attempt IDs in the result but not in local;
- new sessions = session IDs likewise (shown only if > 0);
- flags added, flags updated (same ID, newer `updatedAt`), flags removed (by an
  incoming tombstone);
- step 6 adds card reviews to this summary.

The panel shows those counts, the file's device label and date, and **Merge** /
**Cancel** buttons. If every count is 0 it says the file adds nothing new, and
Merge is still allowed (it's harmless).

### 4.2 Merge rules for a sync import

`mergeForSync(local, incoming)` uses the same ID-based functions as today
(`mergeProgress`, `mergeFlags`) with **two deliberate differences**, because the
incoming file comes from another device, not from an older copy of this one:

1. **`restoredAt` is not applied across devices.** Today a copy restored earlier
   only contributes what came after the later restore. That made sense for two
   copies of one device's data. Across devices it would silently drop the other
   device's older answers (or this device's, if the other one restored). For a sync
   Merge, both sides are merged in full, and this device keeps its own `restoredAt`.
2. **Device-local fields stay local:** `settings` (active pack, hide-flagged) and
   `activeMock` (an exam in progress) always come from this device, even when the
   incoming doc is newer.

Everything else is unchanged: attempts union by ID, sessions union by ID (a
finished session beats an unfinished one), flags by ID with the newer per-flag
`updatedAt` winning, tombstones keep removed flags removed unless the flag was
changed after removal.

The merged docs are written with a normal (merge) write, and the doc `updatedAt`
is set to now.

**Idempotent by construction:** importing the same file again adds no IDs and changes no flags.

### 4.3 Replace

The existing restore flow, unchanged in behavior:
1. download a safety copy of the current data (now in the sync format);
2. confirm with current vs file counts (answers, flags);
3. replace both docs and stamp `restoredAt` (so the newer-copy rules still hold
   within this device).

### 4.4 Refusals

- Not JSON, or neither a sync file nor a v1.4 backup → readable error, nothing changes.
- `formatVersion` higher than this app knows, or a doc with a higher `schemaVersion`
  → "made by a newer version of the app; update first", nothing changes.
- During a mock exam the import is blocked with a short message (no import while an
  exam is running).

### Tests (§4)

- `previewMerge`: counts new answers, sessions, added / updated / removed flags against a hand-built local + incoming pair.
- **Idempotency:** merge A into B, then merge A again → identical docs (deep equal) and a preview of all zeros.
- **Order independence of records:** merge A then B and B then A → same attempt IDs, session IDs and flags.
- **Cross-device restore:** device A restored a backup yesterday; its sync file merged into device B keeps all of B's older answers (and the other way round).
- **Device-local:** an incoming newer doc doesn't change this device's `settings` or its `activeMock`.
- **Tombstones across devices (both directions):** a flag removed on device A is
  still present in device B's file → after Merge on A it stays removed; and A's file
  (with the tombstone) merged into B removes it there. Changed on the other device
  after the removal → it comes back. This holds although `restoredAt` is ignored
  for sync (D2).
- Replace: safety download first, Cancel changes nothing, confirm replaces and stamps `restoredAt` (ported C-3 tests).
- Refusals: invalid JSON, wrong `kind`, `formatVersion: 3`, a doc with `schemaVersion: 2` → error and unchanged data.
- UI (`ui.test.tsx`): Merge is preselected, the preview shows the counts, Merge writes and shows a done message; import is blocked during a mock.

## 5. Accepting v1.4 backups

- `parseSyncFile(text)` accepts:
  - `{ kind: 'studyapp-sync', formatVersion: 2, … }` as is;
  - `{ kind: 'studyapp-backup', createdAt, progress, flags }` (v1.4) → upgraded
    by `upgradeV1Backup()` to format 2 with `appVersion: '1.4'`, `device: ''`.
- The docs pass through the existing Zod schemas, which already fill v1 gaps
  (attempt `id` from `legacyAttemptId`, missing `updatedAt` / `restoredAt` / `removed`).
- A v1.4 backup can be used with **Merge or Replace**, like any sync file.
- Upgrades are a chain (`1 → 2`, later `2 → 3`), so each future format step adds one function.

### Fixture

`test/fixtures/sample-pack.v1-4-backup.json`: a file in the exact v1.4.1 backup
shape, built from the Orrin fixture: answers to several Orrin questions (some
legacy attempts without `id`), one finished drill session, one finished mock,
one user flag with a comment, the Orrin pre-flag, one tombstone. It's generated
once by a small script kept in `test/` (`makeV14Backup.ts`) so the file can be
rebuilt, and the leak guard's fixture rule already allows `test/fixtures/`.

### Tests (§5)

- The fixture parses with v1.4.1's `BackupSchema` (kept as `LegacyBackupSchema`), proving it's a real v1.4 file.
- It upgrades to format 2, and the upgraded docs equal what v1.4.1's own parser produced (attempt IDs, flags, tombstone).
- Merge into an empty device → all answers, sessions and flags present; dashboard counts match.
- Merge into a device that already has some of the same answers → no duplicates (idempotency on the upgraded file).
- Replace with the fixture → matches the fixture's counts and stamps `restoredAt`.

## 6. Backup reminder

- Shown on Home (Dashboard) when this device has at least one answer **and**
  `lastExportAt` is missing or older than **3 days** (a constant, `REMINDER_DAYS`,
  so the iOS spike result can change it in one line).
- Text (written fresh): how many days since the last export (or "not exported yet
  on this device"), and an **Export now** button that runs §3.2.
- **Dismiss** hides it until the same time tomorrow (`meta.reminderSnoozedUntil`).
- Never shown during a drill, a mock exam, or on the No-pack screen.
- Time comes from an injected clock, so tests don't depend on the real date.

### Tests (§6)

- No answers → no banner. Answers + never exported → banner. Exported 2 days ago → none; 4 days ago → banner with "4 days".
- Dismiss → gone; the clock + 23 h → still gone; + 25 h → back.
- Export now from the banner → banner disappears and `lastExportAt` is set.
- Not rendered inside a drill or mock.

## 7. Device label

- Set on first export (§3.2) or any time on the Data page (text field, max 30
  characters, trimmed). Stored in `meta.deviceLabel`.
- Shown on the Data page ("This device: Laptop") and written into each sync file.
- The Merge preview shows the incoming file's label, so it's clear which device it came from.

### Tests (§7)

- Set, reload, still there; trimmed; capped at 30 characters.
- Appears in the export file and in the preview of an imported file.
- Never appears in the progress or flags doc.

## 8. iOS storage spike

**Goal:** find out whether data saved by the app, added to the iPhone home screen,
survives closing it, restarting the phone, and a week without opening it.

**Problem:** iOS keeps a separate storage container only for a page opened from
the home screen in standalone mode, which needs `apple-mobile-web-app-capable`.
That's step 3 (PWA) for the app itself. So the spike uses its own tiny page.

**Spike page:** `public/spike/storage.html` plus `public/spike/manifest.webmanifest`
(Vite copies `public/` into `dist/` untouched, so the single-file app build isn't
affected). Plain HTML + inline script, no app code, no content:
- its own minimal manifest (`name`, `short_name`, `start_url: ./storage.html`,
  `scope: ./`, `display: standalone`), so iOS opens it from the home screen as a
  standalone app with its own storage; plus the iOS standalone meta tags;
- on open: writes a numbered "visit" record with a timestamp to IndexedDB **and**
  `localStorage`, reads all records back, and lists them;
- shows `navigator.storage.persisted()`, the result of `persist()`, and
  `navigator.storage.estimate()`;
- shows whether it's running standalone (`navigator.standalone`);
- a "Copy results" button to paste into the spike notes.

**`spike/ios-storage.md`** (in this repo, generic) holds the steps for you to run
on the iPhone and a table for the results:
1. In Safari open `https://bryany159.github.io/study-app/spike/storage.html`.
2. Share → Add to Home Screen. Open it from the home screen; confirm it says standalone.
3. Note visit #1 and the persist result.
4. Swipe the app away, reopen → visit #2 listed with #1.
5. Restart the phone, reopen → #1–#3 listed.
6. Don't open it for 7 days (also don't open Safari's copy), reopen → all earlier visits listed?
7. Copy results into the table, with the iOS version and free storage.

**Timing:** the spike page ships in a small early tag (**`v1.4.2`**, spike page
only), so the 7-day wait runs while the rest of step 2 is built. Its result sets
`REMINDER_DAYS` before `v1.5.0` (see D3). If data doesn't survive, the reminder
drops to every day and the Data page wording gets stronger.

### Tests (§8)

- Leak guard passes on the page (no pack, small, HTML only).
- e2e: the page loads from the built `dist/`, records visit #1, and a reload lists #1 and #2 (Chromium; this checks the page works, not iOS behavior).

## 9. End-to-end tests (Playwright)

Updated or new, all on the Orrin fixture:

- `flows.ts` / `drill.spec.ts` / `tabs.spec.ts`: unchanged behavior, now on IndexedDB.
- **New `sync.spec.ts`:**
  - two browser contexts = two devices. Device A answers 3 questions and sets a
    label; exports (download path). Device B answers 2 others, imports A's file:
    the preview shows +3 answers, Merge → B's history has 5. Import the same file
    again → preview shows nothing new, counts stay 5.
  - Replace on B with A's file → safety download happens, B then has A's 3.
  - Import the v1.4 backup fixture with Merge → its answers and flag appear.
- **New `migrate.spec.ts`:** seed `localStorage` with v1.4.1-shaped docs via
  `addInitScript` before first load → after start, the history shows them, and
  after a reload (with `localStorage` cleared) they're still there (now from IndexedDB).
- **Reminder:** with a faked `Date` (Playwright clock) 4 days after an export, the banner shows; Dismiss hides it.
- `build.spec.ts` (built file over `file://`): import → drill → reload keeps the answer (proves IndexedDB works for the built file).
- `folder.spec.ts`: deleted.

All e2e still run on desktop Chromium only; the three viewports are step 8.

## 10. Order of work (small, tested steps)

Each step ends green on `typecheck`, `test`, `e2e`, `leak-guard`, with one commit.

1. **Spike page** + `spike/ios-storage.md` + its e2e → commit → **stop for your
   go-ahead to tag and push `v1.4.2`** → you start the iPhone spike.
2. `IdbDataStore` + tests.
3. `SafeStore` (extracted from `MirroredDataStore`) + ported tests.
4. Boot / main / AppProvider switch to IndexedDB; `migrateLegacy` + tests; rescue
   download from IndexedDB. Folder code still present but unused.
5. Delete the folder code, screens and tests (§2).
6. `syncFile.ts` (schema, v1.4 upgrade) + the v1.4 fixture + tests (§5).
7. `mergeForSync` + `previewMerge` + tests (§4).
8. Data page: export (share/download), device label, import panel (Merge / Replace) + UI tests.
9. `persist()` + Data page line; backup reminder on Home + tests.
10. e2e (`sync`, `migrate`, reminder, build); docs (`architecture.md`, `README.md`).
11. Spike result → set `REMINDER_DAYS`; record the result in `spike/ios-storage.md`.
12. Bump `package.json` to `1.5.0`, full local run (3× e2e), leak guard on sources
    and `dist/` → **stop for your go-ahead** → push `main`, tag `v1.5.0`, push the tag.
13. Check the deploy: the Pages site returns 200; open it in Chrome; walk the
    manual checks in §11.

## 11. Release `v1.5.0` and checks

- CI on the tag: leak guard → typecheck → unit → e2e → build → leak guard `dist/` → deploy.
- `@study/pack` is unchanged in this release, so the content repo **keeps
  `#v1.4.1` and needs no change**. (It may move to `#v1.5.0` any time; nothing in
  the exported API differs.)
- **Manual check on your laptop (Chrome or Edge), on the deployed site:**
  1. The site opens with your step-1 data still there (moved from `localStorage`):
     same pack, same history.
  2. No "Choose data folder" screen anywhere.
  3. Data page shows the storage line (persistent or not) and lets you set a device label.
  4. Export sync file → a `study-sync-…json` download.
  5. In a private window (a second "device"): import the pack, import that file with
     Merge → the preview counts match, then the history matches.
  6. Import the same file again → nothing new.
  7. Import your v1.4.1 laptop backup (the one in the step-1 backup folder) with Merge in the private window → it's accepted.
- **On the iPhone** (Safari tab, not installed yet, since that's step 3): open the
  site, import the pack file, answer a question, Export → the Share sheet opens.

## 12. Decisions for you

- **D1: one file for backup and sync.** "Download backup" is replaced by "Export
  sync file", and "Restore from backup" by Import → Replace. Fewer buttons and one
  format. OK? (Alternative: keep both buttons, writing the same format.)
- **D2: sync Merge ignores `restoredAt` across devices and keeps `settings` /
  `activeMock` local (§4.2).** This differs from how two copies on one device were
  merged in v1.4, on purpose. OK?
- **D3: ship the spike page early as `v1.4.2`**, so the week-long wait overlaps the
  build. Alternative: ship it with `v1.5.0` and adjust the reminder in a later patch.
- **D4: leave the old `localStorage` keys in place until step 8** as a fallback copy. OK?
- **D5: version `v1.5.0`** (app feature release; package API unchanged). OK, or do
  you want `v2.0.0` to mark the storage change?
- **D6: the reminder also shows when this device has answers but has never
  exported.** OK?

## 13. Execution log

- **2026-11-17, §10 step 1 (spike page):**
  - `public/spike/storage.html` + `manifest.webmanifest`, `spike/ios-storage.md`,
    `e2e/spike.spec.ts` (2 tests, `preview` project).
  - `build.spec.ts` now expects `dist/` = `index.html` + `spike/` (the app itself is
    still one self-contained file).
  - `package.json` 1.4.2. `@study/pack` exports unchanged, so the content repo needs no change.
  - Typecheck clean, unit 117/117, e2e 15/15, leak guard clean on sources and `dist/`.
  - Waiting for the go-ahead to push `main` and tag `v1.4.2`.
