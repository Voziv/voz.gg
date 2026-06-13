import type { Db } from './client';
import { presenceEvents, player, playerIdentity } from './schema';
import { deriveSessions, totalPlaytimeSeconds, type DerivableEvent } from './sessions';

export interface OverviewInput {
  players: { id: string; displayName: string | null; userId: string | null }[];
  identities: { playerId: string; identityKey: string; displayName: string | null }[];
  events: { serverId: string; type: DerivableEvent['type']; identityKey: string | null; occurredAt: Date }[];
}

export interface PlayerOverviewRow {
  playerId: string;
  displayName: string | null;
  userId: string | null;
  identityNames: string[];
  serversSeen: string[];
  lastSeen: Date | null;
  totalPlaytimeSeconds: number;
}

// Pure aggregation: group events by player (via identity keys), derive sessions
// per server, and sum. Lifecycle events (identityKey === null) are retained per
// server so dangling sessions cap correctly.
export function assemblePlayersOverview(input: OverviewInput, now: Date): PlayerOverviewRow[] {
  const namesByPlayer = new Map<string, Set<string>>();
  const keysByPlayer = new Map<string, Set<string>>();

  for (const p of input.players) {
    namesByPlayer.set(p.id, new Set(p.displayName ? [p.displayName] : []));
    keysByPlayer.set(p.id, new Set());
  }
  for (const id of input.identities) {
    keysByPlayer.get(id.playerId)?.add(id.identityKey);
    if (id.displayName) namesByPlayer.get(id.playerId)?.add(id.displayName);
  }

  // Every known player is returned, including one seen only via a
  // connection_rejected event (zero sessions) — they still matter operationally.
  return input.players.map((p) => {
    const ownKeys = keysByPlayer.get(p.id) ?? new Set<string>();
    // Per-server event slices that touch this player's identities (plus that
    // server's lifecycle events, needed to cap dangling sessions).
    const byServer = new Map<string, DerivableEvent[]>();
    const serversSeen = new Set<string>();
    let lastSeen: Date | null = null;

    for (const e of input.events) {
      const belongsToPlayer = e.identityKey !== null && ownKeys.has(e.identityKey);
      const isLifecycle = e.identityKey === null;
      if (!belongsToPlayer && !isLifecycle) continue;
      if (belongsToPlayer) {
        serversSeen.add(e.serverId);
        if (!lastSeen || e.occurredAt > lastSeen) lastSeen = e.occurredAt;
      }
      const slice = byServer.get(e.serverId) ?? [];
      slice.push({ type: e.type, identityKey: e.identityKey, occurredAt: e.occurredAt });
      byServer.set(e.serverId, slice);
    }

    let totalSeconds = 0;
    for (const serverId of serversSeen) {
      const sessions = deriveSessions(byServer.get(serverId) ?? [], now).filter((s) => ownKeys.has(s.identityKey));
      totalSeconds += totalPlaytimeSeconds(sessions);
    }

    return {
      playerId: p.id,
      displayName: p.displayName,
      userId: p.userId,
      identityNames: [...(namesByPlayer.get(p.id) ?? [])],
      serversSeen: [...serversSeen],
      lastSeen,
      totalPlaytimeSeconds: totalSeconds,
    };
  });
}

export async function getPlayersOverview(db: Db, now: Date): Promise<PlayerOverviewRow[]> {
  const players = await db
    .select({ id: player.id, displayName: player.displayName, userId: player.userId })
    .from(player)
    .all();
  const identities = await db
    .select({
      playerId: playerIdentity.playerId,
      identityKey: playerIdentity.identityKey,
      displayName: playerIdentity.displayName,
    })
    .from(playerIdentity)
    .all();
  const events = await db
    .select({
      serverId: presenceEvents.serverId,
      type: presenceEvents.type,
      identityKey: presenceEvents.identityKey,
      occurredAt: presenceEvents.occurredAt,
    })
    .from(presenceEvents)
    .all();

  return assemblePlayersOverview({ players, identities, events }, now);
}
