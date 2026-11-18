import { useMemo } from 'react';
import { deckCounts, isLearned, localDay, newCardsRatedToday } from '../../engine/leitner';
import { cardsOf } from '../../pack/schema';
import { packReviews, schedulerStates } from '../../storage/cards';
import { useApp } from '../../state/AppProvider';

/** Roughly how long a session takes: about 20 seconds a card. */
export const minutesFor = (cards: number): number => Math.max(1, Math.round((cards * 20) / 60));

/** Card numbers for Home: due today, new available today, and learned / total per topic. */
export function useCardStats() {
  const { ix, cards, progress, now } = useApp();
  return useMemo(() => {
    if (!ix) return null;
    const deck = cardsOf(ix.pack);
    if (!deck.length) return null;
    const today = localDay(now());
    const states = schedulerStates(cards, ix.pack.packId, deck);
    const all = deckCounts(deck.map((c) => c.id), states, today);
    const newLeft = Math.max(0, progress.settings.newCardsPerDay - newCardsRatedToday(packReviews(cards, ix.pack.packId), today));
    const perTopic = new Map<string, { learned: number; total: number }>();
    for (const c of deck) {
      for (const t of c.topicIds) {
        const cur = perTopic.get(t) ?? { learned: 0, total: 0 };
        cur.total++;
        if (isLearned(states[c.id])) cur.learned++;
        perTopic.set(t, cur);
      }
    }
    return { due: all.due, newToday: Math.min(all.new, newLeft), perTopic };
  }, [ix, cards, progress.settings.newCardsPerDay, now]);
}

/** FR-14: "Cards due today" with a Start button. Shown only when the pack has cards. */
export function CardsTile() {
  const s = useCardStats();
  if (!s) return null;
  const total = s.due + s.newToday;
  return (
    <section className="card cards-tile" data-testid="cards-tile">
      <div className="stack" style={{ gap: 2 }}>
        <span className="eyebrow">Cards due today</span>
        <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          <span className="big-score" data-testid="cards-due">
            {s.due}
          </span>
          {s.newToday > 0 && <span className="chip accent">+{s.newToday} new</span>}
        </span>
        <span className="small muted">{total ? `About ${minutesFor(total)} minute${minutesFor(total) === 1 ? '' : 's'}` : 'All caught up for today'}</span>
      </div>
      <a className={total ? 'btn primary' : 'btn'} href="#/cards">
        {total ? 'Start cards' : 'Open cards'}
      </a>
    </section>
  );
}

/**
 * FR-14: after a wrong drill answer, offer the cards for it: the cards that list this
 * question as related, or else the topic's cards. Opens deck setup on just those (a cram).
 */
export function RelatedCardsLink({ questionId, topicIds }: { questionId: string; topicIds: readonly string[] }) {
  const { ix } = useApp();
  if (!ix) return null;
  const deck = cardsOf(ix.pack);
  const related = deck.filter((c) => c.relatedQuestionIds.includes(questionId));
  const topical = related.length ? [] : deck.filter((c) => c.topicIds.some((t) => topicIds.includes(t)));
  const ids = (related.length ? related : topical).map((c) => c.id);
  if (!ids.length) return null;
  const label = related.length ? `Review the ${related.length} related card${related.length === 1 ? '' : 's'}` : 'Review cards for this topic';
  return (
    <a className="btn small related-cards" href={`#/cards?ids=${ids.join(',')}`} data-testid="related-cards">
      {label} →
    </a>
  );
}
