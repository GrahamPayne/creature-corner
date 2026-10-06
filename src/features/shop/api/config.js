/**
 * Supabase connection config for the public shop.
 * SUPABASE_URL and SUPABASE_ANON_KEY are not secret — Row Level Security is
 * what actually protects the data (see supabase/schema.sql) — so they're
 * safely committed here rather than injected at build time. There is no
 * build step on this site, so this file is literally what the browser gets.
 *
 * Replace the two placeholder values below once the Supabase project exists
 * (see docs/SHOP_SETUP.md). Until then, the shop runs on the bundled sample
 * data in data/sample-products.js.
 */

export const SUPABASE_URL = 'https://your-project.supabase.co';
export const SUPABASE_ANON_KEY = 'replace-with-anon-key';

export function isSupabaseConfigured() {
  return (
    SUPABASE_URL !== 'https://your-project.supabase.co' &&
    SUPABASE_ANON_KEY !== 'replace-with-anon-key' &&
    Boolean(SUPABASE_URL) &&
    Boolean(SUPABASE_ANON_KEY)
  );
}
