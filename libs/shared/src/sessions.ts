import type { PresenceEventType } from './schema';

export interface DerivableEvent {
  type: PresenceEventType;
  identityKey: string | null;
  occurredAt: Date;
}

export interface Session {
  identityKey: string;
  start: Date;
  end: Date;
  open: boolean; // true ⇒ still online (capped at `now`)
}

const LIFECYCLE: ReadonlySet<PresenceEventType> = new Set(['server_start', 'server_stop']);

// Derive sessions for a SINGLE server's time-ordered events. A join is closed by
// the next leave for the same identity; failing that, by the next lifecycle event
// (crash cap); failing that, it is an ongoing session ending at `now`.
export function deriveSessions(events: DerivableEvent[], now: Date): Session[] {
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const open = new Map<string, Date>(); // identityKey -> join time
  const sessions: Session[] = [];

  const close = (identityKey: string, start: Date, end: Date) =>
    sessions.push({ identityKey, start, end, open: false });

  for (const e of ordered) {
    if (e.type === 'join' && e.identityKey) {
      // A second join with no leave: close the prior dangling one at this join.
      const prior = open.get(e.identityKey);
      if (prior) close(e.identityKey, prior, e.occurredAt);
      open.set(e.identityKey, e.occurredAt);
    } else if (e.type === 'leave' && e.identityKey) {
      const start = open.get(e.identityKey);
      if (start) {
        close(e.identityKey, start, e.occurredAt);
        open.delete(e.identityKey);
      }
    } else if (LIFECYCLE.has(e.type)) {
      for (const [identityKey, start] of open) close(identityKey, start, e.occurredAt);
      open.clear();
    }
  }

  // Anything still open while the server is up is ongoing up to now.
  for (const [identityKey, start] of open) {
    sessions.push({ identityKey, start, end: now, open: true });
  }
  return sessions;
}

export function totalPlaytimeSeconds(sessions: Session[]): number {
  return sessions.reduce((sum, s) => sum + Math.max(0, (s.end.getTime() - s.start.getTime()) / 1000), 0);
}
