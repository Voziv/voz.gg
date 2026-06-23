import { describe, it, expect } from 'vitest';
import { MissingApiKeyError } from './resolvers/curseforge';
import { detectAndNotify } from './run';

function fakeDao(loaded: any[]) {
  const writes: any[] = [];
  const notified: any[] = [];
  return {
    dao: {
      async loadTrackedServers() { return loaded; },
      async writeState(serverId: string, v: any) { writes.push({ serverId, ...v }); },
      async markNotified(serverId: string, version: string) { notified.push({ serverId, version }); },
    },
    writes, notified,
  };
}

const tracked = (over: any = {}) => ({
  server: { serverId: 's1', host: 'launchermeta.mojang.com', config: { source: 'vanilla', provider: null, id: null, channel: 'release' } },
  current: '1.21.1', pinned: null, notified: null,
  notifyTarget: { name: 'Survival', webhookUrl: 'https://discord.test/hook' },
  ...over,
});

describe('detectAndNotify', () => {
  it('writes state and posts discord when a newer version is found', async () => {
    const { dao, writes, notified } = fakeDao([tracked()]);
    const posts: any[] = [];
    await detectAndNotify({
      dao,
      resolverFor: () => ({ resolveLatest: async () => ({ version: '1.21.4', publishedAt: 1 }) }),
      postDiscord: async (url: string, payload: any) => { posts.push({ url, payload }); return { status: 204 }; },
      apiKey: null, sleep: async () => {}, gapMs: 0, now: () => new Date(1000),
    });
    expect(writes[0]).toMatchObject({ serverId: 's1', version: '1.21.4', error: null });
    expect(posts[0].url).toBe('https://discord.test/hook');
    expect(notified).toEqual([{ serverId: 's1', version: '1.21.4' }]);
  });

  it('does not post when already at the current version', async () => {
    const { dao, notified } = fakeDao([tracked({ current: '1.21.4' })]);
    const posts: any[] = [];
    await detectAndNotify({
      dao,
      resolverFor: () => ({ resolveLatest: async () => ({ version: '1.21.4', publishedAt: 1 }) }),
      postDiscord: async () => { posts.push(1); return { status: 204 }; },
      apiKey: null, sleep: async () => {}, gapMs: 0, now: () => new Date(1000),
    });
    expect(posts).toEqual([]);
    expect(notified).toEqual([]);
  });

  it('records a needs-api-key error without throwing', async () => {
    const { dao, writes } = fakeDao([tracked({ server: { serverId: 's1', host: 'api.curseforge.com', config: { source: 'modpack', provider: 'curseforge', id: '5', channel: 'release' } } })]);
    await detectAndNotify({
      dao,
      resolverFor: () => ({ resolveLatest: async () => { throw new MissingApiKeyError(); } }),
      postDiscord: async () => ({ status: 204 }),
      apiKey: null, sleep: async () => {}, gapMs: 0, now: () => new Date(1000),
    });
    expect(writes[0].error).toContain('API key');
  });
});
