// Server-only, per-isolate admission. No data cache, queue, or automatic retry.
const GATEWAY = new Set([429, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530, 544]);
const unavailable = () => new Response(JSON.stringify({code: 'DATABASE_BUSY', message: 'Database temporarily busy; retry shortly'}), {status: 503, headers: {'content-type': 'application/json', 'retry-after': '15', 'cache-control': 'no-store'}});

export function createDatabaseFetch({fetchFn = (...args) => globalThis.fetch(...args), now = Date.now, maxConcurrent = 8, threshold = 3, cooldownMs = 15_000, timeoutMs = 20_000, readOnlyRpc = /** @type {string[]} */ ([]), maxBodyBytes = 1024 * 1024} = {}) {
  let active = 0, failures = 0, openUntil = 0, probing = false, generation = 0;
  const rpc = new Set(readOnlyRpc);
  return async function databaseFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const read = url.pathname.startsWith('/rest/v1/') && (['GET', 'HEAD'].includes(method) || (method === 'POST' && rpc.has(url.pathname.slice('/rest/v1/rpc/'.length)) && url.pathname.startsWith('/rest/v1/rpc/')));
    // Authentication, mutation, and unreviewed RPC transports retain their original behavior.
    if (!read) return fetchFn(input, init);
    const recovering = openUntil > 0;
    if (active >= maxConcurrent || (recovering && (now() < openUntil || probing))) return unavailable();
    if (recovering) probing = true;
    const started = generation;
    active++;
    const failed = () => {
      if (started !== generation) return;
      if (recovering || ++failures >= threshold) { openUntil = now() + cooldownMs; generation++; }
    };
    const controller = new AbortController();
    const source = init.signal || (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort(source?.reason);
    if (source?.aborted) abort();
    else source?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => controller.abort(new Error('Database read deadline exceeded')), timeoutMs);
    let reader;
    const aborted = new Promise((_, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason);
      else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {once: true});
    });
    try {
      const pending = Promise.resolve(fetchFn(input, {...init, signal: controller.signal})).then(res => {
        if (controller.signal.aborted) {void res.body?.cancel().catch(() => {}); throw controller.signal.reason;}
        return res;
      });
      const res = await Promise.race([pending, aborted]);
      // Retain the slot and deadline until the entire response is received. No response cache.
      let body = null;
      if (res.body) {
        reader = res.body.getReader();
        const chunks = []; let size = 0;
        for (;;) {
          const part = await Promise.race([reader.read(), aborted]);
          if (part.done) break;
          size += part.value.byteLength;
          if (size > maxBodyBytes) {controller.abort(new Error('Database response exceeds bounded read size')); throw controller.signal.reason;}
          chunks.push(part.value);
        }
        body = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) {body.set(chunk, offset); offset += chunk.byteLength;}
      }
      if (GATEWAY.has(res.status)) failed();
      else if (started === generation) { failures = 0; openUntil = 0; }
      return new Response(body, {status: res.status, statusText: res.statusText, headers: res.headers});
    } catch (error) {
      if (reader) void reader.cancel().catch(() => {});
      if (!source?.aborted) failed();
      throw error;
    } finally {
      clearTimeout(timer);
      source?.removeEventListener('abort', abort);
      active--;
      if (recovering) probing = false;
    }
  };
}
export const databaseFetch = createDatabaseFetch();
