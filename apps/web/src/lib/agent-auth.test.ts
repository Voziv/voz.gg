import { describe, it, expect } from 'vitest';
import { hashToken, generateToken, serverIdForToken } from './agent-auth';

describe('hashToken', () => {
  it('returns a 64-char hex digest and is deterministic', async () => {
    const a = await hashToken('abc');
    const b = await hashToken('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different tokens', async () => {
    expect(await hashToken('abc')).not.toBe(await hashToken('abd'));
  });
});

describe('generateToken', () => {
  it('produces a long unique opaque string', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('serverIdForToken', () => {
  it('resolves the serverId whose agentTokenHash matches', async () => {
    const token = 'agent-token-xyz';
    const hash = await hashToken(token);
    const dao = { findServerIdByAgentTokenHash: async (h: string) => (h === hash ? 'srv1' : null) };
    expect(await serverIdForToken(dao, token)).toBe('srv1');
  });

  it('returns null for an unknown token', async () => {
    const dao = { findServerIdByAgentTokenHash: async () => null };
    expect(await serverIdForToken(dao, 'nope')).toBeNull();
  });
});
