import { describe, it, expect } from 'vitest';
import { applyAutoDesired } from './desired-run';

function fakeDao(inputs: any[]) {
  const writes: any[] = [];
  const cleared: string[] = [];
  return {
    writes, cleared,
    async loadDesiredInputs() { return inputs; },
    async writeDesired(serverId: string, d: any) { writes.push({ serverId, ...d }); },
    async clearDesired(serverId: string) { cleared.push(serverId); },
  };
}

const vanillaArtifact = { url: 'https://x/server.jar', hashAlgo: 'sha1', hash: 'abc', size: 10 } as const;
const installerArtifact = { url: 'https://x/installer.jar', hashAlgo: 'sha256', hash: 'h', size: 9 } as const;

describe('applyAutoDesired', () => {
  it('resolves the artifact and writes a desired apply for an auto server with an update', async () => {
    const dao = fakeDao([
      { serverId: 's1', policy: 'auto', source: 'vanilla', available: '1.21.4', installed: '1.21.1', pinned: null, currentDesiredVersion: null },
    ]);
    await applyAutoDesired({
      dao,
      artifactResolverFor: () => ({ resolveArtifact: async () => vanillaArtifact }),
    });
    expect(dao.writes).toEqual([
      { serverId: 's1', id: 'apply:1.21.4', kind: 'apply', version: '1.21.4', artifact: vanillaArtifact, install: null },
    ]);
  });

  it('skips non-auto / unsupported / up-to-date servers and does not clear an unrelated desired', async () => {
    const dao = fakeDao([
      { serverId: 's2', policy: 'approve', source: 'vanilla', available: '1.21.4', installed: '1.21.1', pinned: null, currentDesiredVersion: null },
      { serverId: 's3', policy: 'auto', source: 'vanilla', available: '1.21.1', installed: '1.21.1', pinned: null, currentDesiredVersion: null },
    ]);
    await applyAutoDesired({ dao, artifactResolverFor: () => ({ resolveArtifact: async () => vanillaArtifact }) });
    expect(dao.writes).toEqual([]);
    expect(dao.cleared).toEqual([]);
  });

  it('isolates a resolver failure: one server failing does not block another', async () => {
    const dao = fakeDao([
      { serverId: 'bad', policy: 'auto', source: 'vanilla', available: '1.21.4', installed: '1.0', pinned: null, currentDesiredVersion: null },
      { serverId: 'ok', policy: 'auto', source: 'vanilla', available: '1.21.4', installed: '1.0', pinned: null, currentDesiredVersion: null },
    ]);
    await applyAutoDesired({
      dao,
      artifactResolverFor: () => ({
        resolveArtifact: async () => { throw new Error('boom'); },
      }),
      onError: () => { /* swallow */ },
    });
    // Both fail to resolve, but neither throws out of the orchestrator.
    expect(dao.writes).toEqual([]);
  });
});

describe('applyAutoDesired loaders', () => {
  it('writes a desired apply with an install descriptor for neoforge', async () => {
    const dao = fakeDao([
      { serverId: 's1', policy: 'auto', source: 'neoforge', available: '21.1.234', installed: '21.1.200', pinned: null, currentDesiredVersion: null, versionLine: '21.1' },
    ]);
    await applyAutoDesired({ dao, artifactResolverFor: () => ({ resolveArtifact: async () => installerArtifact }) });
    expect(dao.writes).toEqual([{
      serverId: 's1', id: 'apply:21.1.234', kind: 'apply', version: '21.1.234',
      artifact: installerArtifact,
      install: { loader: 'neoforge', minecraftVersion: '1.21.1', loaderVersion: '21.1.234' },
    }]);
  });

  it('vanilla still writes install: null', async () => {
    const dao = fakeDao([
      { serverId: 's2', policy: 'auto', source: 'vanilla', available: '1.21.4', installed: '1.21.1', pinned: null, currentDesiredVersion: null, versionLine: null },
    ]);
    await applyAutoDesired({ dao, artifactResolverFor: () => ({ resolveArtifact: async () => installerArtifact }) });
    expect(dao.writes[0].install).toBeNull();
  });
});
