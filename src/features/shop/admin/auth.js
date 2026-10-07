import { getSupabaseClient } from '../api/supabaseClient.js';
import { isSupabaseConfigured } from '../api/config.js';

/** @returns {Promise<{user: any}|null>} */
export async function getSession() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return { user: data.session.user };
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function signIn(email, password) {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase is not configured yet.' };
  }
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: 'Invalid email or password.' };
  return { ok: true };
}

export async function signOut() {
  if (!isSupabaseConfigured()) return;
  const supabase = await getSupabaseClient();
  await supabase.auth.signOut();
}

/**
 * Server-enforced admin check: calls the is_admin() SQL function (SECURITY
 * DEFINER) over RPC. This is a UX convenience only — the real enforcement is
 * the RLS policies on products/categories/product_images themselves, which
 * reject writes from non-admins regardless of what the client believes.
 * @returns {Promise<boolean>}
 */
export async function checkIsAdmin() {
  if (!isSupabaseConfigured()) return false;
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}
