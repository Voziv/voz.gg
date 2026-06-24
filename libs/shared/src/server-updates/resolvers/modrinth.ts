import type { Fetcher, ResolvedVersion, ResolverConfig, VersionResolver } from '../types';

interface ModrinthVersion {
  version_number: string;
  version_type: string;
  date_published: string;
}

export const modrinthResolver: VersionResolver = {
  async resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion> {
    const id = config.id?.trim();
    if (!id) throw new Error('modrinth resolver requires a project id');
    const res = await fetch(`https://api.modrinth.com/v2/project/${id}/version`, {
      headers: { 'User-Agent': 'voz.gg-update-checker (contact: admin@voz.gg)' },
    });
    if (!res.ok) throw new Error(`modrinth fetch failed: ${res.status}`);
    const versions = (await res.json()) as ModrinthVersion[];
    const channel = config.channel ?? 'release';
    const allowed = channel === 'release' ? ['release'] : channel === 'beta' ? ['release', 'beta'] : ['release', 'beta', 'alpha'];
    const matched = versions
      .filter((v) => allowed.includes(v.version_type))
      .sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published));
    const latest = matched[0];
    if (!latest) throw new Error('no modrinth version matched');
    return { version: latest.version_number, publishedAt: Date.parse(latest.date_published) };
  },
};
