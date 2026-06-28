import { describe, it, expect } from 'vitest';
import { applyUpdatesReport, parseUpdatesReport } from './updates-report';

function fakeDao() {
  const calls: any = { currentVersion: [], applyState: [], snapshots: [], events: [] };
  return {
    calls,
    async setCurrentVersion(id: string, v: string | null) { calls.currentVersion.push({ id, v }); },
    async setApplyState(id: string, s: any) { calls.applyState.push({ id, ...s }); },
    async replaceSnapshots(id: string, rows: any[]) { calls.snapshots.push({ id, rows }); },
    async eventExists() { return false; },
    async appendEvent(e: any) { calls.events.push(e); },
  };
}

const body = {
  installedVersion: '1.21.4',
  applyStatus: 'done',
  applyError: null,
  lastEvent: { kind: 'apply', fromVersion: '1.21.1', toVersion: '1.21.4', status: 'success', snapshotId: 'snap-1', error: null, at: '2026-06-27T04:05:00Z' },
  snapshots: [{ snapshotId: 'snap-1', createdAt: '2026-06-27T04:00:00Z', version: '1.21.1', sizeBytes: 1234 }],
};

describe('parseUpdatesReport', () => {
  it('accepts a well-formed body', () => {
    expect(parseUpdatesReport(body).ok).toBe(true);
  });
  it('rejects a bad applyStatus', () => {
    expect(parseUpdatesReport({ ...body, applyStatus: 'nope' }).ok).toBe(false);
  });
});

describe('applyUpdatesReport', () => {
  it('writes current version, apply state, snapshots, and a new event', async () => {
    const dao = fakeDao();
    await applyUpdatesReport(dao, 's1', (parseUpdatesReport(body) as any).body, new Date('2026-06-27T05:00:00Z'));
    expect(dao.calls.currentVersion).toEqual([{ id: 's1', v: '1.21.4' }]);
    expect(dao.calls.applyState[0]).toMatchObject({ id: 's1', applyStatus: 'done', applyError: null });
    expect(dao.calls.snapshots[0].rows).toHaveLength(1);
    expect(dao.calls.events[0]).toMatchObject({ serverId: 's1', kind: 'apply', toVersion: '1.21.4', status: 'success', snapshotId: 'snap-1' });
  });

  it('does not append a duplicate event', async () => {
    const dao = fakeDao();
    dao.eventExists = async () => true;
    await applyUpdatesReport(dao, 's1', (parseUpdatesReport(body) as any).body, new Date());
    expect(dao.calls.events).toHaveLength(0);
  });

  it('skips the event append when lastEvent is null but still updates state', async () => {
    const dao = fakeDao();
    const b = { ...body, lastEvent: null };
    await applyUpdatesReport(dao, 's1', (parseUpdatesReport(b) as any).body, new Date());
    expect(dao.calls.events).toHaveLength(0);
    expect(dao.calls.currentVersion).toEqual([{ id: 's1', v: '1.21.4' }]);
  });

  it('returns an alert for a new failed event and none for a success', async () => {
    const ok = await applyUpdatesReport(fakeDao(), 's1', (parseUpdatesReport(body) as any).body, new Date());
    expect(ok.alert).toBeNull();
    const failBody = { ...body, applyStatus: 'failed', lastEvent: { kind: 'auto_revert', fromVersion: '1.21.4', toVersion: '1.21.1', status: 'failed', snapshotId: 'snap-1', error: 'boot failed', at: '2026-06-27T04:05:00Z' } };
    const bad = await applyUpdatesReport(fakeDao(), 's1', (parseUpdatesReport(failBody) as any).body, new Date());
    expect(bad.alert).toMatchObject({ kind: 'auto_revert', error: 'boot failed' });
  });

  it('does not alert for a duplicate failed event', async () => {
    const dao = fakeDao();
    dao.eventExists = async () => true;
    const failBody = { ...body, applyStatus: 'failed', lastEvent: { kind: 'apply', fromVersion: '1.21.1', toVersion: '1.21.4', status: 'failed', snapshotId: null, error: 'x', at: '2026-06-27T04:05:00Z' } };
    const r = await applyUpdatesReport(dao, 's1', (parseUpdatesReport(failBody) as any).body, new Date());
    expect(r.alert).toBeNull();
  });
});
