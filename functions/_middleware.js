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
  // Legacy Supabase keys are JWTs: header.payload.signature, base64url. A
  // JWT payload is signed, not encrypted — anyone holding the token can
  // already read these claims, so decoding `ref`/`role` here (never the
  // signature, never used to authenticate anything) exposes nothing the
  // token itself doesn't already expose, and tells us definitively
  // whether this is a service_role key for THIS project.
  try {
    const parts = typeof key === 'string' ? key.split('.') : [];
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      headers.set('X-Diag-Key-Claims', `ref=${payload.ref ?? 'n/a'};role=${payload.role ?? 'n/a'};exp=${payload.exp ?? 'n/a'}`);
    } else {
      headers.set('X-Diag-Key-Claims', 'not-a-3-part-jwt');
    }
  } catch {
    headers.set('X-Diag-Key-Claims', 'decode-failed');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
