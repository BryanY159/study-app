import type { Session } from '../../storage/docs';

/** "First 7/11 · Second 6/10": the per-section scores saved with a mock (nothing for other sessions). */
export function SectionScoresLine({ session }: { session: Session }) {
  if (!session.sectionScores?.length) return null;
  return (
    <div className="small muted" data-testid="session-sections">
      {session.sectionScores.map((s) => `${s.name} ${s.correct}/${s.total}`).join(' · ')}
    </div>
  );
}
