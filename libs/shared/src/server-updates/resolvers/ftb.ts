import type { Fetcher, ResolvedVersion, ResolverConfig, VersionResolver } from '../types';

interface FtbVersion { name: string; type: string; updated: number }

export const ftbResolver: VersionResolver = {
  async resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion> {
    const id = config.id?.trim();
    if (!id) throw new Error('ftb resolver requires a pack id');
    const res = await fetch(`https://api.feed-the-beast.com/v1/modpack/${id}`, {
      headers: { 'User-Agent': 'voz.gg-update-checker' },
    });
    if (!res.ok) throw new Error(`ftb fetch failed: ${res.status}`);
    const pack = (await res.json()) as { versions: FtbVersion[] };
    const channel = config.channel ?? 'stable';
    const allowed = channel === 'stable' ? ['release'] : channel === 'beta' ? ['release', 'beta'] : ['release', 'beta', 'alpha'];
    const matched = pack.versions
      .filter((v) => allowed.includes(v.type))
      .sort((a, b) => b.updated - a.updated);
    const latest = matched[0];
    if (!latest) throw new Error('no ftb version matched');
    return { version: latest.name, publishedAt: latest.updated * 1000 };
  },
};
