import { packwizResolver } from './packwiz';
import type { Fetcher } from '../types';

const TOML = `name = "My Pack"\nversion = "2.3.1"\n[versions]\nminecraft = "1.21.1"\n`;

describe('packwizResolver', () => {
  it('reads the version field from pack.toml at the given url', async () => {
    let requested = '';
    const fetchOk: Fetcher = async (url) => { requested = url; return { ok: true, status: 200, async text() { return TOML; }, async json() { return {}; } }; };
    const r = await packwizResolver.resolveLatest({ source: 'modpack', provider: 'packwiz', id: 'https://ex.com/pack.toml', channel: null }, fetchOk);
    expect(requested).toBe('https://ex.com/pack.toml');
    expect(r.version).toBe('2.3.1');
  });
  it('throws when no version field is present', async () => {
    const noVer: Fetcher = async () => ({ ok: true, status: 200, async text() { return 'name = "x"'; }, async json() { return {}; } });
    await expect(packwizResolver.resolveLatest({ source: 'modpack', provider: 'packwiz', id: 'https://ex.com/pack.toml' }, noVer)).rejects.toThrow();
  });
});
