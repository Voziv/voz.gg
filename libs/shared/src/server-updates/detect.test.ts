import { runDetection, type TrackedServer } from './detect';

const noSleep = async () => {};

function server(serverId: string, host: string, id: string): TrackedServer {
  return { serverId, host, config: { source: 'modpack', provider: 'modrinth', id, channel: 'release' } };
}

describe('runDetection', () => {
  it('calls run once per distinct key and fans the result out', async () => {
    const calls: string[] = [];
    const servers = [server('a', 'api.modrinth.com', 'pack1'), server('b', 'api.modrinth.com', 'pack1')];
    const results = await runDetection(servers, {
      run: async (c) => { calls.push(c.id!); return { version: '9.9', publishedAt: 1 }; },
      sleep: noSleep, gapMs: 0,
    });
    expect(calls).toEqual(['pack1']); // deduped
    expect(results.map((r) => r.version)).toEqual(['9.9', '9.9']);
  });

  it('isolates a failing group from the rest', async () => {
    const servers = [server('a', 'api.modrinth.com', 'bad'), server('b', 'other.com', 'good')];
    const results = await runDetection(servers, {
      run: async (c) => { if (c.id === 'bad') throw new Error('boom'); return { version: 'ok', publishedAt: null }; },
      sleep: noSleep, gapMs: 0,
    });
    const a = results.find((r) => r.serverId === 'a')!;
    const b = results.find((r) => r.serverId === 'b')!;
    expect(a.error).toBe('boom');
    expect(a.version).toBeNull();
    expect(b.version).toBe('ok');
  });

  it('isolates a failing key from a healthy key on the same host', async () => {
    const servers = [server('a', 'api.modrinth.com', 'bad'), server('b', 'api.modrinth.com', 'good')];
    const results = await runDetection(servers, {
      run: async (c) => { if (c.id === 'bad') throw new Error('boom'); return { version: 'ok', publishedAt: null }; },
      sleep: noSleep, gapMs: 0,
    });
    const a = results.find((r) => r.serverId === 'a')!;
    const b = results.find((r) => r.serverId === 'b')!;
    expect(a.error).toBe('boom');
    expect(a.version).toBeNull();
    expect(b.version).toBe('ok');
    expect(b.error).toBeNull();
  });

  it('sleeps between sequential calls to the same host', async () => {
    const sleeps: number[] = [];
    const servers = [server('a', 'api.modrinth.com', 'p1'), server('b', 'api.modrinth.com', 'p2')];
    await runDetection(servers, {
      run: async () => ({ version: 'x', publishedAt: null }),
      sleep: async (ms) => { sleeps.push(ms); }, gapMs: 5000,
    });
    expect(sleeps).toContain(5000); // one gap between the two same-host calls
  });
});
