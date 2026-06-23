import { describe, it, expect } from 'vitest';
import { toTrackedServer, hostFor } from './dao';

describe('hostFor', () => {
  it('returns the throttling host per source', () => {
    expect(hostFor('vanilla', null)).toBe('launchermeta.mojang.com');
    expect(hostFor('modpack', 'modrinth')).toBe('api.modrinth.com');
  });
});

describe('toTrackedServer', () => {
  it('returns null for an untracked server', () => {
    expect(toTrackedServer({ id: 's1', updateSource: 'none' } as never)).toBeNull();
    expect(toTrackedServer({ id: 's1', updateSource: null } as never)).toBeNull();
  });
  it('maps a vanilla server to a tracked server', () => {
    const t = toTrackedServer({ id: 's1', updateSource: 'vanilla', updateChannel: 'release', modpackProvider: null, modpackId: null } as never);
    expect(t).toEqual({ serverId: 's1', host: 'launchermeta.mojang.com', config: { source: 'vanilla', provider: null, id: null, channel: 'release' } });
  });
});
