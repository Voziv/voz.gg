import type { Fetcher, ResolvedVersion, ResolverConfig, VersionResolver } from '../types';

const METADATA_URL = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

function parseVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
}

export const neoforgeResolver: VersionResolver = {
  async resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion> {
    const res = await fetch(METADATA_URL, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
    if (!res.ok) throw new Error(`neoforge metadata fetch failed: ${res.status}`);
    const all = parseVersions(await res.text());
    const wantBeta = config.channel === 'beta';
    const prefix = config.id?.trim();
    const filtered = all.filter((v) => (wantBeta || !v.includes('-beta')) && (!prefix || v.startsWith(`${prefix}.`)));
    const version = filtered.at(-1);
    if (!version) throw new Error('no neoforge version matched');
    return { version, publishedAt: null };
  },
};
