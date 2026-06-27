export function updateBadge(input: {
  updateSource: string | null;
  currentVersion: string | null;
  availableVersion: string | null;
  lastError: string | null;
  applyStatus?: string | null;
}): { kind: 'untracked' | 'up_to_date' | 'available' | 'applying' | 'failed' | 'needs_api_key'; label: string } {
  if (!input.updateSource || input.updateSource === 'none') return { kind: 'untracked', label: '' };
  const current = input.currentVersion ?? 'unknown';
  // Apply lifecycle takes precedence over detection state while it is in flight or
  // has just failed, so the badge reflects what the agent is actually doing.
  if (input.applyStatus === 'applying' || input.applyStatus === 'downloading' || input.applyStatus === 'reverting') {
    return { kind: 'applying', label: `Applying… ${input.availableVersion ?? ''}`.trim() };
  }
  if (input.applyStatus === 'failed') {
    return { kind: 'failed', label: 'Apply failed' };
  }
  if (input.lastError) {
    if (/api key/i.test(input.lastError)) return { kind: 'needs_api_key', label: 'Needs API key' };
    return { kind: 'failed', label: 'Check failed' };
  }
  if (input.applyStatus === 'pending') {
    return { kind: 'available', label: `On ${current} · Update pending → ${input.availableVersion ?? ''}`.trim() };
  }
  if (input.availableVersion && input.availableVersion !== input.currentVersion) {
    return { kind: 'available', label: `On ${current} · Update available → ${input.availableVersion}` };
  }
  return { kind: 'up_to_date', label: `Up to date (${current})` };
}
