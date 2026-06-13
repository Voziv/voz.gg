import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './client';
import { presenceEvents, player, playerIdentity, serverAgent, user } from './schema';
import type { PresenceDao, PresenceEventRow } from './presence';
import { bearerToken, hashToken } from './agent-token';
import type { PlayerIdentityKind } from './schema';

export function createPresenceDao(db: Db): PresenceDao {
  return {
    async insertEvent(row: PresenceEventRow) {
      const inserted = await db
        .insert(presenceEvents)
        .values({
          id: crypto.randomUUID(),
          serverId: row.serverId,
          type: row.type,
          identityKind: row.identityKind,
          identityKey: row.identityKey,
          playerName: row.playerName,
          ip: row.ip,
          reason: row.reason,
          occurredAt: row.occurredAt,
          dedupeKey: row.dedupeKey,
        })
        .onConflictDoNothing({ target: presenceEvents.dedupeKey })
        .returning({ id: presenceEvents.id });
      return inserted.length > 0;
    },

    async ensurePlayerIdentity(kind: PlayerIdentityKind, key: string, name: string | null, now: Date) {
      const existing = await db
        .select({ id: playerIdentity.id })
        .from(playerIdentity)
        .where(and(eq(playerIdentity.kind, kind), eq(playerIdentity.identityKey, key)))
        .get();

      if (existing) {
        if (name) {
          await db
            .update(playerIdentity)
            .set({ displayName: name, updatedAt: now })
            .where(eq(playerIdentity.id, existing.id));
        }
        return;
      }

      const playerId = crypto.randomUUID();
      await db.insert(player).values({ id: playerId, displayName: name, createdAt: now, updatedAt: now });
      await db.insert(playerIdentity).values({
        id: crypto.randomUUID(),
        playerId,
        kind,
        identityKey: key,
        displayName: name,
        createdAt: now,
        updatedAt: now,
      });
    },

    async linkAccountIfMatch(kind: PlayerIdentityKind, key: string) {
      if (kind !== 'minecraft') return; // only Minecraft UUIDs are auto-linkable today
      const account = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.minecraftUuid, key))
        .get();
      if (!account) return;

      const identity = await db
        .select({ playerId: playerIdentity.playerId })
        .from(playerIdentity)
        .where(and(eq(playerIdentity.kind, kind), eq(playerIdentity.identityKey, key)))
        .get();
      if (!identity) return;

      await db
        .update(player)
        .set({ userId: account.id })
        .where(and(eq(player.id, identity.playerId), isNull(player.userId)));
    },
  };
}

// Resolve the server bound to an `Authorization: Bearer <agentToken>` header, or
// null if the token is missing/unknown.
export async function serverIdForAgentToken(db: Db, authHeader: string | null): Promise<string | null> {
  const token = bearerToken(authHeader);
  if (!token) return null;
  const row = await db
    .select({ serverId: serverAgent.serverId })
    .from(serverAgent)
    .where(eq(serverAgent.agentTokenHash, await hashToken(token)))
    .get();
  return row?.serverId ?? null;
}
