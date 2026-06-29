import { describe, it, expect } from 'vitest';
import { neoforgeArtifactResolver } from './neoforge-artifact';
import { forgeArtifactResolver } from './forge-artifact';
import { fabricArtifactResolver } from './fabric-artifact';
import { artifactResolverFor } from '../artifact';

function fetchStub(routes: Record<string, { body?: string; headers?: Record<string, string>; status?: number }>) {
  return (async (url: string, init?: { method?: string }) => {
    const r = routes[url];
    if (!r) return { ok: false, status: 404, async text() { return ''; }, async json() { return {}; }, headers: { get: () => null } } as never;
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      async text() { return r.body ?? ''; },
      async json() { return JSON.parse(r.body ?? '{}'); },
      headers: { get: (h: string) => (r.headers ?? {})[h.toLowerCase()] ?? null },
    } as never;
  });
}

describe('neoforgeArtifactResolver', () => {
  it('builds the installer url + reads the sha256 sibling + content-length', async () => {
    const v = '21.1.234';
    const base = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`;
    const fetch = fetchStub({
      [base]: { headers: { 'content-length': '6966054' } },
      [`${base}.sha256`]: { body: 'abc123\n' },
    });
    const art = await neoforgeArtifactResolver.resolveArtifact(v, fetch);
    expect(art).toEqual({ url: base, hashAlgo: 'sha256', hash: 'abc123', size: 6966054 });
  });
});

describe('forgeArtifactResolver', () => {
  it('uses the full mc-build version string + sha1', async () => {
    const v = '1.21.1-52.1.14';
    const base = `https://maven.minecraftforge.net/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`;
    const fetch = fetchStub({
      [base]: { headers: { 'content-length': '9025090' } },
      [`${base}.sha1`]: { body: '88d7fe47\n' },
    });
    const art = await forgeArtifactResolver.resolveArtifact(v, fetch);
    expect(art).toEqual({ url: base, hashAlgo: 'sha1', hash: '88d7fe47', size: 9025090 });
  });
});

describe('fabricArtifactResolver', () => {
  it('resolves the latest installer from maven-metadata + sha1', async () => {
    const meta = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/maven-metadata.xml';
    const base = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.1.1/fabric-installer-1.1.1.jar';
    const fetch = fetchStub({
      [meta]: { body: '<metadata><versioning><release>1.1.1</release></versioning></metadata>' },
      [base]: { headers: { 'content-length': '209151' } },
      [`${base}.sha1`]: { body: '3ffdd4dc\n' },
    });
    // Fabric's artifact is the generic installer; the loader version arg is irrelevant to the jar.
    const art = await fabricArtifactResolver.resolveArtifact('0.16.9', fetch);
    expect(art).toEqual({ url: base, hashAlgo: 'sha1', hash: '3ffdd4dc', size: 209151 });
  });
});

describe('artifactResolverFor', () => {
  it('dispatches the three loaders and still rejects modpack', () => {
    expect(artifactResolverFor('neoforge')).toBe(neoforgeArtifactResolver);
    expect(artifactResolverFor('forge')).toBe(forgeArtifactResolver);
    expect(artifactResolverFor('fabric')).toBe(fabricArtifactResolver);
    expect(artifactResolverFor('modpack')).toBeNull();
  });
});
