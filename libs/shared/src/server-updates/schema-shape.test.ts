import { UPDATE_SOURCES, MODPACK_PROVIDERS, UPDATE_POLICIES, serverUpdateState, servers } from '../schema';

describe('update schema shape', () => {
  it('exposes the update source enum', () => {
    expect(UPDATE_SOURCES).toEqual(['none', 'vanilla', 'forge', 'neoforge', 'fabric', 'modpack']);
  });
  it('exposes modpack providers and policies', () => {
    expect(MODPACK_PROVIDERS).toEqual(['modrinth', 'curseforge', 'ftb', 'packwiz']);
    expect(UPDATE_POLICIES).toEqual(['notify', 'approve', 'auto']);
  });
  it('adds update columns to servers', () => {
    expect(servers.updateSource).toBeDefined();
    expect(servers.modpackProvider).toBeDefined();
    expect(servers.currentVersion).toBeDefined();
  });
  it('defines the server_update_state table', () => {
    expect(serverUpdateState.serverId).toBeDefined();
    expect(serverUpdateState.notifiedVersion).toBeDefined();
  });
});
