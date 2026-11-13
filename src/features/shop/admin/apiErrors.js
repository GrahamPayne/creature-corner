/**
 * Pure error-classification helpers — no DOM, no network, no Supabase
 * import. Split out of api.js specifically so importing it (e.g. from
 * batchUpload.js) never drags in supabaseClient.js's bare '@supabase/
 * supabase-js' specifier, which only resolves in a browser with the site's
 * importmap — pulling it into a context that doesn't have one (a plain
 * test harness, for instance) breaks module loading for code that never
 * actually touches Supabase at all.
 */

export const DUPLICATE_SLUG_MESSAGE = 'That slug is already in use — try another.';

/** True if `err` is the friendly error adminCreateProduct()/adminUpdateProduct() throw for a slug unique-constraint violation (Postgres 23505). */
export function isDuplicateSlugError(err) {
  return err instanceof Error && err.message === DUPLICATE_SLUG_MESSAGE;
}
