import { describe, it, expect } from 'vitest';
import { buildProvisioning } from './agent-provisioning';

describe('buildProvisioning', () => {
  it('applies voz-gg run-as defaults and game-type defaults when fields are null', () => {
    expect(
      buildProvisioning({
        gameType: 'minecraft-java',
        runAsUser: null,
        runAsGroup: null,
        gameServerUser: null,
        logPath: null,
        monitorEnabled: null,
        logParserEnabled: null,
      }),
    ).toEqual({
      runAsUser: 'voz-gg',
      runAsGroup: 'voz-gg',
      capabilities: {
        monitor: { enabled: true },
        logParser: { enabled: false, gameServerUser: 'minecraft', logPath: '/home/minecraft/logs' },
      },
    });
  });

  it('leaves gameServerUser/logPath null for a game type with no defaults', () => {
    const p = buildProvisioning({
      gameType: 'source',
      runAsUser: null,
      runAsGroup: null,
      gameServerUser: null,
      logPath: null,
      monitorEnabled: null,
      logParserEnabled: null,
    });
    expect(p.capabilities.logParser.gameServerUser).toBeNull();
    expect(p.capabilities.logParser.logPath).toBeNull();
  });

  it('prefers explicit per-server values over defaults', () => {
    const p = buildProvisioning({
      gameType: 'minecraft-java',
      runAsUser: 'svc',
      runAsGroup: 'svcgrp',
      gameServerUser: 'mc',
      logPath: '/srv/mc/logs',
      monitorEnabled: false,
      logParserEnabled: true,
    });
    expect(p).toEqual({
      runAsUser: 'svc',
      runAsGroup: 'svcgrp',
      capabilities: {
        monitor: { enabled: false },
        logParser: { enabled: true, gameServerUser: 'mc', logPath: '/srv/mc/logs' },
      },
    });
  });
});
