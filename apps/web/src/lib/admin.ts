export function isAdmin(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === 'admin';
}
