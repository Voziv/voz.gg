import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from './client';
import { notificationLog, player, playerIdentity, servers, presenceEvents } from './schema';
import type { PlayerIdentityKind } from './schema';
import type { NotificationDao, NotificationTrigger } from './notifications';

export function createNotificationDao(db: Db): NotificationDao {
  return {
    async loadPlayer(kind: PlayerIdentityKind, key: string) {
      const row = await db
        .select({
          id: player.id,
          displayName: player.displayName,
          status: player.status,
          isBot: player.isBot,
          muted: player.muted,
        })
        .from(playerIdentity)
        .innerJoin(player, eq(player.id, playerIdentity.playerId))
        .where(and(eq(playerIdentity.kind, kind), eq(playerIdentity.identityKey, key)))
        .get();
      return row ?? null;
    },

    async loadServer(serverId: string) {
      const row = await db
        .select({ name: servers.name, discordWebhookUrl: servers.discordWebhookUrl })
        .from(servers)
        .where(eq(servers.id, serverId))
        .get();
      return row ?? null;
    },

    async lastSentByTrigger(serverId: string, identityKey: string) {
      const rows = await db
        .select({ trigger: notificationLog.trigger, occurredAt: notificationLog.occurredAt })
        .from(notificationLog)
        .where(and(eq(notificationLog.serverId, serverId), eq(notificationLog.identityKey, identityKey)))
        .orderBy(desc(notificationLog.occurredAt))
        .all();
      const out: Partial<Record<NotificationTrigger, number>> = {};
      for (const r of rows) {
        const epoch = Math.floor(r.occurredAt.getTime() / 1000);
        if (out[r.trigger] == null) out[r.trigger] = epoch; // rows are newest-first
      }
      return out;
    },

    async hasPriorJoin(serverId: string, identityKey: string, beforeEpochSeconds: number) {
      const row = await db
        .select({ id: presenceEvents.id })
        .from(presenceEvents)
        .where(
          and(
            eq(presenceEvents.serverId, serverId),
            eq(presenceEvents.identityKey, identityKey),
            eq(presenceEvents.type, 'join'),
            lt(presenceEvents.occurredAt, new Date(beforeEpochSeconds * 1000)),
          ),
        )
        .get();
      return row != null;
    },

    async recordNotification(row) {
      await db.insert(notificationLog).values({
        id: crypto.randomUUID(),
        serverId: row.serverId,
        identityKind: row.identityKind,
        identityKey: row.identityKey,
        trigger: row.trigger,
        occurredAt: new Date(row.occurredAt * 1000),
      });
    },
  };
}
