import { describe, it, expect } from 'vitest';
import { deriveSessions, totalPlaytimeSeconds, type DerivableEvent } from './sessions';

const at = (s: string) => new Date(s);
const now = new Date('2026-06-13T12:00:00Z');

function ev(partial: Partial<DerivableEvent> & Pick<DerivableEvent, 'type' | 'occurredAt'>): DerivableEvent {
  return { identityKey: null, ...partial };
}

describe('deriveSessions', () => {
  it('pairs a join with the following leave for the same identity', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'leave', identityKey: 'u1', occurredAt: at('2026-06-13T10:30:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toEqual([
      { identityKey: 'u1', start: at('2026-06-13T10:00:00Z'), end: at('2026-06-13T10:30:00Z'), open: false, ip: null },
    ]);
  });

  it('caps a dangling join (no leave) at the next server_stop', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'server_stop', occurredAt: at('2026-06-13T10:45:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toEqual([
      { identityKey: 'u1', start: at('2026-06-13T10:00:00Z'), end: at('2026-06-13T10:45:00Z'), open: false, ip: null },
    ]);
  });

  it('caps a dangling join at the next server_start (crash with no clean stop)', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'server_start', occurredAt: at('2026-06-13T11:00:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions[0].end).toEqual(at('2026-06-13T11:00:00Z'));
    expect(sessions[0].open).toBe(false);
  });

  it('treats a still-open join (server up) as ongoing up to now', () => {
    const sessions = deriveSessions(
      [ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') })],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toEqual([
      { identityKey: 'u1', start: at('2026-06-13T10:00:00Z'), end: at('2026-06-13T12:00:00Z'), open: true, ip: null },
    ]);
  });

  it('keeps two different identities independent', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'join', identityKey: 'u2', occurredAt: at('2026-06-13T10:05:00Z') }),
        ev({ type: 'leave', identityKey: 'u1', occurredAt: at('2026-06-13T10:20:00Z') }),
        ev({ type: 'leave', identityKey: 'u2', occurredAt: at('2026-06-13T10:25:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.identityKey === 'u1')?.end).toEqual(at('2026-06-13T10:20:00Z'));
    expect(sessions.find((s) => s.identityKey === 'u2')?.end).toEqual(at('2026-06-13T10:25:00Z'));
  });

  it('closes a prior dangling join when the same identity joins again', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:30:00Z') }),
        ev({ type: 'leave', identityKey: 'u1', occurredAt: at('2026-06-13T10:45:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(sessions).toEqual([
      { identityKey: 'u1', start: at('2026-06-13T10:00:00Z'), end: at('2026-06-13T10:30:00Z'), open: false, ip: null },
      { identityKey: 'u1', start: at('2026-06-13T10:30:00Z'), end: at('2026-06-13T10:45:00Z'), open: false, ip: null },
    ]);
  });

  it('totalPlaytimeSeconds sums session durations in seconds', () => {
    const sessions = deriveSessions(
      [
        ev({ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z') }),
        ev({ type: 'leave', identityKey: 'u1', occurredAt: at('2026-06-13T10:30:00Z') }),
      ],
      at('2026-06-13T12:00:00Z'),
    );
    expect(totalPlaytimeSeconds(sessions)).toBe(30 * 60);
  });
});

describe('deriveSessions IP carry', () => {
  it('carries the join event IP onto the closed session', () => {
    const [s] = deriveSessions(
      [
        { type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T10:00:00Z'), ip: '1.2.3.4' },
        { type: 'leave', identityKey: 'u1', occurredAt: at('2026-06-13T10:30:00Z') },
      ],
      now,
    );
    expect(s.ip).toBe('1.2.3.4');
  });

  it('leaves ip null when the join carried none, including ongoing sessions', () => {
    const [s] = deriveSessions(
      [{ type: 'join', identityKey: 'u1', occurredAt: at('2026-06-13T11:00:00Z') }],
      now,
    );
    expect(s.open).toBe(true);
    expect(s.ip).toBeNull();
  });
});
