import { describe, it, expect } from 'vitest';
import { isPublicPath } from './route-protection';

describe('isPublicPath', () => {
  it.each([
    '/',
    '/sign-in',
    '/request-invite',
    '/api/invite-requests',
    '/api/auth/sign-in/social',
    '/api/auth/callback/discord',
    '/api/auth/steam/initiate',
    '/api/agents/enroll',
    '/api/agents/config',
    '/api/status',
  ])('treats %s as public', (p) => expect(isPublicPath(p)).toBe(true));

  it.each([
    '/dashboard',
    '/dashboard/profile',
    '/dashboard/servers',
    '/dashboard/admin/invites',
    '/api/invite-requests/abc123/approve',
    '/api/invite-requests/abc123/deny',
  ])('treats %s as protected', (p) => expect(isPublicPath(p)).toBe(false));
});
