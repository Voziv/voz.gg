import type { APIRoute } from 'astro';
// Astro v6 / @astrojs/cloudflare 13 removed `Astro.locals.runtime.env`.
// Bindings are now read from the `cloudflare:workers` module. This import is
// safe at module load because the route is `prerender = false`, so it is only
// evaluated in the Workers runtime, never during the build.
import { env } from 'cloudflare:workers';
import { createDb, healthchecks, type HealthResult } from '@voz/shared';

export const prerender = false;

export const GET: APIRoute = async () => {
  let database: HealthResult['database'] = 'error';
  try {
    if (env?.DB) {
      const db = createDb(env.DB);
      await db.select().from(healthchecks).limit(1).all();
      database = 'connected';
    }
  } catch {
    database = 'error';
  }
  const body: HealthResult = {
    status: database === 'connected' ? 'ok' : 'error',
    database,
    timestamp: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    status: database === 'connected' ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
};
