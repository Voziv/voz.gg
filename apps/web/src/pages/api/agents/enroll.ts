import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { createAgentDao } from '../../../lib/agent-dao';
import { handleEnroll } from '../../../lib/agent-handlers';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const dao = createAgentDao(createDb(env.DB));
  const body = await ctx.request.json().catch(() => ({}));
  const result = await handleEnroll(dao, body);
  return Response.json(result.body, { status: result.status });
};
