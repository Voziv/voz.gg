import { authkitProxy } from '@workos-inc/authkit-nextjs';
import type { NextProxy, NextRequest } from 'next/server';

function resolveRedirectUri(request: NextRequest) {
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ??
    request.nextUrl.protocol.replace(':', '');
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() ??
    request.headers.get('host') ??
    request.nextUrl.host;
  return `${proto}://${host}/auth/callback`;
}

const proxy: NextProxy = (request, event) =>
  authkitProxy({
    middlewareAuth: {
      enabled: true,
      unauthenticatedPaths: ['/', '/sign-in', '/auth/callback'],
    },
    redirectUri: resolveRedirectUri(request),
  })(request, event);

export default proxy;

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
