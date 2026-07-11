import { describe, it, expect } from 'vitest';
import { approveUpdate, requestRollback, approveMajorUpdate } from './server-update-actions';

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

const installer = { url: 'https://x/installer.jar', hashAlgo: 'sha256', hash: 'h', size: 1 } as const;

function majorDao(state: any) {
  const advanced: any[] = [];
  return {
    advanced,
    async loadActionState() { return null; },
    async writeDesired() {/* not exercised by approveMajorUpdate */},
    async snapshotExists() { return false; },
    async loadMajorActionState() { return state; },
    async advanceMajor(id: string, d: any) { advanced.push({ id, ...d }); },
  };
}

describe('approveMajorUpdate', () => {
  it('resolves the overall latest and advances the server to the new generation', async () => {
    const dao = majorDao({ source: 'neoforge', availableMajor: '27', installed: '26.1.0.5-beta', versionLine: '26', channel: 'beta' });
    const res = await approveMajorUpdate({
      dao,
      artifactResolverFor: () => ({ resolveArtifact: async () => installer }),
      resolveOverallLatest: async () => ({ version: '27.0.0.1-beta', mcVersion: '27.0', loaderVersion: '27.0.0.1-beta' }),
    } as never, 's1');
    expect(res.ok).toBe(true);
    expect(dao.advanced[0]).toMatchObject({
      id: 's1', versionLine: '27.0',
      desired: { version: '27.0.0.1-beta', install: { loader: 'neoforge', minecraftVersion: '27.0', loaderVersion: '27.0.0.1-beta' } },
    });
  });

  it('fails when there is no pending major offer', async () => {
    const dao = majorDao({ source: 'neoforge', availableMajor: null, installed: '26.1.0.5-beta', versionLine: '26', channel: 'beta' });
    const res = await approveMajorUpdate({ dao, resolveOverallLatest: async () => null } as never, 's1');
    expect(res.ok).toBe(false);
  });

  it('fails when the overall latest no longer matches the offered generation', async () => {
    const dao = majorDao({ source: 'neoforge', availableMajor: '27', installed: '26.1.0.5-beta', versionLine: '26', channel: 'beta' });
    const res = await approveMajorUpdate({
      dao,
      artifactResolverFor: () => ({ resolveArtifact: async () => installer }),
      resolveOverallLatest: async () => ({ version: '26.9.0.1-beta', mcVersion: '26.9', loaderVersion: '26.9.0.1-beta' }),
    } as never, 's1');
    expect(res.ok).toBe(false);
  });
});
