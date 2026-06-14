import { describe, it, expect, vi } from 'vitest';
import { fetchMinecraftLookup, lookupErrorMessage } from './minecraft-lookup';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), init);
}

describe('lookupErrorMessage', () => {
  it('maps not_found to a missing-user message', () => {
    expect(lookupErrorMessage('not_found')).toBe('No such Minecraft user.');
  });

  it('maps upstream to a retry message', () => {
    expect(lookupErrorMessage('upstream')).toMatch(/reach Minecraft/i);
  });

  it('falls back to an invalid-username message', () => {
    expect(lookupErrorMessage('invalid')).toBe('Invalid username.');
    expect(lookupErrorMessage(undefined)).toBe('Invalid username.');
  });
});

describe('fetchMinecraftLookup', () => {
  it('returns the verified profile on a successful lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, uuid: 'u-1', name: 'Notch' }));
    expect(await fetchMinecraftLookup('Notch', fetchMock)).toEqual({ ok: true, uuid: 'u-1', name: 'Notch' });
    expect(fetchMock.mock.calls[0][0]).toContain('/api/profile/minecraft?username=Notch');
  });

  it('surfaces an upstream failure as a retry message instead of hanging', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'upstream' }, { status: 503 }));
    const result = await fetchMinecraftLookup('Notch', fetchMock);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/reach Minecraft/i) });
  });

  it('surfaces a not_found result as a missing-user message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'not_found' }, { status: 404 }));
    expect(await fetchMinecraftLookup('Ghostxyz', fetchMock)).toEqual({ ok: false, message: 'No such Minecraft user.' });
  });

  it('does not hang when the response body is not json (e.g. a redirect to the sign-in page)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<!doctype html>', { status: 200 }));
    const result = await fetchMinecraftLookup('Notch', fetchMock);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/reach Minecraft/i) });
  });

  it('does not hang when the fetch itself rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await fetchMinecraftLookup('Notch', fetchMock);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/reach Minecraft/i) });
  });
});
