import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, getPlayersOverview } from '@voz/shared';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  if (!ctx.locals.user) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const serverId = new URL(ctx.request.url).searchParams.get('server') ?? undefined;
  const rows = await getPlayersOverview(createDb(env.DB), new Date(), { serverId });
  return Response.json({ players: rows });
};
