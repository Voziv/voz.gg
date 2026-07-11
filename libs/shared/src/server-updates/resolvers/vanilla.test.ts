import { describe, it, expect } from 'vitest';
import { vanillaResolver } from './vanilla';
import type { Fetcher } from '../types';

const MANIFEST = JSON.stringify({
  latest: { release: '1.21.4', snapshot: '24w39a' },
  versions: [
    { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T10:00:00+00:00' },
    { id: '24w39a', type: 'snapshot', releaseTime: '2024-09-25T10:00:00+00:00' },
  ],
});

const fetchOk: Fetcher = async () => ({ ok: true, status: 200, async text() { return MANIFEST; }, async json() { return JSON.parse(MANIFEST); } });

describe('vanillaResolver', () => {
  it('returns the latest release for the release channel', async () => {
    const r = await vanillaResolver.resolveLatest({ source: 'vanilla', channel: 'release' }, fetchOk);
    expect(r.version).toBe('1.21.4');
    expect(r.publishedAt).toBe(Date.parse('2024-12-03T10:00:00+00:00'));
  });
  it('returns the latest snapshot for the snapshot channel', async () => {
    const r = await vanillaResolver.resolveLatest({ source: 'vanilla', channel: 'snapshot' }, fetchOk);
    expect(r.version).toBe('24w39a');
  });
  it('throws on a non-ok response', async () => {
    const bad: Fetcher = async () => ({ ok: false, status: 503, async text() { return ''; }, async json() { return {}; } });
    await expect(vanillaResolver.resolveLatest({ source: 'vanilla', channel: 'release' }, bad)).rejects.toThrow();
  });
});

const MANIFEST_MIXED = JSON.stringify({
  latest: { release: '27.0', snapshot: '26w05a' },
  versions: [
    { id: '27.0', type: 'release', releaseTime: '2027-01-01T00:00:00+00:00' },
    { id: '26.3', type: 'release', releaseTime: '2026-09-01T00:00:00+00:00' },
    { id: '26.2', type: 'release', releaseTime: '2026-06-01T00:00:00+00:00' },
    { id: '26.1', type: 'release', releaseTime: '2026-03-01T00:00:00+00:00' },
    { id: '1.21.4', type: 'release', releaseTime: '2024-12-01T00:00:00+00:00' },
  ],
});
const fetchMixed: Fetcher = async () => ({ ok: true, status: 200, async text() { return MANIFEST_MIXED; }, async json() { return JSON.parse(MANIFEST_MIXED); } });

describe('vanillaResolver generation cap', () => {
  it('returns the newest release within the capped generation, not the overall latest', async () => {
    const r = await vanillaResolver.resolveLatest({ source: 'vanilla', channel: 'release', id: '26' }, fetchMixed);
    expect(r.version).toBe('26.3');
  });
  it('returns the overall latest when no generation cap is set', async () => {
    const r = await vanillaResolver.resolveLatest({ source: 'vanilla', channel: 'release', id: null }, fetchMixed);
    expect(r.version).toBe('27.0');
  });
  it('falls back to the overall latest when no version matches the cap', async () => {
    const r = await vanillaResolver.resolveLatest({ source: 'vanilla', channel: 'release', id: '99' }, fetchMixed);
    expect(r.version).toBe('27.0');
  });
});
