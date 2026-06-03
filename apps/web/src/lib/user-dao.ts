import { eq } from 'drizzle-orm';
import { user, type Db } from '@voz/shared';

export type UserRow = typeof user.$inferSelect;

export interface UserDao {
  byId(id: string): Promise<UserRow | null>;
}

export function createUserDao(db: Db): UserDao {
  return {
    async byId(id) {
      const row = await db.select().from(user).where(eq(user.id, id)).get();
      return row ?? null;
    },
  };
}
