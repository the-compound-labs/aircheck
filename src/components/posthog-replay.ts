/* Generated into product sources by analytics/replay-rollout.mjs. Not a fleet-wide quota:
 * browser budgets are per origin and can be cleared. PostHog's verified free account is the
 * monetary boundary. Direct transport avoids a Cloudflare/Vercel replay relay entirely. */
import type { PostHog, PostHogConfig } from 'posthog-js';

export type ReplayPolicy = {
  enabled: boolean; projectToken: string; apiHost: string;
  billing: { verified: boolean };
  sampleRate: number; maxSessionSeconds: number; maxOriginBrowserDaySeconds: number;
  publicClassNames?: string[]; publicAssetPaths?: string[];
};
const BOT = /lightpanda|headlesschrome|phantomjs|puppeteer|playwright|python-requests|node-fetch|scrapy|curl\/|wget\/|googlebot|bingbot|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-user|perplexitybot|bytespider|amazonbot|applebot|ccbot|petalbot|yandexbot|baiduspider|duckduckbot|semrushbot|ahrefsbot|mj12bot|dotbot|slurp|facebookexternalhit|meta-externalagent/i;
const SAFE_PATH = /^(?:\/$|\/(?:about|pricing|docs|blog|guides|resources|components|blocks|library)(?:\/|$))/;
const PUBLIC_LABELS = new Set(['search', 'filter', 'filters', 'sort', 'clear', 'clear filters', 'reset', 'next', 'previous', 'back', 'close', 'cancel', 'save', 'copy', 'copied', 'get started', 'sign in', 'sign up', 'log in', 'learn more', 'view all', 'load more', 'show more', 'show less', 'pricing', 'docs', 'documentation', 'home', 'about', 'rows', 'gallery', 'shortlists', 'free access', 'tailwind declared', 'filters and order', 'shortcuts', 'saved queries', 'component', 'registry', 'kind', 'access', 'deps, files', 'compare', 'free', 'not tested', 'passed', 'view', 'all']);
export function replayOptions(policy: ReplayPolicy): PostHogConfig['session_recording'] {
  const classes = new Set(policy.publicClassNames || []);
  const assets = new Set(policy.publicAssetPaths || []);
  return {
    maskAllInputs: true,
    maskTextSelector: '*',
    maskTextFn: (text) => PUBLIC_LABELS.has(text.trim().toLowerCase()) ? text : text.replace(/\S/g, '*'),
    maskAttributeFn: (name, value, element) => {
      if (name === 'class') return value.split(/\s+/).filter(token => {
        if (classes.has(token) || /^__(?:className|variable)_[a-f0-9]{6}$/.test(token)) return true;
        const compiled = token.match(/^[a-zA-Z][a-zA-Z0-9_-]*_([a-zA-Z][a-zA-Z0-9_-]*)__[a-zA-Z0-9_-]{5,8}$/);
        return !!compiled && classes.has(compiled[1]);
      }).join(' ');
      if (name === 'style' && element) {
        const properties = /^(?:width|height|min-width|max-width|min-height|max-height|margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|gap|display|position|align-items|justify-content|flex-direction|flex|flex-shrink|flex-grow|overflow|line-height|font-size|font-weight|opacity|vertical-align|white-space|object-fit|top|right|bottom|left)$/;
        const safe = /^(?:(?:-?\d*\.?\d+(?:px|em|rem|vh|vw|ch|%)?|inline-flex|flex|block|inline-block|inline|none|inherit|auto|center|start|end|space-between|hidden|visible|relative|absolute|fixed|sticky|normal|bold|nowrap|middle|stretch|row|column)\s*)+$/;
        const style = (element as HTMLElement).style;
        return style ? [...style].filter(property => properties.test(property) && safe.test(style.getPropertyValue(property))).map(property => `${property}:${style.getPropertyValue(property)}`).join(';') : '';
      }
      if (name === 'role' && /^(button|navigation|table|row|rowgroup|cell|columnheader|list|listitem|checkbox|status|dialog|region|group|tab|tabpanel|tablist|menu|menuitem|combobox|option|link|searchbox)$/.test(value)) return value;
      if (name === 'data-state' && /^(open|closed|active|inactive)$/.test(value)) return value;
      if (name === 'rel' && /^(stylesheet|preload)$/.test(value)) return value;
      if (name === 'type' && value === 'text/css') return value;
      if (name === 'as' && /^(style|font|image)$/.test(value)) return value;
      if (name === 'media' && /^(all|screen|print|\(prefers-color-scheme: (light|dark)\))$/.test(value)) return value;
      if (/^(disabled|checked|selected|open|hidden|aria-expanded|aria-selected|aria-hidden)$/.test(name) && /^(|true|false|open|hidden|disabled|checked|selected)$/.test(value)) return value;
      if (name === 'src' || (name === 'href' && element?.tagName === 'LINK')) {
        try { const u = new URL(value, location.origin); return u.origin === location.origin && (assets.has(u.pathname) || (element?.tagName === 'LINK' && /^\/_next\/static\/.*\.css$/.test(u.pathname))) && !u.hash ? u.origin + u.pathname : ''; } catch { return ''; }
      }
      if (name === 'href') { try { const u = new URL(value, location.origin); return u.origin === location.origin && SAFE_PATH.test(u.pathname) ? u.origin + u.pathname : ''; } catch { return ''; } }
      if (/^(width|height|viewBox|d|cx|cy|r|x|y|rx|ry|stroke-width)$/.test(name) && /^[\d\s.,eEMmLlHhVvCcSsQqTtAaZz+-]+$/.test(value)) return value;
      if (/^(fill|stroke)$/.test(name) && /^(none|currentColor|#[a-fA-F0-9]{3,8})$/.test(value)) return value;
      return '';
    },
    blockSelector: 'input, textarea, select, [contenteditable], [data-private], [data-replay-private], .ph-no-capture, iframe, canvas, video, audio, object, embed, script, meta',
    slimDOMOptions: 'all', inlineStylesheet: false, collectFonts: false,
    recordCrossOriginIframes: false, recordHeaders: false, recordBody: false,
    captureCanvas: { recordCanvas: false },
    maskCapturedNetworkRequestFn: request => {
      if (request.method || 'type' in request) return null;
      try { const u = new URL(request.name, location.origin); return { ...request, name: u.origin + (SAFE_PATH.test(u.pathname) ? u.pathname : '/:private') }; } catch { return null; }
    },
  };
}
export function sampled(session: string, rate: number): boolean {
  let hash = 2166136261;
  for (let i = 0; i < session.length; i++) hash = Math.imul(hash ^ session.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296 < rate;
}
export function configureReplay(ph: PostHog, policy: ReplayPolicy, token: string, host: string, extraEligible: () => boolean = () => true) {
  let activeUntil = 0, attempted = false;
  const eligible = () => {
    try {
      return policy.enabled && policy.billing.verified && token === policy.projectToken && host === policy.apiHost &&
        policy.sampleRate > 0 && policy.sampleRate <= 0.1 && policy.maxSessionSeconds > 0 && policy.maxSessionSeconds <= 120 &&
        policy.maxOriginBrowserDaySeconds > 0 && policy.maxOriginBrowserDaySeconds <= 300 &&
        !navigator.webdriver && !BOT.test(navigator.userAgent) && navigator.doNotTrack !== '1' &&
        !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl &&
        document.visibilityState === 'visible' && location.protocol === 'https:' &&
        !/localhost|\.pages\.dev$|\.workers\.dev$|\.vercel\.app$/.test(location.hostname) &&
        SAFE_PATH.test(location.pathname) && ![...new URLSearchParams(location.search).keys()].some(key => /token|code|email|key|auth|session|invite|secret|password/i.test(key)) && !location.hash && extraEligible();
    } catch { return false; }
  };
  const stop = () => { activeUntil = 0; ph.stopSessionRecording(); };
  const canSend = () => activeUntil > Date.now() && eligible();
  const start = async (event: Event) => {
    if (!event.isTrusted || attempted || !eligible()) return;
    attempted = true;
    const session = ph.get_session_id();
    if (!session || !sampled(session, policy.sampleRate) || !navigator.locks) return;
    // Atomic, pessimistic reservation across tabs. Storage / Locks failures disable capture.
    await navigator.locks.request('compound-replay-budget', async () => {
      if (!eligible()) return;
      try {
        const key = 'compound.replay.budget.v1';
        const day = new Date().toISOString().slice(0, 10);
        const saved = JSON.parse(localStorage.getItem(key) || '{}');
        const ledger = saved.day === day ? saved : { day, seconds: 0, sessions: [] };
        if (!Number.isFinite(ledger.seconds) || ledger.seconds < 0 || !Array.isArray(ledger.sessions)) return;
        if (ledger.sessions.includes(session)) return;
        const seconds = Math.min(policy.maxSessionSeconds, policy.maxOriginBrowserDaySeconds - ledger.seconds);
        if (seconds <= 0) return;
        ledger.seconds += seconds; ledger.sessions.push(session);
        localStorage.setItem(key, JSON.stringify(ledger));
        if (!eligible()) return;
        activeUntil = Date.now() + seconds * 1000;
        // No overrides: remote project disable/sampling/URL rules remain authoritative.
        ph.startSessionRecording();
        window.setTimeout(stop, seconds * 1000);
      } catch { stop(); }
    }).catch(stop);
  };
  document.addEventListener('pointerdown', start, { passive: true });
  document.addEventListener('keydown', start, { passive: true });
  window.addEventListener('pagehide', stop);
  window.addEventListener('popstate', () => { if (!eligible()) stop(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stop(); });
  // SPA URL changes cannot leave a running recorder on a newly private route.
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (...args: Parameters<History[typeof method]>) {
      // Evaluate the destination before history changes; no private DOM mutation gets a turn.
      if (args[2] != null) { try { const u = new URL(String(args[2]), location.href); if (!SAFE_PATH.test(u.pathname) || u.hash || [...u.searchParams.keys()].some(key => /token|code|email|key|auth|session|invite|secret|password/i.test(key))) stop(); } catch { stop(); } }
      return original.apply(this, args);
    };
  }
  return { canSend, stop };
}
