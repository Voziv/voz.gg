import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { isAdmin } from './admin';
import { toRole, type Role } from './permissions';
import { createUserDao, type UserRow } from './user-dao';
import { createAuditDao } from './audit-dao';
import type { AdminAuditAction } from '@voz/shared';
import type { GuardContext, GuardResult } from './user-admin-guards';

export type ResolvedActor = { id: string; role: Role };

export type RouteSetup =
  | { ok: true; actor: ResolvedActor; target: UserRow; ctx: GuardContext; db: ReturnType<typeof createDb> }
  | { ok: false; response: Response };

const json = (body: unknown, status: number) => Response.json(body, { status });

// Authenticate the caller, load the target user, and build the guard context.
export async function setupUserAdminRoute(astro: APIContext): Promise<RouteSetup> {
  const actorUser = astro.locals.user;
  if (!actorUser) return { ok: false, response: json({ ok: false, error: 'Unauthorized.' }, 401) };
  if (!isAdmin(actorUser)) return { ok: false, response: json({ ok: false, error: 'Forbidden.' }, 403) };

  const id = astro.params.id;
  if (!id) return { ok: false, response: json({ ok: false, error: 'Bad request.' }, 400) };

  const db = createDb(env.DB);
  const target = await createUserDao(db).byId(id);
  if (!target) return { ok: false, response: json({ ok: false, error: 'User not found.' }, 404) };

  const actor: ResolvedActor = { id: actorUser.id, role: toRole(actorUser.role) };
  const ctx: GuardContext = {
    actorRole: actor.role,
    actorId: actor.id,
    targetRole: toRole(target.role),
    targetId: target.id,
  };
  return { ok: true, actor, target, ctx, db };
}

export function guardResponse(result: GuardResult): Response | null {
  return result.ok ? null : json({ ok: false, error: result.error }, result.status);
}

// Write an audit row. Recorded before the mutation is delegated (attempt log);
// actorId/targetUserId are plain columns, so the row survives a delete.
export async function recordAudit(
  db: ReturnType<typeof createDb>,
  entry: { actorId: string; action: AdminAuditAction; targetUserId: string; details?: Record<string, unknown> },
): Promise<void> {
  await createAuditDao(db).record({
    id: crypto.randomUUID(),
    actorId: entry.actorId,
    action: entry.action,
    targetUserId: entry.targetUserId,
    details: entry.details ?? null,
    at: new Date(),
  });
}
