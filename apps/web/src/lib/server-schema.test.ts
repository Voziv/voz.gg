import { describe, it, expect } from 'vitest';
import { parseServerInput } from './server-schema';

const valid = {
  name: 'Survival',
  gameType: 'minecraft-java',
  host: 'mc.example.com',
  port: '25565',
  description: '  Friendly SMP  ',
};

describe('parseServerInput', () => {
  it('accepts valid input, coerces the port, and trims the description', () => {
    const r = parseServerInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        name: 'Survival',
        gameType: 'minecraft-java',
        host: 'mc.example.com',
        port: 25565,
        description: 'Friendly SMP',
        runAsUser: null,
        runAsGroup: null,
        gameServerUser: null,
        logPath: null,
        logParserEnabled: null,
      });
    }
  });

  it('turns a blank description into null', () => {
    const r = parseServerInput({ ...valid, description: '   ' });
    expect(r.ok && r.data.description).toBeNull();
  });

  it('omits description entirely → null', () => {
    const noDesc = { name: valid.name, gameType: valid.gameType, host: valid.host, port: valid.port };
    const r = parseServerInput(noDesc);
    expect(r.ok && r.data.description).toBeNull();
  });

  it('rejects an empty name', () => {
    const r = parseServerInput({ ...valid, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name is required/i);
  });

  it('rejects a name over 80 chars', () => {
    expect(parseServerInput({ ...valid, name: 'a'.repeat(81) }).ok).toBe(false);
  });

  it('rejects an unknown game type', () => {
    expect(parseServerInput({ ...valid, gameType: 'fortnite' }).ok).toBe(false);
  });

  it('rejects a host with illegal characters', () => {
    const r = parseServerInput({ ...valid, host: 'bad host!' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid host/i);
  });

  it('rejects a host containing a port (colon)', () => {
    const r = parseServerInput({ ...valid, host: 'mc.example.com:25565' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid host/i);
  });

  it.each(['0', '70000', '12.5', 'abc'])('rejects port %s', (port) => {
    expect(parseServerInput({ ...valid, port }).ok).toBe(false);
  });
});

describe('agent-host fields', () => {
  const base = { name: 'MC', gameType: 'minecraft-java', host: 'mc.example.com', port: 25565 };

  it('defaults the agent-host fields to null when omitted', () => {
    const r = parseServerInput(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.runAsUser).toBeNull();
    expect(r.data.runAsGroup).toBeNull();
    expect(r.data.gameServerUser).toBeNull();
    expect(r.data.logPath).toBeNull();
  });

  it('accepts valid unix usernames and an absolute log path', () => {
    const r = parseServerInput({
      ...base,
      runAsUser: 'voz-gg',
      runAsGroup: 'voz-gg',
      gameServerUser: 'minecraft',
      logPath: '/home/minecraft/logs',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.gameServerUser).toBe('minecraft');
    expect(r.data.logPath).toBe('/home/minecraft/logs');
  });

  it('coerces empty strings to null', () => {
    const r = parseServerInput({ ...base, gameServerUser: '', logPath: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.gameServerUser).toBeNull();
    expect(r.data.logPath).toBeNull();
  });

  it('rejects an invalid username', () => {
    const r = parseServerInput({ ...base, gameServerUser: 'Bad Name!' });
    expect(r.ok).toBe(false);
  });

  it('rejects a relative log path', () => {
    const r = parseServerInput({ ...base, logPath: 'relative/logs' });
    expect(r.ok).toBe(false);
  });
});

describe('logParserEnabled', () => {
  const base = { name: 'S', gameType: 'minecraft-java', host: 'h', port: 25565 };

  it('parses true and false', () => {
    const on = parseServerInput({ ...base, logParserEnabled: true });
    expect(on.ok && on.data.logParserEnabled).toBe(true);
    const off = parseServerInput({ ...base, logParserEnabled: false });
    expect(off.ok && off.data.logParserEnabled).toBe(false);
  });

  it('defaults to null when absent', () => {
    const r = parseServerInput(base);
    expect(r.ok && r.data.logParserEnabled).toBe(null);
  });

  it('rejects a non-boolean', () => {
    const r = parseServerInput({ ...base, logParserEnabled: 'yes' });
    expect(r.ok).toBe(false);
  });
});
