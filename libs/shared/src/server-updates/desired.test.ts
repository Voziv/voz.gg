import { describe, it, expect } from 'vitest';
import { planAutoDesired, desiredGenerationId } from './desired';

const base = { policy: 'auto', source: 'vanilla', available: '1.21.4', installed: '1.21.1', pinned: null, currentDesiredVersion: null } as const;

describe('planAutoDesired', () => {
  it('targets the available version when newer than installed under auto', () => {
    expect(planAutoDesired(base)).toEqual({ version: '1.21.4' });
  });
  it('returns null when policy is not auto', () => {
    expect(planAutoDesired({ ...base, policy: 'approve' })).toBeNull();
    expect(planAutoDesired({ ...base, policy: 'notify' })).toBeNull();
  });
  it('returns null when available equals installed', () => {
    expect(planAutoDesired({ ...base, available: '1.21.1' })).toBeNull();
  });
  it('respects a pin equal to available (holds, no desired)', () => {
    expect(planAutoDesired({ ...base, pinned: '1.21.4' })).toBeNull();
  });
  it('returns null when available is missing', () => {
    expect(planAutoDesired({ ...base, available: null })).toBeNull();
  });
  it('is idempotent: null when desired already targets available', () => {
    expect(planAutoDesired({ ...base, currentDesiredVersion: '1.21.4' })).toBeNull();
  });
});

describe('planAutoDesired loaders', () => {
  it('plans for neoforge/forge/fabric', () => {
    for (const source of ['neoforge', 'forge', 'fabric'] as const) {
      expect(planAutoDesired({ ...base, source })).toEqual({ version: '1.21.4' });
    }
  });
  it('still rejects modpack and none', () => {
    expect(planAutoDesired({ ...base, source: 'modpack' as never })).toBeNull();
    expect(planAutoDesired({ ...base, source: 'none' as never })).toBeNull();
  });
});

describe('desiredGenerationId', () => {
  it('is stable for the same kind+key', () => {
    expect(desiredGenerationId('apply', '1.21.4')).toBe('apply:1.21.4');
    expect(desiredGenerationId('rollback', 'snap-1')).toBe('rollback:snap-1');
  });
});
