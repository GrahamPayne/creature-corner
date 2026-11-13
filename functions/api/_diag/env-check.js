/**
 * Temporary diagnostic endpoint for verifying Cloudflare Pages secret
 * configuration during the Stripe Sandbox integration rollout. Reports
 * ONLY presence/absence booleans — never any part of a secret's value,
 * not even a prefix. Delete this file once secret configuration is
 * confirmed working.
 */
export async function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({
      SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      STRIPE_SECRET_KEY: Boolean(env.STRIPE_SECRET_KEY),
      STRIPE_WEBHOOK_SECRET: Boolean(env.STRIPE_WEBHOOK_SECRET),
      STRIPE_MODE_is_live: env.STRIPE_MODE === 'live',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
