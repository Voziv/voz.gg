import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, createPlayerMutationsDao, handleMergePlayers } from '@voz/shared';
import { isAdmin } from '../../../../lib/admin';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!ctx.locals.user) return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  if (!isAdmin(ctx.locals.user)) return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  const survivorId = ctx.params.id;
  if (!survivorId) return Response.json({ ok: false, error: 'Missing player id.' }, { status: 400 });

  const body = (await ctx.request.json().catch(() => ({}))) as { absorbedId?: unknown };
  const absorbedId = typeof body.absorbedId === 'string' ? body.absorbedId : '';
  const dao = createPlayerMutationsDao(createDb(env.DB));
  const result = await handleMergePlayers(dao, survivorId, absorbedId, new Date());
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json(result);
};
