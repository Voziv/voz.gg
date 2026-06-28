import { describe, it, expect } from 'vitest';
import { buildProvisioning, type ProvisioningInput } from './agent-provisioning';

// Input helper: every field defaults to null/absent so each test states only what
// it cares about. The update-tracking fields all default to null (untracked).
function mk(overrides: Partial<ProvisioningInput>): ProvisioningInput {
  return {
    name: 'Server',
    slug: null,
    gameType: 'minecraft-java',
    runAsUser: null,
    runAsGroup: null,
    gameServerUser: null,
    logPath: null,
    monitorEnabled: null,
    logParserEnabled: null,
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
    ...overrides,
  };
}

const disabledUpdates = { enabled: false, policy: 'notify', desired: null } as const;

describe('buildProvisioning', () => {
  it('applies voz-gg run-as defaults and game-type defaults when fields are null', () => {
    expect(buildProvisioning(mk({ name: 'Default Server' }))).toEqual({
      runAsUser: 'voz-gg',
      runAsGroup: 'voz-gg',
      capabilities: {
        monitor: { enabled: true },
        logParser: { enabled: false, gameServerUser: 'minecraft', logPath: '/home/minecraft/logs' },
        serverControl: {
          enabled: false,
          slug: 'default-server',
          serverUser: 'minecraft',
          workingDir: null,
          startCommand: null,
          restartSchedule: '',
          rconPort: 25575,
        },
        updates: disabledUpdates,
      },
    });
  });

  it('leaves gameServerUser/logPath null for a game type with no defaults', () => {
    const p = buildProvisioning(mk({ name: 'Source Server', gameType: 'source' }));
    expect(p.capabilities.logParser.gameServerUser).toBeNull();
    expect(p.capabilities.logParser.logPath).toBeNull();
  });

  it('prefers explicit per-server values over defaults', () => {
    const p = buildProvisioning(mk({
      name: 'Custom Server',
      runAsUser: 'svc', runAsGroup: 'svcgrp',
      gameServerUser: 'mc', logPath: '/srv/mc/logs',
      monitorEnabled: false, logParserEnabled: true,
    }));
    expect(p).toEqual({
      runAsUser: 'svc',
      runAsGroup: 'svcgrp',
      capabilities: {
        monitor: { enabled: false },
        logParser: { enabled: true, gameServerUser: 'mc', logPath: '/srv/mc/logs' },
        serverControl: {
          enabled: false,
          slug: 'custom-server',
          serverUser: 'mc',
          workingDir: null,
          startCommand: null,
          restartSchedule: '',
          rconPort: 25575,
        },
        updates: disabledUpdates,
      },
    });
  });

  it('resolves each field independently when some are explicit and some null', () => {
    const p = buildProvisioning(mk({ name: 'Mixed Server', gameServerUser: 'custom' }));
    expect(p.capabilities.logParser.gameServerUser).toBe('custom');
    expect(p.capabilities.logParser.logPath).toBe('/home/minecraft/logs');
  });

  it('builds the serverControl capability from stored fields', () => {
    const p = buildProvisioning(mk({
      name: 'Survival Main', slug: 'survival-main',
      gameServerUser: 'minecraft',
      serverControlEnabled: true,
      serverWorkingDir: '/home/minecraft/server',
      startCommand: './run.sh nogui',
      restartSchedule: '08:00',
    }));
    expect(p.capabilities.serverControl).toEqual({
      enabled: true,
      slug: 'survival-main',
      serverUser: 'minecraft',
      workingDir: '/home/minecraft/server',
      startCommand: './run.sh nogui',
      restartSchedule: '08:00',
      rconPort: 25575,
    });
  });

  it('disables serverControl and blanks the schedule when fields are null', () => {
    const p = buildProvisioning(mk({ name: 'Test', slug: 'test' }));
    expect(p.capabilities.serverControl.enabled).toBe(false);
    expect(p.capabilities.serverControl.restartSchedule).toBe('');
    expect(p.capabilities.serverControl.slug).toBe('test');
  });

  it('derives the slug from the name when none is stored', () => {
    const p = buildProvisioning(mk({ name: 'My Server' }));
    expect(p.capabilities.serverControl.slug).toBe('my-server');
  });

  it('builds a disabled updates capability when no update source', () => {
    const p = buildProvisioning(mk({ name: 'S', slug: 's' }));
    expect(p.capabilities.updates).toEqual(disabledUpdates);
  });

  it('emits a desired apply with artifact when present', () => {
    const p = buildProvisioning(mk({
      name: 'S', slug: 's',
      serverControlEnabled: true,
      serverWorkingDir: '/srv/s', startCommand: '/srv/s/current/run.sh', restartSchedule: '04:00',
      updateSource: 'vanilla', updatePolicy: 'auto',
      desiredId: 'apply:1.21.4', desiredKind: 'apply', desiredVersion: '1.21.4',
      desiredArtifactUrl: 'https://x/server.jar', desiredArtifactHashAlgo: 'sha1', desiredArtifactHash: 'abc', desiredArtifactSize: 10,
    }));
    expect(p.capabilities.updates.desired).toEqual({
      id: 'apply:1.21.4', kind: 'apply', version: '1.21.4',
      artifact: { url: 'https://x/server.jar', hashAlgo: 'sha1', hash: 'abc', size: 10 },
      snapshotId: null,
    });
  });

  it('maps a rollback desired version into snapshotId', () => {
    const p = buildProvisioning(mk({
      name: 'S', slug: 's',
      serverControlEnabled: true, serverWorkingDir: '/srv/s', startCommand: '/srv/s/current/run.sh',
      updateSource: 'vanilla', updatePolicy: 'approve',
      desiredId: 'rollback:snap-1', desiredKind: 'rollback', desiredVersion: 'snap-1',
    }));
    expect(p.capabilities.updates.desired).toEqual({
      id: 'rollback:snap-1', kind: 'rollback', version: null, artifact: null, snapshotId: 'snap-1',
    });
  });
});
