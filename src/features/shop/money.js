/** Money is always integer cents end-to-end; this is the one place it becomes a display string. */

/** @param {number} cents */
export function formatCents(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
