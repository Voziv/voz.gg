import type { PresenceEventType } from './schema';

export interface DerivableEvent {
  type: PresenceEventType;
  identityKey: string | null;
  occurredAt: Date;
  ip?: string | null;
}

export interface Session {
  identityKey: string;
  start: Date;
  end: Date;
  open: boolean; // true ⇒ still online (capped at `now`)
  ip: string | null; // IP captured at join, if the join line carried one
}

const LIFECYCLE: ReadonlySet<PresenceEventType> = new Set(['server_start', 'server_stop']);

// Derive sessions for a SINGLE server's time-ordered events. A join is closed by
// the next leave for the same identity; failing that, by the next lifecycle event
// (crash cap); failing that, it is an ongoing session ending at `now`.
export function deriveSessions(events: DerivableEvent[], now: Date): Session[] {
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const open = new Map<string, { start: Date; ip: string | null }>();
  const sessions: Session[] = [];

  const close = (identityKey: string, joined: { start: Date; ip: string | null }, end: Date) =>
    sessions.push({ identityKey, start: joined.start, end, open: false, ip: joined.ip });

  for (const e of ordered) {
    if (e.type === 'join' && e.identityKey) {
      // A second join with no leave: close the prior dangling one at this join.
      const prior = open.get(e.identityKey);
      if (prior) close(e.identityKey, prior, e.occurredAt);
      open.set(e.identityKey, { start: e.occurredAt, ip: e.ip ?? null });
    } else if (e.type === 'leave' && e.identityKey) {
      const joined = open.get(e.identityKey);
      if (joined) {
        close(e.identityKey, joined, e.occurredAt);
        open.delete(e.identityKey);
      }
    } else if (LIFECYCLE.has(e.type)) {
      for (const [identityKey, joined] of open) close(identityKey, joined, e.occurredAt);
      open.clear();
    }
  }

  // Anything still open while the server is up is ongoing up to now.
  for (const [identityKey, joined] of open) {
    sessions.push({ identityKey, start: joined.start, end: now, open: true, ip: joined.ip });
  }
  return sessions;
}

export function totalPlaytimeSeconds(sessions: Session[]): number {
  return sessions.reduce((sum, s) => sum + Math.max(0, (s.end.getTime() - s.start.getTime()) / 1000), 0);
}
