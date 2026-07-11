import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { servers, serverUpdateState, type ModpackProvider, type UpdateSource } from '../schema';
import type { TrackedServer } from './detect';
import { inLineResolverId } from './mc-version';
import { resolverChannel } from './channel';

const HOSTS: Record<string, string> = {
  vanilla: 'launchermeta.mojang.com',
  forge: 'files.minecraftforge.net',
  neoforge: 'maven.neoforged.net',
  fabric: 'meta.fabricmc.net',
  'modpack:modrinth': 'api.modrinth.com',
  'modpack:ftb': 'api.feed-the-beast.com',
  'modpack:curseforge': 'api.curseforge.com',
};

export function hostFor(source: UpdateSource, provider?: ModpackProvider | null): string {
  if (source === 'modpack') {
    // packwiz host is per-pack (the pack.toml URL); resolved dynamically in toTrackedServer.
    return HOSTS[`modpack:${provider}`] ?? 'packwiz';
  }
  return HOSTS[source] ?? source;
}

type ServerRow = typeof servers.$inferSelect;

export function toTrackedServer(row: ServerRow): TrackedServer | null {
  const source = row.updateSource;
  if (!source || source === 'none') return null;
  const provider = row.modpackProvider ?? null;
  let host = hostFor(source, provider);
  if (host === 'packwiz' && row.modpackId) {
    try { host = new URL(row.modpackId).host; } catch { host = 'packwiz'; }
  }
  const id = inLineResolverId(source, row.currentVersion ?? null, row.updateVersionLine ?? null, row.modpackId ?? null);
  return {
    serverId: row.id,
    host,
    config: { source, provider, id, channel: resolverChannel(source, row.updateChannel ?? null) },
  };
}

export function createUpdateDetectionDao(db: Db) {
  return {
    async loadTrackedServers() {
      const rows = await db.select().from(servers).all();
      const states = await db.select().from(serverUpdateState).all();
      const stateById = new Map(states.map((s) => [s.serverId, s]));
      const out = [];
      for (const row of rows) {
        const tracked = toTrackedServer(row);
        if (!tracked) continue;
        const state = stateById.get(row.id);
        out.push({
          server: tracked,
          current: row.currentVersion ?? null,
          pinned: row.pinnedVersion ?? null,
          notified: state?.notifiedVersion ?? null,
          notifyTarget: { name: row.name, webhookUrl: row.discordWebhookUrl ?? null },
        });
      }
      return out;
    },

    async writeState(serverId: string, v: { version: string | null; publishedAt: number | null; error: string | null; checkedAt: Date }) {
      const values = {
        serverId,
        availableVersion: v.version,
        availablePublishedAt: v.publishedAt != null ? new Date(v.publishedAt) : null,
        lastError: v.error,
        checkedAt: v.checkedAt,
      };
      await db
        .insert(serverUpdateState)
        .values(values)
        .onConflictDoUpdate({ target: serverUpdateState.serverId, set: values })
        .run();
    },

    async markNotified(serverId: string, version: string) {
      await db.update(serverUpdateState).set({ notifiedVersion: version }).where(eq(serverUpdateState.serverId, serverId)).run();
    },

    async loadDesiredInputs() {
      const rows = await db.select().from(servers).all();
      const states = await db.select().from(serverUpdateState).all();
      const stateById = new Map(states.map((s) => [s.serverId, s]));
      const out = [];
      for (const row of rows) {
        if (!row.updateSource || row.updateSource === 'none') continue;
        const state = stateById.get(row.id);
        out.push({
          serverId: row.id,
          policy: row.updatePolicy ?? 'notify',
          source: row.updateSource,
          available: state?.availableVersion ?? null,
          installed: row.currentVersion ?? null,
          pinned: row.pinnedVersion ?? null,
          currentDesiredVersion: state?.desiredVersion ?? null,
          versionLine: row.updateVersionLine ?? null,
        });
      }
      return out;
    },

    async writeDesired(serverId: string, d: {
      id: string; kind: 'apply' | 'rollback'; version: string | null;
      artifact: { url: string; hashAlgo: string; hash: string; size: number } | null;
      install?: { loader: 'forge' | 'neoforge' | 'fabric'; minecraftVersion: string; loaderVersion: string } | null;
    }) {
      const set = {
        desiredId: d.id,
        desiredKind: d.kind,
        desiredVersion: d.version,
        desiredArtifactUrl: d.artifact?.url ?? null,
        desiredArtifactHashAlgo: (d.artifact?.hashAlgo ?? null) as 'sha1' | 'sha256' | null,
        desiredArtifactHash: d.artifact?.hash ?? null,
        desiredArtifactSize: d.artifact?.size ?? null,
        desiredInstallLoader: d.install?.loader ?? null,
        desiredInstallMcVersion: d.install?.minecraftVersion ?? null,
        desiredInstallLoaderVersion: d.install?.loaderVersion ?? null,
      };
      await db
        .insert(serverUpdateState)
        .values({ serverId, ...set })
        .onConflictDoUpdate({ target: serverUpdateState.serverId, set })
        .run();
    },

    async clearDesired(serverId: string) {
      await db.update(serverUpdateState).set({
        desiredId: null, desiredKind: null, desiredVersion: null,
        desiredArtifactUrl: null, desiredArtifactHashAlgo: null, desiredArtifactHash: null, desiredArtifactSize: null,
        desiredInstallLoader: null, desiredInstallMcVersion: null, desiredInstallLoaderVersion: null,
      }).where(eq(serverUpdateState.serverId, serverId)).run();
    },

    async loadMajorInputs() {
      const rows = await db.select().from(servers).all();
      const states = await db.select().from(serverUpdateState).all();
      const stateById = new Map(states.map((s) => [s.serverId, s]));
      const out = [];
      for (const row of rows) {
        const source = row.updateSource;
        if (!source || source === 'none' || source === 'modpack') continue;
        const state = stateById.get(row.id);
        out.push({
          serverId: row.id,
          name: row.name,
          source,
          config: {
            source,
            provider: row.modpackProvider ?? null,
            id: null as string | null,
            channel: resolverChannel(source, row.updateChannel ?? null),
          },
          installed: row.currentVersion ?? null,
          versionLine: row.updateVersionLine ?? null,
          majorPolicy: row.majorUpdatePolicy ?? (source === 'vanilla' ? 'auto' : 'approve'),
          currentDesiredVersion: state?.desiredVersion ?? null,
          notifiedMajor: state?.notifiedMajorVersion ?? null,
          webhookUrl: row.discordWebhookUrl ?? null,
        });
      }
      return out;
    },

    async writeAvailableMajor(serverId: string, generation: string | null) {
      await db
        .insert(serverUpdateState)
        .values({ serverId, availableMajorVersion: generation })
        .onConflictDoUpdate({ target: serverUpdateState.serverId, set: { availableMajorVersion: generation } })
        .run();
    },

    async markNotifiedMajor(serverId: string, generation: string) {
      await db.update(serverUpdateState).set({ notifiedMajorVersion: generation }).where(eq(serverUpdateState.serverId, serverId)).run();
    },

    async advanceMajor(serverId: string, d: {
      versionLine: string;
      desired: { id: string; version: string; artifact: { url: string; hashAlgo: string; hash: string; size: number }; install: { loader: 'forge' | 'neoforge' | 'fabric'; minecraftVersion: string; loaderVersion: string } | null };
    }) {
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

export type UpdateDetectionDao = ReturnType<typeof createUpdateDetectionDao>;
