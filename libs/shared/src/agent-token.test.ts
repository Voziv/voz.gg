import { describe, it, expect } from 'vitest';
import { sha256Hex, hashToken, bearerToken } from './agent-token';

describe('sha256Hex', () => {
  it('hashes the empty string to the known SHA-256 vector', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('hashToken', () => {
  it('is sha256Hex of the token', async () => {
    expect(await hashToken('abc')).toBe(await sha256Hex('abc'));
  });
});

describe('bearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(bearerToken('Bearer xyz')).toBe('xyz');
  });
  it('is case-insensitive on the scheme and trims', () => {
    expect(bearerToken('  bearer   tok ')).toBe('tok');
  });
  it('returns null for a missing or malformed header', () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
  });
});
