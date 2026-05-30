import { describe, it, expect, vi } from 'vitest';
import { fetchSteamSummary } from './api';

const summary = (over = {}) => ({
  response: { players: [{ personaname: 'Voz', avatarfull: 'https://img/av.jpg', profileurl: 'https://steam/voz', ...over }] },
});

describe('fetchSteamSummary', () => {
  it('returns persona, avatar, and profile url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(summary())));
    const result = await fetchSteamSummary('76561198000000000', 'KEY', fetchMock);
    expect(result).toEqual({ personaName: 'Voz', avatarUrl: 'https://img/av.jpg', profileUrl: 'https://steam/voz' });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('GetPlayerSummaries/v2');
    expect(url).toContain('key=KEY');
    expect(url).toContain('steamids=76561198000000000');
  });

  it('returns null when there are no players', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: { players: [] } })));
    expect(await fetchSteamSummary('76561198000000000', 'KEY', fetchMock)).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    expect(await fetchSteamSummary('76561198000000000', 'KEY', fetchMock)).toBeNull();
  });
});
