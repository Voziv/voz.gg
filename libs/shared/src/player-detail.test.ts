import { describe, it, expect } from 'vitest';
import { assemblePlayerDetail, type PlayerDetailInput } from './player-detail';

const now = new Date('2026-06-13T12:00:00Z');
const d = (s: string) => new Date(s);

const input: PlayerDetailInput = {
  player: { id: 'p1', displayName: 'Steve', userId: 'u-acct', notes: 'vip', status: 'allowed', isBot: false },
  identities: [{ identityKey: 'mc1', kind: 'minecraft', displayName: 'SteveMC' }],
  groups: ['WTK', '1LD'],
  account: { name: 'Steve R', displayName: 'Steve', image: null, minecraftName: 'SteveMC', steamPersona: null },
  serverNames: [
    { id: 'srvA', name: 'Vanilla' },
    { id: 'srvB', name: 'Stoneblock' },
  ],
  events: [
    { serverId: 'srvA', type: 'join', identityKey: 'mc1', playerName: 'SteveMC', ip: '1.2.3.4', reason: null, occurredAt: d('2026-06-13T10:00:00Z') },
    { serverId: 'srvA', type: 'leave', identityKey: 'mc1', playerName: 'SteveMC', ip: null, reason: null, occurredAt: d('2026-06-13T10:30:00Z') },
    { serverId: 'srvB', type: 'connection_rejected', identityKey: 'mc1', playerName: 'SteveMC', ip: '9.9.9.9', reason: 'whitelist', occurredAt: d('2026-06-13T11:00:00Z') },
  ],
};

describe('assemblePlayerDetail', () => {
  it('assembles identities, groups, status, notes, and the account passthrough', () => {
    const detail = assemblePlayerDetail(input, now);
    expect(detail.status).toBe('allowed');
    expect(detail.notes).toBe('vip');
    expect(detail.groups).toEqual(['WTK', '1LD']);
    expect(detail.identities).toEqual([{ identityKey: 'mc1', kind: 'minecraft', displayName: 'SteveMC' }]);
    expect(detail.account?.name).toBe('Steve R');
  });

  it('derives one session with its server name and join IP', () => {
    const detail = assemblePlayerDetail(input, now);
    expect(detail.sessions).toHaveLength(1);
    expect(detail.sessions[0]).toMatchObject({ serverId: 'srvA', serverName: 'Vanilla', ip: '1.2.3.4' });
    expect(detail.serversSeen).toEqual([
      { serverId: 'srvA', serverName: 'Vanilla', lastSeen: d('2026-06-13T10:30:00Z'), totalPlaytimeSeconds: 30 * 60 },
    ]);
  });

  it('collects distinct IPs seen and connection attempts (rejections)', () => {
    const detail = assemblePlayerDetail(input, now);
    expect(detail.ipsSeen.sort()).toEqual(['1.2.3.4', '9.9.9.9']);
    expect(detail.connectionAttempts).toHaveLength(1);
    expect(detail.connectionAttempts[0]).toMatchObject({ serverName: 'Stoneblock', reason: 'whitelist', ip: '9.9.9.9' });
  });

  it('scopes sessions, servers, IPs, and attempts to one server when serverId is given', () => {
    const detail = assemblePlayerDetail(input, now, { serverId: 'srvA' });
    expect(detail.sessions).toHaveLength(1);
    expect(detail.serversSeen.map((s) => s.serverId)).toEqual(['srvA']);
    expect(detail.connectionAttempts).toEqual([]);
    expect(detail.ipsSeen).toEqual(['1.2.3.4']);
  });

  it('orders sessions most-recent-first across servers', () => {
    const detail = assemblePlayerDetail(
      {
        player: { id: 'p1', displayName: 'Steve', userId: null, notes: null, status: 'allowed', isBot: false },
        identities: [{ identityKey: 'mc1', kind: 'minecraft', displayName: 'SteveMC' }],
        groups: [],
        account: null,
        serverNames: [
          { id: 'srvA', name: 'Vanilla' },
          { id: 'srvB', name: 'Stoneblock' },
        ],
        events: [
          { serverId: 'srvA', type: 'join', identityKey: 'mc1', playerName: 'SteveMC', ip: null, reason: null, occurredAt: d('2026-06-13T08:00:00Z') },
          { serverId: 'srvA', type: 'leave', identityKey: 'mc1', playerName: 'SteveMC', ip: null, reason: null, occurredAt: d('2026-06-13T08:30:00Z') },
          { serverId: 'srvB', type: 'join', identityKey: 'mc1', playerName: 'SteveMC', ip: null, reason: null, occurredAt: d('2026-06-13T10:00:00Z') },
          { serverId: 'srvB', type: 'leave', identityKey: 'mc1', playerName: 'SteveMC', ip: null, reason: null, occurredAt: d('2026-06-13T10:15:00Z') },
        ],
      },
      now,
    );
    expect(detail.sessions.map((s) => s.start)).toEqual([d('2026-06-13T10:00:00Z'), d('2026-06-13T08:00:00Z')]);
  });
});
