import { ADMIN_ROLES, type Role } from './permissions';

export const USER_ADMIN_ACTIONS = ['ban', 'unban', 'set-role', 'delete', 'revoke-sessions'] as const;
export type UserAdminAction = (typeof USER_ADMIN_ACTIONS)[number];

export type GuardContext = {
  actorRole: Role;
  actorId: string;
  targetRole: Role;
  targetId: string;
};

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

const ALLOW: GuardResult = { ok: true };
const deny = (status: number, error: string): GuardResult => ({ ok: false, status, error });

const isActorAdmin = (ctx: GuardContext) => (ADMIN_ROLES as readonly Role[]).includes(ctx.actorRole);

// Actions an admin may NOT perform on their own account (would risk lockout).
const SELF_BLOCKED: readonly UserAdminAction[] = ['ban', 'delete', 'set-role'];

export function canActOnTarget(ctx: GuardContext, action: UserAdminAction): GuardResult {
  if (!isActorAdmin(ctx)) return deny(403, 'You do not have permission to manage users.');

  // The owner is locked: no admin action targets the owner. Ownership changes go
  // through canTransferOwnership only.
  if (ctx.targetRole === 'owner') return deny(403, 'The owner account cannot be modified here.');

  if (ctx.actorId === ctx.targetId && SELF_BLOCKED.includes(action)) {
    return deny(403, `You cannot ${action.replace('-', ' ')} your own account.`);
  }

  if (action === 'set-role' && ctx.actorRole !== 'owner') {
    return deny(403, 'Only the owner can change roles.');
  }

  // Regular admins may act only on regular users; acting on another admin (or the
  // owner, handled above) requires the owner.
  if (ctx.actorRole === 'admin' && ctx.targetRole !== 'user') {
    return deny(403, 'Admins can only manage regular users.');
  }

  return ALLOW;
}

export function canSetRole(ctx: GuardContext, newRole: string): GuardResult {
  const base = canActOnTarget(ctx, 'set-role');
  if (!base.ok) return base;
  // 'owner' is reachable only via transfer; 'user'/'admin' are the assignable roles.
  if (newRole !== 'user' && newRole !== 'admin') {
    return deny(400, 'Role must be "user" or "admin".');
  }
  return ALLOW;
}

export function canTransferOwnership(ctx: GuardContext): GuardResult {
  if (ctx.actorRole !== 'owner') return deny(403, 'Only the owner can transfer ownership.');
  if (ctx.actorId === ctx.targetId) return deny(400, 'You already own this.');
  if (ctx.targetRole === 'owner') return deny(409, 'There can only be one owner.');
  return ALLOW;
}

export type RowActionAvailability = {
  ban: boolean;
  unban: boolean;
  revokeSessions: boolean;
  makeAdmin: boolean;
  demote: boolean;
  transferOwnership: boolean;
  delete: boolean;
  /** true if at least one of the above is true */
  any: boolean;
};

export function rowActionAvailability(ctx: GuardContext): RowActionAvailability {
  const ban = canActOnTarget(ctx, 'ban').ok;
  const unban = canActOnTarget(ctx, 'unban').ok;
  const revokeSessions = canActOnTarget(ctx, 'revoke-sessions').ok;
  const makeAdmin = ctx.targetRole === 'user' && canSetRole(ctx, 'admin').ok;
  const demote = ctx.targetRole === 'admin' && canSetRole(ctx, 'user').ok;
  const transferOwnership = canTransferOwnership(ctx).ok;
  const del = canActOnTarget(ctx, 'delete').ok;
  return {
    ban,
    unban,
    revokeSessions,
    makeAdmin,
    demote,
    transferOwnership,
    delete: del,
    any: ban || unban || revokeSessions || makeAdmin || demote || transferOwnership || del,
  };
}
