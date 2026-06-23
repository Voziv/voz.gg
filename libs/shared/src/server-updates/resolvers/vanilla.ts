import type { Fetcher, ResolvedVersion, ResolverConfig, VersionResolver } from '../types';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

interface Manifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; releaseTime: string }[];
}

export const vanillaResolver: VersionResolver = {
  async resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion> {
    const res = await fetch(MANIFEST_URL, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
    if (!res.ok) throw new Error(`vanilla manifest fetch failed: ${res.status}`);
    const manifest = (await res.json()) as Manifest;
    const channel = config.channel === 'snapshot' ? 'snapshot' : 'release';
    const version = manifest.latest[channel];
    const meta = manifest.versions.find((v) => v.id === version);
    return { version, publishedAt: meta ? Date.parse(meta.releaseTime) : null };
  },
};
