import { useCallback, useMemo, useState } from 'react';

// Which tree branches are open, remembered per device (not synced or backed up).
// The key has its own "study-ui:" prefix: "studyapp:" keys are read as pre-v1.5 data by storage/legacy.ts.
// Everything is in try/catch: with storage blocked the tree still works, it just forgets.

const PREFIX = 'study-ui:tree:';

function load(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(key: string, ids: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage blocked or full: forget */
  }
}

export interface Expanded {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Open exactly these branches / close everything (the "Expand all" and "Collapse all" links). */
  setAll: (ids: readonly string[]) => void;
}

/**
 * Open branches for one screen of one pack. Collapsed by default. `presetOpen` branches (the
 * path to a preselected topic) start open on this visit but are not saved unless she touches them.
 */
export function useExpanded(screen: string, packId: string, presetOpen: readonly string[] = []): Expanded {
  const key = `${PREFIX}${screen}:${packId}`;
  const preset = useMemo(() => new Set(presetOpen), [presetOpen.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState(() => ({ open: new Set([...load(key), ...preset]), touched: new Set<string>() }));

  const commit = useCallback(
    (open: Set<string>, touched: Set<string>) => {
      setState({ open, touched });
      save(key, [...open].filter((id) => touched.has(id) || !preset.has(id)));
    },
    [key, preset],
  );

  const toggle = useCallback(
    (id: string) => {
      const open = new Set(state.open);
      if (open.has(id)) open.delete(id);
      else open.add(id);
      commit(open, new Set(state.touched).add(id));
    },
    [state, commit],
  );

  const setAll = useCallback(
    (ids: readonly string[]) => commit(new Set(ids), new Set([...state.touched, ...ids, ...state.open])),
    [state, commit],
  );

  return useMemo(() => ({ isOpen: (id: string) => state.open.has(id), toggle, setAll }), [state, toggle, setAll]);
}
