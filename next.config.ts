import type { NextConfig } from 'next';

/* Two shapes from one tree. Locally it reads lane configs and media from disk and spawns headless
 * agents. On aircheck.dev (OpenNext on a Cloudflare Worker, AIRCHECK_DB=supabase) it is the hosted
 * account: sign in, and the day is read from the manifests your machine synced. The landing is the
 * app's own /home page, which the Worker serves at "/" to anyone signed out. */
const nextConfig: NextConfig = {
  serverExternalPackages: [],
};

export default nextConfig;
