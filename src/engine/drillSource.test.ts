import { describe, expect, it } from 'vitest';
import { attempt, makePack } from '../../test/makePack';
import { indexPack } from './packIndex';
import { mulberry32 } from './rng';
import { buildDrill, drillPool, type DrillFilter, type DrillSource } from './select';

// 4 alpha + 4 beta questions; alpha 1-2 and beta 1-2 are study bank.
const BANK = ['q-alpha-0001', 'q-alpha-0002', 'q-beta-0001', 'q-beta-0002'];
const pack = makePack({ alpha: 4, beta: 4 });
for (const q of pack.questions) if (BANK.includes(q.id)) q.origin = 'study-bank';
const ix = indexPack(pack);
const all = new Set(ix.topic.keys());
// Seen: alpha-1 (bank, right), alpha-3 (not bank, wrong), beta-1 (bank, wrong). Missed = last attempt wrong.
const attempts = [attempt('q-alpha-0001', true), attempt('q-alpha-0003', false), attempt('q-beta-0001', false)];

const ids = (source: DrillSource, filter: DrillFilter, topicIds: ReadonlySet<string> = all) =>
  drillPool(ix, attempts, { topicIds, filter, source, count: 'all' }).map((q) => q.id);

describe('drill source + filter combine', () => {
  it('source "all" is the old behaviour for every filter', () => {
    expect(ids('all', 'all')).toHaveLength(8);
    expect(ids('all', 'unseen')).toHaveLength(5);
    expect(ids('all', 'missed')).toEqual(['q-alpha-0003', 'q-beta-0001']);
  });

  it('bank + all / not seen / missed', () => {
    expect(ids('bank', 'all')).toEqual(BANK);
    expect(ids('bank', 'unseen')).toEqual(['q-alpha-0002', 'q-beta-0002']);
    expect(ids('bank', 'missed')).toEqual(['q-beta-0001']); // alpha-0003 is missed but not from the bank
  });

  it('the topic selection narrows every combination', () => {
    const beta = new Set(['beta-t']);
    expect(ids('bank', 'all', beta)).toEqual(['q-beta-0001', 'q-beta-0002']);
    expect(ids('bank', 'unseen', beta)).toEqual(['q-beta-0002']);
    expect(ids('bank', 'missed', beta)).toEqual(['q-beta-0001']);
  });

  it('the older "bank" filter still means study bank, all of it', () => {
    expect(ids('all', 'bank')).toEqual(BANK);
  });

  it('buildDrill draws only from the combined pool', () => {
    const qs = buildDrill(ix, attempts, { topicIds: all, filter: 'unseen', source: 'bank', count: 'all' }, mulberry32(1));
    expect(qs.map((q) => q.id).sort()).toEqual(['q-alpha-0002', 'q-beta-0002']);
  });
});
