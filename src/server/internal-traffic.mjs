/* INTERNAL TRAFFIC, THE SERVER HALF.
 *
 * A request is internal when its connecting address is one the operator lists as their own, in
 * AIRCHECK_INTERNAL_ADDRESSES: either JSON, { "ips": ["192.0.2.1"], "prefixes": ["2001:db8:1"] },
 * or a comma-separated list of addresses. An IPv6 prefix matches every address under it. Unset,
 * nothing is internal. Cloudflare sets cf-connecting-ip itself and overwrites whatever a client
 * sends, so a visitor cannot claim it.
 *
 * An internal request gets <meta name="aircheck-internal" content="1"> in the page it is served
 * (worker/index.mjs), which keeps the ad tags and the conversion off in the browser (src/lib/ads-conversion.ts)
 * and labels its analytics events; and it is never issued, and can never claim, an ad-conversion
 * receipt (src/server/ads-conversion.ts). Server only: the address list never reaches a browser bundle. */

let cached = { raw: undefined, list: { ips: [], prefixes: [] } };
function registry() {
  const raw = (typeof process !== 'undefined' && process.env?.AIRCHECK_INTERNAL_ADDRESSES) || '';
  if (raw === cached.raw) return cached.list;
  let list = { ips: [], prefixes: [] };
  const t = raw.trim();
  if (t.startsWith('{')) {
    try { const j = JSON.parse(t); list = { ips: (j.ips || []).map(String), prefixes: (j.prefixes || []).map(String) }; } catch { /* unreadable: nothing is internal */ }
  } else if (t) {
    list.ips = t.split(',').map((x) => x.trim()).filter(Boolean);
  }
  list.ips = list.ips.map((x) => x.toLowerCase());
  cached = { raw, list };
  return list;
}

export const INTERNAL_META = 'aircheck-internal';
export const INTERNAL_TAG = `<meta name="${INTERNAL_META}" content="1">`;

export function internalAddress(ip) {
  const at = String(ip || '').trim().toLowerCase().replace(/^::ffff:/, '');
  if (!at) return false;
  const list = registry();
  if (list.ips.includes(at)) return true;
  return list.prefixes.some((prefix) => at.startsWith(prefix.toLowerCase() + ':'));
}

/* `headers` is a Request's Headers. */
export const internalRequest = (headers) => internalAddress(headers?.get?.('cf-connecting-ip'));

/* Whether this answer is a page that should carry the mark: a successful HTML answer to an internal GET. */
export function marksPage(request, response) {
  return request.method === 'GET' && response.status === 200 && /^text\/html/i.test(response.headers.get('content-type') || '') && internalRequest(request.headers);
}

/* An internal page request with its cache validators removed, so the answer is always a whole page
 * that can carry the mark, never a 304 for a copy the browser stored without it. Others pass as they are. */
export function unconditional(request) {
  if (request.method !== 'GET' || !internalRequest(request.headers) || !(request.headers.has('if-none-match') || request.headers.has('if-modified-since'))) return request;
  const headers = new Headers(request.headers);
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  return new Request(request, { headers });
}

/* The page with the mark first in <head>, ahead of every script. It is private to the internal
 * browser, so it is never stored. */
export function markInternal(request, response) {
  if (!marksPage(request, response) || typeof HTMLRewriter === 'undefined') return response;
  const marked = new HTMLRewriter().on('head', { element(head) { head.prepend(INTERNAL_TAG, { html: true }); } }).transform(response);
  const headers = new Headers(marked.headers);
  headers.set('cache-control', 'private, no-store');
  headers.delete('etag');
  return new Response(marked.body, { status: marked.status, statusText: marked.statusText, headers });
}
