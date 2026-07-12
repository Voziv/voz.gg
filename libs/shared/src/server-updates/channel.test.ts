import { describe, it, expect } from 'vitest';
import { resolverChannel } from './channel';

describe('resolverChannel', () => {
  it('vanilla', () => {
    expect(resolverChannel('vanilla', 'stable')).toBe('release');
    expect(resolverChannel('vanilla', 'experimental')).toBe('snapshot');
  });
  it('forge', () => {
    expect(resolverChannel('forge', 'stable')).toBe('recommended');
    expect(resolverChannel('forge', 'experimental')).toBe('latest');
  });
  it('neoforge', () => {
    expect(resolverChannel('neoforge', 'stable')).toBe('stable');
    expect(resolverChannel('neoforge', 'experimental')).toBe('beta');
  });
  it('fabric', () => {
    expect(resolverChannel('fabric', 'stable')).toBe('latest');
    expect(resolverChannel('fabric', 'experimental')).toBe('unstable');
  });
  it('passes through a legacy/raw channel value unchanged', () => {
    expect(resolverChannel('neoforge', 'beta')).toBe('beta');
    expect(resolverChannel('vanilla', 'snapshot')).toBe('snapshot');
    expect(resolverChannel('vanilla', null)).toBeNull();
  });
});
