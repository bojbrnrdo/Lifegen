/**
 * One guard for one progress card.
 *
 * The card fetches its data after it starts rendering, and the page around it
 * can be rebuilt at any moment (a live update after saving a meeting report).
 * Without a guard a late response either throws on a card that is no longer in
 * the document, or paints yesterday's numbers over the new ones.
 *
 * Usage:
 *   const card = ...;
 *   const guard = createProgressGuard(card);
 *   const data = await load();
 *   if (!guard.current()) return;   // a newer render (or a navigation) won
 */
export function createProgressGuard(card) {
  const token = String((Number(card?.dataset?.progressToken) || 0) + 1);
  if (card?.dataset) card.dataset.progressToken = token;
  const current = () =>
    Boolean(card) &&
    card.isConnected !== false &&
    String(card.dataset?.progressToken) === token;
  return { token, current };
}

/** True when the card still belongs to the page and to this render. */
export function progressCardIsCurrent(card, token) {
  return Boolean(card) && card.isConnected !== false &&
    String(card.dataset?.progressToken) === String(token);
}
