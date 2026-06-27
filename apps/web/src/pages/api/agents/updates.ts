import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { createAgentDao } from '../../../lib/agent-dao';
import { handleUpdatesReport } from '../../../lib/agent-handlers';
import { bearerToken, serverIdForToken } from '../../../lib/agent-auth';

export const prerender = false;

const postDiscord = async (url: string, payload: { content: string }): Promise<{ status: number }> => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: res.status };
};

export const POST: APIRoute = async (ctx) => {
  const dao = createAgentDao(createDb(env.DB));
  const token = bearerToken(ctx.request.headers.get('authorization'));
  const serverId = token ? await serverIdForToken(dao, token) : null;
  const body = await ctx.request.json().catch(() => null);
  const result = await handleUpdatesReport(dao, serverId, body, new Date(), postDiscord);
  return Response.json(result.body, { status: result.status });
};
