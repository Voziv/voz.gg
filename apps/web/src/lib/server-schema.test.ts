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
