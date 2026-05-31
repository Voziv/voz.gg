export type DisplayStatus = 'online' | 'offline' | 'unknown';

export interface StatusRow {
  status: string;
  players: number | null;
  maxPlayers: number | null;
  checkedAt: Date;
}

export interface DisplayResult {
  status: DisplayStatus;
  players?: number;
  maxPlayers?: number;
}

const STALENESS_POLL_MULTIPLIER = 3;

export function displayStatus(
  row: StatusRow | null,
  pollIntervalSeconds: number,
  now: Date,
): DisplayResult {
  if (!row) return { status: 'unknown' };
  const staleThresholdMs = pollIntervalSeconds * STALENESS_POLL_MULTIPLIER * 1000;
  if (now.getTime() - row.checkedAt.getTime() > staleThresholdMs) return { status: 'unknown' };
  return {
    status: row.status as DisplayStatus,
    players: row.players ?? undefined,
    maxPlayers: row.maxPlayers ?? undefined,
  };
}
