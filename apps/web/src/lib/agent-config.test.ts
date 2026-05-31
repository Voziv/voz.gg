import { describe, it, expect } from 'vitest';
import { buildAgentConfig, configHash, canonicalJson } from './agent-config';

const server = {
  id: 'srv123',
  gameType: 'minecraft-java' as const,
  port: 25565,
  queryPort: 0,
  pollIntervalSeconds: 30,
};

describe('buildAgentConfig', () => {
  it('builds the config shape with a localhost probeHost', () => {
    expect(buildAgentConfig(server)).toEqual({
      serverId: 'srv123',
      gameType: 'minecraft-java',
      probeHost: '127.0.0.1',
      port: 25565,
      queryPort: 0,
      pollIntervalSeconds: 30,
    });
  });

  it('defaults queryPort and pollIntervalSeconds when omitted', () => {
    expect(buildAgentConfig({ id: 's', gameType: 'source', port: 27015 })).toEqual({
      serverId: 's',
      gameType: 'source',
      probeHost: '127.0.0.1',
      port: 27015,
      queryPort: 0,
      pollIntervalSeconds: 30,
    });
  });
});

describe('canonicalJson', () => {
  it('sorts keys so property order does not affect output', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('configHash', () => {
  it('is a 64-char lowercase hex SHA-256 digest', async () => {
    const h = await configHash(buildAgentConfig(server));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic regardless of input key order', async () => {
    const a = await configHash({ port: 25565, serverId: 'x', gameType: 'source', probeHost: '127.0.0.1', queryPort: 0, pollIntervalSeconds: 30 });
    const b = await configHash({ serverId: 'x', gameType: 'source', probeHost: '127.0.0.1', port: 25565, queryPort: 0, pollIntervalSeconds: 30 });
    expect(a).toBe(b);
  });

  it('changes when the port changes (so a #5 edit re-syncs the agent)', async () => {
    const base = buildAgentConfig(server);
    const a = await configHash(base);
    const b = await configHash({ ...base, port: 25566 });
    expect(a).not.toBe(b);
  });
});
