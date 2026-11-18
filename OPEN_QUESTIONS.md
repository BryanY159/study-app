# Open questions: build steps 3–6 run

Each entry has the question, the options, **the default I chose** (and used), and
where it's used. Please review at the end of the run.

## Q1. Saves lost on a reload right after answering (WebKit)
- **What happened:** in Playwright's WebKit, a mock-exam answer that was already readable in IndexedDB was sometimes gone after an immediate reload (about 2 in 5 runs under load). This was the case before any step-4 change too.
- **Options:**
  1. strict durability on every IndexedDB write;
  2. delay the reload in the test;
  3. also mirror the last change somewhere synchronous.
- **Default chosen:** (1). `IdbDataStore` opens every readwrite transaction with `{ durability: 'strict' }`. It costs a few ms per save, and the tests are now green across 3 full runs and 20 repeats. The tests still don't wait any extra time, so the assertion is unchanged.
- **Your part:** the iOS spike already covers closing the app. When you run it, also try answering a question in the real app and closing it straight away; the answer should be there when you reopen it.
- Used in: `src/storage/IdbDataStore.ts`.

