import type { AdCreative, Lane, MediaRef, QueueItem, Run } from '@/server/types';

/* THE SAMPLE DAY the landing's window shows: Harbor Coffee's Friday, November 6, 2026, nine lanes and
 * twenty posts, read off the reviewed mock (its lanes, the four captions, the search and the clock). The real Today view draws it at /demo; nothing here is read
 * from or written to an account. The media are the reviewed sample images in
 * public/landing-assets/sample-media. */

export const DEMO_TZ = 'America/New_York';
export const DEMO_DAY = '2026-11-06';

/* 2026-11-06 in New York is UTC-5. An hour of the day as the mock writes it (9.47 is 9:28) to an
 * instant, rounding the minutes the way the mock's clock does. */
const at = (h: number) => {
  const H = Math.floor(h);
  const M = Math.round((h - H) * 60);
  return new Date(Date.UTC(2026, 10, 6, H + 5, M)).toISOString();
};

/** The mock's NOW (10.05, 10:03 AM) and when its day plan was read (10:32 AM). */
export const DEMO_NOW = Date.parse(at(10.05));
export const DEMO_READ_AT = at(10 + 32 / 60);

export const DEMO_LANES: Lane[] = ([
  ['ig', 'Harbor Coffee · Instagram', 'instagram', '@harborcoffee'],
  ['tt', 'Harbor Coffee · TikTok', 'tiktok', '@harborcoffee'],
  ['fb', 'Harbor Coffee · Facebook', 'facebook', 'Harbor Coffee'],
  ['li', 'Harbor Coffee · LinkedIn', 'linkedin', 'harbor-coffee'],
  ['x', 'Harbor Coffee · X', 'x', '@harborcoffee'],
  ['th', 'Harbor Coffee · Threads', 'threads', '@harborcoffee'],
  ['yt', 'Harbor Coffee · YouTube', 'youtube', '@harborcoffee'],
  ['bs', 'Harbor Coffee · Bluesky', 'bluesky', 'harborcoffee.com'],
  ['pn', 'Harbor Coffee · Pinterest', 'pinterest', 'harborcoffee'],
] as const).map(([id, name, platform, handle]) => ({ id, name, platform, handle, formats: [] }));

/* The sample posts, 2026-11-16: calm photographic posts composed for Harbor Coffee (Codex image
 * generation with Fraunces and Inter type), one per post. The earlier illustrated set stays beside
 * them in sample-media/ because the reviewed landing recipe pins its bytes. */
const img = (name: string): MediaRef => ({ path: `/landing-assets/sample-media/v2/${name}.jpg`, kind: 'image', src: 'url' });
const LAT = [img('latte')], BREW = [img('brew')], POUR = [img('pourover')], ROAST = [img('roast')], EVT = [img('cupping')];
const LATC = 'Maple oat latte is back.\n\nReal maple syrup, oat milk and our house espresso. Hot or iced, today through December.';
const BRC = '3 ways to brew great coffee at home.\n\n1. Pour-over: 15g coffee to 250g water.\n2. French press: 4 minutes, then press slowly.\n3. Moka pot: medium-fine grind, low heat.';
const ROC = 'Roast day. This week\'s Colombia went in the drum at 6 AM and was bagged by 9.';
const EVC = 'Free coffee cupping this Saturday at 10 AM. Taste three new single origins with our roasters. Bring a friend.';

/* lane, hour, kind, title, media, copy, sent, the files the plan names that are not on disk */
const Q: [string, number, string, string, MediaRef[], string, boolean?, string[]?][] = [
  ['tt', 9.3, 'video', 'Maple latte pour, 15 seconds', [], '', false, ['maple-latte-pour.mp4']],
  ['fb', 9.47, 'carousel', 'Maple oat latte is back', LAT, LATC, true],
  ['li', 9.55, 'carousel', 'Roast day', ROAST, ROC, true],
  ['ig', 9.72, 'carousel', 'Maple oat latte is back', LAT, LATC],
  ['th', 9.8, 'carousel', '3 ways to brew at home', BREW, BRC],
  ['x', 9.97, 'carousel', 'Maple oat latte is back', LAT, LATC],
  ['pn', 10.17, 'pin', 'Pour-over guide', POUR, BRC],
  ['yt', 10.23, 'video', 'How we roast, in 4 minutes', [], '', false, ['how-we-roast.mp4']],
  ['fb', 10.3, 'event', 'Saturday cupping', EVT, EVC],
  ['bs', 10.4, 'carousel', '3 ways to brew at home', BREW, BRC],
  ['ig', 10.57, 'carousel', 'Roast day', ROAST, ROC],
  ['li', 10.65, 'carousel', '3 ways to brew at home', BREW, BRC],
  ['th', 10.8, 'event', 'Saturday cupping', EVT, EVC],
  ['x', 10.97, 'event', 'Saturday cupping', EVT, EVC],
  ['ig', 11.05, 'event', 'Saturday cupping', EVT, EVC],
  ['th', 11.68, 'text', 'Question of the day', [], 'What is your go-to order when it gets cold out?'],
  ['bs', 11.9, 'event', 'Saturday cupping', EVT, EVC],
  ['tt', 12.28, 'carousel', '3 ways to brew at home', BREW, BRC],
  ['fb', 12.53, 'carousel', 'Roast day', ROAST, ROC],
  ['pn', 12.85, 'pin', 'Maple oat latte', LAT, LATC],
];

/* A morning already part-reviewed: Threads approved, X held. */
const REVIEWED: Record<number, 'approved' | 'held'> = { 4: 'approved', 5: 'held' };

export const DEMO_ITEMS: QueueItem[] = Q.map(([lane, h, kind, title, media, text, sent, missing], i) => ({
  id: `demo-${i}`,
  lane,
  at: at(h),
  kind,
  title,
  text: text || undefined,
  /* Every image carries alt text but the Instagram latte's, so its check has something to flag. */
  media: i === 3 ? media : media.map((m) => ({ ...m, alt: title })),
  status: sent ? 'sent' : 'queued',
  ...(REVIEWED[i] ? { review: { state: REVIEWED[i], at: at(9) } } : {}),
  missing,
  source: 'day-plan',
  day: DEMO_DAY,
}));

/** The post the landing's window opens on: Instagram's latte carousel, waiting on a decision. */
export const DEMO_SELECTED = 'demo-3';

/* The sample day's one run: a repair on the Instagram latte, asked for by its alt-text check and
 * finished a few minutes before NOW, so the window shows the broken part and the revised run
 * beside it. Nothing here was run; /demo never fetches runs. */
export const DEMO_RUNS: Record<string, Run[]> = {
  [DEMO_SELECTED]: [{
    id: 'demo-run-1',
    lane: 'ig',
    action: 'repair',
    target: { day: DEMO_DAY, id: DEMO_SELECTED },
    agent: 'codex',
    comment: 'Write alt text for every image',
    status: 'done',
    createdAt: new Date(DEMO_NOW - 4 * 60000).toISOString(),
    finishedAt: new Date(DEMO_NOW - 4 * 60000 + 38000).toISOString(),
    output: {
      text: LATC,
      media: LAT.map((m) => ({ ...m, alt: 'A maple oat latte with leaf latte art in a speckled ceramic cup on a cafe table, beside a small dish holding a maple leaf' })),
      notes: 'Added alt text to the slide. The copy and the image are unchanged.',
    },
  }],
};

/* THE SAMPLE AD BOARD (review 2026-11-16, item 33): Harbor Coffee's creative on the four review
 * columns, shown at /ads?sample=1 when a first-time account has none of its own. Nothing here is read
 * from or written to an ad pipeline. */
export const DEMO_ADS: AdCreative[] = [
  ['latte-feed', 'carousel', 'carousel-feed', 'Maple oat latte is back', LAT, 'review', LATC],
  ['brew-square', 'carousel', 'carousel-square', '3 ways to brew at home', BREW, 'review', BRC],
  ['roast-still', 'image', 'still-feed', 'Roast day', ROAST, 'approved', ROC],
  ['cupping-still', 'image', 'still-square', 'Saturday cupping', EVT, 'live', EVC],
  ['search', 'text', 'search-text', 'Harbor Coffee · Search ad', [], 'draft', 'Maple Oat Latte Is Back\nFresh Roast Every Week\n\nReal maple syrup, oat milk and our house espresso.'],
].map(([id, kind, format, title, media, status, text]) => ({
  id: `harbor/sample/${id}`, product: 'harbor-coffee', run: 'sample', assetId: id as string, kind: kind as AdCreative['kind'], format: format as string,
  title: title as string, text: text as string, media: media as MediaRef[], status: status as AdCreative['status'], approved: status === 'approved' || status === 'live',
  source: 'sample', createdAt: new Date(DEMO_NOW - 3600000).toISOString(), lock: 'The sample board. Sign in with your own ad pipeline to run a fix.',
}));
