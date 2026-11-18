import { describe, expect, it, vi } from 'vitest';
import { requestPersistence } from './persist';
import { reminderDue, snoozeUntil } from './reminder';

const now = new Date('2026-11-17T12:00:00.000Z');
const daysAgo = (d: number, h = 0) => new Date(now.getTime() - d * 86_400_000 - h * 3_600_000).toISOString();

describe('backup reminder', () => {
  it('nothing saved yet → no reminder', () => {
    expect(reminderDue({ answers: 0, now })).toBeNull();
  });

  it('answers but never exported from this device → reminder', () => {
    expect(reminderDue({ answers: 3, now })).toEqual({ daysSince: null });
  });

  it('exported 2 or 3 days ago → none; 4 days ago → reminder saying 4 days', () => {
    expect(reminderDue({ answers: 3, lastExportAt: daysAgo(2), now })).toBeNull();
    expect(reminderDue({ answers: 3, lastExportAt: daysAgo(3), now })).toBeNull();
    expect(reminderDue({ answers: 3, lastExportAt: daysAgo(4), now })).toEqual({ daysSince: 4 });
  });

  it('dismissed: hidden for a day, then back', () => {
    const until = snoozeUntil(now);
    const later = (h: number) => new Date(now.getTime() + h * 3_600_000);
    expect(reminderDue({ answers: 3, snoozedUntil: until, now: later(23) })).toBeNull();
    expect(reminderDue({ answers: 3, snoozedUntil: until, now: later(25) })).toEqual({ daysSince: null });
  });

  it('the threshold can be changed in one place (spike result)', () => {
    expect(reminderDue({ answers: 1, lastExportAt: daysAgo(1, 1), now, days: 1 })).toEqual({ daysSince: 1 });
  });
});

describe('navigator.storage.persist()', () => {
  it('already persistent → does not ask again', async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistence({ persisted: async () => true, persist })).toBe('persistent');
    expect(persist).not.toHaveBeenCalled();
  });

  it('not yet → asks; granted or denied is reported', async () => {
    expect(await requestPersistence({ persisted: async () => false, persist: async () => true })).toBe('persistent');
    expect(await requestPersistence({ persisted: async () => false, persist: async () => false })).toBe('not-persistent');
  });

  it('missing API or an error → unknown', async () => {
    expect(await requestPersistence(null)).toBe('unknown');
    expect(await requestPersistence({})).toBe('unknown');
    expect(await requestPersistence({ persisted: async () => Promise.reject(new Error('x')) })).toBe('unknown');
  });
});
