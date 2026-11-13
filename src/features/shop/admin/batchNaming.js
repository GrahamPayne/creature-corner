/**
 * Pure sequential-naming helpers for Batch Upload — no DOM, no network, safe
 * to unit test directly. "Sequential" here means "<base>-NNN" (e.g.
 * "Creature Lighter-031"); the numbering continues from whatever the
 * highest existing suffix for that base already is, so a new batch never
 * collides with an older one.
 */

/** @param {number} n */
export function formatSequenceNumber(n) {
  return String(n).padStart(3, '0');
}

/**
 * Matches "<base>-<digits>" against a candidate name, case- and
 * whitespace-insensitively. Returns the numeric suffix, or null if the name
 * doesn't belong to this base's sequence at all (including names that were
 * manually rewritten to something unrelated).
 * @param {string} name
 * @param {string} base
 * @returns {number|null}
 */
export function parseSequenceSuffix(name, base) {
  const root = String(base ?? '').trim().toLowerCase();
  if (!root) return null;
  const candidate = String(name ?? '').trim().toLowerCase();
  const prefix = `${root}-`;
  if (!candidate.startsWith(prefix)) return null;
  const rest = candidate.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

/**
 * The next free sequence number for `base`, found by scanning every
 * existing product name for the highest "<base>-NNN" suffix already in use
 * (regardless of that product's status — a draft or hidden product still
 * holds its number). Deleted products leave no trace to scan, so their
 * numbers are free to be reused; there is no separate ledger of past
 * numbers to consult, and adding one would be new complexity this
 * single-admin catalog doesn't need.
 * @param {string[]} existingNames
 * @param {string} base
 */
export function nextSequenceStart(existingNames, base) {
  let max = 0;
  for (const name of existingNames) {
    const n = parseSequenceSuffix(name, base);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

/**
 * @param {string} base
 * @param {number} count
 * @param {number} startNumber
 * @returns {string[]}
 */
export function generateSequentialNames(base, count, startNumber) {
  const root = String(base ?? '').trim();
  return Array.from({ length: count }, (_, i) => `${root}-${formatSequenceNumber(startNumber + i)}`);
}
