import { describe, it, expect } from 'vitest';
import { assemblePlayersOverview, type OverviewInput } from './players';

const now = new Date('2026-06-13T12:00:00Z');
const d = (s: string) => new Date(s);

const input: OverviewInput = {
  players: [{ id: 'p1', displayName: 'Steve', userId: null, status: 'new', isBot: false }],
  identities: [{ playerId: 'p1', identityKey: 'u1', kind: 'minecraft', displayName: 'Steve' }],
  groups: [],
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
        players: [{ id: 'p1', displayName: 'Steve', userId: null, status: 'new', isBot: false }],
        identities: [
          { playerId: 'p1', identityKey: 'u1', kind: 'minecraft', displayName: 'Steve' },
          { playerId: 'p1', identityKey: 'u2', kind: 'minecraft', displayName: 'SteveAlt' },
        ],
        groups: [],
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
      { players: [], identities: [], groups: [], events: [{ serverId: 'srvA', type: 'join', identityKey: 'ghost', occurredAt: d('2026-06-13T10:00:00Z') }] },
      now,
    );
    expect(rows).toEqual([]);
  });
});

describe('assemblePlayersOverview enrichment', () => {
  const base: OverviewInput = {
    players: [{ id: 'p1', displayName: 'Steve', userId: null, status: 'new', isBot: false }],
    identities: [{ playerId: 'p1', identityKey: 'u1', kind: 'minecraft', displayName: 'SteveMC' }],
    groups: [{ playerId: 'p1', name: 'WTK' }],
    events: [
      { serverId: 'srvA', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T10:00:00Z') },
      { serverId: 'srvA', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T10:30:00Z') },
      { serverId: 'srvB', type: 'join', identityKey: 'u1', occurredAt: d('2026-06-13T11:00:00Z') },
      { serverId: 'srvB', type: 'leave', identityKey: 'u1', occurredAt: d('2026-06-13T11:15:00Z') },
    ],
  };

  it('surfaces status, isBot, groups, and the minecraft name pill', () => {
    const [row] = assemblePlayersOverview(base, now);
    expect(row.status).toBe('new');
    expect(row.isBot).toBe(false);
    expect(row.groups).toEqual(['WTK']);
    expect(row.minecraftName).toBe('SteveMC');
  });

  it('scopes playtime, servers, and last seen to a single server when serverId is given', () => {
    const [row] = assemblePlayersOverview(base, now, { serverId: 'srvA' });
    expect(row.serversSeen).toEqual(['srvA']);
    expect(row.totalPlaytimeSeconds).toBe(30 * 60);
    expect(row.lastSeen).toEqual(d('2026-06-13T10:30:00Z'));
  });

  it('omits players never seen on the scoped server', () => {
    const rows = assemblePlayersOverview(base, now, { serverId: 'srvC' });
    expect(rows).toEqual([]);
  });

  it('does not count a rejection-only server as seen', () => {
    const [row] = assemblePlayersOverview(
      {
        players: [{ id: 'p1', displayName: 'Bot', userId: null, status: 'new', isBot: true }],
        identities: [{ playerId: 'p1', identityKey: 'u1', kind: 'minecraft', displayName: 'Bot' }],
        groups: [],
        events: [
          { serverId: 'srvA', type: 'connection_rejected', identityKey: 'u1', occurredAt: d('2026-06-13T10:00:00Z') },
        ],
      },
      now,
    );
    expect(row.serversSeen).toEqual([]);
    expect(row.lastSeen).toBeNull();
    expect(row.totalPlaytimeSeconds).toBe(0);
  });
});
