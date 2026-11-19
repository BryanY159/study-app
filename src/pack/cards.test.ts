import { describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import { MAX_CARD_IMAGE_BYTES, PACK_WARN_BYTES, parsePack } from './checks';
import { cardsOf, type Pack } from './schema';

// Flashcards in a pack (@study/pack contract). makePack gives modules a and b, topics a-t and b-t,
// and questions q-a-0001… / q-b-0001….

const SVG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>').toString('base64');
const card = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c-a-0001',
  topicIds: ['a-t'],
  type: 'term',
  front: 'Invented term',
  back: 'Its invented meaning.',
  sources: [{ file: 'source/sample/a.pdf', locator: 'slide 1' }],
  status: 'verified',
  ...over,
});
const withCards = (...cards: Record<string, unknown>[]): unknown => ({ ...makePack({ a: 2, b: 2 }), flashcards: cards });
const errors = (data: unknown) => {
  const r = parsePack(data);
  return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`);
};

describe('flashcards in a pack', () => {
  it('a pack without flashcards still parses; cardsOf gives []', () => {
    const r = parsePack(makePack({ a: 2 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(cardsOf(r.pack)).toEqual([]);
  });

  it('accepts all four card types', () => {
    const r = parsePack(
      withCards(
        card(),
        card({ id: 'c-a-0002', type: 'concept' }),
        card({ id: 'c-a-0003', type: 'cloze', front: 'The ____ glows at night.', back: 'lumen sac' }),
        card({ id: 'c-a-0004', type: 'diagram', front: 'Name the part labelled B.', back: 'Root crown', label: 'B', image: { data: SVG, alt: 'A plant', labels: [{ key: 'A', x: 0.2, y: 0.3 }, { key: 'B', x: 0.6, y: 0.8 }] } }),
      ),
    );
    expect(r.ok && r.warnings).toEqual([]);
    if (r.ok) {
      expect(cardsOf(r.pack).map((c) => c.type)).toEqual(['term', 'concept', 'cloze', 'diagram']);
      expect(cardsOf(r.pack)[0]).toMatchObject({ image: null, relatedQuestionIds: [] }); // defaults
    }
  });

  it.each([
    ['a bad id', card({ id: 'card-1' }), /flashcards\.0\.id: must look like c-<prefix>-0001/],
    ['a duplicate id', [card(), card()], /duplicate card id "c-a-0001"/],
    ['an unknown topic', card({ topicIds: ['nope'] }), /unknown topic "nope"/],
    ['topics from two modules', card({ topicIds: ['a-t', 'b-t'] }), /topics span several modules/],
    ['a cloze card without a blank', card({ type: 'cloze', front: 'No blank here.' }), /exactly one ____ \(found 0\)/],
    ['a cloze card with two blanks', card({ type: 'cloze', front: 'The ____ and the ____.' }), /exactly one ____ \(found 2\)/],
    ['a diagram card without an image', card({ type: 'diagram', label: 'A' }), /a diagram card needs an image/],
    ['a diagram card without labels', card({ type: 'diagram', label: 'A', image: { data: SVG, alt: 'x', labels: [] } }), /needs at least one label/],
    ['a diagram card without its label', card({ type: 'diagram', image: { data: SVG, alt: 'x', labels: [{ key: 'A', x: 0, y: 0 }] } }), /needs a label naming the part/],
    ['a diagram label not on the image', card({ type: 'diagram', label: 'C', image: { data: SVG, alt: 'x', labels: [{ key: 'A', x: 0, y: 0 }] } }), /label "C" is not one of the image's labels/],
    ['a label on a non-diagram card', card({ label: 'A' }), /only diagram cards have a label/],
    ['a label point outside the image', card({ type: 'diagram', label: 'A', image: { data: SVG, alt: 'x', labels: [{ key: 'A', x: 1.2, y: 0 }] } }), /x: must be between 0 and 1/],
    ['an image without alt text', card({ image: { data: SVG, alt: '', labels: [] } }), /image\.alt: must not be empty/],
    ['an image given as a file path', card({ image: { data: 'figures/plant.png', alt: 'x' } }), /must be embedded as a data:image/],
    ['a related question that does not exist', card({ relatedQuestionIds: ['q-a-0099'] }), /unknown question "q-a-0099"/],
    ['unconfirmed without a preflag', card({ status: 'unconfirmed' }), /unconfirmed cards need a preflag/],
    ['a preflag on a verified card', card({ preflag: { reason: 'unclear', note: 'x' } }), /preflag is only allowed on unconfirmed cards/],
    ['no source', card({ sources: [] }), /needs at least one source/],
  ])('rejects %s', (_name, c, re) => {
    const list = Array.isArray(c) ? c : [c];
    expect(errors(withCards(...list)).join('\n')).toMatch(re);
  });

  it('rejects an image over the size limit', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(MAX_CARD_IMAGE_BYTES);
    expect(errors(withCards(card({ image: { data: big, alt: 'x' } }))).join('\n')).toMatch(/limit is 400 KB/);
  });

  it('accepts an unconfirmed card with a preflag and related questions that resolve', () => {
    expect(errors(withCards(card({ status: 'unconfirmed', preflag: { reason: 'unclear', note: 'Sources disagree.' }, relatedQuestionIds: ['q-a-0001'] })))).toEqual([]);
  });

  it('warns (not fails) when the whole pack is over 15 MB', () => {
    const pack = withCards(card()) as Pack;
    const padded = { ...pack, title: 'x'.repeat(PACK_WARN_BYTES) };
    const r = parsePack(padded);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.message).join()).toMatch(/MB; over 15 MB it may be slow/);
  });
});

describe('flagged-fixed cards (v2.1.0)', () => {
  it('a flagged-fixed card parses, with or without fixedIn', () => {
    expect(errors(withCards(card({ status: 'flagged-fixed', fixedIn: 2 })))).toEqual([]);
    expect(errors(withCards(card({ status: 'flagged-fixed' })))).toEqual([]);
  });

  it('fixedIn is only allowed on flagged-fixed cards, and must be a positive integer', () => {
    expect(errors(withCards(card({ status: 'verified', fixedIn: 2 }))).join('\n')).toMatch(/fixedIn is only allowed on flagged-fixed cards/);
    expect(errors(withCards(card({ status: 'flagged-fixed', fixedIn: 0 }))).length).toBeGreaterThan(0);
    expect(errors(withCards(card({ status: 'flagged-fixed', fixedIn: 1.5 }))).length).toBeGreaterThan(0);
  });

  it('a pack with only the old statuses still loads', () => {
    for (const status of ['draft', 'verified']) expect(errors(withCards(card({ status })))).toEqual([]);
  });

  it('an unconfirmed card still needs its preflag', () => {
    expect(errors(withCards(card({ status: 'unconfirmed' }))).join('\n')).toMatch(/need a preflag/);
  });
});
