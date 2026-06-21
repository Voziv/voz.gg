import { describe, it, expect } from 'vitest';
import {
  parsePlayerFieldsInput,
  normalizeGroupName,
  computeMergeResult,
  handleUpdatePlayerFields,
  handleAddGroup,
  handleRemoveGroup,
  handleAddIdentity,
  handleRemoveIdentity,
  handleMergePlayers,
  handleSearchPlayers,
  type PlayerCore,
  type PlayerMutationsDao,
} from './player-mutations';

const core = (over: Partial<PlayerCore> = {}): PlayerCore => ({
  id: 'p1',
  displayName: null,
  notes: null,
  status: 'new',
  isBot: false,
  muted: false,
  userId: null,
  ...over,
});

describe('parsePlayerFieldsInput', () => {
  it('accepts a valid partial update', () => {
    const r = parsePlayerFieldsInput({ status: 'allowed', isBot: true });
    expect(r).toEqual({ ok: true, data: { status: 'allowed', isBot: true } });
  });

  it('trims displayName and treats blank as null', () => {
    const r = parsePlayerFieldsInput({ displayName: '  ' });
    expect(r).toEqual({ ok: true, data: { displayName: null } });
  });

  it('rejects an unknown status', () => {
    const r = parsePlayerFieldsInput({ status: 'banned' });
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown field', () => {
    const r = parsePlayerFieldsInput({ role: 'admin' });
    expect(r.ok).toBe(false);
  });

  it('rejects an empty body (no fields)', () => {
    const r = parsePlayerFieldsInput({});
    expect(r.ok).toBe(false);
  });
});

describe('parsePlayerFieldsInput muted', () => {
  it('accepts a muted boolean', () => {
    const r = parsePlayerFieldsInput({ muted: true });
    expect(r).toEqual({ ok: true, data: { muted: true } });
  });
  it('rejects a non-boolean muted', () => {
    const r = parsePlayerFieldsInput({ muted: 'yes' });
    expect(r.ok).toBe(false);
  });
});

describe('normalizeGroupName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeGroupName('  WTK   crew ')).toBe('WTK crew');
  });
  it('returns null for blank', () => {
    expect(normalizeGroupName('   ')).toBeNull();
  });
});

describe('computeMergeResult', () => {
  it('ORs isBot, appends notes, carries the single account link', () => {
    const r = computeMergeResult(
      core({ notes: 'survivor note', isBot: false, userId: 'u1' }),
      core({ id: 'p2', notes: 'absorbed note', isBot: true, userId: null }),
    );
    expect(r).toEqual({
      ok: true,
      combine: { notes: 'survivor note\n\nabsorbed note', isBot: true, userId: 'u1' },
    });
  });

  it('carries the absorbed account link when the survivor has none', () => {
    const r = computeMergeResult(core({ userId: null }), core({ id: 'p2', userId: 'u2' }));
    expect(r.ok && r.combine.userId).toBe('u2');
  });

  it('rejects when both sides have distinct accounts', () => {
    const r = computeMergeResult(core({ userId: 'u1' }), core({ id: 'p2', userId: 'u2' }));
    expect(r).toEqual({ ok: false, reason: 'account-conflict' });
  });

  it('is a no-op-link when both have the same account', () => {
    const r = computeMergeResult(core({ userId: 'u1' }), core({ id: 'p2', userId: 'u1' }));
    expect(r.ok && r.combine.userId).toBe('u1');
  });
});

const NOW = new Date('2026-06-14T12:00:00Z');

// In-memory fake DAO mirroring the production schema relationships.
function makeFakeDao() {
  const players = new Map<string, PlayerCore>();
  const groupsByName = new Map<string, { id: string; name: string }>(); // lowercased name -> group
  const groupNamesById = new Map<string, string>();
  const memberships = new Set<string>(); // `${playerId}::${groupId}`
  const identities: { playerId: string; kind: string; key: string; name?: string | null }[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}${++seq}`;

  const dao: PlayerMutationsDao = {
    async getPlayer(id) {
      return players.get(id) ?? null;
    },
    async updatePlayer(id, fields) {
      const p = players.get(id);
      if (p) players.set(id, { ...p, ...fields });
    },
    async findGroupByName(name) {
      return groupsByName.get(name.toLowerCase()) ?? null;
    },
    async createGroupTag(name) {
      const id = nextId('g');
      groupsByName.set(name.toLowerCase(), { id, name });
      groupNamesById.set(id, name);
      return id;
    },
    async attachGroup(playerId, groupTagId) {
      memberships.add(`${playerId}::${groupTagId}`);
    },
    async detachGroup(playerId, groupTagId) {
      memberships.delete(`${playerId}::${groupTagId}`);
    },
    async findIdentity(kind, key) {
      const row = identities.find((i) => i.kind === kind && i.key === key);
      return row ? { playerId: row.playerId } : null;
    },
    async addIdentity(playerId, kind, key) {
      identities.push({ playerId, kind, key });
    },
    async removeIdentity(playerId, kind, key) {
      const idx = identities.findIndex((i) => i.playerId === playerId && i.kind === kind && i.key === key);
      if (idx === -1) return false;
      identities.splice(idx, 1);
      return true;
    },
    async repointIdentities(fromId, toId) {
      for (const i of identities) if (i.playerId === fromId) i.playerId = toId;
    },
    async unionGroups(fromId, toId) {
      for (const m of [...memberships]) {
        const [pid, gid] = m.split('::');
        if (pid === fromId) {
          memberships.delete(m);
          memberships.add(`${toId}::${gid}`);
        }
      }
    },
    async deletePlayer(id) {
      players.delete(id);
    },
    async searchPlayers(query, limit) {
      // Mirror the real DAO: left-join minecraft identities, match on either the
      // player displayName or the identity name, limit rows, then dedupe by id.
      const q = query.toLowerCase();
      const rows: { id: string; displayName: string | null; identityName: string | null }[] = [];
      for (const p of players.values()) {
        const minecraftIdentities = identities.filter((i) => i.playerId === p.id && i.kind === 'minecraft');
        const joined = minecraftIdentities.length ? minecraftIdentities : [null];
        for (const identity of joined) {
          const minecraftName = identity?.name ?? null;
          const matches =
            (p.displayName ?? '').toLowerCase().includes(q) || (minecraftName ?? '').toLowerCase().includes(q);
          if (matches) rows.push({ id: p.id, displayName: p.displayName, identityName: minecraftName });
        }
      }
      const seen = new Set<string>();
      const out: { id: string; displayName: string | null; minecraftName: string | null }[] = [];
      for (const r of rows.slice(0, limit)) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({ id: r.id, displayName: r.displayName, minecraftName: r.identityName });
      }
      return out;
    },
  };

  return { dao, players, memberships, identities, groupsByName };
}

describe('handleUpdatePlayerFields', () => {
  it('404s an unknown player', async () => {
    const { dao } = makeFakeDao();
    const r = await handleUpdatePlayerFields(dao, 'nope', { status: 'allowed' }, NOW);
    expect(r).toEqual({ ok: false, status: 404, error: 'Player not found.' });
  });

  it('400s an invalid body', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core());
    const r = await handleUpdatePlayerFields(dao, 'p1', { status: 'banned' }, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(400);
  });

  it('applies a valid update', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core());
    const r = await handleUpdatePlayerFields(dao, 'p1', { status: 'allowed', isBot: true }, NOW);
    expect(r.ok).toBe(true);
    expect(players.get('p1')).toMatchObject({ status: 'allowed', isBot: true });
  });
});

describe('handleAddGroup / handleRemoveGroup', () => {
  it('creates a group and attaches it', async () => {
    const { dao, players, memberships, groupsByName } = makeFakeDao();
    players.set('p1', core());
    const r = await handleAddGroup(dao, 'p1', '  WTK ', NOW);
    expect(r.ok).toBe(true);
    expect(groupsByName.has('wtk')).toBe(true);
    expect([...memberships]).toHaveLength(1);
  });

  it('reuses an existing group case-insensitively', async () => {
    const { dao, players, groupsByName } = makeFakeDao();
    players.set('p1', core());
    players.set('p2', core({ id: 'p2' }));
    await handleAddGroup(dao, 'p1', 'WTK', NOW);
    await handleAddGroup(dao, 'p2', 'wtk', NOW);
    expect(groupsByName.size).toBe(1);
  });

  it('400s a blank group name', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core());
    const r = await handleAddGroup(dao, 'p1', '   ', NOW);
    expect(!r.ok && r.status).toBe(400);
  });

  it('404s adding to an unknown player', async () => {
    const { dao } = makeFakeDao();
    const r = await handleAddGroup(dao, 'ghost', 'WTK', NOW);
    expect(!r.ok && r.status).toBe(404);
  });

  it('removes a membership by name', async () => {
    const { dao, players, memberships } = makeFakeDao();
    players.set('p1', core());
    await handleAddGroup(dao, 'p1', 'WTK', NOW);
    const r = await handleRemoveGroup(dao, 'p1', 'wtk');
    expect(r.ok).toBe(true);
    expect([...memberships]).toHaveLength(0);
  });
});

describe('handleAddIdentity / handleRemoveIdentity', () => {
  it('adds an identity', async () => {
    const { dao, players, identities } = makeFakeDao();
    players.set('p1', core());
    const r = await handleAddIdentity(dao, 'p1', 'steam', '7656119', NOW);
    expect(r.ok).toBe(true);
    expect(identities).toHaveLength(1);
  });

  it('409s a key already owned by another player', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core());
    players.set('p2', core({ id: 'p2' }));
    await handleAddIdentity(dao, 'p2', 'minecraft', 'uuid-a', NOW);
    const r = await handleAddIdentity(dao, 'p1', 'minecraft', 'uuid-a', NOW);
    expect(!r.ok && r.status).toBe(409);
  });

  it('400s an invalid kind', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core());
    const r = await handleAddIdentity(dao, 'p1', 'xbox', 'gamertag', NOW);
    expect(!r.ok && r.status).toBe(400);
  });

  it('404s removing an identity not owned by the player', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core());
    const r = await handleRemoveIdentity(dao, 'p1', 'steam', 'missing');
    expect(!r.ok && r.status).toBe(404);
  });
});

describe('handleMergePlayers', () => {
  it('400s merge into self', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core());
    const r = await handleMergePlayers(dao, 'p1', 'p1', NOW);
    expect(!r.ok && r.status).toBe(400);
  });

  it('404s an unknown absorbed player', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core());
    const r = await handleMergePlayers(dao, 'p1', 'ghost', NOW);
    expect(!r.ok && r.status).toBe(404);
  });

  it('409s dual distinct accounts', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core({ userId: 'u1' }));
    players.set('p2', core({ id: 'p2', userId: 'u2' }));
    const r = await handleMergePlayers(dao, 'p1', 'p2', NOW);
    expect(!r.ok && r.status).toBe(409);
  });

  it('re-points identities, unions groups, ORs isBot, appends notes, deletes the absorbed', async () => {
    const { dao, players, identities, memberships } = makeFakeDao();
    players.set('p1', core({ notes: 'a', isBot: false, userId: null }));
    players.set('p2', core({ id: 'p2', notes: 'b', isBot: true, userId: 'u2' }));
    await handleAddIdentity(dao, 'p2', 'minecraft', 'uuid-x', NOW);
    await handleAddGroup(dao, 'p2', 'WTK', NOW);

    const r = await handleMergePlayers(dao, 'p1', 'p2', NOW);
    expect(r.ok).toBe(true);
    expect(players.has('p2')).toBe(false);
    expect(players.get('p1')).toMatchObject({ notes: 'a\n\nb', isBot: true, userId: 'u2' });
    expect(identities.every((i) => i.playerId === 'p1')).toBe(true);
    expect([...memberships].every((m) => m.startsWith('p1::'))).toBe(true);
  });
});

describe('handleSearchPlayers', () => {
  it('400s a too-short query', async () => {
    const { dao } = makeFakeDao();
    const r = await handleSearchPlayers(dao, '');
    expect(!r.ok && r.status).toBe(400);
  });

  it('returns matches', async () => {
    const { dao, players } = makeFakeDao();
    players.set('p1', core({ displayName: 'Steve' }));
    players.set('p2', core({ id: 'p2', displayName: 'Alex' }));
    const r = await handleSearchPlayers(dao, 'ste');
    expect(r.ok && r.players.map((p) => p.id)).toEqual(['p1']);
  });

  it('matches on the minecraft identity name and returns it as minecraftName', async () => {
    const { dao, players, identities } = makeFakeDao();
    players.set('p1', core({ displayName: null }));
    identities.push({ playerId: 'p1', kind: 'minecraft', key: 'uuid-1', name: 'Notch' });
    const r = await handleSearchPlayers(dao, 'notc');
    expect(r.ok && r.players).toEqual([{ id: 'p1', displayName: null, minecraftName: 'Notch' }]);
  });

  it('dedupes a player matched by multiple minecraft identities', async () => {
    const { dao, players, identities } = makeFakeDao();
    players.set('p1', core({ displayName: 'Steve' }));
    identities.push({ playerId: 'p1', kind: 'minecraft', key: 'uuid-1', name: 'Steve' });
    identities.push({ playerId: 'p1', kind: 'minecraft', key: 'uuid-2', name: 'Steven' });
    const r = await handleSearchPlayers(dao, 'steve');
    expect(r.ok && r.players.filter((p) => p.id === 'p1')).toHaveLength(1);
  });
});
