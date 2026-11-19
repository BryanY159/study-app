import { useId, type ReactNode } from 'react';
import { branchIds, checkState, toggleNode, type TreeNode } from '../topicTree';
import type { Expanded } from '../useExpanded';

interface Selection {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}

interface Props {
  nodes: readonly TreeNode[];
  expanded: Expanded;
  /** Give it a selection for cascading checkboxes; leave it out for a read-only tree (Home). */
  selection?: Selection;
  /** The right-hand side of a row: counts, accuracy… */
  meta?: (node: TreeNode) => ReactNode;
  /** Label for the whole list, e.g. "Topics". */
  label: string;
}

/**
 * Collapsible group → module → topic tree. Branches use native buttons (`aria-expanded`) and
 * checkboxes (`indeterminate` for a partly-selected branch), so Tab, Space and Enter work and
 * screen readers announce them without extra key handling. Rows and buttons are 44 px tall.
 */
export function TopicTree({ nodes, expanded, selection, meta, label }: Props) {
  const prefix = useId();
  const all = branchIds(nodes);
  const anyOpen = all.some(expanded.isOpen);
  return (
    <div className="ttree" data-testid="topic-tree">
      {all.length > 0 && (
        <div className="ttree-tools">
          <button type="button" className="linkish" onClick={() => expanded.setAll(anyOpen ? [] : all)} data-testid="tree-expand-all">
            {anyOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}
      <ul className="ttree-list" aria-label={label}>
        {nodes.map((n) => (
          <Node key={n.id} node={n} prefix={prefix} expanded={expanded} selection={selection} meta={meta} />
        ))}
      </ul>
    </div>
  );
}

function Node({ node, prefix, expanded, selection, meta }: { node: TreeNode; prefix: string } & Pick<Props, 'expanded' | 'selection' | 'meta'>) {
  const branch = node.children.length > 0;
  const open = branch && expanded.isOpen(node.id);
  const childrenId = `${prefix}-${node.id}`;
  const state = selection ? checkState(node, selection.selected) : 'unchecked';
  const metaEl = meta?.(node);

  const name = selection ? (
    <label className="tt-label">
      <input
        type="checkbox"
        checked={state === 'checked'}
        ref={(el) => {
          if (el) el.indeterminate = state === 'mixed';
        }}
        onChange={(e) => selection.onChange(toggleNode(node, selection.selected, e.target.checked))}
        data-testid={`tree-check-${node.kind}`}
      />
      <span>{node.name}</span>
    </label>
  ) : branch ? null : (
    <span className="tt-label">
      <span>{node.name}</span>
    </span>
  );

  return (
    <li className={`tt-node tt-${node.kind}`} data-testid={`tree-${node.kind}`}>
      <div className="tt-row">
        {branch ? (
          <button
            type="button"
            className={selection ? 'tt-chev' : 'tt-chev tt-chev-named'}
            aria-expanded={open}
            aria-controls={open ? childrenId : undefined}
            aria-label={selection ? `${open ? 'Collapse' : 'Expand'} ${node.name}` : undefined}
            onClick={() => expanded.toggle(node.id)}
            data-testid={`tree-toggle-${node.kind}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={open ? 'tt-arrow open' : 'tt-arrow'}>
              <path d="m9 6 6 6-6 6" />
            </svg>
            {!selection && <span className="tt-label">{node.name}</span>}
          </button>
        ) : (
          <span className="tt-spacer" aria-hidden="true" />
        )}
        {name}
        {metaEl != null && <span className="tt-meta">{metaEl}</span>}
      </div>
      {open && (
        <ul id={childrenId} className="ttree-list ttree-children" aria-label={node.name}>
          {node.children.map((c) => (
            <Node key={c.id} node={c} prefix={prefix} expanded={expanded} selection={selection} meta={meta} />
          ))}
        </ul>
      )}
    </li>
  );
}
