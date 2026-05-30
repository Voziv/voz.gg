import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, user } from '@voz/shared';
import { verifySteamAssertion } from '../../../../lib/steam/openid';
import { fetchSteamSummary } from '../../../../lib/steam/api';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const current = ctx.locals.user;
  if (!current) return ctx.redirect('/sign-in');

  const verification = await verifySteamAssertion(ctx.url.searchParams);
  if (!verification.ok) {
    return ctx.redirect('/dashboard?steam=error');
  }

  const summary = await fetchSteamSummary(verification.steamId64, env.STEAM_API_KEY);
  const db = createDb(env.DB);
  await db
    .update(user)
    .set({
      steamId64: verification.steamId64,
      steamPersona: summary?.personaName ?? null,
      steamAvatar: summary?.avatarUrl ?? null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, current.id));

  return ctx.redirect('/dashboard?steam=linked');
};
