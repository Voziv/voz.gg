import { and, eq, like, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { player, playerIdentity, groupTag, playerGroupTag } from './schema';
import type { PlayerIdentityKind } from './schema';
import type { PlayerMutationsDao, PlayerCore, PlayerFieldsUpdate, PlayerSearchResult } from './player-mutations';

export function createPlayerMutationsDao(db: Db): PlayerMutationsDao {
  return {
    async getPlayer(id) {
      const row = await db
        .select({
          id: player.id,
          displayName: player.displayName,
          notes: player.notes,
          status: player.status,
          isBot: player.isBot,
          userId: player.userId,
        })
        .from(player)
        .where(eq(player.id, id))
        .get();
      return (row as PlayerCore | undefined) ?? null;
    },

    async updatePlayer(id, fields: PlayerFieldsUpdate & { userId?: string | null }, now) {
      await db
        .update(player)
        .set({ ...fields, updatedAt: now })
        .where(eq(player.id, id));
    },

    async findGroupByName(name) {
      const row = await db
        .select({ id: groupTag.id })
        .from(groupTag)
        .where(sql`lower(${groupTag.name}) = lower(${name})`)
        .get();
      return row ?? null;
    },

    async createGroupTag(name, now) {
      const id = crypto.randomUUID();
      await db.insert(groupTag).values({ id, name, createdAt: now, updatedAt: now });
      return id;
    },

    async attachGroup(playerId, groupTagId) {
      await db.insert(playerGroupTag).values({ playerId, groupTagId }).onConflictDoNothing();
    },

    async detachGroup(playerId, groupTagId) {
      await db
        .delete(playerGroupTag)
        .where(and(eq(playerGroupTag.playerId, playerId), eq(playerGroupTag.groupTagId, groupTagId)));
    },

    async findIdentity(kind: PlayerIdentityKind, key) {
      const row = await db
        .select({ playerId: playerIdentity.playerId })
        .from(playerIdentity)
        .where(and(eq(playerIdentity.kind, kind), eq(playerIdentity.identityKey, key)))
        .get();
      return row ?? null;
    },

    async addIdentity(playerId, kind: PlayerIdentityKind, key, now) {
      await db
        .insert(playerIdentity)
        .values({ id: crypto.randomUUID(), playerId, kind, identityKey: key, displayName: null, createdAt: now, updatedAt: now })
        .onConflictDoNothing();
    },

    async removeIdentity(playerId, kind: PlayerIdentityKind, key) {
      const deleted = await db
        .delete(playerIdentity)
        .where(
          and(
            eq(playerIdentity.playerId, playerId),
            eq(playerIdentity.kind, kind),
            eq(playerIdentity.identityKey, key),
          ),
        )
        .returning({ id: playerIdentity.id });
      return deleted.length > 0;
    },

    async repointIdentities(fromPlayerId, toPlayerId) {
      await db.update(playerIdentity).set({ playerId: toPlayerId }).where(eq(playerIdentity.playerId, fromPlayerId));
    },

    async unionGroups(fromPlayerId, toPlayerId) {
      const rows = await db
        .select({ groupTagId: playerGroupTag.groupTagId })
        .from(playerGroupTag)
        .where(eq(playerGroupTag.playerId, fromPlayerId))
        .all();
      for (const r of rows) {
        await db.insert(playerGroupTag).values({ playerId: toPlayerId, groupTagId: r.groupTagId }).onConflictDoNothing();
      }
      await db.delete(playerGroupTag).where(eq(playerGroupTag.playerId, fromPlayerId));
    },

    async deletePlayer(id) {
      await db.delete(player).where(eq(player.id, id));
    },

    async searchPlayers(query, limit): Promise<PlayerSearchResult[]> {
      const term = `%${query}%`;
      const rows = await db
        .select({
          id: player.id,
          displayName: player.displayName,
          identityKind: playerIdentity.kind,
          identityName: playerIdentity.displayName,
        })
        .from(player)
        .leftJoin(
          playerIdentity,
          and(eq(playerIdentity.playerId, player.id), eq(playerIdentity.kind, 'minecraft')),
        )
        .where(or(like(player.displayName, term), like(playerIdentity.displayName, term)))
        .limit(limit)
        .all();
      const seen = new Set<string>();
      const out: PlayerSearchResult[] = [];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({ id: r.id, displayName: r.displayName, minecraftName: r.identityName ?? null });
      }
      return out;
    },
  };
}
