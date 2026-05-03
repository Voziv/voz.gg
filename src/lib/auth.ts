import 'server-only';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, type User } from '@/db/schema';

type WorkOSUser = Awaited<ReturnType<typeof withAuth>>;

export async function requireUser() {
  const auth = await withAuth();
  if (!auth.user) {
    throw new Error('Not authenticated. Proxy middlewareAuth should have redirected.');
  }
  const local = await getOrCreateLocalUser(auth);
  return { auth, user: local };
}

export async function getCurrentUser(): Promise<{
  auth: WorkOSUser;
  user: User | null;
}> {
  const auth = await withAuth();
  if (!auth.user) return { auth, user: null };
  const local = await getOrCreateLocalUser(auth);
  return { auth, user: local };
}

export function isAdmin(auth: WorkOSUser, user: User | null): boolean {
  if (user?.isAdmin) return true;
  const role = auth.role;
  const roles = auth.roles;
  if (role === 'admin') return true;
  if (Array.isArray(roles) && roles.includes('admin')) return true;
  return false;
}

export async function requireAdmin() {
  const { auth, user } = await requireUser();
  if (!isAdmin(auth, user)) {
    throw new Error('Forbidden: admin role required');
  }
  return { auth, user };
}

export async function getOrCreateLocalUser(auth: WorkOSUser): Promise<User> {
  if (!auth.user) {
    throw new Error('No authenticated WorkOS user');
  }
  const workosId = auth.user.id;
  const existing = db.select().from(users).where(eq(users.id, workosId)).get();
  if (existing) return existing;

  const now = Date.now();
  const seed = {
    id: workosId,
    displayName: [auth.user.firstName, auth.user.lastName].filter(Boolean).join(' ') || null,
    bio: null,
    minecraftUuid: null,
    minecraftName: null,
    steamId64: null,
    steamPersona: null,
    steamAvatar: null,
    isAdmin: false,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(users).values(seed).run();
  return seed as User;
}
