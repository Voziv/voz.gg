import { describe, it, expect } from 'vitest';
import { updateBadge } from './server-update-display';

describe('updateBadge', () => {
  it('is untracked when no source', () => {
    expect(updateBadge({ updateSource: 'none', currentVersion: null, availableVersion: null, lastError: null }).kind).toBe('untracked');
  });
  it('shows current and available when newer', () => {
    const b = updateBadge({ updateSource: 'vanilla', currentVersion: '1.21.1', availableVersion: '1.21.4', lastError: null });
    expect(b.kind).toBe('available');
    expect(b.label).toContain('1.21.1');
    expect(b.label).toContain('1.21.4');
  });
  it('is up to date when equal', () => {
    expect(updateBadge({ updateSource: 'vanilla', currentVersion: '1.21.4', availableVersion: '1.21.4', lastError: null }).kind).toBe('up_to_date');
  });
  it('surfaces a needs-api-key error', () => {
    expect(updateBadge({ updateSource: 'modpack', currentVersion: null, availableVersion: null, lastError: 'CurseForge API key not configured' }).kind).toBe('needs_api_key');
  });
  it('is failed on other errors', () => {
    expect(updateBadge({ updateSource: 'vanilla', currentVersion: '1.21.1', availableVersion: '1.21.1', lastError: 'fetch failed: 503' }).kind).toBe('failed');
  });
});
