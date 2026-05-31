import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { createAgentDao } from '../../lib/agent-dao';
import { handleStatus } from '../../lib/agent-handlers';
import { bearerToken, serverIdForToken } from '../../lib/agent-auth';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const dao = createAgentDao(createDb(env.DB));
  const token = bearerToken(ctx.request.headers.get('authorization'));
  const serverId = token ? await serverIdForToken(dao, token) : null;
  const body = await ctx.request.json().catch(() => ({}));
  const result = await handleStatus(dao, serverId, body, new Date());
  return Response.json(result.body, { status: result.status });
};
