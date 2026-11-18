import { cardsOf, type Pack } from '../pack/schema';
import type { Flag, FlagReason } from '../storage/docs';
import { correctKeys } from './scoring';

export const REASON_LABEL: Record<FlagReason, string> = {
  'answer-wrong': 'Answer wrong',
  'explanation-wrong': 'Explanation wrong',
  unclear: 'Unclear',
  typo: 'Typo',
  other: 'Other',
};

export type FlagState = 'open' | 'resolved' | 'missing';

/**
 * FR-6: a flag is "Resolved — re-check" once a newer pack version marks the
 * question flagged-fixed, and that fix (`fixedIn`) came after the flag was made.
 * A flag made on the fixed version itself stays open until a later version fixes it again. "missing" means the question is gone from the pack.
 */
export function flagState(flag: Flag, packs: readonly Pack[]): FlagState {
  const pack = packs.find((p) => p.packId === flag.packId);
  if (flag.itemType === 'card') {
    const c = pack ? cardsOf(pack).find((x) => x.id === flag.questionId) : undefined;
    if (!pack || !c) return 'missing';
    // Cards have no fixedIn; a card pre-flag is settled once a newer pack no longer ships it as unconfirmed.
    if (flag.source === 'preflag' && pack.version > flag.packVersion && c.status !== 'unconfirmed') return 'resolved';
    return 'open';
  }
  const q = pack?.questions.find((x) => x.id === flag.questionId);
  if (!pack || !q) return 'missing';
  // Packs from before v1.4.1 have no fixedIn: treat the current version as the fix.
  if (q.status === 'flagged-fixed' && (q.fixedIn ?? pack.version) > flag.packVersion) return 'resolved';
  // A pre-flag is settled once a newer pack no longer ships the question as unconfirmed.
  if (flag.source === 'preflag' && pack.version > flag.packVersion && q.status !== 'unconfirmed') return 'resolved';
  return 'open';
}

/** The flag the Flag button edits. A resolved flag is done with: flagging the question again starts a new one. */
export function editableFlag(flags: readonly Flag[], packs: readonly Pack[], packId: string, questionId: string, itemType: Flag['itemType'] = 'question'): Flag | undefined {
  return flags.find((f) => f.packId === packId && f.itemType === itemType && f.questionId === questionId && flagState(f, packs) !== 'resolved');
}

/**
 * Open a flag for every unconfirmed question or card that has none yet, so
 * pre-flagged items appear in the Flags list where she can add comments.
 * Returns null when nothing needs adding.
 */
export function seedPreflags(flags: readonly Flag[], packs: readonly Pack[], now = new Date()): Flag[] | null {
  const have = new Set(flags.map((f) => `${f.packId}|${f.itemType}|${f.questionId}`));
  const added: Flag[] = [];
  for (const p of packs) {
    const items = [
      ...p.questions.map((q) => ({ kind: 'question' as const, item: q })),
      ...cardsOf(p).map((c) => ({ kind: 'card' as const, item: c })),
    ];
    for (const { kind, item: q } of items) {
      if (q.status !== 'unconfirmed' || !q.preflag || have.has(`${p.packId}|${kind}|${q.id}`)) continue;
      added.push({
        id: `preflag-${p.packId}-${q.id}`,
        packId: p.packId,
        packVersion: p.version,
        itemType: kind,
        questionId: q.id,
        reason: q.preflag.reason,
        comment: '',
        mode: 'review',
        source: 'preflag',
        createdAt: now.toISOString(),
        // Seeded by the app: any copy she has touched wins a merge.
        updatedAt: '',
      });
    }
  }
  return added.length ? [...flags, ...added] : null;
}

/**
 * Drop seeded pre-flags she never commented on once a newer pack settles the
 * question (no longer unconfirmed). Pre-flags with a comment are kept and show
 * as "Resolved — re-check". Returns null when nothing needs removing.
 */
export function prunePreflags(flags: readonly Flag[], packs: readonly Pack[]): Flag[] | null {
  const kept = flags.filter((f) => !(f.source === 'preflag' && !f.comment.trim() && flagState(f, packs) === 'resolved'));
  return kept.length === flags.length ? null : kept;
}

/** JSON export: each flag with a snapshot of the question, ready for the pipeline. */
export function flagsToJson(flags: readonly Flag[], packs: readonly Pack[], now = new Date()): string {
  const items = flags.map((f) => {
    const pack = packs.find((p) => p.packId === f.packId);
    // itemId spells out what questionId holds (a question id, or a card id for card flags).
    if (f.itemType === 'card') return { ...f, itemId: f.questionId, state: flagState(f, packs), card: (pack && cardsOf(pack).find((x) => x.id === f.questionId)) ?? null };
    const q = pack?.questions.find((x) => x.id === f.questionId) ?? null;
    return { ...f, itemId: f.questionId, state: flagState(f, packs), question: q };
  });
  return JSON.stringify({ kind: 'studyapp-flags', exportedAt: now.toISOString(), flags: items }, null, 2);
}

/** Markdown export: readable by a person or an AI fixing the pack. */
export function flagsToMarkdown(flags: readonly Flag[], packs: readonly Pack[], now = new Date()): string {
  const cardsN = flags.filter((f) => f.itemType === 'card').length;
  const lines = [`# Flagged questions (${flags.length - cardsN})${cardsN ? ` and cards (${cardsN})` : ''}`, '', `Exported ${now.toISOString()}`, ''];
  for (const f of flags) {
    const pack = packs.find((p) => p.packId === f.packId);
    if (f.itemType === 'card') {
      const c = pack ? cardsOf(pack).find((x) => x.id === f.questionId) : undefined;
      lines.push(`## Card ${f.questionId} — ${REASON_LABEL[f.reason]}`, '');
      lines.push(`- Pack: ${f.packId} v${f.packVersion} · flagged ${f.createdAt.slice(0, 10)} during ${f.mode} · state: ${flagState(f, packs)}`);
      if (f.source === 'preflag') lines.push(`- Pre-flagged in the pack: ${c?.preflag?.note ?? ''}`);
      lines.push(`- Comment: ${f.comment.trim() || '(none)'}`, '');
      if (c) {
        lines.push(`**Card (${c.type}):** ${c.front}`, '', `**Answer:** ${c.back}`);
        if (c.type === 'diagram') lines.push(`Asks about label: ${c.label}`);
        lines.push(`Sources: ${c.sources.map((s) => `${s.file} (${s.locator})`).join('; ')}`, '');
      } else {
        lines.push('_Card not found in the current pack._', '');
      }
      continue;
    }
    const q = pack?.questions.find((x) => x.id === f.questionId);
    lines.push(`## ${f.questionId} — ${REASON_LABEL[f.reason]}`, '');
    lines.push(`- Pack: ${f.packId} v${f.packVersion} · flagged ${f.createdAt.slice(0, 10)} during ${f.mode} · state: ${flagState(f, packs)}`);
    if (f.source === 'preflag') lines.push(`- Pre-flagged in the pack: ${q?.preflag?.note ?? ''}`);
    lines.push(`- Comment: ${f.comment.trim() || '(none)'}`, '');
    if (q) {
      lines.push(`**Stem:** ${q.stem}`, '');
      for (const o of q.options) lines.push(`- ${o.key}. ${o.text}${o.correct ? '  ✅' : ''}`);
      lines.push('', `Keyed answer: ${correctKeys(q).join(', ')}`);
      lines.push(`Sources: ${q.sources.map((s) => `${s.file} (${s.locator})`).join('; ')}`, '');
    } else {
      lines.push('_Question not found in the current pack._', '');
    }
  }
  return lines.join('\n');
}
