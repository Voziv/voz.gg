import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { presenceEvents, player, playerIdentity, groupTag, playerGroupTag } from './schema';
import type { PlayerStatus, PlayerIdentityKind } from './schema';
import { deriveSessions, totalPlaytimeSeconds, type DerivableEvent } from './sessions';

export interface OverviewInput {
  players: { id: string; displayName: string | null; userId: string | null; status: PlayerStatus; isBot: boolean }[];
  identities: { playerId: string; identityKey: string; kind: PlayerIdentityKind; displayName: string | null }[];
  groups: { playerId: string; name: string }[];
  events: { serverId: string; type: DerivableEvent['type']; identityKey: string | null; occurredAt: Date }[];
}

export interface PlayerOverviewRow {
  playerId: string;
  displayName: string | null;
  userId: string | null;
  status: PlayerStatus;
  isBot: boolean;
  identityNames: string[];
  minecraftName: string | null;
  groups: string[];
  serversSeen: string[];
  lastSeen: Date | null;
  totalPlaytimeSeconds: number;
}

export interface OverviewOptions {
  serverId?: string; // scope every derived figure to one server
}

// Pure aggregation: group events by player (via identity keys), derive sessions
// per server, and sum. Lifecycle events (identityKey === null) are retained per
// server so dangling sessions cap correctly.
export function assemblePlayersOverview(
  input: OverviewInput,
  now: Date,
  options: OverviewOptions = {},
): PlayerOverviewRow[] {
  const { serverId } = options;
  const events = serverId ? input.events.filter((e) => e.serverId === serverId) : input.events;

  const namesByPlayer = new Map<string, Set<string>>();
  const keysByPlayer = new Map<string, Set<string>>();
  const minecraftNameByPlayer = new Map<string, string | null>();
  const groupsByPlayer = new Map<string, string[]>();

  for (const p of input.players) {
    namesByPlayer.set(p.id, new Set(p.displayName ? [p.displayName] : []));
    keysByPlayer.set(p.id, new Set());
    minecraftNameByPlayer.set(p.id, null);
    groupsByPlayer.set(p.id, []);
  }
  for (const id of input.identities) {
    keysByPlayer.get(id.playerId)?.add(id.identityKey);
    if (id.displayName) {
      namesByPlayer.get(id.playerId)?.add(id.displayName);
      // First minecraft identity with a name wins the display pill; alts are a
      // tie-break we don't care to order.
      if (id.kind === 'minecraft' && minecraftNameByPlayer.has(id.playerId) && !minecraftNameByPlayer.get(id.playerId)) {
        minecraftNameByPlayer.set(id.playerId, id.displayName);
      }
    }
  }
  for (const g of input.groups) groupsByPlayer.get(g.playerId)?.push(g.name);

  return input.players
    .map((p) => {
      const ownKeys = keysByPlayer.get(p.id) ?? new Set<string>();
      // Per-server event slices that touch this player's identities (plus that
      // server's lifecycle events, needed to cap dangling sessions).
      const byServer = new Map<string, DerivableEvent[]>();
      const serversSeen = new Set<string>();
      let lastSeen: Date | null = null;

      for (const e of events) {
        const belongsToPlayer = e.identityKey !== null && ownKeys.has(e.identityKey);
        const isLifecycle = e.identityKey === null;
        if (!belongsToPlayer && !isLifecycle) continue;
        // A rejection means the player tried but never got in, so it doesn't make
        // them "seen on" the server or move their last-seen time.
        if (belongsToPlayer && e.type !== 'connection_rejected') {
          serversSeen.add(e.serverId);
          if (!lastSeen || e.occurredAt > lastSeen) lastSeen = e.occurredAt;
        }
        const slice = byServer.get(e.serverId) ?? [];
        slice.push({ type: e.type, identityKey: e.identityKey, occurredAt: e.occurredAt });
        byServer.set(e.serverId, slice);
      }

      let totalSeconds = 0;
      for (const seenServerId of serversSeen) {
        const sessions = deriveSessions(byServer.get(seenServerId) ?? [], now).filter((s) => ownKeys.has(s.identityKey));
        totalSeconds += totalPlaytimeSeconds(sessions);
      }

      return {
        playerId: p.id,
        displayName: p.displayName,
        userId: p.userId,
        status: p.status,
        isBot: p.isBot,
        identityNames: [...(namesByPlayer.get(p.id) ?? [])],
        minecraftName: minecraftNameByPlayer.get(p.id) ?? null,
        groups: groupsByPlayer.get(p.id) ?? [],
        serversSeen: [...serversSeen],
        lastSeen,
        totalPlaytimeSeconds: totalSeconds,
      };
    })
    // When scoped to a server, drop players never seen there.
    .filter((row) => !serverId || row.serversSeen.length > 0);
}

export async function getPlayersOverview(
  db: Db,
  now: Date,
  options: OverviewOptions = {},
): Promise<PlayerOverviewRow[]> {
  const players = await db
    .select({
      id: player.id,
      displayName: player.displayName,
      userId: player.userId,
      status: player.status,
      isBot: player.isBot,
    })
    .from(player)
    .all();
  const identities = await db
    .select({
      playerId: playerIdentity.playerId,
      identityKey: playerIdentity.identityKey,
      kind: playerIdentity.kind,
      displayName: playerIdentity.displayName,
    })
    .from(playerIdentity)
    .all();
  const groups = await db
    .select({ playerId: playerGroupTag.playerId, name: groupTag.name })
    .from(playerGroupTag)
    .innerJoin(groupTag, eq(groupTag.id, playerGroupTag.groupTagId))
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

  return assemblePlayersOverview({ players, identities, groups, events }, now, options);
}
