import type { APIRoute } from 'astro';
// Astro v6 / @astrojs/cloudflare 13 removed `Astro.locals.runtime.env`.
// Bindings are now read from the `cloudflare:workers` module. This import is
// safe at module load because the route is `prerender = false`, so it is only
// evaluated in the Workers runtime, never during the build.
import { env } from 'cloudflare:workers';
import { getAuth } from '../../../lib/auth';

export const prerender = false;

export const ALL: APIRoute = (ctx) => {
  const auth = getAuth(env as Env);
  return auth.handler(ctx.request);
};
