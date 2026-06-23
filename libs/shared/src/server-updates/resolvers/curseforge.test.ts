import { describe, it, expect } from 'vitest';
import { curseforgeResolver, MissingApiKeyError } from './curseforge';
import type { Fetcher } from '../types';

const FILES = JSON.stringify({
  data: [
    { id: 1, displayName: 'Pack-1.0.0', fileDate: '2024-10-01T00:00:00Z', releaseType: 1 },
    { id: 2, displayName: 'Pack-1.1.0', fileDate: '2024-12-01T00:00:00Z', releaseType: 1 },
  ],
});

describe('curseforgeResolver', () => {
  it('throws MissingApiKeyError when no key is configured', async () => {
    const never: Fetcher = async () => { throw new Error('should not fetch'); };
    await expect(curseforgeResolver.resolveLatest({ source: 'modpack', provider: 'curseforge', id: '999' }, never))
      .rejects.toBeInstanceOf(MissingApiKeyError);
  });
  it('sends the api key header and returns the newest file name', async () => {
    let sentKey = '';
    const fetchOk: Fetcher = async (_url, init) => { sentKey = init?.headers?.['x-api-key'] ?? ''; return { ok: true, status: 200, async text() { return FILES; }, async json() { return JSON.parse(FILES); } }; };
    const r = await curseforgeResolver.resolveLatest({ source: 'modpack', provider: 'curseforge', id: '999', apiKey: 'abc' }, fetchOk);
    expect(sentKey).toBe('abc');
    expect(r.version).toBe('Pack-1.1.0');
  });
});
