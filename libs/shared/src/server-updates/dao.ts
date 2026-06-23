import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { servers, serverUpdateState, type ModpackProvider, type UpdateSource } from '../schema';
import type { TrackedServer } from './detect';

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
  return {
    serverId: row.id,
    host,
    config: { source, provider, id: row.modpackId ?? null, channel: row.updateChannel ?? null },
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
  };
}

export type UpdateDetectionDao = ReturnType<typeof createUpdateDetectionDao>;
