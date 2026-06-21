import type { Db } from './client';
import { eq, or, inArray, isNull } from 'drizzle-orm';
import { presenceEvents, player, playerIdentity, groupTag, playerGroupTag, user, servers } from './schema';
import type { PlayerStatus, PlayerIdentityKind, PresenceEventType } from './schema';
import { deriveSessions, totalPlaytimeSeconds, type DerivableEvent } from './sessions';

export interface AccountSummary {
  name: string | null;
  displayName: string | null;
  image: string | null;
  minecraftName: string | null;
  steamPersona: string | null;
}

export interface DetailEvent {
  serverId: string;
  type: PresenceEventType;
  identityKey: string | null;
  playerName: string | null;
  ip: string | null;
  reason: string | null;
  occurredAt: Date;
}

export interface PlayerDetailInput {
  player: { id: string; displayName: string | null; userId: string | null; notes: string | null; status: PlayerStatus; isBot: boolean; muted: boolean };
  identities: { identityKey: string; kind: PlayerIdentityKind; displayName: string | null }[];
  groups: string[];
  account: AccountSummary | null;
  serverNames: { id: string; name: string }[];
  events: DetailEvent[];
}

export interface PlayerSessionRow {
  serverId: string;
  serverName: string;
  identityKey: string;
  start: Date;
  end: Date;
  open: boolean;
  ip: string | null;
}

export interface ServerSeenRow {
  serverId: string;
  serverName: string;
  lastSeen: Date;
  totalPlaytimeSeconds: number;
}

export interface ConnectionAttempt {
  serverId: string;
  serverName: string;
  occurredAt: Date;
  ip: string | null;
  reason: string | null;
  playerName: string | null;
}

export interface PlayerDetail {
  playerId: string;
  displayName: string | null;
  userId: string | null;
  notes: string | null;
  status: PlayerStatus;
  isBot: boolean;
  muted: boolean;
  identities: { identityKey: string; kind: PlayerIdentityKind; displayName: string | null }[];
  minecraftName: string | null;
  groups: string[];
  account: AccountSummary | null;
  serversSeen: ServerSeenRow[];
  sessions: PlayerSessionRow[];
  ipsSeen: string[];
  connectionAttempts: ConnectionAttempt[];
}

export interface PlayerDetailOptions {
  serverId?: string;
}

export function assemblePlayerDetail(
  input: PlayerDetailInput,
  now: Date,
  options: PlayerDetailOptions = {},
): PlayerDetail {
  const { serverId } = options;
  const ownKeys = new Set(input.identities.map((i) => i.identityKey));
  const serverNameById = new Map(input.serverNames.map((s) => [s.id, s.name]));
  const nameOf = (id: string) => serverNameById.get(id) ?? id;

  const events = serverId ? input.events.filter((e) => e.serverId === serverId) : input.events;

  // Lifecycle events (null identity) are kept per server alongside the player's
  // own so deriveSessions can cap dangling sessions; rejections are recorded as
  // attempts but never count as presence.
  const byServer = new Map<string, DerivableEvent[]>();
  const serversSeen = new Set<string>();
  const ipsSeen = new Set<string>();
  const connectionAttempts: ConnectionAttempt[] = [];

  for (const e of events) {
    const belongsToPlayer = e.identityKey !== null && ownKeys.has(e.identityKey);
    const isLifecycle = e.identityKey === null;
    if (!belongsToPlayer && !isLifecycle) continue;
    if (belongsToPlayer) {
      if (e.type !== 'connection_rejected') serversSeen.add(e.serverId);
      if (e.ip) ipsSeen.add(e.ip);
      if (e.type === 'connection_rejected') {
        connectionAttempts.push({
          serverId: e.serverId,
          serverName: nameOf(e.serverId),
          occurredAt: e.occurredAt,
          ip: e.ip,
          reason: e.reason,
          playerName: e.playerName,
        });
      }
    }
    const slice = byServer.get(e.serverId) ?? [];
    slice.push({ type: e.type, identityKey: e.identityKey, occurredAt: e.occurredAt, ip: e.ip });
    byServer.set(e.serverId, slice);
  }

  const sessions: PlayerSessionRow[] = [];
  const serverSeenRows: ServerSeenRow[] = [];
  for (const sid of serversSeen) {
    const slice = byServer.get(sid) ?? [];
    const own = deriveSessions(slice, now).filter((session) => ownKeys.has(session.identityKey));
    // sid is in serversSeen only because a non-rejection owned event was recorded,
    // so this max runs over a non-empty set — rejections don't count as presence.
    const ownedTimes = slice
      .filter((e) => e.identityKey !== null && ownKeys.has(e.identityKey) && e.type !== 'connection_rejected')
      .map((e) => e.occurredAt.getTime());
    const lastSeen = new Date(Math.max(...ownedTimes));
    for (const session of own) {
      sessions.push({ serverId: sid, serverName: nameOf(sid), identityKey: session.identityKey, start: session.start, end: session.end, open: session.open, ip: session.ip });
    }
    serverSeenRows.push({
      serverId: sid,
      serverName: nameOf(sid),
      lastSeen,
      totalPlaytimeSeconds: totalPlaytimeSeconds(own),
    });
  }

  sessions.sort((a, b) => b.start.getTime() - a.start.getTime());
  connectionAttempts.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const minecraftName = input.identities.find((i) => i.kind === 'minecraft' && i.displayName)?.displayName ?? null;

  return {
    playerId: input.player.id,
    displayName: input.player.displayName,
    userId: input.player.userId,
    notes: input.player.notes,
    status: input.player.status,
    isBot: input.player.isBot,
    muted: input.player.muted,
    identities: input.identities,
    minecraftName,
    groups: input.groups,
    account: input.account,
    serversSeen: serverSeenRows,
    sessions,
    ipsSeen: [...ipsSeen],
    connectionAttempts,
  };
}

export async function getPlayerDetail(
  db: Db,
  playerId: string,
  now: Date,
  options: PlayerDetailOptions = {},
): Promise<PlayerDetail | null> {
  const row = await db
    .select({
      id: player.id,
      displayName: player.displayName,
      userId: player.userId,
      notes: player.notes,
      status: player.status,
      isBot: player.isBot,
      muted: player.muted,
    })
    .from(player)
    .where(eq(player.id, playerId))
    .get();
  if (!row) return null;

  const identities = await db
    .select({ identityKey: playerIdentity.identityKey, kind: playerIdentity.kind, displayName: playerIdentity.displayName })
    .from(playerIdentity)
    .where(eq(playerIdentity.playerId, playerId))
    .all();
  const groups = await db
    .select({ name: groupTag.name })
    .from(playerGroupTag)
    .innerJoin(groupTag, eq(groupTag.id, playerGroupTag.groupTagId))
    .where(eq(playerGroupTag.playerId, playerId))
    .all();
  const serverNames = await db.select({ id: servers.id, name: servers.name }).from(servers).all();

  // Only this player's own identity events plus lifecycle events (null identity,
  // needed to cap dangling sessions). A player with no identities still pulls
  // lifecycle events, which on their own derive nothing.
  const identityKeys = identities.map((i) => i.identityKey);
  const eventScope = identityKeys.length
    ? or(inArray(presenceEvents.identityKey, identityKeys), isNull(presenceEvents.identityKey))
    : isNull(presenceEvents.identityKey);
  const events = await db
    .select({
      serverId: presenceEvents.serverId,
      type: presenceEvents.type,
      identityKey: presenceEvents.identityKey,
      playerName: presenceEvents.playerName,
      ip: presenceEvents.ip,
      reason: presenceEvents.reason,
      occurredAt: presenceEvents.occurredAt,
    })
    .from(presenceEvents)
    .where(eventScope)
    .all();

  let account: AccountSummary | null = null;
  if (row.userId) {
    const acct = await db
      .select({
        name: user.name,
        displayName: user.displayName,
        image: user.image,
        minecraftName: user.minecraftName,
        steamPersona: user.steamPersona,
      })
      .from(user)
      .where(eq(user.id, row.userId))
      .get();
    account = acct ?? null;
  }

  return assemblePlayerDetail(
    { player: row, identities, groups: groups.map((g) => g.name), account, serverNames, events },
    now,
    options,
  );
}
