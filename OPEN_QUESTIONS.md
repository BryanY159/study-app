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

## Q2. How many topics does "Drill weakest" drill?
- **Context:** FR-17 says Home shows the **5** weakest topics by default, but not how many the action drills. v1 drilled the 3 weakest.
- **Options:** drill the 3 weakest (as v1); drill the 5 shown; drill whatever is shown (5, or all after "Show all").
- **Default chosen:** keep **3** (`WEAKEST_DRILLED` in `src/engine/progress.ts`). The button says how many ("Drill weakest 3 topics"), so it's never ambiguous. Changing it is a one-line edit.
- Used in: `src/ui/screens/Dashboard.tsx`.

