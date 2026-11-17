// Admission before anything reaches the database: sign-in attempts per client, and account reads
// and writes per client. A missing binding refuses rather than letting traffic through unmetered.
// Kept apart from worker/index.mjs so tests can import it without the OpenNext build.
const tooMany = (seconds) => new Response(JSON.stringify({ error: 'Too many requests. Try again in a minute.' }), {
  status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': String(seconds) },
});

/* Admission before anything reaches the database: sign-in attempts per client, and account reads
 * and writes per client. A missing binding refuses rather than letting traffic through unmetered. */
export async function admit(request, env, path) {
  if (path.startsWith('/_next/')) return null;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  try {
    if (path === '/api/auth' && request.method === 'POST') {
      if (!env.AUTH_LIMIT?.limit) return tooMany(60);
      if (!(await env.AUTH_LIMIT.limit({ key: ip })).success) return tooMany(60);
    }
    if (path === '/api/setup-link' && request.method === 'POST') {
      if (!env.SETUP_LINK_LIMIT?.limit || !env.SETUP_LINK_GLOBAL?.limit) return tooMany(60);
      if (!(await env.SETUP_LINK_LIMIT.limit({ key: ip })).success) return tooMany(60);
      if (!(await env.SETUP_LINK_GLOBAL.limit({ key: 'all' })).success) return tooMany(60);
    }
    if (!env.DATABASE_CLIENT_LIMIT?.limit) return tooMany(15);
    if (!(await env.DATABASE_CLIENT_LIMIT.limit({ key: ip })).success) return tooMany(60);
  } catch {
    return tooMany(15);
  }
  return null;
}
