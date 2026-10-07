/**
 * Supabase connection config for the public shop.
 * SUPABASE_URL and SUPABASE_ANON_KEY are not secret — Row Level Security is
 * what actually protects the data (see supabase/schema.sql) — so they're
 * safely committed here rather than injected at build time. There is no
 * build step on this site, so this file is literally what the browser gets.
 * SUPABASE_ANON_KEY is Supabase's "publishable" key (the new sb_publishable_
 * prefix replaces the older anon-JWT format but is the same public/anon
 * role — safe to ship to the browser).
 */

export const SUPABASE_URL = 'https://qpnqrtcsxtcszmessbvx.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ikmAu1n0PRFJgXjrOmvfog_3UBV57Km';

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);
}
