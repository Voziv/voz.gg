export type AuditDetailPair = { label: string; value: string };

const LABELS: Record<string, string> = {
  reason: 'Reason',
  email: 'Email',
  role: 'Role',
  newOwnerEmail: 'New owner',
};

function titleCase(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Largest whole unit, for ban expiry. Display-only, so an approximation is fine.
function humanizeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return `${seconds}s`;
  const units: readonly [string, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [name, size] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${name}${count === 1 ? '' : 's'}`;
    }
  }
  return `${seconds}s`;
}

// Parse the audit log's stored `details` JSON into labelled pairs for display.
// Returns [] when there is nothing to show (null/empty, or every value is null,
// as for a ban with no reason). Falls back to showing the raw string if it is
// not the expected JSON object, so a malformed row is never silently dropped.
export function formatAuditDetails(rawDetails: string | null | undefined): AuditDetailPair[] {
  if (!rawDetails) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawDetails);
  } catch {
    return [{ label: 'Details', value: rawDetails }];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ label: 'Details', value: rawDetails }];
  }

  const obj = parsed as Record<string, unknown>;
  const pairs: AuditDetailPair[] = [];

  // Collapse a role transition into a single "old → new" line.
  if ('oldRole' in obj || 'newRole' in obj) {
    const from = obj.oldRole != null ? String(obj.oldRole) : '?';
    const to = obj.newRole != null ? String(obj.newRole) : '?';
    pairs.push({ label: 'Role', value: `${from} → ${to}` });
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'oldRole' || key === 'newRole' || value == null) continue;
    if (key === 'expiresInSeconds') {
      pairs.push({ label: 'Expires in', value: humanizeSeconds(Number(value)) });
      continue;
    }
    const label = LABELS[key] ?? titleCase(key);
    pairs.push({ label, value: typeof value === 'object' ? JSON.stringify(value) : String(value) });
  }

  return pairs;
}
