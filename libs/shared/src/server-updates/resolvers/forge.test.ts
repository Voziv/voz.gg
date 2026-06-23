import { forgeResolver } from './forge';
import type { Fetcher } from '../types';

const PROMOS = JSON.stringify({
  promos: { '1.21.1-latest': '52.0.40', '1.21.1-recommended': '52.0.20', '1.20.1-latest': '47.3.0' },
});
const fetchOk: Fetcher = async () => ({ ok: true, status: 200, async text() { return PROMOS; }, async json() { return JSON.parse(PROMOS); } });

describe('forgeResolver', () => {
  it('returns the latest build for the MC line', async () => {
    const r = await forgeResolver.resolveLatest({ source: 'forge', id: '1.21.1', channel: 'latest' }, fetchOk);
    expect(r.version).toBe('1.21.1-52.0.40');
  });
  it('returns the recommended build when requested', async () => {
    const r = await forgeResolver.resolveLatest({ source: 'forge', id: '1.21.1', channel: 'recommended' }, fetchOk);
    expect(r.version).toBe('1.21.1-52.0.20');
  });
  it('throws when the MC line has no promo', async () => {
    await expect(forgeResolver.resolveLatest({ source: 'forge', id: '1.99', channel: 'latest' }, fetchOk)).rejects.toThrow();
  });
});
