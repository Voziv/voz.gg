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
    const t = toTrackedServer({ id: 's1', updateSource: 'vanilla', updateChannel: 'release', modpackProvider: null, modpackId: null, updateVersionLine: null } as never);
    expect(t).toEqual({ serverId: 's1', host: 'launchermeta.mojang.com', config: { source: 'vanilla', provider: null, id: null, channel: 'release' } });
  });
  it('maps a forge row with updateVersionLine to config.id', () => {
    const t = toTrackedServer({ id: 's2', updateSource: 'forge', updateChannel: null, modpackProvider: null, modpackId: null, updateVersionLine: '1.21.1' } as never);
    expect(t).toEqual({ serverId: 's2', host: 'files.minecraftforge.net', config: { source: 'forge', provider: null, id: '1.21.1', channel: null } });
  });
});
