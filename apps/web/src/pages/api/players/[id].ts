import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, createPlayerMutationsDao, handleUpdatePlayerFields } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';

export const prerender = false;

export const PATCH: APIRoute = async (ctx) => {
  if (!ctx.locals.user) return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  if (!isAdmin(ctx.locals.user)) return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  const id = ctx.params.id;
  if (!id) return Response.json({ ok: false, error: 'Missing player id.' }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const dao = createPlayerMutationsDao(createDb(env.DB));
  const result = await handleUpdatePlayerFields(dao, id, body, new Date());
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json(result);
};
