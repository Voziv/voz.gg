import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, getPlayersOverview } from '@voz/shared';
import { isAdmin } from '../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  if (!ctx.locals.user) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const serverId = new URL(ctx.request.url).searchParams.get('server') ?? undefined;
  const rows = await getPlayersOverview(createDb(env.DB), new Date(), { serverId });
  // status and isBot are admin-only; drop them for non-admins so the endpoint
  // matches what the player list shows them.
  if (!isAdmin(ctx.locals.user)) {
    return Response.json({
      players: rows.map(({ status: _status, isBot: _isBot, ...rest }) => rest),
    });
  }
  return Response.json({ players: rows });
};
