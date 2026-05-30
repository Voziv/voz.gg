import { describe, it, expect } from 'vitest';
import { isPublicPath } from './route-protection';

describe('isPublicPath', () => {
  it.each(['/', '/sign-in', '/api/auth/sign-in/social', '/api/auth/callback/discord', '/api/auth/steam/initiate'])(
    'treats %s as public',
    (p) => expect(isPublicPath(p)).toBe(true),
  );
  it.each(['/dashboard', '/dashboard/profile', '/dashboard/servers'])(
    'treats %s as protected',
    (p) => expect(isPublicPath(p)).toBe(false),
  );
});
