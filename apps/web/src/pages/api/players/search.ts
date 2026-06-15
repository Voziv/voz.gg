import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, createPlayerMutationsDao, handleSearchPlayers } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  if (!ctx.locals.user) return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  if (!isAdmin(ctx.locals.user)) return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  const q = new URL(ctx.request.url).searchParams.get('q') ?? '';
  const dao = createPlayerMutationsDao(createDb(env.DB));
  const result = await handleSearchPlayers(dao, q);
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json(result);
};
