import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { isAdmin } from '../../../../lib/admin';
import { createInviteDao } from '../../../../lib/invite-dao';
import { canDeny } from '../../../../lib/invite-transitions';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const id = ctx.params.id;
  if (!id) return new Response('Bad Request', { status: 400 });

  const raw = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
  const reasonInput = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  const reason = reasonInput.length > 0 ? reasonInput.slice(0, 500) : null;

  const db = createDb(env.DB);
  const dao = createInviteDao(db);
  const row = await dao.byId(id);
  if (!row) return Response.json({ ok: false, error: 'Request not found.' }, { status: 404 });
  if (!canDeny(row.status)) {
    return Response.json({ ok: false, error: 'Only pending requests can be denied.' }, { status: 409 });
  }

  await dao.deny(id, user.id, reason, new Date());

  return Response.json({ ok: true });
};
