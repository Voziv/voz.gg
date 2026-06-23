import { describe, it, expect } from 'vitest';
import { fabricResolver } from './fabric';
import type { Fetcher } from '../types';

const LOADERS = JSON.stringify([
  { version: '0.16.5', stable: true },
  { version: '0.16.4', stable: true },
  { version: '0.17.0-beta.1', stable: false },
]);
const fetchOk: Fetcher = async () => ({ ok: true, status: 200, async text() { return LOADERS; }, async json() { return JSON.parse(LOADERS); } });

describe('fabricResolver', () => {
  it('returns the newest stable loader', async () => {
    const r = await fabricResolver.resolveLatest({ source: 'fabric', channel: 'latest' }, fetchOk);
    expect(r.version).toBe('0.16.5');
  });
});
