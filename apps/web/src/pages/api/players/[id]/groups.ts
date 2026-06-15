import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, createPlayerMutationsDao, handleAddGroup, handleRemoveGroup } from '@voz/shared';
import { isAdmin } from '../../../../lib/admin';

export const prerender = false;

function guard(ctx: Parameters<APIRoute>[0]) {
  if (!ctx.locals.user) return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  if (!isAdmin(ctx.locals.user)) return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  if (!ctx.params.id) return Response.json({ ok: false, error: 'Missing player id.' }, { status: 400 });
  return null;
}

export const POST: APIRoute = async (ctx) => {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  const body = (await ctx.request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name : '';
  const dao = createPlayerMutationsDao(createDb(env.DB));
  const result = await handleAddGroup(dao, ctx.params.id!, name, new Date());
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json(result);
};

export const DELETE: APIRoute = async (ctx) => {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  const body = (await ctx.request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name : '';
  const dao = createPlayerMutationsDao(createDb(env.DB));
  const result = await handleRemoveGroup(dao, ctx.params.id!, name);
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json(result);
};
