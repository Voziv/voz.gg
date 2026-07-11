import type { UpdateSource } from '../schema';

export const NORMALIZED_CHANNELS = ['stable', 'experimental'] as const;
export type NormalizedChannel = (typeof NORMALIZED_CHANNELS)[number];

/**
 * Translate the UI's normalized channel (`stable`/`experimental`) into the raw
 * channel string each resolver expects. Any other value (a legacy stored raw
 * channel like `beta`) passes through unchanged so existing servers keep working.
 */
export function resolverChannel(source: UpdateSource, channel: string | null): string | null {
  if (channel !== 'stable' && channel !== 'experimental') return channel ?? null;
  const experimental = channel === 'experimental';
  switch (source) {
    case 'vanilla':
      return experimental ? 'snapshot' : 'release';
    case 'forge':
      return experimental ? 'latest' : 'recommended';
    case 'neoforge':
      return experimental ? 'beta' : 'stable';
    case 'fabric':
      return experimental ? 'unstable' : 'latest';
    default:
      return channel;
  }
}
