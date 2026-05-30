import { describe, it, expect, vi } from 'vitest';
import { buildSteamLoginUrl, parseSteamId64, verifySteamAssertion } from './openid';

describe('buildSteamLoginUrl', () => {
  it('builds a checkid_setup URL with return_to and realm', () => {
    const url = new URL(buildSteamLoginUrl('https://voz.gg/api/auth/steam/callback', 'https://voz.gg'));
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(url.searchParams.get('openid.ns')).toBe('http://specs.openid.net/auth/2.0');
    expect(url.searchParams.get('openid.return_to')).toBe('https://voz.gg/api/auth/steam/callback');
    expect(url.searchParams.get('openid.realm')).toBe('https://voz.gg');
    expect(url.searchParams.get('openid.identity')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
    expect(url.searchParams.get('openid.claimed_id')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
  });
});

describe('parseSteamId64', () => {
  it('extracts the 17-digit id from a claimed_id', () => {
    expect(parseSteamId64('https://steamcommunity.com/openid/id/76561198000000000')).toBe('76561198000000000');
  });
  it('returns null for a non-matching claimed_id', () => {
    expect(parseSteamId64('https://example.com/nope')).toBeNull();
  });
});

describe('verifySteamAssertion', () => {
  const params = (overrides: Record<string, string> = {}) =>
    new URLSearchParams({
      'openid.mode': 'id_res',
      'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000000',
      'openid.signed': 'signed',
      'openid.sig': 'abc',
      ...overrides,
    });

  it('returns ok with steamId64 when Steam confirms is_valid:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'),
    );
    const result = await verifySteamAssertion(params(), fetchMock);
    expect(result).toEqual({ ok: true, steamId64: '76561198000000000' });
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('openid.mode=check_authentication');
  });

  it('fails when mode is not id_res', async () => {
    const fetchMock = vi.fn();
    const result = await verifySteamAssertion(params({ 'openid.mode': 'cancel' }), fetchMock);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when Steam returns is_valid:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('is_valid:false\n'));
    const result = await verifySteamAssertion(params(), fetchMock);
    expect(result.ok).toBe(false);
  });

  it('fails when claimed_id is malformed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('is_valid:true\n'));
    const result = await verifySteamAssertion(params({ 'openid.claimed_id': 'https://bad/id' }), fetchMock);
    expect(result.ok).toBe(false);
  });
});
