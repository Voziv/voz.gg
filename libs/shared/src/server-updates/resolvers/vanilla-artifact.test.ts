import { describe, it, expect } from 'vitest';
import { vanillaArtifactResolver } from './vanilla-artifact';
import type { Fetcher } from '../types';

const MANIFEST = JSON.stringify({
  latest: { release: '1.21.1', snapshot: '24w39a' },
  versions: [
    { id: '1.21.1', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/abc/1.21.1.json', releaseTime: '2024-08-08T12:00:00+00:00' },
  ],
});
const PACKAGE = JSON.stringify({
  downloads: {
    server: { url: 'https://piston-data.mojang.com/v1/objects/deadbeef/server.jar', sha1: 'deadbeef', size: 54321 },
  },
});

function fetcherFrom(map: Record<string, string>): Fetcher {
  return async (url: string) => {
    const body = map[url];
    if (body == null) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
}

describe('vanillaArtifactResolver', () => {
  it('resolves the server jar url + sha1 + size for a version', async () => {
    const fetch = fetcherFrom({
      'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json': MANIFEST,
      'https://piston-meta.mojang.com/v1/packages/abc/1.21.1.json': PACKAGE,
    });
    const a = await vanillaArtifactResolver.resolveArtifact('1.21.1', fetch);
    expect(a).toEqual({
      url: 'https://piston-data.mojang.com/v1/objects/deadbeef/server.jar',
      hashAlgo: 'sha1',
      hash: 'deadbeef',
      size: 54321,
    });
  });

  it('throws when the version is not in the manifest', async () => {
    const fetch = fetcherFrom({ 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json': MANIFEST });
    await expect(vanillaArtifactResolver.resolveArtifact('9.9.9', fetch)).rejects.toThrow(/not found/i);
  });
});
