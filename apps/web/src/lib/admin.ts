// Accepts the structural shape of Astro.locals.user (or null/undefined).
export function isAdmin(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === 'admin';
}
