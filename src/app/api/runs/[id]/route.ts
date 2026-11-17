import { handle } from '@/server/local-route';

export const dynamic = 'force-dynamic';

/* See src/server/local-api.ts: one handler, served here locally and by the bridge for aircheck.dev. */
export const GET = handle;
export const DELETE = handle;
