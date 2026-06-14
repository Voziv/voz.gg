import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, getPlayersOverview } from '@voz/shared';
import { isAdmin } from '../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  if (!isAdmin(ctx.locals.user)) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 });
  }
  const rows = await getPlayersOverview(createDb(env.DB), new Date());
  return Response.json({ players: rows });
};
