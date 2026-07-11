import type { UpdateSource } from '../schema';
import { deriveNeoforgeMcVersion } from './loader-install';

/** The Minecraft version a scheme's version string targets, or null if undeterminable. */
export function mcVersionOf(source: UpdateSource, version: string, versionLine: string | null): string | null {
  switch (source) {
    case 'vanilla':
      return version;
    case 'forge': {
      const dash = version.indexOf('-');
      return dash < 0 ? version : version.slice(0, dash);
    }
    case 'neoforge':
      try {
        return deriveNeoforgeMcVersion(version);
      } catch {
        return null;
      }
    case 'fabric':
      return versionLine?.trim() || null;
    default:
      return null;
  }
}

/**
 * The Minecraft "generation" (major boundary) of an MC version: for old-scheme
 * versions (leading component 1) the feature line `1.<minor>`; for the year-based
 * scheme the year. Returns null for unparseable versions (e.g. snapshots).
 */
export function generationOf(mcVersion: string): string | null {
  const core = mcVersion.split('-')[0];
  const parts = core.split('.');
  if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts[0] === '1' ? parts.slice(0, 2).join('.') : parts[0];
}

/** Numeric component-wise comparison of dot-separated integer strings. */
export function compareDottedNumeric(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export const compareGeneration = compareDottedNumeric;

/** True when candidate's generation is strictly newer than installed's. Both are MC versions. */
export function isNewerGeneration(installedMc: string, candidateMc: string): boolean {
  const ig = generationOf(installedMc);
  const cg = generationOf(candidateMc);
  if (!ig || !cg) return false;
  return compareDottedNumeric(cg, ig) > 0;
}

/**
 * The in-line resolver cap (`config.id`) that keeps detection within the installed
 * generation, derived from the installed version (falling back to the version line).
 * Vanilla: the generation string. NeoForge: the leading version component (a
 * `startsWith` prefix). Forge: the exact MC line (promos are keyed per line).
 * Fabric: the MC version line. Modpack: the modpack id (unchanged).
 */
export function inLineResolverId(
  source: UpdateSource,
  currentVersion: string | null,
  versionLine: string | null,
  modpackId: string | null,
): string | null {
  switch (source) {
    case 'modpack':
      return modpackId ?? null;
    case 'neoforge': {
      const v = currentVersion ?? versionLine;
      return v ? v.split('.')[0] : null;
    }
    case 'vanilla': {
      if (!currentVersion) return versionLine ?? null;
      const gen = generationOf(currentVersion);
      return gen ?? versionLine ?? null;
    }
    case 'forge': {
      if (currentVersion) {
        const dash = currentVersion.indexOf('-');
        if (dash > 0) return currentVersion.slice(0, dash);
      }
      return versionLine ?? null;
    }
    case 'fabric':
      return versionLine ?? null;
    default:
      return null;
  }
}
