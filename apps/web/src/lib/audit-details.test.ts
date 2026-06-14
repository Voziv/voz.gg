import { describe, it, expect } from 'vitest';
import { formatAuditDetails } from './audit-details';

describe('formatAuditDetails', () => {
  it('returns nothing for null/empty details', () => {
    expect(formatAuditDetails(null)).toEqual([]);
    expect(formatAuditDetails('')).toEqual([]);
  });

  it('skips null-valued keys (e.g. a ban with no reason)', () => {
    expect(formatAuditDetails(JSON.stringify({ reason: null, expiresInSeconds: null }))).toEqual([]);
  });

  it('labels a reason', () => {
    expect(formatAuditDetails(JSON.stringify({ reason: 'spam' }))).toEqual([{ label: 'Reason', value: 'spam' }]);
  });

  it('collapses a role transition into one arrowed line', () => {
    expect(formatAuditDetails(JSON.stringify({ oldRole: 'user', newRole: 'admin' }))).toEqual([
      { label: 'Role', value: 'user → admin' },
    ]);
  });

  it('humanizes a ban expiry to the largest whole unit', () => {
    expect(formatAuditDetails(JSON.stringify({ expiresInSeconds: 604800 }))).toEqual([
      { label: 'Expires in', value: '7 days' },
    ]);
    expect(formatAuditDetails(JSON.stringify({ expiresInSeconds: 3600 }))).toEqual([
      { label: 'Expires in', value: '1 hour' },
    ]);
  });

  it('combines reason and expiry on a ban', () => {
    expect(formatAuditDetails(JSON.stringify({ reason: 'cheating', expiresInSeconds: 86400 }))).toEqual([
      { label: 'Reason', value: 'cheating' },
      { label: 'Expires in', value: '1 day' },
    ]);
  });

  it('uses a friendly label for a transfer-ownership payload', () => {
    expect(formatAuditDetails(JSON.stringify({ newOwnerEmail: 'a@b.co' }))).toEqual([
      { label: 'New owner', value: 'a@b.co' },
    ]);
  });

  it('title-cases unknown keys', () => {
    expect(formatAuditDetails(JSON.stringify({ someOtherField: 'x' }))).toEqual([
      { label: 'Some Other Field', value: 'x' },
    ]);
  });

  it('falls back to the raw string when details is not a JSON object', () => {
    expect(formatAuditDetails('not json')).toEqual([{ label: 'Details', value: 'not json' }]);
    expect(formatAuditDetails('[1,2]')).toEqual([{ label: 'Details', value: '[1,2]' }]);
  });
});
