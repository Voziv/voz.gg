import { eq } from 'drizzle-orm';
import { user, type Db } from '@voz/shared';

export type UserRow = typeof user.$inferSelect;

export interface UserDao {
  byId(id: string): Promise<UserRow | null>;
  transferOwnership(input: { currentOwnerId: string; newOwnerId: string; at: Date }): Promise<void>;
}

export function createUserDao(db: Db): UserDao {
  return {
    async byId(id) {
      const row = await db.select().from(user).where(eq(user.id, id)).get();
      return row ?? null;
    },
    async transferOwnership({ currentOwnerId, newOwnerId, at }) {
      // Atomic swap: the current owner becomes an admin and the target becomes the
      // sole owner. db.batch runs both statements in one D1 transaction so the
      // single-owner invariant is never violated mid-flight.
      await db.batch([
        db.update(user).set({ role: 'admin', updatedAt: at }).where(eq(user.id, currentOwnerId)),
        db.update(user).set({ role: 'owner', updatedAt: at }).where(eq(user.id, newOwnerId)),
      ]);
    },
  };
}
