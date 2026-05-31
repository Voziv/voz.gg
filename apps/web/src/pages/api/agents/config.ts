import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { createAgentDao } from '../../../lib/agent-dao';
import { handleConfig } from '../../../lib/agent-handlers';
import { bearerToken, serverIdForToken } from '../../../lib/agent-auth';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const dao = createAgentDao(createDb(env.DB));
  const token = bearerToken(ctx.request.headers.get('authorization'));
  const serverId = token ? await serverIdForToken(dao, token) : null;
  const result = await handleConfig(dao, serverId);
  return Response.json(result.body, { status: result.status });
};
