import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buildSteamLoginUrl } from '../../../../lib/steam/openid';

export const prerender = false;

export const GET: APIRoute = (ctx) => {
  if (!ctx.locals.user) return ctx.redirect('/sign-in');
  return ctx.redirect(buildSteamLoginUrl(env.STEAM_RETURN_URL, env.STEAM_REALM));
};
