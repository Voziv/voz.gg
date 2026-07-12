import { describe, it, expect } from 'vitest';
import { detectMajorOffers } from './major-run';
import type { OverallLatest } from './major-detect';

const overall27neo: OverallLatest = { version: '27.0.0.1-beta', mcVersion: '27.0', loaderVersion: '27.0.0.1-beta' };
const artifact = { url: 'https://x/installer.jar', hashAlgo: 'sha256' as const, hash: 'h', size: 1 };

function fakeDao(inputs: any[]) {
  const availableMajors: any[] = [];
  const notified: any[] = [];
  const advanced: any[] = [];
  return {
    availableMajors, notified, advanced,
    async loadMajorInputs() { return inputs; },
    async writeAvailableMajor(serverId: string, gen: string | null) { availableMajors.push({ serverId, gen }); },
    async markNotifiedMajor(serverId: string, gen: string) { notified.push({ serverId, gen }); },
    async advanceMajor(serverId: string, d: any) { advanced.push({ serverId, ...d }); },
  };
}

const deps = (dao: any, posts: any[]) => ({
  dao,
  resolveOverallLatest: async () => overall27neo,
  artifactResolverFor: () => ({ resolveArtifact: async () => artifact }),
  postDiscord: async (url: string, payload: any) => { posts.push({ url, payload }); return { status: 204 }; },
  sourceLabels: { neoforge: 'NeoForge', vanilla: 'Vanilla', forge: 'Forge', fabric: 'Fabric' },
});

describe('detectMajorOffers', () => {
  it('auto policy advances the version line and writes a desired install', async () => {
    const dao = fakeDao([{ serverId: 's1', name: 'S', source: 'neoforge', config: { source: 'neoforge', channel: 'beta', id: null }, installed: '26.1.0.5-beta', versionLine: '26', majorPolicy: 'auto', currentDesiredVersion: null, notifiedMajor: null, webhookUrl: null }]);
    const posts: any[] = [];
    await detectMajorOffers(deps(dao, posts));
    expect(dao.advanced[0]).toMatchObject({
      serverId: 's1', versionLine: '27.0',
      desired: { version: '27.0.0.1-beta', install: { loader: 'neoforge', minecraftVersion: '27.0', loaderVersion: '27.0.0.1-beta' } },
    });
    expect(posts).toEqual([]);
  });

  it('approve policy records the offer generation and notifies once', async () => {
    const dao = fakeDao([{ serverId: 's2', name: 'S2', source: 'neoforge', config: { source: 'neoforge', channel: 'beta', id: null }, installed: '26.1.0.5-beta', versionLine: '26', majorPolicy: 'approve', currentDesiredVersion: null, notifiedMajor: null, webhookUrl: 'https://hook' }]);
    const posts: any[] = [];
    await detectMajorOffers(deps(dao, posts));
    expect(dao.availableMajors).toContainEqual({ serverId: 's2', gen: '27' });
    expect(dao.notified).toEqual([{ serverId: 's2', gen: '27' }]);
    expect(posts).toHaveLength(1);
    expect(dao.advanced).toEqual([]);
  });

  it('clears the offer when no newer generation exists', async () => {
    const dao = fakeDao([{ serverId: 's3', name: 'S3', source: 'neoforge', config: { source: 'neoforge', channel: 'beta', id: null }, installed: '27.0.0.1-beta', versionLine: '27', majorPolicy: 'approve', currentDesiredVersion: null, notifiedMajor: null, webhookUrl: 'https://hook' }]);
    const posts: any[] = [];
    await detectMajorOffers(deps(dao, posts));
    expect(dao.availableMajors).toContainEqual({ serverId: 's3', gen: null });
    expect(posts).toEqual([]);
  });
});
