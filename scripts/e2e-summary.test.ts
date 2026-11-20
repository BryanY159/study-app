import { describe, expect, it } from 'vitest';
import { formatSummary, problemsIn } from './e2e-summary';

const ok = { status: 'passed' };
const report: Parameters<typeof problemsIn>[0] = {
  suites: [
    {
      specs: [],
      suites: [
        {
          specs: [
            { title: 'passes', file: 'a.spec.ts', tests: [{ projectName: 'phone', status: 'expected', results: [ok] }] },
            {
              title: 'fails',
              file: 'a.spec.ts',
              tests: [{ projectName: 'tablet', status: 'unexpected', results: [{ status: 'failed', error: { message: '\u001b[31mfirst try\u001b[39m' } }, { status: 'failed', error: { message: '\u001b[31mExpected: 3\u001b[39m\nReceived: 2' } }] }],
            },
            { title: 'skipped', file: 'b.spec.ts', tests: [{ projectName: 'desktop', status: 'skipped', results: [] }] },
          ],
          suites: [{ specs: [{ title: 'sometimes', file: 'b.spec.ts', tests: [{ projectName: 'desktop', status: 'flaky', results: [{ status: 'failed', error: { message: 'timeout' } }, ok] }] }] }],
        },
      ],
    },
  ],
};

describe('e2e summary', () => {
  it('lists failed and flaky tests, with the last error\'s first line and no colour codes', () => {
    expect(problemsIn(report)).toEqual([
      { kind: 'failed', name: '[tablet] a.spec.ts › fails', error: 'Expected: 3' },
      { kind: 'flaky', name: '[desktop] b.spec.ts › sometimes', error: 'timeout' },
    ]);
  });

  it('formats names under FAILED and FLAKY headings', () => {
    const text = formatSummary(problemsIn(report));
    expect(text).toMatch(/^e2e: 1 failed, 1 flaky/);
    expect(text).toContain('FAILED  [tablet] a.spec.ts › fails');
    expect(text).toContain('FLAKY  [desktop] b.spec.ts › sometimes');
  });

  it('says so when nothing failed', () => {
    expect(formatSummary(problemsIn({ suites: [] }))).toMatch(/no failed or flaky/);
  });
});
