import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { nanoid } from 'nanoid';
import { createDb, servers } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';
import { parseServerInput } from '../../../lib/server-schema';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const parsed = parseServerInput(await ctx.request.json().catch(() => ({})));
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const db = createDb(env.DB);
  const id = nanoid(12);
  const now = new Date();
  await db.insert(servers).values({
    id,
    name: parsed.data.name,
    gameType: parsed.data.gameType,
    host: parsed.data.host,
    port: parsed.data.port,
    description: parsed.data.description,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ ok: true, id });
};
