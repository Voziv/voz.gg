import type { UpdateSource, ModpackProvider } from '../schema';

export type Fetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  headers?: { get(name: string): string | null };
}>;

export interface ResolvedVersion {
  version: string;
  publishedAt?: number | null;
}

export interface ResolverConfig {
  source: UpdateSource;
  provider?: ModpackProvider | null;
  id?: string | null;
  channel?: string | null;
  apiKey?: string | null;
}

export interface VersionResolver {
  resolveLatest(config: ResolverConfig, fetch: Fetcher): Promise<ResolvedVersion>;
}
