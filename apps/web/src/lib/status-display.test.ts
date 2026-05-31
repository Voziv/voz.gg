import { describe, it, expect } from 'vitest';
import { displayStatus } from './status-display';

const now = new Date('2026-05-31T12:00:00Z');

describe('displayStatus', () => {
  it('returns unknown when there is no status row', () => {
    expect(displayStatus(null, 30, now)).toEqual({ status: 'unknown' });
  });

  it('passes through a fresh online row with player counts', () => {
    const row = { status: 'online', players: 5, maxPlayers: 20, checkedAt: new Date(now.getTime() - 10_000) };
    expect(displayStatus(row, 30, now)).toEqual({ status: 'online', players: 5, maxPlayers: 20 });
  });

  it('passes through a fresh offline row', () => {
    const row = { status: 'offline', players: null, maxPlayers: null, checkedAt: new Date(now.getTime() - 5_000) };
    expect(displayStatus(row, 30, now)).toEqual({ status: 'offline', players: undefined, maxPlayers: undefined });
  });

  it('downgrades a stale row to unknown (older than 3x the poll interval)', () => {
    const row = { status: 'online', players: 5, maxPlayers: 20, checkedAt: new Date(now.getTime() - 91_000) };
    expect(displayStatus(row, 30, now)).toEqual({ status: 'unknown' });
  });

  it('treats a row exactly at the threshold as fresh', () => {
    const row = { status: 'online', players: 1, maxPlayers: 2, checkedAt: new Date(now.getTime() - 90_000) };
    expect(displayStatus(row, 30, now)).toEqual({ status: 'online', players: 1, maxPlayers: 2 });
  });
});
