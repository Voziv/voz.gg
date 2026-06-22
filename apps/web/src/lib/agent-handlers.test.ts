import { describe, it, expect } from 'vitest';
import { handleEnroll, handleConfig, handleStatus } from './agent-handlers';
import { buildAgentConfig, configHash } from './agent-config';
import { buildProvisioning } from './agent-provisioning';
import type { AgentDao, ServerRow, StatusUpsert } from './agent-dao';

const server: ServerRow = {
  id: 'srv1',
  gameType: 'minecraft-java',
  port: 25565,
  runAsUser: null,
  runAsGroup: null,
  gameServerUser: null,
  logPath: null,
  monitorEnabled: null,
  logParserEnabled: null,
  name: 'Test Server',
  slug: null,
  serverControlEnabled: null,
  serverWorkingDir: null,
  startCommand: null,
  restartSchedule: null,
};

function fakeDao(overrides: Partial<AgentDao> = {}) {
  const calls: { upserts: StatusUpsert[]; lastSeen: string[]; enrolled: string[] } = {
    upserts: [],
    lastSeen: [],
    enrolled: [],
  };
  const dao: AgentDao = {
    findServerIdByAgentTokenHash: async () => null,
    findServerByEnrollmentTokenHash: async () => null,
    serverById: async (id) => (id === server.id ? server : null),
    completeEnrollment: async (id) => {
      calls.enrolled.push(id);
    },
    upsertStatus: async (row) => {
      calls.upserts.push(row);
    },
    touchLastSeen: async (id) => {
      calls.lastSeen.push(id);
    },
    ...overrides,
  };
  return { dao, calls };
}

describe('handleEnroll', () => {
  it('mints + hashes an agent token, completes enrollment, returns config, hash, and provisioning', async () => {
    const { dao, calls } = fakeDao({ findServerByEnrollmentTokenHash: async () => server });
    const res = await handleEnroll(dao, { enrollmentToken: 'enroll-1' });
    expect(res.status).toBe(200);
    const body = res.body as {
      agentToken: string;
      config: unknown;
      configHash: string;
      provisioning: unknown;
    };
    expect(body.agentToken.length).toBeGreaterThanOrEqual(32);
    expect(body.config).toEqual(buildAgentConfig(server));
    expect(body.configHash).toBe(await configHash(buildAgentConfig(server)));
    expect(body.provisioning).toEqual(buildProvisioning(server));
    expect(calls.enrolled).toEqual(['srv1']);
  });

  it('rejects an unknown / already-used enrollment token with 401', async () => {
    const { dao } = fakeDao({ findServerByEnrollmentTokenHash: async () => null });
    const res = await handleEnroll(dao, { enrollmentToken: 'used' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing token with 400', async () => {
    const { dao } = fakeDao();
    const res = await handleEnroll(dao, {});
    expect(res.status).toBe(400);
  });
});

describe('handleConfig', () => {
  it('returns config + hash + provisioning for a resolved server', async () => {
    const { dao } = fakeDao();
    const res = await handleConfig(dao, server.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      config: buildAgentConfig(server),
      configHash: await configHash(buildAgentConfig(server)),
      provisioning: buildProvisioning(server),
    });
  });

  it('returns 401 when the server cannot be resolved', async () => {
    const { dao } = fakeDao({ serverById: async () => null });
    const res = await handleConfig(dao, 'missing');
    expect(res.status).toBe(401);
  });
});

describe('handleStatus', () => {
  it('upserts status, touches lastSeen, and returns the current configHash', async () => {
    const { dao, calls } = fakeDao();
    const now = new Date('2026-05-31T00:00:00Z');
    const res = await handleStatus(
      dao,
      server.id,
      { status: 'online', players: 12, maxPlayers: 50, version: '1.21', latencyMs: 23, configHash: 'stale' },
      now,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configHash: await configHash(buildAgentConfig(server)) });
    expect(calls.upserts[0]).toEqual({
      serverId: 'srv1',
      status: 'online',
      players: 12,
      maxPlayers: 50,
      version: '1.21',
      latencyMs: 23,
      checkedAt: now,
    });
    expect(calls.lastSeen).toEqual(['srv1']);
  });

  it('coerces omitted optional fields to null', async () => {
    const { dao, calls } = fakeDao();
    const now = new Date('2026-05-31T00:00:00Z');
    await handleStatus(dao, server.id, { status: 'offline', configHash: 'x' }, now);
    expect(calls.upserts[0]).toMatchObject({ players: null, maxPlayers: null, version: null, latencyMs: null });
  });

  it('rejects a body with no status (400)', async () => {
    const { dao } = fakeDao();
    const res = await handleStatus(dao, server.id, { configHash: 'x' }, new Date());
    expect(res.status).toBe(400);
  });

  it('returns 401 when the server cannot be resolved', async () => {
    const { dao } = fakeDao({ serverById: async () => null });
    const res = await handleStatus(dao, 'missing', { status: 'online', configHash: 'x' }, new Date());
    expect(res.status).toBe(401);
  });
});
