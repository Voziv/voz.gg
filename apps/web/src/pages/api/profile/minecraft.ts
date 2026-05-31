import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, user } from '@voz/shared';
import { isValidMinecraftUsernameSyntax, lookupMinecraftProfile } from '../../../lib/mojang';

export const prerender = false;

// GET ?username=Notch → Mojang lookup only (no persistence).
export const GET: APIRoute = async (ctx) => {
  if (!ctx.locals.user) return new Response('Unauthorized', { status: 401 });
  const username = (ctx.url.searchParams.get('username') ?? '').trim();
  if (!isValidMinecraftUsernameSyntax(username)) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const profile = await lookupMinecraftProfile(username);
  if (!profile) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  return Response.json({ ok: true, uuid: profile.uuid, name: profile.name });
};

// POST { username } → link; POST { username: "" } → unlink.
export const POST: APIRoute = async (ctx) => {
  const current = ctx.locals.user;
  if (!current) return new Response('Unauthorized', { status: 401 });

  const body = (await ctx.request.json().catch(() => ({}))) as { username?: string };
  const username = (body.username ?? '').trim();
  const db = createDb(env.DB);

  if (username === '') {
    await db
      .update(user)
      .set({ minecraftUuid: null, minecraftName: null, updatedAt: new Date() })
      .where(eq(user.id, current.id));
    return Response.json({ ok: true, unlinked: true });
  }

  if (!isValidMinecraftUsernameSyntax(username)) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const profile = await lookupMinecraftProfile(username);
  if (!profile) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });

  await db
    .update(user)
    .set({ minecraftUuid: profile.uuid, minecraftName: profile.name, updatedAt: new Date() })
    .where(eq(user.id, current.id));
  return Response.json({ ok: true, uuid: profile.uuid, name: profile.name });
};
