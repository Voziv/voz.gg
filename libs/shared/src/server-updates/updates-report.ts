import { z } from 'zod';
import { APPLY_STATUSES, UPDATE_EVENT_KINDS, UPDATE_EVENT_STATUSES } from '../schema';

const eventSchema = z.object({
  kind: z.enum(UPDATE_EVENT_KINDS),
  fromVersion: z.string().nullable(),
  toVersion: z.string().nullable(),
  status: z.enum(UPDATE_EVENT_STATUSES),
  snapshotId: z.string().nullable(),
  error: z.string().nullable(),
  at: z.string(),
});

const bodySchema = z.object({
  installedVersion: z.string().max(200).nullable(),
  applyStatus: z.enum(APPLY_STATUSES),
  applyError: z.string().max(2000).nullable(),
  lastEvent: eventSchema.nullable(),
  snapshots: z.array(z.object({
    snapshotId: z.string().max(200),
    createdAt: z.string(),
    version: z.string().max(200).nullable(),
    sizeBytes: z.number().int().nonnegative().nullable(),
  })).max(50),
});

export type UpdatesReportBody = z.infer<typeof bodySchema>;

export function parseUpdatesReport(raw: unknown): { ok: true; body: UpdatesReportBody } | { ok: false } {
  const parsed = bodySchema.safeParse(raw);
  return parsed.success ? { ok: true, body: parsed.data } : { ok: false };
}

export interface UpdatesReportDao {
  setCurrentVersion(serverId: string, version: string | null): Promise<void>;
  setApplyState(serverId: string, s: { applyStatus: string; applyError: string | null; lastAppliedAt: Date | null }): Promise<void>;
  replaceSnapshots(serverId: string, rows: Array<{ snapshotId: string; createdAt: Date; version: string | null; sizeBytes: number | null }>): Promise<void>;
  eventExists(serverId: string, kind: string, at: Date): Promise<boolean>;
  appendEvent(e: { serverId: string; at: Date; kind: string; fromVersion: string | null; toVersion: string | null; status: string; snapshotId: string | null; error: string | null }): Promise<void>;
}

export interface UpdatesReportAlert {
  kind: string;
  fromVersion: string | null;
  toVersion: string | null;
  error: string | null;
}

// Idempotent upsert of an agent's full updater state. Makes currentVersion
// truthful, mirrors the host snapshot inventory, and appends a new audit event
// (deduped by serverId+kind+timestamp). `now` records lastAppliedAt on a settled
// state (done/failed). Returns an `alert` ONLY for a newly-recorded failed event
// (failed apply / auto_revert) so the caller can notify once per real failure.
export async function applyUpdatesReport(dao: UpdatesReportDao, serverId: string, body: UpdatesReportBody, now: Date): Promise<{ alert: UpdatesReportAlert | null }> {
  await dao.setCurrentVersion(serverId, body.installedVersion);
  const settled = body.applyStatus === 'done' || body.applyStatus === 'failed';
  await dao.setApplyState(serverId, {
    applyStatus: body.applyStatus,
    applyError: body.applyError,
    lastAppliedAt: settled ? now : null,
  });
  await dao.replaceSnapshots(
    serverId,
    body.snapshots.map((s) => ({ snapshotId: s.snapshotId, createdAt: new Date(s.createdAt), version: s.version, sizeBytes: s.sizeBytes })),
  );
  let alert: UpdatesReportAlert | null = null;
  if (body.lastEvent) {
    const ev = body.lastEvent;
    const at = new Date(ev.at);
    if (!(await dao.eventExists(serverId, ev.kind, at))) {
      await dao.appendEvent({
        serverId, at, kind: ev.kind,
        fromVersion: ev.fromVersion, toVersion: ev.toVersion,
        status: ev.status, snapshotId: ev.snapshotId, error: ev.error,
      });
      if (ev.status === 'failed') {
        alert = { kind: ev.kind, fromVersion: ev.fromVersion, toVersion: ev.toVersion, error: ev.error };
      }
    }
  }
  return { alert };
}

export function formatApplyFailureMessage(serverName: string, alert: UpdatesReportAlert): { content: string } {
  const reverted = alert.kind === 'auto_revert' ? ` (reverted to ${alert.toVersion ?? 'previous'})` : '';
  return { content: `⚠️ **${serverName}** update failed${reverted}: ${alert.error ?? 'unknown error'}` };
}
