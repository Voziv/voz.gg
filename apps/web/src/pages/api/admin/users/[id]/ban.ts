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

  const guard = canActOnTarget(setup.ctx, 'ban');
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  const raw = (await astro.request.json().catch(() => ({}))) as Record<string, unknown>;
  const reasonInput = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  const reason = reasonInput.length > 0 ? reasonInput.slice(0, 500) : undefined;
  const banExpiresIn = typeof raw.expiresInSeconds === 'number' && raw.expiresInSeconds > 0 ? raw.expiresInSeconds : undefined;

  await recordAudit(setup.db, {
    actorId: setup.actor.id,
    action: 'ban',
    targetUserId: setup.target.id,
    details: { reason: reason ?? null, expiresInSeconds: banExpiresIn ?? null },
  });

  const auth = getAuth(env as Env);
  try {
    await auth.api.banUser({
      headers: astro.request.headers,
      body: { userId: setup.target.id, banReason: reason, banExpiresIn },
    });
  } catch (error) {
    return mapAuthApiError('admin-user-ban', error, 'Could not ban the user. Please try again.');
  }

  return Response.json({ ok: true });
};
