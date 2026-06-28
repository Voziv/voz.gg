import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { serverAgent, serverStatus, serverUpdateState, serverSnapshot, serverUpdateEvent, servers, type Db } from '@voz/shared';
import type { TokenResolver } from './agent-auth';

export interface ServerRow {
  id: string;
  gameType: import('@voz/shared').GameType;
  port: number;
  runAsUser: string | null;
  runAsGroup: string | null;
  gameServerUser: string | null;
  logPath: string | null;
  monitorEnabled: boolean | null;
  logParserEnabled: boolean | null;
  name: string;
  slug: string | null;
  serverControlEnabled: boolean | null;
  serverWorkingDir: string | null;
  startCommand: string | null;
  restartSchedule: string | null;
  updateSource: import('@voz/shared').UpdateSource | null;
  updatePolicy: import('@voz/shared').UpdatePolicy | null;
  desiredId: string | null;
  desiredKind: import('@voz/shared').DesiredKind | null;
  desiredVersion: string | null;
  desiredArtifactUrl: string | null;
  desiredArtifactHashAlgo: import('@voz/shared').HashAlgo | null;
  desiredArtifactHash: string | null;
  desiredArtifactSize: number | null;
  serverJvmArgs: string | null;
  desiredInstallLoader: 'forge' | 'neoforge' | 'fabric' | null;
  desiredInstallMcVersion: string | null;
  desiredInstallLoaderVersion: string | null;
}

export interface StatusUpsert {
  serverId: string;
  status: string;
  players: number | null;
  maxPlayers: number | null;
  version: string | null;
  latencyMs: number | null;
  checkedAt: Date;
}

export interface AgentDao extends TokenResolver {
  findServerByEnrollmentTokenHash(hash: string): Promise<ServerRow | null>;
  serverById(serverId: string): Promise<ServerRow | null>;
  completeEnrollment(serverId: string, agentTokenHash: string, enrolledAt: Date): Promise<void>;
  upsertStatus(row: StatusUpsert): Promise<void>;
  touchLastSeen(serverId: string, at: Date): Promise<void>;
  setCurrentVersion(serverId: string, version: string | null): Promise<void>;
  setApplyState(serverId: string, s: { applyStatus: string; applyError: string | null; lastAppliedAt: Date | null }): Promise<void>;
  replaceSnapshots(serverId: string, rows: Array<{ snapshotId: string; createdAt: Date; version: string | null; sizeBytes: number | null }>): Promise<void>;
  eventExists(serverId: string, kind: string, at: Date): Promise<boolean>;
  appendEvent(e: { serverId: string; at: Date; kind: string; fromVersion: string | null; toVersion: string | null; status: string; snapshotId: string | null; error: string | null }): Promise<void>;
  notifyTargetFor(serverId: string): Promise<{ name: string; webhookUrl: string | null } | null>;
}

export function createAgentDao(db: Db): AgentDao {
  const selectServer = (serverId: string) =>
    db
      .select({
        id: servers.id,
        gameType: servers.gameType,
        port: servers.port,
        runAsUser: servers.runAsUser,
        runAsGroup: servers.runAsGroup,
        gameServerUser: servers.gameServerUser,
        logPath: servers.logPath,
        monitorEnabled: servers.monitorEnabled,
        logParserEnabled: servers.logParserEnabled,
        name: servers.name,
        slug: servers.slug,
        serverControlEnabled: servers.serverControlEnabled,
        serverWorkingDir: servers.serverWorkingDir,
        startCommand: servers.startCommand,
        restartSchedule: servers.restartSchedule,
        serverJvmArgs: servers.serverJvmArgs,
        updateSource: servers.updateSource,
        updatePolicy: servers.updatePolicy,
        desiredId: serverUpdateState.desiredId,
        desiredKind: serverUpdateState.desiredKind,
        desiredVersion: serverUpdateState.desiredVersion,
        desiredArtifactUrl: serverUpdateState.desiredArtifactUrl,
        desiredArtifactHashAlgo: serverUpdateState.desiredArtifactHashAlgo,
        desiredArtifactHash: serverUpdateState.desiredArtifactHash,
        desiredArtifactSize: serverUpdateState.desiredArtifactSize,
        desiredInstallLoader: serverUpdateState.desiredInstallLoader,
        desiredInstallMcVersion: serverUpdateState.desiredInstallMcVersion,
        desiredInstallLoaderVersion: serverUpdateState.desiredInstallLoaderVersion,
      })
      .from(servers)
      .leftJoin(serverUpdateState, eq(serverUpdateState.serverId, servers.id))
      .where(eq(servers.id, serverId))
      .get();

  return {
    async findServerIdByAgentTokenHash(hash) {
      const row = await db
        .select({ serverId: serverAgent.serverId })
        .from(serverAgent)
        .where(eq(serverAgent.agentTokenHash, hash))
        .get();
      return row?.serverId ?? null;
    },

    async findServerByEnrollmentTokenHash(hash) {
      const agent = await db
        .select({ serverId: serverAgent.serverId, agentTokenHash: serverAgent.agentTokenHash })
        .from(serverAgent)
        .where(eq(serverAgent.enrollmentTokenHash, hash))
        .get();
      // One-time use: a matching enrollment hash that is already enrolled is rejected upstream,
      // but enrollmentTokenHash is nulled on completion so a used token will not match here at all.
      if (!agent) return null;
      return (await selectServer(agent.serverId)) ?? null;
    },

    async serverById(serverId) {
      return (await selectServer(serverId)) ?? null;
    },

    async completeEnrollment(serverId, agentTokenHash, enrolledAt) {
      await db
        .update(serverAgent)
        .set({ agentTokenHash, enrolledAt, enrollmentTokenHash: null })
        .where(eq(serverAgent.serverId, serverId));
    },

    async upsertStatus(row) {
      await db
        .insert(serverStatus)
        .values(row)
        .onConflictDoUpdate({
          target: serverStatus.serverId,
          set: {
            status: row.status,
            players: row.players,
            maxPlayers: row.maxPlayers,
            version: row.version,
            latencyMs: row.latencyMs,
            checkedAt: row.checkedAt,
          },
        });
    },

    async touchLastSeen(serverId, at) {
      await db.update(serverAgent).set({ lastSeenAt: at }).where(eq(serverAgent.serverId, serverId));
    },

    async notifyTargetFor(serverId) {
      const row = await db.select({ name: servers.name, webhookUrl: servers.discordWebhookUrl })
        .from(servers).where(eq(servers.id, serverId)).get();
      return row ?? null;
    },

    async setCurrentVersion(serverId, version) {
      await db.update(servers).set({ currentVersion: version }).where(eq(servers.id, serverId));
    },

    async setApplyState(serverId, s) {
      const set = { applyStatus: s.applyStatus as never, applyError: s.applyError, lastAppliedAt: s.lastAppliedAt };
      await db.insert(serverUpdateState).values({ serverId, ...set })
        .onConflictDoUpdate({ target: serverUpdateState.serverId, set }).run();
    },

    async replaceSnapshots(serverId, rows) {
      await db.delete(serverSnapshot).where(eq(serverSnapshot.serverId, serverId));
      if (rows.length) await db.insert(serverSnapshot).values(rows.map((r) => ({ serverId, ...r }))).run();
    },

    async eventExists(serverId, kind, at) {
      const row = await db.select({ id: serverUpdateEvent.id }).from(serverUpdateEvent)
        .where(and(eq(serverUpdateEvent.serverId, serverId), eq(serverUpdateEvent.kind, kind as never), eq(serverUpdateEvent.at, at))).get();
      return !!row;
    },

    async appendEvent(e) {
      await db.insert(serverUpdateEvent).values({ id: nanoid(12), ...e, kind: e.kind as never, status: e.status as never }).run();
    },
  };
}
