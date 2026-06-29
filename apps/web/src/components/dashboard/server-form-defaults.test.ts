import { describe, it, expect } from 'vitest';
import { initialAgentHostValues, nextAgentHostValues, initialServerControlValues } from './server-form-defaults';

describe('initialAgentHostValues', () => {
  it('uses the game-type defaults when no stored values', () => {
    expect(initialAgentHostValues('minecraft-java')).toEqual({
      gameServerUser: 'minecraft',
      logPath: '/home/minecraft/logs',
      logParserEnabled: false,
    });
  });

  it('uses stored values over defaults', () => {
    expect(
      initialAgentHostValues('minecraft-java', { gameServerUser: 'mc', logPath: '/srv/mc' }),
    ).toEqual({ gameServerUser: 'mc', logPath: '/srv/mc', logParserEnabled: false });
  });

  it('is empty strings for a game type with no defaults', () => {
    expect(initialAgentHostValues('source')).toEqual({
      gameServerUser: '',
      logPath: '',
      logParserEnabled: false,
    });
  });
});

describe('nextAgentHostValues', () => {
  it('refreshes fields the user has not customized', () => {
    const current = { gameServerUser: 'minecraft', logPath: '/home/minecraft/logs', logParserEnabled: false };
    expect(nextAgentHostValues('minecraft-java', 'source', current)).toEqual({
      gameServerUser: '',
      logPath: '',
      logParserEnabled: false,
    });
  });

  it('keeps fields the user customized', () => {
    const current = { gameServerUser: 'mycustom', logPath: '/my/path', logParserEnabled: false };
    expect(nextAgentHostValues('minecraft-java', 'source', current)).toEqual({
      gameServerUser: 'mycustom',
      logPath: '/my/path',
      logParserEnabled: false,
    });
  });

  it('fills empty fields with the new game-type defaults', () => {
    const current = { gameServerUser: '', logPath: '', logParserEnabled: false };
    expect(nextAgentHostValues('source', 'minecraft-java', current)).toEqual({
      gameServerUser: 'minecraft',
      logPath: '/home/minecraft/logs',
      logParserEnabled: false,
    });
  });
});

describe('initialServerControlValues', () => {
  it('seeds from stored values', () => {
    expect(initialServerControlValues({
      serverControlEnabled: true,
      serverWorkingDir: '/srv/mc',
      startCommand: './run.sh',
      serverJvmArgs: '-Xmx4G',
      restartScheduleLocal: '03:00',
    })).toEqual({
      serverControlEnabled: true,
      serverWorkingDir: '/srv/mc',
      startCommand: './run.sh',
      serverJvmArgs: '-Xmx4G',
      restartTime: '03:00',
    });
  });

  it('defaults to disabled with empty fields when nothing stored', () => {
    expect(initialServerControlValues(undefined)).toEqual({
      serverControlEnabled: false,
      serverWorkingDir: '',
      startCommand: '',
      serverJvmArgs: '',
      restartTime: '',
    });
  });
});

describe('logParserEnabled in agent-host values', () => {
  it('seeds logParserEnabled from stored, defaulting to false', () => {
    expect(initialAgentHostValues('minecraft-java', {}).logParserEnabled).toBe(false);
    expect(
      initialAgentHostValues('minecraft-java', { logParserEnabled: true }).logParserEnabled,
    ).toBe(true);
  });

  it('preserves logParserEnabled across a game-type change', () => {
    const current = initialAgentHostValues('minecraft-java', { logParserEnabled: true });
    expect(nextAgentHostValues('minecraft-java', 'source', current).logParserEnabled).toBe(true);
  });
});
