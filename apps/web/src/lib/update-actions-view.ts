export interface UpdateActionsInput {
  policy: string;
  majorPolicy?: string;
  currentVersion: string | null;
  availableVersion: string | null;
  availableMajorVersion?: string | null;
  applyStatus: string | null;
  snapshots: Array<{ snapshotId: string; version: string | null; createdAt: string }>;
}

export function updateActionsViewModel(input: UpdateActionsInput) {
  const updateAvailable = !!input.availableVersion && input.availableVersion !== input.currentVersion;
  const busy = input.applyStatus === 'applying' || input.applyStatus === 'downloading' || input.applyStatus === 'reverting';
  const majorOffered = !!input.availableMajorVersion;
  return {
    showApprove: input.policy === 'approve' && updateAvailable && !busy,
    showRollback: input.snapshots.length > 0 && !busy,
    showMajorUpgrade: majorOffered && input.majorPolicy === 'approve' && !busy,
    majorLabel: majorOffered ? `Upgrade to Minecraft ${input.availableMajorVersion}` : '',
    busy,
  };
}
