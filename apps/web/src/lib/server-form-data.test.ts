import { describe, it, expect } from 'vitest';
import type { Server } from '@voz/shared';
import { toServerFormData, SERVER_FORM_FIELDS } from './server-form-data';

// A full server row, including the columns the form must NOT receive
// (createdBy/createdAt/updatedAt/monitorEnabled).
const fullRow: Server = {
  id: 's1',
  name: 'Survival',
  gameType: 'minecraft-java',
  host: '1.2.3.4',
  port: 25565,
  description: 'desc',
  runAsUser: 'voz-gg',
  runAsGroup: 'voz-gg',
  gameServerUser: 'minecraft',
  logPath: '/home/minecraft/logs',
  monitorEnabled: true,
  logParserEnabled: true,
  slug: 'survival',
  serverControlEnabled: true,
  serverWorkingDir: '/srv/survival',
  startCommand: '/srv/survival/run.sh',
  restartSchedule: '04:00',
  discordWebhookUrl: 'https://discord.test/hook',
  updateSource: 'neoforge',
  modpackProvider: null,
  modpackId: null,
  updateVersionLine: '21.1',
  updateChannel: 'latest',
  pinnedVersion: null,
  updatePolicy: 'notify',
  currentVersion: '21.1.50',
  createdBy: 'u1',
  createdAt: new Date(1000),
  updatedAt: new Date(2000),
};

describe('toServerFormData', () => {
  it('returns exactly the form fields — no missing field, no leaked column', () => {
    const result = toServerFormData(fullRow);
    expect(Object.keys(result).sort()).toEqual([...SERVER_FORM_FIELDS].sort());
  });

  it('round-trips the loader version line (the field that regressed)', () => {
    expect(toServerFormData(fullRow).updateVersionLine).toBe('21.1');
  });

  it('omits server-internal columns from the client prop', () => {
    const result = toServerFormData(fullRow) as Record<string, unknown>;
    expect('createdBy' in result).toBe(false);
    expect('createdAt' in result).toBe(false);
    expect('updatedAt' in result).toBe(false);
    expect('monitorEnabled' in result).toBe(false);
  });
});
