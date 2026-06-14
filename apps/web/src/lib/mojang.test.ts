import { describe, it, expect, vi, afterEach } from 'vitest';
import { isValidMinecraftUsernameSyntax, lookupMinecraftProfile } from './mojang';

describe('isValidMinecraftUsernameSyntax', () => {
  it.each(['Notch', 'abc', 'a_1_B', 'sixteen_chars_16'])('accepts %s', (n) =>
    expect(isValidMinecraftUsernameSyntax(n)).toBe(true),
  );
  it.each(['ab', 'this_name_is_too_long', 'has space', 'bad-dash'])('rejects %s', (n) =>
    expect(isValidMinecraftUsernameSyntax(n)).toBe(false),
  );
});

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), init);
}

// Shape returned by https://playerdb.co/api/player/minecraft/<name>.
function playerDbFound(username: string, rawId: string) {
  return jsonResponse({
    code: 'player.found',
    data: { player: { username, raw_id: rawId, id: 'ignored-dashed-value' } },
  });
}

function playerDbNotFound() {
  return jsonResponse(
    { code: 'minecraft.invalid_username', message: 'No Minecraft user could be found.', success: false },
    { status: 400 },
  );
}

describe('lookupMinecraftProfile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a found result with a dashed uuid + name on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(playerDbFound('Notch', '069a79f444e94726a5befca90e38aaf5'));
    const result = await lookupMinecraftProfile('Notch', fetchMock);
    expect(result).toEqual({
      kind: 'found',
      profile: { uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch' },
    });
    expect(fetchMock.mock.calls[0][0]).toContain('player/minecraft/Notch');
  });

  it('sends a descriptive User-Agent so the upstream does not reject the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(playerDbFound('Notch', '069a79f444e94726a5befca90e38aaf5'));
    await lookupMinecraftProfile('Notch', fetchMock);
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('User-Agent')).toMatch(/voz\.gg/i);
  });

  it('returns not_found for an invalid username without fetching', async () => {
    const fetchMock = vi.fn();
    expect(await lookupMinecraftProfile('ab', fetchMock)).toEqual({ kind: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns not_found when the upstream reports an unregistered username', async () => {
    const fetchMock = vi.fn().mockResolvedValue(playerDbNotFound());
    expect(await lookupMinecraftProfile('Ghostxyz', fetchMock)).toEqual({ kind: 'not_found' });
  });

  it('returns not_found on a 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    expect(await lookupMinecraftProfile('Ghostxyz', fetchMock)).toEqual({ kind: 'not_found' });
  });

  it('returns an error carrying the status when the upstream blocks the worker (403)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toEqual({ kind: 'error', status: 403 });
  });

  it('returns an error carrying the status when rate limited (429)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 }));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toEqual({ kind: 'error', status: 429 });
  });

  it('treats a 400 without the not-found code as an error, not a missing user', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 'some.other.error' }, { status: 400 }));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toEqual({ kind: 'error', status: 400 });
  });

  it('logs the failing status so the upstream block is diagnosable in worker logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }));
    await lookupMinecraftProfile('Notch', fetchMock);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain('403');
  });

  it('returns an error when the payload lacks a usable id/name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 'player.found', data: { player: {} } }));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toEqual({ kind: 'error' });
  });

  it('returns an error when the fetch rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toEqual({ kind: 'error' });
  });

  it('returns an error when the ok response body is not valid json', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toEqual({ kind: 'error' });
  });
});
