import type { ResolvedVersion, ResolverConfig } from './types';

export interface TrackedServer {
  serverId: string;
  config: ResolverConfig;
  host: string;
}

export interface DetectResult {
  serverId: string;
  version: string | null;
  publishedAt: number | null;
  error: string | null;
}

export interface DetectDeps {
  run(config: ResolverConfig): Promise<ResolvedVersion>;
  sleep(ms: number): Promise<void>;
  gapMs: number;
}

function keyOf(s: TrackedServer): string {
  const c = s.config;
  return JSON.stringify([s.host, c.source, c.provider ?? null, c.id ?? null, c.channel ?? null]);
}

export async function runDetection(servers: TrackedServer[], deps: DetectDeps): Promise<DetectResult[]> {
  // Group by distinct resolver key; remember the servers sharing each key.
  const groups = new Map<string, { config: ResolverConfig; serverIds: string[] }>();
  const groupHost = new Map<string, string>();
  for (const s of servers) {
    const key = keyOf(s);
    const existing = groups.get(key);
    if (existing) existing.serverIds.push(s.serverId);
    else { groups.set(key, { config: s.config, serverIds: [s.serverId] }); groupHost.set(key, s.host); }
  }

  // Bucket distinct keys by host so we can serialize within a host, parallelize across hosts.
  const byHost = new Map<string, string[]>();
  for (const key of groups.keys()) {
    const host = groupHost.get(key)!;
    (byHost.get(host) ?? byHost.set(host, []).get(host)!).push(key);
  }

  const results: DetectResult[] = [];
  await Promise.all(
    [...byHost.values()].map(async (keys) => {
      for (let i = 0; i < keys.length; i++) {
        if (i > 0 && deps.gapMs > 0) await deps.sleep(deps.gapMs);
        const group = groups.get(keys[i])!;
        try {
          const resolved = await deps.run(group.config);
          for (const serverId of group.serverIds) {
            results.push({ serverId, version: resolved.version, publishedAt: resolved.publishedAt ?? null, error: null });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          for (const serverId of group.serverIds) {
            results.push({ serverId, version: null, publishedAt: null, error: message });
          }
        }
      }
    }),
  );
  return results;
}
