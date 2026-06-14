import { describe, it, expect } from 'vitest';
import { assemblePlayersOverview, type OverviewInput } from './players';

const now = new Date('2026-06-13T12:00:00Z');
const d = (s: string) => new Date(s);

const input: OverviewInput = {
  players: [{ id: 'p1', displayName: 'Steve', userId: null }],
  identities: [{ playerId: 'p1', identityKey: 'u1', displayName: 'Steve' }],
  events: [
    { serverId: 'srvA', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T10:00:00Z') },
    { serverId: 'srvA', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T10:30:00Z') },
    { serverId: 'srvB', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T11:00:00Z') },
    { serverId: 'srvB', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T11:15:00Z') },
  ],
};

describe('assemblePlayersOverview', () => {
  it('aggregates playtime across servers and lists distinct servers + last seen', () => {
    const [row] = assemblePlayersOverview(input, now);
    expect(row.playerId).toBe('p1');
    expect(row.identityNames).toEqual(['Steve']);
    expect(row.serversSeen.sort()).toEqual(['srvA', 'srvB']);
    expect(row.totalPlaytimeSeconds).toBe(30 * 60 + 15 * 60);
    expect(row.lastSeen).toEqual(d('2026-06-13T11:15:00Z'));
  });

  it('unions multiple identities (alts) into one player total', () => {
    const row = assemblePlayersOverview(
      {
        players: [{ id: 'p1', displayName: 'Steve', userId: null }],
        identities: [
          { playerId: 'p1', identityKey: 'u1', displayName: 'Steve' },
          { playerId: 'p1', identityKey: 'u2', displayName: 'SteveAlt' },
        ],
        events: [
          { serverId: 'srvA', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T10:00:00Z') },
          { serverId: 'srvA', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T10:10:00Z') },
          { serverId: 'srvA', type: 'join', identityKey: 'u2', occurredAt: d('2026-06-13T11:00:00Z') },
          { serverId: 'srvA', type: 'leave', identityKey: 'u2', occurredAt: d('2026-06-13T11:05:00Z') },
        ],
      },
      now,
    )[0];
    expect(row.totalPlaytimeSeconds).toBe(15 * 60);
    expect(row.identityNames.sort()).toEqual(['Steve', 'SteveAlt']);
  });

  it('omits an event whose identity maps to no known player', () => {
    const rows = assemblePlayersOverview(
      { players: [], identities: [], events: [{ serverId: 'srvA', type: 'join', identityKey: 'ghost', occurredAt: d('2026-06-13T10:00:00Z') }] },
      now,
    );
    expect(rows).toEqual([]);
  });
});
