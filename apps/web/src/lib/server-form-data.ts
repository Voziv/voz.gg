import type { Server } from '@voz/shared';

// Single source of truth for the server columns the create/edit form reads.
// `ServerFormData` is derived from this list and `toServerFormData` copies
// exactly these, so a newly-tracked column is added in ONE place — the form's
// prop can no longer silently drift out of sync with the row (the bug where
// `updateVersionLine` was omitted from the dashboard's edit prop). `satisfies`
// rejects a typo'd or non-existent column name at compile time.
export const SERVER_FORM_FIELDS = [
  'id',
  'name',
  'gameType',
  'host',
  'port',
  'description',
  'runAsUser',
  'runAsGroup',
  'gameServerUser',
  'logPath',
  'logParserEnabled',
  'discordWebhookUrl',
  'slug',
  'serverControlEnabled',
  'serverWorkingDir',
  'startCommand',
  'restartSchedule',
  'updateSource',
  'modpackProvider',
  'modpackId',
  'updateVersionLine',
  'updateChannel',
  'pinnedVersion',
  'updatePolicy',
  'currentVersion',
] as const satisfies readonly (keyof Server)[];

export type ServerFormData = Pick<Server, (typeof SERVER_FORM_FIELDS)[number]>;

export function toServerFormData(row: Server): ServerFormData {
  const out = {} as Record<string, unknown>;
  for (const field of SERVER_FORM_FIELDS) out[field] = row[field];
  return out as ServerFormData;
}
