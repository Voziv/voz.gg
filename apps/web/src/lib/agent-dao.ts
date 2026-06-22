import { eq } from 'drizzle-orm';
import { serverAgent, serverStatus, servers, type Db } from '@voz/shared';
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
      })
      .from(servers)
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
  };
}
