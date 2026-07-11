import { eq } from 'drizzle-orm';
import { createDb, servers, serverUpdateState, serverSnapshot, resolverChannel } from '@voz/shared';
import type { ServerUpdateActionDao } from './server-update-actions';

// Real DAO backing the approve/rollback admin actions. Writing a desired also
// flips applyStatus to `pending` so the dashboard reflects the queued action
// immediately, before the agent next reports.
export function createServerUpdateActionDao(db: ReturnType<typeof createDb>): ServerUpdateActionDao {
  return {
    async loadActionState(serverId) {
      const row = await db
        .select({ source: servers.updateSource, available: serverUpdateState.availableVersion, versionLine: servers.updateVersionLine })
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
        desiredInstallLoader: d.install?.loader ?? null,
        desiredInstallMcVersion: d.install?.minecraftVersion ?? null,
        desiredInstallLoaderVersion: d.install?.loaderVersion ?? null,
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
    async loadMajorActionState(serverId) {
      const row = await db
        .select({
          source: servers.updateSource,
          availableMajor: serverUpdateState.availableMajorVersion,
          installed: servers.currentVersion,
          versionLine: servers.updateVersionLine,
          channel: servers.updateChannel,
          provider: servers.modpackProvider,
          serverControlEnabled: servers.serverControlEnabled,
        })
        .from(servers)
        .leftJoin(serverUpdateState, eq(serverUpdateState.serverId, servers.id))
        .where(eq(servers.id, serverId))
        .get();
      if (!row) return null;
      return {
        source: row.source,
        availableMajor: row.availableMajor ?? null,
        installed: row.installed ?? null,
        versionLine: row.versionLine ?? null,
        channel: row.source ? resolverChannel(row.source, row.channel ?? null) : null,
        provider: row.provider ?? null,
        serverControlEnabled: row.serverControlEnabled ?? false,
      };
    },
    async advanceMajor(serverId, d) {
      await db.update(servers).set({ updateVersionLine: d.versionLine }).where(eq(servers.id, serverId)).run();
      const set = {
        desiredId: d.desired.id,
        desiredKind: 'apply' as const,
        desiredVersion: d.desired.version,
        desiredArtifactUrl: d.desired.artifact.url,
        desiredArtifactHashAlgo: d.desired.artifact.hashAlgo as 'sha1' | 'sha256',
        desiredArtifactHash: d.desired.artifact.hash,
        desiredArtifactSize: d.desired.artifact.size,
        desiredInstallLoader: d.desired.install?.loader ?? null,
        desiredInstallMcVersion: d.desired.install?.minecraftVersion ?? null,
        desiredInstallLoaderVersion: d.desired.install?.loaderVersion ?? null,
        applyStatus: 'pending' as const,
        availableMajorVersion: null,
      };
      await db
        .insert(serverUpdateState)
        .values({ serverId, ...set })
        .onConflictDoUpdate({ target: serverUpdateState.serverId, set })
        .run();
    },
  };
}
