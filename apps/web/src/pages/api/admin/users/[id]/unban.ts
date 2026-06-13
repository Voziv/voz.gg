import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAuth } from '../../../../../lib/auth';
import { canActOnTarget } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';
import { mapAuthApiError } from '../../../../../lib/api-errors';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const guard = canActOnTarget(setup.ctx, 'unban');
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  await recordAudit(setup.db, { actorId: setup.actor.id, action: 'unban', targetUserId: setup.target.id });

  const auth = getAuth(env as Env);
  try {
    await auth.api.unbanUser({ headers: astro.request.headers, body: { userId: setup.target.id } });
  } catch (error) {
    return mapAuthApiError('admin-user-unban', error, 'Could not unban the user. Please try again.');
  }

  return Response.json({ ok: true });
};
