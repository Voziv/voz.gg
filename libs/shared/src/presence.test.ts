import { describe, it, expect } from 'vitest';
import { buildDedupeKey, parsePresenceBody, handlePresenceBatch, type PresenceDao, type IngestEvent } from './presence';

const now = new Date('2026-06-13T12:00:00Z');

function fakeDao(seen = new Set<string>()) {
  const calls = { inserted: [] as string[], ensured: [] as string[], linked: [] as string[] };
  const dao: PresenceDao = {
    async insertEvent(row) {
      if (seen.has(row.dedupeKey)) return false;
      seen.add(row.dedupeKey);
      calls.inserted.push(row.dedupeKey);
      return true;
    },
    async ensurePlayerIdentity(kind, key, name, now) {
      calls.ensured.push(`${kind}:${key}:${name ?? ''}:${now.toISOString()}`);
    },
    async linkAccountIfMatch(kind, key) {
      calls.linked.push(`${kind}:${key}`);
    },
  };
  return { dao, calls };
}

const join = (key: string, ts: string): IngestEvent => ({
  type: 'join',
  identityKind: 'minecraft',
  identityKey: key,
  playerName: 'Steve',
  ip: null,
  reason: null,
  occurredAt: new Date(ts),
});

describe('buildDedupeKey', () => {
  it('coalesces a null identity to empty and uses epoch seconds', () => {
    expect(buildDedupeKey('srv1', 'server_stop', null, new Date('2026-06-13T10:00:00Z'))).toBe(
      'srv1|server_stop||1781344800',
    );
  });

  it('includes the identity key and epoch seconds for a player event', () => {
    expect(buildDedupeKey('srv1', 'join', 'u1', new Date('2026-06-13T10:00:00Z'))).toBe('srv1|join|u1|1781344800');
  });
});

describe('handlePresenceBatch', () => {
  it('inserts new events, ensures + links minecraft identities, and counts accepted', async () => {
    const { dao, calls } = fakeDao();
    const res = await handlePresenceBatch(dao, 'srv1', [join('u1', '2026-06-13T10:00:00Z')], now);
    expect(res).toEqual({ accepted: 1, deduped: 0, notable: [expect.objectContaining({ type: 'join', identityKey: 'u1' })] });
    expect(calls.ensured).toEqual([`minecraft:u1:Steve:${now.toISOString()}`]);
    expect(calls.linked).toEqual(['minecraft:u1']);
  });

  it('dedupes a replayed batch — second pass inserts nothing', async () => {
    const seen = new Set<string>();
    const batch = [join('u1', '2026-06-13T10:00:00Z')];
    expect(await handlePresenceBatch(fakeDao(seen).dao, 'srv1', batch, now)).toEqual({ accepted: 1, deduped: 0, notable: [expect.objectContaining({ type: 'join', identityKey: 'u1' })] });
    expect(await handlePresenceBatch(fakeDao(seen).dao, 'srv1', batch, now)).toEqual({ accepted: 0, deduped: 1, notable: [] });
  });

  it('skips identity work for lifecycle events', async () => {
    const { dao, calls } = fakeDao();
    const res = await handlePresenceBatch(
      dao,
      'srv1',
      [{ type: 'server_stop', identityKind: null, identityKey: null, playerName: null, ip: null, reason: null, occurredAt: new Date('2026-06-13T10:00:00Z') }],
      now,
    );
    expect(res.accepted).toBe(1);
    expect(calls.ensured).toEqual([]);
    expect(calls.linked).toEqual([]);
  });
});

const reject = (key: string, ts: string): IngestEvent => ({
  type: 'connection_rejected',
  identityKind: 'minecraft',
  identityKey: key,
  playerName: 'Steve',
  ip: null,
  reason: 'not whitelisted',
  occurredAt: new Date(ts),
});
const lifecycle: IngestEvent = {
  type: 'server_start', identityKind: null, identityKey: null,
  playerName: null, ip: null, reason: null, occurredAt: new Date('2026-06-13T12:00:00Z'),
};

describe('handlePresenceBatch notable events', () => {
  it('returns newly-inserted join/rejection events with an identity', async () => {
    const { dao } = fakeDao();
    const res = await handlePresenceBatch(dao, 'srv1', [
      join('uuid-1', '2026-06-13T12:00:00Z'),
      reject('uuid-2', '2026-06-13T12:00:05Z'),
      lifecycle,
    ], now);
    expect(res.notable.map((n) => `${n.type}:${n.identityKey}`)).toEqual([
      'join:uuid-1',
      'connection_rejected:uuid-2',
    ]);
    expect(res.notable[0]).toMatchObject({ serverId: 'srv1', occurredAt: 1781352000, playerName: 'Steve' });
  });
  it('excludes deduped events from notable', async () => {
    const seen = new Set<string>();
    const { dao } = fakeDao(seen);
    await handlePresenceBatch(dao, 'srv1', [join('uuid-1', '2026-06-13T12:00:00Z')], now);
    const res = await handlePresenceBatch(dao, 'srv1', [join('uuid-1', '2026-06-13T12:00:00Z')], now);
    expect(res.notable).toEqual([]);
  });
  it('excludes leave events from notable', async () => {
    const { dao } = fakeDao();
    const leave: IngestEvent = { ...join('uuid-1', '2026-06-13T12:00:00Z'), type: 'leave' };
    const res = await handlePresenceBatch(dao, 'srv1', [leave], now);
    expect(res.notable).toEqual([]);
  });
});

describe('parsePresenceBody', () => {
  it('accepts a well-formed batch and coerces occurredAt (epoch seconds) to Date', () => {
    const parsed = parsePresenceBody({
      events: [{ type: 'join', identityKind: 'minecraft', identityKey: 'u1', playerName: 'Steve', occurredAt: 1781344800 }],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.events[0].occurredAt).toEqual(new Date('2026-06-13T10:00:00Z'));
      expect(parsed.events[0].type).toBe('join');
      expect(parsed.rejected).toBe(0);
    }
  });

  it('skips an unknown event type and counts it rejected', () => {
    const parsed = parsePresenceBody({ events: [{ type: 'nope', occurredAt: 1 }] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.events).toEqual([]);
      expect(parsed.rejected).toBe(1);
    }
  });

  it('rejects a non-object body', () => {
    expect(parsePresenceBody(null).ok).toBe(false);
  });

  it('skips a half-set identity event and counts it rejected', () => {
    const parsed = parsePresenceBody({ events: [{ type: 'join', identityKind: 'minecraft', occurredAt: 1781344800 }] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.events).toEqual([]);
      expect(parsed.rejected).toBe(1);
    }
  });

  it('keeps valid events and rejects only the invalid ones in a mixed batch', () => {
    const parsed = parsePresenceBody({
      events: [
        { type: 'join', identityKind: 'minecraft', identityKey: 'u1', playerName: 'Steve', occurredAt: 1781344800 },
        { type: 'bogus', occurredAt: 1781344800 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].identityKey).toBe('u1');
      expect(parsed.rejected).toBe(1);
    }
  });
});
