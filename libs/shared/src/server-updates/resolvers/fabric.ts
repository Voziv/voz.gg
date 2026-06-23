import type { Fetcher, ResolvedVersion, ResolverConfig, VersionResolver } from '../types';

const LOADER_URL = 'https://meta.fabricmc.net/v2/versions/loader';

export const fabricResolver: VersionResolver = {
  async resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion> {
    const res = await fetch(LOADER_URL, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
    if (!res.ok) throw new Error(`fabric loader fetch failed: ${res.status}`);
    const loaders = (await res.json()) as { version: string; stable: boolean }[];
    const wantStable = (config.channel ?? 'latest') === 'latest';
    const match = loaders.find((l) => (wantStable ? l.stable : true));
    if (!match) throw new Error('no fabric loader matched');
    return { version: match.version, publishedAt: null };
  },
};
