// Meta Conversions API, the server half of the Meta measurement (on by default, off by opt-out).
// One event per call, deduplicated against the browser pixel by the shared event_id and event_name
// (Meta deduplicates within 48 hours). It carries only what the browser pixel request already
// carries: the event name, its time and id, the site root as the source URL, the visitor's IP address
// and user agent, and Meta's own _fbp/_fbc browser cookies when present. No email, phone, account ID
// or other hashed customer data is ever sent.
// The dataset is the build's NEXT_PUBLIC_AIRCHECK_META_PIXEL (src/lib/telemetry.ts) and the token is the
// Worker secret META_CAPI_TOKEN. Without both the send is a no-op. Setting
// META_CAPI_TEST_EVENT_CODE routes every event to Events Manager's Test events tab only.
export const META_DATASET = process.env.NEXT_PUBLIC_AIRCHECK_META_PIXEL || '';
export const META_GRAPH = 'https://graph.facebook.com/v24.0';
const FBP = /^fb\.[0-2]\.\d{10,16}\.\d{1,24}$/;
const FBC = /^fb\.[0-2]\.\d{10,16}\.[A-Za-z0-9_-]{1,512}$/;
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function metaEvent({ name, id, sourceUrl, ip, userAgent, fbp, fbc, now = Date.now() }) {
  if (!/^[a-z_]{3,40}$/.test(name || '') || !EVENT_ID.test(id || '')) return null;
  const url = new URL(sourceUrl);
  const user_data = {};
  if (typeof ip === 'string' && ip && ip.length <= 45) user_data.client_ip_address = ip;
  if (typeof userAgent === 'string' && userAgent && userAgent.length <= 512) user_data.client_user_agent = userAgent;
  if (FBP.test(fbp || '')) user_data.fbp = fbp;
  if (FBC.test(fbc || '')) user_data.fbc = fbc;
  if (!user_data.client_user_agent) return null;
  return { event_name: name, event_time: Math.floor(now / 1000), event_id: id, action_source: 'website', event_source_url: `${url.origin}/`, user_data };
}

/** Sends one event. Never throws; returns the HTTP status, or a reason it did not send. */
export async function sendMetaEvent(event, { token = process.env.META_CAPI_TOKEN, testEventCode = process.env.META_CAPI_TEST_EVENT_CODE, fetchImpl = fetch } = {}) {
  if (!event) return 'invalid';
  if (!token) return 'no-token';
  if (!META_DATASET) return 'no-dataset';
  const body = new URLSearchParams({ data: JSON.stringify([event]) });
  if (testEventCode) body.set('test_event_code', testEventCode);
  try {
    const response = await fetchImpl(`${META_GRAPH}/${META_DATASET}/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(3000) });
    return response.status;
  } catch { return 'failed'; }
}
