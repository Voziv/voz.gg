import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { nanoid } from 'nanoid';
import { createDb } from '@voz/shared';
import { createInviteDao } from '../../../lib/invite-dao';
import { parseInviteRequestInput } from '../../../lib/invite-schema';
import { verifyTurnstile, resolveTurnstileSecret } from '../../../lib/turnstile';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const raw = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof raw.turnstileToken === 'string' ? raw.turnstileToken : '';
  const remoteIp = ctx.request.headers.get('CF-Connecting-IP') ?? undefined;

  const human = await verifyTurnstile(token, resolveTurnstileSecret(env), { remoteIp });
  if (!human) {
    return Response.json({ ok: false, error: 'Verification failed. Please try again.' }, { status: 400 });
  }

  const parsed = parseInviteRequestInput(raw);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const db = createDb(env.DB);
  const dao = createInviteDao(db);

  if (await dao.pendingExistsForEmail(parsed.data.email)) {
    return Response.json(
      { ok: false, error: 'A request for this email is already pending.' },
      { status: 409 },
    );
  }

  await dao.create({
    id: nanoid(12),
    name: parsed.data.name,
    discordName: parsed.data.discordName,
    email: parsed.data.email,
    now: new Date(),
  });

  return Response.json({ ok: true }, { status: 201 });
};
