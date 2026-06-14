import type { APIRoute } from 'astro';
import { createUserDao } from '../../../../../lib/user-dao';
import { canTransferOwnership } from '../../../../../lib/user-admin-guards';
import { setupUserAdminRoute, guardResponse, recordAudit } from '../../../../../lib/user-admin-route';
import { reportInternalError } from '../../../../../lib/api-errors';

export const prerender = false;

export const POST: APIRoute = async (astro) => {
  const setup = await setupUserAdminRoute(astro);
  if (!setup.ok) return setup.response;

  const guard = canTransferOwnership(setup.ctx);
  const blocked = guardResponse(guard);
  if (blocked) return blocked;

  await recordAudit(setup.db, {
    actorId: setup.actor.id,
    action: 'transfer-ownership',
    targetUserId: setup.target.id,
    details: { newOwnerEmail: setup.target.email },
  });

  try {
    await createUserDao(setup.db).transferOwnership({
      currentOwnerId: setup.actor.id,
      newOwnerId: setup.target.id,
      at: new Date(),
    });
  } catch (error) {
    return reportInternalError('admin-user-transfer-ownership', error, 'Could not transfer ownership. Please try again.');
  }

  return Response.json({ ok: true });
};
