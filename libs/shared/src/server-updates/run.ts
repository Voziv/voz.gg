import { runDetection } from './detect';
import { evaluateUpdateNotification } from './evaluate';
import { formatUpdateDiscordMessage } from './format';
import type { ResolverConfig, VersionResolver } from './types';
import type { UpdateDetectionDao } from './dao';

const SOURCE_LABELS: Record<string, string> = {
  vanilla: 'Vanilla', forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric', modpack: 'Modpack',
};

export interface DetectAndNotifyDeps {
  dao: UpdateDetectionDao;
  resolverFor: (source: ResolverConfig['source'], provider?: ResolverConfig['provider']) => VersionResolver | null;
  postDiscord: (url: string, payload: { content: string }) => Promise<{ status: number }>;
  apiKey: string | null;
  sleep: (ms: number) => Promise<void>;
  gapMs: number;
  now: () => Date;
}

export async function detectAndNotify(deps: DetectAndNotifyDeps): Promise<void> {
  const loaded = await deps.dao.loadTrackedServers();
  const byId = new Map(loaded.map((l) => [l.server.serverId, l]));

  const results = await runDetection(
    loaded.map((l) => l.server),
    {
      run: async (config: ResolverConfig) => {
        const resolver = deps.resolverFor(config.source, config.provider);
        if (!resolver) throw new Error(`no resolver for ${config.source}`);
        return resolver.resolveLatest({ ...config, apiKey: deps.apiKey }, globalThis.fetch as never);
      },
      sleep: deps.sleep,
      gapMs: deps.gapMs,
    },
  );

  const checkedAt = deps.now();
  for (const result of results) {
    const entry = byId.get(result.serverId);
    if (!entry) continue;
    await deps.dao.writeState(result.serverId, {
      version: result.version,
      publishedAt: result.publishedAt,
      error: result.error,
      checkedAt,
    });
    if (!result.version) continue;
    const decision = evaluateUpdateNotification({
      available: result.version,
      current: entry.current,
      pinned: entry.pinned,
      notified: entry.notified,
    });
    if (!decision.shouldNotify || !entry.notifyTarget.webhookUrl) continue;
    const message = formatUpdateDiscordMessage({
      serverName: entry.notifyTarget.name,
      current: entry.current,
      available: result.version,
      sourceLabel: SOURCE_LABELS[entry.server.config.source] ?? entry.server.config.source,
    });
    const res = await deps.postDiscord(entry.notifyTarget.webhookUrl, message);
    // Only dedupe once Discord accepted it, so a failed post retries next tick.
    if (res.status >= 200 && res.status < 300) await deps.dao.markNotified(result.serverId, result.version);
  }
}
