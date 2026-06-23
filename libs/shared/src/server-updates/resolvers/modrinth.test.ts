import { describe, it, expect } from 'vitest';
import { modrinthResolver } from './modrinth';
import type { Fetcher } from '../types';

const VERSIONS = JSON.stringify([
  { name: 'Pack 1.5.0', version_number: '1.5.0', version_type: 'release', date_published: '2024-11-01T00:00:00Z' },
  { name: 'Pack 1.6.0-beta', version_number: '1.6.0-beta', version_type: 'beta', date_published: '2024-12-01T00:00:00Z' },
  { name: 'Pack 1.4.0', version_number: '1.4.0', version_type: 'release', date_published: '2024-10-01T00:00:00Z' },
]);

describe('modrinthResolver', () => {
  it('returns the newest release version and requests the project', async () => {
    let requested = '';
    const fetchOk: Fetcher = async (url) => { requested = url; return { ok: true, status: 200, async text() { return VERSIONS; }, async json() { return JSON.parse(VERSIONS); } }; };
    const r = await modrinthResolver.resolveLatest({ source: 'modpack', provider: 'modrinth', id: 'cobblemon', channel: 'release' }, fetchOk);
    expect(requested).toBe('https://api.modrinth.com/v2/project/cobblemon/version');
    expect(r.version).toBe('1.5.0');
    expect(r.publishedAt).toBe(Date.parse('2024-11-01T00:00:00Z'));
  });
  it('includes beta versions when channel is beta', async () => {
    const fetchOk: Fetcher = async () => ({ ok: true, status: 200, async text() { return VERSIONS; }, async json() { return JSON.parse(VERSIONS); } });
    const r = await modrinthResolver.resolveLatest({ source: 'modpack', provider: 'modrinth', id: 'cobblemon', channel: 'beta' }, fetchOk);
    expect(r.version).toBe('1.6.0-beta');
  });
});
