export function updateBadge(input: {
  updateSource: string | null;
  currentVersion: string | null;
  availableVersion: string | null;
  lastError: string | null;
}): { kind: 'untracked' | 'up_to_date' | 'available' | 'failed' | 'needs_api_key'; label: string } {
  if (!input.updateSource || input.updateSource === 'none') return { kind: 'untracked', label: '' };
  if (input.lastError) {
    if (/api key/i.test(input.lastError)) return { kind: 'needs_api_key', label: 'Needs API key' };
    return { kind: 'failed', label: 'Check failed' };
  }
  const current = input.currentVersion ?? 'unknown';
  if (input.availableVersion && input.availableVersion !== input.currentVersion) {
    return { kind: 'available', label: `On ${current} · Update available → ${input.availableVersion}` };
  }
  return { kind: 'up_to_date', label: `Up to date (${current})` };
}
