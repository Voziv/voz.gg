import { eq } from 'drizzle-orm';
import { createDb, servers, serverUpdateState, serverSnapshot } from '@voz/shared';
import type { ServerUpdateActionDao } from './server-update-actions';

// Real DAO backing the approve/rollback admin actions. Writing a desired also
// flips applyStatus to `pending` so the dashboard reflects the queued action
// immediately, before the agent next reports.
export function createServerUpdateActionDao(db: ReturnType<typeof createDb>): ServerUpdateActionDao {
  return {
    async loadActionState(serverId) {
      const row = await db
        .select({ source: servers.updateSource, available: serverUpdateState.availableVersion })
        .from(servers)
        .leftJoin(serverUpdateState, eq(serverUpdateState.serverId, servers.id))
        .where(eq(servers.id, serverId))
        .get();
      return row ?? null;
    },
    async writeDesired(serverId, d) {
      const set = {
        desiredId: d.desiredId,
        desiredKind: d.kind,
        desiredVersion: d.version,
        desiredArtifactUrl: d.artifact?.url ?? null,
        desiredArtifactHashAlgo: (d.artifact?.hashAlgo ?? null) as 'sha1' | 'sha256' | null,
        desiredArtifactHash: d.artifact?.hash ?? null,
        desiredArtifactSize: d.artifact?.size ?? null,
        applyStatus: 'pending' as const,
      };
      await db
        .insert(serverUpdateState)
        .values({ serverId, ...set })
        .onConflictDoUpdate({ target: serverUpdateState.serverId, set })
        .run();
    },
    async snapshotExists(serverId, snapshotId) {
      const rows = await db
        .select({ s: serverSnapshot.snapshotId })
        .from(serverSnapshot)
        .where(eq(serverSnapshot.serverId, serverId))
        .all();
      return rows.some((r) => r.s === snapshotId);
    },
  };
}
