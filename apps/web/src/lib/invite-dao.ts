import { and, desc, eq } from 'drizzle-orm';
import { inviteRequest, type Db } from '@voz/shared';
import { normalizeEmail } from './invite-schema';

export type InviteRequestRow = typeof inviteRequest.$inferSelect;

export interface CreateInviteInput {
  id: string;
  name: string;
  discordName: string;
  email: string;
  now: Date;
}

export interface InviteDao {
  pendingExistsForEmail(email: string): Promise<boolean>;
  create(input: CreateInviteInput): Promise<void>;
  isEmailApproved(email: string): Promise<boolean>;
  byId(id: string): Promise<InviteRequestRow | null>;
  approve(id: string, reviewedBy: string, at: Date): Promise<void>;
  deny(id: string, reviewedBy: string, reason: string | null, at: Date): Promise<void>;
  listAll(): Promise<InviteRequestRow[]>;
}

export function createInviteDao(db: Db): InviteDao {
  return {
    async pendingExistsForEmail(email) {
      const row = await db
        .select({ id: inviteRequest.id })
        .from(inviteRequest)
        .where(and(eq(inviteRequest.email, normalizeEmail(email)), eq(inviteRequest.status, 'pending')))
        .get();
      return !!row;
    },

    async create({ id, name, discordName, email, now }) {
      await db.insert(inviteRequest).values({
        id,
        name,
        discordName,
        email: normalizeEmail(email),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
    },

    async isEmailApproved(email) {
      const row = await db
        .select({ id: inviteRequest.id })
        .from(inviteRequest)
        .where(and(eq(inviteRequest.email, normalizeEmail(email)), eq(inviteRequest.status, 'approved')))
        .get();
      return !!row;
    },

    async byId(id) {
      const row = await db.select().from(inviteRequest).where(eq(inviteRequest.id, id)).get();
      return row ?? null;
    },

    async approve(id, reviewedBy, at) {
      await db
        .update(inviteRequest)
        .set({ status: 'approved', reviewedBy, reviewedAt: at, updatedAt: at })
        .where(eq(inviteRequest.id, id));
    },

    async deny(id, reviewedBy, reason, at) {
      await db
        .update(inviteRequest)
        .set({ status: 'denied', denyReason: reason, reviewedBy, reviewedAt: at, updatedAt: at })
        .where(eq(inviteRequest.id, id));
    },

    async listAll() {
      return db.select().from(inviteRequest).orderBy(desc(inviteRequest.createdAt)).all();
    },
  };
}
