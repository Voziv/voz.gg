import { describe, it, expect } from 'vitest';
import { ftbResolver } from './ftb';
import type { Fetcher } from '../types';

const PACK = JSON.stringify({
  versions: [
    { id: 100, name: '1.20.0', type: 'release', updated: 1_700_000_000 },
    { id: 101, name: '1.21.0', type: 'release', updated: 1_710_000_000 },
    { id: 102, name: '1.22.0-beta', type: 'beta', updated: 1_720_000_000 },
  ],
});

describe('ftbResolver', () => {
  it('returns the newest stable version name and requests the pack', async () => {
    let requested = '';
    const fetchOk: Fetcher = async (url) => { requested = url; return { ok: true, status: 200, async text() { return PACK; }, async json() { return JSON.parse(PACK); } }; };
    const r = await ftbResolver.resolveLatest({ source: 'modpack', provider: 'ftb', id: '123', channel: 'stable' }, fetchOk);
    expect(requested).toBe('https://api.feed-the-beast.com/v1/modpack/123');
    expect(r.version).toBe('1.21.0');
  });
});
