/**
 * Human-readable order number formatting — pure, no DOM/network/Date.now().
 * The actual sequence number must come from somewhere race-free (a
 * Postgres sequence, or counting existing orders for the day inside the
 * same transaction that inserts the new one); this module only owns the
 * display format, so the admin UI, a future checkout function, and tests
 * all agree on one shape: CC-YYYYMMDD-NNNN.
 */

/**
 * @param {{year: number, month: number, day: number, sequence: number}} parts
 * month is 1-12. sequence is 1-based and zero-padded to 4 digits (same
 * "pad, then just grow past it" approach as batchNaming.js's product
 * numbering — a 5-digit day never breaks, it just stops being padded).
 */
export function formatOrderNumber({ year, month, day, sequence }) {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const seq = String(sequence).padStart(4, '0');
  return `CC-${y}${m}${d}-${seq}`;
}

const ORDER_NUMBER_RE = /^CC-(\d{4})(\d{2})(\d{2})-(\d+)$/;

/** @param {string} orderNumber @returns {{year:number, month:number, day:number, sequence:number}|null} */
export function parseOrderNumber(orderNumber) {
  const match = ORDER_NUMBER_RE.exec(String(orderNumber ?? ''));
  if (!match) return null;
  const [, y, m, d, seq] = match;
  return { year: Number(y), month: Number(m), day: Number(d), sequence: Number(seq) };
}
