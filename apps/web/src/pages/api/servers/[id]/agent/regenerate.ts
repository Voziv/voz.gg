import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, servers, serverAgent } from '@voz/shared';
import { isAdmin } from '../../../../../lib/admin';
import { generateToken, hashToken } from '../../../../../lib/agent-auth';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const id = ctx.params.id;
  if (!id) return new Response('Bad Request', { status: 400 });

  const db = createDb(env.DB);
  const server = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, id)).get();
  if (!server) return Response.json({ ok: false, error: 'Server not found.' }, { status: 404 });

  const enrollmentToken = generateToken();
  const enrollmentTokenHash = await hashToken(enrollmentToken);
  // Regenerating invalidates the old agent token (revoke) and re-arms enrollment.
  await db
    .insert(serverAgent)
    .values({ serverId: id, enrollmentTokenHash })
    .onConflictDoUpdate({
      target: serverAgent.serverId,
      set: { enrollmentTokenHash, agentTokenHash: null, enrolledAt: null },
    });

  return Response.json({ ok: true, enrollmentToken });
};
