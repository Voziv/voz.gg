import { defineMiddleware } from 'astro:middleware';
// Astro v6 / @astrojs/cloudflare 13 removed `Astro.locals.runtime.env`.
// Bindings are now read from the `cloudflare:workers` module. This import is
// safe in middleware because the file is only evaluated in the Workers runtime
// (prerendered pages skip middleware at build time — the static file is served
// directly by the asset binding, not through the Worker).
import { env } from 'cloudflare:workers';
import { getAuth } from './lib/auth';
import { isPublicPath } from './lib/route-protection';

export const onRequest = defineMiddleware(async (context, next) => {
  const auth = getAuth(env as Env);
  const session = await auth.api.getSession({ headers: context.request.headers });

  context.locals.user = session?.user ?? null;
  context.locals.session = session?.session ?? null;

  if (!session && !isPublicPath(context.url.pathname)) {
    return context.redirect('/sign-in');
  }

  return next();
});
