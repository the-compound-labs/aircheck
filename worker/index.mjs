// The hosted app (aircheck.dev, or your own host). Anyone signed out sees the landing page; signing in
// from the landing's dialog opens the hosted account: Today, lanes, ads, and /account where a
// machine's sync token is issued. Accounts and their manifests live in the operator's Supabase
// database (src/server/db.ts). Media never comes here.
//
// The landing is a page of the app (src/app/(site)/home), the reviewed design drawn by Next. The
// Worker is what makes aircheck.dev hosted, so it is the Worker that hands "/" to the landing for a
// visitor with no session; a local install has no Worker and keeps Today at "/". The docs, privacy,
// terms and contact are app routes too, and the share card, sitemap and llms.txt are files in public/.
//
// Every host in AIRCHECK_REDIRECT_HOSTS (comma-separated: a www name, names the app used to answer on)
// 301s to the same path and query on AIRCHECK_HOST. GET and HEAD get 301; any other method keeps 308
// so a POST stays a POST.
import { default as next } from '../.open-next/worker.js';
import { admit } from './admission.mjs';
import { markInternal, unconditional } from '../src/server/internal-traffic.mjs';

const hostOf = (env) => env?.AIRCHECK_HOST || 'aircheck.dev';
/* The landing's route. "/" serves it to anyone signed out; asked for by name it redirects to "/". */
const LANDING = '/home';
const COOKIE = 'aircheck_session';
const BRIDGE = 'http://127.0.0.1:3327';
const redirectHosts = (env) => new Set(String(env?.AIRCHECK_REDIRECT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

/* Files a crawler or a share card asks for by name, served straight from public/ without waking the
 * app. A browser asking for /favicon.ico gets the mark. */
const NAMED = {
  '/og.png': '/og.png',
  '/og-20261108.png': '/og-20261108.png',
  '/og-20261116.jpg': '/og-20261116.jpg',
  '/sitemap.xml': '/sitemap.xml',
  '/llms.txt': '/llms.txt',
  '/favicon.ico': '/aircheck-mark.svg',
};

/* The signed-in app. Without a session cookie these go to the sign-in dialog instead of rendering empty. */
const APP = /^\/(?:account|lanes|runs|ads|email)(?:\/|$)/;

const hasSession = (req) => (req.headers.get('cookie') || '').split(';').some((c) => c.trim().startsWith(`${COOKIE}=`) && c.trim().length > COOKIE.length + 1);


export default {
  /* A page served to one of the operator's own addresses carries the internal mark
   * (src/server/internal-traffic.mjs): no ad tag loads there and its analytics are labelled. */
  async fetch(request, env, ctx) {
    request = unconditional(request);
    return markInternal(request, await serve(request, env, ctx));
  },
};

async function serve(request, env, ctx) {
    const url = new URL(request.url);
    if (redirectHosts(env).has(url.hostname.toLowerCase())) {
      const to = new URL(url.pathname + url.search, `https://${hostOf(env)}`);
      return Response.redirect(to.toString(), ['GET', 'HEAD'].includes(request.method) ? 301 : 308);
    }
    const read = ['GET', 'HEAD'].includes(request.method);
    const asset = (path) => env.ASSETS.fetch(new Request(new URL(path + url.search, url.origin), request));
    const path = url.pathname;

    if (read && (path === LANDING || path === `${LANDING}/`) && !request.headers.has('rsc')) return Response.redirect(new URL('/' + url.search, url.origin).toString(), 301);
    const named = read && (NAMED[path] || NAMED[path.replace(/\/$/, '')]);
    if (named) return asset(named);
    if (read && APP.test(path) && !hasSession(request)) return Response.redirect(new URL('/?signin=1', url.origin).toString(), 302);

    /* A file from public/ (the landing's images, the marks) is served as it is, before admission:
     * one landing view loads a dozen of them, and none of them touches the database. */
    if (read && /\.[a-z0-9]+$/i.test(path) && !path.startsWith('/api/') && !path.startsWith('/_next/')) {
      const file = await asset(path);
      if (file.status !== 404) return file;
    }

    /* A local media file. aircheck.dev has no disk: the file is on the machine that queued it, and
     * the MCP server there runs the media bridge. Browsers treat 127.0.0.1 as a secure origin, so
     * this is not mixed content, and nothing passes through Aircheck. */
    if (read && path === '/api/media') {
      return new Response(null, { status: 302, headers: { location: `${BRIDGE}/media${url.search}`, 'cache-control': 'private, max-age=60' } });
    }

    const refused = await admit(request, env, path);
    if (refused) return refused;
    /* Signed out, "/" is the landing: the app renders /home under the URL that was asked for. A
     * client-side (RSC) request for "/" is the app's own navigation and stays with Today, which
     * sends anyone without a valid session to the sign-in dialog. */
    /* There is no sign-in page. An old /login link opens the dialog on the landing. */
    if (read && (path === '/login' || path === '/login/')) {
      const q = new URLSearchParams(url.search); q.set('signin', '1');
      return Response.redirect(new URL(`/?${q}`, url.origin).toString(), 301);
    }
    /* A reset link opens the same dialog on its "choose a new password" screen, signed in or not. */
    if (read && (path === '/reset' || path === '/reset/') && !request.headers.has('rsc')) {
      const q = new URLSearchParams({ signin: 'reset', token: url.searchParams.get('token') || '' });
      return next.fetch(new Request(new URL(`${LANDING}?${q}`, url.origin), request), env, ctx);
    }
    if (read && (path === '/' || path === '/index.html') && !hasSession(request) && !request.headers.has('rsc')) {
      return next.fetch(new Request(new URL(LANDING + url.search, url.origin), request), env, ctx);
    }
    return next.fetch(request, env, ctx);
}
