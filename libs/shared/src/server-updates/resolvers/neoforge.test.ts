import { describe, it, expect } from 'vitest';
import { neoforgeResolver } from './neoforge';
import type { Fetcher } from '../types';

const XML = `<?xml version="1.0"?><metadata><versioning><versions>
<version>21.1.50</version><version>21.1.66</version><version>21.1.70-beta</version><version>20.4.190</version>
</versions></versioning></metadata>`;
const fetchOk: Fetcher = async () => ({ ok: true, status: 200, async text() { return XML; }, async json() { return {}; } });

describe('neoforgeResolver', () => {
  it('returns the latest stable for the line prefix', async () => {
    const r = await neoforgeResolver.resolveLatest({ source: 'neoforge', id: '21.1', channel: 'latest' }, fetchOk);
    expect(r.version).toBe('21.1.66');
  });
  it('includes beta entries when channel is beta', async () => {
    const r = await neoforgeResolver.resolveLatest({ source: 'neoforge', id: '21.1', channel: 'beta' }, fetchOk);
    expect(r.version).toBe('21.1.70-beta');
  });
});
