const PUBLIC_EXACT = new Set([
  '/',
  '/sign-in',
  '/request-invite',
  '/api/invite-requests',
  '/api/agents/enroll',
  '/api/agents/config',
  '/api/status',
]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  // All better-auth + Steam endpoints live under /api/auth and guard themselves.
  if (pathname.startsWith('/api/auth/')) return true;
  return false;
}
