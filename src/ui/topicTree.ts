import type { PackIndex } from '../engine/packIndex';

// The model behind the collapsible group → module → topic tree (drill setup, card deck
// setup, the Home topic list). Pure functions, no React, so the rules are easy to test.

export type TreeKind = 'group' | 'module' | 'topic';

export interface TreeNode {
  /** Unique across the tree and stable across sessions: "g:<id>", "m:<id>" or "t:<id>". Used for expanded state. */
  id: string;
  kind: TreeKind;
  name: string;
  /** The raw group / module / topic id. */
  refId: string;
  children: TreeNode[];
  /** Every topic id at or below this node (just its own id for a topic). */
  topicIds: string[];
}

export type CheckState = 'checked' | 'unchecked' | 'mixed';

/**
 * Group → module → topic. Modules in no group sit at the top level after the groups, in pack
 * order. A pack without groups gives module → topic, as before. Modules and groups left with
 * no topics (after `includeTopic`) are dropped, e.g. modules that have no cards.
 */
export function buildTree(ix: PackIndex, includeTopic: (topicId: string) => boolean = () => true): TreeNode[] {
  const moduleNode = (moduleId: string): TreeNode | null => {
    const m = ix.module.get(moduleId);
    if (!m) return null;
    const children: TreeNode[] = m.topics
      .filter((t) => includeTopic(t.id))
      .map((t) => ({ id: `t:${t.id}`, kind: 'topic', name: t.name, refId: t.id, children: [], topicIds: [t.id] }));
    if (!children.length) return null;
    return { id: `m:${m.id}`, kind: 'module', name: m.name, refId: m.id, children, topicIds: children.flatMap((c) => c.topicIds) };
  };

  const out: TreeNode[] = [];
  for (const g of ix.group.values()) {
    // Module order follows the pack, not the order of g.moduleIds (D2).
    const inGroup = new Set(g.moduleIds);
    const children = ix.pack.modules.filter((m) => inGroup.has(m.id)).map((m) => moduleNode(m.id)).filter((n): n is TreeNode => !!n);
    if (children.length) out.push({ id: `g:${g.id}`, kind: 'group', name: g.name, refId: g.id, children, topicIds: children.flatMap((c) => c.topicIds) });
  }
  for (const m of ix.pack.modules) {
    if (ix.groupOf(m.id)) continue;
    const n = moduleNode(m.id);
    if (n) out.push(n);
  }
  return out;
}

/** Every node that has children (the ones that can open), at any depth. */
export function branchIds(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.children.length ? [n.id, ...branchIds(n.children)] : []));
}

/** Checked when every topic below is selected, mixed when only some are. */
export function checkState(node: TreeNode, selected: ReadonlySet<string>): CheckState {
  const on = node.topicIds.filter((id) => selected.has(id)).length;
  return on === 0 ? 'unchecked' : on === node.topicIds.length ? 'checked' : 'mixed';
}

/** The selection after ticking or unticking a node; it cascades to every topic below. Never changes `selected`. */
export function toggleNode(node: TreeNode, selected: ReadonlySet<string>, on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of node.topicIds) (on ? next.add(id) : next.delete(id));
  return next;
}

/** A number for every node, summed from a per-topic number (question counts, due cards…). */
export function sumBy(node: TreeNode, perTopic: (topicId: string) => number): number {
  return node.topicIds.reduce((n, id) => n + perTopic(id), 0);
}

/** The nodes above a topic: [group name?, module name]. Used for "Exam 2 › Endocrine" paths. */
export function topicPath(ix: PackIndex, topicId: string): string[] {
  const t = ix.topic.get(topicId);
  if (!t) return [];
  const g = ix.groupOf(t.moduleId);
  return [...(g ? [g.name] : []), ix.module.get(t.moduleId)?.name ?? ''].filter(Boolean);
}

/** The branch ids on the way down to each of these topics (so a preset selection is visible). */
export function ancestorsOf(nodes: readonly TreeNode[], topicIds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode): boolean => {
    const hit = n.kind === 'topic' ? topicIds.has(n.refId) : n.children.map(walk).some(Boolean);
    if (hit && n.children.length) out.push(n.id);
    return hit;
  };
  nodes.forEach(walk);
  return out;
}
