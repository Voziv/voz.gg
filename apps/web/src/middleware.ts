import { defineMiddleware } from 'astro:middleware';
// Astro v6 / @astrojs/cloudflare 13 removed `Astro.locals.runtime.env`; bindings
// are read from the `cloudflare:workers` module instead. The vite plugin
// resolves this import in both the Workers runtime and the prerender build pass.
import { env } from 'cloudflare:workers';
import { getAuth } from './lib/auth';
import { isPublicPath } from './lib/route-protection';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.session = null;

  // Middleware also runs while Astro prerenders the landing page at build time,
  // where no secrets or bindings are configured — constructing better-auth there
  // errors and emits an empty static page (a blank homepage in production). Skip
  // auth for prerendered routes; at runtime they are served as static assets and
  // never reach middleware.
  if (context.isPrerendered) {
    return next();
  }

  const auth = getAuth(env as Env);
  const session = await auth.api.getSession({ headers: context.request.headers });

  context.locals.user = session?.user ?? null;
  context.locals.session = session?.session ?? null;

  if (!session && !isPublicPath(context.url.pathname)) {
    return context.redirect('/sign-in');
  }

  return next();
});
