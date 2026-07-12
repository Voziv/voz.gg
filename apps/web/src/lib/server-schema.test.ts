import { describe, it, expect } from 'vitest';
import { parseServerInput } from './server-schema';

const valid = {
  name: 'Survival',
  gameType: 'minecraft-java',
  host: 'mc.example.com',
  port: '25565',
  description: '  Friendly SMP  ',
};

describe('parseServerInput', () => {
  it('accepts valid input, coerces the port, and trims the description', () => {
    const r = parseServerInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        name: 'Survival',
        gameType: 'minecraft-java',
        host: 'mc.example.com',
        port: 25565,
        description: 'Friendly SMP',
        runAsUser: null,
        runAsGroup: null,
        gameServerUser: null,
        logPath: null,
        logParserEnabled: null,
        serverControlEnabled: null,
        serverWorkingDir: null,
        startCommand: null,
        serverJvmArgs: null,
        restartSchedule: null,
        discordWebhookUrl: null,
        updateSource: 'none',
        modpackProvider: null,
        modpackId: null,
        updateVersionLine: null,
        updateChannel: 'stable',
        pinnedVersion: null,
        updatePolicy: 'notify',
        majorUpdatePolicy: 'approve',
        currentVersion: null,
      });
    }
  });

  it('turns a blank description into null', () => {
    const r = parseServerInput({ ...valid, description: '   ' });
    expect(r.ok && r.data.description).toBeNull();
  });

  it('omits description entirely → null', () => {
    const noDesc = { name: valid.name, gameType: valid.gameType, host: valid.host, port: valid.port };
    const r = parseServerInput(noDesc);
    expect(r.ok && r.data.description).toBeNull();
  });

  it('rejects an empty name', () => {
    const r = parseServerInput({ ...valid, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name is required/i);
  });

  it('rejects a name over 80 chars', () => {
    expect(parseServerInput({ ...valid, name: 'a'.repeat(81) }).ok).toBe(false);
  });

  it('rejects an unknown game type', () => {
    expect(parseServerInput({ ...valid, gameType: 'fortnite' }).ok).toBe(false);
  });

  it('rejects a host with illegal characters', () => {
    const r = parseServerInput({ ...valid, host: 'bad host!' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid host/i);
  });

  it('rejects a host containing a port (colon)', () => {
    const r = parseServerInput({ ...valid, host: 'mc.example.com:25565' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid host/i);
  });

  it.each(['0', '70000', '12.5', 'abc'])('rejects port %s', (port) => {
    expect(parseServerInput({ ...valid, port }).ok).toBe(false);
  });
});

describe('agent-host fields', () => {
  const base = { name: 'MC', gameType: 'minecraft-java', host: 'mc.example.com', port: 25565 };

  it('defaults the agent-host fields to null when omitted', () => {
    const r = parseServerInput(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.runAsUser).toBeNull();
    expect(r.data.runAsGroup).toBeNull();
    expect(r.data.gameServerUser).toBeNull();
    expect(r.data.logPath).toBeNull();
  });

  it('accepts valid unix usernames and an absolute log path', () => {
    const r = parseServerInput({
      ...base,
      runAsUser: 'voz-gg',
      runAsGroup: 'voz-gg',
      gameServerUser: 'minecraft',
      logPath: '/home/minecraft/logs',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.gameServerUser).toBe('minecraft');
    expect(r.data.logPath).toBe('/home/minecraft/logs');
  });

  it('coerces empty strings to null', () => {
    const r = parseServerInput({ ...base, gameServerUser: '', logPath: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.gameServerUser).toBeNull();
    expect(r.data.logPath).toBeNull();
  });

  it('rejects an invalid username', () => {
    const r = parseServerInput({ ...base, gameServerUser: 'Bad Name!' });
    expect(r.ok).toBe(false);
  });

  it('rejects a relative log path', () => {
    const r = parseServerInput({ ...base, logPath: 'relative/logs' });
    expect(r.ok).toBe(false);
  });
});

describe('logParserEnabled', () => {
  const base = { name: 'S', gameType: 'minecraft-java', host: 'h', port: 25565 };

  it('parses true and false', () => {
    const on = parseServerInput({ ...base, logParserEnabled: true });
    expect(on.ok && on.data.logParserEnabled).toBe(true);
    const off = parseServerInput({ ...base, logParserEnabled: false });
    expect(off.ok && off.data.logParserEnabled).toBe(false);
  });

  it('defaults to null when absent', () => {
    const r = parseServerInput(base);
    expect(r.ok && r.data.logParserEnabled).toBe(null);
  });

  it('rejects a non-boolean', () => {
    const r = parseServerInput({ ...base, logParserEnabled: 'yes' });
    expect(r.ok).toBe(false);
  });
});

describe('serverControl', () => {
  const base = { name: 'MC', gameType: 'minecraft-java', host: 'mc.example.com', port: 25565 };

  it('accepts a fully specified enabled server-control block', () => {
    const r = parseServerInput({
      ...base,
      gameServerUser: 'minecraft',
      serverControlEnabled: true,
      serverWorkingDir: '/home/minecraft/server',
      startCommand: '/home/minecraft/server/run.sh nogui',
      restartSchedule: '08:00',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.serverControlEnabled).toBe(true);
      expect(r.data.serverWorkingDir).toBe('/home/minecraft/server');
      expect(r.data.startCommand).toBe('/home/minecraft/server/run.sh nogui');
      expect(r.data.restartSchedule).toBe('08:00');
    }
  });

  it('coerces blank optional fields to null and defaults enabled to null', () => {
    const r = parseServerInput({ ...base, serverWorkingDir: '', startCommand: '', restartSchedule: '' });
    expect(r.ok && r.data.serverControlEnabled).toBe(null);
    expect(r.ok && r.data.serverWorkingDir).toBe(null);
    expect(r.ok && r.data.restartSchedule).toBe(null);
  });

  it('rejects a non-absolute working dir', () => {
    const r = parseServerInput({ ...base, serverWorkingDir: 'relative/path' });
    expect(r.ok).toBe(false);
  });

  it('rejects an invalid restart schedule', () => {
    expect(parseServerInput({ ...base, restartSchedule: '24:00' }).ok).toBe(false);
    expect(parseServerInput({ ...base, restartSchedule: '8:00' }).ok).toBe(false);
  });

  it('requires user, working dir, and start command when enabled', () => {
    const r = parseServerInput({
      ...base,
      serverControlEnabled: true,
      gameServerUser: 'minecraft',
      serverWorkingDir: '/srv/mc',
      startCommand: null,
    });
    expect(r.ok).toBe(false);
  });
});

describe('serverJvmArgs', () => {
  const base = { name: 'MC', gameType: 'minecraft-java', host: 'mc.example.com', port: 25565 };

  it('accepts a jvm args string', () => {
    const r = parseServerInput({ ...base, serverJvmArgs: '-Xmx6G' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.serverJvmArgs).toBe('-Xmx6G');
  });

  it('coerces empty string to null', () => {
    const r = parseServerInput({ ...base, serverJvmArgs: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.serverJvmArgs).toBeNull();
  });

  it('defaults to null when absent', () => {
    const r = parseServerInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.serverJvmArgs).toBeNull();
  });
});

describe('startCommand absolute path', () => {
  const base = { name: 'MC', gameType: 'minecraft-java', host: 'mc.example.com', port: 25565 };

  it('rejects a relative start command', () => {
    const r = parseServerInput({ ...base, startCommand: './run.sh nogui' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/absolute path/i);
  });

  it('accepts an absolute start command', () => {
    const r = parseServerInput({ ...base, startCommand: '/srv/mc/run.sh nogui' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.startCommand).toBe('/srv/mc/run.sh nogui');
  });
});

describe('fieldErrors', () => {
  const base = { name: 'MC', gameType: 'minecraft-java', host: 'mc.example.com', port: 25565 };

  it('populates fieldErrors keyed by field for multiple invalid fields', () => {
    const r = parseServerInput({ ...base, host: '', startCommand: './run.sh' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.fieldErrors.host).toBe('string');
      expect(r.fieldErrors.host.length).toBeGreaterThan(0);
      expect(typeof r.fieldErrors.startCommand).toBe('string');
      expect(r.fieldErrors.startCommand.length).toBeGreaterThan(0);
    }
  });

  it('includes fieldErrors for required server-control fields when enabled without them', () => {
    const r = parseServerInput({ ...base, serverControlEnabled: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.fieldErrors.serverWorkingDir).toBe('string');
      expect(r.fieldErrors.serverWorkingDir.length).toBeGreaterThan(0);
      expect(typeof r.fieldErrors.startCommand).toBe('string');
      expect(r.fieldErrors.startCommand.length).toBeGreaterThan(0);
    }
  });
});

describe('server-schema update fields', () => {
  const valid = { name: 'S', gameType: 'minecraft-java', host: '1.1.1.1', port: 25565 };

  it('accepts a vanilla update config', () => {
    const r = parseServerInput({ ...valid, updateSource: 'vanilla', updateChannel: 'stable', updatePolicy: 'notify' });
    expect(r.ok).toBe(true);
  });
  it('requires provider and id for a modpack', () => {
    const r = parseServerInput({ ...valid, updateSource: 'modpack' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.modpackProvider).toBeDefined();
      expect(r.fieldErrors.modpackId).toBeDefined();
    }
  });
  it('accepts a fully specified modpack', () => {
    const r = parseServerInput({ ...valid, updateSource: 'modpack', modpackProvider: 'modrinth', modpackId: 'cobblemon', updateChannel: 'stable' });
    expect(r.ok).toBe(true);
  });
  it('requires updateVersionLine for forge', () => {
    const r = parseServerInput({ ...valid, updateSource: 'forge' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.updateVersionLine).toBeDefined();
  });
  it('accepts forge with a version line', () => {
    const r = parseServerInput({ ...valid, updateSource: 'forge', updateVersionLine: '1.21.1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.updateVersionLine).toBe('1.21.1');
  });
});

describe('parseServerInput discordWebhookUrl', () => {
  const valid = { name: 'S', gameType: 'minecraft-java', host: 'example.com', port: 25565 };

  it('accepts a discord webhook url', () => {
    const r = parseServerInput({ ...valid, discordWebhookUrl: 'https://discord.com/api/webhooks/123/abcDEF-_' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.discordWebhookUrl).toBe('https://discord.com/api/webhooks/123/abcDEF-_');
  });
  it('coerces blank to null', () => {
    const r = parseServerInput({ ...valid, discordWebhookUrl: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.discordWebhookUrl).toBeNull();
  });
  it('rejects a non-discord url', () => {
    const r = parseServerInput({ ...valid, discordWebhookUrl: 'https://evil.example.com/hook' });
    expect(r.ok).toBe(false);
  });
});

describe('fabric apply version line', () => {
  const base = {
    name: 'MC',
    gameType: 'minecraft-java',
    host: 'mc.example.com',
    port: 25565,
    serverControlEnabled: true,
    gameServerUser: 'mc',
    serverWorkingDir: '/srv/s',
    startCommand: '/srv/s/run.sh',
    restartSchedule: '04:00',
  };

  it('rejects fabric+auto without a version line', () => {
    const r = parseServerInput({ ...base, updateSource: 'fabric', updatePolicy: 'auto', updateVersionLine: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.updateVersionLine).toBeDefined();
  });

  it('accepts fabric+notify without a version line', () => {
    const r = parseServerInput({ ...base, updateSource: 'fabric', updatePolicy: 'notify', updateVersionLine: '' });
    expect(r.ok).toBe(true);
  });

  it('accepts fabric+auto with a version line', () => {
    const r = parseServerInput({ ...base, updateSource: 'fabric', updatePolicy: 'auto', updateVersionLine: '1.21.1' });
    expect(r.ok).toBe(true);
  });
});

describe('updates validation', () => {
  it('allows a notify-policy tracked source without server control (Worker-only)', () => {
    const r = parseServerInput({ ...valid, updateSource: 'vanilla', updatePolicy: 'notify' });
    expect(r.ok).toBe(true);
  });
  it('rejects an approve/auto update source without server control', () => {
    const r = parseServerInput({ ...valid, updateSource: 'vanilla', updatePolicy: 'approve' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.updateSource).toMatch(/server management/i);
  });
  it('rejects auto policy without a restart schedule', () => {
    const r = parseServerInput({
      ...valid, updateSource: 'vanilla', updatePolicy: 'auto',
      serverControlEnabled: true, gameServerUser: 'mc', serverWorkingDir: '/srv/s', startCommand: '/srv/s/run.sh',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.restartSchedule).toMatch(/auto/i);
  });
  it('accepts a fully-specified auto update server', () => {
    const r = parseServerInput({
      ...valid, updateSource: 'vanilla', updatePolicy: 'auto', restartSchedule: '04:00',
      serverControlEnabled: true, gameServerUser: 'mc', serverWorkingDir: '/srv/s', startCommand: '/srv/s/run.sh',
    });
    expect(r.ok).toBe(true);
  });
});

describe('major update policy + channel', () => {
  const valid = { name: 'S', gameType: 'minecraft-java', host: 'h', port: 25565 };

  it('defaults majorUpdatePolicy to auto for vanilla', () => {
    const r = parseServerInput({ ...valid, updateSource: 'vanilla' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.majorUpdatePolicy).toBe('auto');
  });
  it('defaults majorUpdatePolicy to approve for a loader', () => {
    const r = parseServerInput({
      ...valid,
      updateSource: 'neoforge',
      updateVersionLine: '26',
      serverControlEnabled: true,
      gameServerUser: 'mc',
      serverWorkingDir: '/srv/s',
      startCommand: '/srv/s/run.sh',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.majorUpdatePolicy).toBe('approve');
  });
  it('accepts an explicit majorUpdatePolicy', () => {
    const r = parseServerInput({ ...valid, updateSource: 'vanilla', majorUpdatePolicy: 'approve' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.majorUpdatePolicy).toBe('approve');
  });
  it('defaults updateChannel to stable and accepts experimental', () => {
    const r1 = parseServerInput({ ...valid, updateSource: 'vanilla' });
    const r2 = parseServerInput({ ...valid, updateSource: 'vanilla', updateChannel: 'experimental' });
    if (r1.ok) expect(r1.data.updateChannel).toBe('stable');
    if (r2.ok) expect(r2.data.updateChannel).toBe('experimental');
  });
});
