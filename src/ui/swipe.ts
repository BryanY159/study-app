// Swipe to rate a flashcard: left = Again, right = Got it, only after flipping.
// Pure, so the thresholds are unit-tested. Buttons and keys always work too.

/** How far (px) a drag must go sideways to count. */
export const SWIPE_PX = 80;

export function swipeRating(dx: number, dy: number, flipped: boolean, threshold = SWIPE_PX): 'again' | 'got-it' | null {
  if (!flipped) return null;
  // Mostly sideways: a vertical scroll that drifts a little is not a swipe.
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'again' : 'got-it';
}
