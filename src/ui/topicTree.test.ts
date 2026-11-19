import { describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import { indexPack } from '../engine/packIndex';
import { ancestorsOf, branchIds, buildTree, checkState, sumBy, toggleNode, topicPath } from './topicTree';

// alpha + beta in "first", gamma in "second", delta in no group.
const grouped = indexPack(
  makePack(
    { alpha: 2, beta: 2, gamma: 2, delta: 2 },
    {
      moduleGroups: [
        { id: 'first', name: 'First', moduleIds: ['beta', 'alpha'] }, // order here must not matter
        { id: 'second', name: 'Second', moduleIds: ['gamma'] },
      ],
    },
  ),
);
const plain = indexPack(makePack({ alpha: 2, beta: 2 }));

describe('buildTree', () => {
  it('nests group > module > topic, ungrouped modules last, modules in pack order', () => {
    const tree = buildTree(grouped);
    expect(tree.map((n) => [n.kind, n.name])).toEqual([['group', 'First'], ['group', 'Second'], ['module', 'DELTA']]);
    expect(tree[0].children.map((n) => n.name)).toEqual(['ALPHA', 'BETA']);
    expect(tree[0].children[0].children.map((n) => [n.kind, n.refId])).toEqual([['topic', 'alpha-t']]);
    expect(tree[0].topicIds).toEqual(['alpha-t', 'beta-t']);
  });

  it('a pack without groups is module > topic, as before', () => {
    const tree = buildTree(plain);
    expect(tree.map((n) => n.kind)).toEqual(['module', 'module']);
    expect(branchIds(tree)).toEqual(['m:alpha', 'm:beta']);
  });

  it('drops empty branches', () => {
    const tree = buildTree(grouped, (t) => t === 'gamma-t');
    expect(tree.map((n) => n.name)).toEqual(['Second']);
    expect(branchIds(tree)).toEqual(['g:second', 'm:gamma']);
  });

  it('node ids are unique', () => {
    const ids = (ns: ReturnType<typeof buildTree>): string[] => ns.flatMap((n) => [n.id, ...ids(n.children)]);
    const all = ids(buildTree(grouped));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('selection', () => {
  const tree = buildTree(grouped);
  const [first, second] = tree;
  const alpha = first.children[0];

  it('cascades down and reports checked / mixed / unchecked at every level', () => {
    let sel = new Set<string>();
    expect(checkState(first, sel)).toBe('unchecked');
    sel = toggleNode(alpha, sel, true);
    expect(checkState(alpha, sel)).toBe('checked');
    expect(checkState(first, sel)).toBe('mixed');
    expect(checkState(second, sel)).toBe('unchecked');
    sel = toggleNode(first, sel, true);
    expect(checkState(first, sel)).toBe('checked');
    expect([...sel].sort()).toEqual(['alpha-t', 'beta-t']);
    sel = toggleNode(first.children[1], sel, false);
    expect(checkState(first, sel)).toBe('mixed');
    sel = toggleNode(first, sel, false);
    expect(sel.size).toBe(0);
  });

  it('does not change the selection it was given', () => {
    const sel = new Set(['alpha-t']);
    toggleNode(first, sel, true);
    expect([...sel]).toEqual(['alpha-t']);
  });

  it('a mixed module (two topics, one ticked) is mixed, and ticking a mixed node selects everything below', () => {
    const p = makePack({ alpha: 2 });
    p.modules[0].topics.push({ id: 'alpha-u', name: 'alpha second', source: '' });
    const node = buildTree(indexPack(p))[0];
    const sel = new Set(['alpha-t']);
    expect(checkState(node, sel)).toBe('mixed');
    expect(checkState(node, sel)).toBe('mixed');
    expect(checkState(node, toggleNode(node, sel, true))).toBe('checked');
  });
});

describe('counts, paths and presets', () => {
  it('sums a per-topic number at every level', () => {
    const tree = buildTree(grouped);
    const per = (id: string) => ({ 'alpha-t': 2, 'beta-t': 3, 'gamma-t': 4, 'delta-t': 5 })[id] ?? 0;
    expect(tree.map((n) => sumBy(n, per))).toEqual([5, 4, 5]);
    expect(sumBy(tree[0].children[1], per)).toBe(3);
  });

  it('topicPath is [group, module], or just the module when ungrouped', () => {
    expect(topicPath(grouped, 'alpha-t')).toEqual(['First', 'ALPHA']);
    expect(topicPath(grouped, 'delta-t')).toEqual(['DELTA']);
    expect(topicPath(plain, 'beta-t')).toEqual(['BETA']);
    expect(topicPath(plain, 'nope')).toEqual([]);
  });

  it('ancestorsOf lists the branches above preselected topics', () => {
    const tree = buildTree(grouped);
    expect(ancestorsOf(tree, new Set(['beta-t']))).toEqual(['m:beta', 'g:first']);
    expect(ancestorsOf(tree, new Set())).toEqual([]);
  });
});
