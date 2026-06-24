import type { Fetcher, ResolvedVersion, ResolverConfig, VersionResolver } from '../types';

export const packwizResolver: VersionResolver = {
  async resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion> {
    const url = config.id?.trim();
    if (!url) throw new Error('packwiz resolver requires a pack.toml url');
    const res = await fetch(url, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
    if (!res.ok) throw new Error(`packwiz fetch failed: ${res.status}`);
    const toml = await res.text();
    // Match a top-level `version = "x"` line (before any [table] header).
    const match = toml.match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (!match) throw new Error('packwiz pack.toml has no version field');
    return { version: match[1], publishedAt: null };
  },
};
