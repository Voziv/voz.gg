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
    const b = updateBadge({ updateSource: 'vanilla', currentVersion: '1.21.4', availableVersion: '1.21.4', lastError: null });
    expect(b.kind).toBe('up_to_date');
    expect(b.label).toContain('1.21.4');
  });
  it('surfaces a needs-api-key error', () => {
    const b = updateBadge({ updateSource: 'modpack', currentVersion: null, availableVersion: null, lastError: 'CurseForge API key not configured' });
    expect(b.kind).toBe('needs_api_key');
    expect(b.label).toContain('API key');
  });
  it('is failed on other errors', () => {
    const b = updateBadge({ updateSource: 'vanilla', currentVersion: '1.21.1', availableVersion: '1.21.1', lastError: 'fetch failed: 503' });
    expect(b.kind).toBe('failed');
    expect(b.label).toBe('Check failed');
  });
  it('shows applying when applyStatus is applying', () => {
    const b = updateBadge({ updateSource: 'vanilla', currentVersion: '1.21.1', availableVersion: '1.21.4', lastError: null, applyStatus: 'applying' });
    expect(b.kind).toBe('applying');
    expect(b.label).toMatch(/1\.21\.4/);
  });
  it('shows apply failed when applyStatus is failed', () => {
    const b = updateBadge({ updateSource: 'vanilla', currentVersion: '1.21.1', availableVersion: '1.21.4', lastError: 'boot failed', applyStatus: 'failed' });
    expect(b.kind).toBe('failed');
    expect(b.label).toBe('Apply failed');
  });
  it('shows pending when an approved update is queued', () => {
    const b = updateBadge({ updateSource: 'vanilla', currentVersion: '1.21.1', availableVersion: '1.21.4', lastError: null, applyStatus: 'pending' });
    expect(b.kind).toBe('available');
    expect(b.label).toMatch(/pending/i);
  });
});
