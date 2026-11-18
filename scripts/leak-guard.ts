// Leak guard: this repo is public, so it may never contain course content.
//
//   npm run leak-guard            check every tracked file (git ls-files)
//   npm run leak-guard -- --dist  also check the built output in dist/
//
// It works by ALLOWLIST only (allowed pack IDs, allowed folders), so this
// public file never has to name any real course term. It catches mistakes;
// passing it does not make content allowed. Exits 1 on any problem.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The only pack IDs that may appear anywhere: the synthetic fixtures used by tests. */
export const ALLOWED_PACK_IDS = ['sample-orrin', 'test-pack', 'perf-pack'];
/** Pack files may live only here. */
export const PACK_DIR = 'test/fixtures/';
export const MAX_BYTES = 256 * 1024;
export const SIZE_EXEMPT = ['package-lock.json'];
/** File types that usually mean copied course material (slides, transcripts, scans). */
export const BLOCKED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.docx', '.pptx', '.doc', '.ppt'];
/** Folders where some blocked types are allowed (app icons arrive in a later step). */
export const BINARY_ALLOWED_DIRS = ['public/icons/'];

export interface ScanFile {
  path: string; // repo-relative, forward slashes
  size: number;
  text: () => string;
}

export interface Problem {
  path: string;
  check: 'pack-file' | 'pack-id' | 'size' | 'file-type';
  message: string;
}

const PACK_ID_RE = /["'`]?packId["'`]?\s*:\s*["'`]([^"'`\s]+)["'`]/g;

export function foreignPackIds(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PACK_ID_RE)) if (!ALLOWED_PACK_IDS.includes(m[1])) found.add(m[1]);
  return [...found];
}

function looksLikePack(text: string): boolean {
  try {
    const v = JSON.parse(text);
    return !!v && typeof v === 'object' && !Array.isArray(v) && ('packId' in v || ('questions' in v && 'modules' in v));
  } catch {
    return false;
  }
}

/** Checks for tracked source files. */
export function checkSources(files: ScanFile[]): Problem[] {
  const problems: Problem[] = [];
  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    if (f.size > MAX_BYTES && !SIZE_EXEMPT.includes(f.path)) {
      problems.push({ path: f.path, check: 'size', message: `${f.size} bytes is over the ${MAX_BYTES}-byte limit` });
    }
    if (BLOCKED_EXT.includes(ext) && !BINARY_ALLOWED_DIRS.some((d) => f.path.startsWith(d))) {
      problems.push({ path: f.path, check: 'file-type', message: `${ext} files are not allowed in this repo` });
    }
    if (BLOCKED_EXT.includes(ext) || f.size > 4 * MAX_BYTES) continue; // don't read binaries or huge files as text
    const text = f.text();
    if (ext === '.json' && !f.path.startsWith(PACK_DIR) && looksLikePack(text)) {
      problems.push({ path: f.path, check: 'pack-file', message: `looks like a content pack; packs may only live in ${PACK_DIR}` });
    }
    for (const id of foreignPackIds(text)) {
      problems.push({ path: f.path, check: 'pack-id', message: `packId "${id}" is not one of the test fixtures (${ALLOWED_PACK_IDS.join(', ')})` });
    }
  }
  return problems;
}

/** Checks for the built output: no pack other than a test fixture may be in it. */
export function checkDist(files: ScanFile[]): Problem[] {
  return files.flatMap((f) =>
    foreignPackIds(f.text()).map((id) => ({ path: f.path, check: 'pack-id' as const, message: `built output contains packId "${id}"` })),
  );
}

function diskFile(root: string, rel: string): ScanFile {
  const abs = path.join(root, rel);
  return { path: rel.split(path.sep).join('/'), size: statSync(abs).size, text: () => readFileSync(abs, 'utf8') };
}

function walk(root: string, dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(root, path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const problems = checkSources(tracked.map((f) => diskFile(root, f)));
  let distCount = 0;
  if (process.argv.includes('--dist')) {
    const dist = walk(root, 'dist');
    distCount = dist.length;
    problems.push(...checkDist(dist.map((f) => diskFile(root, f))));
  }
  for (const p of problems) console.error(`✗ [${p.check}] ${p.path}: ${p.message}`);
  console.log(`leak guard: ${tracked.length} tracked files${distCount ? `, ${distCount} dist files` : ''}, ${problems.length} problem(s)`);
  if (problems.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
