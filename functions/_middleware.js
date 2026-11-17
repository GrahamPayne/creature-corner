/**
 * Applies to every Pages Function under functions/api/. Stamps the
 * deployed commit SHA onto every response — Cloudflare Pages injects
 * CF_PAGES_COMMIT_SHA automatically, no configuration needed. Exists so
 * "is the live site actually running what's in the repo" is a header
 * check, not a guess from behavioral differences.
 */
export async function onRequest({ env, next }) {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set('X-Deployed-Commit', env.CF_PAGES_COMMIT_SHA || 'unknown');
  // TEMPORARY, for diagnosing the live "Could not load products" incident:
  // reveals only the JS type and string length of this binding — never its
  // content — to rule out a secret bound as a wrapper object (e.g. a
  // Secrets Store binding needing .get()) rather than a plain string,
  // which would silently turn `Bearer ${key}` into "Bearer [object
  // Object]" without the stored value itself ever looking wrong.
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  headers.set('X-Diag-Key-Shape', `${typeof key}:${typeof key === 'string' ? key.length : JSON.stringify(Object.keys(key || {}))}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
