import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb, createPlayerMutationsDao, handleAddGroup, handleRemoveGroup } from '@voz/shared';
import { isAdmin } from '../../../../lib/admin';

export const prerender = false;

// Returns the validated player id, or a Response to short-circuit on auth/id failure.
function guard(ctx: Parameters<APIRoute>[0]): Response | string {
  if (!ctx.locals.user) return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  if (!isAdmin(ctx.locals.user)) return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  if (!ctx.params.id) return Response.json({ ok: false, error: 'Missing player id.' }, { status: 400 });
  return ctx.params.id;
}

export const POST: APIRoute = async (ctx) => {
  const id = guard(ctx);
  if (id instanceof Response) return id;
  const body = (await ctx.request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name : '';
  const dao = createPlayerMutationsDao(createDb(env.DB));
  const result = await handleAddGroup(dao, id, name, new Date());
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json(result);
};

export const DELETE: APIRoute = async (ctx) => {
  const id = guard(ctx);
  if (id instanceof Response) return id;
  const body = (await ctx.request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name : '';
  const dao = createPlayerMutationsDao(createDb(env.DB));
  const result = await handleRemoveGroup(dao, id, name);
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json(result);
};
