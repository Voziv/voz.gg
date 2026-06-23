import type { Fetcher, ResolvedVersion, ResolverConfig, VersionResolver } from '../types';

export class MissingApiKeyError extends Error {
  constructor() {
    super('CurseForge API key not configured');
    this.name = 'MissingApiKeyError';
  }
}

interface CfFile { displayName: string; fileDate: string }

export const curseforgeResolver: VersionResolver = {
  async resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion> {
    if (!config.apiKey) throw new MissingApiKeyError();
    const id = config.id?.trim();
    if (!id) throw new Error('curseforge resolver requires a mod id');
    const res = await fetch(`https://api.curseforge.com/v1/mods/${id}/files`, {
      headers: { 'x-api-key': config.apiKey, 'User-Agent': 'voz.gg-update-checker' },
    });
    if (!res.ok) throw new Error(`curseforge fetch failed: ${res.status}`);
    const body = (await res.json()) as { data: CfFile[] };
    const latest = [...body.data].sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))[0];
    if (!latest) throw new Error('no curseforge file matched');
    return { version: latest.displayName, publishedAt: Date.parse(latest.fileDate) };
  },
};
