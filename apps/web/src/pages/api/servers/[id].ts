import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, servers } from '@voz/shared';
import { isAdmin } from '../../../lib/admin';
import { parseServerInput } from '../../../lib/server-schema';

export const prerender = false;

export const PUT: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const id = ctx.params.id!;
  const parsed = parseServerInput(await ctx.request.json().catch(() => ({})));
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const db = createDb(env.DB);
  const existing = await db.select().from(servers).where(eq(servers.id, id)).get();
  if (!existing) return Response.json({ ok: false, error: 'Server not found.' }, { status: 404 });

  await db
    .update(servers)
    .set({
      name: parsed.data.name,
      gameType: parsed.data.gameType,
      host: parsed.data.host,
      port: parsed.data.port,
      description: parsed.data.description,
      updatedAt: new Date(),
    })
    .where(eq(servers.id, id));
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const db = createDb(env.DB);
  await db.delete(servers).where(eq(servers.id, ctx.params.id!));
  return Response.json({ ok: true });
};
