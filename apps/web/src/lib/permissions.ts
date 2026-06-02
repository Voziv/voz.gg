import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

export const ROLES = ['user', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

// Roles that may reach the admin section and call admin-plugin endpoints.
export const ADMIN_ROLES = ['admin', 'owner'] as const satisfies readonly Role[];

export const ac = createAccessControl(defaultStatements);

// Capability bundles. NOTE: only `owner` holds `set-role`, so role management is
// owner-only at the capability layer. Future tiers (e.g. server-restart,
// whitelist) are added here as new statements + roles without touching call sites.
export const roles = {
  user: ac.newRole({ user: [], session: [] }),
  admin: ac.newRole({
    user: ['list', 'get', 'ban', 'delete'],
    session: ['list', 'revoke', 'delete'],
  }),
  owner: ac.newRole({
    user: ['create', 'list', 'get', 'set-role', 'ban', 'delete', 'set-password', 'update', 'impersonate'],
    session: ['list', 'revoke', 'delete'],
  }),
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// Normalize a possibly-null DB role into a known Role, defaulting to 'user'.
export function toRole(value: string | null | undefined): Role {
  return isRole(value) ? value : 'user';
}
