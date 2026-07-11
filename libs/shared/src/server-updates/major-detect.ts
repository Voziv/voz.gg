import type { UpdateSource, UpdatePolicy } from '../schema';
import type { Fetcher, ResolverConfig } from './types';
import { resolverFor } from './registry';
import { mcVersionOf, generationOf, compareDottedNumeric } from './mc-version';

export interface OverallLatest {
  version: string;
  mcVersion: string;
  loaderVersion: string | null;
}

const FABRIC_GAME_URL = 'https://meta.fabricmc.net/v2/versions/game';
const FORGE_PROMOS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

/** The newest version available for the channel, ignoring any generation cap. */
export async function resolveOverallLatest(
  source: UpdateSource,
  config: ResolverConfig,
  fetch: Fetcher,
): Promise<OverallLatest | null> {
  if (source === 'forge') return resolveForgeOverall(config, fetch);
  if (source === 'fabric') return resolveFabricOverall(config, fetch);
  // vanilla + neoforge: the base resolver with the generation cap cleared already
  // yields the overall latest for the channel.
  const resolver = resolverFor(source);
  if (!resolver) return null;
  const r = await resolver.resolveLatest({ ...config, id: null }, fetch);
  const mc = mcVersionOf(source, r.version, config.id ?? null);
  if (!mc) return null;
  const loaderVersion = source === 'neoforge' ? r.version : null;
  return { version: r.version, mcVersion: mc, loaderVersion };
}

async function resolveForgeOverall(config: ResolverConfig, fetch: Fetcher): Promise<OverallLatest | null> {
  const res = await fetch(FORGE_PROMOS_URL, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
  if (!res.ok) throw new Error(`forge promotions fetch failed: ${res.status}`);
  const data = (await res.json()) as { promos: Record<string, string> };
  const channel = config.channel === 'recommended' ? 'recommended' : 'latest';
  const suffix = `-${channel}`;
  let best: { line: string; build: string } | null = null;
  for (const [key, build] of Object.entries(data.promos)) {
    if (!key.endsWith(suffix)) continue;
    const line = key.slice(0, key.length - suffix.length);
    if (!generationOf(line)) continue;
    if (!best || compareDottedNumeric(line, best.line) > 0) best = { line, build };
  }
  if (!best) return null;
  return { version: `${best.line}-${best.build}`, mcVersion: best.line, loaderVersion: best.build };
}

async function resolveFabricOverall(config: ResolverConfig, fetch: Fetcher): Promise<OverallLatest | null> {
  const gameRes = await fetch(FABRIC_GAME_URL, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
  if (!gameRes.ok) throw new Error(`fabric game fetch failed: ${gameRes.status}`);
  const games = (await gameRes.json()) as { version: string; stable: boolean }[];
  const wantStable = (config.channel ?? 'latest') === 'latest';
  const game = games.find((g) => (wantStable ? g.stable : true));
  if (!game || !generationOf(game.version)) return null;
  // The loader is Minecraft-independent; resolve the latest loader for the channel.
  const resolver = resolverFor('fabric');
  if (!resolver) return null;
  const loader = await resolver.resolveLatest({ ...config, id: null }, fetch);
  return { version: loader.version, mcVersion: game.version, loaderVersion: loader.version };
}

export interface PlanMajorOfferInput {
  majorPolicy: UpdatePolicy;
  installedMc: string | null;
  overall: OverallLatest | null;
  currentDesiredVersion: string | null;
  notifiedMajor: string | null;
}

export type MajorPlan =
  | { kind: 'none' }
  | { kind: 'auto'; overall: OverallLatest }
  | { kind: 'offer'; overall: OverallLatest; notify: boolean };

export function planMajorOffer(input: PlanMajorOfferInput): MajorPlan {
  const { majorPolicy, installedMc, overall, currentDesiredVersion, notifiedMajor } = input;
  if (!overall || !installedMc) return { kind: 'none' };
  const ig = generationOf(installedMc);
  const og = generationOf(overall.mcVersion);
  if (!ig || !og) return { kind: 'none' };
  if (compareDottedNumeric(og, ig) <= 0) return { kind: 'none' };
  if (majorPolicy === 'auto') {
    if (overall.version === currentDesiredVersion) return { kind: 'none' };
    return { kind: 'auto', overall };
  }
  // approve + notify: surface the offer; notify once per new major generation.
  return { kind: 'offer', overall, notify: notifiedMajor !== og };
}
