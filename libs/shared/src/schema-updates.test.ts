import { describe, it, expect } from 'vitest';
import { APPLY_STATUSES, DESIRED_KINDS, UPDATE_EVENT_KINDS, HASH_ALGOS, serverSnapshot, serverUpdateEvent } from './schema';

describe('update-apply schema', () => {
  it('exposes the apply lifecycle statuses', () => {
    expect(APPLY_STATUSES).toContain('pending');
    expect(APPLY_STATUSES).toContain('failed');
    expect(DESIRED_KINDS).toEqual(['apply', 'rollback']);
    expect(UPDATE_EVENT_KINDS).toContain('auto_revert');
    expect(HASH_ALGOS).toEqual(['sha1', 'sha256']);
  });
  it('defines the new tables', () => {
    expect(serverSnapshot).toBeDefined();
    expect(serverUpdateEvent).toBeDefined();
  });
});
