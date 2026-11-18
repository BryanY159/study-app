import { useState } from 'react';
import { editableFlag } from '../../engine/flags';
import type { Question } from '../../pack/schema';
import { useApp } from '../../state/AppProvider';
import { FlagDialog } from './FlagDialog';

/** Flag button state + dialog for one question, usable from any screen (FR-5). */
export function useFlag(q: Question | undefined, mode: 'drill' | 'mock' | 'review') {
  const { flags, packs, ix, addFlag, updateFlag } = useApp();
  const [open, setOpen] = useState(false);
  const existing = q && ix ? editableFlag(flags.flags, packs, ix.pack.packId, q.id) : undefined;

  const dialog =
    open && q ? (
      <FlagDialog
        item={{ kind: 'question', id: q.id, text: q.stem }}
        initial={existing ? { reason: existing.reason, comment: existing.comment } : undefined}
        onClose={() => setOpen(false)}
        onSave={(reason, comment) => {
          if (existing) updateFlag(existing.id, { reason, comment });
          else addFlag({ itemType: 'question', questionId: q.id, reason, comment, mode, source: 'user' });
          setOpen(false);
        }}
      />
    ) : null;

  return { flagged: !!existing, open: () => setOpen(true), isOpen: open, dialog };
}
