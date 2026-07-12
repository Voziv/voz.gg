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

const base = { policy: 'approve', currentVersion: '26.1.0.5-beta', availableVersion: null, applyStatus: null, snapshots: [] };

describe('major upgrade visibility', () => {
  it('shows the major upgrade when an offer exists and the major policy is approve', () => {
    const vm = updateActionsViewModel({ ...base, majorPolicy: 'approve', availableMajorVersion: '27', serverControlEnabled: true } as never);
    expect(vm.showMajorUpgrade).toBe(true);
    expect(vm.majorLabel).toContain('27');
  });
  it('hides the major upgrade for auto major policy (applied automatically)', () => {
    const vm = updateActionsViewModel({ ...base, majorPolicy: 'auto', availableMajorVersion: '27', serverControlEnabled: true } as never);
    expect(vm.showMajorUpgrade).toBe(false);
  });
  it('hides the major upgrade when there is no offer', () => {
    const vm = updateActionsViewModel({ ...base, majorPolicy: 'approve', availableMajorVersion: null, serverControlEnabled: true } as never);
    expect(vm.showMajorUpgrade).toBe(false);
  });
  it('hides the major upgrade while an apply is in flight', () => {
    const vm = updateActionsViewModel({ ...base, majorPolicy: 'approve', availableMajorVersion: '27', applyStatus: 'applying', serverControlEnabled: true } as never);
    expect(vm.showMajorUpgrade).toBe(false);
  });
  it('hides the major upgrade when server control is disabled, even with an offer and approve policy', () => {
    const vm = updateActionsViewModel({ ...base, majorPolicy: 'approve', availableMajorVersion: '27', serverControlEnabled: false } as never);
    expect(vm.showMajorUpgrade).toBe(false);
  });
  it('hides the major upgrade when serverControlEnabled is undefined', () => {
    const vm = updateActionsViewModel({ ...base, majorPolicy: 'approve', availableMajorVersion: '27' } as never);
    expect(vm.showMajorUpgrade).toBe(false);
  });
});
