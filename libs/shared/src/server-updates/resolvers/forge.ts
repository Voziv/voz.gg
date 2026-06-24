import type { Fetcher, ResolvedVersion, ResolverConfig, VersionResolver } from '../types';

const PROMOS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

export const forgeResolver: VersionResolver = {
  async resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion> {
    const mcLine = config.id?.trim();
    if (!mcLine) throw new Error('forge resolver requires a Minecraft version in `id`');
    const res = await fetch(PROMOS_URL, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
    if (!res.ok) throw new Error(`forge promotions fetch failed: ${res.status}`);
    const data = (await res.json()) as { promos: Record<string, string> };
    const channel = config.channel === 'recommended' ? 'recommended' : 'latest';
    const build = data.promos[`${mcLine}-${channel}`];
    if (!build) throw new Error(`no forge ${channel} build for Minecraft ${mcLine}`);
    return { version: `${mcLine}-${build}`, publishedAt: null };
  },
};
