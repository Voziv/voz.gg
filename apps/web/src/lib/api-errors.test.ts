import { describe, it, expect, vi, afterEach } from 'vitest';
import { APIError } from 'better-auth/api';
import { mapAuthApiError } from './api-errors';

afterEach(() => {
  vi.restoreAllMocks();
});

async function body(res: Response) {
  return (await res.json()) as { ok: boolean; error?: string };
}

describe('mapAuthApiError', () => {
  it('surfaces a 4xx APIError message verbatim with its status', async () => {
    const res = mapAuthApiError('test', new APIError('NOT_FOUND', { message: 'User not found.' }), 'fallback');
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ ok: false, error: 'User not found.' });
  });

  it('falls back to the generic message when a 4xx APIError has no body message', async () => {
    const res = mapAuthApiError('test', new APIError('BAD_REQUEST'), 'fallback');
    expect(res.status).toBe(400);
    const parsed = await body(res);
    expect(parsed.ok).toBe(false);
    expect(typeof parsed.error).toBe('string');
  });

  it('hides a 5xx APIError behind the generic message and a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mapAuthApiError('test', new APIError('INTERNAL_SERVER_ERROR', { message: 'leaky detail' }), 'fallback');
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ ok: false, error: 'fallback' });
  });

  it('hides a non-API error behind the generic message and a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mapAuthApiError('test', new Error('db exploded'), 'fallback');
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ ok: false, error: 'fallback' });
  });
});
