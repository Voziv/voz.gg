import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { isAdmin } from '../../../../lib/admin';
import { createInviteDao } from '../../../../lib/invite-dao';
import { canApprove } from '../../../../lib/invite-transitions';
import { getAuth } from '../../../../lib/auth';
import { reportInternalError } from '../../../../lib/api-errors';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const id = ctx.params.id;
  if (!id) return new Response('Bad Request', { status: 400 });

  const db = createDb(env.DB);
  const dao = createInviteDao(db);
  const row = await dao.byId(id);
  if (!row) return Response.json({ ok: false, error: 'Request not found.' }, { status: 404 });
  if (!canApprove(row.status)) {
    return Response.json({ ok: false, error: 'Request is already approved.' }, { status: 409 });
  }

  // Send first, mark approved second: a send failure leaves the row in its prior
  // state so the admin can retry. The user opens the email seconds later, well
  // after `approve` below has committed, so the create-gate sees `approved`.
  const auth = getAuth(env as Env);
  try {
    await auth.api.signInMagicLink({
      body: {
        email: row.email,
        callbackURL: '/dashboard',
        errorCallbackURL: '/sign-in?error=no_invite',
        metadata: { invite: true },
      },
    });
  } catch (error) {
    // Email transport failed (e.g. Resend rejected the request). The row is left
    // pending so the admin can retry; surface a generic message and log the cause.
    return reportInternalError(
      'invite-approve',
      error,
      'Could not send the invite email. Please try again.',
      502,
    );
  }

  await dao.approve(id, user.id, new Date());

  return Response.json({ ok: true });
};
