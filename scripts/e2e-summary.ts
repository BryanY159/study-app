// Prints a short summary of the failed (and flaky) Playwright tests from the JSON report that
// CI writes, so the job log names them without opening the HTML report. Also appended to the
// job summary page when GITHUB_STEP_SUMMARY is set. Never fails the job: the e2e step already did.
//
//   tsx scripts/e2e-summary.ts [path/to/results.json]

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_REPORT = 'test-results/results.json';

interface Result {
  status: string;
  error?: { message?: string };
}
interface Test {
  projectName: string;
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  results: Result[];
}
interface Spec {
  title: string;
  file: string;
  tests: Test[];
}
interface Suite {
  suites?: Suite[];
  specs?: Spec[];
}

export interface Problem {
  kind: 'failed' | 'flaky';
  name: string;
  /** First line of the last error, without terminal colour codes. */
  error: string;
}

const ANSI = /\u001b\[[0-9;]*m/g;

/** Failed and flaky tests in a Playwright JSON report, in report order. */
export function problemsIn(report: Suite): Problem[] {
  const out: Problem[] = [];
  const walk = (s: Suite) => {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests) {
        if (t.status !== 'unexpected' && t.status !== 'flaky') continue;
        const message = [...t.results].reverse().find((r) => r.error?.message)?.error?.message ?? '';
        out.push({
          kind: t.status === 'unexpected' ? 'failed' : 'flaky',
          name: `[${t.projectName}] ${spec.file} › ${spec.title}`,
          error: message.replace(ANSI, '').split('\n').find((l) => l.trim()) ?? '',
        });
      }
    }
    (s.suites ?? []).forEach(walk);
  };
  walk(report);
  return out;
}

export function formatSummary(problems: readonly Problem[]): string {
  if (!problems.length) return 'e2e: no failed or flaky tests in the report.';
  const failed = problems.filter((p) => p.kind === 'failed');
  const flaky = problems.filter((p) => p.kind === 'flaky');
  const lines = [`e2e: ${failed.length} failed, ${flaky.length} flaky (passed on a retry)`];
  for (const [label, list] of [['FAILED', failed], ['FLAKY', flaky]] as const) {
    for (const p of list) lines.push(`  ${label}  ${p.name}`, ...(p.error ? [`          ${p.error}`] : []));
  }
  return lines.join('\n');
}

function main() {
  const file = process.argv[2] ?? DEFAULT_REPORT;
  if (!existsSync(file)) {
    console.log(`e2e: no report at ${file} (the run stopped before writing one).`);
    return;
  }
  const text = formatSummary(problemsIn(JSON.parse(readFileSync(file, 'utf8')) as Suite));
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
