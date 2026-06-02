import { describe, it, expect, vi } from 'vitest';
import { verifyTurnstile, resolveTurnstileSecret, TURNSTILE_TEST_SECRET } from './turnstile';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('resolveTurnstileSecret', () => {
  it('returns the env secret when set', () => {
    expect(resolveTurnstileSecret({ TURNSTILE_SECRET_KEY: 'real' })).toBe('real');
  });
  it('falls back to the test secret when unset', () => {
    expect(resolveTurnstileSecret({})).toBe(TURNSTILE_TEST_SECRET);
  });
});

describe('verifyTurnstile', () => {
  it('returns false for an empty token without calling fetch', async () => {
    const fetchImpl = vi.fn();
    expect(await verifyTurnstile('', 'secret', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns true when siteverify reports success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    expect(await verifyTurnstile('tok', 'secret', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(true);
  });

  it('returns false when siteverify reports failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false }));
    expect(await verifyTurnstile('tok', 'secret', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
  });

  it('returns false on a non-ok HTTP response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false));
    expect(await verifyTurnstile('tok', 'secret', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
  });

  it('passes the remote IP through when provided', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    await verifyTurnstile('tok', 'secret', { remoteIp: '1.2.3.4', fetchImpl: fetchImpl as unknown as typeof fetch });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.body as URLSearchParams).get('remoteip')).toBe('1.2.3.4');
  });
});
