import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config.js';

// No bundler on this site, so the Supabase client loads straight from a CDN
// as an ES module — and only when the project is actually configured, so
// sample-data mode (the default today) never makes a network request for it.
const SUPABASE_JS_CDN_URL = 'https://esm.sh/@supabase/supabase-js@2';

let clientPromise = null;

/** Returns a lazily-created Supabase client promise, or null if unconfigured. @returns {Promise<any>|null} */
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import(SUPABASE_JS_CDN_URL).then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    );
  }
  return clientPromise;
}
