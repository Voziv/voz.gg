import { describe, it, expect, vi } from 'vitest';
import { isValidMinecraftUsernameSyntax, lookupMinecraftProfile } from './mojang';

describe('isValidMinecraftUsernameSyntax', () => {
  it.each(['Notch', 'abc', 'a_1_B', 'sixteen_chars_16'])('accepts %s', (n) =>
    expect(isValidMinecraftUsernameSyntax(n)).toBe(true),
  );
  it.each(['ab', 'this_name_is_too_long', 'has space', 'bad-dash'])('rejects %s', (n) =>
    expect(isValidMinecraftUsernameSyntax(n)).toBe(false),
  );
});

describe('lookupMinecraftProfile', () => {
  it('returns a dashed uuid + name on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' })));
    const result = await lookupMinecraftProfile('Notch', fetchMock);
    expect(result).toEqual({ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch' });
    expect(fetchMock.mock.calls[0][0]).toContain('users/profiles/minecraft/Notch');
  });

  it('returns null for an invalid username without fetching', async () => {
    const fetchMock = vi.fn();
    expect(await lookupMinecraftProfile('ab', fetchMock)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    expect(await lookupMinecraftProfile('Ghostxyz', fetchMock)).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toBeNull();
  });

  it('returns null when the payload lacks id/name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
    expect(await lookupMinecraftProfile('Notch', fetchMock)).toBeNull();
  });
});
