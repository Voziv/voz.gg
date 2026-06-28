import { describe, it, expect } from 'vitest';
import { updateActionsViewModel } from './update-actions-view';

describe('updateActionsViewModel', () => {
  it('shows approve only for approve-policy with an available update', () => {
    const vm = updateActionsViewModel({ policy: 'approve', currentVersion: '1.21.1', availableVersion: '1.21.4', applyStatus: 'idle', snapshots: [] });
    expect(vm.showApprove).toBe(true);
  });
  it('hides approve for auto policy', () => {
    const vm = updateActionsViewModel({ policy: 'auto', currentVersion: '1.21.1', availableVersion: '1.21.4', applyStatus: 'idle', snapshots: [] });
    expect(vm.showApprove).toBe(false);
  });
  it('hides approve when already up to date', () => {
    const vm = updateActionsViewModel({ policy: 'approve', currentVersion: '1.21.4', availableVersion: '1.21.4', applyStatus: 'idle', snapshots: [] });
    expect(vm.showApprove).toBe(false);
  });
  it('hides approve while an apply is in flight', () => {
    const vm = updateActionsViewModel({ policy: 'approve', currentVersion: '1.21.1', availableVersion: '1.21.4', applyStatus: 'applying', snapshots: [] });
    expect(vm.showApprove).toBe(false);
    expect(vm.busy).toBe(true);
  });
  it('shows rollback when snapshots exist', () => {
    const vm = updateActionsViewModel({ policy: 'notify', currentVersion: '1.21.4', availableVersion: '1.21.4', applyStatus: 'idle', snapshots: [{ snapshotId: 's', version: '1.21.1', createdAt: '2026-06-27T04:00:00Z' }] });
    expect(vm.showRollback).toBe(true);
  });
});
