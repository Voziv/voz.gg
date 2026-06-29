import { describe, it, expect } from 'vitest';
import { approveUpdate, requestRollback } from './server-update-actions';

const artifact = { url: 'https://x/server.jar', hashAlgo: 'sha1', hash: 'abc', size: 10 } as const;

function dao(state: any) {
  const writes: any[] = [];
  return {
    writes,
    async loadActionState() { return state; },
    async writeDesired(id: string, d: any) { writes.push({ id, ...d }); },
    async snapshotExists(_id: string, snapshotId: string) { return snapshotId === 'snap-1'; },
  };
}

describe('approveUpdate', () => {
  it('resolves the artifact and writes a desired apply', async () => {
    const d = dao({ source: 'vanilla', available: '1.21.4', versionLine: null });
    const res = await approveUpdate({ dao: d, artifactResolverFor: () => ({ resolveArtifact: async () => artifact }) }, 's1');
    expect(res.ok).toBe(true);
    expect(d.writes[0]).toEqual({ id: 's1', desiredId: 'apply:1.21.4', kind: 'apply', version: '1.21.4', artifact, snapshotId: null, install: null });
  });
  it('fails when there is no available version', async () => {
    const d = dao({ source: 'vanilla', available: null, versionLine: null });
    const res = await approveUpdate({ dao: d, artifactResolverFor: () => null }, 's1');
    expect(res.ok).toBe(false);
  });
  it('fails when the artifact resolver is null', async () => {
    const d = dao({ source: 'neoforge', available: '21.1.50', versionLine: '21.1' });
    const res = await approveUpdate({ dao: d, artifactResolverFor: () => null }, 's1');
    expect(res.ok).toBe(false);
  });
  it('resolves the loader installer + install descriptor for neoforge', async () => {
    const d = dao({ source: 'neoforge', available: '21.1.234', versionLine: '21.1' });
    const res = await approveUpdate({ dao: d, artifactResolverFor: () => ({ resolveArtifact: async () => ({ url: 'u', hashAlgo: 'sha256', hash: 'h', size: 1 }) }) }, 's1');
    expect(res.ok).toBe(true);
    expect(d.writes[0]).toMatchObject({
      kind: 'apply', version: '21.1.234',
      install: { loader: 'neoforge', minecraftVersion: '1.21.1', loaderVersion: '21.1.234' },
    });
  });
  it('fails for fabric without a version line', async () => {
    const d = dao({ source: 'fabric', available: '0.16.9', versionLine: null });
    const res = await approveUpdate({ dao: d, artifactResolverFor: () => ({ resolveArtifact: async () => ({ url: 'u', hashAlgo: 'sha1', hash: 'h', size: 1 }) }) }, 's1');
    expect(res.ok).toBe(false);
    expect((res as any).error).toMatch(/version line/i);
  });
});

describe('requestRollback', () => {
  it('writes a desired rollback for a known snapshot', async () => {
    const d = dao({ source: 'vanilla', available: '1.21.4', versionLine: null });
    const res = await requestRollback({ dao: d, artifactResolverFor: () => null }, 's1', 'snap-1');
    expect(res.ok).toBe(true);
    expect(d.writes[0]).toEqual({ id: 's1', desiredId: 'rollback:snap-1', kind: 'rollback', version: 'snap-1', artifact: null, snapshotId: 'snap-1', install: null });
  });
  it('rejects an unknown snapshot', async () => {
    const d = dao({ source: 'vanilla', available: '1.21.4', versionLine: null });
    const res = await requestRollback({ dao: d, artifactResolverFor: () => null }, 's1', 'nope');
    expect(res.ok).toBe(false);
  });
});
