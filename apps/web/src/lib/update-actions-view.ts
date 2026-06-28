export interface UpdateActionsInput {
  policy: string;
  currentVersion: string | null;
  availableVersion: string | null;
  applyStatus: string | null;
  snapshots: Array<{ snapshotId: string; version: string | null; createdAt: string }>;
}

export function updateActionsViewModel(input: UpdateActionsInput) {
  const updateAvailable = !!input.availableVersion && input.availableVersion !== input.currentVersion;
  const busy = input.applyStatus === 'applying' || input.applyStatus === 'downloading' || input.applyStatus === 'reverting';
  return {
    showApprove: input.policy === 'approve' && updateAvailable && !busy,
    showRollback: input.snapshots.length > 0 && !busy,
    busy,
  };
}
