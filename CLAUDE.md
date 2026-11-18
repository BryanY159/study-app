# Study app (public): project context for Claude Code

## Hard rule: no course content in this repo, ever
This repository is **public** and deployed to GitHub Pages. It must never contain
course or study content. That includes:
- content packs, except the synthetic fixtures in `test/fixtures/`;
- source files (slides, transcripts, worksheets), quotes from them, or slide images;
- real question, module or topic IDs and names, and real pack IDs;
- reports or drafts from a content pipeline.

If a task needs real content, it belongs in the private content repo, not here.
The CI leak guard (`npm run leak-guard`) catches mistakes, but **passing it does
not make content allowed.**

## Specs, mockups and plans
They live in the private content repo, at **`../study-app-content/docs/`**: intent,
spec, mockups, phase plans and v1 history. When a session needs them, add that
folder **read-only** (for example `/add-dir ../study-app-content/docs`) and read it
there. **Nothing from it may ever be copied into this repo:** no spec text, mockup
markup, images or sample data. Implement the behavior and write fresh, generic
code, tests and docs.

## What this repo is
- A generic study engine: drill, mock exam, feedback, progress, flags, backups.
  Subjects arrive only as packs imported in the app (History & data → Import pack…).
- The root package is also **`@study/pack`** (schema + validator, plus
  `@study/pack/engine`). The content repo installs it as
  `github:BryanY159/study-app#vX.Y.Z`.
- See `README.md` and `docs/architecture.md`.

## Stack
TypeScript, React, Vite (single-file build), Zod, Vitest, Playwright, Node 24.
Scripts: `dev`, `build`, `preview`, `typecheck`, `test`, `e2e`, `leak-guard`.

## Tests and fixtures
- Tests only use `test/fixtures/sample-pack.json` (an invented subject, "Imaginary
  Botany of Planet Orrin", `packId: sample-orrin`) or packs from `test/makePack.ts`.
- When a feature needs fixture data, extend the Orrin fixture with more invented
  content. Never adapt real material.
- Only the fixture pack IDs (`sample-orrin`, `test-pack`, `perf-pack`) may appear
  anywhere. New ones go in `ALLOWED_PACK_IDS` in `scripts/leak-guard.ts`.

## `@study/pack` contract
Everything exported from `src/pack/index.ts` and `src/engine/public.ts` is a
contract with the content repo. Any change to it needs a new version tag and a
note saying what the content repo must change. Keep `zod` as the only runtime
dependency, and don't add a `prepare` script.

## Releases
- Push to `main` / PR: CI runs leak guard → typecheck → unit → e2e → build → leak guard on `dist/`.
- Tag `vX.Y.Z`: the same checks, then deploy to GitHub Pages.

## Working style
- Follow the SDLC: plan first (plans live in the content repo's `docs/`), then
  build in small, tested steps.
- The maintainer is learning AI-assisted development and TypeScript, so briefly
  explain notable choices.
- Never push to this repo without the maintainer's explicit go-ahead.
