import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, user } from '@voz/shared';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const current = ctx.locals.user;
  if (!current) return new Response('Unauthorized', { status: 401 });
  const db = createDb(env.DB);
  await db
    .update(user)
    .set({ steamId64: null, steamPersona: null, steamAvatar: null, updatedAt: new Date() })
    .where(eq(user.id, current.id));
  return Response.json({ ok: true });
};
