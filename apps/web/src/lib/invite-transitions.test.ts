import { describe, it, expect } from 'vitest';
import { canApprove, canDeny } from './invite-transitions';

describe('canApprove', () => {
  it('allows pending and denied, rejects approved', () => {
    expect(canApprove('pending')).toBe(true);
    expect(canApprove('denied')).toBe(true);
    expect(canApprove('approved')).toBe(false);
  });
});

describe('canDeny', () => {
  it('allows only pending', () => {
    expect(canDeny('pending')).toBe(true);
    expect(canDeny('denied')).toBe(false);
    expect(canDeny('approved')).toBe(false);
  });
});
