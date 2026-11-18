import type { CardState } from '../engine/leitner';
import type { Flashcard } from '../pack/schema';
import { cardKey, type CardsDoc } from './docs';

// Bridges the saved cards doc and the pure scheduler (engine/leitner.ts).

/** Scheduler states for a pack's cards, keyed by card id. A card whose first rating was undone counts as new. */
export function schedulerStates(cards: CardsDoc, packId: string, deck: readonly Flashcard[]): Record<string, CardState | undefined> {
  const out: Record<string, CardState | undefined> = {};
  for (const c of deck) {
    const s = cards.states[cardKey(packId, c.id)];
    out[c.id] = s && !s.fresh ? s : undefined;
  }
  return out;
}

/** Reviews for this pack, with the card key, for the daily new-card count. */
export const packReviews = (cards: CardsDoc, packId: string) => cards.reviews.filter((r) => !r.cram && r.cardKey.startsWith(`${packId}|`));
