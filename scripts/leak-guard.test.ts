import { describe, expect, it } from 'vitest';
import { checkDist, checkSources, MAX_BYTES, MAX_ICON_BYTES, type ScanFile } from './leak-guard';

// Planted leaks are built at runtime (KEY), so this file never contains a
// literal pack-ID pair that the guard itself would flag.
const KEY = 'pack' + 'Id';
const file = (p: string, text: string, size = text.length): ScanFile => ({ path: p, size, text: () => text });
const packJson = (id: string) => JSON.stringify({ [KEY]: id, modules: [], questions: [] });

describe('leak guard: sources', () => {
  it('passes the fixture pack and ordinary files', () => {
    expect(checkSources([file('test/fixtures/sample-pack.json', packJson('sample-orrin')), file('src/a.ts', 'export const a = 1;')])).toEqual([]);
  });

  it('fails a pack file outside test/fixtures/', () => {
    const p = checkSources([file('content/real.json', packJson('sample-orrin'))]);
    expect(p.map((x) => x.check)).toContain('pack-file');
  });

  it('fails a pack-shaped file even without a packId', () => {
    const p = checkSources([file('data/x.json', JSON.stringify({ modules: [], questions: [] }))]);
    expect(p.map((x) => x.check)).toEqual(['pack-file']);
  });

  it('fails a foreign packId in any file, even a fixture', () => {
    const p = checkSources([file('test/fixtures/other.json', packJson('some-real-course')), file('src/x.ts', `const p = { ${KEY}: 'another-course' };`)]);
    expect(p.filter((x) => x.check === 'pack-id').map((x) => x.path)).toEqual(['test/fixtures/other.json', 'src/x.ts']);
  });

  it('fails files over the size limit, except package-lock.json', () => {
    const p = checkSources([file('src/big.ts', '', MAX_BYTES + 1), file('package-lock.json', '{}', MAX_BYTES * 2)]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ path: 'src/big.ts', check: 'size' });
  });

  it('fails slides, transcripts and images outside the icon folder', () => {
    const p = checkSources([file('docs/slides.pdf', ''), file('notes/part-1.txt', ''), file('src/fig.png', ''), file('public/icons/icon-192.png', '')]);
    expect(p.map((x) => x.path)).toEqual(['docs/slides.pdf', 'notes/part-1.txt', 'src/fig.png']);
  });

  it('fails an image in the icon folder that is too big to be an icon', () => {
    const p = checkSources([file('public/icons/icon-512.png', '', MAX_ICON_BYTES), file('public/icons/slide.png', '', MAX_ICON_BYTES + 1)]);
    expect(p).toEqual([expect.objectContaining({ path: 'public/icons/slide.png', check: 'size' })]);
  });
});

describe('leak guard: dist', () => {
  it('passes a build with no pack', () => {
    expect(checkDist([file('dist/index.html', '<script>const a={packId:x.packId}</script>')])).toEqual([]);
  });

  it('fails a build that embeds a foreign pack', () => {
    const p = checkDist([file('dist/index.html', `<script>var d=${packJson('a-real-course')}</script>`)]);
    expect(p).toHaveLength(1);
    expect(p[0].message).toContain('a-real-course');
  });
});
