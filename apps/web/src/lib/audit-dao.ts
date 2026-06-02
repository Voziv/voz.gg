import { desc } from 'drizzle-orm';
import { adminAuditLog, type AdminAuditAction, type Db } from '@voz/shared';

export type AdminAuditRow = typeof adminAuditLog.$inferSelect;

export interface RecordAuditInput {
  id: string;
  actorId: string;
  action: AdminAuditAction;
  targetUserId: string;
  details?: Record<string, unknown> | null;
  at: Date;
}

export interface AuditDao {
  record(input: RecordAuditInput): Promise<void>;
  listRecent(limit: number): Promise<AdminAuditRow[]>;
}

export function createAuditDao(db: Db): AuditDao {
  return {
    async record({ id, actorId, action, targetUserId, details, at }) {
      await db.insert(adminAuditLog).values({
        id,
        actorId,
        action,
        targetUserId,
        details: details ? JSON.stringify(details) : null,
        createdAt: at,
      });
    },

    async listRecent(limit) {
      return db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(limit).all();
    },
  };
}
