import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config.js';

// Bare specifier ('@supabase/supabase-js') resolves two different ways by
// design, both pointing at the same package version (see package.json /
// the importmap in each HTML page that loads shop code):
//  - Node (unit tests): resolves from node_modules normally.
//  - Browser (no bundler on this site): resolved via an <script
//    type="importmap"> entry to a CDN build, since browsers can't resolve
//    bare specifiers on their own.
// This replaces an earlier version that dynamically imported a CDN URL
// directly, which worked in the browser but threw in Node.

let client = null;

/** Lazily-created Supabase client, or null if unconfigured. @returns {any|null} */
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
