import { describe, it, expect } from 'vitest';
import { buildProvisioning } from './agent-provisioning';

describe('buildProvisioning', () => {
  it('applies voz-gg run-as defaults and game-type defaults when fields are null', () => {
    expect(
      buildProvisioning({
        name: 'Default Server',
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
      }),
    ).toEqual({
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
      },
    });
  });

  it('leaves gameServerUser/logPath null for a game type with no defaults', () => {
    const p = buildProvisioning({
      name: 'Source Server',
      slug: null,
      gameType: 'source',
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
    });
    expect(p.capabilities.logParser.gameServerUser).toBeNull();
    expect(p.capabilities.logParser.logPath).toBeNull();
  });

  it('prefers explicit per-server values over defaults', () => {
    const p = buildProvisioning({
      name: 'Custom Server',
      slug: null,
      gameType: 'minecraft-java',
      runAsUser: 'svc',
      runAsGroup: 'svcgrp',
      gameServerUser: 'mc',
      logPath: '/srv/mc/logs',
      monitorEnabled: false,
      logParserEnabled: true,
      serverControlEnabled: null,
      serverWorkingDir: null,
      startCommand: null,
      restartSchedule: null,
    });
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
      },
    });
  });

  it('resolves each field independently when some are explicit and some null', () => {
    const p = buildProvisioning({
      name: 'Mixed Server',
      slug: null,
      gameType: 'minecraft-java',
      runAsUser: null,
      runAsGroup: null,
      gameServerUser: 'custom',
      logPath: null,
      monitorEnabled: null,
      logParserEnabled: null,
      serverControlEnabled: null,
      serverWorkingDir: null,
      startCommand: null,
      restartSchedule: null,
    });
    expect(p.capabilities.logParser.gameServerUser).toBe('custom');
    expect(p.capabilities.logParser.logPath).toBe('/home/minecraft/logs');
  });

  it('builds the serverControl capability from stored fields', () => {
    const p = buildProvisioning({
      name: 'Survival Main',
      slug: 'survival-main',
      gameType: 'minecraft-java',
      runAsUser: null, runAsGroup: null,
      gameServerUser: 'minecraft', logPath: null,
      monitorEnabled: null, logParserEnabled: null,
      serverControlEnabled: true,
      serverWorkingDir: '/home/minecraft/server',
      startCommand: './run.sh nogui',
      restartSchedule: '08:00',
    });
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
    const p = buildProvisioning({
      name: 'Test', slug: 'test',
      gameType: 'minecraft-java',
      runAsUser: null, runAsGroup: null,
      gameServerUser: null, logPath: null,
      monitorEnabled: null, logParserEnabled: null,
      serverControlEnabled: null,
      serverWorkingDir: null, startCommand: null, restartSchedule: null,
    });
    expect(p.capabilities.serverControl.enabled).toBe(false);
    expect(p.capabilities.serverControl.restartSchedule).toBe('');
    expect(p.capabilities.serverControl.slug).toBe('test');
  });

  it('derives the slug from the name when none is stored', () => {
    const p = buildProvisioning({
      name: 'My Server', slug: null,
      gameType: 'minecraft-java',
      runAsUser: null, runAsGroup: null,
      gameServerUser: null, logPath: null,
      monitorEnabled: null, logParserEnabled: null,
      serverControlEnabled: null,
      serverWorkingDir: null, startCommand: null, restartSchedule: null,
    });
    expect(p.capabilities.serverControl.slug).toBe('my-server');
  });
});
