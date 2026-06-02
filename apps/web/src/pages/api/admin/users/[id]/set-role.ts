import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAuth } from '../../../../../lib/auth';
import { canSetRole } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const raw = (await astro.request.json().catch(() => ({}))) as Record<string, unknown>;
  const newRole = typeof raw.role === 'string' ? raw.role : '';

  const guard = canSetRole(setup.ctx, newRole);
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  await recordAudit(setup.db, {
    actorId: setup.actor.id,
    action: 'set-role',
    targetUserId: setup.target.id,
    details: { oldRole: setup.target.role, newRole },
  });

  const auth = getAuth(env as Env);
  await auth.api.setRole({
    headers: astro.request.headers,
    body: { userId: setup.target.id, role: newRole as 'user' | 'admin' },
  });

  return Response.json({ ok: true });
};
