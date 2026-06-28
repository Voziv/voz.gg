import type { UpdatePolicy, UpdateSource, DesiredKind } from '../schema';

export function desiredGenerationId(kind: DesiredKind, key: string): string {
  return `${kind}:${key}`;
}

export interface PlanAutoDesiredInput {
  policy: UpdatePolicy;
  source: UpdateSource;
  available: string | null;
  installed: string | null;
  pinned: string | null;
  currentDesiredVersion: string | null;
}

// Decide whether an auto-policy server should converge to a new version. Mirrors
// evaluateUpdateNotification's "trust upstream latest, respect the pin" rule, but
// for the apply path: only `auto`, only the applyable `vanilla|forge|neoforge|fabric`
// sources (never modpack/none), never past a pin, and idempotent against the desired
// already on record.
export function planAutoDesired(input: PlanAutoDesiredInput): { version: string } | null {
  const { policy, source, available, installed, pinned, currentDesiredVersion } = input;
  if (policy !== 'auto') return null;
  if (source === 'none' || source === 'modpack') return null;
  if (!available) return null;
  if (pinned && pinned === available) return null;
  if (available === installed) return null;
  if (available === currentDesiredVersion) return null;
  return { version: available };
}
