import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeV15Sync, V15_SYNC_PATH } from '../../test/makeV15Sync';
import { MemoryDataStore } from './DataStore';
import { emptyCards, emptyFlags, FlagsDocSchema, type CardReview, type CardsDoc, type CardStateDoc } from './docs';
import { SafeStore } from './SafeStore';
import { docCodec, mergeCards, mergeCardsForSync, previewMerge } from './sync';
import { makeSyncFile, parseSyncFile } from './syncFile';

const state = (box: number, updatedAt: string): CardStateDoc => ({ box, dueDate: '2026-11-20', lastReviewedAt: updatedAt, updatedAt });
const review = (id: string, at: string, key = 'sample-orrin|c-alpha-0001'): CardReview => ({ id, cardKey: key, rating: 'got-it', at, device: '', cram: false });
const doc = (over: Partial<CardsDoc> = {}): CardsDoc => ({ ...emptyCards(), ...over });

describe('cards doc merge', () => {
  it('reviews are unioned by id; each card state comes from the copy with its newer review', () => {
    const phone = doc({ states: { k1: state(2, '2026-11-17T10:00:00Z'), k2: state(3, '2026-11-17T09:00:00Z') }, reviews: [review('r1', '2026-11-17T10:00:00Z')] });
    const laptop = doc({ states: { k1: state(4, '2026-11-17T12:00:00Z'), k3: state(1, '2026-11-16T09:00:00Z') }, reviews: [review('r2', '2026-11-17T12:00:00Z')] });
    const m = mergeCards(phone, laptop);
    expect(m.reviews.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(m.states.k1.box).toBe(4); // laptop reviewed it later
    expect(Object.keys(m.states).sort()).toEqual(['k1', 'k2', 'k3']);
  });

  it('an undone review stays undone when merged with a copy that still has it (tombstone)', () => {
    const before = doc({ states: { k1: state(2, '2026-11-17T10:00:00Z') }, reviews: [review('r1', '2026-11-17T10:00:00Z')] });
    const afterUndo = doc({ states: { k1: state(1, '2026-11-17T10:00:05Z') }, reviews: [], undone: [{ id: 'r1', at: '2026-11-17T10:00:05Z' }] });
    for (const m of [mergeCards(before, afterUndo), mergeCards(afterUndo, before)]) {
      expect(m.reviews).toEqual([]);
      expect(m.states.k1.box).toBe(1); // the undo's restored state is newer
    }
  });

  it('a save through SafeStore merges with what is saved (a stale in-memory copy loses nothing)', async () => {
    const inner = new MemoryDataStore();
    const safe = new SafeStore(inner);
    await inner.write('cards', doc({ reviews: [review('r1', '2026-11-17T10:00:00Z')] }));
    await safe.write('cards', doc({ reviews: [review('r2', '2026-11-17T11:00:00Z')] }));
    expect(((await inner.read('cards')) as CardsDoc).reviews.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('sync: merging the same file twice changes nothing, and the preview counts card reviews', () => {
    const local = doc({ reviews: [review('r1', '2026-11-17T10:00:00Z')] });
    const incoming = doc({ reviews: [review('r1', '2026-11-17T10:00:00Z'), review('r2', '2026-11-17T11:00:00Z'), review('r3', '2026-11-17T11:01:00Z')] });
    const once = mergeCardsForSync(local, incoming);
    expect(mergeCardsForSync(once, incoming)).toEqual(once);
    const base = makeSyncFile({ schemaVersion: 1, updatedAt: '', restoredAt: '', attempts: [], sessions: [], activeMock: null, settings: { hideFlagged: false, activePackId: null, newCardsPerDay: 20 } }, emptyFlags(), { device: '' });
    expect(previewMerge({ ...base, cards: local }, { ...base, cards: incoming }).cardReviews).toBe(2);
    expect(previewMerge({ ...base, cards: once }, { ...base, cards: incoming }).cardReviews).toBe(0);
  });

  it('a cards doc from a newer app version is refused, not overwritten', () => {
    expect(docCodec.parse('cards', { schemaVersion: 2 })).toMatchObject({ ok: false, newerVersion: true });
    expect(docCodec.parse('cards', emptyCards())).toMatchObject({ ok: true });
  });
});

describe('flags doc v1 → v2 (card flags)', () => {
  it('a v1 flags doc is read as v2 with every flag a question flag', () => {
    const v1 = { schemaVersion: 1, flags: [{ id: 'f1', packId: 'test-pack', packVersion: 1, questionId: 'q-a-0001', reason: 'typo', comment: 'x', mode: 'drill', createdAt: 't' }] };
    const r = FlagsDocSchema.parse(v1);
    expect(r.schemaVersion).toBe(2);
    expect(r.flags[0]).toMatchObject({ itemType: 'question', questionId: 'q-a-0001', comment: 'x' });
  });

  it('flags are written as v2, which v1.5 (anything above v1 is newer) leaves untouched instead of stripping itemType', () => {
    // v1.5's rule: any schemaVersion above 1 is "newer" and left untouched.
    const v15Refuses = (raw: { schemaVersion: number }) => raw.schemaVersion > 1;
    expect(v15Refuses(emptyFlags())).toBe(true);
  });
});

describe('sync file format 2 (v1.5) → 3', () => {
  const text = readFileSync(V15_SYNC_PATH, 'utf8');

  it('the fixture is up to date with its generator', () => {
    expect(JSON.parse(text)).toEqual(makeV15Sync());
  });

  it('a v1.5 sync file imports: upgraded to format 3 with empty card progress and flags v2', () => {
    const r = parseSyncFile(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.upgradedFrom).toBe(2);
    expect(r.file).toMatchObject({ formatVersion: 3, device: 'Laptop', appVersion: '1.5.0' });
    expect(r.file.cards).toEqual(emptyCards());
    expect(r.file.flags.schemaVersion).toBe(2);
    expect(r.file.progress.attempts).toHaveLength(9);
    expect(r.file.progress.settings.newCardsPerDay).toBe(20); // default filled in
  });
});
