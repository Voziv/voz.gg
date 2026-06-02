import { ADMIN_ROLES } from './permissions';

type WithRole = { role?: string | null } | null | undefined;

export function isAdmin(user: WithRole): boolean {
  return !!user?.role && (ADMIN_ROLES as readonly string[]).includes(user.role);
}

export function isOwner(user: WithRole): boolean {
  return user?.role === 'owner';
}
