import { describe, it, expect } from 'vitest';
import { handleEnroll, handleConfig, handleStatus, handleUpdatesReport } from './agent-handlers';
import { buildAgentConfig, configHash } from './agent-config';
import { buildProvisioning } from './agent-provisioning';
import type { AgentDao, ServerRow, StatusUpsert } from './agent-dao';

const INGEST_BASE_URL = 'https://ingest.voz.gg';

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
  updateSource: null,
  updatePolicy: null,
  desiredId: null,
  desiredKind: null,
  desiredVersion: null,
  desiredArtifactUrl: null,
  desiredArtifactHashAlgo: null,
  desiredArtifactHash: null,
  desiredArtifactSize: null,
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
    setCurrentVersion: async () => { /* noop */ },
    setApplyState: async () => { /* noop */ },
    replaceSnapshots: async () => { /* noop */ },
    eventExists: async () => false,
    appendEvent: async () => { /* noop */ },
    notifyTargetFor: async () => ({ name: server.name, webhookUrl: null }),
    ...overrides,
  };
  return { dao, calls };
}

describe('handleEnroll', () => {
  it('mints + hashes an agent token, completes enrollment, returns config, hash, ingest URL, and provisioning', async () => {
    const { dao, calls } = fakeDao({ findServerByEnrollmentTokenHash: async () => server });
    const res = await handleEnroll(dao, { enrollmentToken: 'enroll-1' }, INGEST_BASE_URL);
    expect(res.status).toBe(200);
    const body = res.body as {
      agentToken: string;
      ingestBaseUrl: string;
      config: unknown;
      configHash: string;
      provisioning: unknown;
    };
    expect(body.agentToken.length).toBeGreaterThanOrEqual(32);
    expect(body.ingestBaseUrl).toBe(INGEST_BASE_URL);
    expect(body.config).toEqual(buildAgentConfig(server));
    expect(body.configHash).toBe(await configHash(buildAgentConfig(server)));
    expect(body.provisioning).toEqual(buildProvisioning(server));
    expect(calls.enrolled).toEqual(['srv1']);
  });

  it('rejects an unknown / already-used enrollment token with 401', async () => {
    const { dao } = fakeDao({ findServerByEnrollmentTokenHash: async () => null });
    const res = await handleEnroll(dao, { enrollmentToken: 'used' }, INGEST_BASE_URL);
    expect(res.status).toBe(401);
  });

  it('rejects a missing token with 400', async () => {
    const { dao } = fakeDao();
    const res = await handleEnroll(dao, {}, INGEST_BASE_URL);
    expect(res.status).toBe(400);
  });
});

describe('handleConfig', () => {
  it('returns config + hash + ingest URL + provisioning for a resolved server', async () => {
    const { dao } = fakeDao();
    const res = await handleConfig(dao, server.id, INGEST_BASE_URL);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      config: buildAgentConfig(server),
      configHash: await configHash(buildAgentConfig(server)),
      ingestBaseUrl: INGEST_BASE_URL,
      provisioning: buildProvisioning(server),
    });
  });

  it('returns 401 when the server cannot be resolved', async () => {
    const { dao } = fakeDao({ serverById: async () => null });
    const res = await handleConfig(dao, 'missing', INGEST_BASE_URL);
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

describe('handleUpdatesReport', () => {
  const noPost = async () => ({ status: 204 });
  const reportBody = {
    installedVersion: '1.21.4', applyStatus: 'done', applyError: null,
    lastEvent: null, snapshots: [],
  };

  it('401 without a server id', async () => {
    const { dao } = fakeDao();
    expect((await handleUpdatesReport(dao, null, reportBody, new Date(), noPost)).status).toBe(401);
  });

  it('400 on an invalid body', async () => {
    const { dao } = fakeDao();
    expect((await handleUpdatesReport(dao, 'srv1', { applyStatus: 'bad' }, new Date(), noPost)).status).toBe(400);
  });

  it('200 and records current version on a valid report', async () => {
    const recorded: string[] = [];
    const { dao } = fakeDao({ setCurrentVersion: async (id, v) => { recorded.push(`${id}=${v}`); } });
    const r = await handleUpdatesReport(dao, 'srv1', reportBody, new Date(), noPost);
    expect(r.status).toBe(200);
    expect(recorded).toEqual(['srv1=1.21.4']);
  });

  it('posts a failure alert to the webhook on a new failed event', async () => {
    const posts: string[] = [];
    const failBody = { ...reportBody, applyStatus: 'failed', lastEvent: { kind: 'auto_revert', fromVersion: '1.21.4', toVersion: '1.21.1', status: 'failed', snapshotId: 's', error: 'boom', at: '2026-06-27T04:05:00Z' } };
    const { dao } = fakeDao({ notifyTargetFor: async () => ({ name: 'Survival', webhookUrl: 'https://discord.test/hook' }) });
    await handleUpdatesReport(dao, 'srv1', failBody, new Date(), async (url: string) => { posts.push(url); return { status: 200 }; });
    expect(posts).toEqual(['https://discord.test/hook']);
  });
});
