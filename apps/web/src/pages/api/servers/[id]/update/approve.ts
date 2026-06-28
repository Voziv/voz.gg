import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { isAdmin } from '../../../../../lib/admin';
import { approveUpdate } from '../../../../../lib/server-update-actions';
import { createServerUpdateActionDao } from '../../../../../lib/server-update-action-dao';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!ctx.locals.user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(ctx.locals.user)) return new Response('Forbidden', { status: 403 });
  const serverId = ctx.params.id!;
  const dao = createServerUpdateActionDao(createDb(env.DB));
  const res = await approveUpdate({ dao }, serverId);
  return Response.json(res, { status: res.ok ? 200 : 400 });
};
