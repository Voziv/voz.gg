import { desc, count } from 'drizzle-orm';
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
  listRecent(limit: number, offset?: number): Promise<AdminAuditRow[]>;
  count(): Promise<number>;
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

    async listRecent(limit, offset = 0) {
      return db
        .select()
        .from(adminAuditLog)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
    },

    async count() {
      const row = await db.select({ value: count() }).from(adminAuditLog).get();
      return row?.value ?? 0;
    },
  };
}
