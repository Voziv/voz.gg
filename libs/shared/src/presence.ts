import { z } from 'zod';
import { PRESENCE_EVENT_TYPES, PLAYER_IDENTITY_KINDS, type PresenceEventType, type PlayerIdentityKind } from './schema';

export interface IngestEvent {
  type: PresenceEventType;
  identityKind: PlayerIdentityKind | null;
  identityKey: string | null;
  playerName: string | null;
  ip: string | null;
  reason: string | null;
  occurredAt: Date;
}

export interface PresenceEventRow extends IngestEvent {
  serverId: string;
  dedupeKey: string;
}

export interface PresenceDao {
  // Returns true if inserted, false if the dedupeKey already existed.
  // The implementation assigns the row's primary-key `id`.
  insertEvent(row: PresenceEventRow): Promise<boolean>;
  // Create player + identity if absent; otherwise refresh the identity's name.
  ensurePlayerIdentity(kind: PlayerIdentityKind, key: string, name: string | null, now: Date): Promise<void>;
  // If a user account carries this identity and its player is unlinked, link it.
  linkAccountIfMatch(kind: PlayerIdentityKind, key: string): Promise<void>;
}

export interface NotableEvent {
  serverId: string;
  type: 'join' | 'connection_rejected';
  identityKind: PlayerIdentityKind;
  identityKey: string;
  playerName: string | null;
  reason: string | null;
  occurredAt: number; // epoch seconds
}

export interface BatchResult {
  accepted: number;
  deduped: number;
  notable: NotableEvent[];
}

export function buildDedupeKey(
  serverId: string,
  type: PresenceEventType,
  identityKey: string | null,
  occurredAt: Date,
): string {
  const epochSeconds = Math.floor(occurredAt.getTime() / 1000);
  return `${serverId}|${type}|${identityKey ?? ''}|${epochSeconds}`;
}

export async function handlePresenceBatch(
  dao: PresenceDao,
  serverId: string,
  events: IngestEvent[],
  now: Date,
): Promise<BatchResult> {
  let accepted = 0;
  let deduped = 0;
  const notable: NotableEvent[] = [];
  for (const e of events) {
    const dedupeKey = buildDedupeKey(serverId, e.type, e.identityKey, e.occurredAt);
    const inserted = await dao.insertEvent({ ...e, serverId, dedupeKey });
    if (!inserted) {
      deduped += 1;
      continue;
    }
    accepted += 1;
    if (e.identityKind && e.identityKey) {
      await dao.ensurePlayerIdentity(e.identityKind, e.identityKey, e.playerName, now);
      await dao.linkAccountIfMatch(e.identityKind, e.identityKey);
      if (e.type === 'join' || e.type === 'connection_rejected') {
        notable.push({
          serverId,
          type: e.type,
          identityKind: e.identityKind,
          identityKey: e.identityKey,
          playerName: e.playerName,
          reason: e.reason,
          occurredAt: Math.floor(e.occurredAt.getTime() / 1000),
        });
      }
    }
  }
  return { accepted, deduped, notable };
}

const eventSchema = z
  .object({
    type: z.enum(PRESENCE_EVENT_TYPES),
    identityKind: z.enum(PLAYER_IDENTITY_KINDS).nullish(),
    identityKey: z.string().min(1).max(64).nullish(),
    playerName: z.string().max(64).nullish(),
    ip: z.string().max(64).nullish(),
    reason: z.string().max(512).nullish(),
    occurredAt: z.number().int().nonnegative(), // epoch seconds
  })
  .refine((e) => (e.identityKind == null) === (e.identityKey == null), {
    message: 'identityKind and identityKey must be set together',
  });

const MAX_EVENTS = 1000;

export type ParsedBody = { ok: false } | { ok: true; events: IngestEvent[]; rejected: number };

export function parsePresenceBody(body: unknown): ParsedBody {
  const outer = z.object({ events: z.array(z.unknown()).max(MAX_EVENTS) }).safeParse(body);
  if (!outer.success) return { ok: false };

  const events: IngestEvent[] = [];
  let rejected = 0;
  for (const raw of outer.data.events) {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) {
      rejected += 1;
      continue;
    }
    const e = parsed.data;
    events.push({
      type: e.type,
      identityKind: e.identityKind ?? null,
      identityKey: e.identityKey ?? null,
      playerName: e.playerName ?? null,
      ip: e.ip ?? null,
      reason: e.reason ?? null,
      occurredAt: new Date(e.occurredAt * 1000),
    });
  }
  return { ok: true, events, rejected };
}
