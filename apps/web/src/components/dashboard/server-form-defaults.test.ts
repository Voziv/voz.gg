import { describe, it, expect } from 'vitest';
import { initialAgentHostValues, nextAgentHostValues } from './server-form-defaults';

describe('initialAgentHostValues', () => {
  it('uses the game-type defaults when no stored values', () => {
    expect(initialAgentHostValues('minecraft-java')).toEqual({
      gameServerUser: 'minecraft',
      logPath: '/home/minecraft/logs',
    });
  });

  it('uses stored values over defaults', () => {
    expect(
      initialAgentHostValues('minecraft-java', { gameServerUser: 'mc', logPath: '/srv/mc' }),
    ).toEqual({ gameServerUser: 'mc', logPath: '/srv/mc' });
  });

  it('is empty strings for a game type with no defaults', () => {
    expect(initialAgentHostValues('source')).toEqual({ gameServerUser: '', logPath: '' });
  });
});

describe('nextAgentHostValues', () => {
  it('refreshes fields the user has not customized', () => {
    const current = { gameServerUser: 'minecraft', logPath: '/home/minecraft/logs' };
    expect(nextAgentHostValues('minecraft-java', 'source', current)).toEqual({
      gameServerUser: '',
      logPath: '',
    });
  });

  it('keeps fields the user customized', () => {
    const current = { gameServerUser: 'mycustom', logPath: '/my/path' };
    expect(nextAgentHostValues('minecraft-java', 'source', current)).toEqual({
      gameServerUser: 'mycustom',
      logPath: '/my/path',
    });
  });

  it('fills empty fields with the new game-type defaults', () => {
    const current = { gameServerUser: '', logPath: '' };
    expect(nextAgentHostValues('source', 'minecraft-java', current)).toEqual({
      gameServerUser: 'minecraft',
      logPath: '/home/minecraft/logs',
    });
  });
});
