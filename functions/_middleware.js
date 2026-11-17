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
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
